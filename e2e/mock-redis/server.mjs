// Shared by every SDK app: keep this file identical across repos. Started by playwright.config.ts only when
// app.config.ts sets MOCK_REDIS = true; appEnv.ts then points REDIS_URL here.
//
// Minimal in-memory Redis (RESP2) for apps that keep state or fan live updates out (SSE) through Redis,
// generalized from sdk-race#53 (also used by sdk-chess-game#66, jukebox#29, leaderboard#7). Zero dependencies.
// Covers what node-redis v4 and the SDK apps use: strings (GET, SET with EX/PX/NX/XX/GET, MGET, DEL, EXISTS,
// INCR/INCRBY/DECR/DECRBY, EXPIRE/PEXPIRE/TTL/PTTL, KEYS), hashes (HSET, HGET, HGETALL, HDEL), pub/sub
// (PUBLISH, SUBSCRIBE, UNSUBSCRIBE, PSUBSCRIBE, PUNSUBSCRIBE) and the connection handshake (AUTH, SELECT,
// CLIENT, READONLY: acknowledged with OK; PING, ECHO, INFO, QUIT). Any other command answers an error (and is
// logged to stderr) instead of a fake OK, so an app that starts using one fails visibly: add it here.
//
// One keyspace for the whole suite: key everything by world (urlSlug, profileId, assetId) so parallel tests
// never share state.

import net from "node:net";

const PORT = Number(process.env.MOCK_REDIS_PORT || 3102);

const store = new Map(); // key -> { value: string | Map<string, string>, expiresAt?: number }
const subscribers = new Map(); // channel -> Set<socket>
const patternSubscribers = new Map(); // pattern -> Set<socket>

const simple = (s) => `+${s}\r\n`;
const error = (s) => `-${s}\r\n`;
const integer = (n) => `:${n}\r\n`;
const bulk = (s) => (s === null || s === undefined ? "$-1\r\n" : `$${Buffer.byteLength(s)}\r\n${s}\r\n`);
const array = (items) => `*${items.length}\r\n${items.join("")}`;
const WRONGTYPE = error("WRONGTYPE Operation against a key holding the wrong kind of value");

// Glob match for KEYS / PSUBSCRIBE (*, ?, [...]).
const globToRegExp = (glob) =>
  new RegExp(`^${glob.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);

const entry = (key) => {
  const found = store.get(key);
  if (found?.expiresAt !== undefined && found.expiresAt <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  return found;
};
const stringValue = (key) => {
  const found = entry(key);
  if (found && typeof found.value !== "string") throw WRONGTYPE;
  return found?.value ?? null;
};
const hash = (key, create = false) => {
  const found = entry(key);
  if (found && !(found.value instanceof Map)) throw WRONGTYPE;
  if (!found && create) {
    const created = { value: new Map() };
    store.set(key, created);
    return created.value;
  }
  return found?.value;
};

const incrementBy = (key, by) => {
  const current = stringValue(key);
  if (current !== null && !/^-?\d+$/.test(current)) return error("ERR value is not an integer or out of range");
  const next = Number(current ?? 0) + by;
  store.set(key, { value: String(next), expiresAt: entry(key)?.expiresAt });
  return integer(next);
};

const set = ([key, value, ...options]) => {
  let expiresAt;
  let condition;
  let returnOld = false;
  let keepTtl = false;
  for (let i = 0; i < options.length; i++) {
    const option = options[i].toUpperCase();
    if (option === "EX") expiresAt = Date.now() + Number(options[++i]) * 1000;
    else if (option === "PX") expiresAt = Date.now() + Number(options[++i]);
    else if (option === "EXAT") expiresAt = Number(options[++i]) * 1000;
    else if (option === "PXAT") expiresAt = Number(options[++i]);
    else if (option === "NX" || option === "XX") condition = option;
    else if (option === "GET") returnOld = true;
    else if (option === "KEEPTTL") keepTtl = true;
    else return error("ERR syntax error");
  }
  const old = returnOld ? stringValue(key) : undefined;
  const exists = !!entry(key);
  if ((condition === "NX" && exists) || (condition === "XX" && !exists)) return returnOld ? bulk(old) : bulk(null);
  store.set(key, { value, expiresAt: keepTtl ? entry(key)?.expiresAt : expiresAt });
  return returnOld ? bulk(old) : simple("OK");
};

const publish = (channel, message) => {
  let receivers = 0;
  for (const socket of subscribers.get(channel) || []) {
    socket.write(array([bulk("message"), bulk(channel), bulk(message)]));
    receivers++;
  }
  for (const [pattern, sockets] of patternSubscribers) {
    if (!globToRegExp(pattern).test(channel)) continue;
    for (const socket of sockets) {
      socket.write(array([bulk("pmessage"), bulk(pattern), bulk(channel), bulk(message)]));
      receivers++;
    }
  }
  return receivers;
};

const subscriptionCount = (socket) =>
  [...subscribers.values(), ...patternSubscribers.values()].filter((sockets) => sockets.has(socket)).length;

const subscribe = (socket, registry, kind, channels) =>
  channels
    .map((channel) => {
      if (!registry.has(channel)) registry.set(channel, new Set());
      registry.get(channel).add(socket);
      return array([bulk(kind), bulk(channel), integer(subscriptionCount(socket))]);
    })
    .join("");

const unsubscribe = (socket, registry, kind, channels) => {
  const targets = channels.length ? channels : [...registry.keys()].filter((c) => registry.get(c).has(socket));
  if (!targets.length) return array([bulk(kind), bulk(null), integer(subscriptionCount(socket))]);
  return targets
    .map((channel) => {
      registry.get(channel)?.delete(socket);
      return array([bulk(kind), bulk(channel), integer(subscriptionCount(socket))]);
    })
    .join("");
};

const handle = (socket, [rawName, ...args]) => {
  const name = String(rawName || "").toUpperCase();
  switch (name) {
    case "PING":
      return args.length ? bulk(args[0]) : simple("PONG");
    case "ECHO":
      return bulk(args[0]);
    case "INFO":
      return bulk("# Server\r\nredis_version:7.2.0\r\nredis_mode:standalone\r\nloading:0\r\n");
    case "AUTH":
    case "SELECT":
    case "CLIENT":
    case "READONLY":
      // Handshake: nothing to do in a single-tenant fake.
      return simple("OK");
    case "QUIT":
      socket.end(simple("OK"));
      return "";
    case "GET":
      return bulk(stringValue(args[0]));
    case "MGET":
      return array(args.map((key) => bulk(entry(key) && typeof entry(key).value === "string" ? entry(key).value : null)));
    case "SET":
      return set(args);
    case "SETEX":
      return set([args[0], args[2], "EX", args[1]]);
    case "DEL":
    case "UNLINK":
      return integer(args.filter((key) => entry(key) && store.delete(key)).length);
    case "EXISTS":
      return integer(args.filter((key) => entry(key)).length);
    case "INCR":
      return incrementBy(args[0], 1);
    case "INCRBY":
      return incrementBy(args[0], Number(args[1]));
    case "DECR":
      return incrementBy(args[0], -1);
    case "DECRBY":
      return incrementBy(args[0], -Number(args[1]));
    case "EXPIRE":
    case "PEXPIRE": {
      const found = entry(args[0]);
      if (!found) return integer(0);
      found.expiresAt = Date.now() + Number(args[1]) * (name === "EXPIRE" ? 1000 : 1);
      return integer(1);
    }
    case "TTL":
    case "PTTL": {
      const found = entry(args[0]);
      if (!found) return integer(-2);
      if (found.expiresAt === undefined) return integer(-1);
      const ms = found.expiresAt - Date.now();
      return integer(name === "TTL" ? Math.ceil(ms / 1000) : ms);
    }
    case "KEYS": {
      const pattern = globToRegExp(args[0]);
      return array([...store.keys()].filter((key) => entry(key) && pattern.test(key)).map(bulk));
    }
    case "HSET": {
      const fields = hash(args[0], true);
      let added = 0;
      for (let i = 1; i + 1 < args.length; i += 2) {
        if (!fields.has(args[i])) added++;
        fields.set(args[i], args[i + 1]);
      }
      return integer(added);
    }
    case "HGET":
      return bulk(hash(args[0])?.get(args[1]) ?? null);
    case "HGETALL":
      return array([...(hash(args[0]) || new Map())].flat().map(bulk));
    case "HDEL": {
      const fields = hash(args[0]);
      return integer(args.slice(1).filter((field) => fields?.delete(field)).length);
    }
    case "PUBLISH":
      return integer(publish(args[0], args[1]));
    case "SUBSCRIBE":
      return subscribe(socket, subscribers, "subscribe", args);
    case "PSUBSCRIBE":
      return subscribe(socket, patternSubscribers, "psubscribe", args);
    case "UNSUBSCRIBE":
      return unsubscribe(socket, subscribers, "unsubscribe", args);
    case "PUNSUBSCRIBE":
      return unsubscribe(socket, patternSubscribers, "punsubscribe", args);
    default:
      console.error(`[mock-redis] unhandled command ${name} (add it to mock-redis/server.mjs)`);
      return error(`ERR unknown command '${rawName}' (mock-redis doesn't implement it)`);
  }
};

// Parses as many complete commands (RESP arrays or inline commands) as the buffer holds; returns [commands, rest].
const parse = (buffer) => {
  const commands = [];
  let offset = 0;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0x2a /* '*' */) {
      // Inline command (e.g. redis-cli "PING").
      const end = buffer.indexOf("\r\n", offset);
      if (end === -1) break;
      commands.push(buffer.subarray(offset, end).toString().trim().split(/\s+/));
      offset = end + 2;
      continue;
    }
    const lineEnd = buffer.indexOf("\r\n", offset);
    if (lineEnd === -1) break;
    const count = Number(buffer.subarray(offset + 1, lineEnd).toString());
    let cursor = lineEnd + 2;
    const args = [];
    let complete = true;
    for (let i = 0; i < count; i++) {
      const lenEnd = buffer.indexOf("\r\n", cursor);
      if (lenEnd === -1) {
        complete = false;
        break;
      }
      const len = Number(buffer.subarray(cursor + 1, lenEnd).toString());
      const start = lenEnd + 2;
      if (buffer.length < start + len + 2) {
        complete = false;
        break;
      }
      args.push(buffer.subarray(start, start + len).toString());
      cursor = start + len + 2;
    }
    if (!complete) break;
    commands.push(args);
    offset = cursor;
  }
  return [commands, buffer.subarray(offset)];
};

const server = net.createServer((socket) => {
  let pending = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    const [commands, rest] = parse(pending);
    pending = rest;
    for (const command of commands) {
      let reply;
      try {
        reply = handle(socket, command);
      } catch (thrown) {
        reply = typeof thrown === "string" ? thrown : error(`ERR ${thrown}`);
      }
      if (reply) socket.write(reply);
    }
  });
  const forget = () => {
    for (const sockets of [...subscribers.values(), ...patternSubscribers.values()]) sockets.delete(socket);
  };
  socket.on("close", forget);
  socket.on("error", forget);
});

server.listen(PORT, () => console.log(`[mock-redis] listening on redis://localhost:${PORT}`));
