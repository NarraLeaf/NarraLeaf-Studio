/**
 * What makes a Dev Mode window's asset URLs stale, and what does not.
 *
 * Before a story compiles, the Dev Mode window asks the workspace to resolve every asset in the
 * project to a URL in one pass. On a project with a thousand assets that pass is the single most
 * expensive step of a reload, and it used to run on every reload - so an author saving a line of
 * dialogue paid for the whole library, over and over, for a change that cannot touch a single URL.
 *
 * The URLs go stale for exactly one reason: a grant token is derived from the file's path, size and
 * modification time, so an asset the author replaced needs a new URL and the old one stops opening.
 * An asset that is merely NEW needs nothing, because an id the prewarmed map has never heard of is
 * resolved one at a time by the caller that wants it.
 *
 * Both halves of that rule live here so they cannot drift: the main process decides which watched
 * file counts as an asset, and the window decides which bundles may share one pass.
 */

import type { DevModeBundle } from "@shared/types/devMode";

/**
 * Whether a watched file lives under the project's asset directory.
 *
 * Written without `node:path` because this module is read by a renderer bundle as well as by the
 * main process, and nothing under `@shared` may reach for a Node builtin. What it has to get right
 * is the boundary: a bare prefix test says yes to `assets-old/bg.png` for the root `assets`, which
 * would count an unrelated file as an asset, and a test that did not fold separators would say no to
 * a path chokidar happened to report the other way round - which would keep a stale URL, the worse
 * of the two mistakes.
 */
export function isProjectAssetPath(assetsRoot: string, filePath: string): boolean {
    const root = normalizeSeparators(assetsRoot);
    const file = normalizeSeparators(filePath);
    return Boolean(root) && file.startsWith(`${root}/`);
}

/** One spelling of a path: forward slashes, no repeats, no trailing one. */
function normalizeSeparators(value: string): string {
    return value.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
}

/**
 * The key two bundles must share to reuse one asset-resolution pass.
 *
 * Falls back to the bundle revision for a bundle that states no asset revision - a host that watches
 * nothing, so nothing can tell it what changed. That is what this always did, and it costs such a
 * host nothing: it never reloads.
 */
export function devModeAssetPrewarmKey(bundle: Pick<DevModeBundle, "bundleId" | "revision" | "assetRevision">): string {
    return `${bundle.bundleId}:${bundle.assetRevision ?? bundle.revision}`;
}
