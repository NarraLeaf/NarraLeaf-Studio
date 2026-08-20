/**
 * Naming scheme for entries inside the consolidated runtime store that the
 * compiler writes (and the runtime reads) when asset protection is enabled.
 *
 * The store keeps the whole game payload as one file; individual items are
 * addressed by these stable names. Asset entries are keyed by their storage id
 * alone - never by their original filename or extension - so an item's media
 * type is not recoverable from the entry name. The compiler and runtime are the
 * only two callers and must agree, so the scheme lives here in one place.
 */

/** Entry holding the serialized pack descriptor (the former loose pack.json). */
export const GAME_RUNTIME_BUNDLE_PACK_ENTRY = "pack";

/** Entry name for a project asset, keyed by storage id with no extension. */
export function gameRuntimeBundleAssetEntry(assetId: string): string {
    return `assets/${assetId}`;
}

/**
 * Key of the item that records where a model bundle's entry file sits inside it.
 *
 * The trailing slash is doing three jobs at once, which is why this is one key and not a namespace
 * of its own:
 *
 * - It cannot collide with a real bundle member. Those are keyed `{id}/{path}`, and a path always
 *   has a non-empty segment after the slash.
 * - It stays inside the `assets/` namespace, which is the namespace a protected store folds. A key
 *   under `meta/` or similar would be left in the clear and would hand back the very list of model
 *   ids this design is taking away.
 * - It is the request path verbatim. The renderer mounts a model from `.../asset/{id}/`, so the
 *   thing the runtime has to look up is the thing it was asked for, with no translation step to get
 *   wrong.
 */
export function gameRuntimeBundleModelEntry(assetId: string): string {
    return gameRuntimeBundleAssetEntry(`${assetId}/`);
}

/**
 * Normalize a runtime request path (or a compiler-side relative path) to the
 * canonical entry name used for runtime files that live in the store, such as
 * bundled plugin entries. Strips leading separators and forces forward slashes
 * so both sides derive the same key from the same logical path.
 */
export function gameRuntimeBundleRuntimeEntry(pathname: string): string {
    return pathname.replace(/\\/g, "/").replace(/^\/+/, "");
}
