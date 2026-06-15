import React, { useCallback, useMemo } from "react";
import type { CSSProperties, MouseEvent } from "react";
import type { UIElement, UILayout } from "@shared/types/ui-editor/document";
import { useWidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";

export type EditorNodeLayoutMode = "absolute" | "flow";

type EditorNodeWrapperProps = {
    element: UIElement;
    layout: UILayout;
    isRoot?: boolean;
    /** Flow children are laid out by a flex parent (`nl.container` stack/scroll or `nl.list`); skip absolute x/y. */
    layoutMode?: EditorNodeLayoutMode;
    styleOverrides?: CSSProperties;
    children?: React.ReactNode;
};

export function EditorNodeWrapper({
    element,
    layout,
    isRoot = false,
    layoutMode = "absolute",
    styleOverrides,
    children,
}: EditorNodeWrapperProps) {
    const widgetRuntimeStore = useWidgetRuntimeStateStore();

    const onMouseEnter = useCallback(() => {
        widgetRuntimeStore?.setHoverTarget(element.id);
    }, [widgetRuntimeStore, element.id]);

    const onMouseOut = useCallback(
        (e: MouseEvent<HTMLDivElement>) => {
            if (!widgetRuntimeStore) {
                return;
            }
            const related = e.relatedTarget;
            if (!related || !e.currentTarget.contains(related as Node)) {
                widgetRuntimeStore.clearHoverIf(element.id);
            }
        },
        [widgetRuntimeStore, element.id]
    );

    const containerStyle = useMemo<CSSProperties>(() => {
        const { x, y, width, height, rotation, opacity = 1 } = layout;
        const normalizedWidth = Math.abs(width);
        const normalizedHeight = Math.abs(height);
        const offsetX = Math.min(0, width);
        const offsetY = Math.min(0, height);
        const isFlow = !isRoot && layoutMode === "flow";
        const style: CSSProperties = {
            position: isRoot ? "relative" : isFlow ? "relative" : "absolute",
            left: isFlow ? 0 : x + offsetX,
            top: isFlow ? 0 : y + offsetY,
            width: normalizedWidth,
            height: normalizedHeight,
            opacity,
            pointerEvents: isRoot ? "none" : "auto",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            flexShrink: isFlow ? 0 : undefined,
            // Flow items live inside flex stack parents: keep authored size but never wider than the
            // parent's inner box (large padding shrinks that box; fixed px width used to overflow).
            ...(isFlow ? { minWidth: 0, maxWidth: "100%" } : {}),
            // Each widget must own its stacking context so internal z-index values
            // (e.g. container free-layout chrome z:0 / children z:1) do not leak
            // into the parent context and break sibling paint & hit-test order.
            isolation: isRoot ? undefined : "isolate",
            ...styleOverrides,
        };
        if (rotation) {
            const transforms = [];
            if (rotation) {
                transforms.push(`rotate(${rotation}deg)`);
            }
            style.transform = transforms.join(" ");
            style.transformOrigin = "center center";
        }
        return style;
    }, [layout, isRoot, layoutMode, styleOverrides]);

    return (
        <div
            data-ui-element-id={element.id}
            className={`ui-editor-node ${isRoot ? "ui-editor-node-root" : ""}`}
            style={containerStyle}
            onMouseEnter={widgetRuntimeStore ? onMouseEnter : undefined}
            onMouseOut={widgetRuntimeStore ? onMouseOut : undefined}
        >
            {children}
        </div>
    );
}
