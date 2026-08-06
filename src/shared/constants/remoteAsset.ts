/**
 * Remote asset constants.
 *
 * A remote asset is a *pinned reference*: the author gives a URL, Studio fetches the bytes once and
 * keeps them as a versioned snapshot beside every other asset, and a later Refresh asks the server
 * whether that snapshot is still current. The numbers here bound the one fetch that model performs.
 */

/** Abort a remote asset request that stalls past this. */
export const REMOTE_ASSET_FETCH_TIMEOUT_MS = 30_000;

/**
 * Refuse a remote asset larger than this.
 *
 * Well above the plugin package ceiling because the thing on the other end is content - a track, a
 * background, a video - and an author who deliberately typed a URL for a 60 MB video meant it. It is
 * a ceiling against a mistyped address pointing at a disk image, not a size policy for artwork.
 */
export const REMOTE_ASSET_MAX_BYTES = 256 * 1024 * 1024;

/**
 * The URL schemes a remote asset may use.
 *
 * `file:` is deliberately absent: a local file is imported, not referenced, and letting a project
 * pin one would produce a record that resolves on the author's machine and nowhere else.
 */
export const REMOTE_ASSET_ALLOWED_PROTOCOLS: readonly string[] = ["http:", "https:"];
