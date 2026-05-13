import { IDroppedAsset } from "../../types/DroppedAssetTypes.js";
import { standardizeError } from "../standardizeError.js";

export const initializeDroppedAssetDataObject = async (droppedAsset: IDroppedAsset) => {
  try {
    await droppedAsset.fetchDataObject();

    if (!droppedAsset?.dataObject?.leaderboard) {
      const lockId = `${droppedAsset.id}-${new Date(Math.round(new Date().getTime() / 60000) * 60000)}`;
      await droppedAsset
        .setDataObject({ leaderboard: {} }, { lock: { lockId, releaseLock: true } })
        .catch(() => console.warn("Unable to acquire lock, another process may be updating the data object"));

      await droppedAsset.fetchDataObject();
    }

    return;
  } catch (error: any) {
    throw standardizeError(error);
  }
};
