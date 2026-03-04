# Badges System

This document describes how to implement badges in SDK apps, including ecosystem inventory caching, visitor inventory fetching, and UI display.

## Overview

The badges system consists of three parts:

1. **Ecosystem Badges** - All available badges in the ecosystem (cached for performance)
2. **Visitor Inventory** - Badges owned by a specific visitor
3. **UI Display** - Shows all badges with owned badges in color and unowned badges grayed out

## Server Utilities

### 1. getBadges.ts

Create `server/utils/getBadges.ts` to get all active badges from ecosystem inventory:

```ts
import { Credentials } from "../types.js";
import { getCachedInventoryItems } from "./inventoryCache.js";

export type BadgeRecord = {
  [name: string]: {
    id: string;
    name: string;
    icon: string;
    description: string;
  };
};

/**
 * Get all active badges from ecosystem inventory
 * Uses cached inventory items for performance
 * Pass forceRefresh=true to bypass cache (used when inventory ZIP is re-uploaded)
 */
export const getBadges = async (credentials: Credentials, forceRefresh = false): Promise<BadgeRecord> => {
  const inventoryItems = await getCachedInventoryItems({ credentials, forceRefresh });

  const badges: BadgeRecord = {};

  for (const item of inventoryItems) {
    const { id, name, image_path, description, type, status } = item;
    if (name && type === "BADGE" && status === "ACTIVE") {
      badges[name] = {
        id,
        name,
        icon: image_path || "",
        description: description || "",
      };
    }
  }

  return badges;
};
```

### 2. getVisitorBadges.ts

Create `server/utils/getVisitorBadges.ts` to extract badges from visitor inventory:

```ts
export type VisitorBadgeRecord = {
  [name: string]: {
    id: string;
    name: string;
    icon: string;
  };
};

export type VisitorInventory = {
  badges: VisitorBadgeRecord;
};

/**
 * Extract badges from visitor's inventory items
 * Call visitor.fetchInventoryItems() before using this function
 */
export const getVisitorBadges = (visitorInventoryItems: any[]): VisitorInventory => {
  const visitorInventory: VisitorInventory = { badges: {} };

  for (const visitorItem of visitorInventoryItems) {
    const { id, status, item } = visitorItem;
    const { name, type, image_url = "" } = item || {};

    if (status === "ACTIVE" && type === "BADGE" && name) {
      visitorInventory.badges[name] = {
        id,
        name,
        icon: image_url,
      };
    }
  }

  return visitorInventory;
};
```

### 3. Export from index.ts

Add exports to `server/utils/index.ts`:

```ts
export * from "./getBadges.js";
export * from "./getVisitorBadges.js";
```

## Usage in Controllers

Use the utilities in your controller. Always support `forceRefreshInventory` so the ecosystem inventory cache can be bypassed when badge items are updated:

```ts
import {
  getBadges,
  getCredentials,
  getProfile,
  getVisitorBadges,
  getWorldDataObject,
  Visitor,
} from "../utils/index.js";

export const handleGetConfiguration = async (req: Request, res: Response) => {
  try {
    const credentials = getCredentials(req.query);
    const { visitorId, urlSlug } = credentials;
    const forceRefreshInventory = req.query.forceRefreshInventory === "true";

    // Fetch badges and other data in parallel
    const promises = [
      getProfile(credentials),
      getWorldDataObject({ credentials }),
      getBadges(credentials, forceRefreshInventory),
    ];
    const [{ isAdmin }, { dataObject }, badges] = await Promise.all(promises);

    // Get visitor's owned badges
    const visitor = await Visitor.create(visitorId, urlSlug, { credentials });
    await visitor.fetchInventoryItems();
    const visitorInventory = getVisitorBadges(visitor.inventoryItems);

    return res.json({
      success: true,
      badges,
      visitorInventory,
      // ... other data
    });
  } catch (error) {
    // handle error
  }
};
```

## Prerequisites

### Ecosystem Inventory Cache

See `examples/inventoryCache.md` for the full implementation. Key points:

- Uses `EcosystemFactory` from `@rtsdk/topia`
- Caches inventory items with 24-hour TTL
- Falls back to stale cache on API failure

**Required:** Add `EcosystemFactory` to `topiaInit.ts`:

```ts
import { EcosystemFactory } from "@rtsdk/topia";
const Ecosystem = new EcosystemFactory(myTopiaInstance);
export { Ecosystem };
```

## Client Implementation

### forceRefreshInventory

When new badge items are uploaded to the ecosystem, the server's inventory cache (24h TTL) may serve stale data. To support cache busting, the client must read the `forceRefreshInventory` search param and pass it to the game-state endpoint.

In your page component that fetches game state (e.g. `Home.tsx`):

```tsx
import { useSearchParams } from "react-router-dom";

const [searchParams] = useSearchParams();
const forceRefreshInventory = searchParams.get("forceRefreshInventory") === "true";

useEffect(() => {
  if (hasInteractiveParams) {
    backendAPI
      .get("/game-state", { params: { forceRefreshInventory } })
      .then((response) => setGameState(dispatch, response.data))
      .catch((error) => setErrorMessage(dispatch, error as ErrorType))
      .finally(() => setIsLoading(false));
  }
}, [hasInteractiveParams]);
```

This allows Topia to append `?forceRefreshInventory=true` to the iframe URL after uploading a new inventory ZIP, ensuring the app picks up new badge definitions immediately.

### Client Types

Add types to `client/src/context/types.ts`:

```ts
export type BadgeType = {
  id: string;
  icon: string;
  description?: string;
  name: string;
};

export type VisitorInventoryType = {
  badges: { [name: string]: BadgeType };
};

export interface InitialState {
  // ... existing fields
  badges?: { [name: string]: BadgeType };
  visitorInventory?: VisitorInventoryType;
}
```

### Update Reducer

Add `badges` and `visitorInventory` to the reducer's `SET_CONFIG` case:

```ts
case SET_CONFIG: {
  return {
    ...state,
    badges: payload?.badges ?? state.badges,
    visitorInventory: payload?.visitorInventory ?? state.visitorInventory,
    // ... other fields
  };
}
```

### UI Display with Tabs

Display badges in a tabbed interface, showing owned badges in color and unowned badges grayed out:

```tsx
const { badges, visitorInventory } = useContext(GlobalStateContext);
const [activeTab, setActiveTab] = useState("main");

const getBadgesContent = () => {
  if (!badges || Object.keys(badges).length === 0) {
    return (
      <div className="text-center py-6">
        <p>No badges available yet.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-3">
      {Object.values(badges).map((badge) => {
        const { name, description, icon } = badge;
        const hasBadge = visitorInventory && Object.keys(visitorInventory).includes(name);
        const style = !hasBadge ? { filter: "grayscale(1)" } : { filter: "none" };
        return (
          <div className="tooltip" key={name}>
            <span className="tooltip-content p3" style={{ width: "115px" }}>
              {description}
            </span>
            <img src={icon} alt={name} style={style} />
            <p className="p3">{name}</p>
          </div>
        );
      })}
    </div>
  );
};

// Tab buttons
<div className="tab-container mb-4">
  <button className={activeTab === "main" ? "btn" : "btn btn-text"} onClick={() => setActiveTab("main")}>
    Main
  </button>
  <button className={activeTab === "badges" ? "btn" : "btn btn-text"} onClick={() => setActiveTab("badges")}>
    Badges
  </button>
</div>;

{
  activeTab === "main" ? getMainContent() : getBadgesContent();
}
```

## Awarding Badges

See `examples/awardBadge.md` for the full implementation. Quick reference:

```ts
// Check if visitor already has badge
if (visitorInventory.badges[badgeName]) return { success: true };

// Get ecosystem inventory and find badge
const inventoryItems = await getCachedInventoryItems({ credentials });
const badge = inventoryItems?.find((item) => item.name === badgeName && item.type === "BADGE");

// Grant the badge
await visitor.grantInventoryItem(badge, 1);

// Show toast notification
await visitor.fireToast({
  title: "Badge Awarded",
  text: `You have earned the ${badgeName} badge!`,
});
```

## File Summary

| File                               | Purpose                                 |
| ---------------------------------- | --------------------------------------- |
| `server/utils/getBadges.ts`        | Get all active badges from ecosystem    |
| `server/utils/getVisitorBadges.ts` | Extract badges from visitor inventory   |
| `server/utils/inventoryCache.ts`   | Caches ecosystem inventory with 24h TTL |
| `server/utils/topiaInit.ts`        | Adds EcosystemFactory export            |
| `client/src/context/types.ts`      | BadgeType, VisitorInventoryType         |
| `client/src/context/reducer.ts`    | Handles badges in SET_CONFIG            |
| `client/src/pages/*.tsx`           | Displays badges in tabs UI              |

## Related Examples

- `inventoryCache.md` - Ecosystem inventory caching
- `awardBadge.md` - Awarding badges to visitors
