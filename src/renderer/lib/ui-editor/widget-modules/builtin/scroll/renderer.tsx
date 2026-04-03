import type { CSSProperties } from "react";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { getScrollProps } from "./helpers";

export function ScrollRenderer({ element, children }: WidgetRendererProps) {
    const p = getScrollProps(element);
    const isY = p.axis === "y";

    const viewport: CSSProperties = {
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        position: "relative",
        overflowX: isY ? "hidden" : "auto",
        overflowY: isY ? "auto" : "hidden",
    };

    const inner: CSSProperties = {
        display: "flex",
        flexDirection: isY ? "column" : "row",
        flexWrap: "nowrap",
        alignItems: "stretch",
        justifyContent: "flex-start",
        gap: 0,
        minWidth: isY ? "100%" : undefined,
        minHeight: isY ? undefined : "100%",
    };

    return (
        <div style={viewport}>
            <div style={inner}>{children}</div>
        </div>
    );
}
