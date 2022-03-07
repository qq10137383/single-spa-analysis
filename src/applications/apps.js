import { ensureJQuerySupport } from "../jquery-support.js";
import {
  isActive,
  toName,
  NOT_LOADED,
  NOT_BOOTSTRAPPED,
  NOT_MOUNTED,
  MOUNTED,
  LOAD_ERROR,
  SKIP_BECAUSE_BROKEN,
  LOADING_SOURCE_CODE,
  shouldBeActive,
} from "./app.helpers.js";
import { reroute } from "../navigation/reroute.js";
import { find } from "../utils/find.js";
import { toUnmountPromise } from "../lifecycles/unmount.js";
import {
  toUnloadPromise,
  getAppUnloadInfo,
  addAppToUnload,
} from "../lifecycles/unload.js";
import { formatErrorMessage } from "./app-errors.js";
import { isInBrowser } from "../utils/runtime-environment.js";
import { assign } from "../utils/assign";

const apps = [];

// 获取微应用状态(需要加载，需要激活，需要卸载，需要反激活)
// 1、当前需要激活的微应用 = 需要加载 + 需要激活
// 2、当前需要卸载的微应用 = 需要卸载
// 3、当前需要反激活的微应用 = 需要反激活 + 需要卸载
export function getAppChanges() {
  const appsToUnload = [],
    appsToUnmount = [],
    appsToLoad = [],
    appsToMount = [];

  // We re-attempt to download applications in LOAD_ERROR after a timeout of 200 milliseconds
  const currentTime = new Date().getTime();

  apps.forEach((app) => {
    // app当前是否应该激活(加载未失败而且当前路由满足子应用activeWhen)
    const appShouldBeActive =
      app.status !== SKIP_BECAUSE_BROKEN && shouldBeActive(app);

    switch (app.status) {
      // 当前需要激活但是上次加载错误的，而且时间间隔大于200ms的需要重新尝试加载
      case LOAD_ERROR:
        if (appShouldBeActive && currentTime - app.loadErrorTime >= 200) {
          appsToLoad.push(app);
        }
        break;
      // 当前需要激活但是还没有加载，或者正在加载源代码的，需要重新尝试加载
      case NOT_LOADED:
      case LOADING_SOURCE_CODE:
        if (appShouldBeActive) {
          appsToLoad.push(app);
        }
        break;
      // 加载完成的，但是没有启动或者激活的，放入待激活列表，如果是需要卸载的微应用(getAppUnloadInfo)
      // 放入待卸载列表(微应用反激活时不会进入卸载列表，只是标记已反激活(NOT_MOUNTED)，
      // 只有手动调用single-spa卸载方法(unloadApplication)才会被卸载，下次如果重新激活需要重新加载、启动)
      case NOT_BOOTSTRAPPED:
      case NOT_MOUNTED:
        if (!appShouldBeActive && getAppUnloadInfo(toName(app))) {
          appsToUnload.push(app);
        } else if (appShouldBeActive) {
          appsToMount.push(app);
        }
        break;
      // 已激活的，但是当前不是处于激活状态的，需要反激活
      case MOUNTED:
        if (!appShouldBeActive) {
          appsToUnmount.push(app);
        }
        break;
      // all other statuses are ignored
    }
  });

  return { appsToUnload, appsToUnmount, appsToLoad, appsToMount };
}

// 获取已激活的微应用名
export function getMountedApps() {
  return apps.filter(isActive).map(toName);
}

// 获取所有的微应用名
export function getAppNames() {
  return apps.map(toName);
}

// used in devtools, not (currently) exposed as a single-spa API
export function getRawAppData() {
  return [...apps];
}

// 获取微应用状态
export function getAppStatus(appName) {
  const app = find(apps, (app) => toName(app) === appName);
  return app ? app.status : null;
}

// 注册微应用信息
export function registerApplication(
  appNameOrConfig,
  appOrLoadApp,
  activeWhen,
  customProps
) {
  // 规范化参数
  const registration = sanitizeArguments(
    appNameOrConfig,
    appOrLoadApp,
    activeWhen,
    customProps
  );

  // 判断是否已注册过
  if (getAppNames().indexOf(registration.name) !== -1)
    throw Error(
      formatErrorMessage(
        21,
        __DEV__ &&
          `There is already an app registered with name ${registration.name}`,
        registration.name
      )
    );
    
  // 增加额外的注册信息
  apps.push(
    assign(
      {
        loadErrorTime: null, //上次加载错误的时间
        status: NOT_LOADED, //微应用状态
        parcels: {}, //微应用的子应用
        devtools: { // 开发工具相关
          overlays: {
            options: {},
            selectors: [],
          },
        },
      },
      registration
    )
  );
  
  // 浏览器模式下，启用jquery支持，并重新激活路由(微应用切换加载)
  if (isInBrowser) {
    ensureJQuerySupport();
    reroute();
  }
}

// 获取当前应用激活的微应用
export function checkActivityFunctions(location = window.location) {
  return apps.filter((app) => app.activeWhen(location)).map(toName);
}

// 反注册微应用(先调用卸载方法(unloadApplication)卸载完成清除注册信息)
export function unregisterApplication(appName) {
  if (apps.filter((app) => toName(app) === appName).length === 0) {
    throw Error(
      formatErrorMessage(
        25,
        __DEV__ &&
          `Cannot unregister application '${appName}' because no such application has been registered`,
        appName
      )
    );
  }

  return unloadApplication(appName).then(() => {
    const appIndex = apps.map(toName).indexOf(appName);
    apps.splice(appIndex, 1);
  });
}

// 卸载微应用，卸载后微应用状态变成NOT_LOADED，但微应用注册信息还在，下次再激活需要重新加载、启动
export function unloadApplication(appName, opts = { waitForUnmount: false }) {
  if (typeof appName !== "string") {
    throw Error(
      formatErrorMessage(
        26,
        __DEV__ && `unloadApplication requires a string 'appName'`
      )
    );
  }
  const app = find(apps, (App) => toName(App) === appName);
  if (!app) {
    throw Error(
      formatErrorMessage(
        27,
        __DEV__ &&
          `Could not unload application '${appName}' because no such application has been registered`,
        appName
      )
    );
  }

  const appUnloadInfo = getAppUnloadInfo(toName(app));
  // waitForUnmount设置为true，则需要等待应用反激活时由reroute方法卸载
  // 这里仅仅只调用addAppToUnload将微应用注册到卸载列表
  // waitForUnmount设置为false，则立即直接卸载(先执行反激活，再执行卸载)
  if (opts && opts.waitForUnmount) {
    // We need to wait for unmount before unloading the app

    // 如果微应用已经在卸载列表注册过，直接返回
    if (appUnloadInfo) {
      // Someone else is already waiting for this, too
      return appUnloadInfo.promise;
    } else {
      // We're the first ones wanting the app to be resolved.
      // 注册到卸载列表
      const promise = new Promise((resolve, reject) => {
        addAppToUnload(app, () => promise, resolve, reject);
      });
      return promise;
    }
  } else {
    /* We should unmount the app, unload it, and remount it immediately.
     */

    let resultPromise;

    // 微应用已在卸载列表注册过，说明卸载调用了多次，这次直接卸载
    if (appUnloadInfo) {
      // Someone else is already waiting for this app to unload
      resultPromise = appUnloadInfo.promise;
      immediatelyUnloadApp(app, appUnloadInfo.resolve, appUnloadInfo.reject);
    } else {
      // We're the first ones wanting the app to be resolved.
      // 微应用注册到卸载列表(有必要，因为toUnloadPromise卸载方法统一从卸载列表读取信息)，然后立即卸载
      resultPromise = new Promise((resolve, reject) => {
        addAppToUnload(app, () => resultPromise, resolve, reject);
        immediatelyUnloadApp(app, resolve, reject);
      });
    }

    return resultPromise;
  }
}

// 卸载微应用，先执行反激活，再执行卸载，卸载完成后需要重新切换新的微应用
function immediatelyUnloadApp(app, resolve, reject) {
  toUnmountPromise(app)
    .then(toUnloadPromise)
    .then(() => {
      resolve();
      setTimeout(() => {
        // reroute, but the unload promise is done
        reroute();
      });
    })
    .catch(reject);
}

// 校验注册参数(分参数传递)
function validateRegisterWithArguments(
  name,
  appOrLoadApp,
  activeWhen,
  customProps
) {
  if (typeof name !== "string" || name.length === 0)
    throw Error(
      formatErrorMessage(
        20,
        __DEV__ &&
          `The 1st argument to registerApplication must be a non-empty string 'appName'`
      )
    );

  if (!appOrLoadApp)
    throw Error(
      formatErrorMessage(
        23,
        __DEV__ &&
          "The 2nd argument to registerApplication must be an application or loading application function"
      )
    );

  if (typeof activeWhen !== "function")
    throw Error(
      formatErrorMessage(
        24,
        __DEV__ &&
          "The 3rd argument to registerApplication must be an activeWhen function"
      )
    );

  if (!validCustomProps(customProps))
    throw Error(
      formatErrorMessage(
        22,
        __DEV__ &&
          "The optional 4th argument is a customProps and must be an object"
      )
    );
}

// 校验注册参数(由大配置对象config传递)
export function validateRegisterWithConfig(config) {
  if (Array.isArray(config) || config === null)
    throw Error(
      formatErrorMessage(
        39,
        __DEV__ && "Configuration object can't be an Array or null!"
      )
    );
  const validKeys = ["name", "app", "activeWhen", "customProps"];
  const invalidKeys = Object.keys(config).reduce(
    (invalidKeys, prop) =>
      validKeys.indexOf(prop) >= 0 ? invalidKeys : invalidKeys.concat(prop),
    []
  );
  if (invalidKeys.length !== 0)
    throw Error(
      formatErrorMessage(
        38,
        __DEV__ &&
          `The configuration object accepts only: ${validKeys.join(
            ", "
          )}. Invalid keys: ${invalidKeys.join(", ")}.`,
        validKeys.join(", "),
        invalidKeys.join(", ")
      )
    );
  if (typeof config.name !== "string" || config.name.length === 0)
    throw Error(
      formatErrorMessage(
        20,
        __DEV__ &&
          "The config.name on registerApplication must be a non-empty string"
      )
    );
  if (typeof config.app !== "object" && typeof config.app !== "function")
    throw Error(
      formatErrorMessage(
        20,
        __DEV__ &&
          "The config.app on registerApplication must be an application or a loading function"
      )
    );
  const allowsStringAndFunction = (activeWhen) =>
    typeof activeWhen === "string" || typeof activeWhen === "function";
  if (
    !allowsStringAndFunction(config.activeWhen) &&
    !(
      Array.isArray(config.activeWhen) &&
      config.activeWhen.every(allowsStringAndFunction)
    )
  )
    throw Error(
      formatErrorMessage(
        24,
        __DEV__ &&
          "The config.activeWhen on registerApplication must be a string, function or an array with both"
      )
    );
  if (!validCustomProps(config.customProps))
    throw Error(
      formatErrorMessage(
        22,
        __DEV__ && "The optional config.customProps must be an object"
      )
    );
}

// 校验注册参数中的自定义属性
function validCustomProps(customProps) {
  return (
    !customProps ||
    typeof customProps === "function" ||
    (typeof customProps === "object" &&
      customProps !== null &&
      !Array.isArray(customProps))
  );
}

// 解析参数，第一个参数appNameOrConfig如果是对象，说明是传入的对象参数，所有信息从第一个参数解析
// 否则是分开传参数，分别解析
function sanitizeArguments(
  appNameOrConfig,
  appOrLoadApp,
  activeWhen,
  customProps
) {
  const usingObjectAPI = typeof appNameOrConfig === "object";

  const registration = {
    name: null,
    loadApp: null,
    activeWhen: null,
    customProps: null,
  };

  if (usingObjectAPI) {
    validateRegisterWithConfig(appNameOrConfig);
    registration.name = appNameOrConfig.name;
    registration.loadApp = appNameOrConfig.app;
    registration.activeWhen = appNameOrConfig.activeWhen;
    registration.customProps = appNameOrConfig.customProps;
  } else {
    validateRegisterWithArguments(
      appNameOrConfig,
      appOrLoadApp,
      activeWhen,
      customProps
    );
    registration.name = appNameOrConfig;
    registration.loadApp = appOrLoadApp;
    registration.activeWhen = activeWhen;
    registration.customProps = customProps;
  }

  registration.loadApp = sanitizeLoadApp(registration.loadApp);
  registration.customProps = sanitizeCustomProps(registration.customProps);
  registration.activeWhen = sanitizeActiveWhen(registration.activeWhen);

  return registration;
}

// loadApp函数转为Promise
function sanitizeLoadApp(loadApp) {
  if (typeof loadApp !== "function") {
    return () => Promise.resolve(loadApp);
  }

  return loadApp;
}

// 设置注册参数自定义属性的默认值
function sanitizeCustomProps(customProps) {
  return customProps ? customProps : {};
}

// 转换激活函数activeWhen
function sanitizeActiveWhen(activeWhen) {
  let activeWhenArray = Array.isArray(activeWhen) ? activeWhen : [activeWhen];
  activeWhenArray = activeWhenArray.map((activeWhenOrPath) =>
    typeof activeWhenOrPath === "function"
      ? activeWhenOrPath
      : pathToActiveWhen(activeWhenOrPath)
  );

  return (location) =>
    activeWhenArray.some((activeWhen) => activeWhen(location));
}

export function pathToActiveWhen(path, exactMatch) {
  const regex = toDynamicPathValidatorRegex(path, exactMatch);

  return (location) => {
    // compatible with IE10
    let origin = location.origin;
    if (!origin) {
      origin = `${location.protocol}//${location.host}`;
    }
    const route = location.href
      .replace(origin, "")
      .replace(location.search, "")
      .split("?")[0];
    return regex.test(route);
  };
}

function toDynamicPathValidatorRegex(path, exactMatch) {
  let lastIndex = 0,
    inDynamic = false,
    regexStr = "^";

  if (path[0] !== "/") {
    path = "/" + path;
  }

  for (let charIndex = 0; charIndex < path.length; charIndex++) {
    const char = path[charIndex];
    const startOfDynamic = !inDynamic && char === ":";
    const endOfDynamic = inDynamic && char === "/";
    if (startOfDynamic || endOfDynamic) {
      appendToRegex(charIndex);
    }
  }

  appendToRegex(path.length);
  return new RegExp(regexStr, "i");

  function appendToRegex(index) {
    const anyCharMaybeTrailingSlashRegex = "[^/]+/?";
    const commonStringSubPath = escapeStrRegex(path.slice(lastIndex, index));

    regexStr += inDynamic
      ? anyCharMaybeTrailingSlashRegex
      : commonStringSubPath;

    if (index === path.length) {
      if (inDynamic) {
        if (exactMatch) {
          // Ensure exact match paths that end in a dynamic portion don't match
          // urls with characters after a slash after the dynamic portion.
          regexStr += "$";
        }
      } else {
        // For exact matches, expect no more characters. Otherwise, allow
        // any characters.
        const suffix = exactMatch ? "" : ".*";

        regexStr =
          // use charAt instead as we could not use es6 method endsWith
          regexStr.charAt(regexStr.length - 1) === "/"
            ? `${regexStr}${suffix}$`
            : `${regexStr}(/${suffix})?(#.*)?$`;
      }
    }

    inDynamic = !inDynamic;
    lastIndex = index;
  }

  function escapeStrRegex(str) {
    // borrowed from https://github.com/sindresorhus/escape-string-regexp/blob/master/index.js
    return str.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
  }
}
