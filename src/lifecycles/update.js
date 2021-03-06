import {
  UPDATING,
  MOUNTED,
  SKIP_BECAUSE_BROKEN,
  toName,
} from "../applications/app.helpers.js";
import {
  transformErr,
  formatErrorMessage,
} from "../applications/app-errors.js";
import { reasonableTime } from "../applications/timeouts.js";

// 执行parcel的update生命周期函数(仅激活状态，由parcel.update方法手动触发，不会自动进入此状态)
export function toUpdatePromise(parcel) {
  return Promise.resolve().then(() => {
    if (parcel.status !== MOUNTED) {
      throw Error(
        formatErrorMessage(
          32,
          __DEV__ &&
            `Cannot update parcel '${toName(
              parcel
            )}' because it is not mounted`,
          toName(parcel)
        )
      );
    }

    parcel.status = UPDATING;

    return reasonableTime(parcel, "update")
      .then(() => {
        parcel.status = MOUNTED;
        return parcel;
      })
      .catch((err) => {
        throw transformErr(err, parcel, SKIP_BECAUSE_BROKEN);
      });
  });
}
