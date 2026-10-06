/**
 * What a game shows outside its stage, chosen per project (`.nlproj` `app.letterbox`).
 *
 * The stage keeps the design's aspect ratio, so on a screen of any other shape it leaves bars: beside
 * it on a wider screen, above and below on a taller one. Those bars belong to the window rather than
 * to any page - every page and every scene sits inside the stage - which is why this is a project
 * setting and not a field on a surface: one area, one answer, whichever page is showing.
 *
 * Only a colour and a picture. Nothing is laid out in the bars: their size is decided by the player's
 * screen, so anything placed there would land somewhere the author never saw.
 */

/**
 * How the picture fills the window behind the stage.
 *
 * Narrower than a surface background's modes on purpose: there is no `contain`. The picture is laid
 * out against the whole window and the stage covers its middle, so a picture of the design's own
 * shape - the usual case - would `contain` down to exactly the stage's rectangle and show nowhere at
 * all. The three kept here each put something in the bars on any screen.
 */
export type LetterboxFillMode = "cover" | "stretch" | "tile";

export const LETTERBOX_FILL_MODES: readonly LetterboxFillMode[] = ["cover", "stretch", "tile"];

export const DEFAULT_LETTERBOX_FILL_MODE: LetterboxFillMode = "cover";

export type LetterboxImage = {
    /** Image library asset id. Never empty: no picture is `image: null`. */
    assetId: string;
    fillMode: LetterboxFillMode;
};

export type LetterboxConfiguration = {
    /**
     * Opaque `#rrggbb`. Opaque because nothing is behind the bars to show through: a translucent
     * colour would only mix with whatever the host page happens to paint.
     */
    color: string;
    /** Drawn over the colour; the colour shows wherever the picture leaves a gap or is transparent. */
    image: LetterboxImage | null;
};

/** Black bars and no picture: what every game did before the setting existed. */
export const DEFAULT_LETTERBOX_CONFIGURATION: LetterboxConfiguration = {
    color: "#000000",
    image: null,
};

const OPAQUE_HEX = /^#[0-9a-f]{6}$/i;

export function isLetterboxFillMode(value: unknown): value is LetterboxFillMode {
    return typeof value === "string" && (LETTERBOX_FILL_MODES as readonly string[]).includes(value);
}

function normalizeLetterboxImage(value: unknown): LetterboxImage | null {
    if (!value || typeof value !== "object") {
        return null;
    }
    const record = value as Record<string, unknown>;
    const assetId = typeof record.assetId === "string" ? record.assetId.trim() : "";
    if (!assetId) {
        return null;
    }
    return {
        assetId,
        fillMode: isLetterboxFillMode(record.fillMode) ? record.fillMode : DEFAULT_LETTERBOX_FILL_MODE,
    };
}

/**
 * The library assets a letterbox draws - its picture, or nothing. For the warm-up that has to have
 * the bars ready by the first frame, the way it has the first screen's own pictures ready.
 */
export function letterboxAssetIds(value: unknown): string[] {
    const image = normalizeLetterboxConfiguration(value).image;
    return image ? [image.assetId] : [];
}

/**
 * Read a project's `app.letterbox` blob into a complete configuration.
 *
 * Anything unrecognised falls back rather than throwing: this runs while assembling every bundle, and
 * a hand-edited project should show black bars, not fail to start. A colour that is not opaque hex
 * reads as black for the reason the field is opaque at all. An unknown fill mode keeps the picture
 * and falls back to `cover` - a project saved by a later version should still show its picture.
 */
export function normalizeLetterboxConfiguration(value: unknown): LetterboxConfiguration {
    const record = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    const color = typeof record.color === "string" && OPAQUE_HEX.test(record.color.trim())
        ? record.color.trim().toUpperCase()
        : DEFAULT_LETTERBOX_CONFIGURATION.color;
    return {
        color,
        image: normalizeLetterboxImage(record.image),
    };
}
