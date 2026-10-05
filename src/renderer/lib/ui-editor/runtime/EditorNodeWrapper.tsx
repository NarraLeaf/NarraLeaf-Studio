import React, {
    useCallback,
    useContext,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
} from "react";
import type { CSSProperties, FocusEvent, MouseEvent, PointerEvent, WheelEvent } from "react";
import { MotionConfigContext } from "motion/react";
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
import { readInputEventTime, wheelGestureGate } from "@/lib/ui-editor/runtime/input/wheelGesture";
import { isTouchStrokeInFlight } from "@/lib/ui-editor/runtime/input/touchGesture";
import { getWidgetLogicEvent, isPointerPositionElementEvent } from "@shared/types/ui-editor/widgetLogic";
import { shouldHandleBlueprintElementEvent } from "./blueprintEventTargeting";
import { bindWidgetEventDispatch } from "./widgetEventDispatch";
import { NodeWrapperMotionDriver, nodeWrapperTransform, type NodeWrapperPose } from "./nodeWrapperMotion";
import { uiDrawingAttributeValue } from "./surfaceMeasurement";
import { localPointerPoint, readElementPointerPositions } from "./elementPointerPosition";
import { isTextEntryTarget } from "./app/isTextEntryTarget";
import { offerUIElementHoverSound, playUIElementInteractionSound } from "./interactionSounds";
import { readUIInteractionSoundAssetId } from "@shared/types/ui-editor/interactionSounds";
import { EnteredStateProvider, variantOverrideIdFor } from "@/lib/ui-editor/hooks/enteredStateContext";
import type { UIStateMotionOffset } from "@shared/types/ui-editor/stateMotion";
import { firstTransitionForKeys } from "@/lib/ui-editor/widget-modules/shared/appearance/runtimeMotionHelpers";
import { toRuntimeMotionTransition } from "@/lib/ui-editor/widget-modules/shared/appearance/appearanceMotion";
import { useSurfaceTreeInteractivity } from "@/lib/ui-editor/runtime/surface/surfaceTreeContext";

/** Shared so an element with no offsets keeps one object identity and never re-poses on it. */
const ZERO_APPEARANCE_OFFSETS = { x: 0, y: 0 };
import { useEnteredElementState } from "@/lib/ui-editor/hooks/useEnteredElementState";
import {
    type AppearanceResolveContext,
    resolveButtonCursor,
    resolveButtonVisualProps,
    resolveAppearanceDisplayableOpacity,
    resolveAppearanceTransformOffsets,
    resolveContainerAppearanceTransitions,
    resolveImageDisplayableOpacityKeys,
} from "@/lib/ui-editor/runtime/appearance/AppearanceResolver";
import type { AppearanceModel } from "@shared/types/ui-editor/appearance";

export type EditorNodeLayoutMode = "absolute" | "flow";

type EditorNodeWrapperProps = {
    element: UIElement;
    layout: UILayout;
    isRoot?: boolean;
    /**
     * This root is a component definition's root, not a Surface's.
     *
     * A Surface root is click-through by rule: it is the whole screen, and letting it take presses
     * would put a transparent sheet over the game. A component's root is the opposite - it is one
     * widget an author placed, often the pressable one itself - and it arrives here as a root only
     * because the definition is rendered as a tree of its own. Without this the rule meant for the
     * screen was applied to a button, and a card whose root carried the click answered nothing.
     */
    isComponentRoot?: boolean;
    /** Flow children are laid out by a flex parent (`nl.container` stack/scroll or `nl.list`); skip absolute x/y. */
    layoutMode?: EditorNodeLayoutMode;
    styleOverrides?: CSSProperties;
    hasRuntimeOpacityOverride?: boolean;
    hostAdapter?: UIHostAdapter;
    /**
     * Whether this node may take pointer / keyboard input at all. What it takes is this AND the
     * enclosing tree's interactivity, which changes for the whole tree at once and so is read from
     * context rather than handed to every wrapper (see `surfaceTreeContext`). Outside a tree the
     * context says yes, and these alone decide.
     */
    interactive?: boolean;
    keyboardInteractive?: boolean;
    useAppearanceInspectorPreview?: boolean;
    listItemScope?: UIListItemScope | null;
    instanceKey?: string;
    /**
     * The component definition this element is authored in, or nothing when it is on a Surface.
     *
     * Beside the params rather than derivable from them: what an event needs it for is finding the
     * blueprint that answers, and a definition that declares no params still has one. Without it a
     * component's widgets heard nothing - the init lifecycle below was handed the id directly and
     * worked, while every pointer event looked for a Surface blueprint that does not exist.
     */
    componentId?: string;
    /** Resolved params of the component instance this element belongs to; null outside one. */
    componentParams?: Record<string, string> | null;
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

/** A press on an element, as the events that bubble carry it to the elements above. */
type PointerPress = { hit: Element; clientX: number; clientY: number };

function pointerPressOf(e: { currentTarget: Element; clientX: number; clientY: number }): PointerPress {
    return { hit: e.currentTarget, clientX: e.clientX, clientY: e.clientY };
}

/** What a node wrapper keeps about its motion between commits; one object, made once per wrapper. */
type NodeMotionState = {
    /** Writes the channels once anything has animated them; null while React writes all of them. */
    driver: NodeWrapperMotionDriver | null;
    /** What React was last handed for each channel the driver has taken, so React never writes it again. */
    handedOver: {
        left: CSSProperties["left"];
        top: CSSProperties["top"];
        transform?: { value: CSSProperties["transform"] };
        opacity?: { value: CSSProperties["opacity"] };
    } | null;
    /** The resting pose the latest commit put on screen. */
    committedPose: NodeWrapperPose | null;
    /** The one before it, which is what a channel taken over in this commit starts moving from. */
    startPose: NodeWrapperPose | null;
    mounted: boolean;
    /** The completion handler as of the latest commit: a finishing motion reports to that one. */
    onComplete: () => void;
};

function createNodeMotionState(): NodeMotionState {
    return {
        driver: null,
        handedOver: null,
        committedPose: null,
        startPose: null,
        mounted: false,
        onComplete: () => {},
    };
}

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
    isComponentRoot = false,
    layoutMode = "absolute",
    styleOverrides,
    hasRuntimeOpacityOverride = false,
    hostAdapter,
    interactive: ownInteractive = true,
    keyboardInteractive: ownKeyboardInteractive = ownInteractive,
    useAppearanceInspectorPreview = false,
    listItemScope,
    instanceKey,
    componentId,
    componentParams,
    children,
}: EditorNodeWrapperProps) {
    const treeInteractivity = useSurfaceTreeInteractivity();
    const interactive = ownInteractive && treeInteractivity.interactive;
    const keyboardInteractive = ownKeyboardInteractive && treeInteractivity.keyboardInteractive;
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
    const [resetMotionId, setResetMotionId] = useState<string | null>(null);
    const blueprintRuntime = hostAdapter?.blueprintRuntime;
    const enteredState = useEnteredElementState(element.id, useAppearanceInspectorPreview === true);
    // Only the element the state was entered on says so; the broadcast below carries the state
    // itself, not where it came from.
    const isEnteredHere = enteredState?.own === true && interactive;
    const broadcastState = useMemo(
        () => (enteredState ? { variantId: enteredState.variantId } : null),
        [enteredState],
    );
    /**
     * Which state this element is being shown in, as a value that changes only when the state does.
     *
     * The offsets below move for two different reasons and only one of them is a trip: the element
     * changed state, or the author changed where it sits *in* the state they are already looking at.
     * Empty outside the editor, where nothing is ever entered and every move of an offset is the
     * widget changing state - which is the trip the player is meant to see.
     */
    const enteredStateKey = enteredState ? `v:${enteredState.variantId ?? ""}` : "";
    const appearance = (element.props as { appearance?: AppearanceModel | null } | undefined)?.appearance;
    const listScopedVariantId =
        typeof (element.extra as { runtimeVariantOverrideId?: unknown } | undefined)?.runtimeVariantOverrideId === "string"
            ? String((element.extra as { runtimeVariantOverrideId?: unknown }).runtimeVariantOverrideId)
            : null;
    const appearanceResolveCtx = {
        variantOverrideId: variantOverrideIdFor(enteredState, listScopedVariantId, runtimeElementState.variantOverrideId),
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
    // While a state is entered, this node carries the offsets the element is drawn at, and the widget
    // inside it draws at zero. The editor selects, measures and snaps to *this* node, so an offset
    // living on a layer inside it leaves the selection frame and the handles behind at the position
    // the element rests in - visibly detached from the element the author is dragging.
    // What the parent widget hands down for the state it is in. It outranks the appearance path
    // because it *is* the state's motion; the appearance offsets are the older shape, still read for
    // documents written before state motions existed.
    const handedMotionOffset = (element.extra as { stateMotionOffset?: UIStateMotionOffset } | undefined)
        ?.stateMotionOffset;
    const resolvedEnteredOffsets = handedMotionOffset
        ? { x: handedMotionOffset.x, y: handedMotionOffset.y }
        : enteredState
          ? resolveAppearanceTransformOffsets(appearance, appearanceResolveCtx)
          : ZERO_APPEARANCE_OFFSETS;
    const enteredOffsetsInFlow = !isRoot && layoutMode === "flow";
    const enteredOffsets = useMemo(
        () => (enteredOffsetsInFlow ? resolvedEnteredOffsets : ZERO_APPEARANCE_OFFSETS),
        // By value: a fresh object every render would restart the animation below on every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [enteredOffsetsInFlow, resolvedEnteredOffsets.x, resolvedEnteredOffsets.y],
    );
    /** Carried by placement; a flow child has none of its own, so it keeps the transform channel. */
    const placedEnteredOffsets = useMemo(
        () => (enteredOffsetsInFlow ? ZERO_APPEARANCE_OFFSETS : resolvedEnteredOffsets),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [enteredOffsetsInFlow, resolvedEnteredOffsets.x, resolvedEnteredOffsets.y],
    );
    // How that offset moves is the author's own setting on the field, the same one the running game
    // uses. Held in a ref rather than a dependency because resolving it allocates a context object
    // every render, and a new identity would restart the animation mid-flight.
    const enteredOffsetTransitionRef = useRef<Record<string, unknown> | null>(null);
    enteredOffsetTransitionRef.current = (() => {
        if (handedMotionOffset) {
            return {
                type: "tween",
                duration: Math.max(0, handedMotionOffset.durationMs) / 1000,
                ease: handedMotionOffset.easing,
            };
        }
        if (!enteredState) {
            return null;
        }
        const transition = firstTransitionForKeys(
            resolveContainerAppearanceTransitions(appearance, appearanceResolveCtx),
            ["transformOffsetX", "transformOffsetY"],
        );
        return transition ? toRuntimeMotionTransition(transition) : null;
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
            x: displayableBaseTransform.offsetX + enteredOffsets.x,
            y: displayableBaseTransform.offsetY + enteredOffsets.y,
            scale: displayableBaseTransform.scale,
            rotate: baseRotation,
            opacity: effectiveOpacity,
        }),
        [baseRotation, displayableBaseTransform, effectiveOpacity, enteredOffsets.x, enteredOffsets.y],
    );

    useEffect(() => {
        if (resetMotionId !== null && (!displayableMotion || resetMotionId !== displayableMotion.id)) {
            setResetMotionId(null);
        }
    }, [displayableMotion, resetMotionId]);
    // The element tree resolves component params afresh on every render, so its object identity
    // moves even when the values did not. Keying the memo on the signature keeps the dispatch - and
    // therefore the handlers built from it - stable across those renders; when two signatures match,
    // the captured object holds the same values by construction.
    //
    // The same binding the renderer inside this node is handed as `dispatchEvent`, so a pointer
    // event and an event the widget raises itself name the drawing the same way.
    const componentParamsSig = componentParams ? JSON.stringify(componentParams) : "";
    const dispatchInDrawing = useMemo(
        () => bindWidgetEventDispatch(blueprintRuntime, element.id, { listItemScope, instanceKey, componentId, componentParams }),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- componentParamsSig stands in for componentParams
        [blueprintRuntime, componentId, componentParamsSig, element.id, instanceKey, listItemScope],
    );

    const isDirectElementEvent = useCallback(
        (target: EventTarget | null) => shouldHandleBlueprintElementEvent(target, element.id),
        [element.id],
    );

    useLayoutEffect(() => {
        if (!widgetRuntimeStore) {
            return undefined;
        }
        if (!interactive || (isRoot && !isComponentRoot) || interactionDisabled) {
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
    }, [interactionDisabled, interactive, isComponentRoot, isRoot, runtimeElementKey, widgetRuntimeStore]);

    const dispatchWidgetEvent = useCallback(
        (
            eventName: string,
            target: EventTarget | null,
            payload?: Record<string, unknown>,
            eventControl?: BehaviorGraphEventControl,
            /**
             * The press, for an event that bubbles: the element that was hit and where. Read into a
             * point per element only once this element has turned out to be the one dispatching.
             */
            pressedAt?: PointerPress,
        ) => {
            if (!interactive || !blueprintRuntime || eventControl?.isPropagationStopped() || !isDirectElementEvent(target)) {
                return false;
            }
            // A type that never declares this event still has to hand a pointer event on. The walk
            // up the document tree that lets a container hear a click or a wheel over the list,
            // slider or text input inside it lives in the dispatcher, and only runs once the event
            // has been dispatched - so returning here swallowed it instead. An element with no
            // listener kept an event it had no way to listen for, which is the very case the
            // bubbling rule exists to cover.
            if (!getWidgetLogicEvent(element.type, eventName) && !isPointerPositionElementEvent(eventName)) {
                return false;
            }
            const pointerPositions = pressedAt
                ? readElementPointerPositions(pressedAt.hit, pressedAt.clientX, pressedAt.clientY)
                : undefined;
            void dispatchInDrawing(
                eventName,
                payload,
                eventControl || pointerPositions ? { eventControl, pointerPositions } : undefined,
            );
            return true;
        },
        [blueprintRuntime, dispatchInDrawing, element.type, interactive, isDirectElementEvent],
    );

    const dispatchMountedWidgetEvent = useCallback(
        (eventName: string, payload?: Record<string, unknown>, eventControl?: BehaviorGraphEventControl) => {
            if (!keyboardInteractive || !blueprintRuntime || eventControl?.isPropagationStopped()) {
                return false;
            }
            if (!getWidgetLogicEvent(element.type, eventName)) {
                return false;
            }
            void dispatchInDrawing(eventName, payload, eventControl ? { eventControl } : undefined);
            return true;
        },
        [blueprintRuntime, dispatchInDrawing, element.type, keyboardInteractive],
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

        // These listeners are on `window`, so every widget hears every key regardless of focus.
        // That is the established semantic, but it must not extend to text entry: a keystroke meant
        // for a text field would otherwise also reach every other widget's keyDown on the surface.
        // The field's own Submit/Value Changed events are dispatched by its renderer, not here.
        const onKeyDown = (event: KeyboardEvent) => {
            // A held key's repeats are not presses: `On Key Down` answers the key going down, once,
            // as the game's own keys do (`keyboardOwner`).
            if (isTextEntryTarget(event.target) || event.repeat) {
                return;
            }
            const eventControl = getOrCreateDomEventPropagationControl(event);
            if (canDispatchKeyDown) {
                dispatchMountedWidgetEvent("keyDown", keyboardEventPayload(event), eventControl);
            }
        };
        const onKeyUp = (event: KeyboardEvent) => {
            if (isTextEntryTarget(event.target)) {
                return;
            }
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
            return localPointerPoint(e.currentTarget.getBoundingClientRect(), layout.width, layout.height, e.clientX, e.clientY);
        },
        [layout.height, layout.width],
    );


    /**
     * The element's hover sound, under the conditions its hover look shows in: not while it is
     * disabled, and never for the surface's own root. A touch has no hover - the finger arrives and
     * presses in one gesture - so a tap sounds the click alone.
     */
    const canSoundHover =
        readUIInteractionSoundAssetId(element, "hover") !== null &&
        Boolean(blueprintRuntime?.hostApi) &&
        !interactionDisabled &&
        !(isRoot && !isComponentRoot);
    const onPointerEnter = useCallback((e: PointerEvent<HTMLDivElement>) => {
        widgetRuntimeStore?.setHoverTarget(runtimeElementKey);
        if (canSoundHover && e.pointerType !== "touch") {
            offerUIElementHoverSound(e.nativeEvent, e.currentTarget, () => {
                playUIElementInteractionSound(blueprintRuntime, element, "hover");
            });
        }
        dispatchWidgetEvent("mouseEnter", e.target, localMousePayload(e), getOrCreateDomEventPropagationControl(e.nativeEvent));
    }, [blueprintRuntime, canSoundHover, dispatchWidgetEvent, element, isDirectElementEvent, localMousePayload, runtimeElementKey, widgetRuntimeStore]);

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
                pointerPressOf(e),
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
                pointerPressOf(e),
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
                pointerPressOf(e),
            );
        },
        [dispatchWidgetEvent, localMousePayload],
    );

    const onDoubleClick = useCallback(
        (e: MouseEvent<HTMLDivElement>) => {
            dispatchWidgetEvent(
                "mouseDoubleClick",
                e.target,
                localMousePayload(e),
                getOrCreateDomEventPropagationControl(e.nativeEvent),
                pointerPressOf(e),
            );
        },
        [dispatchWidgetEvent, localMousePayload],
    );

    const onContextMenu = useCallback(
        (e: MouseEvent<HTMLDivElement>) => {
            // The element half of the `contextmenu` split. Android raises this event from the
            // platform's own held finger and iOS raises nothing of the kind, so answering it would
            // make one long press mean two things on one phone and one thing on the other - and an
            // author must not be able to feel which phone a player is holding. Every long press is
            // produced by one timer of ours running the same code on both, and the platform's
            // version of it is swallowed here rather than reconciled: consistency by construction,
            // not by two platforms being tuned to agree.
            if (isTouchStrokeInFlight()) {
                e.preventDefault();
                return;
            }
            if (dispatchWidgetEvent(
                "rightClick",
                e.target,
                localMousePayload(e),
                getOrCreateDomEventPropagationControl(e.nativeEvent),
                pointerPressOf(e),
            )) {
                e.preventDefault();
            }
        },
        [dispatchWidgetEvent, localMousePayload],
    );

    const onWheel = useCallback(
        (e: WheelEvent<HTMLDivElement>) => {
            // The element half of "one wheel gesture counts once". A gesture something has already
            // answered is over for every listener, not only for the surface that answered it -
            // otherwise the momentum tail of the flick that opened a page would still be running
            // this widget's wheel head on the page it just left behind. Asked here as well as at the
            // surface shell because this fires first, on the way up from the element that was hit.
            if (!wheelGestureGate.admit(e.nativeEvent, readInputEventTime(e.nativeEvent))) {
                return;
            }
            dispatchWidgetEvent("mouseWheel", e.target, {
                ...localMousePayload(e),
                deltaX: e.deltaX,
                deltaY: e.deltaY,
            }, getOrCreateDomEventPropagationControl(e.nativeEvent), pointerPressOf(e));
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

    /** Where this node is placed, state offset included. Its own channel, so a gesture cannot take it. */
    const placedLeft = enteredOffsetsInFlow ? 0 : layout.x + Math.min(0, layout.width) + placedEnteredOffsets.x;
    const placedTop = enteredOffsetsInFlow ? 0 : layout.y + Math.min(0, layout.height) + placedEnteredOffsets.y;
    const lastPlacedOffsetsRef = useRef(placedEnteredOffsets);
    const lastPlacedStateKeyRef = useRef(enteredStateKey);

    const containerStyle = useMemo<CSSProperties>(() => {
        const { x, y, width, height } = layout;
        const normalizedWidth = Math.abs(width);
        const normalizedHeight = Math.abs(height);
        const offsetX = Math.min(0, width);
        const offsetY = Math.min(0, height);
        const isFlow = !isRoot && layoutMode === "flow";
        const style: CSSProperties = {
            position: isRoot ? "relative" : isFlow ? "relative" : "absolute",
            // The state's offset rides here rather than on the transform: a drag previews itself by
            // writing `style.transform` on this very node, so a pose sharing that channel is wiped
            // for the length of the gesture and snaps back when React re-renders. Placement is a
            // channel the gesture never touches.
            left: isFlow ? 0 : x + offsetX + placedEnteredOffsets.x,
            top: isFlow ? 0 : y + offsetY + placedEnteredOffsets.y,
            width: normalizedWidth,
            height: normalizedHeight,
            opacity: motionControlsOpacity ? undefined : effectiveOpacity,
            // A click stops where the picture is. A surface that must take no input at all is taken out
            // of hit testing as a whole instead (`GameSurfaceRenderer`'s `passive`), because this
            // line, and every other box that takes pointer events back, would undo it one level down.
            pointerEvents: isRoot && !isComponentRoot ? "none" : "auto",
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
    }, [
        effectiveOpacity,
        layout,
        isComponentRoot,
        isRoot,
        layoutMode,
        motionControlsOpacity,
        placedEnteredOffsets.x,
        placedEnteredOffsets.y,
        styleOverrides,
        wrapperCursor,
    ]);

    // Once an element carries a pose (authored rotation, persistent offsets/scale, or any motion)
    // its transform is the pose's: an authored `transform` in the element's own style gives way to
    // it, as it did to motion's. The latch keeps the channel with the pose for the element's lifetime,
    // so it is never handed back mid-flight.
    const motionPoseLatchRef = useRef(false);
    const hasMotionPose =
        motionPoseLatchRef.current ||
        Boolean(displayableMotion) ||
        displayableBaseTransform !== DEFAULT_DISPLAYABLE_BASE_TRANSFORM ||
        baseRotation !== 0 ||
        enteredOffsets.x !== 0 ||
        enteredOffsets.y !== 0;
    motionPoseLatchRef.current = hasMotionPose;

    /**
     * The node is a plain `div`, and until something animates it React writes all of it.
     *
     * Every channel here used to be a motion value on a `motion.div`, which gave every element on a
     * page its own visual element, projection node and turn in the frame loop - about a third of
     * what mounting a page cost, for the handful of elements anything ever moves. The resting
     * values are what that `motion.div` drew: placement by `left`/`top` (an authored left/top in the
     * element's style does not win over it), the pose by motion's own transform builder, and
     * opacity as authored.
     *
     * The first time a channel has to *move* - a Displayable motion, or entering a state with a
     * transition - a {@link NodeWrapperMotionDriver} takes over writing it, and React is handed the
     * value it last committed for that channel from then on, so the two never write it in turn.
     */
    const restTransform = hasMotionPose
        ? nodeWrapperTransform({ x: basePose.x, y: basePose.y, scale: basePose.scale, rotate: basePose.rotate })
        : containerStyle.transform;
    const restOpacity = containerStyle.opacity;
    const restPose: NodeWrapperPose = {
        left: placedLeft,
        top: placedTop,
        x: basePose.x,
        y: basePose.y,
        scale: basePose.scale,
        rotate: basePose.rotate,
        opacity: typeof restOpacity === "number" ? restOpacity : effectiveOpacity,
    };
    const nodeMotionRef = useRef<NodeMotionState | null>(null);
    const nodeMotion = (nodeMotionRef.current ??= createNodeMotionState());
    const reducedMotionConfig = useContext(MotionConfigContext).reducedMotion;

    const handedOver = nodeMotion.handedOver;
    const nodeStyle: CSSProperties = {
        ...containerStyle,
        left: handedOver ? handedOver.left : placedLeft,
        top: handedOver ? handedOver.top : placedTop,
    };
    const transformForReact = handedOver?.transform ? handedOver.transform.value : restTransform;
    if (transformForReact !== undefined) {
        nodeStyle.transform = transformForReact;
    }
    if (handedOver?.opacity) {
        nodeStyle.opacity = handedOver.opacity.value;
    }

    /**
     * The channels a visual element took from the props as they changed: scale and rotation follow the
     * pose until a Displayable motion has animated them, and opacity is React's until one takes it.
     * The transform is taken over the moment the element carries a pose.
     */
    const syncMotionDriver = (driver: NodeWrapperMotionDriver) => {
        if (!driver.hasMotionAnimated("scale")) {
            driver.set("scale", basePose.scale);
        }
        if (!driver.hasMotionAnimated("rotate")) {
            driver.set("rotate", basePose.rotate);
        }
        if (!driver.ownsOpacityChannel() && typeof restOpacity === "number") {
            driver.set("opacity", restOpacity);
        }
        if (hasMotionPose) {
            handOver("transform", driver);
        }
    };
    const handOver = (channel: "transform" | "opacity", driver: NodeWrapperMotionDriver) => {
        const handed = nodeMotion.handedOver;
        if (!handed) {
            return;
        }
        if (channel === "transform" && !handed.transform) {
            handed.transform = { value: transformForReact };
            driver.takeTransform();
        }
        if (channel === "opacity" && !handed.opacity) {
            handed.opacity = { value: nodeStyle.opacity };
        }
    };
    /** The driver, created from what was on screen before this commit the first time it is needed. */
    const ensureMotionDriver = (): NodeWrapperMotionDriver => {
        const existing = nodeMotion.driver;
        if (existing) {
            return existing;
        }
        const driver = new NodeWrapperMotionDriver(nodeMotion.startPose ?? restPose);
        nodeMotion.driver = driver;
        nodeMotion.handedOver = { left: nodeStyle.left, top: nodeStyle.top };
        driver.attach(nodeMotion.mounted ? containerRef.current : null);
        syncMotionDriver(driver);
        return driver;
    };
    const claimOpacityIfTaken = (driver: NodeWrapperMotionDriver) => {
        if (driver.ownsOpacityChannel()) {
            handOver("opacity", driver);
        }
    };

    const onAnimationComplete = () => {
        if (!displayableMotion?.resetOnComplete) {
            return;
        }
        if (!isResetPhase) {
            setResetMotionId(displayableMotion.id);
            return;
        }
        widgetRuntimeStore?.completeDisplayableMotion(runtimeElementKey, displayableMotion.id);
        setResetMotionId(null);
    };

    useLayoutEffect(() => {
        nodeMotion.mounted = true;
        nodeMotion.driver?.attach(containerRef.current);
        return () => {
            nodeMotion.mounted = false;
            const driver = nodeMotion.driver;
            if (driver) {
                // Nothing keeps moving a node that has left the page, and a motion that was still
                // running reports nothing (its completion checks `mounted`).
                driver.stop();
                driver.attach(null);
            }
        };
    }, []);

    // Runs first in every commit: what was on screen before it, the handler a finishing motion reports
    // to, and the props-driven channels.
    //
    // It also puts the pose back on the node every commit, as the visual element did: the editor's
    // drag writes `style.transform` itself while a gesture runs and leaves a bare rotation behind when
    // it ends, and the next render is what restores a pose that carries more than that. React alone
    // would not, because its own transform did not change.
    useLayoutEffect(() => {
        nodeMotion.startPose = nodeMotion.committedPose;
        nodeMotion.committedPose = restPose;
        nodeMotion.onComplete = onAnimationComplete;
        const driver = nodeMotion.driver;
        if (driver) {
            syncMotionDriver(driver);
            driver.writeAll();
            return;
        }
        const node = containerRef.current;
        if (node && hasMotionPose && typeof restTransform === "string" && node.style.transform !== restTransform) {
            node.style.transform = restTransform;
        }
    });

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
            // StrictMode's simulated unmount stops any in-flight motion (see the effect above); forget
            // the last run key so the second mount's effect restarts the motion instead of skipping it
            // via the mid-flight guard below.
            lastMotionRunKeyRef.current = null;
        },
        [],
    );

    useLayoutEffect(() => {
        const { animate, initial, transition } = motionRunConfigRef.current;
        if (!motionRunKey || !animate) {
            lastMotionRunKeyRef.current = null;
            const driver = nodeMotion.driver;
            driver?.stop();
            // A completed/stopped/replaced motion leaves its last frame on the channels. Snap back
            // to the persistent base pose in the same commit so a layout commit (hold animations
            // fold their delta into left/top) is never painted while the transform still carries
            // that delta (double offset) and later motions start from a clean baseline instead of
            // the stale frame. Skipped until a motion has run: before that the base pose is simply
            // the node's style.
            if (hasStartedMotionRef.current && driver) {
                driver.setTarget({ ...basePoseRef.current });
                claimOpacityIfTaken(driver);
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
        const driver = ensureMotionDriver();
        if (initial && !isResetPhase) {
            driver.setTarget(initial);
        }
        // Every motion reports when all of its channels have finished or been stopped - a newer
        // motion replacing it stops the channels the two share, and the older one reports then.
        const reduceMotion =
            reducedMotionConfig === "always"
            || (reducedMotionConfig === "user"
                && typeof window !== "undefined"
                && typeof window.matchMedia === "function"
                && window.matchMedia("(prefers-reduced-motion)").matches);
        void driver.start(animate, transition, reduceMotion).then(() => {
            if (nodeMotion.mounted) {
                nodeMotion.onComplete();
            }
        });
        claimOpacityIfTaken(driver);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the driver helpers read this render's values on purpose
    }, [basePose, isResetPhase, motionRunKey]);

    // Placement. A layout effect, after the motion above in the same commit: React has already
    // written the new place, so a trip has to put the node back where it was before anything paints.
    useLayoutEffect(() => {
        const previous = lastPlacedOffsetsRef.current;
        const previousStateKey = lastPlacedStateKeyRef.current;
        const enteredMoved = previous.x !== placedEnteredOffsets.x || previous.y !== placedEnteredOffsets.y;
        lastPlacedOffsetsRef.current = placedEnteredOffsets;
        lastPlacedStateKeyRef.current = enteredStateKey;
        const transition = enteredOffsetTransitionRef.current;
        // Only a change of state is a trip. Moving the element *within* the state on screen - dragging
        // it there, typing a number - is the author saying where it sits, not the element travelling:
        // animating to it starts from where they just left, which reads as the element snapping back
        // to its old spot for a frame and then sliding into place. It also leaves the selection frame
        // measuring a position the element is only passing through.
        const changedState = enteredStateKey === "" || previousStateKey !== enteredStateKey;
        if (!enteredMoved || !changedState || !transition) {
            const driver = nodeMotion.driver;
            if (driver) {
                driver.set("left", placedLeft);
                driver.set("top", placedTop);
            }
            return undefined;
        }
        const driver = ensureMotionDriver();
        const runLeft = driver.animateChannel("left", placedLeft, transition);
        const runTop = driver.animateChannel("top", placedTop, transition);
        return () => {
            runLeft.stop();
            runTop.stop();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the driver helpers read this render's values on purpose
    }, [enteredStateKey, placedEnteredOffsets, placedLeft, placedTop]);

    // The pose's offsets, so entering a state can *move* the element instead of teleporting it: an
    // author flipping between states is previewing the animation the player will see. A blueprint
    // animation owns the channel while it runs, so this stands aside for it.
    const lastEnteredOffsetsRef = useRef(enteredOffsets);
    const lastPoseStateKeyRef = useRef(enteredStateKey);
    useLayoutEffect(() => {
        const previous = lastEnteredOffsetsRef.current;
        const previousStateKey = lastPoseStateKeyRef.current;
        const enteredMoved = previous.x !== enteredOffsets.x || previous.y !== enteredOffsets.y;
        lastEnteredOffsetsRef.current = enteredOffsets;
        lastPoseStateKeyRef.current = enteredStateKey;
        if (displayableMotion) {
            return undefined;
        }
        const transition = enteredOffsetTransitionRef.current;
        // Same rule as placement above: the trip is between states, never inside one.
        const changedState = enteredStateKey === "" || previousStateKey !== enteredStateKey;
        if (!enteredMoved || !changedState || !transition) {
            const driver = nodeMotion.driver;
            if (driver) {
                driver.set("x", basePose.x);
                driver.set("y", basePose.y);
            }
            return undefined;
        }
        const driver = ensureMotionDriver();
        const runX = driver.animateChannel("x", basePose.x, transition);
        const runY = driver.animateChannel("y", basePose.y, transition);
        return () => {
            runX.stop();
            runY.stop();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the driver helpers read this render's values on purpose
    }, [basePose.x, basePose.y, displayableMotion, enteredOffsets, enteredStateKey]);

    return (
        <EnteredStateProvider value={broadcastState}>
        <div
            ref={containerRef}
            data-ui-element-id={interactive ? element.id : undefined}
            // Which drawing this is, for measuring one row or one placement rather than whichever
            // copy of the element the page happens to hold first. See `surfaceMeasurement`.
            data-ui-drawing={interactive && instanceKey ? uiDrawingAttributeValue(instanceKey) : undefined}
            className={`${interactive ? "ui-editor-node" : "ui-editor-node-preview"} ${isRoot ? "ui-editor-node-root" : ""} ${isEnteredHere ? "ui-editor-node-entered" : ""}`}
            style={nodeStyle}
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
        </div>
        </EnteredStateProvider>
    );
}
