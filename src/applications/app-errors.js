import { objectType, toName } from "./app.helpers";

// single-spa全局错误调用链
let errorHandlers = [];

// 出来应用程序错误，将错误输出到控制台，微应用切换到指定状态，并调用全局错误拦截函数
export function handleAppError(err, app, newStatus) {
  const transformedErr = transformErr(err, app, newStatus);

  if (errorHandlers.length) {
    errorHandlers.forEach((handler) => handler(transformedErr));
  } else {
    setTimeout(() => {
      throw transformedErr;
    });
  }
}

// 增加全局错误错误处理函数
export function addErrorHandler(handler) {
  if (typeof handler !== "function") {
    throw Error(
      formatErrorMessage(
        28,
        __DEV__ && "a single-spa error handler must be a function"
      )
    );
  }

  errorHandlers.push(handler);
}

// 移除错误处理函数
export function removeErrorHandler(handler) {
  if (typeof handler !== "function") {
    throw Error(
      formatErrorMessage(
        29,
        __DEV__ && "a single-spa error handler must be a function"
      )
    );
  }

  let removedSomething = false;
  errorHandlers = errorHandlers.filter((h) => {
    const isHandler = h === handler;
    removedSomething = removedSomething || isHandler;
    return !isHandler;
  });

  return removedSomething;
}

export function formatErrorMessage(code, msg, ...args) {
  return `single-spa minified message #${code}: ${
    msg ? msg + " " : ""
  }See https://single-spa.js.org/error/?code=${code}${
    args.length ? `&arg=${args.join("&arg=")}` : ""
  }`;
}

// 转换错误信息(统一app和parcel调用)在控制台输出，并将app和parcel切换到新的状态(一般是损坏状态)
export function transformErr(ogErr, appOrParcel, newStatus) {
  const errPrefix = `${objectType(appOrParcel)} '${toName(
    appOrParcel
  )}' died in status ${appOrParcel.status}: `;

  let result;

  if (ogErr instanceof Error) {
    try {
      ogErr.message = errPrefix + ogErr.message;
    } catch (err) {
      /* Some errors have read-only message properties, in which case there is nothing
       * that we can do.
       */
    }
    result = ogErr;
  } else {
    console.warn(
      formatErrorMessage(
        30,
        __DEV__ &&
          `While ${appOrParcel.status}, '${toName(
            appOrParcel
          )}' rejected its lifecycle function promise with a non-Error. This will cause stack traces to not be accurate.`,
        appOrParcel.status,
        toName(appOrParcel)
      )
    );
    try {
      result = Error(errPrefix + JSON.stringify(ogErr));
    } catch (err) {
      // If it's not an Error and you can't stringify it, then what else can you even do to it?
      result = ogErr;
    }
  }

  result.appOrParcelName = toName(appOrParcel);

  // We set the status after transforming the error so that the error message
  // references the state the application was in before the status change.
  appOrParcel.status = newStatus;

  return result;
}
