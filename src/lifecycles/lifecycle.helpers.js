import { find } from "../utils/find.js";
import { objectType, toName } from "../applications/app.helpers.js";
import { formatErrorMessage } from "../applications/app-errors.js";

// 校验生命周期函数，可以是函数或者是函数数组
export function validLifecycleFn(fn) {
  return fn && (typeof fn === "function" || isArrayOfFns(fn));

  function isArrayOfFns(arr) {
    return (
      Array.isArray(arr) && !find(arr, (item) => typeof item !== "function")
    );
  }
}

// 将函数数组转换为Promise链式调用，即数组中的方法依次顺序调用，且后一个函数需要等前一个函数执行完成后再执行
export function flattenFnArray(appOrParcel, lifecycle) {
  let fns = appOrParcel[lifecycle] || [];
  fns = Array.isArray(fns) ? fns : [fns];
  if (fns.length === 0) {
    fns = [() => Promise.resolve()];
  }

  const type = objectType(appOrParcel);
  const name = toName(appOrParcel);

  return function (props) {
    return fns.reduce((resultPromise, fn, index) => {
      return resultPromise.then(() => {
        const thisPromise = fn(props);
        return smellsLikeAPromise(thisPromise)
          ? thisPromise
          : Promise.reject(
            formatErrorMessage(
              15,
              __DEV__ &&
              `Within ${type} ${name}, the lifecycle function ${lifecycle} at array index ${index} did not return a promise`,
              type,
              name,
              lifecycle,
              index
            )
          );
      });
    }, Promise.resolve());
  };
}

// 判断对象是否是Promise
export function smellsLikeAPromise(promise) {
  return (
    promise &&
    typeof promise.then === "function" &&
    typeof promise.catch === "function"
  );
}
