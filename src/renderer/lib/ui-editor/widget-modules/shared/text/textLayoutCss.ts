import type { CSSProperties } from "react";
import type { TextVerticalAlign, TextWrapMode } from "@/lib/ui-editor/widget-modules/builtin/text/types";

export function lineWrapCss(mode: TextWrapMode): Pick<CSSProperties, "whiteSpace" | "wordBreak" | "overflowWrap"> {
    switch (mode) {
        case "character":
            return { whiteSpace: "pre-wrap", wordBreak: "break-all", overflowWrap: "normal" };
        case "nowrap":
            return { whiteSpace: "nowrap", wordBreak: "normal", overflowWrap: "normal" };
        case "word":
        default:
            // A stored word outside the union (a hand-edited file, or one a tool wrote before the
            // tools refused it) wraps as the default does, rather than returning nothing and leaving
            // the box to whatever `white-space` it inherits.
            return { whiteSpace: "pre-wrap", wordBreak: "normal", overflowWrap: "break-word" };
    }
}

export function textVerticalAlignToJustifyContent(align: TextVerticalAlign): "flex-start" | "center" | "flex-end" {
    switch (align) {
        case "start":
            return "flex-start";
        case "center":
            return "center";
        case "end":
            return "flex-end";
    }
}
