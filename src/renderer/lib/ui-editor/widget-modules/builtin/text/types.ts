export type TextAlign = "left" | "center" | "right";

/** Vertical distribution of text within the widget box (flex main axis). */
export type TextVerticalAlign = "start" | "center" | "end";

/** How lines break inside the text box (maps to white-space / word-break). */
export type TextWrapMode = "word" | "character" | "nowrap";

/**
 * Block flow of the text box.
 *
 * `vertical-rl` is the classic Japanese novel setting a VN wants: columns of glyphs read top to
 * bottom, the next column to the left. `vertical-lr` is the same rotation with columns advancing
 * rightwards, which Mongolian and some modern layouts use.
 */
export type TextWritingMode = "horizontal-tb" | "vertical-rl" | "vertical-lr";

/**
 * How glyphs sit inside a vertical column. Ignored while the box is horizontal.
 *
 * `mixed` is the convention: CJK stays upright and a Latin run is laid on its side, read by tilting
 * the head clockwise. `upright` stands every glyph up, which stacks Latin letter over letter.
 * `sideways` rotates the whole column, CJK included.
 */
export type TextOrientation = "mixed" | "upright" | "sideways";

import type { AppearanceModel } from "@shared/types/ui-editor/appearance";
import type { ElementEffectValues } from "@shared/types/ui-editor/effects";
import { DEFAULT_ELEMENT_EFFECT_VALUES } from "@shared/types/ui-editor/effects";

export type TextWidgetProps = {
    text: string;
    /** Game-localization opt-in: registers the implicit translation unit `ui:<elementId>.text`. */
    localizable?: boolean;
    /** Named localization key reference; takes precedence over the implicit unit. */
    localizationKey?: string;
    fontSize: number;
    color: string;
    fontWeight: "normal" | "bold" | "600";
    fontStyle: "normal" | "italic";
    textAlign: TextAlign;
    textVerticalAlign: TextVerticalAlign;
    lineHeight: number;
    /** Project font asset id when using a custom typeface in the editor; null inherits canvas default */
    fontAssetId: string | null;
    textWrapMode: TextWrapMode;

    /** Block flow. `horizontal-tb` leaves every other vertical setting inert. */
    writingMode: TextWritingMode;
    textOrientation: TextOrientation;
    /**
     * 縦中横: sets a short Latin or digit run upright across the column instead of on its side,
     * the way a Japanese novel sets a two-digit number. Only read while writing vertically.
     */
    tateChuYoko: boolean;
    /** Longest run tate-chu-yoko combines, in characters. Two is the typographic convention. */
    tateChuYokoMaxLength: number;

    transformOffsetX: number;
    transformOffsetY: number;
    transformScale: number;
    transformRotation: number;
    transformOpacity: number;

    /** Static baseline effects; appearance overlays may override per variant / state. */
    effects: ElementEffectValues;

    /** Optional variant + conditional row visuals; when absent, flat props are the sole source. */
    appearance?: AppearanceModel | null;
};

export const defaultTextWidgetProps: TextWidgetProps = {
    text: "Text",
    fontSize: 16,
    color: "#e5e7eb",
    fontWeight: "normal",
    fontStyle: "normal",
    textAlign: "left",
    textVerticalAlign: "start",
    lineHeight: 1.4,
    fontAssetId: null,
    textWrapMode: "word",
    writingMode: "horizontal-tb",
    textOrientation: "mixed",
    // On by default so flipping one dropdown to vertical already reads like a Japanese novel; it is
    // inert until then, so no stored element changes by gaining this fallback.
    tateChuYoko: true,
    tateChuYokoMaxLength: 2,
    transformOffsetX: 0,
    transformOffsetY: 0,
    transformScale: 1,
    transformRotation: 0,
    transformOpacity: 1,
    effects: { ...DEFAULT_ELEMENT_EFFECT_VALUES },
};
