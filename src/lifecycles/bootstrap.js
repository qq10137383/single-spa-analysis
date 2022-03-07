import {
  NOT_BOOTSTRAPPED,
  BOOTSTRAPPING,
  NOT_MOUNTED,
  SKIP_BECAUSE_BROKEN,
} from "../applications/app.helpers.js";
import { reasonableTime } from "../applications/timeouts.js";
import { handleAppError, transformErr } from "../applications/app-errors.js";

// 启动微应用
export function toBootstrapPromise(appOrParcel, hardFail) {
  return Promise.resolve().then(() => {
    // toLoadPromise加载微应用脚本，加载完成后app.status设置为NOT_BOOTSTRAPPED
    // status不为NOT_BOOTSTRAPPED说明微应用未加载(not_loaded)或已经mounted、unmouted，不会重新执行bootstrap函数
    if (appOrParcel.status !== NOT_BOOTSTRAPPED) {
      return appOrParcel;
    }

    //  设置状态为正在加载
    appOrParcel.status = BOOTSTRAPPING;

    // 微应用没有启动函数(bootstrap)，则执行默认的启动函数(将状态设置为Not_Mounted)
    if (!appOrParcel.bootstrap) {
      // Default implementation of bootstrap
      return Promise.resolve().then(successfulBootstrap);
    }

    // 执行微应用的bootstrap函数，执行完成后将状态设置为Not_Mounted
    return reasonableTime(appOrParcel, "bootstrap")
      .then(successfulBootstrap)
      .catch((err) => {
        if (hardFail) {
          throw transformErr(err, appOrParcel, SKIP_BECAUSE_BROKEN);
        } else {
          handleAppError(err, appOrParcel, SKIP_BECAUSE_BROKEN);
          return appOrParcel;
        }
      });
  });

  // Bootstrap之后设置状态为NOT_MOUNTED
  function successfulBootstrap() {
    appOrParcel.status = NOT_MOUNTED;
    return appOrParcel;
  }
}
