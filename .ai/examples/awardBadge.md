Use the SDK to grant inventory items (badges) and display toast notifications.

**Important — `User.create` requires `profileId`**: When a user acts on their own behalf, `profileId` is already in the credentials from `req.query`. When a user triggers an action that impacts another user (e.g., an admin awarding a badge to a visitor), you must override `profileId` with the recipient's profile ID:

```ts
// Self — profileId comes from req.query credentials automatically
const user = await User.create({ credentials });

// Cross-user — override profileId with the recipient's
const recipientUser = await User.create({
  credentials: { ...credentials, profileId: recipientProfileId },
});
```

## Visitor Earning Their Own Badge

```ts
/**
 * Utility function to award a badge to a visitor if they don't already have it
 *
 * @param credentials - Topia credentials for API authentication
 * @param visitor - The visitor instance to award the badge to
 * @param visitorInventory - The visitor's current inventory containing badges
 * @param badgeName - The name of the badge to award
 * @returns Promise resolving to success status or standardized error
 */
import { Credentials } from "../../server/types/Credentials.ts";
import { getCachedInventoryItems, standardizeError } from "../../server/utils/index.ts";

export const awardBadge = async ({
  credentials,
  visitor,
  visitorInventory,
  badgeName,
}: {
  credentials: Credentials;
  visitor: any;
  visitorInventory: any;
  badgeName: string;
}) => {
  try {
    // Check if the visitor already has this badge to avoid duplicate awards
    if (visitorInventory.badges[badgeName]) return { success: true };

    // Fetch available inventory items from the ecosystem
    const inventoryItems = await getCachedInventoryItems({ credentials });

    // Find the specific badge in the inventory items
    const inventoryItem = inventoryItems?.find((item) => item.name === badgeName);
    if (!inventoryItem) throw new Error(`Inventory item ${badgeName} not found in ecosystem`);

    // Grant the inventory item (badge) to the visitor using the SDK
    await visitor.grantInventoryItem(inventoryItem, 1);

    // Display a toast notification to the visitor about their new badge
    await visitor
      .fireToast({
        title: "Badge Awarded",
        text: `You have earned the ${badgeName} badge!`,
      })
      .catch(() => console.error(`Failed to fire toast after awarding the ${badgeName} badge.`));

    return { success: true };
  } catch (error: any) {
    return standardizeError(error);
  }
};
```

## Admin Awarding a Badge to Another User

When one user (e.g., an admin) awards a badge to a different user, use `User.create` with the recipient's `profileId` overriding the credentials. The admin's `profileId` is in `req.query` credentials; the recipient's `profileId` must be passed as a parameter.

```ts
import { Credentials } from "../types/index.js";
import { getCachedInventoryItems, standardizeError } from "../utils/index.js";
import { User, Visitor } from "./topiaInit.js";

export const awardBadgeToVisitor = async ({
  credentials,
  recipientVisitorId,
  recipientProfileId,
  badgeName,
  comment,
}: {
  credentials: Credentials;
  recipientVisitorId: number;
  recipientProfileId: string;
  badgeName: string;
  comment?: string;
}) => {
  try {
    const { urlSlug } = credentials;

    const inventoryItems = await getCachedInventoryItems({ credentials });
    const inventoryItem = inventoryItems?.find((item) => item.name === badgeName && item.type === "BADGE");
    if (!inventoryItem) throw new Error(`Badge "${badgeName}" not found in ecosystem inventory`);

    // User.create with recipient's profileId (cross-user action)
    const recipientUser = await User.create({
      credentials: { ...credentials, profileId: recipientProfileId },
    });

    // Visitor for toast/particle effects
    const recipientVisitor = await Visitor.create(recipientVisitorId, urlSlug, { credentials });

    // Grant the badge via User (not Visitor)
    await recipientUser.grantInventoryItem(inventoryItem, 1);

    // Fire-and-forget: toast notification
    recipientVisitor
      .fireToast({
        groupId: "badges",
        title: `You unlocked the ${badgeName} badge!`,
        text: comment || "",
      })
      .catch(() => console.error(`Failed to fire toast for ${badgeName} badge`));

    return { success: true };
  } catch (error: any) {
    throw standardizeError(error);
  }
};
```
