export type ImageFillMode = "cover" | "contain" | "stretch" | "crop" | "tile" | "nineSlice";

/** Every mode, in the order the pickers list them. */
export const IMAGE_FILL_MODES: readonly ImageFillMode[] = ["cover", "contain", "stretch", "crop", "tile", "nineSlice"];

export function isImageFillMode(value: unknown): value is ImageFillMode {
    return typeof value === "string" && (IMAGE_FILL_MODES as readonly string[]).includes(value);
}

export interface ImageFillCropPlacement {
    leftPct: number;
    topPct: number;
    widthPct: number;
    heightPct: number;
}

/**
 * Where a nine-slice picture is cut, as distances in the picture's own pixels from each edge.
 *
 * The four corners keep their size, the edges stretch along one axis and the centre along both, so a
 * framed panel or a button drawn once can be any size without its border or corners distorting. The
 * border is drawn at the same distances in the element (one picture pixel to one design pixel), and
 * shrinks evenly when the element is too small to hold both sides.
 */
export interface ImageFillSlice {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

export interface ImageFill {
    mode: ImageFillMode;
    assetId?: string | null;
    cropPlacement?: ImageFillCropPlacement;
    /** Read only in `nineSlice` mode. Absent there reads as {@link DEFAULT_NINE_SLICE}. */
    slice?: ImageFillSlice;
}

/** The cut a nine-slice fill uses before the author sets one, and when the stored one is unreadable. */
export const DEFAULT_NINE_SLICE: ImageFillSlice = { top: 16, right: 16, bottom: 16, left: 16 };

/**
 * A starting cut for a picture of the given size: a third of the shorter side on every edge, which
 * puts the lines inside the frame of almost any panel art and leaves a centre to stretch.
 */
export function suggestNineSlice(width: number, height: number): ImageFillSlice {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return { ...DEFAULT_NINE_SLICE };
    }
    const edge = Math.max(1, Math.floor(Math.min(width, height) / 3));
    return { top: edge, right: edge, bottom: edge, left: edge };
}

/** Each distance as a whole, non-negative number of pixels; anything unreadable is the default's. */
export function normalizeImageFillSlice(raw: unknown): ImageFillSlice {
    const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const read = (key: keyof ImageFillSlice): number => {
        const value = source[key];
        return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : DEFAULT_NINE_SLICE[key];
    };
    return { top: read("top"), right: read("right"), bottom: read("bottom"), left: read("left") };
}
