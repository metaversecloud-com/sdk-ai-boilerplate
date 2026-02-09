Use the SDK's WorldFactory to delete/remove Dropped Assets from within a world given an array of Dropped Asset ids, updates data object, and tracks analytics

```ts
/**
 * Handles removal of all dropped assets except the current asset from a world
 *
 * @returns Promise resolving to a success response or error handled by errorHandler
 */
import { Request, Response } from "express";
import { errorHandler, getCredentials, World } from "../../server/utils/index.js";

export const handleRemoveDroppedAssets = async (req: Request, res: Response): Promise<Record<string, any> | void> => {
  try {
    const credentials = getCredentials(req.query);
    const { assetId, urlSlug } = credentials;

    // Create a world instance using the Topia SDK
    const world = World.create(urlSlug, { credentials });

    // Fetch the world's data object to get current state
    await world.fetchDataObject();

    // Extract droppedAssetIds from world data with default empty array
    const { droppedAssetIds } = (world.dataObject as { droppedAssetIds: string[] }) || { droppedAssetIds: [] };

    if (droppedAssetIds.length > 0) {
      // Filter out the current assetId so that the Key Asset that opens the app is not removed from the world
      const ids = droppedAssetIds.filter((id: string) => id !== assetId);

      // Update the world data object and track analytics
      if (!world.dataObject) {
        // If dataObject doesn't exist yet, use setDataObject to initialize it
        await world.setDataObject({ droppedAssetIds: [] }, { analytics: [{ analyticName: `resets`, urlSlug }] });
      } else {
        // If dataObject exists, update it
        await world.updateDataObject({ droppedAssetIds: [] }, { analytics: [{ analyticName: `resets`, urlSlug }] });
      }

      // Use the static World.deleteDroppedAssets method to remove the assets
      // This should always be done last to ensure all functionality in this controller using credentials will work as expected.

      await World.deleteDroppedAssets(urlSlug, ids, process.env.INTERACTIVE_SECRET!, credentials);
    }

    return res.json({ success: true });
  } catch (error) {
    return errorHandler({
      error,
      functionName: "handleRemoveDroppedAssets",
      message: "Error removing dropped assets",
      req,
      res,
    });
  }
};
```
