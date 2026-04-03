import type { CSSProperties } from "react";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { getStackProps } from "./helpers";
import type { StackAlignItems, StackJustifyContent } from "./types";

function mapAlign(v: StackAlignItems): CSSProperties["alignItems"] {
    switch (v) {
        case "start":
            return "flex-start";
        case "end":
            return "flex-end";
        case "center":
            return "center";
        case "stretch":
        default:
            return "stretch";
    }
}

function mapJustify(v: StackJustifyContent): CSSProperties["justifyContent"] {
    switch (v) {
        case "start":
            return "flex-start";
        case "end":
            return "flex-end";
        case "center":
            return "center";
        case "space-between":
            return "space-between";
        case "space-around":
            return "space-around";
        default:
            return "flex-start";
    }
}

export function StackRenderer({ element, children }: WidgetRendererProps) {
    const p = getStackProps(element);
    const style: CSSProperties = {
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        position: "relative",
        display: "flex",
        flexDirection: p.direction === "horizontal" ? "row" : "column",
        gap: p.gap,
        paddingTop: p.paddingTop,
        paddingRight: p.paddingRight,
        paddingBottom: p.paddingBottom,
        paddingLeft: p.paddingLeft,
        alignItems: mapAlign(p.alignItems),
        justifyContent: mapJustify(p.justifyContent),
        overflow: "visible",
    };

    return <div style={style}>{children}</div>;
}
