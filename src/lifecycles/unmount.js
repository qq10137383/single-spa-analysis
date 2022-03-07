import {
  UNMOUNTING,
  NOT_MOUNTED,
  MOUNTED,
  SKIP_BECAUSE_BROKEN,
} from "../applications/app.helpers.js";
import { handleAppError, transformErr } from "../applications/app-errors.js";
import { reasonableTime } from "../applications/timeouts.js";

// 微应用反激活
export function toUnmountPromise(appOrParcel, hardFail) {
  return Promise.resolve().then(() => {
     // 仅仅MOUNTED状态才能反激活
    if (appOrParcel.status !== MOUNTED) {
      return appOrParcel;
    }
    // 状态转为反激活中
    appOrParcel.status = UNMOUNTING;

    // 微应用所有的parcel执行反激活(通过app.mountParcel添加的parcel会放到app.parcels中，微应用反激活时parcels也会执行反激活，
    // 通过singleSpa.mountRootParcel添加的parcel不会，它是独立于app存放的)
    const unmountChildrenParcels = Object.keys(
      appOrParcel.parcels
    ).map((parcelId) => appOrParcel.parcels[parcelId].unmountThisParcel());

    let parcelError;
    
    // parcels执行反激活后，执行微应用的反激活
    return Promise.all(unmountChildrenParcels)
      .then(unmountAppOrParcel, (parcelError) => {
        // There is a parcel unmount error
        return unmountAppOrParcel().then(() => {
          // Unmounting the app/parcel succeeded, but unmounting its children parcels did not
          const parentError = Error(parcelError.message);
          if (hardFail) {
            throw transformErr(parentError, appOrParcel, SKIP_BECAUSE_BROKEN);
          } else {
            handleAppError(parentError, appOrParcel, SKIP_BECAUSE_BROKEN);
          }
        });
      })
      .then(() => appOrParcel);
    
    // 执行微应用或parcel的unmount生命周期函数，状态设置为NOT_MOUNTED
    function unmountAppOrParcel() {
      // We always try to unmount the appOrParcel, even if the children parcels failed to unmount.
      return reasonableTime(appOrParcel, "unmount")
        .then(() => {
          // The appOrParcel needs to stay in a broken status if its children parcels fail to unmount
          if (!parcelError) {
            appOrParcel.status = NOT_MOUNTED;
          }
        })
        .catch((err) => {
          if (hardFail) {
            throw transformErr(err, appOrParcel, SKIP_BECAUSE_BROKEN);
          } else {
            handleAppError(err, appOrParcel, SKIP_BECAUSE_BROKEN);
          }
        });
    }
  });
}
