/**
 * How the atomic writer names its scratch files.
 *
 * Two constants and nothing else, split out of `@shared/utils/fs` because that module
 * reaches Node's `fs`, `path` and `crypto` at import time - so a renderer module that
 * wanted the suffix from there would pull node builtins into a browser-platform
 * bundle and fail the build. The version control working-set policy is exactly such a
 * module: the main process scans with it and the renderer reasons with it. Splitting
 * the constants out is what lets both spell `.nltmp` once. A second spelling is how a
 * half-written document ends up in permanent history.
 *
 * `@shared/utils/fs` re-exports both, so nothing that already imports them changes.
 */

/**
 * Suffix of the scratch files the atomic writer creates next to its target.
 *
 * Exported so the file watchers can filter them out from one place: a temp file lives in the
 * project tree for a few milliseconds, and a watcher that reports it would make Dev Mode reload on
 * a file that is already gone. See {@link ATOMIC_WRITE_TEMP_PATTERN}.
 */
export const ATOMIC_WRITE_TEMP_SUFFIX = ".nltmp";

/** Matches any path produced by the atomic writer. The one filter every watcher should use. */
export const ATOMIC_WRITE_TEMP_PATTERN = /\.nltmp$/;
