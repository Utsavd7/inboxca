import type { Instrumentation } from "next";
import { reportError } from "@/src/lib/error-report";

// The server refuses to start with a setting it cannot run without (src/lib/env.ts).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") (await import("@/src/lib/env")).checkEnv();
}

// Every server error (pages, route handlers, server actions, the proxy) goes to Sentry,
// scrubbed. Only the route's pattern is sent, never the visited path with its values.
export const onRequestError: Instrumentation.onRequestError = (error, request, context) =>
  reportError(error, {
    route: context.routePath,
    route_type: context.routeType,
    method: request.method,
  });
