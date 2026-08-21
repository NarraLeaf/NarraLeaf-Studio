/**
 * What a build is allowed to do to the author's artwork on the way out.
 *
 * There is exactly one decision here, and the reason there is only one is worth
 * stating, because the obvious design has three or four.
 *
 * A step that cannot change what the player sees needs no permission. Converting
 * an image to lossless WebP is verified pixel for pixel and discarded unless it
 * matches; writing `.br` and `.gz` siblings beside a site's text files leaves the
 * originals in place. Neither is a question anybody can answer wrongly, so
 * neither is a setting: they are what a build does. A step that discards picture
 * information is the opposite - only the author can say their artwork can afford
 * it - so that is the setting, and it is the whole of it.
 *
 * The axis that is deliberately absent is the platform. This policy is a
 * statement about the artwork, not about a target, so it applies to every
 * package a build produces: desktop, browser, Android, iOS. A per-platform
 * quality would be a matrix, and the thing a matrix costs is not screen space -
 * it is that no author can then say what their game looks like without naming
 * where it was installed from.
 *
 * Shared because both sides read it: the project settings UI writes it into
 * `.nlproj`, and the build reads it back before it compiles anything.
 */

export type AssetOptimizationConfiguration = {
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
export const ASSET_LOSSY_QUALITY_MIN = 1;
export const ASSET_LOSSY_QUALITY_MAX = 100;

/**
 * Lossy off: what a project that never opened this panel means, and what every
 * project predating the setting gets.
 *
 * 82 is the quality that only applies once someone turns lossy on. It sits just
 * above the point where WebP starts showing ringing on the flat colour and hard
 * line art a visual novel is mostly made of - a photographic default (75) is
 * measurably wrong for this content.
 */
export const DEFAULT_ASSET_OPTIMIZATION_CONFIGURATION: AssetOptimizationConfiguration = {
    lossyImages: false,
    lossyQuality: 82,
};

function clampQuality(value: unknown, fallback: number): number {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(ASSET_LOSSY_QUALITY_MAX, Math.max(ASSET_LOSSY_QUALITY_MIN, Math.trunc(parsed)));
}

/**
 * Coerce an unknown (persisted, partially-migrated, or absent) value into a
 * complete configuration.
 *
 * Note which way the fallback points: a malformed `lossyImages` falls back to
 * off. A config file that has been hand-edited into nonsense must not be able to
 * turn on the one step that cannot be undone.
 */
export function normalizeAssetOptimizationConfiguration(value: unknown): AssetOptimizationConfiguration {
    if (!value || typeof value !== "object") {
        return { ...DEFAULT_ASSET_OPTIMIZATION_CONFIGURATION };
    }
    const record = value as Record<string, unknown>;
    return {
        lossyImages: record.lossyImages === true,
        lossyQuality: clampQuality(record.lossyQuality, DEFAULT_ASSET_OPTIMIZATION_CONFIGURATION.lossyQuality),
    };
}

/**
 * The policy a project's `app` config states, reading the key this setting used
 * to live under when it has not been written since.
 *
 * `app.webOptimization` held the same two fields alongside two switches for the
 * steps that are now unconditional. Those two carried no authored intent worth
 * preserving - both only ever decided whether a build shrank bytes it could not
 * alter - so they are dropped rather than migrated, and the one real decision
 * survives under its own name.
 */
export function readAssetOptimizationConfiguration(app: unknown): AssetOptimizationConfiguration {
    if (!app || typeof app !== "object") {
        return { ...DEFAULT_ASSET_OPTIMIZATION_CONFIGURATION };
    }
    const record = app as { assetOptimization?: unknown; webOptimization?: unknown };
    return normalizeAssetOptimizationConfiguration(record.assetOptimization ?? record.webOptimization);
}
