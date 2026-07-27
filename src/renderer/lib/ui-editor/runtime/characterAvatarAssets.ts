/**
 * Synchronous asset id → URL table for dialog avatars, registered when a compiled story mounts.
 *
 * Why this exists: an avatar swaps on the same frame the speaker changes, and the three hosts
 * resolve an asset id three different ways. A packaged game answers synchronously off the runtime
 * bridge; the workspace reads bytes and mints a blob URL; **Dev Mode makes two IPC hops** (dev-mode
 * window → main → workspace window) and takes a single-use `app://fs/{hash}` grant. That last one
 * is a visible flash on every first swap.
 *
 * The compile already resolved every URL an avatar can possibly have — it must, because the
 * engine's avatar resolver runs inside a render and cannot await. Handing that table here turns the
 * widget's lookup into a map read on all three hosts, and it is the only lookup that answers for
 * baked avatars at all: those are derived project files behind a synthetic id, not library assets.
 *
 * Lifetime is the mounted session's. A recompile re-registers, and mounting a story with no
 * characters clears the table rather than leaving the previous story's avatars resolvable.
 *
 * ## Why the engine's preloader cannot do this for us
 *
 * `Scene.preloadImage` does warm a cache, but not one anything on the avatar path can read.
 * `ImageCacheManager.preload` fetches the URL, re-encodes it as a **base64 data URL**, and decodes
 * *that*; the retained decoded bitmap therefore belongs to the data URL, and the only way to reach
 * either is `cacheManager.get(url)`. The engine's own `<Image>` does exactly that
 * (`cacheManager.get(src) || src`) — but its `<Avatar>` does not: it renders `avatar.src` raw. Nor
 * does a Studio Image widget, which renders whatever URL this table hands back.
 *
 * So registering avatars with the scene preloader would pay a fetch, a ~33% base64 blowup, a decode
 * and a retained full-resolution bitmap **per avatar**, and every consumer would still miss all of
 * it and decode again on the frame the speaker changes. Avatars are deliberately not registered
 * there. What they get instead is {@link warmAvatarDecode}: the same technique the engine uses
 * internally, keyed to the exact URL the widget will render.
 */

import { parseCharacterAvatarAssetId } from "@shared/utils/characterAvatar";

const urlByAssetId = new Map<string, string>();

/**
 * Decoded avatars held on purpose.
 *
 * A decoded bitmap survives in the browser's cache only while something still references it, so
 * dropping the element right after `decode()` lets it be evicted and the first reveal decodes all
 * over again. Holding the element is the retention — the same reason `ImageCacheManager` keeps its
 * `decoded` map. Bounded by the number of avatar entries, which is bounded by the number of
 * differentials an author actually gave an avatar to.
 */
const decoded = new Map<string, HTMLImageElement>();

/**
 * Fetch and decode every registered avatar off-screen, so attaching one to a visible `<img>` later
 * paints without an asynchronous decode.
 *
 * Fire-and-forget by design: nothing on the path to the first frame needs an avatar (the first
 * dialog line is several beats away), and blocking a session mount on it would trade a flash for a
 * stall. Failures are ignored — that avatar then simply decodes on first paint, which is the
 * behaviour we would have had anyway.
 *
 * Returns a promise so tests can await the warm; production callers do not.
 */
function warmAvatarDecode(urls: Iterable<string>): Promise<void> {
    if (typeof window === "undefined" || typeof window.Image === "undefined") {
        return Promise.resolve();
    }
    const pending: Promise<void>[] = [];
    for (const url of urls) {
        if (decoded.has(url)) {
            continue;
        }
        const image = new window.Image();
        image.src = url;
        if (typeof image.decode !== "function") {
            continue;
        }
        pending.push(image.decode().then(
            () => {
                // Re-check: a recompile between the request and its settling has already cleared
                // the table, and retaining here would resurrect the previous story's bitmap.
                if (urlByAssetId.size > 0) {
                    decoded.set(url, image);
                }
            },
            () => undefined,
        ));
    }
    return Promise.all(pending).then(() => undefined);
}

/**
 * Replace the table with this compile's resolutions.
 *
 * Takes the compile's `avatarAssetIdByUrl` (url → asset id) and inverts it. Where two ids resolved
 * to one URL the last wins, which is harmless: they picture the same bytes.
 */
export function registerCharacterAvatarAssets(avatarAssetIdByUrl: ReadonlyMap<string, string>): Promise<void> {
    urlByAssetId.clear();
    decoded.clear();
    for (const [url, assetId] of avatarAssetIdByUrl) {
        urlByAssetId.set(assetId, url);
    }
    return warmAvatarDecode(avatarAssetIdByUrl.keys());
}

export function resolveCharacterAvatarAssetUrl(assetId: string | null | undefined): string | null {
    if (!assetId) {
        return null;
    }
    return urlByAssetId.get(assetId) ?? null;
}

/**
 * True for a synthetic baked-avatar id, whether or not it is currently registered.
 *
 * Callers use this to stop *before* the ordinary asset lookup: a `character-avatar:` id has no
 * record in the asset library, so letting it fall through would spend an IPC round trip to be told
 * "not found" and then report a missing asset for something that is merely not mounted.
 */
export function isCharacterAvatarAssetId(assetId: string | null | undefined): boolean {
    return Boolean(assetId && parseCharacterAvatarAssetId(assetId) !== null);
}

export function clearCharacterAvatarAssets(): void {
    urlByAssetId.clear();
    decoded.clear();
}

/** Whether this URL's decoded bitmap is being held, i.e. attaching it can paint without a decode. */
export function isCharacterAvatarDecoded(url: string): boolean {
    return decoded.has(url);
}
