import {
  LOAD_ERROR,
  NOT_BOOTSTRAPPED,
  LOADING_SOURCE_CODE,
  SKIP_BECAUSE_BROKEN,
  NOT_LOADED,
  objectType,
  toName,
} from "../applications/app.helpers.js";
import { ensureValidAppTimeouts } from "../applications/timeouts.js";
import {
  handleAppError,
  formatErrorMessage,
} from "../applications/app-errors.js";
import {
  flattenFnArray,
  smellsLikeAPromise,
  validLifecycleFn,
} from "./lifecycle.helpers.js";
import { getProps } from "./prop.helpers.js";
import { assign } from "../utils/assign.js";

// 加载微应用
export function toLoadPromise(app) {
  return Promise.resolve().then(() => {
    // 1、多次调用toLoadPromise不会重复附加loadPromise
    // 2、如果正在加载则返回(并行的只加载一次)
    if (app.loadPromise) {
      return app.loadPromise;
    }

    // 仅处理未加载和加载超时的
    if (app.status !== NOT_LOADED && app.status !== LOAD_ERROR) {
      return app;
    }

    // 状态切换为加载中
    app.status = LOADING_SOURCE_CODE;

    let appOpts, isUserErr;

    return (app.loadPromise = Promise.resolve()
      .then(() => {
        // 调用微应用配置的加载脚本方法(通常使用System.js)加载脚本，
        // getProps获取微应用传递的自定义属性
        const loadPromise = app.loadApp(getProps(app));
        if (!smellsLikeAPromise(loadPromise)) {
          // The name of the app will be prepended to this error message inside of the handleAppError function
          // 标记错误是由于微应用脚本错误引起的，后续会进入损坏状态(SKIP_BECAUSE_BROKEN)，否则就是加载超时引起的，
          // 会进入LOAD_ERROR状态，下次再激活需要加载时会重试加载
          isUserErr = true;
          throw Error(
            formatErrorMessage(
              33,
              __DEV__ &&
                `single-spa loading function did not return a promise. Check the second argument to registerApplication('${toName(
                  app
                )}', loadingFunction, activityFunction)`,
              toName(app)
            )
          );
        }
        return loadPromise.then((val) => {
          app.loadErrorTime = null;

          // 微应用app函数返回生命周期函数
          appOpts = val;

          let validationErrMessage, validationErrCode;

          if (typeof appOpts !== "object") {
            validationErrCode = 34;
            if (__DEV__) {
              validationErrMessage = `does not export anything`;
            }
          }

          // 校验生命周期是否有bootstrap、mount、unmount函数
          if (
            // ES Modules don't have the Object prototype
            Object.prototype.hasOwnProperty.call(appOpts, "bootstrap") &&
            !validLifecycleFn(appOpts.bootstrap)
          ) {
            validationErrCode = 35;
            if (__DEV__) {
              validationErrMessage = `does not export a valid bootstrap function or array of functions`;
            }
          }

          if (!validLifecycleFn(appOpts.mount)) {
            validationErrCode = 36;
            if (__DEV__) {
              validationErrMessage = `does not export a mount function or array of functions`;
            }
          }

          if (!validLifecycleFn(appOpts.unmount)) {
            validationErrCode = 37;
            if (__DEV__) {
              validationErrMessage = `does not export a unmount function or array of functions`;
            }
          }

          // 获取类型，app或者是parcel，parcel有自卸载函数(unmountThisParcel)
          const type = objectType(appOpts);

          if (validationErrCode) {
            let appOptsStr;
            try {
              appOptsStr = JSON.stringify(appOpts);
            } catch {}
            console.error(
              formatErrorMessage(
                validationErrCode,
                __DEV__ &&
                  `The loading function for single-spa ${type} '${toName(
                    app
                  )}' resolved with the following, which does not have bootstrap, mount, and unmount functions`,
                type,
                toName(app),
                appOptsStr
              ),
              appOpts
            );
            handleAppError(validationErrMessage, app, SKIP_BECAUSE_BROKEN);
            return app;
          }

          if (appOpts.devtools && appOpts.devtools.overlays) {
            app.devtools.overlays = assign(
              {},
              app.devtools.overlays,
              appOpts.devtools.overlays
            );
          }

          // 微应用加载完成后，修改状态为“未启动”
          app.status = NOT_BOOTSTRAPPED;
          // 返回的生命周期函数可以是数组的(一个钩子多个回调，多个回调处理后是依次顺序执行，而且后一个必须等前一个执行完成之后才执行)
          app.bootstrap = flattenFnArray(appOpts, "bootstrap");
          app.mount = flattenFnArray(appOpts, "mount");
          app.unmount = flattenFnArray(appOpts, "unmount");
          app.unload = flattenFnArray(appOpts, "unload");
          app.timeouts = ensureValidAppTimeouts(appOpts.timeouts);

          // 加载完成，删除Promise，下次请求直接返回app
          delete app.loadPromise;

          return app;
        });
      })
      .catch((err) => {
        delete app.loadPromise;

        // 判断是否是因为微应用脚本错误引起的，如果是就将微应用设置为损坏状态(SKIP_BECAUSE_BROKEN)，
        // 否则就是超时引起的(LOAD_ERROR)
        let newStatus;
        if (isUserErr) {
          newStatus = SKIP_BECAUSE_BROKEN;
        } else {
          newStatus = LOAD_ERROR;
          app.loadErrorTime = new Date().getTime();
        }
        handleAppError(err, app, newStatus);

        return app;
      }));
  });
}
