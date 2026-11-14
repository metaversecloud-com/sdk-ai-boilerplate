// Shared by every SDK app: keep this file identical across repos.
import type { APIRequestContext } from "@playwright/test";
import type { RouteSpec } from "../../app.config";

/**
 * Calls a CREDENTIALED_ROUTES entry, with the session credentials (if any) where the route reads them:
 * the query string, or merged into the JSON body for credentialsIn: "body".
 */
export const callRoute = (request: APIRequestContext, route: RouteSpec, credentials?: URLSearchParams) => {
  const inBody = route.credentialsIn === "body";
  const query = credentials && !inBody ? `?${credentials}` : "";
  const data = credentials && inBody ? { ...route.data, ...Object.fromEntries(credentials) } : route.data;
  return request[route.method](`${route.basePath ?? "/api"}${route.path}${query}`, { data });
};
