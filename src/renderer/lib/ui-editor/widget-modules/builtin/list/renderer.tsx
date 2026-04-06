import type { CSSProperties } from "react";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { getListProps } from "./helpers";

export function ListRenderer({ element, children }: WidgetRendererProps) {
    const p = getListProps(element);
    const count = Math.max(1, Math.min(32, Math.round(p.previewCount)));

    const outer: CSSProperties = {
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        position: "relative",
        display: "flex",
        flexDirection: p.repeatDirection === "vertical" ? "column" : "row",
        gap: p.itemGap,
        overflow: "hidden",
        alignItems: "stretch",
    };

    const innerDir = p.templateDirection === "horizontal" ? "row" : "column";

    return (
        <div style={outer}>
            {Array.from({ length: count }, (_, i) => (
                <div
                    key={`${element.id}__list__${i}`}
                    style={{
                        display: "flex",
                        flexDirection: innerDir,
                        gap: p.templateGap,
                        flexShrink: 0,
                        pointerEvents: i === 0 ? "auto" : "none",
                    }}
                >
                    {children}
                </div>
            ))}
        </div>
    );
}
