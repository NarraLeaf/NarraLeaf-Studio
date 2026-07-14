/**
 * Naming scheme for entries inside the consolidated runtime store that the
 * compiler writes (and the runtime reads) when asset protection is enabled.
 *
 * The store keeps the whole game payload as one file; individual items are
 * addressed by these stable names. Asset entries are keyed by their storage id
 * alone — never by their original filename or extension — so an item's media
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
 * Normalize a runtime request path (or a compiler-side relative path) to the
 * canonical entry name used for runtime files that live in the store, such as
 * bundled plugin entries. Strips leading separators and forces forward slashes
 * so both sides derive the same key from the same logical path.
 */
export function gameRuntimeBundleRuntimeEntry(pathname: string): string {
    return pathname.replace(/\\/g, "/").replace(/^\/+/, "");
}
