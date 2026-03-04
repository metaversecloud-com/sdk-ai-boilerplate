# Experience Points (XP) via Inventory

Use the "Experience Points" ecosystem inventory item to track and grant XP to visitors. XP is stored as the item's quantity in the visitor's inventory, making it the single source of truth — never store XP in data objects.

> **Important**: When prompted to add an inventory system and Experience Points are not explicitly mentioned, ask the user if they want Experience Points added to the ecosystem and integrated into the app.

## When to Use

Add Experience Points when your app needs to:

- Reward visitors for completing actions (pickups, drops, submissions, etc.)
- Display XP and level progression
- Track cumulative progress across sessions

## Prerequisites

- **Ecosystem inventory cache** — see `examples/inventoryCache.md`
- An "Experience Points" item must exist in the ecosystem inventory (type: `ITEM`, status: `ACTIVE`)

## Implementation

### 1. Filter "Experience Points" from Food/Game Items

When building item lists from inventory, always exclude "Experience Points" so it's not treated as a collectible game item.

**In item lookup utilities** (e.g., building a food item map from ecosystem inventory):

```ts
export async function getItemsById(credentials: Credentials): Promise<Map<string, ItemDefinition>> {
  const items = await getCachedInventoryItems({ credentials });
  const map = new Map<string, ItemDefinition>();
  for (const item of items) {
    // Skip non-items and the Experience Points system item
    if (item.type !== "ITEM" || item.name === "Experience Points") continue;
    const def = toItemDefinition(item);
    if (def) map.set(def.itemId, def);
  }
  return map;
}
```

**In visitor bag/inventory builders** (filtering visitor inventory items):

```ts
const gameItems = allItems.filter(
  (item: any) =>
    item.type === "ITEM" &&
    item.status === "ACTIVE" &&
    (item.quantity ?? item.availableQuantity ?? 1) > 0 &&
    item.item?.name !== "Experience Points", // Exclude XP item
);
```

### 2. Read XP from Visitor Inventory

After calling `visitor.fetchInventoryItems()`, extract XP from the already-fetched items:

```ts
/**
 * Read XP from already-fetched visitor inventory items.
 * Call visitor.fetchInventoryItems() before using this function.
 */
export const getVisitorXp = (allItems: any[]): number => {
  const xpItem = allItems.find((item: any) => item.item?.name === "Experience Points" && item.status === "ACTIVE");
  return xpItem?.quantity ?? xpItem?.availableQuantity ?? 0;
};
```

Use with level calculation:

```ts
import { getLevelForXp } from "@shared/data/xpConfig.js";

await visitor.fetchInventoryItems();
const allItems: any[] = visitor.inventoryItems || [];
const xp = getVisitorXp(allItems);
const level = getLevelForXp(xp);
```

### 3. Grant XP to a Visitor

Look up the "Experience Points" ecosystem item from the cached inventory, then use `visitor.modifyInventoryItemQuantity()` to increment:

```ts
import { getCachedInventoryItems } from "./inventoryCache.js";

/**
 * Grant XP to a visitor via the "Experience Points" inventory item.
 * Returns the new total XP quantity.
 */
export const grantXp = async (visitor: any, credentials: Credentials, amount: number): Promise<number> => {
  const items = await getCachedInventoryItems({ credentials });
  const xpItem = items.find((item) => item.name === "Experience Points" && item.status === "ACTIVE");

  if (!xpItem) {
    console.warn("Experience Points item not found in ecosystem");
    return 0;
  }

  const result = await visitor.modifyInventoryItemQuantity(xpItem, amount);
  return result?.quantity ?? 0;
};
```

### 4. Export from Utils Index

Add exports to `server/utils/index.ts`:

```ts
export * from "./inventory.js"; // or wherever grantXp/getVisitorXp live
```

## Usage in Controllers

### Grant XP on an Action

```ts
import { grantXp } from "../utils/index.js";

// After calculating xpEarned based on the action...
const xpEarned = 10; // e.g., XP_ACTIONS.PICKUP
await grantXp(visitor, credentials, xpEarned);

return res.json({
  success: true,
  xpEarned,
});
```

### Grant XP on Submission (with Level Calculation)

```ts
import { grantXp } from "../utils/index.js";
import { getLevelForXp } from "@shared/data/xpConfig.js";

// Calculate total XP for the submission
let totalXp = XP_ACTIONS.SUBMIT;
totalXp += bonusXp;

// Grant and get new total
const newTotalXp = await grantXp(visitor, credentials, totalXp);
const newLevel = getLevelForXp(newTotalXp);

return res.json({
  success: true,
  totalXpEarned: totalXp,
  newTotalXp,
  newLevel,
});
```

### Read XP in Game State

Return XP and level from visitor inventory in your main game state endpoint:

```ts
import { getVisitorXp } from "../utils/index.js";
import { getLevelForXp } from "@shared/data/xpConfig.js";

// In getVisitor or similar utility that fetches visitor data:
await visitor.fetchInventoryItems();
const allItems: any[] = visitor.inventoryItems || [];
const xp = getVisitorXp(allItems);
const level = getLevelForXp(xp);

return res.json({
  success: true,
  xp,
  level,
  // ... other game state
});
```

## XP Configuration Pattern

Define XP constants and level thresholds in a shared config:

```ts
// shared/data/xpConfig.ts
export const XP_ACTIONS = {
  PICKUP: 10,
  DROP: 5,
  SUBMIT: 100,
  BONUS: 50,
  // ... add actions specific to your app
} as const;

export const LEVEL_THRESHOLDS: number[] = [0, 100, 300, 600, 1000, 1500, 2100, 2800, 3600, 4500];

export function getLevelForXp(xp: number): number {
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (xp >= LEVEL_THRESHOLDS[i]) return i + 1;
  }
  return 1;
}
```

## Key Principles

| Principle                        | Detail                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------- |
| **Inventory is source of truth** | Never store `totalXp` or `level` in data objects. Always read from inventory.            |
| **Filter from game items**       | Exclude "Experience Points" from any item list, bag builder, or food lookup.             |
| **Use ecosystem cache**          | Look up the XP item via `getCachedInventoryItems`, not per-request API calls.            |
| **Grant, don't set**             | Use `modifyInventoryItemQuantity(item, amount)` to increment. Never set absolute values. |
| **Derive level**                 | Compute `level` from XP using `getLevelForXp()` — never store it separately.             |

## File Summary

| File                             | Purpose                                             |
| -------------------------------- | --------------------------------------------------- |
| `server/utils/inventory.ts`      | `grantXp`, `getVisitorXp` utilities                 |
| `server/utils/inventoryCache.ts` | Cached ecosystem inventory (find XP item)           |
| `shared/data/xpConfig.ts`        | XP action values, level thresholds, `getLevelForXp` |
| `server/controllers/*.ts`        | Call `grantXp` after calculating earned XP          |

## Related Examples

- `inventoryCache.md` — Ecosystem inventory caching (prerequisite)
- `awardBadge.md` — Similar pattern for granting inventory items
- `badges.md` — Reading visitor inventory items
