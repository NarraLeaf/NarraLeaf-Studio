/**
 * The Fetch node's request, as executed by a main process.
 *
 * Shared by Studio's main process (Dev Mode) and the packaged game's main process, which is the
 * point: a node that behaves one way in Dev Mode and another in the shipped game is worse than a
 * node that does not exist. The web export cannot use this - it has no main process - and satisfies
 * the same contract with a browser `fetch` in `src/runtime/web`.
 *
 * ## Why this runs in the main process at all
 *
 * Two reasons, the first decisive:
 *
 *  - **CORS.** The game renderer's origin is the app protocol (`nlgame:`/`app:`), so a cross-origin
 *    request to a third-party API fails unless that server opts in with CORS headers, and most do
 *    not. A main-process request has no origin and is not subject to it.
 *  - The timeout, the size cap and the scheme check are only enforceable somewhere the page cannot
 *    reach around.
 *
 * ## Why it checks the project's settings itself
 *
 * The main process sits *outside* the CSP and `webRequest` cage that confines the renderer (see
 * `runtime/main/networkPolicy.ts`), so that cage cannot be what enforces the project's settings
 * here. Without the checks below, routing the request through main would hand a project that
 * switched the network off a working network, and one that narrowed it to an allowlist the whole
 * internet - the opposite of what both settings say.
 *
 * ## Redirects
 *
 * A check made once, before the request, is not a check on where the bytes came from: a `302` is a
 * request to a second address that nothing decided. So this follows the chain itself and decides
 * every hop, in the shells that can - see the `redirects` option for the one that cannot and what
 * stands in for it there.
 *
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NETWORK_MAX_RESPONSE_BYTES,
    isBlueprintNetworkUrlAllowed,
    normalizeBlueprintNetworkTimeout,
    type BlueprintNetworkFetchRequest,
    type BlueprintNetworkFetchResult,
} from "@shared/types/blueprint/network";
import { BLUEPRINT_NETWORK_METHODS_WITH_BODY, type BlueprintNetworkMethod } from "@shared/types/blueprint/graph";
import {
    isNetworkAddressAllowed,
    networkAllowlistRefusalMessage,
    type NetworkAllowlist,
} from "@shared/types/networkAllowlist";

export type BlueprintNetworkFetchOptions = {
    /** The project's Allow HTTP setting. False refuses every request before it is made. */
    allowHttp: boolean;
    /**
     * The project's network allowlist, if it states one. Absent is the wide policy, which is what
     * every project has until a team asks for a shorter answer - see `@shared/types/networkAllowlist`.
     */
    allowlist?: NetworkAllowlist;
    /**
     * Who polices a redirect, which is not the same question in every shell and must not be
     * answered by a default.
     *
     * `"check"` - this process follows the chain itself and decides every hop, which is what a main
     * process can do and therefore must. Without it the allowlist governs only the address the
     * author wrote, and one `302` walks straight past it.
     *
     * `"delegate"` - the platform follows the chain and something else decides each hop. That is
     * the web export: a browser answers a manually-followed redirect with an opaque response whose
     * `Location` cannot be read, so checking hops here is not merely awkward but impossible, and
     * the thing that does check them is the page's own `connect-src` - which the browser applies to
     * every hop.
     */
    redirects: "check" | "delegate";
};

function networkError(message: string): BlueprintNetworkFetchResult {
    return { outcome: "networkError", status: 0, body: null, error: message };
}

/**
 * The charset to decode the body with.
 *
 * UTF-8 unless the response names something else, which is what every JSON API and nearly every
 * text endpoint serves. An unknown label falls back rather than throwing: a body decoded slightly
 * wrong is still worth handing to the author, and `TextDecoder` rejects labels it does not know.
 */
function decoderFor(contentType: string | null): TextDecoder {
    const charset = /charset=([^;]+)/i.exec(contentType ?? "")?.[1]?.trim().replace(/^["']|["']$/g, "");
    if (!charset) {
        return new TextDecoder();
    }
    try {
        return new TextDecoder(charset);
    } catch {
        return new TextDecoder();
    }
}

/**
 * Read the body, refusing at the cap instead of buffering past it.
 *
 * Streamed rather than `response.arrayBuffer()` so a server that sends far more than the cap costs
 * the cap and not the whole transfer. `content-length` is checked first when present, which turns
 * the common case into a refusal before a single chunk arrives - but it is only a hint, so the
 * running total below is what actually enforces it.
 */
async function readCappedBody(response: Response): Promise<{ bytes: Uint8Array } | { error: string }> {
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > BLUEPRINT_NETWORK_MAX_RESPONSE_BYTES) {
        return { error: `Response is larger than the ${BLUEPRINT_NETWORK_MAX_RESPONSE_BYTES} byte limit` };
    }
    if (!response.body) {
        return { bytes: new Uint8Array(0) };
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            if (!value) {
                continue;
            }
            total += value.byteLength;
            if (total > BLUEPRINT_NETWORK_MAX_RESPONSE_BYTES) {
                await reader.cancel();
                return { error: `Response is larger than the ${BLUEPRINT_NETWORK_MAX_RESPONSE_BYTES} byte limit` };
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return { bytes };
}

/**
 * How many hops a redirect chain may take before this gives up.
 *
 * Lower than a browser's twenty because a Fetch node is a game waiting on an answer, and a chain
 * this long is a misconfigured endpoint rather than a route worth following. Exhausting it is a
 * `networkError` and says so - a silent stop would hand the graph the redirect itself as if it were
 * the response.
 */
const BLUEPRINT_NETWORK_MAX_REDIRECTS = 5;

const REDIRECT_STATUSES: readonly number[] = [301, 302, 303, 307, 308];

/**
 * What the next hop is issued as.
 *
 * The rule browsers follow, written out because this code is the one following it: 303 always
 * becomes a GET, 301 and 302 turn a POST into one (universal practice, contradicting the original
 * text of the specification), and 307/308 exist precisely to preserve the method and the body.
 */
function methodAfterRedirect(
    status: number,
    method: BlueprintNetworkMethod,
): { method: BlueprintNetworkMethod; keepBody: boolean } {
    if (status === 303 || ((status === 301 || status === 302) && method === "POST")) {
        return { method: "GET", keepBody: false };
    }
    return { method, keepBody: true };
}

/**
 * Execute one Fetch node request.
 *
 * Never throws: every failure is one of the four outcomes, because the node's four execution pins
 * are the author's only way to react and an exception would leave the graph with nowhere to go.
 */
export async function executeBlueprintNetworkFetch(
    request: BlueprintNetworkFetchRequest,
    options: BlueprintNetworkFetchOptions,
): Promise<BlueprintNetworkFetchResult> {
    if (!options.allowHttp) {
        // Reached only in Dev Mode: the build gate refuses to package a project that has a network
        // node while this setting is off, so a shipped game cannot get here.
        return networkError("The project does not allow HTTP. Turn on Allow HTTP in project settings.");
    }
    const url = request.url.trim();
    if (!url) {
        return networkError("No URL");
    }
    if (!isBlueprintNetworkUrlAllowed(url)) {
        return networkError(`Only http and https addresses can be fetched: ${url}`);
    }
    if (!isNetworkAddressAllowed(url, options.allowlist)) {
        return networkError(networkAllowlistRefusalMessage(url));
    }

    const timeoutMs = normalizeBlueprintNetworkTimeout(request.timeoutMs);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);

    try {
        let target = url;
        let method = request.method;
        let sendBody = BLUEPRINT_NETWORK_METHODS_WITH_BODY.includes(request.method);

        for (let hop = 0; ; hop++) {
            const response = await fetch(target, {
                method,
                headers: request.headers ?? undefined,
                body: sendBody ? request.body ?? undefined : undefined,
                signal: controller.signal,
                // The game holds no session with anyone; sending ambient cookies would be a surprise
                // the author never asked for.
                credentials: "omit",
                // `manual` is what makes the check above hold for every hop rather than only for the
                // address the author wrote: a 302 to somewhere else is a request to somewhere else,
                // and `follow` would make it one nothing ever decided. `delegate` is for the shell
                // that cannot do this - see the note on the option.
                redirect: options.redirects === "check" ? "manual" : "follow",
            });

            if (options.redirects !== "check" || !REDIRECT_STATUSES.includes(response.status)) {
                const read = await readCappedBody(response);
                if ("error" in read) {
                    return { outcome: "networkError", status: response.status, body: null, error: read.error };
                }
                const body = decoderFor(response.headers.get("content-type")).decode(read.bytes);
                return {
                    outcome: response.ok ? "success" : "httpError",
                    status: response.status,
                    body,
                    error: response.ok ? null : `HTTP ${response.status} ${response.statusText}`.trim(),
                };
            }

            const location = response.headers.get("location");
            if (!location) {
                // A redirect status with nowhere to go. Reported rather than returned as the
                // response, because a graph handed a bodyless 302 would read it as an HTTP error it
                // could do something about.
                return networkError(`HTTP ${response.status} with no Location header: ${target}`);
            }
            if (hop >= BLUEPRINT_NETWORK_MAX_REDIRECTS) {
                return networkError(`Too many redirects (over ${BLUEPRINT_NETWORK_MAX_REDIRECTS}): ${url}`);
            }

            let next: string;
            try {
                // Resolved against the hop it came from, because a Location may be relative.
                next = new URL(location, target).href;
            } catch {
                return networkError(`Redirect to an address that does not parse: ${location}`);
            }
            if (!isBlueprintNetworkUrlAllowed(next)) {
                return networkError(`Redirect to a scheme that cannot be fetched: ${next}`);
            }
            if (!isNetworkAddressAllowed(next, options.allowlist)) {
                return networkError(networkAllowlistRefusalMessage(next));
            }

            const after = methodAfterRedirect(response.status, method);
            method = after.method;
            sendBody = sendBody && after.keepBody;
            target = next;
        }
    } catch (error) {
        if (timedOut) {
            return { outcome: "timeout", status: 0, body: null, error: `Timed out after ${timeoutMs}ms` };
        }
        return networkError(error instanceof Error ? error.message : String(error));
    } finally {
        clearTimeout(timer);
    }
}
