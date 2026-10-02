import type { CSSProperties } from "react";

/**
 * The squares drawn where something is transparent, and the size of one repeat of them in CSS
 * pixels (two squares a side).
 *
 * Built from the fill token, so they follow the theme like everything else.
 */
const TRANSPARENCY_SQUARES = "repeating-conic-gradient(var(--nl-fill) 0% 25%, transparent 0% 50%)";
const TRANSPARENCY_TILE_PX = 16;

/**
 * The backdrop under an image with an alpha channel.
 *
 * Almost every sprite in a visual novel has one, and a flat colour behind it hides exactly what an
 * author is looking for: whether an edge is clean, whether a halo appeared, whether the cut-out
 * lost a limb.
 */
export const TRANSPARENCY_BACKDROP: CSSProperties = {
    backgroundColor: "rgb(var(--nl-surface-sunken))",
    backgroundImage: TRANSPARENCY_SQUARES,
    backgroundSize: `${TRANSPARENCY_TILE_PX}px ${TRANSPARENCY_TILE_PX}px`,
};

/**
 * The custom property a zoomed canvas publishes its scale on, for {@link ZOOMED_TRANSPARENCY_BACKDROP}.
 */
export const CANVAS_SCALE_PROPERTY = "--nl-canvas-scale";

/**
 * The same squares, on a node drawn inside a zoomed canvas.
 *
 * A backdrop painted on a scaled node scales with it: the squares turn to grain when zoomed out and to
 * tiles when zoomed in, and neither reads as "nothing here". Dividing by the scale an ancestor
 * publishes on {@link CANVAS_SCALE_PROPERTY} keeps them the size they are everywhere else in Studio,
 * and does it in CSS - the node carrying the backdrop is not re-rendered on every zoom step.
 *
 * No colour of its own: whatever the canvas is painted shows between the squares.
 */
export const ZOOMED_TRANSPARENCY_BACKDROP: CSSProperties = {
    backgroundImage: TRANSPARENCY_SQUARES,
    backgroundSize: `calc(${TRANSPARENCY_TILE_PX}px / var(${CANVAS_SCALE_PROPERTY}, 1)) calc(${TRANSPARENCY_TILE_PX}px / var(${CANVAS_SCALE_PROPERTY}, 1))`,
};
