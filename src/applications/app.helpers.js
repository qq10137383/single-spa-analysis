import { handleAppError } from "./app-errors.js";

// App statuses
// 微应用状态变化： 
//    NOT_LOADED(未载入，初始状态) 
// -> LOADING_SOURCE_CODE(正在载入toLoadPromise调用时)
// -> NOT_BOOTSTRAPPED(载入完成未启动，toLoadPromise调用后)
// -> BOOTSTRAPPING(启动中，toBootstrapPromise调用时)
// -> NOT_MOUNTED(启动完成未激活，toBootstrapPromise调用后)
// -> MOUNTING(正在激活，toMountPromise调用时)
// -> MOUNTED(已激活，toMountPromise调用后)
// -> UPDATING(更新，仅处于MOUNTED的Parcel才会有的状态，由parcel.update方法手动触发，不会自动进入此状态)
// -> UNMOUNTING(正在反激活，toUnmountPromise调用时)，toUnmountPromise调用后重新进入NOT_MOUNTED状态
// -> UNLOADING(正在卸载，toUnloadPromise调用时，由singlespa.unloadApplication方法手动触发，不会自动进入此状态)，
//    toUnloadPromise调用后重新进入NOT_LOADED状态
// 
// 
// LOAD_ERROR: toLoadPromise由于超时获取失败时，会从LOADING_SOURCE_CODE进入LOAD_ERROR，下次再加载会重试，成功后进入NOT_BOOTSTRAPPED状态
// SKIP_BECAUSE_BROKEN: 以上所有方法(toBootstrapPromise、toMountPromise等等)执行失败都会进入此状态，toLoadPromise有点特殊，仅用户脚本错误
// 非超时失败时会进入此状态(超时会进入LOAD_ERROR)，进入此状态的微应用下次激活时会因为是已损坏而被忽略
//
export const NOT_LOADED = "NOT_LOADED";
export const LOADING_SOURCE_CODE = "LOADING_SOURCE_CODE";
export const NOT_BOOTSTRAPPED = "NOT_BOOTSTRAPPED";
export const BOOTSTRAPPING = "BOOTSTRAPPING";
export const NOT_MOUNTED = "NOT_MOUNTED";
export const MOUNTING = "MOUNTING";
export const MOUNTED = "MOUNTED";
export const UPDATING = "UPDATING";
export const UNMOUNTING = "UNMOUNTING";
export const UNLOADING = "UNLOADING";
export const LOAD_ERROR = "LOAD_ERROR";
export const SKIP_BECAUSE_BROKEN = "SKIP_BECAUSE_BROKEN";

// 是否已激活
export function isActive(app) {
  return app.status === MOUNTED;
}

// activeWhen判断微应用是否应该激活
export function shouldBeActive(app) {
  try {
    return app.activeWhen(window.location);
  } catch (err) {
    handleAppError(err, app, SKIP_BECAUSE_BROKEN);
    return false;
  }
}

// 获取微应用名字
export function toName(app) {
  return app.name;
}

// 判断是否是Parcel，Parcel与App不同的是parcel有自反激活函数(unmountThisParcel)
export function isParcel(appOrParcel) {
  return Boolean(appOrParcel.unmountThisParcel);
}

// 判断是微应用(app)还是parcel，parcel可以作为app的一部分而存在，也可以单独存在，
// parcel和app不同的地方是没有激活函数(activeWhen)，需要手动加载(mountParcel,mountRootParcel)
// 1、通过app.mountParcel加载的parcel，会随着app的反激活而自动反激活。
// 2、通过singleSpa.mountRootParcel加载的parcel，是独立存在的，需要手动调用parcel.unmount反激活
export function objectType(appOrParcel) {
  return isParcel(appOrParcel) ? "parcel" : "application";
}
