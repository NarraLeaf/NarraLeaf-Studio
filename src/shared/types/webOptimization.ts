/**
 * What the exported static site is allowed to do to the author's bytes on the
 * way out.
 *
 * A desktop build ships its payload verbatim: the player already downloaded an
 * installer, and the files sit on their disk. A web export is different in kind -
 * every asset crosses the network on first play, so the size of the site is the
 * length of the wait before the game starts. This is the policy for closing that
 * gap.
 *
 * The split that matters here is lossless versus lossy, and it is a split of
 * authority rather than of degree. A lossless step cannot change what the player
 * sees, so it needs no permission and is on by default. A lossy step trades
 * picture quality for bytes; that is the author's call about their own artwork,
 * so it is off until they say otherwise. Nothing in this file may blur that line
 * by making a lossy default look lossless.
 *
 * Shared because both sides read it: the project settings UI writes it into
 * `.nlproj`, and the build reads it back when it optimizes the compiled site.
 */

export type WebOptimizationConfiguration = {
  /**
   * Re-encode images as lossless WebP when that is smaller.
   *
   * "Lossless" is checked rather than assumed: every conversion is decoded
   * again and compared pixel for pixel against the source, and anything that
   * does not match is discarded (see `optimizeWebExport`). So this can shrink
   * the site but cannot alter it.
   */
  losslessImages: boolean;
  /**
   * Write `.br` and `.gz` siblings next to the site's text files, for servers
   * configured to serve a precompressed variant (nginx `brotli_static` /
   * `gzip_static` and equivalents).
   *
   * Additive and inert: a host that knows nothing about them serves the
   * originals and nothing changes.
   */
  precompress: boolean;
  /**
   * Re-encode images as *lossy* WebP. Off by default, and deliberately so:
   * it discards picture information permanently, and only the author can
   * decide their artwork can afford that.
   */
  lossyImages: boolean;
  /** WebP quality for {@link lossyImages}, 1-100. Ignored while that is off. */
  lossyQuality: number;
};

/** Guard rails for the authored quality; the settings UI offers the same range. */
export const WEB_LOSSY_QUALITY_MIN = 1;
export const WEB_LOSSY_QUALITY_MAX = 100;

/**
 * Lossless on, lossy off: what a project that never opened this panel means, and
 * what every project predating the setting gets.
 *
 * 82 is the quality that only applies once someone turns lossy on. It sits just
 * above the point where WebP starts showing ringing on the flat colour and hard
 * line art a visual novel is mostly made of - a photographic default (75) is
 * measurably wrong for this content.
 */
export const DEFAULT_WEB_OPTIMIZATION_CONFIGURATION: WebOptimizationConfiguration = {
  losslessImages: true,
  precompress: true,
  lossyImages: false,
  lossyQuality: 82
};

function clampQuality(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(WEB_LOSSY_QUALITY_MAX, Math.max(WEB_LOSSY_QUALITY_MIN, Math.trunc(parsed)));
}

/**
 * Coerce an unknown (persisted, partially-migrated, or absent) value into a
 * complete configuration.
 *
 * Note which way the fallbacks point: a malformed `lossyImages` falls back to
 * off. A config file that has been hand-edited into nonsense must not be able to
 * turn on the one step that cannot be undone.
 */
export function normalizeWebOptimizationConfiguration(
  value: unknown
): WebOptimizationConfiguration {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_WEB_OPTIMIZATION_CONFIGURATION };
  }
  const record = value as Record<string, unknown>;
  return {
    losslessImages:
      typeof record.losslessImages === "boolean"
        ? record.losslessImages
        : DEFAULT_WEB_OPTIMIZATION_CONFIGURATION.losslessImages,
    precompress:
      typeof record.precompress === "boolean"
        ? record.precompress
        : DEFAULT_WEB_OPTIMIZATION_CONFIGURATION.precompress,
    lossyImages: record.lossyImages === true,
    lossyQuality: clampQuality(
      record.lossyQuality,
      DEFAULT_WEB_OPTIMIZATION_CONFIGURATION.lossyQuality
    )
  };
}

/** Whether anything in this policy would touch the compiled site's images. */
export function webOptimizationTouchesImages(config: WebOptimizationConfiguration): boolean {
  return config.losslessImages || config.lossyImages;
}
