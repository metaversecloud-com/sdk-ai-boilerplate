# Data Migration Patterns

Patterns for evolving data object schemas over time without breaking existing data. Use these patterns when you need to rename keys, change data formats, or add new required fields to existing data objects.

## Table of Contents

- [Why Data Migration Matters](#why-data-migration-matters)
- [Key Rename Migration](#key-rename-migration)
- [Format Conversion](#format-conversion)
- [Adding New Required Fields](#adding-new-required-fields)
- [Backward Compatibility](#backward-compatibility)
- [Lazy Migration Pattern](#lazy-migration-pattern)
- [Version-Based Migration](#version-based-migration)

---

## Why Data Migration Matters

Data objects persist across app updates. When you change your data schema, existing data must be handled gracefully:

```ts
// Old schema (v1)
{
  "score": 100,
  "items": ["sword", "shield"]
}

// New schema (v2) - renamed fields
{
  "totalScore": 100,
  "inventory": ["sword", "shield"]
}
```

Without migration, users with old data would see broken functionality.

---

## Key Rename Migration

When you need to rename a key in the data object:

### Pattern: Migrate on Read

```ts
// server/utils/getVisitorProgress.ts
export const getVisitorProgress = async (visitor: any, credentials: Credentials) => {
  const { urlSlug, sceneDropId } = credentials;
  await visitor.fetchDataObject();

  const dataObject = visitor.dataObject || {};

  // OLD key format: urlSlug-sceneDropId (with hyphen)
  const oldKey = `${urlSlug}-${sceneDropId}`;
  // NEW key format: urlSlug_sceneDropId (with underscore)
  const newKey = `${urlSlug}_${sceneDropId}`;

  // Check if migration is needed
  if (dataObject[oldKey] && !dataObject[newKey]) {
    // Migrate: copy old data to new key, delete old key
    const migratedData = { ...dataObject };
    migratedData[newKey] = dataObject[oldKey];
    delete migratedData[oldKey];

    // Persist the migration
    const lockId = `migrate-${visitor.id}-${Date.now()}`;
    await visitor.setDataObject(migratedData, {
      lock: { lockId, releaseLock: true },
    });

    return migratedData[newKey];
  }

  // Return new key if exists, otherwise return default
  return dataObject[newKey] || getDefaultProgress();
};
```

### Pattern: Migrate During Update

```ts
export const updateVisitorProgress = async (visitor: any, credentials: Credentials, updates: Partial<ProgressData>) => {
  const { urlSlug, sceneDropId } = credentials;
  await visitor.fetchDataObject();

  const dataObject = visitor.dataObject || {};
  const oldKey = `${urlSlug}-${sceneDropId}`;
  const newKey = `${urlSlug}_${sceneDropId}`;

  // If old key exists, migrate it first
  if (dataObject[oldKey]) {
    const currentData = dataObject[oldKey];
    const lockId = `migrate-${visitor.id}-${Date.now()}`;

    // Write to new key with updates, delete old key
    await visitor.setDataObject(
      {
        ...dataObject,
        [newKey]: { ...currentData, ...updates },
        [oldKey]: undefined, // Remove old key
      },
      { lock: { lockId, releaseLock: true } },
    );
  } else {
    // No migration needed, just update
    await visitor.updateDataObject({
      [newKey]: { ...(dataObject[newKey] || {}), ...updates },
    });
  }
};
```

---

## Format Conversion

When you need to change the format of stored data:

### Example: Object to Pipe-Delimited String

Converting leaderboard from object format to string format for efficiency:

```ts
// OLD format (object):
{
  leaderboard: {
    "profileId1": { name: "Alice", score: 100, time: 45 },
    "profileId2": { name: "Bob", score: 90, time: 50 }
  }
}

// NEW format (pipe-delimited strings):
{
  leaderboard: {
    "profileId1": "Alice|100|45",
    "profileId2": "Bob|90|50"
  }
}
```

### Migration Function

```ts
// server/utils/migrateLeaderboard.ts
type OldLeaderboardEntry = {
  name: string;
  score: number;
  time: number;
};

export const migrateLeaderboard = (leaderboard: {
  [profileId: string]: OldLeaderboardEntry | string;
}): { [profileId: string]: string } => {
  const migrated: { [profileId: string]: string } = {};

  for (const [profileId, entry] of Object.entries(leaderboard)) {
    if (typeof entry === "string") {
      // Already in new format
      migrated[profileId] = entry;
    } else if (typeof entry === "object" && entry !== null) {
      // Convert from old format to new format
      migrated[profileId] = `${entry.name}|${entry.score}|${entry.time}`;
    }
  }

  return migrated;
};

// Usage in controller
export const handleGetLeaderboard = async (req: Request, res: Response) => {
  try {
    const credentials = getCredentials(req.query);
    const { keyAsset } = await getDroppedAssetDataObject(credentials);

    let { leaderboard } = keyAsset.dataObject;

    // Check if migration is needed (any entry is an object)
    const needsMigration = Object.values(leaderboard || {}).some((entry) => typeof entry === "object");

    if (needsMigration) {
      leaderboard = migrateLeaderboard(leaderboard);

      // Persist migration
      await keyAsset.updateDataObject({ leaderboard });
    }

    // Parse and return
    const parsed = parseLeaderboard(leaderboard);
    return res.json({ success: true, data: { leaderboard: parsed } });
  } catch (error) {
    return errorHandler({ error, functionName: "handleGetLeaderboard", message: "Error", req, res });
  }
};
```

---

## Adding New Required Fields

When adding new fields that must exist for the app to work:

### Pattern: Default Values on Read

```ts
// Define default values for all fields
const DEFAULT_GAME_DATA = {
  score: 0,
  level: 1,
  lives: 3,
  // New field added in v2
  powerUps: [],
  // New field added in v3
  achievements: {},
};

export const getGameData = async (droppedAsset: any): Promise<GameData> => {
  await droppedAsset.fetchDataObject();

  // Merge defaults with existing data (existing data takes precedence)
  const gameData = {
    ...DEFAULT_GAME_DATA,
    ...(droppedAsset.dataObject || {}),
  };

  return gameData;
};
```

### Pattern: Initialize Missing Fields

```ts
export const ensureGameDataComplete = async (droppedAsset: any): Promise<boolean> => {
  await droppedAsset.fetchDataObject();
  const dataObject = droppedAsset.dataObject || {};

  const requiredFields = ["score", "level", "lives", "powerUps", "achievements"];
  const missingFields = requiredFields.filter((field) => !(field in dataObject));

  if (missingFields.length > 0) {
    // Add missing fields with defaults
    const updates: Record<string, any> = {};
    for (const field of missingFields) {
      updates[field] = DEFAULT_GAME_DATA[field];
    }

    await droppedAsset.updateDataObject(updates);
    return true; // Migration performed
  }

  return false; // No migration needed
};
```

---

## Backward Compatibility

Support both old and new formats during transition:

### Reading Both Formats

```ts
// Support both old key name and new key name
export const getPlayerData = (dataObject: any, profileId: string) => {
  // Try new key first
  if (dataObject.players?.[profileId]) {
    return dataObject.players[profileId];
  }

  // Fall back to old key
  if (dataObject.playerData?.[profileId]) {
    return dataObject.playerData[profileId];
  }

  // Return default if neither exists
  return { score: 0, level: 1 };
};
```

### Writing to New Format Only

```ts
export const updatePlayerData = async (droppedAsset: any, profileId: string, updates: Partial<PlayerData>) => {
  // Always write to new format
  await droppedAsset.updateDataObject({
    [`players.${profileId}`]: updates,
  });
};
```

---

## Lazy Migration Pattern

Migrate data only when accessed, not all at once:

```ts
// server/utils/lazyMigrate.ts
export const lazyMigrateVisitor = async (visitor: any, credentials: Credentials): Promise<VisitorData> => {
  await visitor.fetchDataObject();
  const dataObject = visitor.dataObject || {};

  let needsUpdate = false;
  const updates: Record<string, any> = {};

  // Migration 1: Rename "pts" to "points"
  if ("pts" in dataObject && !("points" in dataObject)) {
    updates.points = dataObject.pts;
    updates.pts = undefined; // Delete old key
    needsUpdate = true;
  }

  // Migration 2: Convert items array to object
  if (Array.isArray(dataObject.items)) {
    updates.inventory = {};
    dataObject.items.forEach((item: string, index: number) => {
      updates.inventory[item] = { acquired: true, slot: index };
    });
    updates.items = undefined; // Delete old key
    needsUpdate = true;
  }

  // Migration 3: Add missing fields
  if (!("version" in dataObject)) {
    updates.version = 3;
    needsUpdate = true;
  }

  // Apply migrations if needed
  if (needsUpdate) {
    const lockId = `migrate-${visitor.id}-${Date.now()}`;
    await visitor.updateDataObject(updates, {
      lock: { lockId, releaseLock: true },
    });

    // Re-fetch to get updated data
    await visitor.fetchDataObject();
  }

  return visitor.dataObject;
};
```

### Use in Controllers

```ts
export const handleGetGameState = async (req: Request, res: Response) => {
  try {
    const credentials = getCredentials(req.query);
    const visitor = await Visitor.get(credentials.visitorId, credentials.urlSlug, { credentials });

    // Lazy migrate on every read
    const visitorData = await lazyMigrateVisitor(visitor, credentials);

    return res.json({ success: true, data: visitorData });
  } catch (error) {
    return errorHandler({ error, functionName: "handleGetGameState", message: "Error", req, res });
  }
};
```

---

## Version-Based Migration

Track schema version and apply migrations in sequence:

### Schema Versioning

```ts
// server/types/DataVersion.ts
export const CURRENT_VERSION = 3;

export type VersionedData = {
  _version: number;
  [key: string]: any;
};
```

### Migration Functions

```ts
// server/utils/migrations/index.ts
type MigrationFn = (data: any) => any;

const migrations: { [version: number]: MigrationFn } = {
  // v1 -> v2: Rename "pts" to "points"
  1: (data) => ({
    ...data,
    points: data.pts ?? 0,
    pts: undefined,
    _version: 2,
  }),

  // v2 -> v3: Add achievements object
  2: (data) => ({
    ...data,
    achievements: data.achievements || {},
    _version: 3,
  }),

  // v3 -> v4: Convert items array to inventory object
  3: (data) => {
    const inventory: Record<string, any> = {};
    if (Array.isArray(data.items)) {
      data.items.forEach((item: string) => {
        inventory[item] = { count: 1 };
      });
    }
    return {
      ...data,
      inventory,
      items: undefined,
      _version: 4,
    };
  },
};

export const migrateData = (data: any): any => {
  let currentData = { ...data };
  let version = currentData._version || 0;

  // Apply each migration in sequence
  while (version < CURRENT_VERSION) {
    const migrateFn = migrations[version];
    if (migrateFn) {
      currentData = migrateFn(currentData);
      version = currentData._version;
    } else {
      // No migration for this version, just bump
      version++;
      currentData._version = version;
    }
  }

  return currentData;
};
```

### Apply Migrations

```ts
export const getAndMigrateData = async (entity: any): Promise<any> => {
  await entity.fetchDataObject();
  const dataObject = entity.dataObject || { _version: 0 };

  const currentVersion = dataObject._version || 0;

  if (currentVersion < CURRENT_VERSION) {
    const migratedData = migrateData(dataObject);

    // Persist migrated data
    const lockId = `migrate-${entity.id}-${Date.now()}`;
    await entity.setDataObject(migratedData, {
      lock: { lockId, releaseLock: true },
    });

    return migratedData;
  }

  return dataObject;
};
```

---

## Best Practices

### 1. Always Use Locking for Migrations

```ts
// Prevent concurrent migrations
const lockId = `migrate-${entityId}-${Date.now()}`;
await entity.setDataObject(migratedData, {
  lock: { lockId, releaseLock: true },
});
```

### 2. Preserve Unknown Fields

```ts
// Don't lose data you don't recognize
const migratedData = {
  ...existingData, // Keep everything
  newField: value, // Add new
  oldField: undefined, // Remove old
};
```

### 3. Make Migrations Idempotent

```ts
// Safe to run multiple times
if ("oldKey" in data && !("newKey" in data)) {
  // Only migrate if old exists and new doesn't
}
```

### 4. Test Migrations Thoroughly

```ts
// Test with various data states
const testCases = [
  { input: {}, expected: { _version: 3, points: 0 } },
  { input: { pts: 50 }, expected: { _version: 3, points: 50 } },
  { input: { points: 100, _version: 2 }, expected: { _version: 3, points: 100 } },
];
```

### 5. Log Migrations for Debugging

```ts
if (needsMigration) {
  console.log(`Migrating data for ${entityId} from v${oldVersion} to v${newVersion}`);
  await entity.setDataObject(migratedData);
}
```

### 6. Consider Bulk Migration for Critical Updates

For major changes, consider a one-time migration script rather than lazy migration:

```ts
// scripts/migrateAllVisitors.ts
export const migrateAllVisitors = async () => {
  // This would be run manually, not in normal app flow
  const visitors = await getAllVisitors();

  for (const visitor of visitors) {
    await lazyMigrateVisitor(visitor);
    console.log(`Migrated visitor ${visitor.id}`);
  }
};
```

---

## Summary

| Pattern                | When to Use                                |
| ---------------------- | ------------------------------------------ |
| Key Rename             | Changing field names                       |
| Format Conversion      | Changing data structure (array <-> object) |
| Default Values         | Adding new optional fields                 |
| Initialize Missing     | Adding new required fields                 |
| Backward Compatibility | Supporting old clients during transition   |
| Lazy Migration         | Gradual migration as users access data     |
| Version-Based          | Complex multi-step migrations              |
