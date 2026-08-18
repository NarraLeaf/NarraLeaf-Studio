/**
 * The Fetch node's wire contract, shared by every shell that implements it.
 *
 * Three implementations satisfy this: the packaged desktop game (renderer -> `runtime:network:fetch`
 * -> main), Studio's Dev Mode (renderer -> `blueprintNetwork.fetch` -> Studio's main process), and
 * the web export (browser `fetch`, no main process to reach). Keeping the request and the result in
 * `shared` is what stops the three from drifting into three slightly different nodes.
 *
 * Comments in English per project convention.
 */

import type { BlueprintNetworkMethod } from "./graph";

/**
 * Largest response the host will hand back, in bytes.
 *
 * Refused rather than truncated: half a JSON document fails to parse with an error about syntax,
 * which sends the author looking at the server instead of at the size of what they asked for.
 */
export const BLUEPRINT_NETWORK_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/** Applied when the `timeout` pin is unset. A game is waiting on this, so it is short. */
export const BLUEPRINT_NETWORK_DEFAULT_TIMEOUT_MS = 10_000;

/** Ceiling on the `timeout` pin. Beyond this the game has stopped responding, not the server. */
export const BLUEPRINT_NETWORK_MAX_TIMEOUT_MS = 60_000;

/**
 * Live response bodies one execution may hold at once.
 *
 * Bodies are released together when the execution ends (see {@link BlueprintResponseBody}), which
 * bounds their lifetime but not their number - a loop that fetches a thousand times would hold all
 * thousand. Reaching this cap is a `networkError`, not a silent eviction: dropping the oldest body
 * would make a handle the author still holds fail later, somewhere else.
 */
export const BLUEPRINT_NETWORK_MAX_LIVE_BODIES = 32;

/** Schemes a Fetch node may address. Everything else is refused before a request is made. */
export const BLUEPRINT_NETWORK_ALLOWED_PROTOCOLS: readonly string[] = ["http:", "https:"];

export type BlueprintNetworkFetchRequest = {
  url: string;
  method: BlueprintNetworkMethod;
  /** Header name -> value. Null and `{}` both mean "send none". */
  headers: Record<string, string> | null;
  /** Request body, for the methods that carry one. */
  body: string | null;
  timeoutMs: number;
};

/**
 * Which execution pin the Fetch node leaves by.
 *
 * `networkError` is the catch-all for "no HTTP response happened": DNS failure, connection refused,
 * a body over the cap, a scheme that is not http(s), and a project whose Allow HTTP setting is off.
 * They are one outcome because an author's response to all of them is the same - there is no data,
 * show the player something else - and `error` carries which it was.
 */
export type BlueprintNetworkFetchOutcome = "success" | "httpError" | "networkError" | "timeout";

export type BlueprintNetworkFetchResult = {
  outcome: BlueprintNetworkFetchOutcome;
  /** HTTP status, or 0 when no response was received. */
  status: number;
  /** Response body text, present whenever a response arrived. */
  body: string | null;
  /** Human-readable failure reason, null on success. */
  error: string | null;
};

/** Cap, clamp and default the authored timeout in one place, so all three shells agree. */
export function normalizeBlueprintNetworkTimeout(timeoutMs: number | null | undefined): number {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return BLUEPRINT_NETWORK_DEFAULT_TIMEOUT_MS;
  }
  return Math.min(Math.round(timeoutMs), BLUEPRINT_NETWORK_MAX_TIMEOUT_MS);
}

/**
 * Whether the URL is one a Fetch node may address.
 *
 * The scheme check is the security-bearing half: without it this node reads local files through
 * `file:`, and reaches the game's own asset protocol through `nlgame:`/`app:`. A URL that does not
 * parse at all is refused here too, so no shell has to decide what a malformed URL means.
 */
export function isBlueprintNetworkUrlAllowed(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return BLUEPRINT_NETWORK_ALLOWED_PROTOCOLS.includes(parsed.protocol);
}

/**
 * Coerce an authored `headers` value into what the request takes.
 *
 * Authors build this with `Make JSON Object`, whose values are whatever was wired into it, so a
 * number or a boolean reaching a header is expected rather than a mistake and is stringified.
 * Nested objects and arrays are dropped: there is no header they could correctly become.
 */
export function normalizeBlueprintNetworkHeaders(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const headers: Record<string, string> = {};
  for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
    const key = name.trim();
    if (!key) {
      continue;
    }
    if (typeof raw === "string") {
      headers[key] = raw;
    } else if (typeof raw === "number" && Number.isFinite(raw)) {
      headers[key] = String(raw);
    } else if (typeof raw === "boolean") {
      headers[key] = String(raw);
    }
  }
  return Object.keys(headers).length > 0 ? headers : null;
}
