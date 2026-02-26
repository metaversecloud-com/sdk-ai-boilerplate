import { Request, Response } from "express";
import { errorHandler, getCredentials, getDroppedAsset, Visitor, World } from "../utils/index.js";
import { VisitorInterface } from "@rtsdk/topia";
import axios from "axios";

export const handleGetGameState = async (req: Request, res: Response) => {
  try {
    const credentials = getCredentials(req.query);
    const { assetId, displayName, interactiveNonce, interactivePublicKey, profileId, urlSlug, visitorId } = credentials;

    const droppedAsset = await getDroppedAsset(credentials);

    const world = World.create(urlSlug, { credentials });
    world.triggerParticle({ name: "Sparkle", duration: 3, position: droppedAsset.position }).catch((error: any) =>
      errorHandler({
        error,
        functionName: "handleGetGameState",
        message: "Error triggering particle effects",
      }),
    );

    const { visitor } = await getVisitor(credentials, true);
    const { isAdmin } = visitor;

    try {
      await axios.post(
        `${process.env.LEADERBOARD_BASE_URL || "http://v2lboard0-prod-topia.topia-rtsdk.com"}/api/dropped-asset/increment-player-stats?assetId=${assetId}&displayName=${displayName}&interactiveNonce=${interactiveNonce}&interactivePublicKey=${interactivePublicKey}&profileId=${profileId}&urlSlug=${urlSlug}&visitorId=${visitorId}`,
        {
          publicKey: interactivePublicKey,
          secret: process.env.INTERACTIVE_SECRET,
          profileId,
          displayName,
          incrementBy: 1,
        },
      );
    } catch (error) {
      errorHandler({
        error,
        functionName: "handleGetGameState",
        message: "Error posting player stats to Leaderboard",
      });
    }

    await world.fireToast({ title: "Nice Work!", text: "You've successfully completed the task!" }).catch((error) =>
      errorHandler({
        error,
        functionName: "handleGetGameState",
        message: "Error firing toast in world",
      }),
    );

    return res.json({ droppedAsset, isAdmin, success: true });
  } catch (error) {
    return errorHandler({
      error,
      functionName: "getDroppedAssetDetails",
      message: "Error getting dropped asset instance and data object",
      req,
      res,
    });
  }
};
