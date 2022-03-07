import {
  NOT_MOUNTED,
  MOUNTED,
  SKIP_BECAUSE_BROKEN,
} from "../applications/app.helpers.js";
import { handleAppError, transformErr } from "../applications/app-errors.js";
import { reasonableTime } from "../applications/timeouts.js";
import CustomEvent from "custom-event";
import { toUnmountPromise } from "./unmount.js";

let beforeFirstMountFired = false;  // 第一个微应用激活前
let firstMountFired = false;  // 第一个微应用激活

// 激活微应用
export function toMountPromise(appOrParcel, hardFail) {
  return Promise.resolve().then(() => {
    // 仅仅NOT_MOUNTED状态才能激活
    if (appOrParcel.status !== NOT_MOUNTED) {
      return appOrParcel;
    }
    
    // single-spa第一个微应用激活触发此事件
    if (!beforeFirstMountFired) {
      window.dispatchEvent(new CustomEvent("single-spa:before-first-mount"));
      beforeFirstMountFired = true;
    }

    // 调用微应用mount函数
    return reasonableTime(appOrParcel, "mount")
      .then(() => {
        // 状态切换为已激活
        appOrParcel.status = MOUNTED;

        // single-spa第一个微应用激活触发此事件
        if (!firstMountFired) {
          window.dispatchEvent(new CustomEvent("single-spa:first-mount"));
          firstMountFired = true;
        }

        return appOrParcel;
      })
      .catch((err) => {
        // If we fail to mount the appOrParcel, we should attempt to unmount it before putting in SKIP_BECAUSE_BROKEN
        // We temporarily put the appOrParcel into MOUNTED status so that toUnmountPromise actually attempts to unmount it
        // instead of just doing a no-op.
        // 激活失败的微应用，切换为损坏(SKIP_BECAUSE_BROKEN)状态，在转换之前需要临时将微应用转为反激活,尝试调用unmount生命周期函数
        appOrParcel.status = MOUNTED;
        return toUnmountPromise(appOrParcel, true).then(
          setSkipBecauseBroken,
          setSkipBecauseBroken
        );
        
        // 切换为损坏状态后，错误信息会从控制台输出(died)，single-spa会触发全局错误拦截函数
        function setSkipBecauseBroken() {
          if (!hardFail) {
            handleAppError(err, appOrParcel, SKIP_BECAUSE_BROKEN);
            return appOrParcel;
          } else {
            throw transformErr(err, appOrParcel, SKIP_BECAUSE_BROKEN);
          }
        }
      });
  });
}
