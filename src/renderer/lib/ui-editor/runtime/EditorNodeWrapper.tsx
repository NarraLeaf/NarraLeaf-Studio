import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, FocusEvent, MouseEvent, PointerEvent, WheelEvent } from "react";
import { motion, useAnimationControls, type MotionStyle, type TargetAndTransition } from "motion/react";
import type { UIElement, UILayout } from "@shared/types/ui-editor/document";
import type { UIListItemScope } from "@shared/types/ui-editor/list";
import {
    useWidgetRuntimeElementState,
    useWidgetRuntimeElementKey,
    useWidgetRuntimeStateStore,
} from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { DEFAULT_DISPLAYABLE_BASE_TRANSFORM } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
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
    keyboardInteractive?: boolean;
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

const NOOP_SUBSCRIBE = () => () => {};

export function isElementHoveredByPointer(element: Element | null): boolean {
    if (!element) {
        return false;
    }
    try {
        return element.matches(":hover");
    } catch {
        return false;
    }
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
    keyboardInteractive = interactive,
    useAppearanceInspectorPreview = false,
    listItemScope,
    instanceKey,
    children,
}: EditorNodeWrapperProps) {
    const widgetRuntimeStore = useWidgetRuntimeStateStore();
    const runtimeElementKey = useWidgetRuntimeElementKey(element.id);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const interactionDisabled = Boolean(
        (element.props as { interactionDisabled?: unknown } | undefined)?.interactionDisabled,
    );
    const runtimeElementState = useWidgetRuntimeElementState(element.id, interactionDisabled);
    const displayableMotion = runtimeElementState.displayableMotion;
    // Persistent pose (Displayable offsets / held scale) layered under the one-shot motion slot.
    // Subscribed separately because the per-element state signature does not track it.
    const displayableBaseTransform = useSyncExternalStore(
        widgetRuntimeStore ? widgetRuntimeStore.subscribe : NOOP_SUBSCRIBE,
        () =>
            widgetRuntimeStore
                ? widgetRuntimeStore.getDisplayableBaseTransform(runtimeElementKey)
                : DEFAULT_DISPLAYABLE_BASE_TRANSFORM,
        () =>
            widgetRuntimeStore
                ? widgetRuntimeStore.getDisplayableBaseTransform(runtimeElementKey)
                : DEFAULT_DISPLAYABLE_BASE_TRANSFORM,
    );
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
    // The rest pose every motion starts from and returns to: authored rotation + persistent
    // base transform. Motions replace individual channels while active; anything they leave
    // untouched (and everything after they clear) resolves back to this pose.
    const basePose = useMemo(
        () => ({
            x: displayableBaseTransform.offsetX,
            y: displayableBaseTransform.offsetY,
            scale: displayableBaseTransform.scale,
            rotate: baseRotation,
            opacity: effectiveOpacity,
        }),
        [baseRotation, displayableBaseTransform, effectiveOpacity],
    );

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

    useLayoutEffect(() => {
        if (!widgetRuntimeStore) {
            return undefined;
        }
        if (!interactive || isRoot || interactionDisabled) {
            widgetRuntimeStore.clearHoverIf(runtimeElementKey);
            return undefined;
        }

        const syncMountedHover = () => {
            if (isElementHoveredByPointer(containerRef.current)) {
                widgetRuntimeStore.setHoverTarget(runtimeElementKey);
            }
        };
        syncMountedHover();

        const view = containerRef.current?.ownerDocument.defaultView;
        if (typeof view?.requestAnimationFrame !== "function") {
            return undefined;
        }
        const frameId = view.requestAnimationFrame(syncMountedHover);
        return () => view.cancelAnimationFrame(frameId);
    }, [interactionDisabled, interactive, isRoot, runtimeElementKey, widgetRuntimeStore]);

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
            if (!keyboardInteractive || !blueprintRuntime || eventControl?.isPropagationStopped()) {
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
        [blueprintRuntime, element.id, element.type, eventOptions, keyboardInteractive],
    );

    useEffect(() => {
        if (!keyboardInteractive || !blueprintRuntime || typeof window === "undefined") {
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
    }, [blueprintRuntime, dispatchMountedWidgetEvent, element.type, keyboardInteractive]);

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
        const { x, y, width, height } = layout;
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
        return style;
    }, [effectiveOpacity, layout, isRoot, layoutMode, motionControlsOpacity, styleOverrides, wrapperCursor]);

    // Once an element carries a pose (authored rotation, persistent offsets/scale, or any motion)
    // its transform must be owned by motion-managed style values: a raw `style.transform` string
    // is discarded the moment motion renders its own transform, which silently dropped static
    // rotation after the first animation. The latch keeps the channel stable for the element's
    // lifetime so motion values are never torn down mid-flight.
    const motionPoseLatchRef = useRef(false);
    const hasMotionPose =
        motionPoseLatchRef.current ||
        Boolean(displayableMotion) ||
        displayableBaseTransform !== DEFAULT_DISPLAYABLE_BASE_TRANSFORM ||
        baseRotation !== 0;
    motionPoseLatchRef.current = hasMotionPose;
    const motionStyle: MotionStyle = hasMotionPose
        ? {
              ...containerStyle,
              x: basePose.x,
              y: basePose.y,
              scale: basePose.scale,
              rotate: basePose.rotate,
          }
        : containerStyle;

    const motionAnimate = useMemo(() => {
        if (!displayableMotion) {
            return undefined;
        }
        if (isResetPhase) {
            // One-shot effects hand control back to the persistent pose, not to the raw origin:
            // resetting to {0,0} used to wipe Displayable offsets held in the base transform.
            return { ...basePose };
        }
        return buildDisplayableMotionAnimateTarget(displayableMotion.target, basePose);
    }, [basePose, displayableMotion, isResetPhase]);

    const motionInitial = useMemo(() => {
        if (!displayableMotion) {
            return false;
        }
        if (isResetPhase) {
            return false;
        }
        return buildDisplayableMotionInitialTarget(displayableMotion.target, basePose);
    }, [basePose, displayableMotion, isResetPhase]);

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
    const basePoseRef = useRef(basePose);
    const lastMotionRunKeyRef = useRef<string | null>(null);
    const hasStartedMotionRef = useRef(false);

    useLayoutEffect(() => {
        motionRunConfigRef.current = {
            animate: motionAnimate,
            initial: motionInitial,
            transition: motionTransition,
        };
        basePoseRef.current = basePose;
    }, [basePose, motionAnimate, motionInitial, motionTransition]);

    useLayoutEffect(
        () => () => {
            // StrictMode's simulated unmount kills any in-flight controls animation; forget the
            // last run key so the second mount's effect restarts the motion instead of skipping
            // it via the mid-flight guard below.
            lastMotionRunKeyRef.current = null;
        },
        [],
    );

    useLayoutEffect(() => {
        const { animate, initial, transition } = motionRunConfigRef.current;
        if (!motionRunKey || !animate) {
            lastMotionRunKeyRef.current = null;
            animationControls.stop();
            // A completed/stopped/replaced motion leaves its last frame on the motion values.
            // Snap back to the persistent base pose in the same commit so a layout commit
            // (hold animations fold their delta into left/top) is never painted while the
            // transform still carries that delta (double offset) and later motions start from
            // a clean baseline instead of the stale frame. Skipped until a motion has run:
            // before that the base pose flows in via motion style values.
            if (hasStartedMotionRef.current) {
                animationControls.set({ ...basePoseRef.current } as TargetAndTransition);
            }
            return;
        }
        if (lastMotionRunKeyRef.current === motionRunKey) {
            // Same motion still in flight: a base-pose/opacity change must not restart it.
            // The pose converges when the motion clears (the branch above re-runs then).
            return;
        }
        lastMotionRunKeyRef.current = motionRunKey;
        hasStartedMotionRef.current = true;
        if (initial && !isResetPhase) {
            animationControls.set(initial as TargetAndTransition);
        }
        void animationControls.start({
            ...animate,
            ...(transition ? { transition } : {}),
        } as TargetAndTransition);
    }, [animationControls, basePose, isResetPhase, motionRunKey]);

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
            ref={containerRef}
            data-ui-element-id={interactive ? element.id : undefined}
            className={`${interactive ? "ui-editor-node" : "ui-editor-node-preview"} ${isRoot ? "ui-editor-node-root" : ""}`}
            style={motionStyle}
            initial={false}
            // Bind the controls unconditionally: the reset-to-base set() above must still reach
            // the element after its motion has been cleared from the store.
            animate={animationControls}
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
