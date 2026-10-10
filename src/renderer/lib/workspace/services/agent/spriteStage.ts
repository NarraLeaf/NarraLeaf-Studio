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
