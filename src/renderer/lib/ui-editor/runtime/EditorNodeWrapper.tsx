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
        const normalizedWidth = Math.abs(width);
        const normalizedHeight = Math.abs(height);
        const offsetX = Math.min(0, width);
        const offsetY = Math.min(0, height);
        const style: CSSProperties = {
            position: isRoot ? "relative" : "absolute",
            left: x + offsetX,
            top: y + offsetY,
            width: normalizedWidth,
            height: normalizedHeight,
            opacity,
            pointerEvents: isRoot ? "none" : "auto",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
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
