import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type MutableRefObject,
    type ReactNode,
} from "react";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { PersistentVariableRuntimeTable } from "@shared/types/variables/registry";
import type { UIDocument, UISurface } from "@shared/types/ui-editor/document";
import type { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import type { NestedSurfaceRuntime } from "@/lib/ui-editor/runtime/surface/SurfaceElementTree";
import { GameSurfaceRenderer } from "@/lib/ui-editor/runtime/surface/GameSurfaceRenderer";
import { SurfaceAnimationLayer } from "@/lib/ui-editor/runtime/surface/SurfaceAnimationLayer";
import {
    resolvePageAnimationMotion,
    type PageAnimationNavigationDirection,
} from "@/lib/ui-editor/runtime/pageAnimation";
import { getSurfaceAnimationTimings } from "@/lib/ui-editor/runtime/surfaceAnimationPlan";
import {
    getSurfaceLayerBackgroundColor,
    getSurfaceLayerBackgroundImageOpacity,
    SURFACE_LAYER_SCRIM_COLOR,
} from "@/lib/ui-editor/runtime/surfaceBackground";
import { WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import type { BlueprintRuntimeCore } from "@/lib/ui-editor/runtime/game/useBlueprintRuntimeCore";
import type {
    SurfaceNavigationEntry,
    SurfaceNavigationPresentation,
} from "@/lib/ui-editor/runtime/game/surfaceNavigationController";
import {
    executeLifecycleCommands,
    type LifecycleCommand,
    type SurfaceLifecycleOrchestrator,
} from "./lifecycle/surfaceLifecycleOrchestrator";
import { SurfaceLifecycleBoundary } from "./SurfaceLifecycleBoundary";
import type { WidgetPatchesByScope } from "./widgetRuntimePatches";
import type { HostAdapterBundle, PageProps } from "./types";

/**
 * One shared empty table rather than a fresh `{}` per read.
 *
 * The element tree is memoised on its inputs, and a literal here would hand it a new object on every
 * render - which is every page that has never patched a widget, i.e. most of them.
 */
const NO_WIDGET_RUNTIME_PATCHES: WidgetPatchesByScope[string] = {};

/** The slice of a navigation entry the surface layer needs. */
export type AppSurfaceLayerNavEntry = SurfaceNavigationEntry<PageProps, SurfaceNavigationPresentation> & {
    runtimeScopeId: string;
};

type AppSurfaceLayerCommonProps = {
    uidoc: UIDocument;
    blueprintDocument: BlueprintDocument;
    persistentVariables: PersistentVariableRuntimeTable;
    entry: AppSurfaceLayerNavEntry;
    layerIndex: number;
    surface: UISurface;
    rendererRegistry: ElementRendererRegistry;
    scale: number;
    widgetPatchesByScope: WidgetPatchesByScope;
    widgetPatchesByScopeRef: MutableRefObject<WidgetPatchesByScope>;
    widgetRuntimeStore: WidgetRuntimeStateStore;
    lifecycleRef: MutableRefObject<SurfaceLifecycleOrchestrator>;
    nestedSurfaceRuntime?: NestedSurfaceRuntime;
    blueprintLifecycleReady: boolean;
    reducedMotion: boolean;
    /**
     * Whether this entry takes pointer input, as resolved across the whole composite stack (see
     * `layers/compositeInput`). Not "is this the top of the page stack" any more: a layer above it may
     * have taken input away from it, and more than one entry can be live at once.
     */
    active: boolean;
    /**
     * Whether keyboard events belong to this entry. Exactly one entry in the composite has it, which
     * is why it is a separate answer from `active` rather than the same flag read twice: with a modal
     * layer over a non-modal one, both are clickable and only the modal has the keys.
     */
    keyboardOwner: boolean;
    /** Paint a dimming sheet behind this entry's own background. */
    scrim?: boolean;
    onInteractionReadyChange: (entryKey: string, ready: boolean) => void;
    onPrepaintReady: (entryKey: string) => void;
    onEnterComplete: (entryKey: string) => void;
};

export function AppSurfaceLayer(props: AppSurfaceLayerCommonProps & {
    core: BlueprintRuntimeCore;
    hostAdapterBundle: HostAdapterBundle;
}): ReactNode {
    const {
        uidoc,
        blueprintDocument,
        persistentVariables,
        core,
        entry,
        layerIndex,
        surface,
        rendererRegistry,
        scale,
        hostAdapterBundle,
        widgetPatchesByScope,
        widgetPatchesByScopeRef,
        widgetRuntimeStore,
        lifecycleRef,
        nestedSurfaceRuntime,
        blueprintLifecycleReady,
        reducedMotion,
        active,
        keyboardOwner,
        scrim = false,
        onInteractionReadyChange,
        onPrepaintReady,
        onEnterComplete,
    } = props;
    /**
     * The entry whose arrival has finished, if it is this one.
     *
     * Deliberately not "is this entry interactive": arriving happens once per entry, while `active`
     * goes both ways for as long as the entry lives - a modal layer opening over it takes input
     * away, and that layer closing hands it back. Folding the two together left the second half
     * unreachable, because the only thing that could set it was a callback that had already fired.
     *
     * Stored as the key it was observed for, in the same shape as the subscription flag below, so a
     * new entry in this slot starts over without a reset step to forget.
     */
    const [enteredEntryKey, setEnteredEntryKey] = useState<string | null>(null);
    const [surfaceRuntimeSubscriptionsReadyKey, setSurfaceRuntimeSubscriptionsReadyKey] = useState<string | null>(null);
    const [surfaceLifecycleSignals, setSurfaceLifecycleSignals] = useState({
        beforeSurfaceExit: 0,
        afterSurfaceEnter: 0,
    });
    const transitionStateRef = useRef({ isEntering: true, isExiting: false });
    const enteredThisEntry = enteredEntryKey === entry.key;
    const effectiveInteractive = active && enteredThisEntry;
    const effectiveKeyboardInteractive = keyboardOwner && blueprintLifecycleReady;
    const surfaceRuntimeSubscriptionsReady = surfaceRuntimeSubscriptionsReadyKey === entry.key;
    const surfaceBlueprintLifecycleReady = blueprintLifecycleReady && surfaceRuntimeSubscriptionsReady;
    // SurfaceAnimationLayer keeps new layers hidden until prepaint is ready. Widget init must run during that
    // hidden pass so first-frame display/motion patches settle before the layer is revealed.
    const widgetBlueprintLifecycleReady = true;

    const handleRuntimeSubscriptionsReady = useCallback(() => {
        setSurfaceRuntimeSubscriptionsReadyKey(entry.key);
    }, [entry.key]);

    // The ref is the live copy (a blueprint can patch a widget between renders); the state copy is
    // what makes a patch re-render. Reading both, in that order, is the existing contract - the only
    // change here is that "nothing to report" is one shared object instead of a fresh literal.
    const widgetRuntimePatches =
        widgetPatchesByScopeRef.current[entry.runtimeScopeId] ??
        widgetPatchesByScope[entry.runtimeScopeId] ??
        NO_WIDGET_RUNTIME_PATCHES;
    const getWidgetRuntimePatches = useCallback(
        () =>
            widgetPatchesByScopeRef.current[entry.runtimeScopeId] ??
            widgetPatchesByScope[entry.runtimeScopeId] ??
            NO_WIDGET_RUNTIME_PATCHES,
        [entry.runtimeScopeId, widgetPatchesByScope, widgetPatchesByScopeRef],
    );

    useEffect(() => {
        if (hostAdapterBundle.hostAdapter.blueprintRuntime) {
            hostAdapterBundle.hostAdapter.blueprintRuntime.getSurfaceTransitionState = () => transitionStateRef.current;
        }
    }, [hostAdapterBundle.hostAdapter]);

    const runTransitionCommands = useCallback(
        (commands: readonly LifecycleCommand[]) => {
            executeLifecycleCommands(commands, {
                openScope: () => undefined,
                closeScope: () => undefined,
                dispatchSurfaceEvent: command => {
                    void hostAdapterBundle.hostAdapter.blueprintRuntime?.dispatchSurfaceBlueprintEvent?.(command.eventName);
                },
                setTransitionState: state => {
                    transitionStateRef.current = state;
                },
                bumpLifecycleSignal: signal => {
                    setSurfaceLifecycleSignals(prev => ({
                        ...prev,
                        [signal]: prev[signal] + 1,
                    }));
                },
                clearInteraction: scopeId => widgetRuntimeStore.clearInteractionStateForScope(scopeId),
            });
        },
        [hostAdapterBundle.hostAdapter, widgetRuntimeStore],
    );

    const makeStateAccessors = useCallback(
        (runtimeScopeId: string) => {
            const store = core.scopeBridge.getSurfaceStore(runtimeScopeId);
            return {
                get: (key: string) => store.get(key),
                set: (key: string, value: unknown) => store.set(key, value),
            };
        },
        [core.scopeBridge],
    );

    const layerBackgroundColor = getSurfaceLayerBackgroundColor(surface, entry.presentation);
    // The animation layer already covers the whole viewport, so the scrim goes on it rather than on
    // an extra element. As a gradient over the scrim colour, not instead of it: an entry may carry a
    // background of its own, and that one has to stay on top of the sheet it is being lifted off.
    const layerBackgroundStyle: CSSProperties = scrim
        ? {
            backgroundColor: SURFACE_LAYER_SCRIM_COLOR,
            backgroundImage: `linear-gradient(${layerBackgroundColor}, ${layerBackgroundColor})`,
        }
        : { backgroundColor: layerBackgroundColor };

    // The Page's own animation may have to wait for its contents to leave first, so the delays come
    // from the timing plan rather than straight off the settings. Cached on the bundle's element
    // table, so this is the same object the element tree below resolves.
    const animationDelays = useMemo(() => {
        const timings = getSurfaceAnimationTimings({
            elements: uidoc.elements,
            surface,
            reducedMotion,
            cache: true,
        });
        return { enterMs: timings.ownEnterDelayMs, exitMs: timings.ownExitDelayMs };
    }, [reducedMotion, surface, uidoc.elements]);
    const pageMotion = useMemo(
        () => resolvePageAnimationMotion({
            settings: surface.settings?.pageAnimation,
            navigationDirection: entry.direction,
            reducedMotion,
            delays: animationDelays,
        }),
        [animationDelays, entry.direction, reducedMotion, surface.settings?.pageAnimation],
    );
    const resolveExit = useCallback(
        (direction: PageAnimationNavigationDirection) =>
            resolvePageAnimationMotion({
                settings: surface.settings?.pageAnimation,
                navigationDirection: direction,
                reducedMotion,
                delays: animationDelays,
            }).exit,
        [animationDelays, reducedMotion, surface.settings?.pageAnimation],
    );

    const handleBeforeExit = useCallback(
        (entryKey: string) => {
            if (entryKey !== entry.key) {
                return;
            }
            // Leaving un-arrives the entry, which drops it out of the readiness report below. An
            // entry that never finished arriving is already out of it, and React skips the
            // re-render, so there is nothing to report either way.
            setEnteredEntryKey(null);
            runTransitionCommands(lifecycleRef.current.beforeExit(hostAdapterBundle.runtimeScopeId, surface.id));
        },
        [
            entry.key,
            hostAdapterBundle.runtimeScopeId,
            lifecycleRef,
            runTransitionCommands,
            surface.id,
        ],
    );

    const handleEnterComplete = useCallback(
        (entryKey: string) => {
            if (entryKey === entry.key) {
                runTransitionCommands(lifecycleRef.current.enterComplete(hostAdapterBundle.runtimeScopeId, surface.id));
                setEnteredEntryKey(entry.key);
            }
            onEnterComplete(entryKey);
        },
        [
            entry.key,
            hostAdapterBundle.runtimeScopeId,
            lifecycleRef,
            onEnterComplete,
            runTransitionCommands,
            surface.id,
        ],
    );

    /**
     * Tell the host whether this entry takes input, in both directions, from the same expression the
     * layer is rendered with - so what the host believes cannot drift from what is on screen. Split
     * across the transition callbacks it used to be, only the losing direction had anywhere to fire
     * from: going inert had an owner, coming back did not. (Unmount is the exception, below: there
     * is no render left to derive it from.)
     *
     * Pointer state is dropped on the way out only. An entry that is arriving has none to drop, and
     * one being handed input back has none left from when it lost it.
     */
    useEffect(() => {
        if (!active) {
            widgetRuntimeStore.clearInteractionStateForScope(hostAdapterBundle.runtimeScopeId);
        }
        onInteractionReadyChange(entry.key, active && enteredThisEntry);
    }, [
        active,
        enteredThisEntry,
        entry.key,
        hostAdapterBundle.runtimeScopeId,
        onInteractionReadyChange,
        widgetRuntimeStore,
    ]);

    useEffect(() => () => {
        widgetRuntimeStore.clearInteractionStateForScope(hostAdapterBundle.runtimeScopeId);
        onInteractionReadyChange(entry.key, false);
    }, [entry.key, hostAdapterBundle.runtimeScopeId, onInteractionReadyChange, widgetRuntimeStore]);

    return (
        <SurfaceAnimationLayer
            prepaintKey={entry.key}
            direction={entry.direction}
            pageMotion={pageMotion}
            // This layer wraps the scaled surface content (it is outside the design→backing
            // transform), so page-animation distances must be scaled from design px here.
            // Nested in-tree layers (SurfaceElementTree) keep the default scale of 1.
            scale={scale}
            className="absolute inset-0 flex items-center justify-center"
            style={layerBackgroundStyle}
            presentZIndex={10 + layerIndex}
            exitZIndex={entry.exitBehind ? 0 : 30 + layerIndex}
            surfaceId={surface.id}
            surfaceKind={surface.kind}
            resolveExit={resolveExit}
            interactive={effectiveInteractive}
            onPrepaintReady={onPrepaintReady}
            onBeforeExit={handleBeforeExit}
            onEnterComplete={handleEnterComplete}
        >
            <SurfaceLifecycleBoundary
                core={surfaceBlueprintLifecycleReady ? core : null}
                blueprintDocument={blueprintDocument}
                persistentVariables={persistentVariables}
                surface={surface}
                runtimeScopeId={hostAdapterBundle.runtimeScopeId}
                hostAdapter={hostAdapterBundle.hostAdapter}
                lifecycleRef={lifecycleRef}
                makeStateAccessors={makeStateAccessors}
            >
                <WidgetRuntimeStateProvider externalStore={widgetRuntimeStore}>
                    <GameSurfaceRenderer
                        document={uidoc}
                        surface={surface}
                        rendererRegistry={rendererRegistry}
                        scale={scale}
                        // Already painted on the animation layer above, with the presentation
                        // applied. Painting the authored colour again here would lay an opaque
                        // sheet back over a thinned overlay.
                        backgroundColor="transparent"
                        // The picture, unlike the colour, cannot be hoisted onto the animation layer:
                        // it belongs to the design box, which is this level down. Only the
                        // presentation's thinning comes from up here.
                        backgroundImageOpacity={getSurfaceLayerBackgroundImageOpacity(entry.presentation)}
                        hostAdapter={hostAdapterBundle.hostAdapter}
                        blueprintBindingContext={hostAdapterBundle.bindingContext}
                        widgetRuntimePatches={widgetRuntimePatches}
                        getWidgetRuntimePatches={getWidgetRuntimePatches}
                        nestedSurfaceRuntime={nestedSurfaceRuntime}
                        surfaceLifecycleSignals={surfaceLifecycleSignals}
                        blueprintLifecycleReady={widgetBlueprintLifecycleReady}
                        interactive={effectiveInteractive}
                        keyboardInteractive={effectiveKeyboardInteractive}
                        onRuntimeSubscriptionsReady={handleRuntimeSubscriptionsReady}
                        elementAnimations
                        reducedMotion={reducedMotion}
                        // The uidoc here is the compiled bundle's; nothing edits it in place.
                        staticDocument
                    />
                </WidgetRuntimeStateProvider>
            </SurfaceLifecycleBoundary>
        </SurfaceAnimationLayer>
    );
}

export function AppSurfaceLayerWithAdapter(props: AppSurfaceLayerCommonProps & {
    core: BlueprintRuntimeCore | null;
    createHostAdapterBundle: (entry: AppSurfaceLayerNavEntry, surface: UISurface) => HostAdapterBundle | null;
}) {
    const {
        core,
        entry,
        surface,
        createHostAdapterBundle,
    } = props;
    const hostAdapterBundle = useMemo(
        () => createHostAdapterBundle(entry, surface),
        [createHostAdapterBundle, entry, surface],
    );
    if (!hostAdapterBundle || !core) {
        return null;
    }
    return <AppSurfaceLayer {...props} core={core} hostAdapterBundle={hostAdapterBundle} />;
}
