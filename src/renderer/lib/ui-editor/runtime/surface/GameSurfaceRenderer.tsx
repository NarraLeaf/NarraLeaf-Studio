import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties,
    type MouseEvent as ReactMouseEvent,
    type WheelEvent as ReactWheelEvent,
} from "react";
import type { UIDocument, UISurface } from "@shared/types/ui-editor/document";
import {
    normalizeUISurfaceInputMode,
    type UIInputPointerGesture,
} from "@shared/types/ui-editor/inputAction";
import {
    hitsConsumeInput,
    resolveSurfaceInputActionHits,
    stopsAtLane,
    type UIInputSignal,
    type UIPointerInputDevice,
} from "@/lib/ui-editor/runtime/input/surfaceInputActions";
import {
    claimInputLaneVisit,
    handOffInputToLaneBehind,
    readPointerEventDevice,
    readSurfaceHitChain,
    readWheelGesture,
} from "@/lib/ui-editor/runtime/input/surfaceInputDom";
import {
    claimTouchStroke,
    getSharedTouchGestureTracker,
    isTouchStrokeInFlight,
    readTouchGestureDetail,
    UI_TOUCH_GESTURE_EVENT,
} from "@/lib/ui-editor/runtime/input/touchGesture";
import {
    isWheelPointerGesture,
    readInputEventTime,
    wheelGestureGate,
} from "@/lib/ui-editor/runtime/input/wheelGesture";
import type { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { resolveSurfaceRootElementId } from "@/lib/ui-editor/runtime/resolveSurfaceRoot";
import type {
    NestedSurfaceRuntime,
    SurfaceBlueprintBindingContext,
    SurfaceLifecycleSignals,
} from "@/lib/ui-editor/runtime/surface/SurfaceElementTree";
import { SurfaceBackgroundImageLayer } from "@/lib/ui-editor/runtime/surface/SurfaceBackgroundImageLayer";
import { SurfaceElementTree } from "@/lib/ui-editor/runtime/surface/SurfaceElementTree";
import { SurfacePassiveContext } from "@/lib/ui-editor/runtime/surface/SurfacePassiveContext";
import type { DevModeWidgetRuntimePatch } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { getSurfaceBackgroundColor } from "@/lib/ui-editor/runtime/surfaceBackground";
import { getSurfaceAnimationPlan } from "@/lib/ui-editor/runtime/surfaceAnimationPlan";
import { useWidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";

/**
 * The part of an input event a lane step needs.
 *
 * Written as a shape rather than as a union of event types so that one function serves both routes
 * into routing: React's synthetic mouse and wheel events satisfy it as they are, and the private
 * CustomEvent a recognised touch gesture arrives on is wrapped in one of these. There is no second
 * copy of the walk for touch to drift away from.
 */
type UIInputLaneEvent = {
    nativeEvent: Event;
    target: EventTarget | null;
    clientX: number;
    clientY: number;
    stopPropagation: () => void;
};

/** What the input is, in the terms a binding is written in. */
type UIInputLaneGesture = {
    gesture: UIInputPointerGesture;
    device: UIPointerInputDevice;
    /**
     * The input is one the touch recogniser produced rather than one the browser raised.
     *
     * Two rules turn on it. A touch stroke has an explicit end, so it is not subject to the wheel
     * gate's silence window - running it through would let one stroke's claim swallow the next
     * stroke that happened to follow within a fifth of a second. And a stroke something answered has
     * to have its trailing synthetic click suppressed, which is only meaningful while the stroke is
     * the thing in hand: the tap-synthesised `click` that arrives afterwards is a touch input too,
     * and claiming on that one would eat the *following* tap.
     */
    fromTouchStroke?: boolean;
};

export type GameSurfaceRendererProps = {
    document: UIDocument;
    surface: UISurface;
    rendererRegistry: ElementRendererRegistry;
    scale: number;
    hostAdapter: UIHostAdapter;
    blueprintBindingContext?: SurfaceBlueprintBindingContext | null;
    widgetRuntimePatches?: Record<string, DevModeWidgetRuntimePatch>;
    getWidgetRuntimePatches?: () => Record<string, DevModeWidgetRuntimePatch> | undefined;
    nestedSurfaceRuntime?: NestedSurfaceRuntime;
    surfaceLifecycleSignals?: SurfaceLifecycleSignals;
    blueprintLifecycleReady?: boolean;
    interactive?: boolean;
    keyboardInteractive?: boolean;
    onRuntimeSubscriptionsReady?: () => void;
    /**
     * When "none", the surface shell/scaler divs are click-through so empty areas do not block
     * whatever renders behind them. Widget elements re-enable pointer events themselves via their
     * node wrappers. Used by the On-Stage slot, whose NLR RootLayout host forces
     * `pointer-events: auto` on all descendants via a universal-selector CSS rule that only an
     * inline style can override.
     */
    surfacePointerEvents?: CSSProperties["pointerEvents"];
    /**
     * The surface is display-only: no widget inside it takes pointer events. Distinct from
     * `surfacePointerEvents`, which only makes the shell click-through and is defeated by the first
     * full-size container. See {@link SurfacePassiveContext}.
     */
    passive?: boolean;
    /**
     * Background the design-size layer paints, overriding the surface's authored colour.
     *
     * The app surface stack resolves the colour itself (an in-game overlay thins it, see
     * `getSurfaceLayerBackgroundColor`) and paints it on the animation layer. Repainting the authored
     * colour here would put an opaque sheet back over it one level down.
     */
    backgroundColor?: string;
    /**
     * Thins the Surface's background picture, for a page presented over a running game.
     *
     * Unlike `backgroundColor` this is a factor rather than a replacement: the picture is the
     * author's, and the presentation only decides how much of the scene behind it shows through.
     */
    backgroundImageOpacity?: number;
    /**
     * Passed straight through to {@link SurfaceElementTree}: the caller promises this `document` is a
     * snapshot nothing mutates in place, which is what lets the element tree be memoised. Both
     * runtime hosts (the app surface stack and the stage slots) render out of a compiled bundle and
     * do promise it; anything rendering over a live editor document must leave it unset.
     */
    staticDocument?: boolean;
    /**
     * Let the elements on this Surface play their own enter/exit animations.
     *
     * Off by default: the same renderer draws Surface previews and the editing canvas, and a widget
     * that animates itself in every time the author nudges it is unusable. Runtime hosts turn it on.
     * Requires `staticDocument` for the same reason the element tree's memo does - the timings are
     * cached against the element table's identity.
     */
    elementAnimations?: boolean;
    /** The player asked for less motion: no element animates, whatever the document says. */
    reducedMotion?: boolean;
};

export function GameSurfaceRenderer(props: GameSurfaceRendererProps) {
    const {
        document,
        surface,
        rendererRegistry,
        scale,
        hostAdapter,
        blueprintBindingContext,
        widgetRuntimePatches,
        getWidgetRuntimePatches,
        nestedSurfaceRuntime,
        surfaceLifecycleSignals,
        blueprintLifecycleReady,
        interactive = true,
        keyboardInteractive = interactive,
        onRuntimeSubscriptionsReady,
        surfacePointerEvents,
        passive = false,
        backgroundColor,
        backgroundImageOpacity,
        staticDocument,
        elementAnimations = false,
        reducedMotion = false,
    } = props;
    // Kept as values, not write-only tick setters: the element tree is memoised on its inputs, and
    // "a store I subscribed to fired" is an input that does not show up in any prop.
    const [bindingRenderTick, setBindingRenderTick] = useState(0);
    const [runtimePatchRenderTick, setRuntimePatchRenderTick] = useState(0);
    const widgetRuntimeStore = useWidgetRuntimeStateStore();

    useEffect(() => {
        const store = blueprintBindingContext?.surfaceState;
        if (!store) {
            return undefined;
        }
        return store.subscribe(() => setBindingRenderTick(tick => tick + 1));
    }, [blueprintBindingContext?.surfaceState]);

    useLayoutEffect(() => {
        if (!widgetRuntimeStore) {
            return undefined;
        }
        return widgetRuntimeStore.subscribeRuntimePatches(() => setRuntimePatchRenderTick(tick => tick + 1));
    }, [widgetRuntimeStore]);

    useEffect(() => {
        if (!onRuntimeSubscriptionsReady) {
            return undefined;
        }
        if (typeof requestAnimationFrame !== "function") {
            const timeoutId = setTimeout(onRuntimeSubscriptionsReady, 0);
            return () => clearTimeout(timeoutId);
        }
        const frameId = requestAnimationFrame(() => onRuntimeSubscriptionsReady());
        return () => cancelAnimationFrame(frameId);
    }, [onRuntimeSubscriptionsReady]);

    // Resolved, but not bailed on yet: every hook below has to run on every render of this
    // component, and a surface whose root element went missing between two renders would otherwise
    // change how many of them there are. The bail is just before the markup instead.
    const rootElementId = resolveSurfaceRootElementId(document, surface.id);
    const rootElement = rootElementId ? document.elements[rootElementId] : undefined;

    const animationPlan =
        rootElementId && elementAnimations && !reducedMotion
            ? getSurfaceAnimationPlan({
                  elements: document.elements,
                  rootElementId,
                  rootSettings: surface.settings?.pageAnimation ?? null,
                  cache: staticDocument === true,
              })
            : null;

    const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    const scaledWidth = surface.designSize.width * safeScale;
    const scaledHeight = surface.designSize.height * safeScale;
    const dispatchSurfaceBlueprintEvent = hostAdapter.blueprintRuntime?.dispatchSurfaceBlueprintEvent;
    const dispatchSurfaceInputAction = hostAdapter.blueprintRuntime?.dispatchSurfaceInputAction;
    const effectiveWidgetRuntimePatches = getWidgetRuntimePatches?.() ?? widgetRuntimePatches;
    const shellRef = useRef<HTMLDivElement | null>(null);

    /**
     * What this surface does with input that lands on it.
     *
     * `capture` unless the author said otherwise, which is what every surface written before the
     * field existed already did - so an old document routes exactly as it used to. `none` takes the
     * surface out of input altogether, keyboard included: it is drawn, and nothing else.
     */
    const inputMode = normalizeUISurfaceInputMode(surface.input);
    const laneInteractive = interactive && inputMode !== "none";
    const laneKeyboardInteractive = keyboardInteractive && inputMode !== "none";
    const actionVocabulary = document.actions;
    const surfaceActions = surface.actions;
    /**
     * Whether this surface is a lane at all.
     *
     * A renderer with no blueprint runtime behind it is drawing a picture of a surface - the version
     * diff's preview, an editor thumbnail - and cannot answer input with anything. It must not claim
     * it either, or a click on a preview would stop where the picture is instead of reaching the
     * panel the picture sits in.
     *
     * Instance-scoped rather than surface-scoped, because one surface can be on screen twice (a page
     * and a frame showing the same surface) and each of those is its own lane.
     */
    const laneKey = hostAdapter.blueprintRuntime
        ? hostAdapter.blueprintRuntime.runtimeScopeId ?? surface.id
        : null;

    const toDesignPoint = useCallback(
        (event: { clientX: number; clientY: number }, shell: HTMLDivElement) => {
            const rect = shell.getBoundingClientRect();
            const scaleX = rect.width > 0 ? surface.designSize.width / rect.width : 1;
            const scaleY = rect.height > 0 ? surface.designSize.height / rect.height : 1;
            return {
                x: (event.clientX - rect.left) * scaleX,
                y: (event.clientY - rect.top) * scaleY,
            };
        },
        [surface.designSize.height, surface.designSize.width],
    );

    /**
     * This surface's turn in the lane walk: fire the actions it declares for this input, then decide
     * whether the input goes any further.
     *
     * Runs after the element walk, which React has already started on the way up from the element
     * that was hit - so an author reading "the element first, then the panel" gets that order. It
     * does not wait for the element graphs to finish, and deliberately makes no promise that it
     * would: two graphs started by one click are two graphs, not a sequence.
     *
     * Stopping is `stopPropagation` on the way out plus, for `pass`, a copy of the event aimed at
     * whatever the browser paints behind this surface. An action with `consume` (the default) ends
     * the walk wherever the mode would have carried it.
     *
     * Returns whether an action here consumed the input, which is what a touch stroke's caller needs
     * to know: only a stroke that actually fired something claims its trailing click.
     */
    const runLaneStep = useCallback(
        (event: UIInputLaneEvent, input: UIInputLaneGesture): boolean => {
            const shell = shellRef.current;
            if (!laneInteractive || !shell || !laneKey) {
                return false;
            }
            if (!claimInputLaneVisit(event.nativeEvent, laneKey)) {
                return false;
            }
            const wheel = isWheelPointerGesture(input.gesture) && !input.fromTouchStroke;
            const eventTime = readInputEventTime(event.nativeEvent);
            if (wheel && !wheelGestureGate.admit(event.nativeEvent, eventTime)) {
                // The tail of a gesture something already answered. Swallowed rather than passed on:
                // the whole point is that no lane hears the rest of it.
                event.stopPropagation();
                return false;
            }
            const point = toDesignPoint(event, shell);
            const signal: UIInputSignal = { kind: "pointer", gesture: input.gesture, device: input.device, ...point };
            const hits = dispatchSurfaceInputAction
                ? resolveSurfaceInputActionHits({
                      vocabulary: actionVocabulary,
                      enablements: surfaceActions,
                      signal,
                      hitChain: readSurfaceHitChain({
                          document,
                          target: event.target,
                          surfaceRoot: shell,
                      }),
                  })
                : [];
            for (const hit of hits) {
                void dispatchSurfaceInputAction?.(hit.payload);
            }
            const consumed = hitsConsumeInput(hits);
            if (wheel && consumed) {
                wheelGestureGate.claim(eventTime);
            }
            if (stopsAtLane(inputMode, consumed)) {
                event.stopPropagation();
                return consumed;
            }
            handOffInputToLaneBehind({ event: event.nativeEvent, surfaceRoot: shell });
            return consumed;
        },
        [
            actionVocabulary,
            dispatchSurfaceInputAction,
            document,
            inputMode,
            laneInteractive,
            laneKey,
            surfaceActions,
            toDesignPoint,
        ],
    );

    const handleSurfaceClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
        const shell = shellRef.current;
        if (laneInteractive && dispatchSurfaceBlueprintEvent && shell) {
            void dispatchSurfaceBlueprintEvent("mouseClick", toDesignPoint(event, shell));
        }
        // A tap synthesises a click, and it reports itself as one: the event is a `PointerEvent`
        // whose `pointerType` says which hand raised it, so an action fired from a tap says `touch`
        // without anything having to infer it from the shape of the gesture.
        runLaneStep(event, { gesture: "click", device: readPointerEventDevice(event.nativeEvent) });
    }, [dispatchSurfaceBlueprintEvent, laneInteractive, runLaneStep, toDesignPoint]);

    const handleSurfaceDoubleClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
        runLaneStep(event, { gesture: "doubleClick", device: readPointerEventDevice(event.nativeEvent) });
    }, [runLaneStep]);

    const handleSurfaceRightClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
        // One browser event, two gestures, told apart by whether a finger is on the glass. Android
        // raises `contextmenu` from the platform's own held finger; that is a duplicate of the long
        // press this runtime recognises for itself, and it is swallowed rather than answered - iOS
        // raises nothing of the kind, and an author must not be able to feel which phone a player is
        // holding. A right button raised it when no stroke is in flight, and that is `rightClick`.
        if (isTouchStrokeInFlight()) {
            event.preventDefault();
            return;
        }
        const shell = shellRef.current;
        if (laneInteractive && dispatchSurfaceBlueprintEvent && shell) {
            event.preventDefault();
            void dispatchSurfaceBlueprintEvent("rightClick", toDesignPoint(event, shell));
        }
        runLaneStep(event, { gesture: "rightClick", device: readPointerEventDevice(event.nativeEvent) });
    }, [dispatchSurfaceBlueprintEvent, laneInteractive, runLaneStep, toDesignPoint]);

    const handleSurfaceWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
        const gesture = readWheelGesture(event);
        if (gesture) {
            // A `WheelEvent` is not a pointer event and names no device. A trackpad's two fingers
            // are the trackpad's, not the player's: what reaches here is always the mouse family.
            runLaneStep(event, { gesture, device: "pointer" });
            return;
        }
        // A wheel event whose deltas name no direction still belongs to the gesture in flight.
        // Counted rather than dropped: the silence between events is what ends a gesture, and one
        // that did not extend the silence could let a gesture end in the middle of itself.
        wheelGestureGate.admit(event.nativeEvent, readInputEventTime(event.nativeEvent));
    }, [runLaneStep]);

    /**
     * A gesture the touch recogniser produced, taking this lane's turn.
     *
     * A native listener rather than a React prop, because the event name is a private one React has
     * no `on...` for. Everything after that is the walk every other input takes - the same
     * `runLaneStep`, so a touch gesture is answered by the same rules with the same order.
     *
     * The recogniser aims it at the element the stroke started on, which is the browser's own rule
     * for a touch stroke: every event of it goes to the element the first finger landed on, whatever
     * has since scrolled underneath. So the hit chain is stable for the whole stroke, and
     * `overControls` asks the same question `Is Action Held` does - what did the player put their
     * finger on.
     */
    const handleTouchGesture = useCallback((event: Event) => {
        const detail = readTouchGestureDetail(event);
        if (!detail) {
            return;
        }
        const consumed = runLaneStep(
            {
                nativeEvent: event,
                target: event.target,
                clientX: detail.clientX,
                clientY: detail.clientY,
                stopPropagation: () => event.stopPropagation(),
            },
            { gesture: detail.gesture, device: "touch", fromTouchStroke: true },
        );
        if (consumed) {
            // The stroke has been answered, so the click the browser synthesises when the finger
            // lifts must fire nothing - otherwise a drag that opens the log advances the dialogue on
            // its way out. Claimed only on a real answer, exactly as the wheel gate is.
            claimTouchStroke();
        }
    }, [runLaneStep]);

    const hasRootElement = Boolean(rootElement);

    useEffect(() => {
        if (!laneInteractive || !hasRootElement) {
            return undefined;
        }
        const shell = shellRef.current;
        if (!shell) {
            return undefined;
        }
        // Armed on mount rather than on the first gesture: the recogniser is a set of window
        // listeners, and one built after the finger has already landed has missed the `touchstart`
        // that says where the stroke began.
        getSharedTouchGestureTracker();
        shell.addEventListener(UI_TOUCH_GESTURE_EVENT, handleTouchGesture);
        return () => shell.removeEventListener(UI_TOUCH_GESTURE_EVENT, handleTouchGesture);
    }, [handleTouchGesture, hasRootElement, laneInteractive]);

    const shellStyle: CSSProperties = {
        position: "relative",
        width: scaledWidth,
        height: scaledHeight,
        overflow: "hidden",
        // A surface that takes no input is click-through as well as inert, so the thing behind it is
        // reachable rather than merely unblocked-in-principle.
        ...(inputMode === "none" ? { pointerEvents: "none" as const } : surfacePointerEvents ? { pointerEvents: surfacePointerEvents } : {}),
    };
    const surfaceStyle: CSSProperties = {
        position: "relative",
        width: surface.designSize.width,
        height: surface.designSize.height,
        overflow: "hidden",
        backgroundColor: backgroundColor ?? getSurfaceBackgroundColor(surface),
        transform: `scale(${safeScale})`,
        transformOrigin: "top left",
        ...(inputMode === "none" ? { pointerEvents: "none" as const } : surfacePointerEvents ? { pointerEvents: surfacePointerEvents } : {}),
    };

    if (!rootElement) {
        return null;
    }

    return (
        // A surface out of input is passive as well as inert. Widget wrappers set `pointer-events:
        // auto` on themselves, so making only the shell click-through would leave every widget on it
        // still blocking whatever is behind - which is the opposite of what "none" says.
        <SurfacePassiveContext.Provider value={passive || inputMode === "none"}>
        <div
            ref={shellRef}
            className="ui-editor-surface"
            data-ui-surface-id={surface.id}
            data-ui-surface-kind={surface.kind}
            data-ui-surface-input={inputMode}
            style={shellStyle}
            onClick={laneInteractive ? handleSurfaceClick : undefined}
            onDoubleClick={laneInteractive ? handleSurfaceDoubleClick : undefined}
            onContextMenu={laneInteractive ? handleSurfaceRightClick : undefined}
            onWheel={laneInteractive ? handleSurfaceWheel : undefined}
        >
            <div style={surfaceStyle}>
                <SurfaceBackgroundImageLayer surface={surface} opacity={backgroundImageOpacity} />
                <SurfaceElementTree
                    document={document}
                    surface={surface}
                    rootElement={rootElement}
                    rendererRegistry={rendererRegistry}
                    hostAdapter={hostAdapter}
                    blueprintBindingContext={blueprintBindingContext}
                    widgetRuntimePatches={effectiveWidgetRuntimePatches}
                    nestedSurfaceRuntime={nestedSurfaceRuntime}
                    surfaceLifecycleSignals={surfaceLifecycleSignals}
                    blueprintLifecycleReady={blueprintLifecycleReady}
                    interactive={laneInteractive}
                    keyboardInteractive={laneKeyboardInteractive}
                    staticDocument={staticDocument}
                    animationPlan={animationPlan}
                    hostRenderTick={bindingRenderTick + runtimePatchRenderTick}
                />
            </div>
        </div>
        </SurfacePassiveContext.Provider>
    );
}
