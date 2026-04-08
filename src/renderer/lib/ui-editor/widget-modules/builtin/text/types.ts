export type TextAlign = "left" | "center" | "right";

/** How lines break inside the text box (maps to white-space / word-break). */
export type TextWrapMode = "word" | "character" | "nowrap";

export type TextWidgetProps = {
    text: string;
    fontSize: number;
    color: string;
    fontWeight: "normal" | "bold" | "600";
    textAlign: TextAlign;
    lineHeight: number;
    /** Project font asset id when using a custom typeface in the editor; null inherits canvas default */
    fontAssetId: string | null;
    textWrapMode: TextWrapMode;
};

export const defaultTextWidgetProps: TextWidgetProps = {
    text: "Text",
    fontSize: 16,
    color: "#e5e7eb",
    fontWeight: "normal",
    textAlign: "left",
    lineHeight: 1.4,
    fontAssetId: null,
    textWrapMode: "word",
};
