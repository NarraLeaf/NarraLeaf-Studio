/**
 * What a press on the canvas can pick. A layer locked in the outline (`data-ui-editor-locked`, set by
 * `useEditorLayerFlags`) is not: it takes no pointer at all, so presses reach what is behind it.
 */
export const SELECTABLE_TARGET = ".ui-editor-node:not(.ui-editor-node-root):not([data-ui-editor-locked])";
export const PRIMARY_OUTLINE_STRONG = "var(--narraleaf-accent-strong, rgba(64, 168, 196, 0.92))";
export const PRIMARY_OUTLINE_WEAK = "var(--narraleaf-accent-weak, rgba(64, 168, 196, 0.6))";
