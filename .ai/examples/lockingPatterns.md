# Locking Patterns for Concurrency Control

Use SDK locking mechanisms to prevent race conditions when multiple visitors or operations attempt to update the same data object simultaneously. Essential for multiplayer games, shared state, and any feature where concurrent writes could cause data corruption.

## Table of Contents

- [Why Locking Matters](#why-locking-matters)
- [Basic Lock Pattern](#basic-lock-pattern)
- [Time-Based Lock IDs](#time-based-lock-ids)
- [Lock with setDataObject](#lock-with-setdataobject)
- [Lock with updateDataObject](#lock-with-updatedataobject)
- [Handling Lock Conflicts](#handling-lock-conflicts)
- [Advanced Patterns](#advanced-patterns)

---

## Why Locking Matters

Without locking, concurrent updates can cause data loss:

```
Player A reads: { score: 100 }
Player B reads: { score: 100 }
Player A writes: { score: 110 }  // +10 points
Player B writes: { score: 105 }  // +5 points (overwrites A's update!)
Final result: { score: 105 }     // Player A's points are lost!
```

With locking:

```
Player A acquires lock, reads: { score: 100 }
Player B tries to acquire lock -> BLOCKED
Player A writes: { score: 110 }, releases lock
Player B acquires lock, reads: { score: 110 }
Player B writes: { score: 115 }
Final result: { score: 115 }     // Both updates preserved!
```

---

## Basic Lock Pattern

The SDK's data object methods accept a `lock` option:

```ts
await droppedAsset.updateDataObject(
  { score: newScore },
  {
    lock: {
      lockId: "unique-lock-identifier",
      releaseLock: true,  // Release lock after operation
    },
  },
);
```

### Lock Options

| Option | Type | Purpose |
|--------|------|---------|
| `lockId` | string | Unique identifier for this lock session |
| `releaseLock` | boolean | `true` = release after operation, `false` = hold lock for subsequent operations |

---

## Time-Based Lock IDs

The most common pattern uses time-windowed lock IDs. This groups operations within a time window under the same lock, allowing related operations while blocking unrelated concurrent access.

### 5-Second Window (Fast-paced games)

```ts
// Lock ID changes every 5 seconds
const timestamp = new Date(Math.round(new Date().getTime() / 5000) * 5000);
const lockId = `${assetId}-${timestamp}`;

await keyAsset.updateDataObject(
  { lastMove: visitorId },
  { lock: { lockId, releaseLock: true } },
);
```

### 60-Second Window (Standard operations)

```ts
// Lock ID changes every minute
const lockId = `${assetId}-${new Date(Math.round(new Date().getTime() / 60000) * 60000)}`;

await visitor.setDataObject(
  { initialized: true },
  { lock: { lockId, releaseLock: true } },
);
```

### Composite Lock IDs

Include relevant context to scope the lock appropriately:

```ts
// Scoped to asset + scene + turn count
const timestamp = new Date(Math.round(new Date().getTime() / 5000) * 5000);
const lockId = `${keyAssetId}-${resetCount}-${turnCount}-${timestamp}`;

// Scoped to visitor + scene
const lockId = `${sceneDropId}-${visitorId}-${Math.round(Date.now() / 5000) * 5000}`;

// Scoped to specific action
const lockId = `planting_${assetId}_${squareId}_${visitorId}_${Math.round(Date.now() / 5000) * 5000}`;
```

---

## Lock with setDataObject

Use `setDataObject` with locking when initializing data for the first time:

```ts
import { DroppedAsset } from "../utils/topiaInit.js";

export const initializeDroppedAssetDataObject = async (droppedAsset: any) => {
  await droppedAsset.fetchDataObject();

  // Check if data object needs initialization
  if (!droppedAsset.dataObject?.keyAssetId) {
    // Create time-based lock ID
    const lockId = `${droppedAsset.id}-${new Date(Math.round(new Date().getTime() / 60000) * 60000)}`;

    // Initialize with default data
    await droppedAsset.setDataObject(
      {
        keyAssetId: droppedAsset.id,
        playerX: { visitorId: null, profileId: null, username: null },
        playerO: { visitorId: null, profileId: null, username: null },
        lastPlayerTurn: null,
        turnCount: 0,
        isGameOver: false,
      },
      { lock: { lockId, releaseLock: true } },
    );

    return true; // Was initialized
  }

  return false; // Already initialized
};
```

---

## Lock with updateDataObject

Use `updateDataObject` with locking for incremental updates:

```ts
export const handleClaimCell = async (req: Request, res: Response) => {
  try {
    const credentials = getCredentials(req.query);
    const { visitorId } = credentials;
    const { cell } = req.body;

    const keyAsset = await getDroppedAsset(credentials);
    const { turnCount, resetCount, keyAssetId } = keyAsset.dataObject;

    // Create composite lock ID
    const timestamp = new Date(Math.round(new Date().getTime() / 5000) * 5000);
    const lockId = `${keyAssetId}-${resetCount}-${turnCount}-${timestamp}`;

    // Attempt to acquire lock and update
    try {
      await keyAsset.updateDataObject(
        {
          lastPlayerTurn: visitorId,
          turnCount: turnCount + 1,
          [`claimedCells.${cell}`]: visitorId,
        },
        { lock: { lockId, releaseLock: true } },
      );
    } catch (lockError) {
      // Lock conflict - another player's move is in progress
      return res.status(409).json({
        success: false,
        message: "Move already in progress. Please wait.",
      });
    }

    return res.json({ success: true });
  } catch (error) {
    return errorHandler({ error, functionName: "handleClaimCell", message: "Error claiming cell", req, res });
  }
};
```

---

## Handling Lock Conflicts

When a lock cannot be acquired, the SDK throws an error. Handle this gracefully:

### Return 409 Conflict

```ts
try {
  await keyAsset.updateDataObject(updatedData, {
    lock: { lockId, releaseLock: true },
  });
} catch (error) {
  // Check if it's a lock conflict
  if (error.message?.includes("lock") || error.status === 409) {
    return res.status(409).json({
      success: false,
      message: "Another operation is in progress. Please try again.",
    });
  }
  // Re-throw other errors
  throw error;
}
```

### Retry Pattern

For critical operations, implement retry logic:

```ts
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 100;

const updateWithRetry = async (asset: any, data: any, lockId: string) => {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await asset.updateDataObject(data, {
        lock: { lockId, releaseLock: true },
      });
      return { success: true };
    } catch (error) {
      if (attempt === MAX_RETRIES) {
        throw error;
      }
      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
    }
  }
};
```

---

## Advanced Patterns

### Hold Lock Across Multiple Operations

When you need to perform multiple updates atomically:

```ts
const lockId = `game-${assetId}-${Date.now()}`;

// First operation - acquire lock but don't release
await keyAsset.updateDataObject(
  { phase: "processing" },
  { lock: { lockId, releaseLock: false } },  // Hold the lock
);

// Second operation - use same lock, still hold
await keyAsset.updateDataObject(
  { processedItems: items },
  { lock: { lockId, releaseLock: false } },  // Still holding
);

// Final operation - release the lock
await keyAsset.updateDataObject(
  { phase: "complete" },
  { lock: { lockId, releaseLock: true } },  // Release lock
);
```

### Lock for Visitor Data Objects

Same pattern applies to visitor data:

```ts
const lockId = `${urlSlug}-${sceneDropId}-${new Date(Math.round(new Date().getTime() / 60000) * 60000)}`;

// Initialize visitor progress if needed
if (!visitor.dataObject) {
  await visitor.setDataObject(
    { [`${urlSlug}-${sceneDropId}`]: defaultProgress },
    { lock: { lockId, releaseLock: true } },
  );
} else {
  await visitor.updateDataObject(
    { [`${urlSlug}-${sceneDropId}`]: updatedProgress },
    { lock: { lockId, releaseLock: true } },
  );
}
```

### Lock with Analytics

Locking works with analytics tracking:

```ts
await keyAsset.updateDataObject(
  {
    lastPlayerTurn: visitorId,
    turnCount: turnCount + 1,
  },
  {
    lock: { lockId, releaseLock: true },
    analytics: [
      { analyticName: "moves", profileId, urlSlug, uniqueKey: profileId },
    ],
  },
);
```

---

## Common Lock ID Patterns

| Use Case | Lock ID Pattern | Time Window |
|----------|-----------------|-------------|
| Fast game moves | `${assetId}-${turn}-${5sTimestamp}` | 5 seconds |
| Standard updates | `${assetId}-${60sTimestamp}` | 60 seconds |
| Visitor progress | `${sceneDropId}-${visitorId}-${60sTimestamp}` | 60 seconds |
| Planting/actions | `action_${assetId}_${slot}_${5sTimestamp}` | 5 seconds |
| Game reset | `reset-${assetId}-${Date.now()}` | Unique per reset |

---

## Best Practices

1. **Always use time-based lock IDs** - Prevents lock conflicts from stale operations
2. **Include relevant context** - Scope locks to the specific asset/scene/visitor
3. **Use shorter windows for real-time** - 5 seconds for games, 60 seconds for general use
4. **Always set `releaseLock: true`** - Unless you explicitly need to hold the lock
5. **Handle 409 conflicts gracefully** - Show user-friendly messages
6. **Don't lock for read operations** - Only lock when writing

---

## SDK Method Reference

```ts
// With setDataObject
await asset.setDataObject(data, {
  lock: { lockId: string, releaseLock: boolean },
});

// With updateDataObject
await asset.updateDataObject(data, {
  lock: { lockId: string, releaseLock: boolean },
  analytics?: AnalyticType[],
});

// With incrementDataObjectValue
await asset.incrementDataObjectValue(path, amount, {
  lock: { lockId: string, releaseLock: boolean },
  analytics?: AnalyticType[],
});
```
