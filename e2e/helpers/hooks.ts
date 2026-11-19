// Shared by every SDK app: keep this file identical across repos.
// The fake outgoing webhooks in mock-topia (/hooks/*) and what the app sent to them.
import type { APIRequestContext } from "@playwright/test";
import { mockForApp } from "../appEnv";
import { MOCK_TOPIA_URL } from "../constants";
import type { TopiaWorld } from "../fixtures";

export type HookCall = {
  method: string;
  path: string;
  query: Record<string, string>;
  authorization?: string;
  contentType?: string;
  body: any;
};

/**
 * A webhook URL unique to this world, as the app reaches it (seed it into data objects, user group data
 * objects, ...). Put "fail-500" (any status) in the name to make it answer that status. The world's seeded
 * delays and failures apply too ("POST /hooks/<urlSlug>/<name>").
 */
export const hookUrl = (world: TopiaWorld, name: string) => `${mockForApp().url}/hooks/${world.urlSlug}/${name}`;

/** Every call the app made to the fake webhooks, from all tests. */
export const allHookCalls = async (request: APIRequestContext): Promise<HookCall[]> =>
  (await request.get(`${MOCK_TOPIA_URL}/__mock/hooks`)).json();

/** Calls to this world's webhooks (hookUrl), optionally only the one with this name. */
export const hookCalls = async (request: APIRequestContext, world: TopiaWorld, name?: string) =>
  (await allHookCalls(request)).filter((call) =>
    name ? call.path === `/hooks/${world.urlSlug}/${name}` : call.path.startsWith(`/hooks/${world.urlSlug}/`),
  );

/**
 * Calls to a shared hook that isn't per world (`${mock.url}/hooks/<channel>` set in APP_ENV, e.g. an errors
 * channel) whose body mentions `text` (e.g. the world's urlSlug), since every test posts to the same one.
 */
export const channelCalls = async (request: APIRequestContext, channel: string, text: string) =>
  (await allHookCalls(request)).filter(
    (call) => call.path === `/hooks/${channel}` && JSON.stringify(call.body).includes(text),
  );
