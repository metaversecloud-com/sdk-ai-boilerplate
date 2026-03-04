import { IDroppedAsset } from "../../types/DroppedAssetTypes.js";
import { standardizeError } from "../standardizeError.js";

export const initializeDroppedAssetDataObject = async (droppedAsset: IDroppedAsset) => {
  try {
    if (!droppedAsset?.dataObject?.droppedAssetCount) {
      // adding a lockId and releaseLock will prevent race conditions and ensure the data object is being updated only once until either the time has passed or the operation is complete
      const lockId = `${droppedAsset.id}-${new Date(Math.round(new Date().getTime() / 60000) * 60000)}`;
      await droppedAsset
        .setDataObject({ droppedAssetCount: 0 }, { lock: { lockId, releaseLock: true } })
        .catch(() => console.warn("Unable to acquire lock, another process may be updating the data object"));
    }

    return;
  } catch (error: any) {
    throw standardizeError(error);
  }
};
