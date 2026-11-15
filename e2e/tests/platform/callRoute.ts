// Shared by every SDK app: keep this file identical across repos.
import type { APIRequestContext } from "@playwright/test";
import type { RouteSpec } from "../../app.config";

/**
 * Calls a CREDENTIALED_ROUTES entry, with the session credentials (if any) where the route reads them:
 * the query string, or merged into the JSON body for credentialsIn: "body". `origin` (e.g. a private
 * instance's "http://localhost:<port>") replaces the shared server.
 */
export const callRoute = (request: APIRequestContext, route: RouteSpec, credentials?: URLSearchParams, origin = "") => {
  const inBody = route.credentialsIn === "body";
  const query = credentials && !inBody ? `?${credentials}` : "";
  const data = credentials && inBody ? { ...route.data, ...Object.fromEntries(credentials) } : route.data;
  return request[route.method](`${origin}${route.basePath ?? "/api"}${route.path}${query}`, { data });
};
