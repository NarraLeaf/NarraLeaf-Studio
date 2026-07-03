import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type MutableRefObject,
    type ReactNode,
} from "react";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIDocument, UISurface } from "@shared/types/ui-editor/document";
import type { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import type { NestedSurfaceRuntime } from "@/lib/ui-editor/runtime/surface/SurfaceElementTree";
import { GameSurfaceRenderer } from "@/lib/ui-editor/runtime/surface/GameSurfaceRenderer";
import { SurfaceAnimationLayer } from "@/lib/ui-editor/runtime/surface/SurfaceAnimationLayer";
import {
    resolvePageAnimationMotion,
    type PageAnimationNavigationDirection,
} from "@/lib/ui-editor/runtime/pageAnimation";
import { getSurfaceBackgroundColor } from "@/lib/ui-editor/runtime/surfaceBackground";
import { WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import type { BlueprintRuntimeCore } from "@/lib/ui-editor/runtime/game/useBlueprintRuntimeCore";
import type {
    SurfaceNavigationEntry,
    SurfaceNavigationPresentation,
} from "@/lib/ui-editor/runtime/game/surfaceNavigationController";
import type { SurfaceLifecycleManager } from "@/lib/ui-editor/blueprint-runtime/SurfaceLifecycleManager";
import { SurfaceLifecycleBoundary } from "./SurfaceLifecycleBoundary";
import type { WidgetPatchesByScope } from "./widgetRuntimePatches";
import type { HostAdapterBundle, PageProps } from "./types";

/** The slice of a navigation entry the surface layer needs. */
export type AppSurfaceLayerNavEntry = SurfaceNavigationEntry<PageProps, SurfaceNavigationPresentation> & {
    runtimeScopeId: string;
};

type AppSurfaceLayerCommonProps = {
    uidoc: UIDocument;
    blueprintDocument: BlueprintDocument;
    entry: AppSurfaceLayerNavEntry;
    layerIndex: number;
    surface: UISurface;
    rendererRegistry: ElementRendererRegistry;
    scale: number;
    widgetPatchesByScope: WidgetPatchesByScope;
    widgetPatchesByScopeRef: MutableRefObject<WidgetPatchesByScope>;
    widgetRuntimeStore: WidgetRuntimeStateStore;
    lifecycleRef: MutableRefObject<SurfaceLifecycleManager>;
    nestedSurfaceRuntime?: NestedSurfaceRuntime;
    blueprintLifecycleReady: boolean;
    reducedMotion: boolean;
    active: boolean;
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
        onInteractionReadyChange,
        onPrepaintReady,
        onEnterComplete,
    } = props;
    const [surfaceInteractive, setSurfaceInteractive] = useState(false);
    const [surfaceRuntimeSubscriptionsReadyKey, setSurfaceRuntimeSubscriptionsReadyKey] = useState<string | null>(null);
    const [surfaceLifecycleSignals, setSurfaceLifecycleSignals] = useState({
        beforeSurfaceExit: 0,
        afterSurfaceEnter: 0,
    });
    const transitionStateRef = useRef({ isEntering: true, isExiting: false });
    const effectiveInteractive = active && surfaceInteractive;
    const effectiveKeyboardInteractive = active && blueprintLifecycleReady;
    const surfaceRuntimeSubscriptionsReady = surfaceRuntimeSubscriptionsReadyKey === entry.key;
    const surfaceBlueprintLifecycleReady = blueprintLifecycleReady && surfaceRuntimeSubscriptionsReady;
    // SurfaceAnimationLayer keeps new layers hidden until prepaint is ready. Widget init must run during that
    // hidden pass so first-frame display/motion patches settle before the layer is revealed.
    const widgetBlueprintLifecycleReady = true;

    const handleRuntimeSubscriptionsReady = useCallback(() => {
        setSurfaceRuntimeSubscriptionsReadyKey(entry.key);
    }, [entry.key]);

    useEffect(() => {
        if (hostAdapterBundle.hostAdapter.blueprintRuntime) {
            hostAdapterBundle.hostAdapter.blueprintRuntime.getSurfaceTransitionState = () => transitionStateRef.current;
        }
    }, [hostAdapterBundle.hostAdapter]);

    const dispatchSurfaceTransitionEvent = useCallback(
        (eventName: "beforeSurfaceExit" | "afterSurfaceEnter") => {
            transitionStateRef.current =
                eventName === "beforeSurfaceExit"
                    ? { isEntering: false, isExiting: true }
                    : { isEntering: false, isExiting: false };
            void hostAdapterBundle.hostAdapter.blueprintRuntime?.dispatchSurfaceBlueprintEvent?.(eventName);
            setSurfaceLifecycleSignals(prev => ({
                ...prev,
                [eventName]: prev[eventName] + 1,
            }));
        },
        [hostAdapterBundle.hostAdapter],
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

    const pageMotion = useMemo(
        () => resolvePageAnimationMotion({
            settings: surface.settings?.pageAnimation,
            navigationDirection: entry.direction,
            reducedMotion,
        }),
        [entry.direction, reducedMotion, surface.settings?.pageAnimation],
    );
    const resolveExit = useCallback(
        (direction: PageAnimationNavigationDirection) =>
            resolvePageAnimationMotion({
                settings: surface.settings?.pageAnimation,
                navigationDirection: direction,
                reducedMotion,
            }).exit,
        [reducedMotion, surface.settings?.pageAnimation],
    );

    const handleBeforeExit = useCallback(
        (entryKey: string) => {
            if (entryKey !== entry.key) {
                return;
            }
            setSurfaceInteractive(false);
            widgetRuntimeStore.clearInteractionStateForScope(hostAdapterBundle.runtimeScopeId);
            onInteractionReadyChange(entry.key, false);
            dispatchSurfaceTransitionEvent("beforeSurfaceExit");
        },
        [
            dispatchSurfaceTransitionEvent,
            entry.key,
            hostAdapterBundle.runtimeScopeId,
            onInteractionReadyChange,
            widgetRuntimeStore,
        ],
    );

    const handleEnterComplete = useCallback(
        (entryKey: string) => {
            if (entryKey === entry.key) {
                dispatchSurfaceTransitionEvent("afterSurfaceEnter");
                setSurfaceInteractive(active);
                onInteractionReadyChange(entry.key, active);
            }
            onEnterComplete(entryKey);
        },
        [active, dispatchSurfaceTransitionEvent, entry.key, onEnterComplete, onInteractionReadyChange],
    );

    useEffect(() => {
        if (active) {
            return;
        }
        setSurfaceInteractive(false);
        widgetRuntimeStore.clearInteractionStateForScope(hostAdapterBundle.runtimeScopeId);
        onInteractionReadyChange(entry.key, false);
    }, [
        active,
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
            className="absolute inset-0 flex items-center justify-center"
            style={{ backgroundColor: getSurfaceBackgroundColor(surface) }}
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
                        hostAdapter={hostAdapterBundle.hostAdapter}
                        blueprintBindingContext={hostAdapterBundle.bindingContext}
                        widgetRuntimePatches={
                            widgetPatchesByScopeRef.current[entry.runtimeScopeId] ??
                            widgetPatchesByScope[entry.runtimeScopeId] ??
                            {}
                        }
                        getWidgetRuntimePatches={() =>
                            widgetPatchesByScopeRef.current[entry.runtimeScopeId] ??
                            widgetPatchesByScope[entry.runtimeScopeId] ??
                            {}
                        }
                        nestedSurfaceRuntime={nestedSurfaceRuntime}
                        surfaceLifecycleSignals={surfaceLifecycleSignals}
                        blueprintLifecycleReady={widgetBlueprintLifecycleReady}
                        interactive={effectiveInteractive}
                        keyboardInteractive={effectiveKeyboardInteractive}
                        onRuntimeSubscriptionsReady={handleRuntimeSubscriptionsReady}
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
