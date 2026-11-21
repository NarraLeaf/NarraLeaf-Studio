/**
 * Where a character sprite lands on the stage, as numbers an agent can read.
 *
 * The rule is the runtime's, restated (see `CharacterEntrancePreview`, which draws by the same one):
 *
 *  - a character's image is drawn at its OWN pixel size in design space - the compiler never asks
 *    for `autoFit` on a character (`getImage` in `storyCompiler`) - times `zoom` (and `scaleX` /
 *    `scaleY`);
 *  - `position` puts the image's CENTRE at `xalign` of the stage width from the left and `yalign` of
 *    the stage height up from the BOTTOM, with `xoffset` / `yoffset` in design pixels (+yoffset is
 *    up) - the engine's default "bottom left" origin and its `translate(-50%, 50%)`;
 *  - `pos=left|center|right` on a `/show` row writes `xalign` 0.25 / 0.5 / 0.75 AND `yalign` 0.5,
 *    so a character's own `yalign` never survives a placement word; only her offsets, zoom and
 *    scale do (`mergeCharacterEntranceProps` merges position axis by axis).
 *
 * So the one number that stands a sprite on the floor whatever placement word a row uses is the
 * character's `yoffset`: at `yalign` 0.5 the centre sits at half the stage height, and the feet land
 * on the bottom edge when the centre is half the DRAWN height up instead.
 *
 * Comments in English per project convention.
 */

import type { StoryTransformProps } from "@shared/types/story";

export type PixelSize = { width: number; height: number };

const DEFAULT_STAGE: PixelSize = { width: 1920, height: 1080 };

/** The project's design resolution, the stage every position is a share of. */
export function stageSizeOf(resolution: unknown): PixelSize {
    if (resolution && typeof resolution === "object") {
        const { width, height } = resolution as { width?: unknown; height?: unknown };
        if (typeof width === "number" && typeof height === "number" && width > 0 && height > 0) {
            return { width, height };
        }
    }
    if (typeof resolution === "string") {
        const match = /^(\d+)\s*[x×*]\s*(\d+)$/i.exec(resolution.trim());
        if (match) {
            return { width: Number(match[1]), height: Number(match[2]) };
        }
    }
    return DEFAULT_STAGE;
}

/**
 * Entrance defaults for a standing sprite: drawn at its own pixels (scaled down only when it is
 * taller than the stage, so the head is not cut off), feet on the bottom edge, centred across.
 *
 * `yalign` is stated as 0.5 - the value every placement word writes anyway - so the `yoffset` reads
 * the same on a row that says `pos=left` and on one that says nothing.
 */
export function standingEntrance(sprite: PixelSize, stage: PixelSize): StoryTransformProps {
    const zoom = sprite.height > stage.height ? Math.floor((stage.height / sprite.height) * 1000) / 1000 : 1;
    const drawnHeight = sprite.height * zoom;
    const yoffset = Math.round(drawnHeight / 2 - stage.height / 2);
    return {
        position: { xalign: 0.5, yalign: 0.5, yoffset },
        ...(zoom !== 1 ? { zoom } : {}),
    };
}

/** Share of the stage height left above the head by the framed default. */
const FRAMED_TOP_MARGIN = 0.04;
/**
 * Share of a full-length figure's height that stays on the stage, measured from the top of the head.
 * Commercial visual novels measured at 78-85%; the rest runs below the bottom edge, where the
 * dialogue box would have covered it anyway.
 */
const FRAMED_VISIBLE_SHARE = 0.8;
/** Height over width from which an unmeasured picture is taken to be a full-length figure. */
const FULL_LENGTH_ASPECT = 1.5;
/**
 * Figure height in head heights from which a figure is full-length rather than a bust. A standing
 * anime figure is 5 to 8 heads, a waist-up one 2 to 3; a chibi is about 2.5 and is framed as a bust,
 * which keeps her whole.
 */
const FULL_LENGTH_HEADS = 4.5;
/** Opaque bottom past which the figure is taken to reach the picture's bottom edge (cut by the artist). */
const CUT_AT_BOTTOM = 0.99;

/**
 * Where the drawn figure sits inside its picture, as shares of the picture (0-1, top-down).
 *
 * `top`/`bottom`/`left`/`right` bound the pixels that are not transparent. `head`, when a head was
 * found, is the head's top and height. A picture's padding varies from artist to artist, and the
 * figure inside it is what the framing is about, not the canvas around it.
 */
export type SpriteMeasure = {
    top: number;
    bottom: number;
    left: number;
    right: number;
    head?: { top: number; height: number };
};

/** Alpha at or under which a pixel counts as background: antialiasing haze is not the figure. */
const OPAQUE_ALPHA = 16;

/**
 * The bounds of the pixels that are not transparent in an RGBA buffer, as shares of its size, or
 * null when every pixel is. Rows and columns are scanned from the outside in, so a figure costs only
 * the transparent margin around it.
 */
export function opaqueBounds(data: ArrayLike<number>, width: number, height: number): Omit<SpriteMeasure, "head"> | null {
    const opaque = (x: number, y: number) => data[(y * width + x) * 4 + 3] > OPAQUE_ALPHA;
    const rowHas = (y: number) => { for (let x = 0; x < width; x += 1) if (opaque(x, y)) return true; return false; };
    const columnHas = (x: number, y0: number, y1: number) => { for (let y = y0; y <= y1; y += 1) if (opaque(x, y)) return true; return false; };
    let top = 0;
    while (top < height && !rowHas(top)) top += 1;
    if (top === height) return null;
    let bottom = height - 1;
    while (bottom > top && !rowHas(bottom)) bottom -= 1;
    let left = 0;
    while (left < width && !columnHas(left, top, bottom)) left += 1;
    let right = width - 1;
    while (right > left && !columnHas(right, top, bottom)) right -= 1;
    return { top: top / height, bottom: (bottom + 1) / height, left: left / width, right: (right + 1) / width };
}

/** How a picture is framed: cut by the artist, a full-length figure, or a bust standing whole. */
export type FramingKind = "cut" | "fullLength" | "bust";

/**
 * Which framing a picture takes. With a measure: a figure reaching the picture's bottom edge was cut
 * there by its artist (the way art made for Ren'Py is delivered) and stands on the stage's bottom
 * edge; otherwise the head decides - {@link FULL_LENGTH_HEADS} heads or more is full-length - and,
 * with no head found, a figure with space under it is taken to be standing full-length, which is
 * what such art almost always is. Without a measure, the picture's shape guesses.
 */
export function framingKind(sprite: PixelSize, measure?: SpriteMeasure): FramingKind {
    if (!measure) {
        return sprite.height >= sprite.width * FULL_LENGTH_ASPECT ? "fullLength" : "bust";
    }
    if (measure.bottom >= CUT_AT_BOTTOM) {
        return "cut";
    }
    if (measure.head && measure.head.height > 0) {
        return (measure.bottom - measure.top) / measure.head.height >= FULL_LENGTH_HEADS ? "fullLength" : "bust";
    }
    return "fullLength";
}

/**
 * Entrance defaults in the framing visual novels use: the top of the head just under the top edge,
 * and the face well above the dialogue box.
 *
 * - **full-length**: scaled, up or down, until the top {@link FRAMED_VISIBLE_SHARE} of the figure
 *   fills the stage under the margin; the rest runs below the bottom edge.
 * - **cut** (the figure reaches the picture's bottom edge): the picture's bottom on the stage's,
 *   scaled until the head is under the margin - nothing is cut a second time.
 * - **bust**: the figure stands on the bottom edge whole, scaled down only to keep the head on stage.
 *
 * `measure` places the figure rather than its canvas; without one the canvas stands for the figure,
 * which is the old guess and still the answer for a picture that cannot be read.
 */
export function framedEntrance(sprite: PixelSize, stage: PixelSize, measure?: SpriteMeasure): StoryTransformProps {
    const kind = framingKind(sprite, measure);
    const top = measure?.top ?? 0;
    const bottom = measure?.bottom ?? 1;
    // The head's own top when it was found below the silhouette's (an ahoge, ears or a hat above it
    // would otherwise be what gets the margin); the silhouette's otherwise.
    const headTop = measure?.head ? Math.max(top, Math.min(measure.head.top, bottom)) : top;
    const figureHeight = (bottom - headTop) * sprite.height;
    const headroom = stage.height * (1 - FRAMED_TOP_MARGIN);
    const rawZoom = kind === "fullLength"
        ? headroom / (FRAMED_VISIBLE_SHARE * figureHeight)
        : kind === "cut"
            ? headroom / ((1 - headTop) * sprite.height)
            : Math.min(1, headroom / figureHeight);
    const zoom = Math.round(rawZoom * 1000) / 1000;
    const drawnHeight = sprite.height * zoom;
    // Distance up from the stage's bottom edge to the picture's centre.
    const centreUp = kind === "fullLength"
        // The head's top at the margin.
        ? headroom + headTop * drawnHeight - drawnHeight / 2
        : kind === "cut"
            // The picture's bottom on the stage's.
            ? drawnHeight / 2
            // The figure's feet on the stage's bottom, whatever padding is under them.
            : drawnHeight / 2 - (1 - bottom) * drawnHeight;
    const yoffset = Math.round(centreUp - stage.height / 2);
    return {
        position: { xalign: 0.5, yalign: 0.5, yoffset },
        ...(zoom !== 1 ? { zoom } : {}),
    };
}

/** Another character's entrance defaults a new one can share, and whose they are. */
export type EntranceMatch = { name: string; props: StoryTransformProps };

/**
 * The entrance defaults a character takes when its first art lands, or `undefined` to leave them.
 *
 * Only a character that had no art and states no defaults is fitted: its first picture would
 * otherwise come on at its own pixels centred on the stage - a full-size PSD 1.6 times the height of
 * the stage, head cut off by the top - and nothing would say why. Defaults an author set are theirs,
 * and so is a character whose art is being replaced. The same rule the agent's tools apply.
 *
 * **A cast member whose art is the same size is followed** (`match`): pictures exported at one size
 * were drawn to one scale, and sharing her zoom and baseline keeps the difference in their heights -
 * what Ren'Py gets by drawing every sprite at its own pixels. Framing each character on her own would
 * make a short character as tall as a tall one. With no such cast member she is framed by her own
 * figure ({@link framedEntrance}).
 */
export function entranceForFirstArt(input: {
    hadArt: boolean;
    current: StoryTransformProps | undefined;
    sprite: PixelSize | null;
    stage: PixelSize;
    measure?: SpriteMeasure | null;
    match?: EntranceMatch | null;
}): StoryTransformProps | undefined {
    if (input.hadArt || input.current !== undefined || !input.sprite) {
        return undefined;
    }
    if (input.match) {
        return structuredClone(input.match.props);
    }
    return framedEntrance(input.sprite, input.stage, input.measure ?? undefined);
}

/**
 * The box a sprite occupies when a row places it with `pos=center`, in design pixels from the
 * stage's top-left - what an agent would otherwise have to take a screenshot to learn.
 */
export function drawnBoxAtCenter(
    sprite: PixelSize,
    entrance: StoryTransformProps | undefined,
    stage: PixelSize,
): { left: number; top: number; width: number; height: number } {
    const zoom = entrance?.zoom ?? 1;
    const width = sprite.width * zoom * Math.abs(entrance?.scaleX ?? 1);
    const height = sprite.height * zoom * Math.abs(entrance?.scaleY ?? 1);
    const centreX = 0.5 * stage.width + (entrance?.position?.xoffset ?? 0);
    const centreUp = 0.5 * stage.height + (entrance?.position?.yoffset ?? 0);
    const centreY = stage.height - centreUp;
    return {
        left: Math.round(centreX - width / 2),
        top: Math.round(centreY - height / 2),
        width: Math.round(width),
        height: Math.round(height),
    };
}
