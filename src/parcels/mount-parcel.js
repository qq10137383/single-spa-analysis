import {
  validLifecycleFn,
  flattenFnArray,
} from "../lifecycles/lifecycle.helpers.js";
import {
  NOT_BOOTSTRAPPED,
  NOT_MOUNTED,
  MOUNTED,
  LOADING_SOURCE_CODE,
  SKIP_BECAUSE_BROKEN,
  toName,
} from "../applications/app.helpers.js";
import { toBootstrapPromise } from "../lifecycles/bootstrap.js";
import { toMountPromise } from "../lifecycles/mount.js";
import { toUpdatePromise } from "../lifecycles/update.js";
import { toUnmountPromise } from "../lifecycles/unmount.js";
import { ensureValidAppTimeouts } from "../applications/timeouts.js";
import { formatErrorMessage } from "../applications/app-errors.js";

// parcel 数量
let parcelCount = 0;
// 独立于app的parcel，即通过singleSpa.mountRootParcel创建的parcel
const rootParcels = { parcels: {} };

// This is a public api, exported to users of single-spa
// 全局方法，生成的parcel是独立于微应用的，需要手动反激活
export function mountRootParcel() {
  return mountParcel.apply(rootParcels, arguments);
}

// 微应用的实例调用mountParcel生成的parcel是属于微应用的，微应用反激活时parcel也会反激活
export function mountParcel(config, customProps) {
  const owningAppOrParcel = this;

  // Validate inputs
  // config可以是对象或者是函数
  if (!config || (typeof config !== "object" && typeof config !== "function")) {
    throw Error(
      formatErrorMessage(
        2,
        __DEV__ &&
          "Cannot mount parcel without a config object or config loading function"
      )
    );
  }

  // 校验配置属性
  if (config.name && typeof config.name !== "string") {
    throw Error(
      formatErrorMessage(
        3,
        __DEV__ &&
          `Parcel name must be a string, if provided. Was given ${typeof config.name}`,
        typeof config.name
      )
    );
  }

  if (typeof customProps !== "object") {
    throw Error(
      formatErrorMessage(
        4,
        __DEV__ &&
          `Parcel ${name} has invalid customProps -- must be an object but was given ${typeof customProps}`,
        name,
        typeof customProps
      )
    );
  }

  if (!customProps.domElement) {
    throw Error(
      formatErrorMessage(
        5,
        __DEV__ &&
          `Parcel ${name} cannot be mounted without a domElement provided as a prop`,
        name
      )
    );
  }

  const id = parcelCount++;

  // config是对象，需要包装为Promise函数，目的是将config统一转为Promise函数
  const passedConfigLoadingFunction = typeof config === "function";
  const configLoadingFunction = passedConfigLoadingFunction
    ? config
    : () => Promise.resolve(config);

  // Internal representation
  // parcel内部实例
  const parcel = {
    id,
    parcels: {}, //始终是空
    status: passedConfigLoadingFunction  //如果config是函数，说明还需要异步加载(LOADING_SOURCE_CODE)，是对象则说明已经加载完成的配置实例了
      ? LOADING_SOURCE_CODE
      : NOT_BOOTSTRAPPED,
    customProps,
    parentName: toName(owningAppOrParcel), // parcel所属的微应用名(app)
    // 反激活函数，仅parcel有，app会自动反激活(activeWhen不满足时)，不需要手动调用，独立于app的parcel是需要手动调用的
    unmountThisParcel() {
      return mountPromise
        .then(() => {
          if (parcel.status !== MOUNTED) {
            throw Error(
              formatErrorMessage(
                6,
                __DEV__ &&
                  `Cannot unmount parcel '${name}' -- it is in a ${parcel.status} status`,
                name,
                parcel.status
              )
            );
          }
          return toUnmountPromise(parcel, true);
        })
        .then((value) => {
          if (parcel.parentName) {
            delete owningAppOrParcel.parcels[parcel.id];
          }

          return value;
        })
        .then((value) => {
          resolveUnmount(value);
          return value;
        })
        .catch((err) => {
          parcel.status = SKIP_BECAUSE_BROKEN;
          rejectUnmount(err);
          throw err;
        });
    },
  };

  // We return an external representation
  // parcel的外部实例，供用户调用
  let externalRepresentation;

  // Add to owning app or parcel
  // 挂载到父实例上
  owningAppOrParcel.parcels[id] = parcel;

  // 加载parcel配置
  let loadPromise = configLoadingFunction();

  if (!loadPromise || typeof loadPromise.then !== "function") {
    throw Error(
      formatErrorMessage(
        7,
        __DEV__ &&
          `When mounting a parcel, the config loading function must return a promise that resolves with the parcel config`
      )
    );
  }

  loadPromise = loadPromise.then((config) => {
    if (!config) {
      throw Error(
        formatErrorMessage(
          8,
          __DEV__ &&
            `When mounting a parcel, the config loading function returned a promise that did not resolve with a parcel config`
        )
      );
    }

    // 生成parcel名
    const name = config.name || `parcel-${id}`;

    // 校验配置的生命周期函数(bootstrap、mount、unmount、update)
    if (
      // ES Module objects don't have the object prototype
      Object.prototype.hasOwnProperty.call(config, "bootstrap") &&
      !validLifecycleFn(config.bootstrap)
    ) {
      throw Error(
        formatErrorMessage(
          9,
          __DEV__ && `Parcel ${name} provided an invalid bootstrap function`,
          name
        )
      );
    }

    if (!validLifecycleFn(config.mount)) {
      throw Error(
        formatErrorMessage(
          10,
          __DEV__ && `Parcel ${name} must have a valid mount function`,
          name
        )
      );
    }

    if (!validLifecycleFn(config.unmount)) {
      throw Error(
        formatErrorMessage(
          11,
          __DEV__ && `Parcel ${name} must have a valid unmount function`,
          name
        )
      );
    }

    if (config.update && !validLifecycleFn(config.update)) {
      throw Error(
        formatErrorMessage(
          12,
          __DEV__ && `Parcel ${name} provided an invalid update function`,
          name
        )
      );
    }

    // 生命周期函数如果是数组统一转换为Promise链式调用
    const bootstrap = flattenFnArray(config, "bootstrap");
    const mount = flattenFnArray(config, "mount");
    const unmount = flattenFnArray(config, "unmount");

    parcel.status = NOT_BOOTSTRAPPED; // 配置加载完成后变成未启动状态，和微应用一样
    parcel.name = name;
    parcel.bootstrap = bootstrap;
    parcel.mount = mount;
    parcel.unmount = unmount;
    parcel.timeouts = ensureValidAppTimeouts(config.timeouts);

    // 如果parcel有update函数，需要暴露出来，update函数是用户手动调用的，用来更新parcel的属性
    if (config.update) {
      parcel.update = flattenFnArray(config, "update");
      externalRepresentation.update = function (customProps) {
        parcel.customProps = customProps;

        return promiseWithoutReturnValue(toUpdatePromise(parcel));
      };
    }
  });

  // Start bootstrapping and mounting
  // The .then() causes the work to be put on the event loop instead of happening immediately
  // 启动parcel
  const bootstrapPromise = loadPromise.then(() =>
    toBootstrapPromise(parcel, true)
  );
  // 激活parcel
  const mountPromise = bootstrapPromise.then(() =>
    toMountPromise(parcel, true)
  );

  let resolveUnmount, rejectUnmount;

  // 反激活parcel
  const unmountPromise = new Promise((resolve, reject) => {
    resolveUnmount = resolve;
    rejectUnmount = reject;
  });

  externalRepresentation = {
    // mount一般不用手动调用，创建parcel时(mountRootParcel、mountParcel)会自动load、bootstrap、mount
    // 如果所属微应用unmount或者手动调用unmount之后需要重新激活就需要调用mount方法
    mount() {
      return promiseWithoutReturnValue(
        Promise.resolve().then(() => {
          if (parcel.status !== NOT_MOUNTED) {
            throw Error(
              formatErrorMessage(
                13,
                __DEV__ &&
                  `Cannot mount parcel '${name}' -- it is in a ${parcel.status} status`,
                name,
                parcel.status
              )
            );
          }

          // Add to owning app or parcel
          owningAppOrParcel.parcels[id] = parcel;
          
          // 激活微应用，调用过程与微应用一样
          return toMountPromise(parcel);
        })
      );
    },
    // 反激活parcel，一般用于mountRootParcel生成的parcel
    unmount() {
      return promiseWithoutReturnValue(parcel.unmountThisParcel());
    },
    getStatus() {
      return parcel.status;
    },
    // 分别对应parcel的4个阶段执行之后的回调，跟踪生命周期时很有用
    loadPromise: promiseWithoutReturnValue(loadPromise),
    bootstrapPromise: promiseWithoutReturnValue(bootstrapPromise),
    mountPromise: promiseWithoutReturnValue(mountPromise),
    unmountPromise: promiseWithoutReturnValue(unmountPromise),
  };

  return externalRepresentation;
}

// 将Promise的返回值转为null
function promiseWithoutReturnValue(promise) {
  return promise.then(() => null);
}
