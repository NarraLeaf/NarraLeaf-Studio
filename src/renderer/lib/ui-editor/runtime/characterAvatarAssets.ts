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
 */

import { parseCharacterAvatarAssetId } from "@shared/utils/characterAvatar";

const urlByAssetId = new Map<string, string>();

/**
 * Replace the table with this compile's resolutions.
 *
 * Takes the compile's `avatarAssetIdByUrl` (url → asset id) and inverts it. Where two ids resolved
 * to one URL the last wins, which is harmless: they picture the same bytes.
 */
export function registerCharacterAvatarAssets(avatarAssetIdByUrl: ReadonlyMap<string, string>): void {
    urlByAssetId.clear();
    for (const [url, assetId] of avatarAssetIdByUrl) {
        urlByAssetId.set(assetId, url);
    }
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
}
