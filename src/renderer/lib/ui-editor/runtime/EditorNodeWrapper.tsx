import React, { useCallback, useMemo } from "react";
import type { CSSProperties, FocusEvent, MouseEvent, PointerEvent, WheelEvent } from "react";
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

function eventTargetNode(target: EventTarget | null, ownerDocument: Document): Node | null {
    if (!target) {
        return null;
    }
    if (typeof Node !== "undefined" && target instanceof Node) {
        return target;
    }
    const viewNode = ownerDocument.defaultView?.Node;
    if (viewNode && target instanceof viewNode) {
        return target;
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
        (eventName: string, target: EventTarget | null, payload?: Record<string, unknown>) => {
            if (!blueprintRuntime || !isDirectElementEvent(target)) {
                return false;
            }
            if (!getWidgetLogicEvent(element.type, eventName)) {
                return false;
            }
            void blueprintRuntime.dispatchElementBlueprintEvent(element.id, eventName, payload);
            return true;
        },
        [blueprintRuntime, element.id, element.type, isDirectElementEvent],
    );

    const localMousePayload = useCallback(
        (
            e:
                | MouseEvent<HTMLDivElement>
                | PointerEvent<HTMLDivElement>
                | WheelEvent<HTMLDivElement>,
        ): Record<string, number> => {
            const rect = e.currentTarget.getBoundingClientRect();
            const width = Math.max(1, Math.abs(layout.width));
            const height = Math.max(1, Math.abs(layout.height));
            const scaleX = rect.width > 0 ? width / rect.width : 1;
            const scaleY = rect.height > 0 ? height / rect.height : 1;
            return {
                x: (e.clientX - rect.left) * scaleX,
                y: (e.clientY - rect.top) * scaleY,
            };
        },
        [layout.height, layout.width],
    );

    const onPointerEnter = useCallback((e: PointerEvent<HTMLDivElement>) => {
        widgetRuntimeStore?.setHoverTarget(element.id);
        dispatchWidgetEvent("mouseEnter", e.target, localMousePayload(e));
    }, [dispatchWidgetEvent, localMousePayload, widgetRuntimeStore, element.id]);

    const onPointerLeave = useCallback(
        (e: PointerEvent<HTMLDivElement>) => {
            if (!widgetRuntimeStore) {
                dispatchWidgetEvent("mouseLeave", e.target, localMousePayload(e));
                return;
            }
            const related = e.relatedTarget;
            const relatedNode = eventTargetNode(related, e.currentTarget.ownerDocument);
            if (!relatedNode || !e.currentTarget.contains(relatedNode)) {
                widgetRuntimeStore.clearHoverIf(element.id);
                widgetRuntimeStore.setActivePointerTarget(null);
                dispatchWidgetEvent("mouseLeave", e.target, localMousePayload(e));
            }
        },
        [dispatchWidgetEvent, localMousePayload, widgetRuntimeStore, element.id],
    );

    const onPointerDown = useCallback(
        (e: PointerEvent<HTMLDivElement>) => {
            if (isDirectElementEvent(e.target)) {
                widgetRuntimeStore?.setActivePointerTarget(element.id);
            }
            dispatchWidgetEvent("mouseDown", e.target, { ...localMousePayload(e), button: e.button });
        },
        [dispatchWidgetEvent, isDirectElementEvent, localMousePayload, widgetRuntimeStore, element.id],
    );

    const onPointerUp = useCallback(
        (e: PointerEvent<HTMLDivElement>) => {
            if (isDirectElementEvent(e.target)) {
                widgetRuntimeStore?.setActivePointerTarget(null);
            }
            dispatchWidgetEvent("mouseUp", e.target, { ...localMousePayload(e), button: e.button });
        },
        [dispatchWidgetEvent, isDirectElementEvent, localMousePayload, widgetRuntimeStore],
    );

    const onPointerCancel = useCallback(() => {
        widgetRuntimeStore?.setActivePointerTarget(null);
    }, [widgetRuntimeStore]);

    const onPointerMove = useCallback(
        (e: PointerEvent<HTMLDivElement>) => {
            dispatchWidgetEvent("mouseMove", e.target, localMousePayload(e));
        },
        [dispatchWidgetEvent, localMousePayload],
    );

    const onClick = useCallback(
        (e: MouseEvent<HTMLDivElement>) => {
            dispatchWidgetEvent("mouseClick", e.target, localMousePayload(e));
        },
        [dispatchWidgetEvent, localMousePayload],
    );

    const onDoubleClick = useCallback(
        (e: MouseEvent<HTMLDivElement>) => {
            dispatchWidgetEvent("mouseDoubleClick", e.target, localMousePayload(e));
        },
        [dispatchWidgetEvent, localMousePayload],
    );

    const onContextMenu = useCallback(
        (e: MouseEvent<HTMLDivElement>) => {
            if (dispatchWidgetEvent("rightClick", e.target, localMousePayload(e))) {
                e.preventDefault();
            }
        },
        [dispatchWidgetEvent, localMousePayload],
    );

    const onWheel = useCallback(
        (e: WheelEvent<HTMLDivElement>) => {
            dispatchWidgetEvent("mouseWheel", e.target, {
                ...localMousePayload(e),
                deltaX: e.deltaX,
                deltaY: e.deltaY,
            });
        },
        [dispatchWidgetEvent, localMousePayload],
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
            onWheel={blueprintRuntime ? onWheel : undefined}
            onFocus={widgetRuntimeStore || blueprintRuntime ? onFocus : undefined}
            onBlur={widgetRuntimeStore || blueprintRuntime ? onBlur : undefined}
        >
            {children}
        </div>
    );
}
