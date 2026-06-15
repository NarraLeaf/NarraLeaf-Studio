import type { CSSProperties } from "react";
import type { TextVerticalAlign, TextWrapMode } from "@/lib/ui-editor/widget-modules/builtin/text/types";

export function lineWrapCss(mode: TextWrapMode): Pick<CSSProperties, "whiteSpace" | "wordBreak" | "overflowWrap"> {
    switch (mode) {
        case "word":
            return { whiteSpace: "pre-wrap", wordBreak: "normal", overflowWrap: "break-word" };
        case "character":
            return { whiteSpace: "pre-wrap", wordBreak: "break-all", overflowWrap: "normal" };
        case "nowrap":
            return { whiteSpace: "nowrap", wordBreak: "normal", overflowWrap: "normal" };
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
