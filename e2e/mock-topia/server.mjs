// Minimal in-memory fake of the Topia public API (https://<INSTANCE_DOMAIN>/api/v1), covering the
// endpoints @rtsdk/topia calls on behalf of SDK apps. Zero dependencies. When an app calls an
// endpoint that isn't here, the test fails with "public-API calls mock-topia doesn't implement":
// add a route below. Also fakes the leaderboard app's stats endpoint the boilerplate example calls, a
// path-style S3 bucket under /s3 (playwright.config points AWS_ENDPOINT_URL_S3 here) and image
// downloads under /images.
//
// State is partitioned by urlSlug, so every test seeds its own world and tests can run in parallel.
// Test-only control routes live under /__mock:
//   POST /__mock/worlds/:urlSlug   seed a world  { dataObject, assets, visitors, users?, inventoryItems?,
//                                  expressions?, latencyMs?, delays?, failures? }
//   GET  /__mock/worlds/:urlSlug   read world state + event log (particles, toasts, grants, analytics, ...)
//   PATCH /__mock/worlds/:urlSlug/visitors/:id   change visitor fields mid-test (position, isAdmin, ...)
//   GET  /__mock/users/:profileId  read a user data object
//   GET  /__mock/unhandled         public-API calls the mock didn't recognize, outside any world
//   GET  /__mock/s3                objects in the fake S3 [{ bucket, key, size, contentType }] (all tests)
//   GET  /__mock/health

import http from "node:http";

const PORT = Number(process.env.MOCK_TOPIA_PORT || 3101);
const PUBLIC_KEY = process.env.INTERACTIVE_KEY || "e2e-public-key";

// Default ecosystem inventory catalog; world.seed({ inventoryItems }) replaces it for one world.
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

// Default unlockable expressions (emotes); world.seed({ expressions }) replaces them for one world.
const EXPRESSIONS = [
  { id: "emote-wave", name: "Wave", type: "emote", expressionImage: "https://example.invalid/emotes/wave.png" },
  { id: "emote-dance", name: "Dance", type: "emote", expressionImage: "https://example.invalid/emotes/dance.png" },
];

const PARTICLES = ["brain_float", "partyPopper_float", "confetti_float"].map((name, i) => ({ id: `particle-${i + 1}`, name }));

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
      const { users: userData = {}, ...rest } = clone(body);
      const world = { ...emptyWorld(), ...rest };
      for (const visitor of Object.values(world.visitors)) {
        visitorRecord(visitor).dataObject = visitor.dataObject || {};
        delete visitor.dataObject;
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
    /^\/api\/v1\/user\/dataObjects\/([^/]+)\/get-data-object$/,
    ([profileId]) => [200, readDataObject(getUser(profileId))],
  ],
  [
    "PUT",
    new RegExp(`^/api/v1/user/dataObjects/([^/]+)/(${WRITE_ENDPOINTS})$`),
    // Analytics sent with the write are logged in the caller's world.
    ([profileId, endpoint], body, _, world) => writeDataObject(endpoint, getUser(profileId), body, world),
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

  [
    "GET",
    /^\/api\/v1\/world\/([^/]+)\/assets-with-unique-name\/([^/]+)$/,
    ([slug, uniqueName], _, query) => {
      const partial = query.get("partial") === "true";
      const assets = Object.values(getWorld(slug).assets)
        .filter((a) => (partial ? String(a.uniqueName ?? "").includes(uniqueName) : a.uniqueName === uniqueName))
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
    /^\/api\/v1\/world\/([^/]+)\/assets\/([^/]+)\/(set-webhook-zone|set-landmark-zone|set-webimage-layers|change-click-type|change-media-type)$/,
    ([slug, id, updateType], body) => {
      const world = getWorld(slug);
      const asset = world.assets[id];
      if (!asset) return [404, { message: "Asset not found" }];
      Object.assign(asset, body);
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
      delete world.assets[id];
      world.events.push({ type: "delete-asset", assetId: id });
      return [200, {}];
    },
  ],

  // ---- visitors ----
  [
    "GET",
    /^\/api\/v1\/world\/([^/]+)\/visitors$/,
    ([slug]) => {
      // Current visitors keyed by visitorId (World.fetchVisitors, WorldActivity.currentVisitors).
      const result = {};
      for (const [id, visitor] of Object.entries(getWorld(slug).visitors)) {
        const { dataObject, inventory, ...details } = visitor;
        result[id] = { ...details, visitorId: Number(id) };
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
      const { dataObject, inventory, ...details } = visitor;
      return [200, { ...details, visitorId: Number(id), profile: { profileId: visitor.profileId } }];
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
    ([slug, id, endpoint], body) => {
      const visitor = getWorld(slug).visitors[id];
      return visitor
        ? writeDataObject(endpoint, visitorRecord(visitor), body, getWorld(slug))
        : [404, { message: "Visitor not found" }];
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

    // The world a call belongs to: the one in the path, or for calls outside /world/ (inventory, user
    // data objects, expressions, ...) the one named in the caller's InteractiveJWT. Seeded latency,
    // failures and catalogs apply to both.
    const pathSlug = url.pathname.match(/^\/api\/v1\/world\/([^/]+)\//)?.[1];
    const urlSlug = pathSlug ? decodeURIComponent(pathSlug) : jwtPayload(req.headers.interactivejwt).urlSlug;
    const seeded = urlSlug ? worlds.get(String(urlSlug)) : undefined;
    const call = `${req.method} ${url.pathname}`;

    // Seeded latency, so concurrent requests overlap the way they do against the real API instead of
    // running one after another: latencyMs holds every call into the world, delays: { "<substring of
    // 'METHOD /api/v1/...'>": ms } only the matching ones (e.g. "/update-data-object": 300), so a test
    // can line up two requests deterministically.
    let waitMs = seeded?.latencyMs || 0;
    for (const [match, ms] of Object.entries(seeded?.delays || {})) {
      if (call.includes(match)) waitMs += ms;
    }
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));

    // Seeded failures: { "<substring of 'METHOD /api/v1/...'>": status } answers matching calls with that
    // status (logged as "injected-failure" events), to test how the app handles a Topia call that fails.
    for (const [match, status] of Object.entries(seeded?.failures || {})) {
      if (call.includes(match)) {
        seeded.events.push({ type: "injected-failure", call, status });
        return send(res, status, { message: `mock-topia: injected ${status} for ${call}` });
      }
    }

    // Handlers may be async (e.g. to simulate latency). `seeded` is the call's world, if it was seeded.
    for (const [method, pattern, handler] of routes) {
      if (method !== req.method) continue;
      const match = url.pathname.match(pattern);
      if (!match) continue;
      const [status, payload] = await handler(match.slice(1).map(decodeURIComponent), body, url.searchParams, seeded);
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
