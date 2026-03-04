import { Credentials } from "../types/Credentials.js";
import { errorHandler } from "./errorHandler.js";

export const getCredentials = (query: any): Credentials => {
  try {
    const requiredFields = ["interactiveNonce", "interactivePublicKey", "urlSlug", "visitorId"];
    const missingFields = requiredFields.filter((variable) => !query[variable]);
    if (missingFields.length > 0) {
      throw `Missing required parameters: ${missingFields.join(", ")}`;
    }

    if (process.env.INTERACTIVE_KEY !== query.interactivePublicKey) {
      throw "Provided public key does not match";
    }

    return {
      assetId: query.assetId as string,
      displayName: query.displayName as string,
      identityId: query.identityId as string,
      interactiveNonce: query.interactiveNonce as string,
      interactivePublicKey: query.interactivePublicKey as string,
      profileId: query.profileId as string,
      sceneDropId: query.sceneDropId as string,
      uniqueName: query.uniqueName as string,
      urlSlug: query.urlSlug as string,
      username: query.username as string,
      visitorId: Number(query.visitorId),
    };
  } catch (error) {
    return errorHandler({
      error,
      functionName: "getCredentials",
      message: "Error getting credentials from query.",
    });
  }
};
