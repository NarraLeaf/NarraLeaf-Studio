import type { CSSProperties } from "react";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { composeListHostEffectStyle } from "@/lib/ui-editor/widget-modules/shared/effects/effectStyleComposer";
import { getListProps } from "./helpers";

export function ListRenderer({ element, children }: WidgetRendererProps) {
    const p = getListProps(element);
    const count = Math.max(1, Math.min(32, Math.round(p.previewCount)));

    const effectStyle = composeListHostEffectStyle(p.effects);
    const hasVisualOverflowEffects =
        Boolean(effectStyle.boxShadow) ||
        Boolean(effectStyle.filter) ||
        Boolean(effectStyle.backdropFilter);
    const useClipIsolation = hasVisualOverflowEffects;

    const flexHost: CSSProperties = {
        display: "flex",
        flexDirection: p.repeatDirection === "vertical" ? "column" : "row",
        gap: p.itemGap,
        alignItems: "stretch",
    };

    const outer: CSSProperties = {
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        position: "relative",
        ...flexHost,
        overflow: useClipIsolation ? "visible" : "hidden",
        ...effectStyle,
    };

    const innerDir = p.templateDirection === "horizontal" ? "row" : "column";

    const listBody = Array.from({ length: count }, (_, i) => (
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
    ));

    if (useClipIsolation) {
        return (
            <div style={outer}>
                <div
                    style={{
                        ...flexHost,
                        flex: 1,
                        minWidth: 0,
                        minHeight: 0,
                        position: "relative",
                        overflow: "hidden",
                        borderRadius: "inherit",
                    }}
                >
                    {listBody}
                </div>
            </div>
        );
    }

    return <div style={outer}>{listBody}</div>;
}
