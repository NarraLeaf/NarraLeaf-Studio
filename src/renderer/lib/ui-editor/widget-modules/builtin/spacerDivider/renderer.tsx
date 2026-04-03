import type { CSSProperties } from "react";
import { colorValueToCss } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { getSpacerDividerProps } from "./helpers";

export function SpacerDividerRenderer({ element }: WidgetRendererProps) {
    const p = getSpacerDividerProps(element);
    const lineColor = colorValueToCss({ hex: p.color, alpha: 1 });

    if (p.mode === "spacer") {
        return (
            <div
                style={{
                    width: "100%",
                    height: "100%",
                    minWidth: 4,
                    minHeight: 4,
                    flexShrink: 0,
                    boxSizing: "border-box",
                }}
            />
        );
    }

    const isHorizontal = p.orientation === "horizontal";
    const line: CSSProperties = isHorizontal
        ? {
              height: Math.max(1, p.thickness),
              marginLeft: p.insetStart,
              marginRight: p.insetEnd,
              width: `calc(100% - ${p.insetStart + p.insetEnd}px)`,
              backgroundColor: lineColor,
              flexShrink: 0,
          }
        : {
              width: Math.max(1, p.thickness),
              marginTop: p.insetStart,
              marginBottom: p.insetEnd,
              height: `calc(100% - ${p.insetStart + p.insetEnd}px)`,
              backgroundColor: lineColor,
              flexShrink: 0,
          };

    return (
        <div
            style={{
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxSizing: "border-box",
            }}
        >
            <div style={line} />
        </div>
    );
}
