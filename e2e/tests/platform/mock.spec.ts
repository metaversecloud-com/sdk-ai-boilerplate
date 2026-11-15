// Shared by every SDK app: keep this file identical across repos. Checks that mock-topia keeps the public
// API's rules the platform and app tests rely on (each one verified against topia-public-api), by calling it
// the way @rtsdk/topia does.
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { APIRequestContext } from "@playwright/test";
import { E2E_API_KEY, INTERACTIVE_KEY, INTERACTIVE_SECRET, MOCK_TOPIA_URL } from "../../constants";
import { expect, test, VISITOR_ID, type TopiaWorld } from "../../fixtures";
import { allHookCalls, hookCalls } from "../../helpers/hooks";

const API = `${MOCK_TOPIA_URL}/api/v1`;

/** An InteractiveJWT for a player of `world`, signed like the SDK signs it. */
const interactiveJwt = (world: TopiaWorld, visitorId = VISITOR_ID, extra: Record<string, unknown> = {}) => {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const payload = `${part({ alg: "HS256", typ: "JWT" })}.${part({
    interactiveNonce: `e2e-nonce-${world.urlSlug}`,
    visitorId,
    assetId: world.assetId,
    urlSlug: world.urlSlug,
    profileId: world.profileId,
    ...extra,
  })}`;
  return `${payload}.${createHmac("sha256", INTERACTIVE_SECRET).update(payload).digest("base64url")}`;
};

/** Calls the mock as a player of `world` (the SDK's publickey + interactiveJWT headers). */
const sdk = (request: APIRequestContext, world: TopiaWorld, visitorId = VISITOR_ID) => {
  const headers = { publickey: INTERACTIVE_KEY, interactivejwt: interactiveJwt(world, visitorId) };
  return {
    get: (path: string) => request.get(`${API}${path}`, { headers }),
    put: (path: string, data: object = {}) => request.put(`${API}${path}`, { headers, data }),
    post: (path: string, data: object = {}) => request.post(`${API}${path}`, { headers, data }),
    delete: (path: string) => request.delete(`${API}${path}`, { headers }),
  };
};

/** A raw RESP client for mock-redis: send(...args) resolves to the next reply's raw text. */
const respClient = async (port: number) => {
  const socket = net.connect(port);
  await new Promise((resolve) => socket.once("connect", resolve));
  let buffered = "";
  socket.on("data", (chunk) => (buffered += chunk));
  const read = async () => {
    for (let i = 0; i < 100 && !buffered; i++) await new Promise((r) => setTimeout(r, 10));
    const reply = buffered;
    buffered = "";
    return reply;
  };
  const send = (...args: string[]) => {
    socket.write(`*${args.length}\r\n${args.map((a) => `$${Buffer.byteLength(a)}\r\n${a}\r\n`).join("")}`);
    return read();
  };
  return { send, read, close: () => socket.destroy() };
};

const NPC_ITEM = { id: "npc-fox", name: "Fox", type: "NPC", status: "ACTIVE", metadata: { spriteUrl: "https://example.invalid/fox.png" } };

test.describe("mock-topia", () => {
  test("assets-with-unique-name: partial is a prefix match, and any partial value counts", async ({ request, world }) => {
    await world.seed({ extraAssets: { a: { id: "a", uniqueName: "board-1" }, b: { id: "b", uniqueName: "my-board" } } });
    const api = sdk(request, world);

    const names = async (query: string) =>
      ((await (await api.get(`/world/${world.urlSlug}/assets-with-unique-name/board${query}`)).json()).assets as any[]).map(
        (a) => a.uniqueName,
      );

    expect(await names("?partial=true")).toEqual(["board-1"]);
    expect(await names("?partial=false")).toEqual(["board-1"]);
    expect(await names("")).toEqual([]);
  });

  test("deleting an asset answers { success: true }, and 404 for one that doesn't exist", async ({ request, world }) => {
    await world.seed();
    const api = sdk(request, world);

    const deleted = await api.delete(`/world/${world.urlSlug}/assets/${world.assetId}`);
    expect(await deleted.json()).toEqual({ success: true });
    expect((await api.delete(`/world/${world.urlSlug}/assets/${world.assetId}`)).status()).toBe(404);
  });

  test("visitors have a username and can be filtered by landmark zone", async ({ request, world }) => {
    await world.seed({ otherVisitors: { 43: { inZone: false } } });
    const api = sdk(request, world);

    const all = await (await api.get(`/world/${world.urlSlug}/visitors`)).json();
    expect(all[VISITOR_ID].username).toBe("e2e-player");
    expect(all[43].username).toBe("player-43");
    const inZone = await (await api.get(`/world/${world.urlSlug}/visitors?droppedAssetId=${world.assetId}`)).json();
    expect(Object.keys(inZone)).toEqual([String(VISITOR_ID)]);
  });

  test("analytics count for the session's world, not the urlSlug the app sends", async ({ request, world }) => {
    await world.seed();
    const api = sdk(request, world);

    await api.put("/analytics/public-key-analytics", {
      analytics: [{ analyticName: "starts", urlSlug: "some-other-world" }, { analyticName: "starts-AbCdEfGhIjKlMnOpQrSt" }],
    });
    await api.put(`/user/dataObjects/${world.profileId}/update-data-object`, {
      dataObject: {},
      analytics: [{ analyticName: "plays", urlSlug: "some-other-world" }],
    });

    expect(await world.events("analytics")).toEqual([
      expect.objectContaining({ analyticName: "starts", urlSlug: world.urlSlug, sentUrlSlug: "some-other-world" }),
      expect.objectContaining({ analyticName: "plays", urlSlug: world.urlSlug }),
    ]);
    expect(await world.events("analytics-rejected")).toEqual([
      expect.objectContaining({ analyticName: "starts-AbCdEfGhIjKlMnOpQrSt" }),
    ]);
  });

  test("failures and delays can match the query string", async ({ request, world }) => {
    await world.seed({ failures: { "assets-with-unique-name/board?partial": 503 } });
    const api = sdk(request, world);

    expect((await api.get(`/world/${world.urlSlug}/assets-with-unique-name/board?partial=true`)).status()).toBe(503);
    expect((await api.get(`/world/${world.urlSlug}/assets-with-unique-name/board`)).status()).toBe(200);
  });

  test("interactive-credentials accepts a complete session only", async ({ request, world }) => {
    await world.seed();

    expect((await sdk(request, world).get("/auth/interactive-credentials")).status()).toBe(200);
    const incomplete = await request.get(`${API}/auth/interactive-credentials`, {
      headers: { publickey: INTERACTIVE_KEY, interactivejwt: interactiveJwt(world, VISITOR_ID, { assetId: "" }) },
    });
    expect(incomplete.status()).toBe(401);
  });

  test("drop-scene needs an admin unless allowNonAdmins, and returns the sceneDropId", async ({ request, world }) => {
    await world.seed();
    const api = sdk(request, world);

    expect((await api.post(`/world/${world.urlSlug}/drop-scene`, { sceneId: "s1" })).status()).toBe(401);
    const dropped = await api.post(`/world/${world.urlSlug}/drop-scene`, { sceneId: "s1", sceneDropId: "drop-1", allowNonAdmins: true });
    expect(await dropped.json()).toEqual({ sceneDropId: "drop-1", success: true });
    const { assets } = await (await api.get(`/world/${world.urlSlug}/assets-with-scene-drop-id/drop-1`)).json();
    expect(assets).toHaveLength(1);
  });

  test("private-zone and interactive settings land on the asset's real fields", async ({ request, world }) => {
    await world.seed({ asset: { isInteractive: true, interactivePublicKey: "k" } });
    const api = sdk(request, world);
    const asset = `/world/${world.urlSlug}/assets/${world.assetId}`;

    await api.put(`${asset}/set-private-zone`, { isPrivateZone: true, privateZoneUserCap: 4 });
    await api.put(`${asset}/set-asset-interactive-settings`, {});

    expect((await world.state()).assets[world.assetId]).toMatchObject({
      assetPrivateConversation: true,
      assetPrivateConversationCap: 4,
      isInteractive: false,
      interactivePublicKey: "",
    });
  });

  test("user group data objects", async ({ request, world }) => {
    await world.seed({ userGroupDataObjects: [{ teams: { url: "x" } }] });

    const response = await sdk(request, world).get(`/world/${world.urlSlug}/visitors/${VISITOR_ID}/user-group-data-object`);
    expect(await response.json()).toEqual({ success: true, userGroupDataObjects: [{ teams: { url: "x" } }] });
  });

  test("NPCs and voice sessions follow the public API's rules", async ({ request, world }) => {
    await world.seed({ inventoryItems: [NPC_ITEM], inventory: [{ item: "npc-fox" }] });
    const api = sdk(request, world);
    const visitor = `/world/${world.urlSlug}/visitors/${VISITOR_ID}`;
    const [owned] = await (await api.get(`${visitor}/get-visitor-inventory-items`)).json();
    const voice = { voiceConfig: { ephemeralKey: "ek_1", voice: "alloy", instructions: "Be nice" } };

    expect((await api.put(`${visitor}/start-npc-voice-session`, voice)).status()).toBe(400);
    const created = await (await api.post(`${visitor}/create-npc`, { userInventoryItemId: owned.id })).json();
    expect(created.player).toMatchObject({ username: "Fox", npcFollowPlayerId: VISITOR_ID });
    expect((await api.post(`${visitor}/create-npc`, { userInventoryItemId: owned.id })).status()).toBe(409);
    expect((await api.post(`${visitor}/create-npc`, { userInventoryItemId: owned.id, spawnEffect: { duration: 5 } })).status()).toBe(400);
    expect((await api.put(`${visitor}/start-npc-voice-session`, { voiceConfig: { ...voice.voiceConfig, ephemeralKey: "sk_1" } })).status()).toBe(400);
    expect((await api.put(`${visitor}/start-npc-voice-session`, voice)).status()).toBe(200);
    expect((await api.put(`${visitor}/start-npc-voice-session`, voice)).status()).toBe(200);
    const visitors = await (await api.get(`/world/${world.urlSlug}/visitors`)).json();
    expect(visitors[created.player.playerId]).toMatchObject({ username: "Fox" });

    expect(await (await api.delete(`${visitor}/delete-npc`)).json()).toEqual({ success: true });
    expect((await world.events()).map((e) => e.type)).toEqual(
      expect.arrayContaining(["create-npc", "start-npc-voice-session", "delete-npc", "stopAiNpcVoice"]),
    );
    expect(await (await api.get(`${visitor}/get-npc`)).json()).toBeNull();
  });

  test("an NPC item another player owns is refused", async ({ request, world }) => {
    await world.seed({ inventoryItems: [NPC_ITEM], otherVisitors: { 43: { inventory: [{ item: "npc-fox" }] } } });
    const [owned] = await (await sdk(request, world, 43).get(`/world/${world.urlSlug}/visitors/43/get-visitor-inventory-items`)).json();

    const response = await sdk(request, world).post(`/world/${world.urlSlug}/visitors/${VISITOR_ID}/create-npc`, {
      userInventoryItemId: owned.id,
    });
    expect(response.status()).toBe(403);
  });

  test("webhooks are recorded, fail on request, and get the world's failures", async ({ request, world }) => {
    await world.seed();
    const hook = (name: string) => `${MOCK_TOPIA_URL}/hooks/${world.urlSlug}/${name}`;

    expect((await request.post(hook("ok"), { data: { text: "hi" } })).status()).toBe(200);
    expect((await request.post(hook("fail-500"), { data: {} })).status()).toBe(500);
    await world.setFailures({ "/hooks/": 502 });
    expect((await request.post(hook("ok"), { data: {} })).status()).toBe(502);

    expect(await hookCalls(request, world, "ok")).toEqual([expect.objectContaining({ method: "POST", body: { text: "hi" } })]);
    expect((await allHookCalls(request)).length).toBeGreaterThanOrEqual(2);
  });

  test("scenes: a seeded scene by id, and null (not a 404) for an unknown one", async ({ request, world }) => {
    await world.seed({ scenes: { "scene-a": { name: "Track A", width: 2000 } } });
    const api = sdk(request, world);

    expect(await (await api.get("/scenes/scene-a")).json()).toEqual({ id: "scene-a", name: "Track A", width: 2000 });
    const missing = await api.get("/scenes/nope");
    expect(missing.status()).toBe(200);
    expect(await missing.json()).toBeNull();
  });

  test("extraAssets get their key as id unless they name one", async ({ request, world }) => {
    await world.seed({ extraAssets: { "board-1": { uniqueName: "board" } } });

    const asset = await (await sdk(request, world).get(`/world/${world.urlSlug}/assets/board-1`)).json();
    expect(asset).toMatchObject({ id: "board-1", uniqueName: "board" });
  });

  test("mock-redis: strings with options, pub/sub, and an error for commands it doesn't know", async () => {
    // Its own instance on a free port: the suite only starts mock-redis for apps with MOCK_REDIS.
    const port = await new Promise<number>((resolve) => {
      const probe = net.createServer().listen(0, () => {
        const { port: free } = probe.address() as net.AddressInfo;
        probe.close(() => resolve(free));
      });
    });
    const e2eDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const server = spawn(process.execPath, ["mock-redis/server.mjs"], { cwd: e2eDir, env: { ...process.env, MOCK_REDIS_PORT: String(port) } });
    try {
      await new Promise((resolve, reject) => {
        server.stdout.on("data", (chunk) => String(chunk).includes("listening") && resolve(undefined));
        server.once("exit", reject);
      });
      const client = await respClient(port);
      const subscriber = await respClient(port);

      expect(await client.send("SET", "k", "v")).toBe("+OK\r\n");
      expect(await client.send("SET", "k", "w", "NX")).toBe("$-1\r\n");
      expect(await client.send("GET", "k")).toBe("$1\r\nv\r\n");
      expect(await client.send("SET", "t", "1", "PX", "50")).toBe("+OK\r\n");
      await new Promise((r) => setTimeout(r, 80));
      expect(await client.send("GET", "t")).toBe("$-1\r\n");
      expect(await client.send("INCRBY", "n", "5")).toBe(":5\r\n");
      expect(await client.send("HSET", "h", "a", "1")).toBe(":1\r\n");
      expect(await client.send("GET", "h")).toMatch(/^-WRONGTYPE/);

      expect(await subscriber.send("SUBSCRIBE", "ch")).toBe("*3\r\n$9\r\nsubscribe\r\n$2\r\nch\r\n:1\r\n");
      expect(await client.send("PUBLISH", "ch", "hi")).toBe(":1\r\n");
      expect(await subscriber.read()).toBe("*3\r\n$7\r\nmessage\r\n$2\r\nch\r\n$2\r\nhi\r\n");

      expect(await client.send("ZADD", "z", "1", "a")).toMatch(/^-ERR unknown command/);
      client.close();
      subscriber.close();
    } finally {
      server.kill();
    }
  });

  test("API-key calls: the unversioned /api/world routes, unknown keys and worlds", async ({ request, world }) => {
    await world.seed();
    const withKey = (key: string, slug = world.urlSlug) =>
      request.get(`${MOCK_TOPIA_URL}/api/world/${slug}/world-details`, { headers: { authorization: key } });

    expect((await withKey(E2E_API_KEY)).status()).toBe(200);
    expect((await withKey("someone-elses-key")).status()).toBe(404);
    expect((await withKey(E2E_API_KEY, `${world.urlSlug}-missing`)).status()).toBe(401);
  });
});
