import React, { type ReactNode } from "react";
import type { UIElement } from "@shared/types/ui-editor/document";

/**
 * Renders when a document element type has no registered renderer (hard cutover: no silent pretend-widget).
 */
export function renderUnknownWidgetTypeContent(element: UIElement, children: ReactNode[]): ReactNode {
    if (typeof console !== "undefined" && console.warn) {
        console.warn(`[UI Editor] Unsupported widget type "${element.type}" (element ${element.id})`);
    }

    const hasChildren = children.length > 0;
    const body = hasChildren ? (
        <>{children}</>
    ) : (
        <div className="flex items-center justify-center w-full h-full text-2xs text-warning px-2 text-center">
            {element.name ?? element.type}
        </div>
    );

    return (
        <div className="flex flex-col min-h-[20px] w-full h-full box-border border-2 border-warning/55 bg-warning/10 overflow-hidden">
            <div
                className="shrink-0 px-1.5 py-0.5 text-2xs leading-tight text-warning bg-warning/20 font-medium truncate"
                title={element.type}
            >
                Unsupported type: {element.type}
            </div>
            <div className="flex-1 min-h-0 min-w-0 flex flex-col">{body}</div>
        </div>
    );
}
