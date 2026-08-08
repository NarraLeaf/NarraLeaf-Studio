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
 * ## Why it checks `allowHttp` itself
 *
 * The main process sits *outside* the CSP and `webRequest` cage that confines the renderer (see
 * `runtime/main/networkPolicy.ts`), so that cage cannot be what enforces the project's setting here.
 * Without the check below, routing the request through main would hand a project that switched the
 * network off a working network - the opposite of what the setting says.
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
import { BLUEPRINT_NETWORK_METHODS_WITH_BODY } from "@shared/types/blueprint/graph";

export type BlueprintNetworkFetchOptions = {
    /** The project's Allow HTTP setting. False refuses every request before it is made. */
    allowHttp: boolean;
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

    const timeoutMs = normalizeBlueprintNetworkTimeout(request.timeoutMs);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);

    try {
        const response = await fetch(url, {
            method: request.method,
            headers: request.headers ?? undefined,
            body: BLUEPRINT_NETWORK_METHODS_WITH_BODY.includes(request.method) ? request.body ?? undefined : undefined,
            signal: controller.signal,
            // The game holds no session with anyone; sending ambient cookies would be a surprise the
            // author never asked for.
            credentials: "omit",
            redirect: "follow",
        });

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
    } catch (error) {
        if (timedOut) {
            return { outcome: "timeout", status: 0, body: null, error: `Timed out after ${timeoutMs}ms` };
        }
        return networkError(error instanceof Error ? error.message : String(error));
    } finally {
        clearTimeout(timer);
    }
}
