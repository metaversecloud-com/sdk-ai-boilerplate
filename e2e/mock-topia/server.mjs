// Minimal in-memory fake of the Topia public API (https://<INSTANCE_DOMAIN>/api/v1), covering the
// endpoints @rtsdk/topia calls on behalf of SDK apps. Zero dependencies. When an app calls an
// endpoint that isn't here, the test fails with "public-API calls mock-topia doesn't implement":
// add a route below. Also fakes the leaderboard app's stats endpoint the boilerplate example calls.
//
// State is partitioned by urlSlug, so every test seeds its own world and tests can run in parallel.
// Test-only control routes live under /__mock:
//   POST /__mock/worlds/:urlSlug   seed a world  { dataObject, assets, visitors, latencyMs?, delays? }
//   GET  /__mock/worlds/:urlSlug   read world state + event log (particles, toasts, grants, analytics, ...)
//   PATCH /__mock/worlds/:urlSlug/visitors/:id   change visitor fields mid-test (position, isAdmin, ...)
//   GET  /__mock/users/:profileId  read a user data object
//   GET  /__mock/unhandled         public-API calls the mock didn't recognize, outside any world
//   GET  /__mock/health

import http from "node:http";

const PORT = Number(process.env.MOCK_TOPIA_PORT || 3101);
const PUBLIC_KEY = process.env.INTERACTIVE_KEY || "e2e-public-key";

const INVENTORY_ITEMS = ["Perfect Score", "Lightning Round", "Quiz Master", "Top 3 Finisher"].map((name, i) => ({
  id: `badge-${i + 1}`,
  name,
  type: "BADGE",
  status: "ACTIVE",
  description: `${name} badge`,
  image_path: `https://example.invalid/badges/${i + 1}.png`,
}));

/** A visitor inventory entry the way GET get-visitor-inventory-items returns it. */
const ownedItem = (id, item, quantity = 1) => ({
  id,
  item_id: item.id,
  itemId: item.id,
  quantity,
  name: item.name,
  type: item.type,
  status: item.status,
  image_url: item.image_path,
  item: { id: item.id, name: item.name, description: item.description, type: item.type, image_url: item.image_path },
});

const PARTICLES = ["brain_float", "partyPopper_float", "confetti_float"].map((name, i) => ({ id: `particle-${i + 1}`, name }));

const worlds = new Map();
const users = new Map();
const unhandledOutsideWorlds = [];
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

// interactiveNonce from an InteractiveJWT's payload. The signature isn't checked.
const jwtNonce = (token) => {
  try {
    return JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString()).interactiveNonce;
  } catch {
    return undefined;
  }
};

// A literal null body stays null (some endpoints answer null), only a missing one becomes {}.
const send = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body === undefined ? {} : body));
};

// Like the public API, a write naming a lock.lockId fails with 409 while that lock is held on the same
// data object; releaseLock: true frees it after the write, otherwise it stays held.
const heldLocks = new WeakMap(); // data-object holder -> Set of lockIds

const WRITE_ACTIONS = { "set-data-object": "set", "update-data-object": "update", "increment-data-object-value": "increment" };
const WRITE_ENDPOINTS = Object.keys(WRITE_ACTIONS).join("|");

const readDataObject = (holder) => clone(holder.dataObject || {});

// Data-object writes shared by world, dropped asset, visitor and user. Returns [status, body].
// Analytics sent with a successful write are logged as "analytics" events in `world` (if given).
const writeDataObject = (endpoint, holder, body, world) => {
  const lockId = body.lock?.lockId;
  if (!heldLocks.has(holder)) heldLocks.set(holder, new Set());
  const locks = heldLocks.get(holder);
  if (lockId) {
    if (locks.has(lockId)) {
      return [409, { message: "This data object is busy. Another process has acquired this data object lock." }];
    }
    locks.add(lockId);
  }
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

const routes = [
  // ---- control plane ----
  ["GET", /^\/__mock\/health$/, () => [200, { ok: true }]],
  [
    "POST",
    /^\/__mock\/worlds\/([^/]+)$/,
    ([urlSlug], body) => {
      worlds.set(urlSlug, { ...emptyWorld(), ...clone(body) });
      return [200, { ok: true }];
    },
  ],
  ["GET", /^\/__mock\/worlds\/([^/]+)$/, ([urlSlug]) => [200, getWorld(urlSlug)]],
  [
    "PATCH",
    /^\/__mock\/worlds\/([^/]+)\/visitors\/([^/]+)$/,
    ([urlSlug, id], body) => {
      const visitor = getWorld(urlSlug).visitors[id];
      if (!visitor) return [404, { message: "Visitor not found" }];
      Object.assign(visitor, clone(body));
      return [200, { ok: true }];
    },
  ],
  ["GET", /^\/__mock\/users\/([^/]+)$/, ([profileId]) => [200, getUser(profileId)]],
  ["GET", /^\/__mock\/unhandled$/, () => [200, unhandledOutsideWorlds]],

  // ---- ecosystem ----
  ["GET", /^\/api\/v1\/inventory\/?$/, () => [200, INVENTORY_ITEMS]],
  [
    "GET",
    /^\/api\/v1\/particles$/,
    (_, __, query) => [200, query.get("name") ? PARTICLES.filter((p) => p.name === query.get("name")) : PARTICLES],
  ],
  [
    "PUT",
    /^\/api\/v1\/analytics\/public-key-analytics$/,
    (_, body) => {
      // Not world-scoped: each analytic names its world, so it's logged there as an "analytics" event.
      for (const analytic of body.analytics || []) {
        getWorld(String(analytic.urlSlug)).events.push({ ...analytic, type: "analytics", source: "public-key" });
      }
      return [200, {}];
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
    "GET",
    /^\/api\/v1\/user\/dataObjects\/([^/]+)\/get-data-object$/,
    ([profileId]) => [200, readDataObject(getUser(profileId))],
  ],
  [
    "PUT",
    new RegExp(`^/api/v1/user/dataObjects/([^/]+)/(${WRITE_ENDPOINTS})$`),
    ([profileId, endpoint], body) => writeDataObject(endpoint, getUser(profileId), body),
  ],

  // ---- world ----
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
    ([slug, endpoint], body) => writeDataObject(endpoint, getWorld(slug), body, getWorld(slug)),
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
    /^\/api\/v1\/world\/([^/]+)\/assets\/([^/]+)\/data-object$/,
    ([slug, id]) => {
      const asset = getWorld(slug).assets[id];
      return asset ? [200, readDataObject(asset)] : [404, { message: "Asset not found" }];
    },
  ],
  [
    "PUT",
    new RegExp(`^/api/v1/world/([^/]+)/assets/([^/]+)/(${WRITE_ENDPOINTS})$`),
    ([slug, id, endpoint], body) => {
      const asset = getWorld(slug).assets[id];
      return asset ? writeDataObject(endpoint, asset, body, getWorld(slug)) : [404, { message: "Asset not found" }];
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
    /^\/api\/v1\/world\/([^/]+)\/assets\/([^/]+)\/(set-webhook-zone|set-landmark-zone|set-webimage-layers)$/,
    ([slug, id, updateType], body) => {
      const world = getWorld(slug);
      const asset = world.assets[id];
      if (!asset) return [404, { message: "Asset not found" }];
      Object.assign(asset, body);
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
      delete world.assets[id];
      world.events.push({ type: "delete-asset", assetId: id });
      return [200, {}];
    },
  ],

  // ---- visitors ----
  [
    "GET",
    /^\/api\/v1\/world\/([^/]+)\/visitors\/([^/]+)$/,
    ([slug, id]) => {
      const visitor = getWorld(slug).visitors[id];
      if (!visitor) return [404, { message: "Visitor not found" }];
      const { dataObject, inventory, ...details } = visitor;
      return [200, { ...details, visitorId: Number(id), profile: { profileId: visitor.profileId } }];
    },
  ],
  [
    "GET",
    /^\/api\/v1\/world\/([^/]+)\/visitors\/([^/]+)\/get-data-object$/,
    ([slug, id]) => {
      const visitor = getWorld(slug).visitors[id];
      return visitor ? [200, readDataObject(visitor)] : [404, { message: "Visitor not found" }];
    },
  ],
  [
    "PUT",
    new RegExp(`^/api/v1/world/([^/]+)/visitors/([^/]+)/(${WRITE_ENDPOINTS})$`),
    ([slug, id, endpoint], body) => {
      const visitor = getWorld(slug).visitors[id];
      return visitor ? writeDataObject(endpoint, visitor, body, getWorld(slug)) : [404, { message: "Visitor not found" }];
    },
  ],
  [
    "GET",
    /^\/api\/v1\/world\/([^/]+)\/visitors\/([^/]+)\/get-visitor-inventory-items$/,
    ([slug, id]) => [200, getWorld(slug).visitors[id]?.inventory || []],
  ],
  [
    "PUT",
    /^\/api\/v1\/world\/([^/]+)\/visitors\/([^/]+)\/grant-visitor-inventory-item$/,
    ([slug, id], body) => {
      const world = getWorld(slug);
      const visitor = world.visitors[id];
      const item = INVENTORY_ITEMS.find((i) => i.id === body.itemId);
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
    /^\/api\/v1\/world\/([^/]+)\/visitors\/([^/]+)\/(move|fire-toast|open-iframe|close-iframe)$/,
    ([slug, id, type], body) => {
      getWorld(slug).events.push({ ...body, type, visitorId: id });
      return [200, {}];
    },
  ],
];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    const body = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) ? await readBody(req) : {};

    if (url.pathname.startsWith("/api/") && req.headers.publickey !== PUBLIC_KEY) {
      return send(res, 401, { message: "Invalid PublicKey header" });
    }
    // Like the public API, world-scoped calls need an API key or a visitor's interactive JWT. Without
    // this, an app that forwards missing credentials to the SDK would pass against the mock. So does
    // public-key-analytics (the real route runs interactiveKeyValidator + gameEngineValidator).
    const needsSession = url.pathname.startsWith("/api/v1/world/") || url.pathname === "/api/v1/analytics/public-key-analytics";
    if (needsSession && !req.headers.authorization && !jwtNonce(req.headers.interactivejwt)) {
      return send(res, 401, { message: "Missing API key or interactive JWT with an interactiveNonce" });
    }

    // Seeded latency, so concurrent requests overlap the way they do against the real API instead of
    // running one after another: latencyMs holds every call into the world, delays: { "<substring of
    // 'METHOD /api/v1/world/...'>": ms } only the matching ones (e.g. "/update-data-object": 300), so
    // a test can line up two requests deterministically.
    const worldSlug = url.pathname.match(/^\/api\/v1\/world\/([^/]+)\//)?.[1];
    const seeded = worldSlug ? worlds.get(decodeURIComponent(worldSlug)) : undefined;
    let waitMs = seeded?.latencyMs || 0;
    for (const [match, ms] of Object.entries(seeded?.delays || {})) {
      if (`${req.method} ${url.pathname}`.includes(match)) waitMs += ms;
    }
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));

    // Handlers may be async (e.g. to simulate latency).
    for (const [method, pattern, handler] of routes) {
      if (method !== req.method) continue;
      const match = url.pathname.match(pattern);
      if (!match) continue;
      const [status, payload] = await handler(match.slice(1).map(decodeURIComponent), body, url.searchParams);
      return send(res, status, payload);
    }

    // Surfaces endpoints the app started calling that this mock doesn't know about yet; the e2e
    // fixture fails the test that triggered one.
    console.error(`[mock-topia] unhandled ${req.method} ${url.pathname}`);
    const call = `${req.method} ${url.pathname}`;
    if (worldSlug) getWorld(decodeURIComponent(worldSlug)).unhandled.push(call);
    else unhandledOutsideWorlds.push(call);
    send(res, 501, { message: `mock-topia: unhandled ${req.method} ${url.pathname}` });
  } catch (error) {
    console.error("[mock-topia] error", error);
    send(res, 500, { message: String(error) });
  }
});

server.listen(PORT, () => console.log(`[mock-topia] listening on http://localhost:${PORT}`));
