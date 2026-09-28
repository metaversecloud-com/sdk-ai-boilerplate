# Inventory Cache Utility

Use the SDK's Ecosystem controller to fetch and cache ecosystem inventory items with a 6-hour TTL. This pattern reduces API calls and improves performance when accessing badges, decorations, or other inventory items.

## When to Use

Add an inventory cache when your app needs to:

- Fetch badges to award to players
- Display ecosystem inventory items (decorations, seeds, tools, etc.)
- Filter inventory items by type or status
- Reduce repeated API calls for the same inventory data

## Implementation

### 1. Create the Cache Utility

Create `server/utils/inventoryCache.ts`:

```ts
import { Credentials } from "../types";
import { Ecosystem } from "./topiaInit.js";
import { standardizeError } from "./standardizeError.js";
import { InventoryItemInterface } from "@rtsdk/topia";

interface CachedInventory {
  items: InventoryItemInterface[];
  timestamp: number;
}

// Cache duration: 6 hours in milliseconds
const CACHE_DURATION_MS = 6 * 60 * 60 * 1000;

// In-memory cache
let inventoryCache: CachedInventory | null = null;

/**
 * Get ecosystem inventory items with caching
 * - Fetches from cache if available and not expired
 * - Refreshes cache if expired or missing
 * - Can force refresh by passing forceRefresh: true
 */
export const getCachedInventoryItems = async ({
  credentials,
  forceRefresh = false,
}: {
  credentials: Credentials;
  forceRefresh?: boolean;
}): Promise<InventoryItemInterface[]> => {
  try {
    const now = Date.now();

    // Check if cache is valid and not expired
    const isCacheValid = inventoryCache !== null && !forceRefresh && now - inventoryCache.timestamp < CACHE_DURATION_MS;

    if (isCacheValid) {
      return inventoryCache!.items;
    }

    // Fetch fresh inventory items
    console.log("Fetching fresh inventory items from ecosystem");
    const ecosystem = Ecosystem.create({ credentials });
    await ecosystem.fetchInventoryItems();

    // Update cache. INACTIVE items are stripped at the cache layer so every
    // downstream consumer (badges, drops, accessory lookup, etc.) gets a
    // clean list — they shouldn't render, unlock, or reward an item the
    // ecosystem has retired. Downstream code should NOT re-filter by status.
    inventoryCache = {
      items: (ecosystem.inventoryItems as InventoryItemInterface[])
        .filter((item) => (item as any)?.status !== "INACTIVE")
        .map((item) => ({
          ...item,
          metadata: {
            ...(item.metadata || {}),
            sortOrder: typeof item.metadata?.sortOrder === "number" ? item.metadata.sortOrder : 0,
          },
        }))
        .sort((a, b) => {
          const aOrder = a.metadata?.sortOrder ?? 0;
          const bOrder = b.metadata?.sortOrder ?? 0;
          return aOrder - bOrder;
        }),
      timestamp: now,
    };

    return inventoryCache.items;
  } catch (error) {
    // If fetch fails but we have stale cache, return it as fallback
    if (inventoryCache !== null) {
      console.warn("Failed to fetch fresh inventory, using stale cache", error);
      return inventoryCache.items;
    }

    throw standardizeError(error);
  }
};

/**
 * Clear the inventory cache (useful for testing or forced refresh)
 */
export const clearInventoryCache = (): void => {
  inventoryCache = null;
  console.log("Inventory cache cleared");
};

/**
 * Get cache status for debugging
 */
export const getInventoryCacheStatus = (): {
  isCached: boolean;
  age?: number;
  itemCount?: number;
} => {
  if (inventoryCache === null) {
    return { isCached: false };
  }

  return {
    isCached: true,
    age: Date.now() - inventoryCache.timestamp,
    itemCount: inventoryCache.items.length,
  };
};
```

### 2. Add Ecosystem Factory to topiaInit.ts

Ensure your `server/utils/topiaInit.ts` exports the Ecosystem factory:

```ts
import {
  Topia,
  DroppedAssetFactory,
  VisitorFactory,
  WorldFactory,
  UserFactory,
  EcosystemFactory, // Add this import
} from "@rtsdk/topia";

const topia = new Topia({
  apiDomain: process.env.INSTANCE_DOMAIN,
  apiProtocol: process.env.INSTANCE_PROTOCOL,
  interactiveKey: process.env.INTERACTIVE_KEY,
  interactiveSecret: process.env.INTERACTIVE_SECRET,
});

export const DroppedAsset = new DroppedAssetFactory(topia);
export const Visitor = new VisitorFactory(topia);
export const World = new WorldFactory(topia);
export const User = new UserFactory(topia);
export const Ecosystem = new EcosystemFactory(topia); // Add this export
```

### 3. Export from Utils Index

Add to `server/utils/index.ts`:

```ts
export * from "./inventoryCache.js";
```

## Usage Examples

### Get All Badges

```ts
import { getCachedInventoryItems } from "./inventoryCache.js";

const getBadges = async (credentials: Credentials) => {
  const items = await getCachedInventoryItems({ credentials });

  // INACTIVE items are already stripped at the cache layer — filter by
  // type + name only.
  const badges = items.filter((item) => item.type === "BADGE" && item.name);

  // Return as indexed object
  return badges.reduce(
    (acc, badge) => {
      acc[badge.name] = {
        icon: badge.icon,
        description: badge.description,
      };
      return acc;
    },
    {} as Record<string, { id: string; icon: string; description: string }>,
  );
};
```

### Award a Badge to a Visitor (Self)

```ts
import { getCachedInventoryItems } from "../utils/index.js";
import { User } from "./topiaInit.js";

export const awardBadge = async ({ badgeName, credentials }: { badgeName: string; credentials: Credentials }) => {
  // Get all inventory items from cache
  const items = await getCachedInventoryItems({ credentials });

  // Find the specific badge
  const badge = items.find((item) => item.name === badgeName && item.type === "BADGE");
  if (!badge) throw new Error(`Badge "${badgeName}" not found in ecosystem inventory`);

  // profileId must be passed at BOTH the top level AND inside credentials —
  // passing it only inside `credentials` silently returns a User bound to
  // the wrong record. See `.ai/examples/awardBadge.md` for details.
  const user = await User.create({
    profileId: credentials.profileId,
    credentials: { ...credentials, profileId: credentials.profileId },
  });
  await user.grantInventoryItem(badge, 1);

  return { success: true, badge };
};
```

### Award a Badge to Another User (Cross-User)

When one user awards a badge to a different user, pass the recipient's `profileId` in BOTH the top-level arg and inside credentials. See `.ai/examples/awardBadge.md` for a full example.

```ts
import { getCachedInventoryItems } from "../utils/index.js";
import { User } from "./topiaInit.js";

// recipientProfileId is passed as a parameter (e.g., from req.body).
// Missing the top-level `profileId` here silently returns a User bound
// to the wrong record — always pass it in BOTH slots.
const recipientUser = await User.create({
  profileId: recipientProfileId,
  credentials: { ...credentials, profileId: recipientProfileId },
});
await recipientUser.grantInventoryItem(badge, 1);
```

### Use in a Controller (Server)

Always check for the `forceRefreshInventory` query param and pass it through to the cache. This allows callers to bypass the cache when inventory has been updated.

```ts
import { Request, Response } from "express";
import { errorHandler, getCredentials, getCachedInventoryItems } from "../utils/index.js";

export const handleGetGameState = async (req: Request, res: Response) => {
  try {
    const credentials = getCredentials(req.query);
    const forceRefresh = req.query.forceRefreshInventory === "true";

    // Get cached inventory items (INACTIVE already stripped at cache layer)
    const items = await getCachedInventoryItems({ credentials, forceRefresh });

    // Filter badges for the response
    const badges = items
      .filter((item) => item.type === "BADGE" && item.name)
      .reduce(
        (acc, badge) => {
          acc[badge.name] = {
            name: badge.name,
            icon: badge.icon,
            description: badge.description,
          };
          return acc;
        },
        {} as Record<string, any>,
      );

    return res.json({
      success: true,
      badges,
      // ... other game state
    });
  } catch (error) {
    return errorHandler({
      error,
      functionName: "handleGetGameState",
      message: "Error loading game state.",
      req,
      res,
    });
  }
};
```

### Pass forceRefreshInventory from the Client

Any component that calls a cached inventory endpoint must read `forceRefreshInventory` from the URL search params using `useSearchParams` and forward it as a query param in the API call.

```tsx
import { useSearchParams } from "react-router-dom";
import { backendAPI } from "@/utils";

const [searchParams] = useSearchParams();
const forceRefreshInventory = searchParams.get("forceRefreshInventory") === "true";

useEffect(() => {
  backendAPI
    .get("/game-state", { params: { forceRefreshInventory } })
    .then((response) => {
      // handle response
    });
}, [/* deps */]);
```

## Cache Behavior

| Scenario                        | Behavior                          |
| ------------------------------- | --------------------------------- |
| First request                   | Fetches from API, caches result   |
| Subsequent requests (within 6h) | Returns cached data               |
| After 6 hours                   | Fetches fresh data, updates cache |
| `forceRefresh: true`            | Always fetches fresh data         |
| API failure with existing cache | Returns stale cache as fallback   |
| API failure without cache       | Throws error                      |

## API Reference

### getCachedInventoryItems

```ts
getCachedInventoryItems({
  credentials: Credentials;
  forceRefresh?: boolean;  // default: false
}): Promise<InventoryItemInterface[]>
```

Returns all ecosystem inventory items (badges, decorations, seeds, tools, etc.).

### clearInventoryCache

```ts
clearInventoryCache(): void
```

Clears the in-memory cache. Useful for testing or when you know inventory has changed.

### getInventoryCacheStatus

```ts
getInventoryCacheStatus(): {
  isCached: boolean;
  age?: number;        // milliseconds since cache was set
  itemCount?: number;  // number of items in cache
}
```

Returns cache status for debugging purposes.

## Filtering Inventory Items

INACTIVE items are stripped once, at the cache layer — downstream code
should never re-filter by `item.status`. If you find yourself writing
`item.status === "ACTIVE"` against a cached list, delete it.

Common filters for cached inventory items:

```ts
// Badges only (INACTIVE already stripped at cache layer)
items.filter((item) => item.type === "BADGE");

// Accessories only
items.filter((item) => item.type === "ACCESSORY");

// Decorations only
items.filter((item) => item.type === "DECORATION");

// Items with specific metadata
items.filter((item) => item.type === "ITEM" && item.metadata?.category === "rare");
```

Note: `visitor.inventoryItems` / `user.inventoryItems` are USER-GRANTED
items (not the ecosystem cache). Their `status` field means "has this user
still got the item, or was it revoked?" — that filter is unrelated to the
ecosystem-level INACTIVE strip and should stay in place.

## Notes

- The cache is stored in server memory and resets when the server restarts
- All requests share the same cache (singleton pattern)
- The 6-hour TTL balances freshness with API efficiency
- Stale cache fallback ensures graceful degradation during API issues
