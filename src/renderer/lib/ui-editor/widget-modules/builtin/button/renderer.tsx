import type { CSSProperties } from "react";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { colorValueToCss } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import { getButtonProps } from "./helpers";

export function ButtonRenderer({ element, children }: WidgetRendererProps) {
    const p = getButtonProps(element);
    const bg = colorValueToCss({ hex: p.backgroundColor, alpha: 1 });
    const borderColor = colorValueToCss({ hex: p.borderColor, alpha: 1 });

    const style: CSSProperties = {
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: bg,
        borderRadius: p.borderRadius,
        padding: `${p.paddingY}px ${p.paddingX}px`,
        overflow: p.clipContent ? "hidden" : "visible",
        cursor: "default",
    };

    if (p.borderStyle !== "none" && p.borderWidth > 0) {
        style.border = `${p.borderWidth}px ${p.borderStyle} ${borderColor}`;
    } else {
        style.border = "none";
    }

    return (
        <div style={style} role="presentation">
            {children}
        </div>
    );
}
