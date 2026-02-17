# Claude Prompts for SDK Features

This document contains ideal prompts to give Claude for implementing common SDK features. Each prompt references the corresponding example documentation.

## Badges System

### Add Complete Badges Feature
```
Add a badges system to this app:
1. Create getBadges utility to fetch ecosystem badges (see sdk-ai-boilerplate examples/badges.md)
2. Create getVisitorBadges utility to get visitor's owned badges
3. Update the main controller to return badges and visitorInventory
4. Add BadgeType and VisitorInventoryType to client context
5. Display badges in a tabbed UI with owned badges in color and unowned grayed out
```

### Add Inventory Cache
```
Add cached inventory for badges (see sdk-ai-boilerplate examples/inventoryCache.md):
1. Add EcosystemFactory to topiaInit.ts
2. Create inventoryCache.ts with 24-hour TTL cache
3. Export from utils/index.ts
```

### Award Badge to Visitor
```
Add functionality to award a badge to a visitor (see sdk-ai-boilerplate examples/awardBadge.md):
1. Check if visitor already has the badge
2. Get badge from cached inventory items
3. Grant badge using visitor.grantInventoryItem()
4. Show toast notification
```

## Assets

### Drop Assets into World
```
Add ability to drop assets into the world (see sdk-ai-boilerplate examples/handleDropAssets.md):
1. Get position from existing dropped asset
2. Create web image asset using Asset.create()
3. Drop asset using DroppedAsset.drop() with position, layers, and click settings
4. Optionally add text asset at offset position
```

### Remove Dropped Asset
```
Add ability to remove a dropped asset (see sdk-ai-boilerplate examples/handleRemoveDroppedAsset.md):
1. Get the dropped asset by ID
2. Trigger particle effect at asset position
3. Close the iframe for the visitor
4. Fire toast notification
5. Delete the dropped asset
```

### Bulk Remove Dropped Assets
```
Add ability to remove multiple dropped assets (see sdk-ai-boilerplate examples/handleRemoveDroppedAssets.md):
1. Get all dropped assets by unique name pattern
2. Delete each asset
3. Handle errors gracefully
```

### Update Dropped Asset
```
Add ability to update a dropped asset (see sdk-ai-boilerplate examples/handleUpdateDroppedAsset.md):
1. Get the dropped asset by ID
2. Update properties using droppedAsset.updateCustomTextAsset() or updateDataObject()
3. Return success response
```

## Configuration

### Get World Configuration
```
Add configuration endpoint (see sdk-ai-boilerplate examples/handleGetConfiguration.md):
1. Get world data object with theme configuration
2. Get visitor to check admin status
3. Get available expressions/emotes
4. Return configuration data to client
```

### Get Anchor Assets
```
Add utility to fetch anchor assets (see sdk-ai-boilerplate examples/getAnchorAssets.md):
1. Use World.fetchDroppedAssetsWithUniqueName()
2. Filter by scene and unique name pattern
3. Return positioned assets for game logic
```

## Game State

### Reset Game State
```
Add admin-only game reset functionality (see sdk-ai-boilerplate examples/handleResetGameState.md):
1. Check if visitor is admin
2. Clear world data object for scene
3. Remove all dropped assets with scene prefix
4. Reset visitor progress
5. Fire confirmation toast
```

## Leaderboards

### Add Complete Leaderboard Feature
```
Add a leaderboard system to this app (see sdk-ai-boilerplate examples/leaderboard.md):
1. Create updateLeaderboard utility to store visitor progress as pipe-delimited string
2. Update game completion handler to call updateLeaderboard
3. Fetch and parse leaderboard in main controller (admin-only)
4. Add LeaderboardEntryType to client context
5. Display leaderboard in admin UI with table showing rank, name, score, and status
```

### Add Leaderboard Update Utility
```
Add utility to update leaderboard (see sdk-ai-boilerplate examples/leaderboard.md):
1. Store data as pipe-delimited string: "displayName|score|status"
2. Use keyAsset.updateDataObject() with leaderboard.${profileId} path
3. Handle initial leaderboard creation if it doesn't exist
```

### Add Leaderboard Display
```
Add leaderboard table to admin UI (see sdk-ai-boilerplate examples/leaderboard.md):
1. Add leaderboard to context types and reducer
2. Fetch leaderboard from server (admin-only)
3. Create table with rank, name, metrics columns
4. Sort by completion status first, then by score
```

### Remove Leaderboard Entry on Restart
```
Add leaderboard entry removal when visitor restarts (see sdk-ai-boilerplate examples/leaderboard.md):
1. Fetch key asset data object
2. Delete the profileId key from leaderboard object
3. Update the entire leaderboard object back to the asset
```

## Visitor Interactions

### Add Toast Notifications
```
Add toast notification functionality (see sdk-ai-boilerplate examples/visitorInteractions.md):
1. Import Visitor from topiaInit
2. Use visitor.fireToast({ groupId, title, text })
3. Wrap in .catch() for fire-and-forget pattern
4. Use groupId to group related notifications
```

### Move Visitor to Asset
```
Add visitor movement to an asset location (see sdk-ai-boilerplate examples/visitorInteractions.md):
1. Get the target dropped asset to find its position
2. Get the visitor instance
3. Call visitor.moveVisitor({ x, y, shouldTeleportVisitor: false })
4. Optionally close iframe after moving
```

### Teleport Visitor
```
Add teleport functionality (see sdk-ai-boilerplate examples/visitorInteractions.md):
1. Get target position from dropped asset or world anchor
2. Call visitor.moveVisitor({ x, y, shouldTeleportVisitor: true })
3. Track teleport via analytics in updateDataObject
```

### Manage Iframes
```
Add iframe open/close functionality (see sdk-ai-boilerplate examples/visitorInteractions.md):
1. Close existing: visitor.closeIframe(assetId)
2. Open new: visitor.openIframe({ droppedAssetId, link, shouldOpenInDrawer, title })
3. Use fire-and-forget pattern with .catch() for close operations
```

## Concurrency & Multiplayer

### Add Locking for Shared State
```
Add locking to prevent race conditions (see sdk-ai-boilerplate examples/lockingPatterns.md):
1. Create time-based lock ID: new Date(Math.round(Date.now() / 5000) * 5000)
2. Include asset ID and context in lock ID
3. Pass lock option: { lock: { lockId, releaseLock: true } }
4. Handle 409 conflicts gracefully
```

### Add Turn-Based Game Logic
```
Add turn-based multiplayer (see sdk-ai-boilerplate examples/lockingPatterns.md):
1. Track lastPlayerTurn (visitorId) in data object
2. Track turnCount for composite lock IDs
3. Validate turn before allowing moves
4. Use locking to prevent simultaneous moves
5. Return 409 if lock conflict occurs
```

### Build Complete Multiplayer Game
```
Build a turn-based multiplayer game (see sdk-ai-boilerplate examples/multiplayerTurnBased.md):
1. Create GameDataType with player slots, turn tracking, and game state
2. Add player selection controller for joining games
3. Add move controller with turn validation and locking
4. Add win detection utility for game-specific rules
5. Add game reset controller
6. Track analytics for wins, completions, and ties
```

### Add Player Selection
```
Add player selection/joining for multiplayer (see sdk-ai-boilerplate examples/multiplayerTurnBased.md):
1. Create player slots in game data (player1, player2)
2. Validate slot is available before joining
3. Update playerCount and trigger world activity
4. Show toast notification to player
```

## Analytics & Tracking

### Add Analytics Tracking
```
Add analytics tracking to the app (see sdk-ai-boilerplate examples/analyticsTracking.md):
1. Pass analytics array to updateDataObject/setDataObject
2. Include analyticName, profileId, urlSlug, uniqueKey
3. Use uniqueKey to control deduplication (profileId for one-per-user)
4. Track starts, completions, wins, and custom events
```

### Track Game Completion
```
Add completion tracking (see sdk-ai-boilerplate examples/analyticsTracking.md):
1. On game end, track "completions" for all players
2. Track "wins" for winner only
3. Track "ties" if applicable
4. Use profileId as uniqueKey for one completion per user
```

## Visual Effects

### Add Particle Effects
```
Add particle effects (see sdk-ai-boilerplate examples/worldActivity.md):
1. Use world.triggerParticle({ name, duration, position })
2. Get position from dropped asset
3. Use fire-and-forget pattern with .catch()
4. Choose effect: fireworks_1, confetti_1, sparkle_1, smoke_puff
```

### Add World Activity Indicators
```
Add activity indicators (see sdk-ai-boilerplate examples/worldActivity.md):
1. Import WorldActivityType from SDK
2. Use world.triggerActivity({ type, assetId })
3. GAME_ON for active games, GAME_WAITING for waiting, GAME_OVER for finished
```

### Add Complete Feedback Flow
```
Add user feedback on action completion (see sdk-ai-boilerplate examples/worldActivity.md):
1. Update data object with changes
2. Trigger particle effect at asset position
3. Show toast notification
4. Optionally trigger world activity indicator
Use Promise.all for parallel execution of non-blocking operations
```

## Data Migration

### Migrate Data Schema
```
Add data migration for schema changes (see sdk-ai-boilerplate examples/dataMigration.md):
1. Check if old key/format exists
2. Convert to new format
3. Write new format with locking
4. Delete old key
5. Make migration idempotent (safe to run multiple times)
```

### Add Version-Based Migration
```
Add versioned data migration (see sdk-ai-boilerplate examples/dataMigration.md):
1. Add _version field to data objects
2. Create migration functions for each version upgrade
3. Apply migrations in sequence on data read
4. Persist migrated data with locking
```

## Combined Features

### Full Game Setup
```
Set up a new game app with these features:
1. Configuration endpoint with theme and emotes (see handleGetConfiguration.md)
2. Badges system with ecosystem and visitor inventory (see badges.md)
3. Asset dropping capability (see handleDropAssets.md)
4. Asset removal with effects (see handleRemoveDroppedAsset.md)
5. Admin reset functionality (see handleResetGameState.md)

Use the patterns from sdk-ai-boilerplate/.ai/examples/ for implementation.
```

### Add Collectibles Feature
```
Add a collectibles/items system:
1. Use inventory cache pattern for ecosystem items (see inventoryCache.md)
2. Track visitor's collected items in visitor data object
3. Award items using visitor.grantInventoryItem()
4. Display collected vs uncollected in UI (see badges.md UI pattern)
5. Show toast notifications on collection
```

## Quick Reference Prompts

| Feature | Prompt |
|---------|--------|
| Badges | "Add badges system (see sdk-ai-boilerplate examples/badges.md)" |
| Inventory Cache | "Add cached inventory (see sdk-ai-boilerplate examples/inventoryCache.md)" |
| Award Badge | "Add badge awarding (see sdk-ai-boilerplate examples/awardBadge.md)" |
| Drop Asset | "Add asset dropping (see sdk-ai-boilerplate examples/handleDropAssets.md)" |
| Remove Asset | "Add asset removal with effects (see sdk-ai-boilerplate examples/handleRemoveDroppedAsset.md)" |
| Configuration | "Add config endpoint (see sdk-ai-boilerplate examples/handleGetConfiguration.md)" |
| Game Reset | "Add admin reset (see sdk-ai-boilerplate examples/handleResetGameState.md)" |
| Leaderboard | "Add leaderboard system (see sdk-ai-boilerplate examples/leaderboard.md)" |
| Toast Notifications | "Add toast notifications (see sdk-ai-boilerplate examples/visitorInteractions.md)" |
| Move/Teleport Visitor | "Add visitor movement (see sdk-ai-boilerplate examples/visitorInteractions.md)" |
| Iframe Management | "Add iframe open/close (see sdk-ai-boilerplate examples/visitorInteractions.md)" |
| Concurrency Locking | "Add locking for multiplayer (see sdk-ai-boilerplate examples/lockingPatterns.md)" |
| Multiplayer Game | "Build turn-based game (see sdk-ai-boilerplate examples/multiplayerTurnBased.md)" |
| Analytics | "Add analytics tracking (see sdk-ai-boilerplate examples/analyticsTracking.md)" |
| Particle Effects | "Add particle effects (see sdk-ai-boilerplate examples/worldActivity.md)" |
| Activity Indicators | "Add world activity indicators (see sdk-ai-boilerplate examples/worldActivity.md)" |
| Data Migration | "Add data migration (see sdk-ai-boilerplate examples/dataMigration.md)" |

## Post-Implementation Finalization

These prompts should be used AFTER the app is implemented to clean up boilerplate and prepare for release.

### Initial Setup Prompt
```
Read through plan.md to see what to build, create an implementation plan, and ask questions before starting.
```

### Clean Up Unused Boilerplate
```
Clean up the boilerplate code by removing any unused utils, components, and types.
Trace imports from controllers and pages to identify what's actually used.
Remove unused files and update barrel exports (index.ts files).
Do NOT remove protected files (PageContainer.tsx, backendAPI.ts, etc.).
```

### Update README
```
Update the README to reflect the new app. Include:
- App name and description
- What visitors see vs. what admins see
- Key features
- API endpoints with request/response shapes
- Data object schemas
- Setup and development instructions
```

### Update Server Tests
```
Update server/tests/routes.test.ts so that it actually tests the new app's routes.
Update the SDK mock (server/mocks/@rtsdk/topia.ts) to include any new factories or methods.
Update the jest.mock("../utils/index.js") block to mock the new utils.
Add tests for each route: success, errors, auth checks, and input validation.
Remove tests for removed boilerplate routes.
```

### Commit and Open PR
```
Commit and push all changes to the dev branch, then open a PR from dev into main
with labels "release" and "major".
```

### All-in-One Finalization
```
Now that the app is implemented, please finalize it:
1. Remove all unused boilerplate code (utils, components, types) and update barrel exports
2. Update the README to describe the new app
3. Update server/tests/routes.test.ts to test the new routes (update mocks too)
4. Commit, push to dev, and open a PR into main with labels "release" and "major"
```

## Tips for Best Results

1. **Reference the example**: Always mention "see sdk-ai-boilerplate examples/[filename].md" so Claude knows which pattern to follow

2. **Be specific about scope**: Mention which parts you need:
   - "server utility only"
   - "full stack with UI"
   - "update existing controller"

3. **Specify the app**: Include the app path:
   - "in sdk-scavenger-hunt"
   - "in sdk-quest"
   - "in this app"

4. **Chain features**: Combine related prompts:
   ```
   Add badges with UI tabs:
   1. Server: getBadges and getVisitorBadges utilities
   2. Controller: return badges and visitorInventory
   3. Client: types, reducer, and tabbed display
   See sdk-ai-boilerplate examples/badges.md
   ```

5. **Update documentation**: After implementation, ask:
   ```
   Update sdk-ai-boilerplate documentation if this pattern is reusable across apps
   ```

6. **For multiplayer/games**: Always include locking:
   ```
   This is a multiplayer feature. Add locking to prevent race conditions.
   See sdk-ai-boilerplate examples/lockingPatterns.md
   ```

7. **For visitor feedback**: Combine interactions:
   ```
   After completing the action:
   1. Update the data object
   2. Show a toast notification
   3. Optionally close iframe or move visitor
   See sdk-ai-boilerplate examples/visitorInteractions.md
   ```
