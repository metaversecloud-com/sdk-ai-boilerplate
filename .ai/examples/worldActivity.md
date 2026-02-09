# World Activity & Visual Effects

Use the SDK's World controller to trigger visual effects, particle systems, and activity indicators in the world. These provide visual feedback to users without requiring UI changes.

## Table of Contents

- [Particle Effects](#particle-effects)
- [World Activity Indicators](#world-activity-indicators)
- [Combining Effects](#combining-effects)
- [Common Use Cases](#common-use-cases)

---

## Particle Effects

Trigger particle effects at specific positions in the world. Particles are visual effects like smoke, fireworks, sparkles, etc.

### Basic Particle Effect

```ts
import { World } from "../utils/topiaInit.js";
import { getCredentials, errorHandler } from "../utils/index.js";

export const handleTriggerEffect = async (req: Request, res: Response) => {
  try {
    const credentials = getCredentials(req.query);
    const { urlSlug } = credentials;
    const { x, y } = req.body;

    const world = await World.create(urlSlug, { credentials });

    // Trigger a particle effect at the specified position
    await world.triggerParticle({
      name: "fireworks_1",
      duration: 3,
      position: { x, y },
    });

    return res.json({ success: true });
  } catch (error) {
    return errorHandler({ error, functionName: "handleTriggerEffect", message: "Error", req, res });
  }
};
```

### Particle Options

```ts
world.triggerParticle({
  name: string;       // Particle effect name (see available effects below)
  duration: number;   // Duration in seconds
  position: {
    x: number;        // X coordinate in world
    y: number;        // Y coordinate in world
  };
});
```

### Available Particle Effects

Common particle effects you can use:

| Effect Name       | Description              | Best For                  |
| ----------------- | ------------------------ | ------------------------- |
| `fireworks_1`     | Colorful fireworks burst | Celebrations, wins        |
| `confetti_1`      | Confetti shower          | Completions, achievements |
| `sparkle_1`       | Sparkle/glitter effect   | Collection, power-ups     |
| `smoke_puff`      | Smoke puff               | Disappearing, removal     |
| `blackSmoke_puff` | Dark smoke puff          | Destruction, removal      |
| `explosion_1`     | Explosion effect         | Impact, dramatic moments  |
| `hearts_1`        | Floating hearts          | Love, appreciation        |
| `stars_1`         | Star burst               | Success, leveling up      |

### Particle at Asset Position

Trigger an effect at a dropped asset's location:

```ts
export const handleRemoveWithEffect = async (req: Request, res: Response) => {
  try {
    const credentials = getCredentials(req.query);
    const { urlSlug, assetId } = credentials;

    // Get the asset to find its position
    const droppedAsset = await DroppedAsset.get(assetId, urlSlug, { credentials });
    const { position } = droppedAsset;

    const world = await World.create(urlSlug, { credentials });

    // Trigger smoke effect at asset position
    world.triggerParticle({
      name: "blackSmoke_puff",
      duration: 5,
      position,
    });

    // Delete the dropped asset from the world.
    // This should always be done last to ensure all functionality in this controller using credentials will work as expected.
    await droppedAsset.deleteDroppedAsset();

    return res.json({ success: true });
  } catch (error) {
    return errorHandler({ error, functionName: "handleRemoveWithEffect", message: "Error", req, res });
  }
};
```

### Fire-and-Forget Pattern

Particle effects should not block other operations:

```ts
// RECOMMENDED: Don't await, use .catch() for error handling
world
  .triggerParticle({
    name: "confetti_1",
    duration: 3,
    position,
  })
  .catch((error) =>
    errorHandler({
      error,
      functionName: "handleComplete",
      message: "Error triggering particle",
    }),
  );

// Continue with other operations immediately
await keyAsset.updateDataObject({ completed: true });
```

---

## World Activity Indicators

Trigger activity indicators that appear on assets to show game state or status.

### Basic Activity Trigger

```ts
import { World, WorldActivityType } from "../utils/topiaInit.js";

export const handleGameStart = async (req: Request, res: Response) => {
  try {
    const credentials = getCredentials(req.query);
    const { urlSlug, assetId } = credentials;

    const world = await World.create(urlSlug, { credentials });

    // Trigger "game on" activity indicator
    await world.triggerActivity({
      type: WorldActivityType.GAME_ON,
      assetId,
    });

    return res.json({ success: true });
  } catch (error) {
    return errorHandler({ error, functionName: "handleGameStart", message: "Error", req, res });
  }
};
```

### Activity Types

```ts
// Import the activity type enum
import { WorldActivityType } from "@rtsdk/topia";

// Available activity types
WorldActivityType.GAME_ON; // Game is active/in progress
WorldActivityType.GAME_WAITING; // Waiting for players
WorldActivityType.GAME_OVER; // Game has ended
```

### Activity for Game State Changes

```ts
export const handlePlayerJoin = async (req: Request, res: Response) => {
  try {
    const credentials = getCredentials(req.query);
    const { urlSlug, assetId } = credentials;
    const { playerCount } = req.body;

    const world = await World.create(urlSlug, { credentials });

    // Show different indicators based on player count
    if (playerCount === 2) {
      // Both players joined - game can start
      await world.triggerActivity({
        type: WorldActivityType.GAME_ON,
        assetId,
      });
    } else if (playerCount === 1) {
      // Waiting for second player
      await world.triggerActivity({
        type: WorldActivityType.GAME_WAITING,
        assetId,
      });
    }

    return res.json({ success: true });
  } catch (error) {
    return errorHandler({ error, functionName: "handlePlayerJoin", message: "Error", req, res });
  }
};
```

---

## Combining Effects

### Particle + Toast + Data Update

Complete feedback pattern for user actions:

```ts
export const handleCollectItem = async (req: Request, res: Response) => {
  try {
    const credentials = getCredentials(req.query);
    const { urlSlug, visitorId, profileId, assetId } = credentials;
    const { itemId } = req.body;

    const world = await World.create(urlSlug, { credentials });
    const visitor = await Visitor.get(visitorId, urlSlug, { credentials });
    const droppedAsset = await DroppedAsset.get(assetId, urlSlug, { credentials });

    // 1. Trigger sparkle effect at item location
    world
      .triggerParticle({
        name: "sparkle_1",
        duration: 2,
        position: droppedAsset.position,
      })
      .catch((error) => console.error("Particle error:", error));

    // 2. Show toast notification
    visitor
      .fireToast({
        groupId: "collection",
        title: "Item Collected!",
        text: `You found the ${itemId}!`,
      })
      .catch((error) => console.error("Toast error:", error));

    // 3. Update data (this is the main operation - await it)
    await visitor.updateDataObject(
      { [`collected.${itemId}`]: true },
      {
        analytics: [{ analyticName: "itemsCollected", profileId, urlSlug, uniqueKey: `${profileId}-${itemId}` }],
      },
    );

    return res.json({ success: true });
  } catch (error) {
    return errorHandler({ error, functionName: "handleCollectItem", message: "Error", req, res });
  }
};
```

### Particle + Activity + State Update

For game state transitions:

```ts
export const handleGameEnd = async (req: Request, res: Response) => {
  try {
    const credentials = getCredentials(req.query);
    const { urlSlug, assetId, visitorId, profileId } = credentials;
    const { winnerId } = req.body;

    const world = await World.create(urlSlug, { credentials });
    const keyAsset = await DroppedAsset.get(assetId, urlSlug, { credentials });

    // All effects can run in parallel with the data update
    await Promise.all([
      // Fireworks at the game board
      world
        .triggerParticle({
          name: "fireworks_1",
          duration: 5,
          position: keyAsset.position,
        })
        .catch((error) => console.error("Particle error:", error)),

      // Update activity indicator to "game over"
      world
        .triggerActivity({
          type: WorldActivityType.GAME_OVER,
          assetId,
        })
        .catch((error) => console.error("Activity error:", error)),

      // Update game state (main operation)
      keyAsset.updateDataObject(
        {
          isGameOver: true,
          winner: winnerId,
        },
        {
          analytics: [{ analyticName: "completions", profileId, urlSlug, uniqueKey: profileId }],
        },
      ),
    ]);

    return res.json({ success: true });
  } catch (error) {
    return errorHandler({ error, functionName: "handleGameEnd", message: "Error", req, res });
  }
};
```

### Sequential Effects

Sometimes you want effects in a specific order:

```ts
export const handleLevelUp = async (req: Request, res: Response) => {
  try {
    const credentials = getCredentials(req.query);
    const { urlSlug, visitorId } = credentials;
    const { position, newLevel } = req.body;

    const world = await World.create(urlSlug, { credentials });
    const visitor = await Visitor.get(visitorId, urlSlug, { credentials });

    // 1. First effect - sparkles
    world
      .triggerParticle({
        name: "sparkle_1",
        duration: 1,
        position,
      })
      .catch(() => {});

    // 2. Short delay, then bigger effect
    setTimeout(() => {
      world
        .triggerParticle({
          name: "stars_1",
          duration: 3,
          position,
        })
        .catch(() => {});
    }, 500);

    // 3. Toast notification
    visitor
      .fireToast({
        groupId: "levelUp",
        title: "Level Up!",
        text: `You reached level ${newLevel}!`,
      })
      .catch(() => {});

    return res.json({ success: true });
  } catch (error) {
    return errorHandler({ error, functionName: "handleLevelUp", message: "Error", req, res });
  }
};
```

---

## Common Use Cases

### Item Collection

```ts
// Sparkle + collection sound implied
world.triggerParticle({
  name: "sparkle_1",
  duration: 2,
  position: itemPosition,
});
```

### Achievement/Badge Earned

```ts
// Stars for achievement
world.triggerParticle({
  name: "stars_1",
  duration: 3,
  position: visitorPosition,
});

// Or confetti for bigger achievements
world.triggerParticle({
  name: "confetti_1",
  duration: 4,
  position: visitorPosition,
});
```

### Game Win

```ts
// Fireworks for victory
world.triggerParticle({
  name: "fireworks_1",
  duration: 5,
  position: gamePosition,
});

// Plus activity indicator
world.triggerActivity({
  type: WorldActivityType.GAME_OVER,
  assetId: gameAssetId,
});
```

### Asset Removal/Destruction

```ts
// Smoke puff when removing
world.triggerParticle({
  name: "blackSmoke_puff",
  duration: 3,
  position: assetPosition,
});

// Then delete the asset
await droppedAsset.deleteDroppedAsset();
```

### Checkpoint Reached (Race)

```ts
// Brief sparkle at checkpoint
world.triggerParticle({
  name: "sparkle_1",
  duration: 1,
  position: checkpointPosition,
});
```

### Player Waiting

```ts
// Activity indicator showing game is waiting
world.triggerActivity({
  type: WorldActivityType.GAME_WAITING,
  assetId,
});
```

---

## Best Practices

### 1. Don't Await Visual Effects

Effects should be fire-and-forget:

```ts
// Good - doesn't block
world.triggerParticle({ ... }).catch(() => {});

// Avoid - blocks other operations unnecessarily
await world.triggerParticle({ ... });
```

### 2. Use Appropriate Durations

| Effect Type                     | Recommended Duration |
| ------------------------------- | -------------------- |
| Quick feedback (collection)     | 1-2 seconds          |
| Celebrations (win, achievement) | 3-5 seconds          |
| Removal effects                 | 2-3 seconds          |

### 3. Match Effect to Action

| Action         | Effect                            |
| -------------- | --------------------------------- |
| Collect item   | `sparkle_1`                       |
| Win game       | `fireworks_1`                     |
| Complete quest | `confetti_1`                      |
| Remove/destroy | `smoke_puff` or `blackSmoke_puff` |
| Level up       | `stars_1`                         |

### 4. Combine with Other Feedback

Always pair visual effects with:

- Toast notifications (for text feedback)
- Data updates (for persistence)
- Analytics (for tracking)

### 5. Handle Errors Gracefully

```ts
// Particle errors should never break the main flow
world.triggerParticle({ ... }).catch((error) =>
  console.error("Non-critical particle error:", error)
);
```

---

## SDK Method Reference

```ts
// Particle effects
await world.triggerParticle({
  name: string;        // Effect name
  duration: number;    // Seconds
  position: { x: number; y: number };
});

// Activity indicators
await world.triggerActivity({
  type: WorldActivityType;  // GAME_ON, GAME_WAITING, GAME_OVER
  assetId: string;          // Asset to show indicator on
});
```
