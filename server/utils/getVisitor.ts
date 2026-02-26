import { VisitorInterface } from "@rtsdk/topia";
import { Visitor } from "./topiaInit.js";
import { Credentials, VisitorDataObjectType } from "../types/index.js";
import { standardizeError } from "./standardizeError.js";

export const getVisitor = async (credentials: Credentials, shouldGetVisitorDetails = false) => {
  try {
    const { sceneDropId, urlSlug, visitorId } = credentials;

    let visitor: VisitorInterface;
    if (shouldGetVisitorDetails) visitor = await Visitor.get(visitorId, urlSlug, { credentials });
    else visitor = await Visitor.create(visitorId, urlSlug, { credentials });

    if (!visitor) throw "Not in world";

    const dataObject = (await visitor.fetchDataObject()) as VisitorDataObjectType;

    const lockId = `${sceneDropId}-${new Date(Math.round(new Date().getTime() / 60000) * 60000)}`;
    if (!dataObject) {
      await visitor.setDataObject(
        {
          [`${urlSlug}-${sceneDropId}`]: { dateStarted: new Date().getTime() },
        },
        { lock: { lockId, releaseLock: true } },
      );
    } else if (!dataObject[`${urlSlug}-${sceneDropId}`]) {
      await visitor.updateDataObject(
        { [`${urlSlug}-${sceneDropId}`]: { dateStarted: new Date().getTime() } },
        { lock: { lockId, releaseLock: true } },
      );
    }

    await visitor.fetchInventoryItems();
    let visitorInventory: { [key: string]: { id: string; icon: string; name: string } } = {};

    for (const visitorItem of visitor.inventoryItems) {
      const { id, status, item } = visitorItem;
      const { name, type, image_url = "" } = item || {};

      if (status === "ACTIVE" && type === "BADGE") {
        visitorInventory[name] = {
          id,
          icon: image_url,
          name,
        };
      }
    }

    return { visitor, visitorInventory };
  } catch (error) {
    throw standardizeError(error);
  }
};
