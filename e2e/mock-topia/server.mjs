// Minimal in-memory fake of the Topia public API (https://<INSTANCE_DOMAIN>/api/v1), covering the
// endpoints @rtsdk/topia calls on behalf of SDK apps. Zero dependencies. When an app calls an
// endpoint that isn't here, the test fails with "public-API calls mock-topia doesn't implement":
// add a route below. Also fakes the leaderboard app's stats endpoint the boilerplate example calls, a
// path-style S3 bucket under /s3 (playwright.config points AWS_ENDPOINT_URL_S3 here), image
// downloads under /images and outgoing webhooks under /hooks.
//
// State is partitioned by urlSlug, so every test seeds its own world and tests can run in parallel.
// Test-only control routes live under /__mock:
//   POST /__mock/worlds/:urlSlug   seed a world  { dataObject, assets, visitors, users?, inventoryItems?,
//                                  expressions?, worldDetails?, userGroupDataObjects?, scenes?, latencyMs?, delays?, failures?,
//                                  holdLocksDuringDelay? }
//   PATCH /__mock/worlds/:urlSlug  change failures / delays / latencyMs / holdLocksDuringDelay mid-test
//   GET  /__mock/worlds/:urlSlug   read world state + event log (particles, toasts, grants, analytics, ...)
//   PATCH /__mock/worlds/:urlSlug/visitors/:id   change visitor fields mid-test (position, isAdmin, ...)
//   GET  /__mock/users/:profileId  read a user data object
//   GET  /__mock/unhandled         public-API calls the mock didn't recognize, outside any world
//   GET  /__mock/s3                objects in the fake S3 [{ bucket, key, size, contentType }] (all tests)
//   GET  /__mock/hooks             calls to the fake outgoing webhooks under /hooks (all tests), oldest first
//   GET  /__mock/health

import { existsSync, readFileSync } from "node:fs";
import http from "node:http";

const PORT = Number(process.env.MOCK_TOPIA_PORT || 3101);
const PUBLIC_KEY = process.env.INTERACTIVE_KEY || "e2e-public-key";
// The only API key (Authorization header, no interactive credentials) the mock accepts; E2E_API_KEY in
// constants.ts. Distinctive so tests can scan responses and logs for it.
const API_KEY = process.env.E2E_API_KEY || "e2e-topia-api-key-must-never-leak";

// Default ecosystem inventory catalog: the app's own from catalog.json next to this file if there is one,
// else four Quiz badges. world.seed({ inventoryItems }) replaces it for one world, but apps that cache the
// catalog process-wide (an inventory cache) only ever see the first world's: put theirs in catalog.json.
const CATALOG_FILE = new URL("./catalog.json", import.meta.url);
const INVENTORY_ITEMS = existsSync(CATALOG_FILE)
  ? JSON.parse(readFileSync(CATALOG_FILE, "utf8"))
  : ["Perfect Score", "Lightning Round", "Quiz Master", "Top 3 Finisher"].map((name, i) => ({
      id: `badge-${i + 1}`,
      name,
      type: "BADGE",
      status: "ACTIVE",
      description: `${name} badge`,
      image_path: `https://example.invalid/badges/${i + 1}.png`,
    }));

/**
 * A visitor inventory entry the way GET get-visitor-inventory-items returns it: `metadata` is the user
 * item's own, `itemMetadata` / `item.metadata` the catalog item's.
 */
const ownedItem = (id, item, quantity = 1, metadata = {}) => ({
  id,
  item_id: item.id,
  itemId: item.id,
  quantity,
  metadata,
  itemMetadata: item.metadata,
  name: item.name,
  description: item.description,
  type: item.type,
  status: item.status,
  image_url: item.image_path,
  item: {
    id: item.id,
    name: item.name,
    description: item.description,
    type: item.type,
    metadata: item.metadata,
    image_url: item.image_path,
  },
});
// Like the public API's reads (getUserInventoryItems: quantity > 0), entries at 0 or below stay stored
// (a later +1 counts from there) but aren't returned.
const ownedInventory = (visitor) => (visitor?.inventory || []).filter((entry) => entry.quantity > 0);

// Default unlockable expressions (emotes); world.seed({ expressions }) replaces them for one world.
const EXPRESSIONS = [
  { id: "emote-wave", name: "Wave", type: "emote", expressionImage: "https://example.invalid/emotes/wave.png" },
  { id: "emote-dance", name: "Dance", type: "emote", expressionImage: "https://example.invalid/emotes/dance.png" },
];

// Accepted particle names. Not the real catalog: a name an app uses is added here without knowing whether
// the platform has it, so check new names against the real particle list separately.
const PARTICLES = [
  "brain_float",
  "partyPopper_float",
  "confetti_float",
  "explosion_float",
  "sparkles_float",
  "blueSmoke_puff",
  "whiteStar_burst",
  "musicNote_float",
  "Firework",
  "confetti_1",
].map((name, i) => ({ id: `particle-${i + 1}`, name }));

// ---- Outgoing webhooks ----
// Stand-in for any webhook or HTTP endpoint the app posts to (chat webhooks, notification services, ...):
// point APP_ENV or seeded config at <mock as the app sees it>/hooks/<urlSlug>/<name> (helpers/hooks.ts) and
// read what arrived from GET /__mock/hooks. Any method. A path segment "fail-<status>" (e.g. /fail-500)
// answers that status, like a broken endpoint. Calls under /hooks/<urlSlug>/ also get that world's seeded
// delays and failures (matched against "METHOD /hooks/<urlSlug>/<name>").
const hookCalls = [];
const hook = (req, url, body) => {
  hookCalls.push({
    method: req.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    authorization: req.headers.authorization,
    contentType: req.headers["content-type"],
    body,
  });
  const status = Number(url.pathname.match(/\/fail-(\d{3})(?:\/|$)/)?.[1]);
  // Teams' incoming webhooks answer a bare "1".
  return status ? [status, { message: `mock webhook: injected ${status}` }] : [200, 1];
};

const worlds = new Map();
const users = new Map();
const unhandledOutsideWorlds = [];
// Fake S3, shared by all tests: "<bucket>/<key>" -> { bucket, key, contentType, bytes }.
const s3Objects = new Map();
let assetCounter = 0;

const emptyWorld = () => ({ dataObject: {}, assets: {}, visitors: {}, events: [], unhandled: [] });
const getWorld = (urlSlug) => {
  if (!worlds.has(urlSlug)) worlds.set(urlSlug, emptyWorld());
  return worlds.get(urlSlug);
};
const getUser = (profileId) => {
  if (!users.has(profileId)) users.set(profileId, { dataObject: {} });
  return users.get(profileId);
};
// Like the public API, a visitor's data object IS its user's data object (both are stored per profile
// and app), so Visitor and User reads/writes for the same profileId see the same record.
const visitorRecord = (visitor) => getUser(visitor.profileId);
// World state as the control plane returns it: each visitor's data object filled in from its profile.
const worldWithVisitorData = (world) => ({
  ...world,
  visitors: Object.fromEntries(
    Object.entries(world.visitors).map(([id, v]) => [id, { ...v, dataObject: clone(visitorRecord(v).dataObject) }]),
  ),
});
const catalog = (world) => world?.inventoryItems ?? INVENTORY_ITEMS;
const expressionsOf = (world) => world?.expressions ?? EXPRESSIONS;

// Mirrors the platform's update-data-object semantics: keys are dot paths, values replace the leaf.
const applyUpdate = (target, updates) => {
  for (const [path, value] of Object.entries(updates || {})) {
    const keys = path.split(".");
    let node = target;
    for (const key of keys.slice(0, -1)) {
      if (typeof node[key] !== "object" || node[key] === null) node[key] = {};
      node = node[key];
    }
    node[keys[keys.length - 1]] = value;
  }
  return target;
};

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
  });

// An InteractiveJWT's payload ({ interactiveNonce, visitorId, assetId, urlSlug, profileId }). The
// signature isn't checked.
const jwtPayload = (token) => {
  try {
    return JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString()) || {};
  } catch {
    return {};
  }
};
const jwtNonce = (token) => jwtPayload(token).interactiveNonce;

// public-api's isPlayerIdSuffixedAnalyticName: public-key analytics named "<name>-<20-char mixed-case id>"
// (optionally "unique-" / "firstTime-unique-" prefixed) are dropped.
const isPlayerIdSuffixedAnalyticName = (name) => {
  if (typeof name !== "string") return false;
  const base = name.replace(/^(firstTime-)?unique-/, "");
  const suffix = base.slice(base.lastIndexOf("-") + 1);
  return base.lastIndexOf("-") > 0 && suffix.length === 20 && /^[A-Za-z0-9]+$/.test(suffix) && /[A-Z]/.test(suffix) && /[a-z]/.test(suffix);
};

// A literal null body stays null (some endpoints answer null), only a missing one becomes {}.
// The real API's error body (uncaughtErrorHandler / validationErrorHandler): the SDK reports errors[0].message
// as the error's message. Routes added before this still answer { message }, see the README's known gaps.
const apiError = (status, message) => [status, { errors: [{ message }] }];

const send = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body === undefined ? {} : body));
};

// Like the public API, a write naming a lock.lockId fails with 409 while that lock is held on the same
// data object; releaseLock: true frees it after the write, otherwise it stays held. By default the call's
// seeded delay runs before the write, which takes and frees the lock in one step, so two releaseLock writes
// never collide. With holdLocksDuringDelay the write takes the lock first and holds it for its delay, like
// a real write that takes time: a second write with the same lockId meanwhile gets the 409.
const heldLocks = new WeakMap(); // data-object holder -> Set of lockIds

const WRITE_ACTIONS = { "set-data-object": "set", "update-data-object": "update", "increment-data-object-value": "increment" };
const WRITE_ENDPOINTS = Object.keys(WRITE_ACTIONS).join("|");

const readDataObject = (holder) => clone(holder.dataObject || {});

// Data-object writes shared by world, dropped asset, visitor and user. Returns [status, body].
// Analytics sent with a successful write are logged as "analytics" events in `world` (if given).
// `holdMs`: the call's delay, run while holding the lock (holdLocksDuringDelay).
const writeDataObject = async (endpoint, holder, body, world, holdMs = 0) => {
  const lockId = body.lock?.lockId;
  if (!heldLocks.has(holder)) heldLocks.set(holder, new Set());
  const locks = heldLocks.get(holder);
  if (lockId) {
    if (locks.has(lockId)) {
      return [409, { message: "This data object is busy. Another process has acquired this data object lock." }];
    }
    locks.add(lockId);
  }
  if (holdMs) await new Promise((resolve) => setTimeout(resolve, holdMs));
  const action = WRITE_ACTIONS[endpoint];
  if (action === "set") holder.dataObject = clone(body.dataObject) || {};
  if (action === "update") holder.dataObject = applyUpdate(holder.dataObject || {}, clone(body.dataObject));
  if (action === "increment") {
    const current = body.path.split(".").reduce((node, key) => node?.[key], holder.dataObject) || 0;
    holder.dataObject = applyUpdate(holder.dataObject || {}, { [body.path]: current + body.amount });
  }
  if (lockId && body.lock.releaseLock) locks.delete(lockId);
  for (const analytic of body.analytics || []) world?.events.push({ ...analytic, type: "analytics" });
  return [200, {}];
};

// handleCreateNpc's spawnEffect validation: the error message, or undefined if it's valid (or absent).
const spawnEffectError = (effect) => {
  if (effect == null) return undefined;
  if (typeof effect !== "object" || Array.isArray(effect)) return "spawnEffect must be an object";
  if (effect.type !== undefined && !["portal", "none"].includes(effect.type)) return "spawnEffect.type must be 'portal' or 'none'";
  const color = (c) => typeof c === "number" && Number.isInteger(c) && c >= 0 && c <= 0xffffff;
  if (effect.colors !== undefined) {
    if (!Array.isArray(effect.colors) || effect.colors.length > 32) return "spawnEffect.colors must be an array of up to 32 entries";
    if (!effect.colors.every(color)) return "spawnEffect.colors entries must be integers 0–0xFFFFFF";
  }
  for (const field of ["glowColor", "centerColor"]) {
    if (effect[field] !== undefined && !color(effect[field])) return `spawnEffect.${field} must be an integer 0–0xFFFFFF`;
  }
  const inRange = (v, min, max, int) => typeof v === "number" && v >= min && v <= max && (!int || Number.isInteger(v));
  if (effect.glowOpacity !== undefined && !inRange(effect.glowOpacity, 0, 1)) return "spawnEffect.glowOpacity must be a number 0–1";
  if (effect.duration !== undefined && !inRange(effect.duration, 100, 10000)) return "spawnEffect.duration must be 100–10000 ms";
  if (effect.sectorCount !== undefined && !inRange(effect.sectorCount, 2, 32, true)) return "spawnEffect.sectorCount must be an integer 2–32";
  if (effect.gridSize !== undefined && !inRange(effect.gridSize, 2, 50, true)) return "spawnEffect.gridSize must be an integer 2–50";
  return undefined;
};

const routes = [
  // ---- control plane ----
  ["GET", /^\/__mock\/health$/, () => [200, { ok: true }]],
  [
    "POST",
    /^\/__mock\/worlds\/([^/]+)$/,
    ([urlSlug], body) => {
      const { users: userData = {}, ...rest } = clone(body);
      const world = { ...emptyWorld(), ...rest };
      for (const visitor of Object.values(world.visitors)) {
        visitorRecord(visitor).dataObject = visitor.dataObject || {};
        delete visitor.dataObject;
        // Owned catalog items { item: id or name, quantity?, metadata? }, resolved against the world's catalog.
        for (const { item: ref, quantity = 1, metadata = {} } of visitor.ownedItems || []) {
          const item = catalog(world).find((i) => i.id === ref || i.name === ref);
          if (!item) return [400, { message: `seed: no catalog item with id or name "${ref}"` }];
          (visitor.inventory ||= []).push(ownedItem(`user-item-${++assetCounter}`, item, quantity, metadata));
        }
        delete visitor.ownedItems;
      }
      // Data objects of other profiles (players who aren't in the world right now).
      for (const [profileId, dataObject] of Object.entries(userData)) getUser(profileId).dataObject = dataObject;
      worlds.set(urlSlug, world);
      return [200, { ok: true }];
    },
  ],
  ["GET", /^\/__mock\/worlds\/([^/]+)$/, ([urlSlug]) => [200, worldWithVisitorData(getWorld(urlSlug))]],
  [
    "PATCH",
    /^\/__mock\/worlds\/([^/]+)$/,
    ([urlSlug], body) => {
      // Mid-test changes to how calls are answered, e.g. { failures: {} } to stop injecting failures.
      const settings = ["failures", "delays", "latencyMs", "holdLocksDuringDelay"];
      const unknown = Object.keys(body).filter((key) => !settings.includes(key));
      if (unknown.length) return [400, { message: `can't change ${unknown.join(", ")} mid-test` }];
      Object.assign(getWorld(urlSlug), clone(body));
      return [200, { ok: true }];
    },
  ],
  [
    "PATCH",
    /^\/__mock\/worlds\/([^/]+)\/visitors\/([^/]+)$/,
    ([urlSlug, id], body) => {
      const visitor = getWorld(urlSlug).visitors[id];
      if (!visitor) return [404, { message: "Visitor not found" }];
      const { dataObject, ...fields } = clone(body);
      Object.assign(visitor, fields);
      if (dataObject) visitorRecord(visitor).dataObject = dataObject;
      return [200, { ok: true }];
    },
  ],
  ["GET", /^\/__mock\/users\/([^/]+)$/, ([profileId]) => [200, getUser(profileId)]],
  ["GET", /^\/__mock\/unhandled$/, () => [200, unhandledOutsideWorlds]],
  ["GET", /^\/__mock\/hooks$/, () => [200, hookCalls]],
  [
    "GET",
    /^\/__mock\/s3$/,
    () => [200, [...s3Objects.values()].map(({ bucket, key, contentType, bytes }) => ({ bucket, key, contentType, size: bytes.length }))],
  ],

  // ---- ecosystem ----
  // Not world-scoped: the world comes from the caller's JWT (see `world` in the request handler).
  ["GET", /^\/api\/v1\/inventory\/?$/, (_, __, ___, world) => [200, catalog(world)]],
  [
    "GET",
    /^\/api\/v1\/expressions$/,
    (_, __, query, world) => {
      const name = query.get("name");
      return [200, name ? expressionsOf(world).filter((e) => e.name === name) : expressionsOf(world)];
    },
  ],
  [
    "GET",
    /^\/api\/v1\/particles$/,
    (_, __, query) => [200, query.get("name") ? PARTICLES.filter((p) => p.name === query.get("name")) : PARTICLES],
  ],
  [
    "PUT",
    /^\/api\/v1\/analytics\/public-key-analytics$/,
    (_, body, __, ___, ____, req) => {
      // Like handleAddPublicKeyAnalytics: the world is the session's (the InteractiveJWT's urlSlug), whatever
      // urlSlug the analytic names; logged there as "analytics" events. sentUrlSlug is what the app sent, sessionVisitorId whose session
      // sent it. Per-player names are dropped like the real route, logged as "analytics-rejected".
      const session = jwtPayload(req.headers.interactivejwt);
      for (const analytic of body.analytics || []) {
        const urlSlug = String(session.urlSlug ?? analytic.urlSlug);
        const world = getWorld(urlSlug);
        if (isPlayerIdSuffixedAnalyticName(analytic.analyticName)) {
          world.events.push({ type: "analytics-rejected", analyticName: analytic.analyticName });
          continue;
        }
        world.events.push({
          ...analytic,
          urlSlug,
          sentUrlSlug: analytic.urlSlug,
          sessionVisitorId: session.visitorId,
          type: "analytics",
          source: "public-key",
        });
      }
      return [200, { success: true }];
    },
  ],

  // Scene.get / fetchSceneById (handleGetSceneById): scenes are platform-wide, seeded per world under `scenes`
  // and read from the caller's world (JWT urlSlug). Like getSceneById, an unknown id answers 200 with a null
  // body, not a 404.
  [
    "GET",
    /^\/api\/v1\/scenes\/([^/]+)$/,
    ([sceneId], _, __, world) => {
      const scene = world?.scenes?.[sceneId];
      return [200, scene ? { ...clone(scene), id: sceneId } : null];
    },
  ],

  // User.checkInteractiveCredentials (handleCheckInteractiveCredentials behind interactiveKeyValidator with
  // isRequired): 200 when the caller's InteractiveJWT carries complete session credentials, else 401.
  [
    "GET",
    /^\/api\/v1\/auth\/interactive-credentials$/,
    (_, __, ___, ____, _____, req) => {
      const { interactiveNonce, assetId, visitorId, urlSlug } = jwtPayload(req.headers.interactivejwt);
      if (!req.headers.interactivejwt) return apiError(401, "Invalid jwt 1. Check your key pairs!");
      const missing = !interactiveNonce ? "interactiveNonce" : !assetId ? "assetId" : !visitorId ? "visitorId" : !urlSlug ? "urlSlug" : "";
      return missing ? apiError(401, `Missing session credentials: ${missing}`) : [200, { success: true }];
    },
  ],

  // ---- leaderboard app (sdk-leaderboard), called by the boilerplate's example route ----
  [
    "POST",
    /^\/leaderboard\/api\/dropped-asset\/increment-player-stats$/,
    (_, body, query) => {
      const { secret, ...rest } = body;
      getWorld(query.get("urlSlug")).events.push({ ...rest, type: "leaderboard-stats", hasSecret: !!secret });
      return [200, { success: true }];
    },
  ],

  // ---- users ----
  [
    "PUT",
    /^\/api\/v1\/user\/inventory\/([^/]+)\/grant-user-inventory-item$/,
    ([profileId], body, _, world) => {
      const item = catalog(world).find((i) => i.id === body.itemId);
      if (!item) return [404, { message: "Item not found" }];
      // Inventory belongs to the user, so every visitor with this profile in the caller's world gets it.
      // Like the visitor route, granting an item the user already owns adds to its quantity.
      let quantity = body.quantity ?? 1;
      for (const visitor of Object.values(world?.visitors || {}).filter((v) => v.profileId === profileId)) {
        visitor.inventory ||= [];
        const owned = visitor.inventory.find((entry) => entry.item_id === item.id);
        if (owned) quantity = owned.quantity += body.quantity ?? 1;
        else visitor.inventory.push(ownedItem(`user-item-${++assetCounter}`, item, quantity));
      }
      world?.events.push({ type: "grant-user-item", profileId, name: item.name, quantity });
      return [200, { inventoryItem: item.id, user_id: profileId, quantity }];
    },
  ],
  [
    "GET",
    /^\/api\/v1\/user\/inventory\/([^/]+)\/get-user-inventory-items$/,
    // User.fetchInventoryItems: the inventory that profile's visitor carries in the caller's world.
    ([profileId], _, __, world) => [
      200,
      ownedInventory(Object.values(world?.visitors || {}).find((v) => v.profileId === profileId)),
    ],
  ],
  [
    "GET",
    /^\/api\/v1\/user\/dataObjects\/([^/]+)\/get-data-object$/,
    ([profileId]) => [200, readDataObject(getUser(profileId))],
  ],
  [
    "PUT",
    new RegExp(`^/api/v1/user/dataObjects/([^/]+)/(${WRITE_ENDPOINTS})$`),
    // Analytics sent with the write are logged in the caller's world.
    ([profileId, endpoint], body, _, world, holdMs) => writeDataObject(endpoint, getUser(profileId), body, world, holdMs),
  ],

  // ---- world ----
  // World.fetchDetails. Seed worldDetails to add or override fields.
  [
    "GET",
    /^\/api\/v1\/world\/([^/]+)\/world-details$/,
    ([slug]) => [200, { urlSlug: slug, name: slug, width: 4000, height: 4000, ...getWorld(slug).worldDetails }],
  ],
  ["GET", /^\/api\/v1\/world\/([^/]+)\/get-data-object$/, ([slug]) => [200, readDataObject(getWorld(slug))]],
  [
    "PUT",
    /^\/api\/v1\/world\/([^/]+)\/fire-toast$/,
    ([slug], body) => {
      getWorld(slug).events.push({ ...body, type: "world-toast" });
      return [200, {}];
    },
  ],
  [
    "PUT",
    new RegExp(`^/api/v1/world/([^/]+)/(${WRITE_ENDPOINTS})$`),
    ([slug, endpoint], body, _, __, holdMs) => writeDataObject(endpoint, getWorld(slug), body, getWorld(slug), holdMs),
  ],
  [
    "POST",
    /^\/api\/v1\/world\/([^/]+)\/(particles|set-activity|webhooks)$/,
    ([slug, type], body) => {
      // A webhook body carries its own "type" (e.g. webhookZoneEntered); keep it as webhookType.
      const particleName = type === "particles" ? PARTICLES.find((p) => p.id === body.particleId)?.name : undefined;
      getWorld(slug).events.push({ ...body, type, ...(body.type && { webhookType: body.type }), ...(particleName && { particleName }) });
      return [200, type === "webhooks" ? { webhookId: `webhook-${++assetCounter}` } : {}];
    },
  ],
  [
    "GET",
    /^\/api\/v1\/world\/([^/]+)\/assets-with-scene-drop-id\/([^/]+)$/,
    ([slug, sceneDropId], _, query) => {
      const uniqueName = query.get("uniqueName");
      const assets = Object.values(getWorld(slug).assets).filter(
        (a) => a.sceneDropId === sceneDropId && (!uniqueName || a.uniqueName === uniqueName),
      );
      return [200, { assets }];
    },
  ],

  [
    "POST",
    /^\/api\/v1\/world\/([^/]+)\/drop-scene$/,
    ([slug], body, _, world, __, req) => {
      // World.dropScene (handleDropScene). Scenes aren't modelled: every sceneId exists, and one placeholder
      // asset tagged with the sceneDropId stands in for the scene's assets (so fetchDroppedAssetsBySceneDropId
      // finds it). Like the real route, a visitor session needs an admin unless allowNonAdmins.
      if (typeof body.sceneId !== "string") return [400, { errors: [{ message: "Invalid value", field: "sceneId" }] }];
      const { visitorId } = jwtPayload(req.headers.interactivejwt);
      if (req.headers.interactivejwt && !body.allowNonAdmins && !world?.visitors[visitorId]?.isAdmin) {
        return apiError(401, "Admin permissions are required to drop scenes.");
      }
      const target = getWorld(slug);
      const id = `dropped-${++assetCounter}`;
      const sceneDropId = body.sceneDropId || `${body.sceneId}-${assetCounter}`;
      target.assets[id] = { id, uniqueName: `scene-${body.sceneId}`, sceneId: body.sceneId, sceneDropId, position: body.position, dataObject: {} };
      target.events.push({ ...body, type: "drop-scene", assetId: id, sceneDropId });
      return [200, { sceneDropId, success: true }];
    },
  ],

  [
    "GET",
    /^\/api\/v1\/world\/([^/]+)\/assets-with-unique-name\/([^/]+)$/,
    ([slug, uniqueName], _, query) => {
      // Like getDroppedAssetsWithUniqueName: any partial value counts (!!req.query.partial, so even "false"),
      // and a partial match is a prefix match (startAt(name).endAt(name + "\uf8ff")), not a substring.
      const partial = query.has("partial") && query.get("partial") !== "";
      const assets = Object.values(getWorld(slug).assets)
        .filter((a) => (partial ? String(a.uniqueName ?? "").startsWith(uniqueName) : a.uniqueName === uniqueName))
        .map(({ dataObject, ...details }) => details);
      return [200, { assets }];
    },
  ],

  // ---- dropped assets ----
  [
    "POST",
    /^\/api\/v1\/world\/([^/]+)\/assets$/,
    ([slug], body) => {
      const id = `dropped-${++assetCounter}`;
      getWorld(slug).assets[id] = { ...body, id, dataObject: {} };
      return [200, { id }];
    },
  ],
  [
    "GET",
    /^\/api\/v1\/world\/([^/]+)\/assets$/,
    // World.fetchDroppedAssets: every dropped asset in the world, without data objects.
    ([slug]) => [200, Object.values(getWorld(slug).assets).map(({ dataObject, ...details }) => details)],
  ],
  [
    "PUT",
    /^\/api\/v1\/world\/([^/]+)\/assets\/([^/]+)\/set-clickable-link-multi$/,
    ([slug, id], body) => {
      // Replaces the asset's links. A link with existingLinkId keeps that id, a new one gets a fresh linkId;
      // the response is the updated asset (DroppedAsset assigns it to itself). Logged as an event.
      const world = getWorld(slug);
      const asset = world.assets[id];
      if (!asset) return [404, { message: "Asset not found" }];
      asset.clickType = body.clickType;
      asset.clickableLinks = (body.clickableLinks || []).map(({ existingLinkId, linkSamlQueryParams, ...link }) => ({
        ...link,
        linkId: existingLinkId || `link-${++assetCounter}`,
      }));
      world.events.push({ type: "set-clickable-link-multi", assetId: id, clickableLinks: clone(asset.clickableLinks) });
      const { dataObject, ...details } = asset;
      return [200, clone(details)];
    },
  ],
  [
    "GET",
    /^\/api\/v1\/world\/([^/]+)\/assets\/([^/]+)\/data-object$/,
    ([slug, id]) => {
      const asset = getWorld(slug).assets[id];
      return asset ? [200, readDataObject(asset)] : [404, { message: "Asset not found" }];
    },
  ],
  [
    "PUT",
    new RegExp(`^/api/v1/world/([^/]+)/assets/([^/]+)/(${WRITE_ENDPOINTS})$`),
    ([slug, id, endpoint], body, _, __, holdMs) => {
      const asset = getWorld(slug).assets[id];
      return asset ? writeDataObject(endpoint, asset, body, getWorld(slug), holdMs) : [404, { message: "Asset not found" }];
    },
  ],
  [
    "GET",
    /^\/api\/v1\/world\/([^/]+)\/assets\/([^/]+)$/,
    ([slug, id]) => {
      const asset = getWorld(slug).assets[id];
      // Like the real endpoint, includes the data object: DroppedAsset.get fills droppedAsset.dataObject from it.
      return asset ? [200, clone(asset)] : [404, { message: "Asset not found" }];
    },
  ],
  [
    "PUT",
    /^\/api\/v1\/world\/([^/]+)\/assets\/([^/]+)\/(set-webhook-zone|set-landmark-zone|set-webimage-layers|change-click-type|change-media-type|set-private-zone|set-asset-interactive-settings)$/,
    ([slug, id, updateType], body) => {
      const world = getWorld(slug);
      const asset = world.assets[id];
      if (!asset) return [404, { message: "Asset not found" }];
      if (updateType === "set-private-zone") {
        // changeDroppedAssetPrivateZoneOptions: stored under the asset's own field names; omitted options keep
        // their value.
        if (body.isPrivateZone !== undefined) asset.assetPrivateConversation = body.isPrivateZone;
        if (body.isPrivateZoneChatDisabled !== undefined) asset.assetPrivateZoneChannelDisabled = body.isPrivateZoneChatDisabled;
        if (body.privateZoneUserCap !== undefined) asset.assetPrivateConversationCap = body.privateZoneUserCap;
      } else if (updateType === "set-asset-interactive-settings") {
        // handleSetAssetInteractiveSettings: an omitted field resets (isInteractive false, no public key).
        asset.isInteractive = body.isInteractive ?? false;
        asset.interactivePublicKey = body.interactivePublicKey ?? "";
      } else Object.assign(asset, body);
      // Like the platform, a media change restarts playback.
      if (updateType === "change-media-type") asset.mediaPlayTime = Date.now();
      world.events.push({ ...body, type: updateType, assetId: id });
      const { dataObject, ...details } = asset;
      return [200, details];
    },
  ],
  [
    "DELETE",
    /^\/api\/v1\/world\/([^/]+)\/assets\/([^/]+)$/,
    ([slug, id]) => {
      const world = getWorld(slug);
      // Like removeDroppedAsset: 404 for an asset that doesn't exist, { success: true } otherwise.
      if (!world.assets[id]) return apiError(404, "Dropped Asset not found");
      delete world.assets[id];
      world.events.push({ type: "delete-asset", assetId: id });
      return [200, { success: true }];
    },
  ],

  // ---- visitors ----
  [
    "GET",
    /^\/api\/v1\/world\/([^/]+)\/visitors$/,
    ([slug], _, query) => {
      // Current visitors keyed by visitorId (World.fetchVisitors, WorldActivity.currentVisitors). With
      // droppedAssetId (WorldActivity.fetchVisitorsInZone) only those standing in that landmark zone, like
      // handleGetVisitors. Like getVisitors, NPCs created with the caller's key are listed too.
      const zoneId = query.get("droppedAssetId");
      const result = {};
      for (const [id, visitor] of Object.entries(getWorld(slug).visitors)) {
        const { dataObject, inventory, npc, voiceSession, ...details } = visitor;
        if (npc) result[npc.playerId] = { visitorId: npc.playerId, displayName: "", username: npc.username, isAdmin: false };
        result[id] = { ...details, visitorId: Number(id) };
      }
      if (zoneId) {
        for (const [id, visitor] of Object.entries(result)) {
          if (!String(visitor.landmarkZonesString || "").split(",").includes(zoneId)) delete result[id];
        }
      }
      return [200, result];
    },
  ],
  [
    "GET",
    /^\/api\/v1\/world\/([^/]+)\/visitors\/([^/]+)$/,
    ([slug, id]) => {
      const visitor = getWorld(slug).visitors[id];
      if (!visitor) return [404, { message: "Visitor not found" }];
      const { dataObject, inventory, npc, voiceSession, ...details } = visitor;
      // Like the real route (getVisitors with a visitorId), a map keyed by visitorId: Visitor.fetchVisitor
      // reads response.data[id], which also finds the visitor when the app passes the id as a string.
      return [200, { [id]: { ...details, visitorId: Number(id), profile: { profileId: visitor.profileId } } }];
    },
  ],
  [
    "GET",
    /^\/api\/v1\/world\/([^/]+)\/visitors\/([^/]+)\/get-data-object$/,
    ([slug, id]) => {
      const visitor = getWorld(slug).visitors[id];
      return visitor ? [200, readDataObject(visitorRecord(visitor))] : [404, { message: "Visitor not found" }];
    },
  ],
  [
    "PUT",
    new RegExp(`^/api/v1/world/([^/]+)/visitors/([^/]+)/(${WRITE_ENDPOINTS})$`),
    ([slug, id, endpoint], body, _, __, holdMs) => {
      const visitor = getWorld(slug).visitors[id];
      return visitor
        ? writeDataObject(endpoint, visitorRecord(visitor), body, getWorld(slug), holdMs)
        : [404, { message: "Visitor not found" }];
    },
  ],
  [
    "GET",
    /^\/api\/v1\/world\/([^/]+)\/visitors\/([^/]+)\/get-visitor-inventory-items$/,
    ([slug, id]) => [200, ownedInventory(getWorld(slug).visitors[id])],
  ],
  [
    "PUT",
    /^\/api\/v1\/world\/([^/]+)\/visitors\/([^/]+)\/grant-visitor-inventory-item$/,
    ([slug, id], body) => {
      const world = getWorld(slug);
      const visitor = world.visitors[id];
      const item = catalog(world).find((i) => i.id === body.itemId);
      if (!visitor || !item) return [404, { message: "Visitor or item not found" }];
      // Like the public API, granting an item the visitor already owns adds to its quantity.
      visitor.inventory ||= [];
      let owned = visitor.inventory.find((entry) => entry.item_id === item.id);
      if (owned) owned.quantity += body.quantity ?? 1;
      else visitor.inventory.push((owned = ownedItem(`user-item-${++assetCounter}`, item, body.quantity ?? 1)));
      world.events.push({ type: "grant-item", visitorId: id, name: item.name });
      return [200, { inventoryItem: item.id, user_id: visitor.profileId, quantity: owned.quantity }];
    },
  ],
  [
    "PUT",
    /^\/api\/v1\/world\/([^/]+)\/visitors\/([^/]+)\/update-visitor-inventory-item-quantity$/,
    ([slug, id], body) => {
      // Visitor.modifyInventoryItemQuantity. Mirrors handleUpdateVisitorInventoryItemQuantity +
      // grantOrUpdateInventoryItemQuantity: an upsert by item that adds `quantity` as a delta. Like the
      // platform, a delta of 0 (or none) counts as +1 (quantityDelta || 1), nothing stops the quantity going
      // to 0 or below (reads then leave the entry out), and the user item's metadata is reset to {}.
      const world = getWorld(slug);
      const visitor = world.visitors[id];
      if (!visitor) return [404, { message: "No user ID found for this visitor" }];
      visitor.inventory ||= [];
      let owned;
      let item;
      if (body.userItemId) {
        owned = visitor.inventory.find((entry) => entry.id === body.userItemId);
        if (!owned) return [404, { message: "User does not currently own this item" }];
        item = catalog(world).find((i) => i.id === owned.item_id) ?? owned.item;
      } else {
        if (!body.itemId) return [400, { message: "Either userItemId or itemId must be provided" }];
        item = catalog(world).find((i) => i.id === body.itemId);
        if (!item) return [404, { message: "Item not found" }];
        owned = visitor.inventory.find((entry) => entry.item_id === item.id);
      }
      const delta = Number(body.quantity ?? 1) || 1;
      if (owned) {
        owned.quantity += delta;
        owned.metadata = {};
      } else visitor.inventory.push((owned = ownedItem(`user-item-${++assetCounter}`, item, delta)));
      world.events.push({ type: "modify-item", visitorId: id, name: item.name, quantity: delta, total: owned.quantity });
      // The real response's fields (no user_id: the SDK's UserInventoryItem gets undefined there too).
      return [
        201,
        {
          inventoryItem: owned.id,
          item_id: item.id,
          quantity: owned.quantity,
          metadata: owned.metadata,
          name: item.name,
          description: item.description,
          image_url: item.image_path,
          interactive_key_id: PUBLIC_KEY,
          status: item.status,
          type: item.type,
          profile_id: visitor.profileId,
        },
      ];
    },
  ],
  [
    "PUT",
    /^\/api\/v1\/world\/([^/]+)\/visitors\/([^/]+)\/grant-expression\/([^/]+)$/,
    ([slug, id, expressionId]) => {
      const world = getWorld(slug);
      const visitor = world.visitors[id];
      const expression = expressionsOf(world).find((e) => e.id === expressionId);
      if (!visitor || !expression) return [404, { message: "Visitor or expression not found" }];
      // Owned expressions are ids in visitor.expressions; like the public API, granting one twice is a 409.
      visitor.expressions ||= [];
      if (visitor.expressions.includes(expressionId)) return [409, { message: "Expression already granted" }];
      visitor.expressions.push(expressionId);
      world.events.push({ type: "grant-expression", visitorId: id, expressionId, name: expression.name });
      return [200, { success: true }];
    },
  ],
  [
    "GET",
    // Visitor.fetchUserGroupDataObject (handleGetUserGroupDataObjects): the world's user group data objects
    // (seed userGroupDataObjects); the visitorId in the path isn't used. The real route also needs
    // canReceiveUserGroupDataObjects on the public key: seed failures to test a key without it.
    /^\/api\/v1\/world\/([^/]+)\/visitors\/([^/]+)\/user-group-data-object$/,
    ([slug]) => [200, { success: true, userGroupDataObjects: clone(getWorld(slug).userGroupDataObjects ?? []) }],
  ],

  // ---- NPCs and AI voice sessions (handleGetNpc / handleCreateNpc / handleDeleteNpc /
  // handleStartNpcVoiceSession / handleStopNpcVoiceSession). One NPC per visitor per public key
  // (visitor.npc); one AI voice session per visitor per world across apps (visitor.voiceSession =
  // { publicKey, npcPlayerId }). Seed visitor: { npc, voiceSession } to start with them; a voiceSession
  // with another publicKey stands for another app's session. An NPC needs an owned inventory item of type
  // NPC whose catalog metadata has a spriteUrl. Logged as create-npc / delete-npc /
  // start-npc-voice-session / stop-npc-voice-session events, plus stopAiNpcVoice when a delete or replace
  // ends a session (the socket event the platform sends the browser).
  [
    "GET",
    /^\/api\/v1\/world\/([^/]+)\/visitors\/([^/]+)\/get-npc$/,
    ([slug, id]) => {
      const visitor = getWorld(slug).visitors[id];
      // The real handler throws a string here, which its error handler answers as a 500.
      if (!visitor) return apiError(500, "There was an internal server error");
      return [200, visitor.npc ? clone(visitor.npc) : null];
    },
  ],
  [
    "POST",
    /^\/api\/v1\/world\/([^/]+)\/visitors\/([^/]+)\/create-npc$/,
    ([slug, id], body) => {
      const world = getWorld(slug);
      const visitor = world.visitors[id];
      if (typeof body.userInventoryItemId !== "string" || !body.userInventoryItemId) {
        return [400, { errors: [{ message: "userInventoryItemId is required", field: "userInventoryItemId" }] }];
      }
      if (!visitor) return apiError(404, "Player to follow not found");
      const holder = Object.values(world.visitors).find((v) => (v.inventory || []).some((e) => e.id === body.userInventoryItemId));
      const owned = holder?.inventory.find((entry) => entry.id === body.userInventoryItemId);
      if (!owned) return apiError(404, "Inventory item not found");
      if (holder.profileId !== visitor.profileId) return apiError(403, "User does not own this inventory item");
      if (owned.quantity <= 0) return apiError(400, "Insufficient inventory item quantity");
      if (owned.type !== "NPC") return apiError(400, "Inventory item is not an NPC type");
      if (!owned.item.metadata?.spriteUrl) return apiError(400, "NPC inventory item is missing spriteUrl in metadata");
      const effectError = spawnEffectError(body.spawnEffect);
      if (effectError) return apiError(400, effectError);
      if (visitor.npc) {
        if (!body.replace) {
          return apiError(409, "This player already has an NPC following them in this world from your public key.");
        }
        // Like the platform, replacing an NPC also ends the visitor's voice session (whichever app's).
        world.events.push({ type: "delete-npc", visitorId: id, playerId: visitor.npc.playerId, replaced: true });
        if (visitor.voiceSession) {
          world.events.push({ type: "stopAiNpcVoice", visitorId: id, npcPlayerId: visitor.voiceSession.npcPlayerId });
          visitor.voiceSession = null;
        }
      }
      visitor.npc = {
        playerId: 9000 + ++assetCounter,
        username: body.showNameplate === false ? "" : owned.item.name,
        isNPC: true,
        npcFollowPlayerId: body.stationary ? undefined : Number(id),
        avatarImageUrl: owned.item.metadata.spriteUrl,
      };
      world.events.push({
        type: "create-npc",
        visitorId: id,
        playerId: visitor.npc.playerId,
        itemId: owned.item_id,
        userInventoryItemId: owned.id,
        showNameplate: body.showNameplate,
        stationary: body.stationary,
        replace: body.replace,
        spawnEffect: body.spawnEffect,
      });
      return [200, { success: true, player: clone(visitor.npc) }];
    },
  ],
  [
    "DELETE",
    /^\/api\/v1\/world\/([^/]+)\/visitors\/([^/]+)\/delete-npc$/,
    ([slug, id]) => {
      const world = getWorld(slug);
      const visitor = world.visitors[id];
      if (!visitor) return apiError(500, "There was an internal server error");
      if (!visitor.npc) return [200, { success: true }];
      world.events.push({ type: "delete-npc", visitorId: id, playerId: visitor.npc.playerId });
      visitor.npc = null;
      if (visitor.voiceSession) {
        world.events.push({ type: "stopAiNpcVoice", visitorId: id, npcPlayerId: visitor.voiceSession.npcPlayerId });
        visitor.voiceSession = null;
      }
      return [200, { success: true }];
    },
  ],
  [
    "PUT",
    /^\/api\/v1\/world\/([^/]+)\/visitors\/([^/]+)\/start-npc-voice-session$/,
    ([slug, id], body) => {
      const world = getWorld(slug);
      const visitor = world.visitors[id];
      const config = body.voiceConfig;
      const nonEmpty = (value) => typeof value === "string" && value.length > 0;
      if (!config || typeof config !== "object" || !nonEmpty(config.ephemeralKey) || !nonEmpty(config.voice) || !nonEmpty(config.instructions)) {
        return [400, { errors: [{ message: "Invalid value", field: "voiceConfig" }] }];
      }
      if (!visitor) return apiError(404, "Player not found in world");
      if (!visitor.npc) return apiError(400, "No NPC found for this visitor from your app. Spawn an NPC first.");
      if (!config.ephemeralKey.startsWith("ek_")) return apiError(400, "Invalid ephemeral key format. Must start with 'ek_'.");
      // createNpcVoiceSession: the same app may restart its session (a browser refresh), another app's blocks.
      if (visitor.voiceSession && visitor.voiceSession.publicKey !== PUBLIC_KEY) {
        return apiError(409, "This visitor already has an active AI voice session from another app in this world.");
      }
      visitor.voiceSession = { publicKey: PUBLIC_KEY, npcPlayerId: visitor.npc.playerId };
      world.events.push({ type: "start-npc-voice-session", visitorId: id, npcPlayerId: visitor.npc.playerId, ...clone(config) });
      return [200, { success: true }];
    },
  ],
  [
    "PUT",
    /^\/api\/v1\/world\/([^/]+)\/visitors\/([^/]+)\/stop-npc-voice-session$/,
    ([slug, id]) => {
      const world = getWorld(slug);
      const visitor = world.visitors[id];
      if (!visitor) return apiError(404, "Player not found in world");
      if (!visitor.voiceSession) return [200, { success: true }];
      if (visitor.voiceSession.publicKey !== PUBLIC_KEY) {
        return apiError(403, "You do not own the active voice session for this visitor.");
      }
      world.events.push({ type: "stop-npc-voice-session", visitorId: id, npcPlayerId: visitor.voiceSession.npcPlayerId });
      visitor.voiceSession = null;
      return [200, { success: true }];
    },
  ],
  [
    "PUT",
    /^\/api\/v1\/world\/([^/]+)\/visitors\/([^/]+)\/(move|fire-toast|open-iframe|close-iframe)$/,
    ([slug, id, type], body) => {
      getWorld(slug).events.push({ ...body, type, visitorId: id });
      return [200, {}];
    },
  ],
];

// ---- S3 (path-style: /s3/<bucket>/<key>) ----
// The AWS SDK only uses path-style URLs with a custom endpoint when the bucket name isn't a valid DNS
// name (FAKE_S3_BUCKET has an underscore for that) or the client sets forcePathStyle.
const readRaw = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
};

// Newer AWS SDKs stream uploads as aws-chunked: "<hex size>[;ext]\r\n<data>\r\n ... 0\r\n<trailers>".
const decodeAwsChunked = (raw) => {
  const parts = [];
  for (let i = 0; i < raw.length; ) {
    const eol = raw.indexOf("\r\n", i);
    const size = parseInt(raw.subarray(i, eol).toString().split(";")[0], 16);
    if (!size) break;
    parts.push(raw.subarray(eol + 2, eol + 2 + size));
    i = eol + 2 + size + 2;
  }
  return Buffer.concat(parts);
};

const s3Error = (res, status, code) => {
  res.writeHead(status, { "Content-Type": "application/xml" });
  res.end(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code></Error>`);
};

const handleS3 = async (req, res, url) => {
  const [bucket, ...keyParts] = url.pathname.slice("/s3/".length).split("/").map(decodeURIComponent);
  const key = keyParts.join("/");
  const id = `${bucket}/${key}`;
  const raw = await readRaw(req);
  if (req.method === "PUT" && key) {
    const chunked = String(req.headers["content-encoding"] || "").includes("aws-chunked") || req.headers["x-amz-decoded-content-length"];
    const bytes = chunked ? decodeAwsChunked(raw) : raw;
    s3Objects.set(id, { bucket, key, contentType: req.headers["content-type"], bytes });
    res.writeHead(200, { ETag: '"e2e-etag"' });
    return res.end();
  }
  if ((req.method === "GET" || req.method === "HEAD") && key) {
    const object = s3Objects.get(id);
    if (!object) return s3Error(res, 404, "NoSuchKey");
    res.writeHead(200, { "Content-Type": object.contentType || "application/octet-stream", "Content-Length": object.bytes.length, ETag: '"e2e-etag"' });
    return res.end(req.method === "GET" ? object.bytes : undefined);
  }
  if (req.method === "DELETE" && key) {
    s3Objects.delete(id);
    res.writeHead(204);
    return res.end();
  }
  console.error(`[mock-topia] unhandled S3 ${req.method} ${url.pathname}`);
  unhandledOutsideWorlds.push(`S3 ${req.method} ${url.pathname}`);
  s3Error(res, 501, "NotImplemented");
};

// A tiny PNG for every GET /images/<anything>: point seeded image URLs here when the server downloads them.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    // Binary bodies: handled before JSON parsing.
    if (url.pathname.startsWith("/s3/")) return await handleS3(req, res, url);
    if (req.method === "GET" && url.pathname.startsWith("/images/")) {
      res.writeHead(200, { "Content-Type": "image/png" });
      return res.end(PNG);
    }

    const body = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) ? await readBody(req) : {};

    // The public API mounts the world routes at /api/world as well as /api/v1/world (apps that call it with an
    // API key and no SDK use the short form).
    if (url.pathname.startsWith("/api/world/")) url.pathname = url.pathname.replace(/^\/api\/world\//, "/api/v1/world/");

    // API-key calls (Authorization header, no interactive credentials) skip the public key check, like
    // interactiveKeyValidator. Like apiKeyValidator, an unknown key is a 404 and a world that doesn't exist a 401.
    const apiKeyCall = !req.headers.publickey && !req.headers.interactivejwt && req.headers.authorization !== undefined;
    if (url.pathname.startsWith("/api/") && apiKeyCall) {
      if (req.headers.authorization !== API_KEY) return send(res, ...apiError(404, "User matching the API key not found."));
      const keySlug = url.pathname.match(/^\/api\/v1\/world\/([^/]+)\//)?.[1];
      if (keySlug && !worlds.has(decodeURIComponent(keySlug))) return send(res, ...apiError(401, "Please enter a valid world URL"));
    } else if (url.pathname.startsWith("/api/") && req.headers.publickey !== PUBLIC_KEY) {
      return send(res, 401, { message: "Invalid PublicKey header" });
    }
    // Like the public API, world-scoped calls need an API key or a visitor's interactive JWT. Without
    // this, an app that forwards missing credentials to the SDK would pass against the mock. So does
    // public-key-analytics (the real route runs interactiveKeyValidator + gameEngineValidator).
    // So does GET /scenes/:id (interactiveKeyValidator + globalApiValidator).
    const needsSession =
      url.pathname.startsWith("/api/v1/world/") ||
      url.pathname.startsWith("/api/v1/scenes/") ||
      url.pathname === "/api/v1/analytics/public-key-analytics";
    if (needsSession && !req.headers.authorization && !jwtNonce(req.headers.interactivejwt)) {
      return send(res, 401, { message: "Missing API key or interactive JWT with an interactiveNonce" });
    }

    // The world a call belongs to: the one in the path, or for calls outside /world/ (inventory, user
    // data objects, expressions, ...) the one named in the caller's InteractiveJWT. Webhooks under
    // /hooks/<urlSlug>/ belong to that world. Seeded latency, failures and catalogs apply to all of them.
    const pathSlug = url.pathname.match(/^\/api\/v1\/world\/([^/]+)\//)?.[1] ?? url.pathname.match(/^\/hooks\/([^/]+)\//)?.[1];
    const urlSlug = pathSlug ? decodeURIComponent(pathSlug) : jwtPayload(req.headers.interactivejwt).urlSlug;
    const seeded = urlSlug ? worlds.get(String(urlSlug)) : undefined;
    const call = `${req.method} ${url.pathname}`;
    // delays and failures keys are substrings of the call, optionally including its query string.
    const matches = (key) => `${call}${url.search}`.includes(key);

    // Like analyticsUrlSlugStamp: analytics sent with a write are attributed to the authenticated world (the
    // path's, else the JWT's), whatever urlSlug the app put in them. public-key-analytics does its own.
    if (Array.isArray(body.analytics) && urlSlug && url.pathname !== "/api/v1/analytics/public-key-analytics") {
      body.analytics = body.analytics.map((a) => (a && typeof a === "object" ? { ...a, urlSlug: String(urlSlug) } : a));
    }

    // Seeded latency, so concurrent requests overlap the way they do against the real API instead of
    // running one after another: latencyMs holds every call into the world, delays: { "<substring of
    // 'METHOD /api/v1/...?query'>": ms } only the matching ones (e.g. "/update-data-object": 300), so a test
    // can line up two requests deterministically.
    let waitMs = seeded?.latencyMs || 0;
    for (const [match, ms] of Object.entries(seeded?.delays || {})) {
      if (matches(match)) waitMs += ms;
    }
    // holdLocksDuringDelay: a data-object write with a lockId runs its delay inside the lock instead (see
    // writeDataObject), after the failure check below.
    const holdsLock =
      seeded?.holdLocksDuringDelay && body.lock?.lockId && new RegExp(`/(${WRITE_ENDPOINTS})$`).test(url.pathname);
    const holdMs = holdsLock ? waitMs : 0;
    if (waitMs && !holdsLock) await new Promise((resolve) => setTimeout(resolve, waitMs));

    // Seeded failures: { "<substring of 'METHOD /api/v1/...?query'>": status } answers matching calls with
    // that status (logged as "injected-failure" events), to test how the app handles a Topia call that fails.
    for (const [match, status] of Object.entries(seeded?.failures || {})) {
      if (matches(match)) {
        seeded.events.push({ type: "injected-failure", call, status });
        return send(res, status, { message: `mock-topia: injected ${status} for ${call}` });
      }
    }

    if (url.pathname.startsWith("/hooks/")) return send(res, ...hook(req, url, body));

    // Handlers may be async (e.g. to simulate latency). `seeded` is the call's world, if it was seeded;
    // `holdMs` the delay a data-object write runs while holding its lock (holdLocksDuringDelay), else 0;
    // `req` the raw request (req.headers, e.g. the InteractiveJWT: jwtPayload(req.headers.interactivejwt)).
    for (const [method, pattern, handler] of routes) {
      if (method !== req.method) continue;
      const match = url.pathname.match(pattern);
      if (!match) continue;
      const [status, payload] = await handler(match.slice(1).map(decodeURIComponent), body, url.searchParams, seeded, holdMs, req);
      return send(res, status, payload);
    }

    // Surfaces endpoints the app started calling that this mock doesn't know about yet; the e2e
    // fixture fails the test that triggered one.
    console.error(`[mock-topia] unhandled ${call}`);
    if (pathSlug) getWorld(urlSlug).unhandled.push(call);
    else if (seeded) seeded.unhandled.push(call);
    else unhandledOutsideWorlds.push(call);
    send(res, 501, { message: `mock-topia: unhandled ${call}` });
  } catch (error) {
    console.error("[mock-topia] error", error);
    send(res, 500, { message: String(error) });
  }
});

server.listen(PORT, () => console.log(`[mock-topia] listening on http://localhost:${PORT}`));
