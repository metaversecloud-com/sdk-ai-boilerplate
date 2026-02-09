# Visitor Interactions

Use the SDK's Visitor controller to interact with visitors in the world: display toast notifications, move/teleport visitors, and manage iframes.

## Table of Contents

- [fireToast - Display Notifications](#firetoast---display-notifications)
- [moveVisitor - Move or Teleport](#movevisitor---move-or-teleport)
- [closeIframe - Close UI Panels](#closeiframe---close-ui-panels)
- [openIframe - Open UI Panels](#openiframe---open-ui-panels)
- [Combined Patterns](#combined-patterns)

---

## fireToast - Display Notifications

Display toast notifications to visitors. Toasts appear as temporary messages in the Topia client.

```ts
/**
 * Display a toast notification to a visitor
 *
 * @param groupId - Groups related toasts (e.g., by feature or theme)
 * @param title - Bold header text for the toast
 * @param text - Body text with details
 */
import { Visitor } from "../utils/topiaInit.js";
import { getCredentials, errorHandler } from "../utils/index.js";

// Basic toast notification
await visitor.fireToast({
  groupId: "myFeature",
  title: "Success!",
  text: "Your action was completed successfully.",
});

// Toast with emoji in title (common pattern)
await visitor.fireToast({
  groupId: "race",
  title: "✅ Checkpoint 3",
  text: "Great progress! Keep going!",
});

// Toast for errors/warnings
await visitor.fireToast({
  groupId: "validation",
  title: "⚠️ Invalid Action",
  text: "You need to complete the previous step first.",
});
```

### Best Practice: Fire-and-Forget with Error Handling

Toast notifications should not block other operations. Always use `.catch()` to prevent errors from interrupting the main flow:

```ts
// RECOMMENDED: Fire-and-forget pattern
visitor
  .fireToast({
    groupId: "badges",
    title: "Badge Awarded",
    text: `You earned the ${badgeName} badge!`,
  })
  .catch((error) =>
    errorHandler({
      error,
      functionName: "awardBadge",
      message: "Error firing toast",
    }),
  );

// Continue with other operations - don't wait for toast
await droppedAsset.updateDataObject({ score: newScore });
```

### Parallel Toast with Other Operations

When you need to fire a toast alongside other SDK calls:

```ts
await Promise.all([
  // Main operation
  keyAsset.updateDataObject({ completed: true }),

  // Toast notification (with its own error handling)
  visitor.fireToast({
    groupId: theme,
    title: "Congratulations!",
    text: "You completed the challenge!",
  }).catch((error) =>
    errorHandler({ error, functionName: "handleComplete", message: "Error firing toast" })
  ),
]);
```

---

## moveVisitor - Move or Teleport

Move a visitor to a specific position in the world. Supports both walking animation and instant teleport.

```ts
/**
 * Move a visitor to a position
 *
 * @param x - X coordinate in the world
 * @param y - Y coordinate in the world
 * @param shouldTeleportVisitor - true = instant teleport, false = walking animation
 */

// Walking animation (smooth movement)
await visitor.moveVisitor({
  x: 150,
  y: 200,
  shouldTeleportVisitor: false,
});

// Instant teleport
await visitor.moveVisitor({
  x: 150,
  y: 200,
  shouldTeleportVisitor: true,
});
```

### Move to a Dropped Asset's Position

Common pattern: move visitor to where an asset is located.

```ts
import { DroppedAsset, Visitor } from "../utils/topiaInit.js";
import { getCredentials, errorHandler } from "../utils/index.js";

export const handleMoveToAsset = async (req: Request, res: Response) => {
  try {
    const credentials = getCredentials(req.query);
    const { assetId, urlSlug, visitorId } = credentials;
    const { targetAssetId } = req.body;

    // Get the target asset to find its position
    const targetAsset = await DroppedAsset.get(targetAssetId, urlSlug, { credentials });
    const { x, y } = targetAsset.position;

    // Get the visitor
    const visitor = await Visitor.get(visitorId, urlSlug, { credentials });

    // Move visitor to the asset's position
    await visitor.moveVisitor({
      x,
      y,
      shouldTeleportVisitor: false, // Walking animation
    });

    return res.json({ success: true });
  } catch (error) {
    return errorHandler({
      error,
      functionName: "handleMoveToAsset",
      message: "Error moving visitor to asset",
      req,
      res,
    });
  }
};
```

### Move to Start Position (Race/Game Pattern)

Fetch a specific anchor asset and teleport the visitor there:

```ts
import { Visitor, World } from "../utils/topiaInit.js";

export const handleStartRace = async (req: Request, res: Response) => {
  try {
    const credentials = getCredentials(req.query);
    const { urlSlug, visitorId, sceneDropId } = credentials;

    const world = await World.create(urlSlug, { credentials });
    const visitor = await Visitor.get(visitorId, urlSlug, { credentials });

    // Find the start line asset by unique name
    const startAssets = await world.fetchDroppedAssetsBySceneDropId({
      sceneDropId,
      uniqueName: "race-track-start",
    });

    const startLine = startAssets?.[0];
    if (!startLine) throw new Error("Start line not found");

    // Teleport visitor to start position
    await visitor.moveVisitor({
      x: startLine.position.x,
      y: startLine.position.y,
      shouldTeleportVisitor: true,
    });

    return res.json({ success: true });
  } catch (error) {
    return errorHandler({ error, functionName: "handleStartRace", message: "Error starting race", req, res });
  }
};
```

### Track Teleports with Analytics

```ts
// Move the visitor
await visitor.moveVisitor({
  x: droppedAsset.position.x,
  y: droppedAsset.position.y,
  shouldTeleportVisitor: true,
});

// Track the teleport action via analytics (even with empty data update)
await visitor.updateDataObject(
  {},
  {
    analytics: [
      {
        analyticName: "teleports",
        profileId,
        urlSlug,
        uniqueKey: profileId,
      },
    ],
  },
);
```

---

## closeIframe - Close UI Panels

Close an iframe that was opened for a visitor. Commonly used after completing an action or when moving the visitor.

```ts
/**
 * Close an iframe for a visitor
 *
 * @param droppedAssetId - The ID of the dropped asset whose iframe should close
 */

// Basic close - fire and forget
visitor.closeIframe(assetId).catch((error) =>
  errorHandler({
    error,
    functionName: "handleAction",
    message: "Error closing iframe",
  }),
);
```

### Close Iframe Then Move Visitor

Common pattern: close the UI panel, then move the visitor to a new location.

```ts
export const handleMoveToDroppedAsset = async (req: Request, res: Response) => {
  try {
    const credentials = getCredentials(req.query);
    const { assetId, urlSlug, visitorId } = credentials;
    const { targetAssetId, closeIframeAfterMove } = req.body;

    const targetAsset = await DroppedAsset.get(targetAssetId, urlSlug, { credentials });
    const visitor = await Visitor.get(visitorId, urlSlug, { credentials });

    const { x, y } = targetAsset.position;

    // Move visitor to target
    await visitor.moveVisitor({
      x,
      y,
      shouldTeleportVisitor: false,
    });

    // Optionally close the iframe after moving
    if (closeIframeAfterMove) {
      visitor.closeIframe(assetId).catch((error) =>
        errorHandler({
          error,
          functionName: "handleMoveToDroppedAsset",
          message: "Error closing iframe",
        }),
      );
    }

    return res.json({ success: true });
  } catch (error) {
    return errorHandler({ error, functionName: "handleMoveToDroppedAsset", message: "Error", req, res });
  }
};
```

### Close Iframe for Multiple Visitors (Multiplayer)

When a game ends or resets, close iframes for all participants:

```ts
/**
 * Close iframe for multiple visitors (e.g., when game ends)
 *
 * @param visitors - Object containing visitor instances keyed by ID
 * @param droppedAssetId - The asset ID to close
 */
export const closeIframeForVisitors = async (
  visitors: { [key: string]: Visitor },
  droppedAssetId: string,
) => {
  // Skip in development for easier testing
  if (process.env.NODE_ENV === "development") return;

  const visitorsArr = Object.values(visitors);

  const promises = visitorsArr.map((visitor) => {
    if (visitor) {
      return visitor.closeIframe(droppedAssetId).catch((error) =>
        errorHandler({
          error,
          functionName: "closeIframeForVisitors",
          message: "Error closing iframe for visitor",
        }),
      );
    }
    return Promise.resolve();
  });

  await Promise.allSettled(promises);
};
```

---

## openIframe - Open UI Panels

Open an iframe for a visitor, optionally in a drawer panel.

```ts
/**
 * Open an iframe for a visitor
 *
 * @param droppedAssetId - The asset that "owns" this iframe
 * @param link - URL to load in the iframe
 * @param shouldOpenInDrawer - true = side panel, false = modal
 * @param title - Title shown in the iframe header
 */

// Open in drawer (side panel)
await visitor.openIframe({
  droppedAssetId: assetId,
  link: `${process.env.CLIENT_URL}?page=quiz`,
  shouldOpenInDrawer: true,
  title: "Quiz",
});

// Open as modal
await visitor.openIframe({
  droppedAssetId: assetId,
  link: `${process.env.CLIENT_URL}?page=settings`,
  shouldOpenInDrawer: false,
  title: "Settings",
});
```

### Close Then Open Pattern

When switching between iframes, close the current one first:

```ts
export const handleOpenNewIframe = async (req: Request, res: Response) => {
  try {
    const credentials = getCredentials(req.query);
    const { assetId, urlSlug, visitorId } = credentials;
    const { newPage } = req.body;

    const visitor = await Visitor.get(visitorId, urlSlug, { credentials });

    // Close any existing iframe first
    await visitor.closeIframe(assetId).catch((error) =>
      errorHandler({ error, functionName: "handleOpenNewIframe", message: "Error closing iframe" }),
    );

    // Open the new iframe
    await visitor.openIframe({
      droppedAssetId: assetId,
      link: `${process.env.CLIENT_URL}?page=${newPage}`,
      shouldOpenInDrawer: true,
      title: newPage.charAt(0).toUpperCase() + newPage.slice(1),
    });

    return res.json({ success: true });
  } catch (error) {
    return errorHandler({ error, functionName: "handleOpenNewIframe", message: "Error", req, res });
  }
};
```

---

## Combined Patterns

### Complete Action with Feedback

A common flow: update data, show toast, close iframe, move visitor.

```ts
export const handleCompleteChallenge = async (req: Request, res: Response) => {
  try {
    const credentials = getCredentials(req.query);
    const { assetId, urlSlug, visitorId, profileId } = credentials;

    const visitor = await Visitor.get(visitorId, urlSlug, { credentials });
    const keyAsset = await DroppedAsset.get(assetId, urlSlug, { credentials });

    // 1. Update game state
    await keyAsset.updateDataObject(
      { [`completions.${profileId}`]: true },
      { analytics: [{ analyticName: "completions", profileId, urlSlug, uniqueKey: profileId }] },
    );

    // 2. Show success toast (fire-and-forget)
    visitor.fireToast({
      groupId: "challenge",
      title: "🎉 Challenge Complete!",
      text: "You've successfully completed the challenge.",
    }).catch((error) => console.error("Toast error:", error));

    // 3. Close the iframe
    visitor.closeIframe(assetId).catch((error) => console.error("Close iframe error:", error));

    // 4. Move visitor to reward area
    const rewardAsset = await DroppedAsset.get(rewardAssetId, urlSlug, { credentials });
    await visitor.moveVisitor({
      x: rewardAsset.position.x,
      y: rewardAsset.position.y,
      shouldTeleportVisitor: false,
    });

    return res.json({ success: true });
  } catch (error) {
    return errorHandler({ error, functionName: "handleCompleteChallenge", message: "Error", req, res });
  }
};
```

### Parallel Operations with Promise.all

When multiple visitor interactions can happen simultaneously:

```ts
// All these can run in parallel
await Promise.all([
  // Update data with analytics
  visitor.updateDataObject(
    { challengeCompleted: true },
    { analytics: [{ analyticName: "completions" }] },
  ),

  // Toast notification
  visitor.fireToast({
    groupId: "challenge",
    title: "Congratulations!",
    text,
  }).catch((error) => errorHandler({ error, functionName: "handleAnswer", message: "Toast error" })),

  // Trigger particle effect
  world.triggerParticle({
    name: "fireworks_1",
    duration: 3,
    position: droppedAsset.position,
  }).catch((error) => errorHandler({ error, functionName: "handleAnswer", message: "Particle error" })),
]);
```

---

## SDK Method Reference

| Method | Purpose | Fire-and-Forget? |
|--------|---------|------------------|
| `visitor.fireToast({ groupId, title, text })` | Display notification | Yes |
| `visitor.moveVisitor({ x, y, shouldTeleportVisitor })` | Move/teleport visitor | No (await) |
| `visitor.closeIframe(droppedAssetId)` | Close UI panel | Yes |
| `visitor.openIframe({ droppedAssetId, link, shouldOpenInDrawer, title })` | Open UI panel | No (await) |

**Fire-and-Forget**: Use `.catch()` without `await` - errors logged but don't block execution.
