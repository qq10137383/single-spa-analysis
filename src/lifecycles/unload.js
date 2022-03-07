import {
  NOT_MOUNTED,
  UNLOADING,
  NOT_LOADED,
  LOAD_ERROR,
  SKIP_BECAUSE_BROKEN,
  toName,
} from "../applications/app.helpers.js";
import { handleAppError } from "../applications/app-errors.js";
import { reasonableTime } from "../applications/timeouts.js";

// 微应用卸载列表
const appsToUnload = {};

// 卸载微应用，卸载完成后状态变成NOT_LOADED，下次再激活需要重新加载、启动
export function toUnloadPromise(app) {
  return Promise.resolve().then(() => {
    const unloadInfo = appsToUnload[toName(app)];

    // 未在卸载列表中注册，忽略
    if (!unloadInfo) {
      /* No one has called unloadApplication for this app,
       */
      return app;
    }

    // 卸载未加载的微应用
    if (app.status === NOT_LOADED) {
      /* This app is already unloaded. We just need to clean up
       * anything that still thinks we need to unload the app.
       */
      finishUnloadingApp(app, unloadInfo);
      return app;
    }
    
    // 正在卸载的微应用不重复执行，直接返回
    if (app.status === UNLOADING) {
      /* Both unloadApplication and reroute want to unload this app.
       * It only needs to be done once, though.
       */
      return unloadInfo.promise.then(() => app);
    }

    // 仅仅处理反激活应用(toUnmountPromise执行完成之后)或者加载错误的微应用
    if (app.status !== NOT_MOUNTED && app.status !== LOAD_ERROR) {
      /* The app cannot be unloaded until it is unmounted.
       */
      return app;
    }

    // 加载错误的微应用不处理，反激活微应用执行unload生命周期函数
    const unloadPromise =
      app.status === LOAD_ERROR
        ? Promise.resolve()
        : reasonableTime(app, "unload");

    app.status = UNLOADING;

    // 执行微应用清理工作
    return unloadPromise
      .then(() => {
        finishUnloadingApp(app, unloadInfo);
        return app;
      })
      .catch((err) => {
        errorUnloadingApp(app, unloadInfo, err);
        return app;
      });
  });
}

// 清理微应用生命周期函数，状态改成NOT_LOADED，并从卸载列表清除
function finishUnloadingApp(app, unloadInfo) {
  delete appsToUnload[toName(app)];

  // Unloaded apps don't have lifecycles
  delete app.bootstrap;
  delete app.mount;
  delete app.unmount;
  delete app.unload;

  app.status = NOT_LOADED;

  /* resolve the promise of whoever called unloadApplication.
   * This should be done after all other cleanup/bookkeeping
   */
  unloadInfo.resolve();
}

function errorUnloadingApp(app, unloadInfo, err) {
  delete appsToUnload[toName(app)];

  // Unloaded apps don't have lifecycles
  delete app.bootstrap;
  delete app.mount;
  delete app.unmount;
  delete app.unload;

  handleAppError(err, app, SKIP_BECAUSE_BROKEN);
  unloadInfo.reject(err);
}

// 增加微应用到卸载列表
export function addAppToUnload(app, promiseGetter, resolve, reject) {
  appsToUnload[toName(app)] = { app, resolve, reject };
  Object.defineProperty(appsToUnload[toName(app)], "promise", {
    get: promiseGetter,
  });
}

export function getAppUnloadInfo(appName) {
  return appsToUnload[appName];
}
