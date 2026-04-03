import type { CSSProperties } from "react";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { colorValueToCss } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import { getTextProps } from "./helpers";

export function TextRenderer({ element }: WidgetRendererProps) {
    const p = getTextProps(element);
    const color = colorValueToCss({ hex: p.color, alpha: 1 });

    const style: CSSProperties = {
        width: "100%",
        height: "100%",
        margin: 0,
        padding: 4,
        boxSizing: "border-box",
        fontSize: p.fontSize,
        fontWeight: p.fontWeight,
        color,
        textAlign: p.textAlign,
        lineHeight: p.lineHeight,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        overflow: "hidden",
    };

    return <p style={style}>{p.text}</p>;
}
