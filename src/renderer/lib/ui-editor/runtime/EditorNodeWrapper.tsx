import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FocusEvent, MouseEvent, PointerEvent, WheelEvent } from "react";
import { motion, useAnimationControls, type TargetAndTransition } from "motion/react";
import type { UIElement, UILayout } from "@shared/types/ui-editor/document";
import type { UIListItemScope } from "@shared/types/ui-editor/list";
import {
    useWidgetRuntimeElementState,
    useWidgetRuntimeElementKey,
    useWidgetRuntimeStateStore,
} from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import {
    buildDisplayableMotionAnimateTarget,
    buildDisplayableMotionInitialTarget,
    toDisplayableMotionTransition,
} from "@/lib/ui-editor/runtime/displayableMotion";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import type { BehaviorGraphEventControl } from "@/lib/ui-editor/behavior-graph/BehaviorNodeRegistry";
import { getOrCreateDomEventPropagationControl } from "@/lib/ui-editor/runtime/eventPropagationControl";
import { getWidgetLogicEvent } from "@shared/types/ui-editor/widgetLogic";
import { shouldHandleBlueprintElementEvent } from "./blueprintEventTargeting";
import { useEditorAppearanceInspectorVariant } from "@/lib/ui-editor/hooks/useEditorAppearanceInspectorVariant";
import {
    type AppearanceResolveContext,
    resolveButtonCursor,
    resolveButtonVisualProps,
    resolveAppearanceDisplayableOpacity,
    resolveImageDisplayableOpacityKeys,
} from "@/lib/ui-editor/runtime/appearance/AppearanceResolver";
import type { AppearanceModel } from "@shared/types/ui-editor/appearance";

export type EditorNodeLayoutMode = "absolute" | "flow";

type EditorNodeWrapperProps = {
    element: UIElement;
    layout: UILayout;
    isRoot?: boolean;
    /** Flow children are laid out by a flex parent (`nl.container` stack/scroll or `nl.list`); skip absolute x/y. */
    layoutMode?: EditorNodeLayoutMode;
    styleOverrides?: CSSProperties;
    hasRuntimeOpacityOverride?: boolean;
    hostAdapter?: UIHostAdapter;
    interactive?: boolean;
    useAppearanceInspectorPreview?: boolean;
    listItemScope?: UIListItemScope | null;
    instanceKey?: string;
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

function keyboardEventPayload(event: KeyboardEvent): Record<string, unknown> {
    return {
        key: event.key,
        code: event.code,
        repeat: event.repeat,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
    };
}

function displayableOpacityKeysForElement(
    element: UIElement,
    appearance: AppearanceModel | null | undefined,
    ctx: AppearanceResolveContext,
): readonly string[] {
    return element.type === "nl.image"
        ? resolveImageDisplayableOpacityKeys(element, appearance, ctx)
        : ["transformOpacity"];
}

export function EditorNodeWrapper({
    element,
    layout,
    isRoot = false,
    layoutMode = "absolute",
    styleOverrides,
    hasRuntimeOpacityOverride = false,
    hostAdapter,
    interactive = true,
    useAppearanceInspectorPreview = false,
    listItemScope,
    instanceKey,
    children,
}: EditorNodeWrapperProps) {
    const widgetRuntimeStore = useWidgetRuntimeStateStore();
    const runtimeElementKey = useWidgetRuntimeElementKey(element.id);
    const interactionDisabled = Boolean(
        (element.props as { interactionDisabled?: unknown } | undefined)?.interactionDisabled,
    );
    const runtimeElementState = useWidgetRuntimeElementState(element.id, interactionDisabled);
    const displayableMotion = runtimeElementState.displayableMotion;
    const animationControls = useAnimationControls();
    const [resetMotionId, setResetMotionId] = useState<string | null>(null);
    const blueprintRuntime = hostAdapter?.blueprintRuntime;
    const inspectorVariantId = useEditorAppearanceInspectorVariant(element.id, useAppearanceInspectorPreview === true);
    const appearance = (element.props as { appearance?: AppearanceModel | null } | undefined)?.appearance;
    const listScopedVariantId =
        typeof (element.extra as { runtimeVariantOverrideId?: unknown } | undefined)?.runtimeVariantOverrideId === "string"
            ? String((element.extra as { runtimeVariantOverrideId?: unknown }).runtimeVariantOverrideId)
            : null;
    const appearanceResolveCtx = {
        variantOverrideId: listScopedVariantId ?? runtimeElementState.variantOverrideId ?? inspectorVariantId ?? null,
        signals: runtimeElementState.signals,
    };
    const appearanceOpacity = resolveAppearanceDisplayableOpacity(
        appearance,
        {
            ...appearanceResolveCtx,
            displayableOpacityKeys: displayableOpacityKeysForElement(element, appearance, appearanceResolveCtx),
        },
    );
    const wrapperCursor: CSSProperties["cursor"] | undefined = (() => {
        if (element.type !== "nl.button") {
            return undefined;
        }
        const visual = resolveButtonVisualProps(element, appearance, appearanceResolveCtx);
        const canDispatchClick = Boolean(interactive && blueprintRuntime && !interactionDisabled);
        return resolveButtonCursor(visual.cursor, interactionDisabled, canDispatchClick);
    })();
    const layoutOpacity = layout.opacity ?? 1;
    const effectiveOpacity = hasRuntimeOpacityOverride ? layoutOpacity : appearanceOpacity ?? layoutOpacity;
    const baseRotation = layout.rotation ?? 0;
    const isResetPhase = Boolean(displayableMotion?.resetOnComplete && resetMotionId === displayableMotion.id);
    const motionControlsOpacity = displayableMotion?.target.opacity !== undefined;

    useEffect(() => {
        if (resetMotionId !== null && (!displayableMotion || resetMotionId !== displayableMotion.id)) {
            setResetMotionId(null);
        }
    }, [displayableMotion, resetMotionId]);
    const eventOptions = useMemo(
        () =>
            listItemScope || instanceKey
                ? {
                      listItemScope: listItemScope ?? null,
                      instanceKey,
                  }
                : undefined,
        [instanceKey, listItemScope],
    );

    const isDirectElementEvent = useCallback(
        (target: EventTarget | null) => shouldHandleBlueprintElementEvent(target, element.id),
        [element.id],
    );

    const dispatchWidgetEvent = useCallback(
        (
            eventName: string,
            target: EventTarget | null,
            payload?: Record<string, unknown>,
            eventControl?: BehaviorGraphEventControl,
        ) => {
            if (!interactive || !blueprintRuntime || eventControl?.isPropagationStopped() || !isDirectElementEvent(target)) {
                return false;
            }
            if (!getWidgetLogicEvent(element.type, eventName)) {
                return false;
            }
            void blueprintRuntime.dispatchElementBlueprintEvent(
                element.id,
                eventName,
                payload,
                eventControl ? { ...(eventOptions ?? {}), eventControl } : eventOptions,
            );
            return true;
        },
        [blueprintRuntime, element.id, element.type, eventOptions, interactive, isDirectElementEvent],
    );

    const dispatchMountedWidgetEvent = useCallback(
        (eventName: string, payload?: Record<string, unknown>, eventControl?: BehaviorGraphEventControl) => {
            if (!interactive || !blueprintRuntime || eventControl?.isPropagationStopped()) {
                return false;
            }
            if (!getWidgetLogicEvent(element.type, eventName)) {
                return false;
            }
            void blueprintRuntime.dispatchElementBlueprintEvent(
                element.id,
                eventName,
                payload,
                eventControl ? { ...(eventOptions ?? {}), eventControl } : eventOptions,
            );
            return true;
        },
        [blueprintRuntime, element.id, element.type, eventOptions, interactive],
    );

    useEffect(() => {
        if (!interactive || !blueprintRuntime || typeof window === "undefined") {
            return undefined;
        }
        const canDispatchKeyDown = Boolean(getWidgetLogicEvent(element.type, "keyDown"));
        const canDispatchKeyUp = Boolean(getWidgetLogicEvent(element.type, "keyUp"));
        if (!canDispatchKeyDown && !canDispatchKeyUp) {
            return undefined;
        }

        const onKeyDown = (event: KeyboardEvent) => {
            const eventControl = getOrCreateDomEventPropagationControl(event);
            if (canDispatchKeyDown) {
                dispatchMountedWidgetEvent("keyDown", keyboardEventPayload(event), eventControl);
            }
        };
        const onKeyUp = (event: KeyboardEvent) => {
            const eventControl = getOrCreateDomEventPropagationControl(event);
            if (canDispatchKeyUp) {
                dispatchMountedWidgetEvent("keyUp", keyboardEventPayload(event), eventControl);
            }
        };

        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
        };
    }, [blueprintRuntime, dispatchMountedWidgetEvent, element.type, interactive]);

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
        widgetRuntimeStore?.setHoverTarget(runtimeElementKey);
        dispatchWidgetEvent("mouseEnter", e.target, localMousePayload(e), getOrCreateDomEventPropagationControl(e.nativeEvent));
    }, [dispatchWidgetEvent, isDirectElementEvent, localMousePayload, runtimeElementKey, widgetRuntimeStore]);

    const onPointerLeave = useCallback(
        (e: PointerEvent<HTMLDivElement>) => {
            if (!widgetRuntimeStore) {
                dispatchWidgetEvent("mouseLeave", e.target, localMousePayload(e), getOrCreateDomEventPropagationControl(e.nativeEvent));
                return;
            }
            const related = e.relatedTarget;
            const relatedNode = eventTargetNode(related, e.currentTarget.ownerDocument);
            if (!relatedNode || !e.currentTarget.contains(relatedNode)) {
                widgetRuntimeStore.clearHoverIf(runtimeElementKey);
                widgetRuntimeStore.setActivePointerTarget(null);
                dispatchWidgetEvent("mouseLeave", e.target, localMousePayload(e), getOrCreateDomEventPropagationControl(e.nativeEvent));
            }
        },
        [dispatchWidgetEvent, localMousePayload, runtimeElementKey, widgetRuntimeStore],
    );

    const onPointerDown = useCallback(
        (e: PointerEvent<HTMLDivElement>) => {
            if (isDirectElementEvent(e.target)) {
                widgetRuntimeStore?.setActivePointerTarget(runtimeElementKey);
            }
            dispatchWidgetEvent(
                "mouseDown",
                e.target,
                { ...localMousePayload(e), button: e.button },
                getOrCreateDomEventPropagationControl(e.nativeEvent),
            );
        },
        [dispatchWidgetEvent, isDirectElementEvent, localMousePayload, runtimeElementKey, widgetRuntimeStore],
    );

    const onPointerUp = useCallback(
        (e: PointerEvent<HTMLDivElement>) => {
            if (isDirectElementEvent(e.target)) {
                widgetRuntimeStore?.setActivePointerTarget(null);
            }
            dispatchWidgetEvent(
                "mouseUp",
                e.target,
                { ...localMousePayload(e), button: e.button },
                getOrCreateDomEventPropagationControl(e.nativeEvent),
            );
        },
        [dispatchWidgetEvent, isDirectElementEvent, localMousePayload, widgetRuntimeStore],
    );

    const onPointerCancel = useCallback(() => {
        widgetRuntimeStore?.setActivePointerTarget(null);
    }, [widgetRuntimeStore]);

    const onPointerMove = useCallback(
        (e: PointerEvent<HTMLDivElement>) => {
            dispatchWidgetEvent("mouseMove", e.target, localMousePayload(e), getOrCreateDomEventPropagationControl(e.nativeEvent));
        },
        [dispatchWidgetEvent, localMousePayload],
    );

    const onClick = useCallback(
        (e: MouseEvent<HTMLDivElement>) => {
            dispatchWidgetEvent(
                "mouseClick",
                e.target,
                { ...localMousePayload(e), button: e.button },
                getOrCreateDomEventPropagationControl(e.nativeEvent),
            );
        },
        [dispatchWidgetEvent, localMousePayload],
    );

    const onDoubleClick = useCallback(
        (e: MouseEvent<HTMLDivElement>) => {
            dispatchWidgetEvent("mouseDoubleClick", e.target, localMousePayload(e), getOrCreateDomEventPropagationControl(e.nativeEvent));
        },
        [dispatchWidgetEvent, localMousePayload],
    );

    const onContextMenu = useCallback(
        (e: MouseEvent<HTMLDivElement>) => {
            if (dispatchWidgetEvent("rightClick", e.target, localMousePayload(e), getOrCreateDomEventPropagationControl(e.nativeEvent))) {
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
            }, getOrCreateDomEventPropagationControl(e.nativeEvent));
        },
        [dispatchWidgetEvent, localMousePayload],
    );

    const onFocus = useCallback(
        (e: FocusEvent<HTMLDivElement>) => {
            if (isDirectElementEvent(e.target)) {
                widgetRuntimeStore?.setFocusedTarget(runtimeElementKey);
            }
            dispatchWidgetEvent("focus", e.target, undefined, getOrCreateDomEventPropagationControl(e.nativeEvent));
        },
        [dispatchWidgetEvent, isDirectElementEvent, runtimeElementKey, widgetRuntimeStore],
    );

    const onBlur = useCallback(
        (e: FocusEvent<HTMLDivElement>) => {
            if (isDirectElementEvent(e.target)) {
                widgetRuntimeStore?.setFocusedTarget(null);
            }
            dispatchWidgetEvent("blur", e.target, undefined, getOrCreateDomEventPropagationControl(e.nativeEvent));
        },
        [dispatchWidgetEvent, isDirectElementEvent, widgetRuntimeStore],
    );

    const containerStyle = useMemo<CSSProperties>(() => {
        const { x, y, width, height, rotation } = layout;
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
            opacity: motionControlsOpacity ? undefined : effectiveOpacity,
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
        if (wrapperCursor) {
            style.cursor = wrapperCursor;
        }
        if (rotation && !displayableMotion) {
            const transforms = [];
            if (rotation) {
                transforms.push(`rotate(${rotation}deg)`);
            }
            style.transform = transforms.join(" ");
            style.transformOrigin = "center center";
        }
        return style;
    }, [displayableMotion, effectiveOpacity, layout, isRoot, layoutMode, motionControlsOpacity, styleOverrides, wrapperCursor]);

    const motionAnimate = useMemo(() => {
        if (!displayableMotion) {
            return undefined;
        }
        if (isResetPhase) {
            return {
                x: 0,
                y: 0,
                scale: 1,
                rotate: baseRotation,
                opacity: effectiveOpacity,
            };
        }
        const target = displayableMotion.target;
        return buildDisplayableMotionAnimateTarget(target, {
            x: 0,
            y: 0,
            scale: 1,
            rotate: baseRotation,
            opacity: effectiveOpacity,
        });
    }, [baseRotation, displayableMotion, effectiveOpacity, isResetPhase]);

    const motionInitial = useMemo(() => {
        if (!displayableMotion) {
            return false;
        }
        if (isResetPhase) {
            return false;
        }
        return buildDisplayableMotionInitialTarget(displayableMotion.target, {
            x: 0,
            y: 0,
            scale: 1,
            rotate: baseRotation,
            opacity: effectiveOpacity,
        });
    }, [baseRotation, displayableMotion, effectiveOpacity, isResetPhase]);

    const motionTransition = useMemo(
        () => (displayableMotion ? toDisplayableMotionTransition(displayableMotion.transition) : undefined),
        [displayableMotion],
    );
    const motionRunConfigRef = useRef<{
        animate: Record<string, number | number[]> | undefined;
        initial: Record<string, number> | false;
        transition: Record<string, unknown> | undefined;
    }>({
        animate: motionAnimate,
        initial: motionInitial,
        transition: motionTransition,
    });
    const motionRunKey = displayableMotion ? `${displayableMotion.id}:${isResetPhase ? "reset" : "run"}` : null;

    useEffect(() => {
        motionRunConfigRef.current = {
            animate: motionAnimate,
            initial: motionInitial,
            transition: motionTransition,
        };
    }, [motionAnimate, motionInitial, motionTransition]);

    useEffect(() => {
        const { animate, initial, transition } = motionRunConfigRef.current;
        if (!motionRunKey || !animate) {
            animationControls.stop();
            return;
        }
        if (initial && !isResetPhase) {
            animationControls.set(initial as TargetAndTransition);
        }
        void animationControls.start({
            ...animate,
            ...(transition ? { transition } : {}),
        } as TargetAndTransition);
    }, [animationControls, isResetPhase, motionRunKey]);

    const onAnimationComplete = useCallback(() => {
        if (!displayableMotion?.resetOnComplete) {
            return;
        }
        if (!isResetPhase) {
            setResetMotionId(displayableMotion.id);
            return;
        }
        widgetRuntimeStore?.completeDisplayableMotion(runtimeElementKey, displayableMotion.id);
        setResetMotionId(null);
    }, [displayableMotion, isResetPhase, runtimeElementKey, widgetRuntimeStore]);

    return (
        <motion.div
            data-ui-element-id={interactive ? element.id : undefined}
            className={`${interactive ? "ui-editor-node" : "ui-editor-node-preview"} ${isRoot ? "ui-editor-node-root" : ""}`}
            style={containerStyle}
            initial={false}
            animate={displayableMotion ? animationControls : undefined}
            onAnimationComplete={onAnimationComplete}
            onPointerEnter={interactive && (widgetRuntimeStore || blueprintRuntime) ? onPointerEnter : undefined}
            onPointerLeave={interactive && (widgetRuntimeStore || blueprintRuntime) ? onPointerLeave : undefined}
            onPointerDown={interactive && (widgetRuntimeStore || blueprintRuntime) ? onPointerDown : undefined}
            onPointerUp={interactive && (widgetRuntimeStore || blueprintRuntime) ? onPointerUp : undefined}
            onPointerCancel={interactive && widgetRuntimeStore ? onPointerCancel : undefined}
            onPointerMove={interactive && blueprintRuntime ? onPointerMove : undefined}
            onClick={interactive && blueprintRuntime ? onClick : undefined}
            onDoubleClick={interactive && blueprintRuntime ? onDoubleClick : undefined}
            onContextMenu={interactive && blueprintRuntime ? onContextMenu : undefined}
            onWheel={interactive && blueprintRuntime ? onWheel : undefined}
            onFocus={interactive && (widgetRuntimeStore || blueprintRuntime) ? onFocus : undefined}
            onBlur={interactive && (widgetRuntimeStore || blueprintRuntime) ? onBlur : undefined}
        >
            {children}
        </motion.div>
    );
}
