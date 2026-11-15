// Shared by every SDK app: keep this file identical across repos.
import type { APIRequestContext } from "@playwright/test";
import type { RouteSpec } from "../../app.config";

/**
 * Calls a CREDENTIALED_ROUTES entry, with the session credentials (if any) where the route reads them:
 * the query string, merged into the JSON body for credentialsIn: "body", or under body[credentialsKey].
 * The route's own `query` parameters are always sent. `origin` (e.g. a private instance's
 * "http://localhost:<port>") replaces the shared server.
 */
export const callRoute = (request: APIRequestContext, route: RouteSpec, credentials?: URLSearchParams, origin = "") => {
  const inBody = route.credentialsIn === "body" || !!route.credentialsKey;
  const params = new URLSearchParams(route.query ?? {});
  if (credentials && !inBody) for (const [key, value] of credentials) params.set(key, value);
  const query = `${params}` ? `?${params}` : "";
  const fields = credentials && inBody ? Object.fromEntries(credentials) : undefined;
  const data = !fields
    ? route.data
    : route.credentialsKey
      ? { ...route.data, [route.credentialsKey]: fields }
      : { ...route.data, ...fields };
  return request[route.method](`${origin}${route.basePath ?? "/api"}${route.path}${query}`, { data });
};
