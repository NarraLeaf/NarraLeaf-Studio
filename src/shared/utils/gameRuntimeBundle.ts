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
/**
 * The interface code a protected build keeps inside the store rather than beside
 * it.
 *
 * The three are exactly what a browser fetches through the runtime protocol and
 * nothing else: the document and the two bundles it pulls. `main.js`, the
 * preload and the codec's own loaders cannot join them - Electron opens those
 * itself, before anything of ours exists to answer for them - and that is a
 * ceiling rather than an oversight.
 *
 * Named once, here, because the compile decides what to put in and the runtime
 * decides what it will serve out, and the two disagreeing means either a file
 * nobody can fetch or a store entry anybody can.
 */
export const SEALED_SHELL_FILES = ["index.html", "renderer.js", "renderer.css"] as const;

/** Whether this request names one of them. */
export function isSealedShellFile(name: string): boolean {
    return (SEALED_SHELL_FILES as readonly string[]).includes(name);
}

/**
 * Entry prefixes under which a build keeps the code its page loads by URL: bundled plugin entries,
 * puppet backends and the author's compiled script blueprints.
 *
 * These, with the shell files above, are the whole of what `<scheme>://runtime/` answers - from
 * the store on a sealed build, from the app directory otherwise. Everything else in that directory
 * (the store and its companion file, the codec, the loaders Electron opens itself, a loose build's
 * pack) is not a page resource, and a page has no reason to be able to fetch it.
 */
export const RUNTIME_HOST_FILE_PREFIXES = ["plugins/", "puppet/", "scripts/"] as const;

export function gameRuntimeBundleRuntimeEntry(pathname: string): string {
    return pathname.replace(/\\/g, "/").replace(/^\/+/, "");
}

/**
 * Entry holding what one patch changes about the pack, rather than a pack of its own.
 *
 * Read in preference to {@link GAME_RUNTIME_BUNDLE_PACK_ENTRY} when a layer carries both, so several
 * patches on one build compose instead of the last one replacing the rest. A patch carries the full
 * pack as well, because a build made before this entry existed knows only that name and would
 * otherwise install a patch that changed nothing about the story.
 */
export const GAME_RUNTIME_BUNDLE_PACK_DELTA_ENTRY = "pack.delta";
