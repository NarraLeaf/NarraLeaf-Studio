import React, { useMemo } from "react";
import type { CSSProperties } from "react";
import type { UIElement, UILayout } from "@shared/types/ui-editor/document";

type EditorNodeWrapperProps = {
    element: UIElement;
    layout: UILayout;
    isRoot?: boolean;
    styleOverrides?: CSSProperties;
    children?: React.ReactNode;
};

export function EditorNodeWrapper({
    element,
    layout,
    isRoot = false,
    styleOverrides,
    children,
}: EditorNodeWrapperProps) {
    const containerStyle = useMemo<CSSProperties>(() => {
        const { x, y, width, height, rotation, opacity = 1 } = layout;
        const style: CSSProperties = {
            position: isRoot ? "relative" : "absolute",
            left: x,
            top: y,
            width,
            height,
            opacity,
            pointerEvents: isRoot ? "none" : "auto",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            ...styleOverrides,
        };
        if (rotation) {
            style.transform = `rotate(${rotation}deg)`;
        }
        return style;
    }, [layout, isRoot, styleOverrides]);

    return (
        <div
            data-ui-element-id={element.id}
            className={`ui-editor-node ${isRoot ? "ui-editor-node-root" : ""}`}
            style={containerStyle}
        >
            {children}
        </div>
    );
}
