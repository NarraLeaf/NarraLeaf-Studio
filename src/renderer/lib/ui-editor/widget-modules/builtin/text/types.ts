export type TextAlign = "left" | "center" | "right";

/** Vertical distribution of text within the widget box (flex main axis). */
export type TextVerticalAlign = "start" | "center" | "end";

/** How lines break inside the text box (maps to white-space / word-break). */
export type TextWrapMode = "word" | "character" | "nowrap";

import type { ElementEffectValues } from "@shared/types/ui-editor/effects";
import { DEFAULT_ELEMENT_EFFECT_VALUES } from "@shared/types/ui-editor/effects";

export type TextWidgetProps = {
    text: string;
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
    /** Static visual effects (no appearance / motion authoring on text). */
    effects: ElementEffectValues;
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
    effects: { ...DEFAULT_ELEMENT_EFFECT_VALUES },
};
