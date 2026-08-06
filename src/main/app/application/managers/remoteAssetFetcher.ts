import {
    REMOTE_ASSET_ALLOWED_PROTOCOLS,
    REMOTE_ASSET_FETCH_TIMEOUT_MS,
    REMOTE_ASSET_MAX_BYTES,
} from "@shared/constants/remoteAsset";
import type { RemoteAssetFetchResult, RemoteAssetValidators } from "@shared/types/remoteAsset";
import { applyDownloadRewrite } from "./downloadRewrites";

/**
 * The main process's fetch for remote assets.
 *
 * It lives here and not in the renderer because Studio's renderers do not talk to the network. That
 * is a security boundary (a URL in a project file must not become a request the renderer makes on
 * the author's behalf) and a capability one: the ceiling, the timeout and the author's download
 * rewrites all live in main, and none of them can be enforced from a renderer.
 *
 * Unlike the plugin store - where the renderer names an id and main looks the address up in an index
 * it trusts - the URL here comes from the renderer, because the author typed it into a dialog a
 * moment ago. What the boundary buys is still real: the request is made, bounded and checked by
 * main, and the bytes are handed back rather than the address.
 */

/** Reject anything that is not an absolute http(s) URL, before a request is attempted. */
export function parseRemoteAssetUrl(url: string): URL {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error(`Not a valid URL: ${url}`);
    }
    if (!REMOTE_ASSET_ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
        throw new Error(`A remote asset must be an http or https URL, not "${parsed.protocol}"`);
    }
    return parsed;
}

/**
 * Fetch a remote asset, or learn that the caller's snapshot is still current.
 *
 * `validators` carries what the server said last time. When they are present the request is
 * conditional, so a Refresh of an unchanged asset costs one round trip and no bytes - which is the
 * entire reason the record stores them.
 */
export async function fetchRemoteAsset(
    url: string,
    validators?: RemoteAssetValidators,
): Promise<RemoteAssetFetchResult> {
    parseRemoteAssetUrl(url);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REMOTE_ASSET_FETCH_TIMEOUT_MS);
    let response: Response;
    try {
        response = await fetch(applyDownloadRewrite(url), {
            redirect: "follow",
            signal: controller.signal,
            headers: conditionalHeaders(validators),
        });
    } catch (error) {
        // An abort is the timeout, and "aborted" tells the author nothing about what to do.
        if (controller.signal.aborted) {
            throw new Error(`The server did not answer within ${REMOTE_ASSET_FETCH_TIMEOUT_MS / 1000}s`);
        }
        throw new Error(error instanceof Error ? error.message : "Network error");
    } finally {
        clearTimeout(timer);
    }

    if (response.status === 304) {
        return { kind: "not-modified" };
    }
    if (!response.ok) {
        throw new Error(`Request failed (${response.status} ${response.statusText})`);
    }

    // Checked twice: the declared length lets an oversized body be refused before it is read, and
    // the measured length is what actually arrived - a server may under-declare, or not declare.
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > REMOTE_ASSET_MAX_BYTES) {
        throw new Error(sizeRefusal(declared));
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > REMOTE_ASSET_MAX_BYTES) {
        throw new Error(sizeRefusal(bytes.byteLength));
    }

    return {
        kind: "ok",
        bytes,
        etag: response.headers.get("etag") ?? undefined,
        lastModified: response.headers.get("last-modified") ?? undefined,
        // Recorded for diagnostics only. What the asset *is* gets decided by the format validator
        // reading the bytes, because a Content-Type is a claim and magic bytes are evidence.
        contentType: response.headers.get("content-type") ?? undefined,
    };
}

function conditionalHeaders(validators?: RemoteAssetValidators): Record<string, string> {
    const headers: Record<string, string> = {};
    if (validators?.etag) {
        headers["if-none-match"] = validators.etag;
    }
    if (validators?.lastModified) {
        headers["if-modified-since"] = validators.lastModified;
    }
    return headers;
}

function sizeRefusal(bytes: number): string {
    const megabytes = Math.round(bytes / (1024 * 1024));
    const ceiling = Math.round(REMOTE_ASSET_MAX_BYTES / (1024 * 1024));
    return `The file is ${megabytes} MB, over the ${ceiling} MB limit for a remote asset`;
}
