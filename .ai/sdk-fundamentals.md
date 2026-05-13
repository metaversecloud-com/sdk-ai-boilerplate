# Topia SDK Fundamentals

This document explains how Topia SDK apps authenticate, communicate with the platform, and interact with dropped assets at the protocol level. It's reference material — not a how-to recipe. Read it once early; come back to it when something is unclear about why a request needs a specific header, how a webhook arrives, or what the platform validates server-side.

Recipes that put these pieces together (badges, inventory cache, leaderboards, locking, drop-asset workflows, etc.) live in `.ai/examples/`. Day-to-day rules live in `.ai/rules.md`.

## Interactive Keys & Authentication

### Key types

SDK apps authenticate using **Interactive Keys**, created in `topia-gateway` by developers:

| Key                              | Storage                       | Purpose                              |
| -------------------------------- | ----------------------------- | ------------------------------------ |
| `INTERACTIVE_KEY` (publicKey)    | `.env`, passed to clients     | Identifies the app, linked to assets |
| `INTERACTIVE_SECRET` (secretKey) | `.env` only, **never expose** | Signs JWTs for API authentication    |
| `API_KEY`                        | `.env` only                   | Optional admin-level access          |

### How it works

```
Developer setup (topia-gateway):
  1. Developer creates an Interactive Key → publicKey (Firestore doc ID) + secretKey (base64 UUID)
  2. Developer adds ecosystem inventory items to the key (badges, currency, etc.)
  3. Developer links the key to interactive assets in topia-client

Runtime (when a user clicks an interactive asset):
  1. Topia generates an interactiveNonce (session-specific, stored in Redis)
  2. Topia opens an iframe (or POSTs a webhook) with credentials in URL query params / body
  3. The SDK app extracts those credentials and the SDK signs a JWT with the secretKey
  4. public-api validates the JWT signature + nonce
```

### JWT signing (happens automatically)

The SDK signs every request using `interactiveSecret` — you don't call this directly:

```typescript
// Inside SDKController.ts
const payload = {
  interactiveNonce, // session nonce from Topia
  visitorId,
  assetId,
  urlSlug,
  profileId,
  date: new Date(),
};
const token = jwt.sign(payload, topia.interactiveSecret);
// Sent as the `InteractiveJWT` header; publicKey sent as the `PublicKey` header.
```

### Server initialization

Initialize Topia **once** on the server with secrets from the environment. This is the canonical `server/utils/topiaInit.ts`:

```typescript
import { Topia, DroppedAssetFactory, VisitorFactory, WorldFactory } from "@rtsdk/topia";

const topia = new Topia({
  apiDomain: process.env.INSTANCE_DOMAIN, // "api.topia.io"
  apiProtocol: process.env.INSTANCE_PROTOCOL, // "https"
  apiKey: process.env.API_KEY, // optional admin key
  interactiveKey: process.env.INTERACTIVE_KEY, // public key (sent in headers)
  interactiveSecret: process.env.INTERACTIVE_SECRET, // secret (signs JWTs)
});

export const DroppedAsset = new DroppedAssetFactory(topia);
export const Visitor = new VisitorFactory(topia);
export const World = new WorldFactory(topia);
```

## Platform-to-App Communication

SDK apps are external applications you build and host. Topia communicates with your app two ways.

### Iframes — interactive UI

When a user clicks an interactive asset, Topia opens your app in an iframe drawer:

- You control the entire UI (React, Vue, vanilla — whatever you ship).
- Credentials arrive as URL query parameters.
- Your app runs on YOUR servers, not Topia's.
- Use `isOpenLinkInDrawer: true` on the asset configuration to open the app in the sidebar drawer.

### Webhooks — server-to-server

Assets can also trigger webhooks to your backend without showing any UI:

```
User clicks asset (or enters a zone) → Topia POSTs to your backend
                                           ↓
POST https://your-app.com/api/webhook
Body: { visitorId, interactiveNonce, assetId, urlSlug, ... }
```

Use cases: trigger an action without UI (answer zones, checkpoints, zone-enter/exit auto-spawns), process events server-side, update world state from a passive action.

## Session Credentials

Iframes deliver these as URL query params; webhooks deliver the same fields in the POST body.

| Parameter              | Type   | Description                                 |
| ---------------------- | ------ | ------------------------------------------- |
| `visitorId`            | number | User's visitor ID in this world             |
| `interactiveNonce`     | string | One-time session token (validated in Redis) |
| `interactivePublicKey` | string | Your app's public key                       |
| `urlSlug`              | string | Current world's URL slug                    |
| `profileId`            | string | User's global profile ID                    |
| `assetId`              | string | The clicked asset's ID                      |
| `displayName`          | string | User's display name                         |
| `username`             | string | User's username                             |
| `identityId`           | string | User's identity ID                          |
| `sceneDropId`          | string | Scene drop identifier                       |
| `uniqueName`           | string | Asset's unique name (if set)                |

Server-side, validate and type them via `getCredentials(req.query)` (see [`server/utils/getCredentials.ts`](../server/utils/getCredentials.ts)) — this is a protected file, do not modify it.

## Dropped Assets

A **DroppedAsset** is an asset placed in a Topia world. SDK apps interact with dropped assets to store game state in `dataObject`, configure click behavior, update visual appearance (layers, scale, position), or make assets interactive.

### Key methods

| Method                                           | Purpose                    |
| ------------------------------------------------ | -------------------------- |
| `DroppedAsset.get(id, urlSlug, { credentials })` | Fetch an existing asset    |
| `DroppedAsset.drop(asset, options)`              | Place a new asset in world |
| `fetchDataObject()`                              | Get asset's custom data    |
| `setDataObject(data, options)`                   | Replace entire data object |
| `updateDataObject(data, options)`                | Merge partial data         |
| `incrementDataObjectValue(path, amount)`         | Atomic increment           |
| `updateClickType(options)`                       | Configure click behavior   |
| `deleteDroppedAsset()`                           | Remove asset from world    |

### Click types

```typescript
enum DroppedAssetClickType {
  NONE = "none",
  LINK = "link",
  PORTAL = "portal",
  TELEPORT = "teleport",
  WEBHOOK = "webhook",
}
```

### Dropping a new asset

```typescript
import { Asset, DroppedAsset } from "../utils/topiaInit";
import { DroppedAssetClickType } from "@rtsdk/topia";

const asset = await Asset.create(process.env.SEED_ASSET_ID, { credentials });

const cropAsset = await DroppedAsset.drop(asset, {
  position: { x: 100, y: 200 },
  urlSlug,
  uniqueName: `MyApp_crop_${profileId}`, // for lookup later via fetchDroppedAssetsWithUniqueName
  isInteractive: true,
  interactivePublicKey: credentials.interactivePublicKey,
  clickType: DroppedAssetClickType.LINK,
  clickableLink: `${BASE_URL}/crop?profileId=${profileId}`,
  clickableLinkTitle: "View Crop",
  isOpenLinkInDrawer: true,
  layer0: "",
  layer1: seedImageUrl,
});

await cropAsset.setDataObject({
  dateDropped: Date.now(),
  ownerId: profileId,
  ownerName: displayName,
});
```

### Locking for concurrent operations

When multiple visitors might mutate the same asset, lock to prevent races. Time-bucketed lock IDs (rounded to the minute) reduce collisions without needing distributed coordination:

```typescript
const lockId = `plot_${assetId}_${Math.floor(Date.now() / 60000) * 60000}`;
await droppedAsset.updateDataObject({}, { lock: { lockId } });
// … do operations …
await droppedAsset.updateDataObject({ lastUpdated: Date.now() }, { lock: { lockId, releaseLock: true } });
```

See `.ai/examples/lockingPatterns.md` for more elaborate variants.

## Backend Validation (how Topia validates your requests)

When your SDK app makes a request, Topia's `public-api` runs through this pipeline before any route handler:

```
1.  Extract JWT from `InteractiveJWT` header
2.  Extract publicKey from `PublicKey` header
3.  Fetch secretKey from Firestore (publicKeys collection)
4.  jwt.verify(jwt, secretKey)              ← validates signature
5.  Decode JWT payload: { visitorId, nonce, assetId, urlSlug }
6.  Redis: HGET playersNonce:{urlSlug}:{visitorId} interactiveNonce
7.  Compare nonce from JWT vs Redis         ← prevents replay attacks
8.  Fetch droppedAsset from RTDB
9.  Validate asset.interactivePublicKey === publicKey
10. ✓ Request authorized → route handler runs
```

### Security properties

- **Nonce** — unique per visitor per world session, stored in Redis.
- **JWT signature** — proves the request came from your app (only you have the `secretKey`).
- **Asset validation** — ensures you can only control your own interactive assets.
- **Time-based** — JWT includes a timestamp, nonce changes per session.

This is why never exposing `INTERACTIVE_SECRET` matters: with it, an attacker could forge JWTs for arbitrary visitors/assets. With only the `publicKey` they can't sign a request that survives step 4.
