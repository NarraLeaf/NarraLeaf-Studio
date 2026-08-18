/**
 * How Studio's own downloads are pointed somewhere other than the official host.
 *
 * There are deliberately two shapes here, because the code has two:
 *
 * - A **source** is a base URL a downstream tool composes paths onto. electron-builder's
 *   `electronDownload.mirror` wants `<mirror><version>/<file>`; its binaries mirror wants
 *   `<mirror><name>/<name>.7z`; a registry URL points at one document. Each is its own
 *   setting because each has its own layout - `GameBuildManager` already documents why one
 *   cannot be synthesized from another.
 * - A **rewrite** is a prefix substitution applied to a URL Studio did not choose. The
 *   plugin `.zip`, the store icon and a plugin build dependency all arrive as absolute URLs
 *   *inside a document*, so no source setting can reach them.
 *
 * Sources live as plain string keys in global state. Rewrites live here.
 */

/** Global-state key holding the ordered rewrite list. */
export const DOWNLOAD_REWRITES_KEY = "network.downloadRewrites";

/** One prefix substitution. Order in the stored array is match order. */
export type DownloadRewriteRule = {
  /**
   * URL prefix to match, compared literally after both sides are trimmed. A prefix rather
   * than a host so one rule can cover `github.com/NarraLeaf/` without claiming all of
   * GitHub, and a glob rather than nothing so nobody has to learn a pattern language for
   * what is, in practice, "put this in front instead".
   */
  from: string;
  /** Replacement for the matched prefix. The composed URL must parse and must be https. */
  to: string;
  /** Off keeps a rule the author is still tuning without it taking effect. */
  enabled: boolean;
};

/** What {@link rewriteDownloadUrl} did, so the caller can log it. */
export type DownloadRewriteOutcome = {
  /** The URL to fetch: rewritten when a rule applied, the original otherwise. */
  url: string;
  /** The rule that applied, absent when none did or when its result was refused. */
  applied?: DownloadRewriteRule;
  /**
   * Why a matching rule did not apply. Present only when a rule matched and was then
   * rejected, so a silently-ignored mirror can be told apart from a mirror nobody typed.
   */
  refused?: "unparseable" | "not-https";
};

/**
 * The four named download sources, in the order the settings panel lists them.
 *
 * Kept as one table so the panel, the i18n keys and the reachability probe all walk the
 * same list; adding a fifth source is one entry here rather than four edits apart.
 */
export const DOWNLOAD_SOURCE_KEYS = [
  "plugins.registryUrl",
  "uiTemplates.registryUrl",
  "build.electronMirror",
  "build.electronBuilderBinariesMirror"
] as const;

export type DownloadSourceKey = (typeof DOWNLOAD_SOURCE_KEYS)[number];
