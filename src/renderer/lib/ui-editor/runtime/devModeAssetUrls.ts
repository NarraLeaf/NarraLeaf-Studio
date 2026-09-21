/**
 * The one URL a Dev Mode window has for an asset.
 *
 * A packaged game has this by construction: the shell publishes a bridge and `assetUrl(id)` answers
 * the same string every time, so warming a picture and drawing it are the same fetch. Dev Mode had
 * no such thing - every consumer asked the main process for a grant of its own, so the same file
 * arrived under a different `app://fs/{token}` for the preload, for the `<img>`, and again for the
 * next mount of that widget. Three URLs are three fetches, and nothing warmed in advance could ever
 * be the thing the interface then drew.
 *
 * So the window publishes its map once - it already builds one, to keep a story compile from asking
 * asset by asset - and everything that needs a URL reads it from here. An id the map has never heard
 * of still resolves one at a time, which is how all of this worked before.
 *
 * The grants are session-lived and bound to this window (see `devModeAction.ts`), which is what
 * makes one URL reusable rather than single-shot.
 */

let urls: ReadonlyMap<string, string> = new Map();
let types: ReadonlyMap<string, string> = new Map();

/**
 * Replace the window's map. Called when the prewarm pass settles, and again when assets move.
 *
 * `nextTypes` is what kind of asset each id is, in the library's own `AssetType` words - what lets
 * the window warm its first screen before drawing it, since a picture is warmed by decoding it and a
 * typeface by registering it and a URL alone does not say which.
 */
export function publishDevModeAssetUrls(
    next: ReadonlyMap<string, string>,
    nextTypes: ReadonlyMap<string, string> = new Map(),
): void {
    urls = next;
    types = nextTypes;
}

export function resolveDevModeAssetUrl(assetId: string | null | undefined): string | null {
    if (!assetId) {
        return null;
    }
    return urls.get(assetId) ?? null;
}

/** The library's word for what this asset is, or null when the window was not told. */
export function resolveDevModeAssetType(assetId: string | null | undefined): string | null {
    if (!assetId) {
        return null;
    }
    return types.get(assetId) ?? null;
}

/** Every id the window holds a URL for - the Dev Mode stand-in for a pack's manifest. */
export function publishedDevModeAssetIds(): Set<string> {
    return new Set(urls.keys());
}

/** What the window is holding, for a caller that wants to warm all of it. */
export function devModeAssetUrlCount(): number {
    return urls.size;
}

export function clearDevModeAssetUrls(): void {
    urls = new Map();
    types = new Map();
}
