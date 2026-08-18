/**
 * What Studio has left on disk that it can throw away.
 *
 * An inventory rather than a Clear button, because the buckets are not comparable: plugin
 * thumbnails refill in seconds, an Electron dist refills in gigabytes over whatever link the
 * author has. A single button either deletes too much or too little, and nothing on screen would
 * say which.
 *
 * Everything listed here is, by construction, **re-obtainable** - deleting a bucket costs time,
 * never work. Directories that merely look like caches are deliberately absent: `backgrounds/`
 * holds the picture the author chose as their wallpaper, `dev-mode-saves/` holds their test saves,
 * `plugins/`, `authorization/`, `signing/` and `state/` are the product's own data.
 */

export const CACHE_BUCKET_IDS = [
  "pluginIcons",
  "uiTemplatePosters",
  "spellcheckDictionaries",
  "buildDependencies",
  "electronBuilder",
  "browser",
  "psdImports",
  "logs"
] as const;

export type CacheBucketId = (typeof CACHE_BUCKET_IDS)[number];

export type CacheBucketReport = {
  id: CacheBucketId;
  /**
   * Where it lives, shown so an author can look for themselves. Null when the bucket has no
   * single directory (the browser caches are several) or when the host has no such location -
   * on Windows without LOCALAPPDATA there is no electron-builder cache root to name.
   */
  path: string | null;
  /** Bytes on disk. 0 for a bucket that does not exist yet, which is not an error. */
  sizeBytes: number;
  /** Top-level entries, as a rough sense of "how much is in here". */
  entryCount: number;
  /** Present when the bucket could not be measured; it is then not offered for clearing. */
  error?: string;
};

export type CacheInventoryReport = {
  buckets: CacheBucketReport[];
  /** Sum of every bucket that measured cleanly. */
  totalBytes: number;
};

export type CacheClearResult = {
  /** Buckets actually cleared. */
  cleared: CacheBucketId[];
  /** Bytes that were in them before, for the sentence the panel shows afterwards. */
  freedBytes: number;
  /** Buckets asked for that could not be cleared, with the reason. */
  failed: Array<{ id: CacheBucketId; error: string }>;
};
