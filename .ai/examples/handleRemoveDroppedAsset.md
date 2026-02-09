Use the SDK's DroppedAsset controller to remove/delete a Dropped Asset from within a world, trigger a particle effect, close an iframe, and send a toast message notification

```ts
/**
 * Example of removing a dropped asset with visual effects and user notifications
 * Demonstrates multiple SDK features: particle effects, dropped asset deletion, iframe closing, and toast messages
 *
 * @returns Promise resolving to success response or error handled by errorHandler
 */
import { Request, Response } from "express";
import { AxiosError } from "axios";
import { errorHandler, getCredentials, DroppedAsset, Visitor, World } from "../../server/utils/index.js";

export const handleRemoveDroppedAsset = async (req: Request, res: Response): Promise<Record<string, any> | void> => {
  try {
    const credentials = getCredentials(req.query);
    const { assetId, urlSlug, visitorId } = credentials;

    // Get the dropped asset to access its position and other properties
    const droppedAsset = await DroppedAsset.get(assetId, urlSlug, { credentials });
    const { position } = droppedAsset;

    // Create a world instance to trigger visual effects
    const world = World.create(urlSlug, { credentials });

    // Trigger a particle effect at the asset's position before deletion
    world.triggerParticle({
      name: "blackSmoke_puff",
      duration: 5,
      position,
    });

    // Create a visitor instance to handle user-facing actions
    const visitor = await Visitor.get(visitorId, urlSlug, { credentials });

    // Close the iframe associated with this asset
    visitor.closeIframe(assetId).catch((error: AxiosError) =>
      errorHandler({
        error,
        functionName: "handleRemoveDroppedAsset",
        message: "Error closing iframe",
      }),
    );

    // Send a toast notification to confirm the asset was removed
    visitor
      .fireToast({
        groupId: "RemoveDroppedAsset",
        title: "Dropped Asset Successfully Removed",
        text: "You have successfully removed this dropped asset from your world.",
      })
      .catch((error: AxiosError) =>
        errorHandler({
          error,
          functionName: "handleRemoveDroppedAsset",
          message: "Error firing toast",
        }),
      );

    // Delete the dropped asset from the world.
    // This should always be done last to ensure all functionality in this controller using credentials will work as expected.
    await droppedAsset.deleteDroppedAsset();

    return res.json({ success: true });
  } catch (error) {
    return errorHandler({
      error,
      functionName: "handleRemoveDroppedAsset",
      message: "Error removing dropping asset",
      req,
      res,
    });
  }
};
```
