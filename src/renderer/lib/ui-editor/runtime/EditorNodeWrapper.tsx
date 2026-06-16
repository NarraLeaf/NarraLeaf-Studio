import React, { useCallback, useMemo } from "react";
import type { CSSProperties, FocusEvent, MouseEvent, PointerEvent } from "react";
import type { UIElement, UILayout } from "@shared/types/ui-editor/document";
import { useWidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { getWidgetLogicEvent } from "@shared/types/ui-editor/widgetLogic";

export type EditorNodeLayoutMode = "absolute" | "flow";

type EditorNodeWrapperProps = {
    element: UIElement;
    layout: UILayout;
    isRoot?: boolean;
    /** Flow children are laid out by a flex parent (`nl.container` stack/scroll or `nl.list`); skip absolute x/y. */
    layoutMode?: EditorNodeLayoutMode;
    styleOverrides?: CSSProperties;
    hostAdapter?: UIHostAdapter;
    children?: React.ReactNode;
};

function eventTargetElement(target: EventTarget | null): Element | null {
    if (target instanceof Element) {
        return target;
    }
    if (target instanceof Node) {
        return target.parentElement;
    }
    return null;
}

export function EditorNodeWrapper({
    element,
    layout,
    isRoot = false,
    layoutMode = "absolute",
    styleOverrides,
    hostAdapter,
    children,
}: EditorNodeWrapperProps) {
    const widgetRuntimeStore = useWidgetRuntimeStateStore();
    const blueprintRuntime = hostAdapter?.blueprintRuntime;

    const isDirectElementEvent = useCallback(
        (target: EventTarget | null) => {
            const targetEl = eventTargetElement(target);
            const closest = targetEl?.closest("[data-ui-element-id]");
            return closest?.getAttribute("data-ui-element-id") === element.id;
        },
        [element.id],
    );

    const dispatchWidgetEvent = useCallback(
        (eventName: string, target: EventTarget | null) => {
            if (!blueprintRuntime || !isDirectElementEvent(target)) {
                return false;
            }
            if (!getWidgetLogicEvent(element.type, eventName)) {
                return false;
            }
            void blueprintRuntime.dispatchElementBlueprintEvent(element.id, eventName);
            return true;
        },
        [blueprintRuntime, element.id, element.type, isDirectElementEvent],
    );

    const onPointerEnter = useCallback((e: PointerEvent<HTMLDivElement>) => {
        widgetRuntimeStore?.setHoverTarget(element.id);
        dispatchWidgetEvent("pointerEnter", e.target);
    }, [dispatchWidgetEvent, widgetRuntimeStore, element.id]);

    const onPointerLeave = useCallback(
        (e: PointerEvent<HTMLDivElement>) => {
            if (!widgetRuntimeStore) {
                dispatchWidgetEvent("pointerLeave", e.target);
                return;
            }
            const related = e.relatedTarget;
            if (!related || !e.currentTarget.contains(related as Node)) {
                widgetRuntimeStore.clearHoverIf(element.id);
                widgetRuntimeStore.setActivePointerTarget(null);
                dispatchWidgetEvent("pointerLeave", e.target);
            }
        },
        [dispatchWidgetEvent, widgetRuntimeStore, element.id],
    );

    const onPointerDown = useCallback(
        (e: PointerEvent<HTMLDivElement>) => {
            if (isDirectElementEvent(e.target)) {
                widgetRuntimeStore?.setActivePointerTarget(element.id);
            }
            dispatchWidgetEvent("pointerDown", e.target);
        },
        [dispatchWidgetEvent, isDirectElementEvent, widgetRuntimeStore, element.id],
    );

    const onPointerUp = useCallback(
        (e: PointerEvent<HTMLDivElement>) => {
            if (isDirectElementEvent(e.target)) {
                widgetRuntimeStore?.setActivePointerTarget(null);
            }
            dispatchWidgetEvent("pointerUp", e.target);
        },
        [dispatchWidgetEvent, isDirectElementEvent, widgetRuntimeStore],
    );

    const onPointerCancel = useCallback(() => {
        widgetRuntimeStore?.setActivePointerTarget(null);
    }, [widgetRuntimeStore]);

    const onPointerMove = useCallback(
        (e: PointerEvent<HTMLDivElement>) => {
            dispatchWidgetEvent("pointerMove", e.target);
        },
        [dispatchWidgetEvent],
    );

    const onClick = useCallback(
        (e: MouseEvent<HTMLDivElement>) => {
            dispatchWidgetEvent("click", e.target);
        },
        [dispatchWidgetEvent],
    );

    const onDoubleClick = useCallback(
        (e: MouseEvent<HTMLDivElement>) => {
            dispatchWidgetEvent("doubleClick", e.target);
        },
        [dispatchWidgetEvent],
    );

    const onContextMenu = useCallback(
        (e: MouseEvent<HTMLDivElement>) => {
            if (dispatchWidgetEvent("contextMenu", e.target)) {
                e.preventDefault();
            }
        },
        [dispatchWidgetEvent],
    );

    const onFocus = useCallback(
        (e: FocusEvent<HTMLDivElement>) => {
            if (isDirectElementEvent(e.target)) {
                widgetRuntimeStore?.setFocusedTarget(element.id);
            }
            dispatchWidgetEvent("focus", e.target);
        },
        [dispatchWidgetEvent, isDirectElementEvent, widgetRuntimeStore, element.id],
    );

    const onBlur = useCallback(
        (e: FocusEvent<HTMLDivElement>) => {
            if (isDirectElementEvent(e.target)) {
                widgetRuntimeStore?.setFocusedTarget(null);
            }
            dispatchWidgetEvent("blur", e.target);
        },
        [dispatchWidgetEvent, isDirectElementEvent, widgetRuntimeStore],
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
            onPointerEnter={widgetRuntimeStore || blueprintRuntime ? onPointerEnter : undefined}
            onPointerLeave={widgetRuntimeStore || blueprintRuntime ? onPointerLeave : undefined}
            onPointerDown={widgetRuntimeStore || blueprintRuntime ? onPointerDown : undefined}
            onPointerUp={widgetRuntimeStore || blueprintRuntime ? onPointerUp : undefined}
            onPointerCancel={widgetRuntimeStore ? onPointerCancel : undefined}
            onPointerMove={blueprintRuntime ? onPointerMove : undefined}
            onClick={blueprintRuntime ? onClick : undefined}
            onDoubleClick={blueprintRuntime ? onDoubleClick : undefined}
            onContextMenu={blueprintRuntime ? onContextMenu : undefined}
            onFocus={widgetRuntimeStore || blueprintRuntime ? onFocus : undefined}
            onBlur={widgetRuntimeStore || blueprintRuntime ? onBlur : undefined}
        >
            {children}
        </div>
    );
}
