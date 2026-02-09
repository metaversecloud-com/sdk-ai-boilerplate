# Analytics Tracking

Use the SDK's built-in analytics system to track user engagement, feature usage, and game metrics. Analytics are recorded through data object operations and can be viewed in the Topia dashboard.

## Table of Contents

- [How Analytics Work](#how-analytics-work)
- [Basic Analytics Pattern](#basic-analytics-pattern)
- [Analytics with Data Updates](#analytics-with-data-updates)
- [Analytics Without Data Changes](#analytics-without-data-changes)
- [Common Analytics Events](#common-analytics-events)
- [Unique Key Patterns](#unique-key-patterns)
- [Increment Analytics](#increment-analytics)
- [Best Practices](#best-practices)

---

## How Analytics Work

Analytics are passed as an option to data object methods (`setDataObject`, `updateDataObject`, `incrementDataObjectValue`). The SDK sends analytics to Topia's analytics system alongside the data operation.

```ts
await entity.updateDataObject(
  { /* data changes */ },
  {
    analytics: [
      {
        analyticName: "eventName",    // Name of the event
        profileId,                     // User's profile ID
        urlSlug,                       // World identifier
        uniqueKey: profileId,          // Deduplication key
        incrementBy?: number,          // Optional: for counters
      },
    ],
  },
);
```

### Analytics Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `analyticName` | string | Yes | Name of the event (e.g., "starts", "completions") |
| `profileId` | string | No | User's profile ID for attribution |
| `urlSlug` | string | No | World slug for world-level analytics |
| `uniqueKey` | string | No | Deduplication key to prevent duplicate counts |
| `incrementBy` | number | No | Amount to increment (for counter analytics) |

---

## Basic Analytics Pattern

Track an event when a user performs an action:

```ts
import { Visitor } from "../utils/topiaInit.js";
import { getCredentials, errorHandler } from "../utils/index.js";

export const handleStartGame = async (req: Request, res: Response) => {
  try {
    const credentials = getCredentials(req.query);
    const { urlSlug, visitorId, profileId } = credentials;

    const visitor = await Visitor.get(visitorId, urlSlug, { credentials });

    // Track the "starts" event
    await visitor.updateDataObject(
      { gameStarted: true },
      {
        analytics: [
          {
            analyticName: "starts",
            profileId,
            urlSlug,
            uniqueKey: profileId,  // One "start" per user
          },
        ],
      },
    );

    return res.json({ success: true });
  } catch (error) {
    return errorHandler({ error, functionName: "handleStartGame", message: "Error", req, res });
  }
};
```

---

## Analytics with Data Updates

Most commonly, you track analytics alongside meaningful data changes:

```ts
export const handleCompleteChallenge = async (req: Request, res: Response) => {
  try {
    const credentials = getCredentials(req.query);
    const { urlSlug, visitorId, profileId, assetId } = credentials;

    const keyAsset = await DroppedAsset.get(assetId, urlSlug, { credentials });

    // Update game state AND track completion
    await keyAsset.updateDataObject(
      {
        [`completions.${profileId}`]: true,
        lastCompletedBy: profileId,
        lastCompletedAt: new Date().toISOString(),
      },
      {
        analytics: [
          {
            analyticName: "completions",
            profileId,
            urlSlug,
            uniqueKey: profileId,
          },
        ],
      },
    );

    return res.json({ success: true });
  } catch (error) {
    return errorHandler({ error, functionName: "handleCompleteChallenge", message: "Error", req, res });
  }
};
```

---

## Analytics Without Data Changes

You can track analytics without modifying the data object by passing an empty object:

```ts
// Track analytics only - no data changes
await visitor.updateDataObject(
  {},  // Empty object - no data changes
  {
    analytics: [
      {
        analyticName: "pageViews",
        profileId,
        urlSlug,
        uniqueKey: `${profileId}-${Date.now()}`,  // Allow multiple views
      },
    ],
  },
);
```

### Track on Read Operations

Track when users view content without changing state:

```ts
export const handleGetGameState = async (req: Request, res: Response) => {
  try {
    const credentials = getCredentials(req.query);
    const { urlSlug, visitorId, profileId, assetId } = credentials;

    const visitor = await Visitor.get(visitorId, urlSlug, { credentials });
    await visitor.fetchDataObject();

    // Track that user viewed the game (analytics only)
    await visitor.updateDataObject(
      {},
      {
        analytics: [
          {
            analyticName: "views",
            profileId,
            urlSlug,
            uniqueKey: `${profileId}-view`,
          },
        ],
      },
    );

    return res.json({
      success: true,
      data: visitor.dataObject,
    });
  } catch (error) {
    return errorHandler({ error, functionName: "handleGetGameState", message: "Error", req, res });
  }
};
```

---

## Common Analytics Events

### Standard Event Names

| Event | When to Track | Unique Key Pattern |
|-------|---------------|-------------------|
| `starts` | User begins activity | `profileId` |
| `completions` | User finishes activity | `profileId` |
| `wins` | User wins a game | `profileId` |
| `clicks` | User clicks/interacts | `${profileId}-${timestamp}` |
| `views` | User views content | `${profileId}-view` |
| `teleports` | User teleports | `${profileId}` |
| `itemsCollected` | User collects item | `${profileId}-${itemId}` |
| `badgesAwarded` | User earns badge | `${profileId}-${badgeId}` |

### Game-Specific Events

```ts
// Track game win
await keyAsset.updateDataObject(
  { winner: visitorId, isGameOver: true },
  {
    analytics: [
      // Winner gets "wins" event
      { analyticName: "wins", profileId: winnerProfileId, urlSlug, uniqueKey: winnerProfileId },
      // Both players get "completions" event
      { analyticName: "completions", profileId: player1ProfileId, urlSlug, uniqueKey: player1ProfileId },
      { analyticName: "completions", profileId: player2ProfileId, urlSlug, uniqueKey: player2ProfileId },
    ],
  },
);

// Track game tie/draw
await keyAsset.updateDataObject(
  { isDraw: true, isGameOver: true },
  {
    analytics: [
      { analyticName: "ties", profileId: player1ProfileId, urlSlug, uniqueKey: player1ProfileId },
      { analyticName: "ties", profileId: player2ProfileId, urlSlug, uniqueKey: player2ProfileId },
      { analyticName: "completions", profileId: player1ProfileId, urlSlug, uniqueKey: player1ProfileId },
      { analyticName: "completions", profileId: player2ProfileId, urlSlug, uniqueKey: player2ProfileId },
    ],
  },
);
```

### Quest/Collection Events

```ts
// Track item collection
await visitor.updateDataObject(
  { [`collected.${itemId}`]: true },
  {
    analytics: [
      {
        analyticName: "itemsCollected",
        profileId,
        urlSlug,
        uniqueKey: `${profileId}-${itemId}`,  // One per item per user
      },
    ],
  },
);

// Track quest completion
const isQuestComplete = collectedCount >= totalItems;
if (isQuestComplete) {
  await visitor.updateDataObject(
    { questComplete: true, completedAt: new Date().toISOString() },
    {
      analytics: [
        { analyticName: "completions", profileId, urlSlug, uniqueKey: profileId },
      ],
    },
  );
}
```

---

## Unique Key Patterns

The `uniqueKey` prevents duplicate analytics. Choose the pattern based on your needs:

### One Event Per User (Most Common)

```ts
// User can only "complete" once
uniqueKey: profileId

// User can only collect each item once
uniqueKey: `${profileId}-${itemId}`

// User can only earn each badge once
uniqueKey: `${profileId}-${badgeName}`
```

### Multiple Events Per User

```ts
// Track every click (timestamp makes each unique)
uniqueKey: `${profileId}-${Date.now()}`

// Track daily activity (one per day)
uniqueKey: `${profileId}-${new Date().toISOString().split('T')[0]}`

// Track per-session activity
uniqueKey: `${profileId}-${sessionId}`
```

### No Deduplication

```ts
// Omit uniqueKey to count every occurrence
analytics: [
  {
    analyticName: "interactions",
    profileId,
    urlSlug,
    // No uniqueKey - counts every time
  },
],
```

---

## Increment Analytics

For counter-based analytics, use `incrementBy`:

```ts
// Increment score by 10 points
await visitor.incrementDataObjectValue("score", 10, {
  analytics: [
    {
      analyticName: "pointsEarned",
      profileId,
      urlSlug,
      uniqueKey: `${profileId}-${Date.now()}`,
      incrementBy: 10,
    },
  ],
});

// Track multiple item collection
await visitor.updateDataObject(
  { totalCollected: newTotal },
  {
    analytics: [
      {
        analyticName: "itemsCollected",
        profileId,
        urlSlug,
        uniqueKey: `${profileId}-batch-${Date.now()}`,
        incrementBy: itemsCollectedThisAction,
      },
    ],
  },
);
```

---

## Multiple Analytics in One Call

Track multiple events in a single operation:

```ts
await keyAsset.updateDataObject(
  {
    isGameOver: true,
    winner: visitorId,
    turnCount: finalTurnCount,
  },
  {
    analytics: [
      // Track the win
      {
        analyticName: "wins",
        profileId,
        urlSlug,
        uniqueKey: profileId,
      },
      // Track completion for winner
      {
        analyticName: "completions",
        profileId,
        urlSlug,
        uniqueKey: profileId,
      },
      // Track completion for opponent
      {
        analyticName: "completions",
        profileId: opponentProfileId,
        urlSlug,
        uniqueKey: opponentProfileId,
      },
      // Track total games played (no uniqueKey - counts all)
      {
        analyticName: "gamesPlayed",
        urlSlug,
      },
    ],
  },
);
```

---

## Conditional Analytics

Track analytics based on conditions:

```ts
export const handleCheckpointReached = async (req: Request, res: Response) => {
  try {
    const credentials = getCredentials(req.query);
    const { urlSlug, profileId } = credentials;
    const { checkpointNumber, totalCheckpoints } = req.body;

    const analytics: AnalyticType[] = [];

    // Always track checkpoint progress
    analytics.push({
      analyticName: "checkpointsReached",
      profileId,
      urlSlug,
      uniqueKey: `${profileId}-checkpoint-${checkpointNumber}`,
    });

    // Track completion only on final checkpoint
    if (checkpointNumber === totalCheckpoints) {
      analytics.push({
        analyticName: "completions",
        profileId,
        urlSlug,
        uniqueKey: profileId,
      });
    }

    await visitor.updateDataObject(
      { lastCheckpoint: checkpointNumber },
      { analytics },
    );

    return res.json({ success: true });
  } catch (error) {
    return errorHandler({ error, functionName: "handleCheckpointReached", message: "Error", req, res });
  }
};
```

---

## Analytics with setDataObject

Track analytics when initializing data:

```ts
export const initializeVisitorProgress = async (visitor: any, credentials: Credentials) => {
  const { profileId, urlSlug } = credentials;

  await visitor.setDataObject(
    {
      initialized: true,
      startedAt: new Date().toISOString(),
      progress: {},
    },
    {
      analytics: [
        {
          analyticName: "starts",
          profileId,
          urlSlug,
          uniqueKey: profileId,
        },
      ],
    },
  );
};
```

---

## Best Practices

### 1. Use Consistent Event Names

```ts
// Good - consistent naming
"starts", "completions", "wins", "itemsCollected"

// Avoid - inconsistent naming
"start", "complete", "victory", "items_collected"
```

### 2. Always Include profileId for User Attribution

```ts
// Good - can attribute to user
{ analyticName: "completions", profileId, urlSlug, uniqueKey: profileId }

// Less useful - can't attribute to specific user
{ analyticName: "completions", urlSlug }
```

### 3. Use uniqueKey Appropriately

```ts
// Good - prevents duplicate completion tracking
uniqueKey: profileId

// Good - allows tracking each item separately
uniqueKey: `${profileId}-${itemId}`

// Bad - timestamp makes every event unique (may not be desired)
uniqueKey: `${profileId}-${Date.now()}`  // Only if you WANT duplicates
```

### 4. Batch Related Analytics

```ts
// Good - single update with multiple analytics
await asset.updateDataObject(data, {
  analytics: [
    { analyticName: "wins", ... },
    { analyticName: "completions", ... },
  ],
});

// Less efficient - multiple separate calls
await asset.updateDataObject(data1, { analytics: [{ analyticName: "wins" }] });
await asset.updateDataObject(data2, { analytics: [{ analyticName: "completions" }] });
```

### 5. Track Both Actions and Outcomes

```ts
// Track the start
analytics: [{ analyticName: "starts", ... }]

// Later, track the outcome
analytics: [
  { analyticName: "completions", ... },
  { analyticName: "wins", ... },  // or "losses" / "ties"
]
```

---

## Type Definition

```ts
type AnalyticType = {
  analyticName: string;
  profileId?: string;
  urlSlug?: string;
  uniqueKey?: string;
  incrementBy?: number;
};
```
