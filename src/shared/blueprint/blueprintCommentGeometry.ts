/**
 * How a comment node's stored params become a rectangle.
 *
 * A comment card - and therefore a group frame, which is a comment stretched around other cards -
 * carries its size in `params.width` / `params.height` rather than being measured from what it
 * contains. Three places read that pair: the card that draws it, the projection that stacks the
 * background layer, and the thumbnail in the interface panel. They have to agree, because a frame
 * sized one way on the canvas and another way in the preview is a thumbnail that stops resembling
 * the graph it summarises.
 *
 * Shared rather than renderer-local: this is document semantics, and the preview that needs it
 * lives outside the canvas module.
 *
 * Comments in English per project convention.
 */

/** The size a comment card takes until someone resizes it. */
export const BLUEPRINT_COMMENT_DEFAULT_WIDTH = 360;
export const BLUEPRINT_COMMENT_DEFAULT_HEIGHT = 180;

export type BlueprintCommentSize = { width: number; height: number };

/**
 * The size a comment's params describe.
 *
 * Anything that is not a positive finite number - absent, null, a string that will not parse, a
 * negative left by a bad write - falls back to the default. A frame of width 0 is not a smaller
 * frame, it is an invisible one, and the author has no handle left to fix it with.
 */
export function readBlueprintCommentSize(params: Record<string, unknown> | undefined): BlueprintCommentSize {
    return {
        width: readPositiveNumber(params?.width, BLUEPRINT_COMMENT_DEFAULT_WIDTH),
        height: readPositiveNumber(params?.height, BLUEPRINT_COMMENT_DEFAULT_HEIGHT),
    };
}

function readPositiveNumber(value: unknown, fallback: number): number {
    const n = Number(value ?? fallback);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}
