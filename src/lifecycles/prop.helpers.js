import * as singleSpa from "../single-spa.js";
import { mountParcel } from "../parcels/mount-parcel.js";
import { assign } from "../utils/assign.js";
import { isParcel, toName } from "../applications/app.helpers.js";
import { formatErrorMessage } from "../applications/app-errors.js";

// 获取微应用配置中的自定义属性
export function getProps(appOrParcel) {
  const name = toName(appOrParcel);
  // 获取自定义属性
  let customProps =
    typeof appOrParcel.customProps === "function"
      ? appOrParcel.customProps(name, window.location)
      : appOrParcel.customProps;
  if (
    typeof customProps !== "object" ||
    customProps === null ||
    Array.isArray(customProps)
  ) {
    customProps = {};
    console.warn(
      formatErrorMessage(
        40,
        __DEV__ &&
          `single-spa: ${name}'s customProps function must return an object. Received ${customProps}`
      ),
      name,
      customProps
    );
  }
  // 合并挂载方法(mountParcel)、singlespa全局对象
  const result = assign({}, customProps, {
    name,
    mountParcel: mountParcel.bind(appOrParcel),
    singleSpa,
  });
  // 如果是parcel，需要混入卸载方法(unmountSelf)(疑问？parcel没有加载函数(toLoadPromise)，是直接在配置中传入的，不会调用这个方法)
  if (isParcel(appOrParcel)) {
    result.unmountSelf = appOrParcel.unmountThisParcel;
  }

  return result;
}
