import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ComponentProps,
    type Dispatch,
    type MutableRefObject,
    type ReactNode,
    type SetStateAction,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check } from "lucide-react";
import { Dialog as NlrDialog, FixedAspectRatioContainer, Game, type LiveGame, type SavedGame } from "narraleaf-react";
import type { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import type { UISurface, UIDocument, UIStageSlotId, UIStageSurface } from "@shared/types/ui-editor/document";
import type { DevModeBundle, DevModeStartStoryRequest } from "@shared/types/devMode";
import type { BlueprintPersistenceProjectRef } from "@shared/types/ipcEvents";
import type { DevModeSaveProjectRef } from "@shared/types/devModeSave";
import { toBlueprintImageAsset, type BlueprintImageAsset } from "@shared/types/blueprint/valueTypes";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import type { NestedSurfaceRuntime } from "@/lib/ui-editor/runtime/surface/SurfaceElementTree";
import { DevModeSurfaceRenderer } from "./DevModeSurfaceRenderer";
import {
    SURFACE_PREPAINT_TIMEOUT_MS,
    SurfaceAnimationLayer,
} from "@/lib/ui-editor/runtime/surface/SurfaceAnimationLayer";
import { BlueprintRuntimeDebugPanel } from "./BlueprintRuntimeDebugPanel";
import { useDevModeBlueprintRuntime } from "../hooks/useDevModeBlueprintRuntime";
import { createDevModeBlueprintHostApi, type DevModeWidgetRuntimePatch } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { createDevModeBlueprintHostAdapter } from "@/lib/ui-editor/runtime/hostAdapters/devModeBlueprintHostAdapter";
import { WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import { dispatchSurfaceBlueprintEvent, dispatchGlobalBlueprintEvent } from "@/lib/ui-editor/blueprint-runtime/BlueprintDispatcher";
import { SurfaceLifecycleManager } from "@/lib/ui-editor/blueprint-runtime/SurfaceLifecycleManager";
import { getInterface } from "@/lib/app/bridge";
import {
    getPageAnimationDurationMs,
    resolvePageAnimationMotion,
    shouldBlockPageAnimationExit,
    type PageAnimationNavigationDirection,
} from "@/lib/ui-editor/runtime/pageAnimation";
import { NlrStageLayer, type NlrStageSession } from "../nlr/NlrStageLayer";
import { compileStudioStoryToNlr } from "../nlr/storyCompiler";
import {
    clearDevModeSavePreviewImages,
    registerDevModeSavePreviewImage,
} from "@/lib/ui-editor/runtime/devModeSavePreviewAssets";

type DevModeContentProps = {
    bundle: DevModeBundle | null;
    projectPath: string | null;
    surface: UISurface | null;
    surfaceId: string;
    rendererRegistry: ElementRendererRegistry;
    scale: number;
    handleAspectUpdate: (metrics: { scale: number }) => void;
    sessionError: string | null;
    onDismissSessionError: () => void;
};

const staticDevHostAdapter = (surface: UISurface): UIHostAdapter => ({
    host: surface.host,
});

const noopHostAdapter: UIHostAdapter = {
    host: "app",
};

type DevModeNavEntry = {
    key: string;
    surfaceId: string;
    direction: PageAnimationNavigationDirection;
    waitForExit: boolean;
};

type DevModeBlueprintRuntimeCore = NonNullable<ReturnType<typeof useDevModeBlueprintRuntime>>;

type SurfaceStateAccessors = {
    get: (key: string) => unknown;
    set: (key: string, value: unknown) => void;
};

function keyboardBlueprintPayload(event: KeyboardEvent): Record<string, unknown> {
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

function waitForAnimationFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

function SessionErrorBanner(props: {
    sessionError: string | null;
    onDismissSessionError: () => void;
}): ReactNode {
    const { sessionError, onDismissSessionError } = props;
    if (!sessionError) {
        return null;
    }
    return (
        <div className="shrink-0 border-b border-red-900/60 bg-red-950/80 px-3 py-2 text-xs text-red-100">
            <div className="flex items-start justify-between gap-2">
                <pre className="max-h-24 flex-1 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-snug">
                    {sessionError}
                </pre>
                <button
                    type="button"
                    className="shrink-0 rounded border border-red-700/80 px-2 py-0.5 text-[11px] text-red-100 hover:bg-red-900/50"
                    onClick={onDismissSessionError}
                >
                    Dismiss
                </button>
            </div>
        </div>
    );
}

function DevModeSurfaceLifecycleLayer(props: {
    bpCore: DevModeBlueprintRuntimeCore | null;
    bundle: DevModeBundle;
    surface: UISurface;
    runtimeScopeId: string;
    hostAdapter: UIHostAdapter;
    lifecycleRef: MutableRefObject<SurfaceLifecycleManager>;
    makeStateAccessors: (surfaceId: string) => SurfaceStateAccessors | null;
    children: ReactNode;
}) {
    const { bpCore, bundle, surface, runtimeScopeId, hostAdapter, lifecycleRef, makeStateAccessors, children } = props;

    useEffect(() => {
        if (!bpCore || !hostAdapter.blueprintRuntime) {
            return;
        }
        bpCore.executionManager.openScope(runtimeScopeId);
        const shouldInit = lifecycleRef.current.onSurfaceEnter(runtimeScopeId);
        if (!shouldInit) {
            return;
        }
        const acc = makeStateAccessors(runtimeScopeId);
        if (!acc) {
            return;
        }
        void dispatchSurfaceBlueprintEvent({
            blueprintDocument: bundle.ui.localBlueprints,
            surfaceId: surface.id,
            runtimeScopeId,
            eventName: "surfaceInit",
            hostAdapter,
            debug: bpCore.debug,
            getSurfaceState: acc.get,
            setSurfaceState: acc.set,
            executionManager: bpCore.executionManager,
        });
    }, [bpCore, bundle, hostAdapter, lifecycleRef, makeStateAccessors, runtimeScopeId, surface.id]);

    useEffect(() => {
        if (!bpCore || !hostAdapter.blueprintRuntime) {
            return undefined;
        }
        const surfaceToUnmount = surface.id;
        const scopeToUnmount = runtimeScopeId;
        return () => {
            lifecycleRef.current.onSurfaceExit(scopeToUnmount);
            bpCore.executionManager.closeScope(scopeToUnmount, "Surface unmounted");
            const acc = makeStateAccessors(scopeToUnmount);
            if (!acc) {
                return;
            }
            void dispatchSurfaceBlueprintEvent({
                blueprintDocument: bundle.ui.localBlueprints,
                surfaceId: surfaceToUnmount,
                runtimeScopeId: scopeToUnmount,
                eventName: "surfaceUnmount",
                hostAdapter,
                debug: bpCore.debug,
                getSurfaceState: acc.get,
                setSurfaceState: acc.set,
                executionManager: bpCore.executionManager,
                allowClosedScopeExecution: true,
            });
        };
    }, [bpCore, bundle, hostAdapter, makeStateAccessors, runtimeScopeId, surface.id]);

    return <>{children}</>;
}

function findStageSurfaceForSlot(document: UIDocument, slotId: UIStageSlotId): UIStageSurface | null {
    const matches = document.surfaces.filter((surface): surface is UIStageSurface =>
        surface.kind === "stageSurface" && surface.mount.slotId === slotId
    );
    if (matches.length > 1) {
        console.warn(
            `[DevMode][GameUI] Multiple active surfaces found for slot "${slotId}". ` +
            `Using the first surface in document order: ${matches[0]?.id ?? "(unknown)"}.`,
        );
    }
    return matches[0] ?? null;
}

function dialogSlotRuntimeScopeId(sessionId: string, surfaceId: string): string {
    return `nlr:${sessionId}:slot:dialog:${surfaceId}`;
}

function StudioDialogSlotSurface(props: {
    sessionId: string;
    bpCore: DevModeBlueprintRuntimeCore | null;
    bundle: DevModeBundle;
    surface: UIStageSurface;
    rendererRegistry: ElementRendererRegistry;
    lifecycleRef: MutableRefObject<SurfaceLifecycleManager>;
    makeStateAccessors: (surfaceId: string) => SurfaceStateAccessors | null;
    openSurfaceWithTransition: (surfaceId: string) => Promise<void>;
    closeLayerWithTransition: () => Promise<void>;
    startStoryInGame: (request: DevModeStartStoryRequest) => Promise<void>;
    writeSaveInGame: (id: string) => Promise<void>;
    loadSaveInGame: (id: string) => Promise<void>;
    listSaveIds: () => Promise<string[]>;
    getSavePreview: (id: string) => Promise<BlueprintImageAsset | null>;
    setWidgetPatchesByScope: Dispatch<SetStateAction<Record<string, Record<string, DevModeWidgetRuntimePatch>>>>;
    widgetPatchesByScopeRef: MutableRefObject<Record<string, Record<string, DevModeWidgetRuntimePatch>>>;
    widgetRuntimeStore: WidgetRuntimeStateStore;
}) {
    const {
        sessionId,
        bpCore,
        bundle,
        surface,
        rendererRegistry,
        lifecycleRef,
        makeStateAccessors,
        openSurfaceWithTransition,
        closeLayerWithTransition,
        startStoryInGame,
        writeSaveInGame,
        loadSaveInGame,
        listSaveIds,
        getSavePreview,
        setWidgetPatchesByScope,
        widgetPatchesByScopeRef,
        widgetRuntimeStore,
    } = props;
    const runtimeScopeId = useMemo(() => dialogSlotRuntimeScopeId(sessionId, surface.id), [sessionId, surface.id]);
    const hostAdapterRef = useRef<UIHostAdapter | null>(null);
    const document = bundle.ui.uidoc;

    const hostApi = useMemo(() => {
        if (!bpCore) {
            return null;
        }
        return createDevModeBlueprintHostApi({
            document,
            scope: bpCore.scopeBridge,
            activeSurfaceId: surface.id,
            runtimeScopeId,
            emit: e => bpCore.debug.emit(e),
            onOpenSurface: openSurfaceWithTransition,
            onCloseLayer: closeLayerWithTransition,
            onStartStory: startStoryInGame,
            onWriteSave: writeSaveInGame,
            onLoadSave: loadSaveInGame,
            onListSaveIds: listSaveIds,
            onGetSavePreview: getSavePreview,
            onWidgetPatch: (elementId, patch) => {
                setWidgetPatchesByScope(prev => ({
                    ...prev,
                    [runtimeScopeId]: {
                        ...(prev[runtimeScopeId] ?? {}),
                        [elementId]: {
                            ...(prev[runtimeScopeId]?.[elementId] ?? {}),
                            ...patch,
                        },
                    },
                }));
            },
            onElementFlush: (elementId, payload) => {
                void hostAdapterRef.current?.blueprintRuntime?.dispatchElementBlueprintEvent(
                    elementId,
                    "flush",
                    payload,
                );
            },
            widgetRuntimeStore,
        });
    }, [
        bpCore,
        closeLayerWithTransition,
        document,
        openSurfaceWithTransition,
        runtimeScopeId,
        setWidgetPatchesByScope,
        startStoryInGame,
        writeSaveInGame,
        loadSaveInGame,
        listSaveIds,
        getSavePreview,
        surface.id,
        widgetRuntimeStore,
    ]);

    const hostAdapter = useMemo((): UIHostAdapter => {
        if (!bpCore || !hostApi) {
            return {
                ...staticDevHostAdapter(surface),
                gameUiRuntime: { slotId: "dialog" },
            };
        }
        return {
            ...createDevModeBlueprintHostAdapter({
                bundle,
                surface,
                runtimeScopeId,
                scopeBridge: bpCore.scopeBridge,
                debug: bpCore.debug,
                hostApi,
                executionManager: bpCore.executionManager,
            }),
            gameUiRuntime: { slotId: "dialog" },
        };
    }, [bpCore, bundle, hostApi, runtimeScopeId, surface]);

    useEffect(() => {
        hostAdapterRef.current = hostAdapter;
    }, [hostAdapter]);

    const globalStateReader = useMemo(() => {
        if (!bpCore) {
            return undefined;
        }
        return {
            get: (key: string) => bpCore.scopeBridge.globalGet(key),
            subscribe: (listener: () => void) => bpCore.scopeBridge.subscribeGlobals(listener),
        };
    }, [bpCore]);

    const bindingContext = useMemo(() => {
        if (!bpCore) {
            return null;
        }
        return {
            blueprintDocument: bundle.ui.localBlueprints,
            surfaceState: bpCore.scopeBridge.getSurfaceStore(runtimeScopeId),
            debug: bpCore.debug,
            coalescer: bpCore.bindingDebugCoalescer,
            globalState: globalStateReader,
        };
    }, [bpCore, bundle.ui.localBlueprints, globalStateReader, runtimeScopeId]);

    return (
        <NlrDialog style={{ width: "100%", height: "100%", position: "relative" }}>
            <DevModeSurfaceLifecycleLayer
                bpCore={bpCore}
                bundle={bundle}
                surface={surface}
                runtimeScopeId={runtimeScopeId}
                hostAdapter={hostAdapter}
                lifecycleRef={lifecycleRef}
                makeStateAccessors={makeStateAccessors}
            >
                <WidgetRuntimeStateProvider externalStore={widgetRuntimeStore}>
                    <DevModeSurfaceRenderer
                        document={document}
                        surface={surface}
                        rendererRegistry={rendererRegistry}
                        scale={1}
                        hostAdapter={hostAdapter}
                        blueprintBindingContext={bindingContext}
                        widgetRuntimePatches={widgetPatchesByScopeRef.current[runtimeScopeId] ?? {}}
                    />
                </WidgetRuntimeStateProvider>
            </DevModeSurfaceLifecycleLayer>
        </NlrDialog>
    );
}

function createStudioDialogComponent(options: ComponentProps<typeof StudioDialogSlotSurface>) {
    return function StudioDialogGameUI() {
        return <StudioDialogSlotSurface {...options} />;
    };
}

function DevModeAppSurfaceLayer(props: {
    entry: DevModeNavEntry;
    layerIndex: number;
    bpCore: DevModeBlueprintRuntimeCore | null;
    bundle: DevModeBundle;
    uidoc: UIDocument;
    surface: UISurface;
    rendererRegistry: ElementRendererRegistry;
    scale: number;
    lifecycleRef: MutableRefObject<SurfaceLifecycleManager>;
    makeStateAccessors: (surfaceId: string) => SurfaceStateAccessors | null;
    openSurfaceWithTransition: (surfaceId: string) => Promise<void>;
    closeLayerWithTransition: () => Promise<void>;
    startStoryInGame: (request: DevModeStartStoryRequest) => Promise<void>;
    writeSaveInGame: (id: string) => Promise<void>;
    loadSaveInGame: (id: string) => Promise<void>;
    listSaveIds: () => Promise<string[]>;
    getSavePreview: (id: string) => Promise<BlueprintImageAsset | null>;
    setWidgetPatchesByScope: Dispatch<SetStateAction<Record<string, Record<string, DevModeWidgetRuntimePatch>>>>;
    widgetPatchesByScope: Record<string, Record<string, DevModeWidgetRuntimePatch>>;
    widgetPatchesByScopeRef: MutableRefObject<Record<string, Record<string, DevModeWidgetRuntimePatch>>>;
    widgetRuntimeStore: WidgetRuntimeStateStore;
    nestedSurfaceRuntime?: NestedSurfaceRuntime;
    reducedMotion: boolean;
    onPrepaintReady: (entryKey: string) => void;
    onEnterComplete: (entryKey: string) => void;
}) {
    const {
        entry,
        layerIndex,
        bpCore,
        bundle,
        uidoc,
        surface,
        rendererRegistry,
        scale,
        lifecycleRef,
        makeStateAccessors,
        openSurfaceWithTransition,
        closeLayerWithTransition,
        startStoryInGame,
        writeSaveInGame,
        loadSaveInGame,
        listSaveIds,
        getSavePreview,
        setWidgetPatchesByScope,
        widgetPatchesByScope,
        widgetPatchesByScopeRef,
        widgetRuntimeStore,
        nestedSurfaceRuntime,
        reducedMotion,
        onPrepaintReady,
        onEnterComplete,
    } = props;
    const runtimeScopeId = entry.key || surface.id;
    const hostAdapterRef = useRef<UIHostAdapter | null>(null);

    const hostApi = useMemo(() => {
        if (!bpCore) {
            return null;
        }
        return createDevModeBlueprintHostApi({
            document: uidoc,
            scope: bpCore.scopeBridge,
            activeSurfaceId: surface.id,
            runtimeScopeId,
            emit: e => bpCore.debug.emit(e),
            onOpenSurface: openSurfaceWithTransition,
            onCloseLayer: closeLayerWithTransition,
            onStartStory: startStoryInGame,
            onWriteSave: writeSaveInGame,
            onLoadSave: loadSaveInGame,
            onListSaveIds: listSaveIds,
            onGetSavePreview: getSavePreview,
            onWidgetPatch: (elementId, patch) => {
                setWidgetPatchesByScope(prev => ({
                    ...prev,
                    [runtimeScopeId]: {
                        ...(prev[runtimeScopeId] ?? {}),
                        [elementId]: {
                            ...(prev[runtimeScopeId]?.[elementId] ?? {}),
                            ...patch,
                        },
                    },
                }));
            },
            onElementFlush: (elementId, payload) => {
                void hostAdapterRef.current?.blueprintRuntime?.dispatchElementBlueprintEvent(
                    elementId,
                    "flush",
                    payload,
                );
            },
            widgetRuntimeStore,
        });
    }, [
        bpCore,
        closeLayerWithTransition,
        openSurfaceWithTransition,
        runtimeScopeId,
        setWidgetPatchesByScope,
        startStoryInGame,
        writeSaveInGame,
        loadSaveInGame,
        listSaveIds,
        getSavePreview,
        surface.id,
        uidoc,
        widgetRuntimeStore,
    ]);

    const hostAdapter = useMemo((): UIHostAdapter => {
        if (!bpCore || !hostApi) {
            return staticDevHostAdapter(surface);
        }
        return createDevModeBlueprintHostAdapter({
            bundle,
            surface,
            runtimeScopeId,
            scopeBridge: bpCore.scopeBridge,
            debug: bpCore.debug,
            hostApi,
            executionManager: bpCore.executionManager,
        });
    }, [bpCore, bundle, hostApi, runtimeScopeId, surface]);

    useEffect(() => {
        hostAdapterRef.current = hostAdapter;
    }, [hostAdapter]);

    const globalStateReader = useMemo(() => {
        if (!bpCore) {
            return undefined;
        }
        return {
            get: (key: string) => bpCore.scopeBridge.globalGet(key),
            subscribe: (listener: () => void) => bpCore.scopeBridge.subscribeGlobals(listener),
        };
    }, [bpCore]);

    const bindingContext =
        bpCore != null
            ? {
                  blueprintDocument: bundle.ui.localBlueprints,
                  surfaceState: bpCore.scopeBridge.getSurfaceStore(runtimeScopeId),
                  debug: bpCore.debug,
                  coalescer: bpCore.bindingDebugCoalescer,
                  globalState: globalStateReader,
              }
            : null;

    const pageMotion = resolvePageAnimationMotion({
        settings: surface.settings?.pageAnimation,
        navigationDirection: entry.direction,
        reducedMotion,
    });
    const resolveExit = useCallback(
        (direction: PageAnimationNavigationDirection) =>
            resolvePageAnimationMotion({
                settings: surface.settings?.pageAnimation,
                navigationDirection: direction,
                reducedMotion,
            }).exit,
        [reducedMotion, surface.settings?.pageAnimation],
    );

    return (
        <SurfaceAnimationLayer
            prepaintKey={entry.key}
            direction={entry.direction}
            pageMotion={pageMotion}
            className="absolute inset-0 flex items-center justify-center"
            presentZIndex={10 + layerIndex}
            exitZIndex={30 + layerIndex}
            resolveExit={resolveExit}
            onPrepaintReady={onPrepaintReady}
            onEnterComplete={onEnterComplete}
        >
            <DevModeSurfaceLifecycleLayer
                bpCore={bpCore}
                bundle={bundle}
                surface={surface}
                runtimeScopeId={runtimeScopeId}
                hostAdapter={hostAdapter}
                lifecycleRef={lifecycleRef}
                makeStateAccessors={makeStateAccessors}
            >
                <WidgetRuntimeStateProvider externalStore={widgetRuntimeStore}>
                    <DevModeSurfaceRenderer
                        document={uidoc}
                        surface={surface}
                        rendererRegistry={rendererRegistry}
                        scale={scale}
                        hostAdapter={hostAdapter}
                        blueprintBindingContext={bindingContext}
                        widgetRuntimePatches={widgetPatchesByScopeRef.current[runtimeScopeId] ?? widgetPatchesByScope[runtimeScopeId] ?? {}}
                        nestedSurfaceRuntime={nestedSurfaceRuntime}
                    />
                </WidgetRuntimeStateProvider>
            </DevModeSurfaceLifecycleLayer>
        </SurfaceAnimationLayer>
    );
}

export function DevModeContent(props: DevModeContentProps) {
    const {
        bundle,
        projectPath,
        surface,
        surfaceId,
        rendererRegistry,
        scale,
        handleAspectUpdate,
        sessionError,
        onDismissSessionError,
    } = props;
    const uiDocument: UIDocument | null = bundle?.ui.uidoc ?? null;
    const bpCore = useDevModeBlueprintRuntime(bundle);
    const prefersReducedMotion = useReducedMotion();
    const [navStack, setNavStack] = useState<DevModeNavEntry[]>([]);
    const [visibleEntries, setVisibleEntries] = useState<DevModeNavEntry[]>([]);
    const [surfacePresenceMode, setSurfacePresenceMode] = useState<"sync" | "wait">("sync");
    const navEntrySeqRef = useRef(0);
    const activeNavKeyRef = useRef<string | null>(null);
    const activeEntryRef = useRef<DevModeNavEntry | null>(null);
    const activeSurfaceRef = useRef<UISurface | null>(null);
    const pendingWaitEntryRef = useRef<DevModeNavEntry | null>(null);
    const pendingUnderlayReadyKeyRef = useRef<string | null>(null);
    const transitionDirectionRef = useRef<PageAnimationNavigationDirection>("forward");
    const transitionWaitRef = useRef<{
        resolve: (() => void) | null;
        timeoutId: ReturnType<typeof setTimeout> | null;
        enterDone: boolean;
        exitDone: boolean;
    }>({ resolve: null, timeoutId: null, enterDone: true, exitDone: true });
    const [widgetPatchesByScope, setWidgetPatchesByScope] = useState<Record<string, Record<string, DevModeWidgetRuntimePatch>>>({});
    const widgetPatchesByScopeRef = useRef(widgetPatchesByScope);
    const hostAdapterRef = useRef<UIHostAdapter | null>(null);
    const [devtoolsMenuOpen, setDevtoolsMenuOpen] = useState(false);
    const [blueprintPanelOpen, setBlueprintPanelOpen] = useState(false);
    const devtoolsFabRef = useRef<HTMLButtonElement>(null);
    const devtoolsMenuRef = useRef<HTMLDivElement>(null);
    const [nlrSession, setNlrSession] = useState<NlrStageSession | null>(null);
    const [gameStageVisible, setGameStageVisible] = useState(false);
    const [studioPageHiddenForGame, setStudioPageHiddenForGame] = useState(false);
    const nlrSessionSeqRef = useRef(0);
    const activeStoryRequestRef = useRef<DevModeStartStoryRequest | null>(null);
    const activeStoryRevisionRef = useRef<number | null>(null);
    const startStoryInGameRef = useRef<((request: DevModeStartStoryRequest) => Promise<void>) | null>(null);
    const writeSaveInGameRef = useRef<((id: string) => Promise<void>) | null>(null);
    const loadSaveInGameRef = useRef<((id: string) => Promise<void>) | null>(null);
    const listSaveIdsRef = useRef<(() => Promise<string[]>) | null>(null);
    const getSavePreviewRef = useRef<((id: string) => Promise<BlueprintImageAsset | null>) | null>(null);
    const nlrLiveGameRef = useRef<LiveGame | null>(null);
    const nlrLiveGameSessionIdRef = useRef<string | null>(null);
    const pendingGameStartsRef = useRef(new Map<string, { resolve: () => void; reject: (error: Error) => void }>());
    const lifecycleRef = useRef<SurfaceLifecycleManager>(new SurfaceLifecycleManager());
    const appBootFiredRef = useRef<string | null>(null);
    const persistenceProjectRef = useMemo<BlueprintPersistenceProjectRef | null>(() => {
        if (!projectPath) {
            return null;
        }
        const rawIdentifier = bundle?.meta?.projectIdentifier;
        const projectIdentifier =
            typeof rawIdentifier === "string" && rawIdentifier.trim() ? rawIdentifier.trim() : undefined;
        return {
            projectIdentifier,
            projectPath,
        };
    }, [bundle?.meta?.projectIdentifier, projectPath]);
    const saveProjectRef = useMemo<DevModeSaveProjectRef | null>(() => {
        if (!projectPath) {
            return null;
        }
        const rawIdentifier = bundle?.meta?.projectIdentifier;
        const projectIdentifier =
            typeof rawIdentifier === "string" && rawIdentifier.trim() ? rawIdentifier.trim() : undefined;
        return {
            projectIdentifier,
            projectPath,
        };
    }, [bundle?.meta?.projectIdentifier, projectPath]);

    useEffect(() => {
        if (surface?.id) {
            navEntrySeqRef.current += 1;
            const initialEntry: DevModeNavEntry = {
                key: `${surface.id}:${navEntrySeqRef.current}`,
                surfaceId: surface.id,
                direction: "forward",
                waitForExit: false,
            };
            pendingWaitEntryRef.current = null;
            pendingUnderlayReadyKeyRef.current = null;
            transitionDirectionRef.current = "forward";
            setSurfacePresenceMode("sync");
            setNavStack([initialEntry]);
            setVisibleEntries([initialEntry]);
            setWidgetPatchesByScope({});
        }
    }, [surface?.id, bundle?.revision, bundle?.bundleId]);

    useEffect(() => {
        widgetPatchesByScopeRef.current = widgetPatchesByScope;
    }, [widgetPatchesByScope]);

    useEffect(() => {
        if (!bpCore) {
            setDevtoolsMenuOpen(false);
            setBlueprintPanelOpen(false);
        }
    }, [bpCore]);

    useEffect(() => {
        if (!bpCore) {
            return undefined;
        }
        if (!persistenceProjectRef) {
            bpCore.scopeBridge.setPersistenceAdapter(null);
            return undefined;
        }
        const projectRef = persistenceProjectRef;
        bpCore.scopeBridge.setPersistenceAdapter({
            getAll: async () => {
                const result = await getInterface().blueprintPersistence.getAll(projectRef);
                if (!result.success) {
                    throw new Error(result.error ?? "Failed to read Blueprint persistent values");
                }
                return result.data.values;
            },
            getValue: async (key: string) => {
                const result = await getInterface().blueprintPersistence.getValue(projectRef, key);
                if (!result.success) {
                    throw new Error(result.error ?? `Failed to read Blueprint persistent value "${key}"`);
                }
                return result.data.value;
            },
            setValue: async (key: string, value: unknown) => {
                const result = await getInterface().blueprintPersistence.setValue(projectRef, key, value);
                if (!result.success) {
                    throw new Error(result.error ?? `Failed to write Blueprint persistent value "${key}"`);
                }
            },
            removeValue: async (key: string) => {
                const result = await getInterface().blueprintPersistence.removeValue(projectRef, key);
                if (!result.success) {
                    throw new Error(result.error ?? `Failed to remove Blueprint persistent value "${key}"`);
                }
            },
        });
        return () => {
            bpCore.scopeBridge.setPersistenceAdapter(null);
        };
    }, [bpCore, persistenceProjectRef]);

    useEffect(() => {
        if (!devtoolsMenuOpen) {
            return;
        }
        const onPointerDown = (e: PointerEvent) => {
            const t = e.target as Node;
            if (devtoolsFabRef.current?.contains(t)) {
                return;
            }
            if (devtoolsMenuRef.current?.contains(t)) {
                return;
            }
            setDevtoolsMenuOpen(false);
        };
        document.addEventListener("pointerdown", onPointerDown, true);
        return () => document.removeEventListener("pointerdown", onPointerDown, true);
    }, [devtoolsMenuOpen]);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Escape") {
                return;
            }
            if (devtoolsMenuOpen) {
                setDevtoolsMenuOpen(false);
                e.preventDefault();
                return;
            }
            if (blueprintPanelOpen) {
                setBlueprintPanelOpen(false);
                e.preventDefault();
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [devtoolsMenuOpen, blueprintPanelOpen]);

    const activeEntry = navStack.length > 0 ? navStack[navStack.length - 1]! : null;
    const activeSurface = useMemo((): UISurface | null => {
        if (!bundle || !surface || !uiDocument) {
            return null;
        }
        const activeSurfaceId = activeEntry?.surfaceId ?? surface.id;
            return uiDocument.surfaces.find(s => s.id === activeSurfaceId) ?? surface;
    }, [activeEntry?.surfaceId, bundle, surface, uiDocument]);
    const activeRuntimeScopeId = activeEntry?.key ?? activeSurface?.id ?? surface?.id ?? "";

    useEffect(() => {
        activeNavKeyRef.current = activeEntry?.key ?? null;
        activeEntryRef.current = activeEntry;
        activeSurfaceRef.current = activeSurface;
    }, [activeEntry, activeSurface]);

    const widgetRuntimeStore = useMemo(
        () => new WidgetRuntimeStateStore(),
        [bundle?.revision ?? 0, bundle?.bundleId ?? ""],
    );

    const completeTransitionWait = useCallback(() => {
        const pending = transitionWaitRef.current;
        if (pending.timeoutId) {
            clearTimeout(pending.timeoutId);
        }
        const resolve = pending.resolve;
        transitionWaitRef.current = { resolve: null, timeoutId: null, enterDone: true, exitDone: true };
        resolve?.();
    }, []);

    const tryCompleteTransitionWait = useCallback(() => {
        const pending = transitionWaitRef.current;
        if (pending.resolve && pending.enterDone && pending.exitDone) {
            completeTransitionWait();
        }
    }, [completeTransitionWait]);

    const beginTransitionWait = useCallback(
        (durationMs: number): Promise<void> => {
            completeTransitionWait();
            if (durationMs <= 0) {
                return Promise.resolve();
            }
            return new Promise(resolve => {
                const timeoutId = setTimeout(() => {
                    completeTransitionWait();
                }, durationMs + SURFACE_PREPAINT_TIMEOUT_MS + 180);
                transitionWaitRef.current = {
                    resolve,
                    timeoutId,
                    enterDone: false,
                    exitDone: false,
                };
            });
        },
        [completeTransitionWait],
    );

    const markActiveEnterComplete = useCallback(
        (entryKey: string) => {
            if (entryKey !== activeNavKeyRef.current) {
                return;
            }
            transitionWaitRef.current.enterDone = true;
            tryCompleteTransitionWait();
        },
        [tryCompleteTransitionWait],
    );

    const markExitComplete = useCallback(() => {
        transitionWaitRef.current.exitDone = true;
        tryCompleteTransitionWait();
    }, [tryCompleteTransitionWait]);

    const handleSurfaceLayerPrepaintReady = useCallback((entryKey: string) => {
        if (pendingUnderlayReadyKeyRef.current !== entryKey) {
            return;
        }
        pendingUnderlayReadyKeyRef.current = null;
        setVisibleEntries(prev => prev.filter(entry => entry.key === entryKey));
    }, []);

    const handleSurfaceExitComplete = useCallback(() => {
        markExitComplete();
        const pendingEntry = pendingWaitEntryRef.current;
        if (!pendingEntry) {
            return;
        }
        pendingWaitEntryRef.current = null;
        setSurfacePresenceMode("sync");
        setVisibleEntries([pendingEntry]);
    }, [markExitComplete]);

    const estimateTransitionDuration = useCallback(
        (from: UISurface | null, to: UISurface | null, waitForExit: boolean): number => {
            const reduced = prefersReducedMotion === true;
            const exitDurationMs = getPageAnimationDurationMs(from?.settings?.pageAnimation, "exit", reduced);
            const enterDurationMs = getPageAnimationDurationMs(to?.settings?.pageAnimation, "enter", reduced);
            return waitForExit ? exitDurationMs + enterDurationMs : Math.max(exitDurationMs, enterDurationMs);
        },
        [prefersReducedMotion],
    );

    const shouldWaitForExit = useCallback((from: UISurface | null): boolean => {
        return shouldBlockPageAnimationExit(from?.settings?.pageAnimation, prefersReducedMotion === true);
    }, [prefersReducedMotion]);

    const createNavEntry = useCallback(
        (surfaceId: string, direction: PageAnimationNavigationDirection, waitForExit: boolean): DevModeNavEntry => {
            navEntrySeqRef.current += 1;
            return {
                key: `${surfaceId}:${navEntrySeqRef.current}`,
                surfaceId,
                direction,
                waitForExit,
            };
        },
        [],
    );

    const openSurfaceWithTransition = useCallback(
        (nextSurfaceId: string): Promise<void> => {
            const from = activeSurfaceRef.current;
            const target = uiDocument?.surfaces.find(s => s.id === nextSurfaceId) ?? null;
            const waitForExit = shouldWaitForExit(from);
            const nextEntry = createNavEntry(nextSurfaceId, "forward", waitForExit);
            const currentEntry = activeEntryRef.current;
            transitionDirectionRef.current = "forward";
            const wait = beginTransitionWait(estimateTransitionDuration(from, target, waitForExit));
            pendingWaitEntryRef.current = waitForExit ? nextEntry : null;
            pendingUnderlayReadyKeyRef.current = waitForExit ? null : nextEntry.key;
            setSurfacePresenceMode(waitForExit ? "wait" : "sync");
            setNavStack(prev => [...prev, nextEntry]);
            if (waitForExit) {
                setVisibleEntries([]);
            } else {
                setVisibleEntries(prev => {
                    const currentVisual = currentEntry ?? prev[prev.length - 1] ?? null;
                    if (!currentVisual || currentVisual.key === nextEntry.key) {
                        return [nextEntry];
                    }
                    return [nextEntry, currentVisual];
                });
            }
            return wait;
        },
        [beginTransitionWait, createNavEntry, estimateTransitionDuration, shouldWaitForExit, uiDocument?.surfaces],
    );

    const closeLayerWithTransition = useCallback((): Promise<void> => {
        const currentStack = navStack;
        if (currentStack.length <= 1) {
            return Promise.resolve();
        }
        const currentEntry = currentStack[currentStack.length - 1]!;
        const nextEntryBase = currentStack[currentStack.length - 2]!;
        const target = uiDocument?.surfaces.find(s => s.id === nextEntryBase.surfaceId) ?? null;
        const from = activeSurfaceRef.current;
        const waitForExit = shouldWaitForExit(from);
        const nextEntry = { ...nextEntryBase, direction: "back" as const, waitForExit };
        transitionDirectionRef.current = "back";
        const wait = beginTransitionWait(estimateTransitionDuration(from, target, waitForExit));
        pendingWaitEntryRef.current = waitForExit ? nextEntry : null;
        pendingUnderlayReadyKeyRef.current = waitForExit ? null : nextEntry.key;
        setSurfacePresenceMode(waitForExit ? "wait" : "sync");
        setNavStack(prev => {
            if (prev.length <= 1) {
                return prev;
            }
            const next = prev.slice(0, -1);
            const top = next[next.length - 1]!;
            next[next.length - 1] = { ...top, direction: "back", waitForExit };
            return next;
        });
        if (waitForExit) {
            setVisibleEntries([]);
        } else {
            setVisibleEntries([nextEntry, currentEntry]);
        }
        return wait;
    }, [beginTransitionWait, estimateTransitionDuration, navStack, shouldWaitForExit, uiDocument?.surfaces]);

    const makeStateAccessors = useCallback(
        (runtimeScopeId: string) => {
            if (!bpCore) {
                return null;
            }
            const store = bpCore.scopeBridge.getSurfaceStore(runtimeScopeId);
            return {
                get: (key: string) => store.get(key),
                set: (key: string, value: unknown) => store.set(key, value),
            };
        },
        [bpCore],
    );

    const rejectPendingGameStarts = useCallback((error: Error) => {
        pendingGameStartsRef.current.forEach(pending => pending.reject(error));
        pendingGameStartsRef.current.clear();
    }, []);

    const requireSaveProjectRef = useCallback((operation: string): DevModeSaveProjectRef => {
        if (!saveProjectRef) {
            throw new Error(`${operation}: project is not available`);
        }
        return saveProjectRef;
    }, [saveProjectRef]);

    const requireActiveLiveGame = useCallback((operation: string): LiveGame => {
        if (!nlrSession?.id || nlrLiveGameSessionIdRef.current !== nlrSession.id || !nlrLiveGameRef.current) {
            throw new Error(`${operation}: game runtime is not available`);
        }
        return nlrLiveGameRef.current;
    }, [nlrSession?.id]);

    const writeSaveInGame = useCallback(async (id: string): Promise<void> => {
        const projectRef = requireSaveProjectRef("Write Save");
        const liveGame = requireActiveLiveGame("Write Save");
        const savedGame = liveGame.serialize();
        let capture: string | undefined;
        try {
            capture = await liveGame.captureJpeg();
        } catch (error) {
            console.warn("[DevMode][Save] Capture failed; writing save without preview", error);
        }
        const result = await getInterface().devMode.save.write(projectRef, id, savedGame, capture);
        if (!result.success) {
            throw new Error(result.error ?? `Write Save failed: ${id}`);
        }
    }, [requireActiveLiveGame, requireSaveProjectRef]);
    writeSaveInGameRef.current = writeSaveInGame;

    const loadSaveInGame = useCallback(async (id: string): Promise<void> => {
        const projectRef = requireSaveProjectRef("Load Save");
        const liveGame = requireActiveLiveGame("Load Save");
        const result = await getInterface().devMode.save.read(projectRef, id);
        if (!result.success) {
            throw new Error(result.error ?? `Load Save failed: ${id}`);
        }
        const savedGame = result.data.record?.savedGame;
        if (!savedGame) {
            throw new Error(`Load Save: save not found: ${id}`);
        }
        liveGame.game.router.clear().cleanHistory();
        liveGame.newGame().deserialize(savedGame as SavedGame);
        await liveGame.waitForRouterExit().promise;
        setGameStageVisible(true);
        setStudioPageHiddenForGame(true);
    }, [requireActiveLiveGame, requireSaveProjectRef]);
    loadSaveInGameRef.current = loadSaveInGame;

    const listSaveIds = useCallback(async (): Promise<string[]> => {
        const projectRef = requireSaveProjectRef("List Saves");
        const result = await getInterface().devMode.save.listIds(projectRef);
        if (!result.success) {
            throw new Error(result.error ?? "List Saves failed");
        }
        return result.data.ids;
    }, [requireSaveProjectRef]);
    listSaveIdsRef.current = listSaveIds;

    const getSavePreview = useCallback(async (id: string): Promise<BlueprintImageAsset | null> => {
        const projectRef = requireSaveProjectRef("Get Save Preview");
        const result = await getInterface().devMode.save.readPreview(projectRef, id);
        if (!result.success) {
            throw new Error(result.error ?? `Get Save Preview failed: ${id}`);
        }
        const capture = result.data.capture;
        if (!capture) {
            return null;
        }
        return toBlueprintImageAsset(registerDevModeSavePreviewImage(id, capture));
    }, [requireSaveProjectRef]);
    getSavePreviewRef.current = getSavePreview;

    const startStoryInGame = useCallback(async (request: DevModeStartStoryRequest): Promise<void> => {
        if (!bundle?.storyLibrary) {
            throw new Error("Start Game: story library is not available in Dev Mode bundle");
        }
        if (!activeSurface) {
            throw new Error("Start Game: active page is not available");
        }
        const storyId = String(request.storyId ?? "").trim();
        const sceneId = String(request.sceneId ?? "").trim();
        if (!storyId) {
            throw new Error("Start Game: storyId is required");
        }
        if (!sceneId) {
            throw new Error("Start Game: sceneId is required");
        }
        const storyDocument =
            bundle.storyLibrary.documents[storyId] ??
            Object.values(bundle.storyLibrary.documents).find(document => document.id === storyId);
        if (!storyDocument) {
            const indexedStoryIds = bundle.storyLibrary.index.stories.map(story => story.id).join(", ") || "(none)";
            const documentStoryIds = Object.values(bundle.storyLibrary.documents).map(document => document.id).join(", ") || "(none)";
            throw new Error(
                `Start Game: story not found: ${storyId}. ` +
                `Bundle index story ids: ${indexedStoryIds}. Bundle document ids: ${documentStoryIds}.`,
            );
        }
        if (!storyDocument.scenes[sceneId]) {
            throw new Error(`Start Game: scene not found: ${sceneId}`);
        }

        rejectPendingGameStarts(new Error("Start Game superseded by a newer session"));
        activeStoryRequestRef.current = { storyId, sceneId };
        activeStoryRevisionRef.current = bundle.revision;

        const compiled = await compileStudioStoryToNlr({
            document: storyDocument,
            sceneId,
            characters: bundle.storyLibrary.characters,
            animations: bundle.storyLibrary.animations,
            resolveAssetUrl: async (assetId, assetType) => {
                const result = await getInterface().devMode.resolveAssetUrl(assetId, assetType);
                if (!result.success || !result.data?.url) {
                    throw new Error(result.error ?? `Failed to resolve asset: ${assetId}`);
                }
                return result.data.url;
            },
        });
        if (compiled.diagnostics.length > 0) {
            console.warn("[DevMode][NLR] Story compile diagnostics", compiled.diagnostics);
        }

        nlrSessionSeqRef.current += 1;
        const sessionId = `${bundle.bundleId}:${bundle.revision}:${nlrSessionSeqRef.current}`;
        const { width, height } = activeSurface.designSize;
        const dialogSurface = findStageSurfaceForSlot(bundle.ui.uidoc, "dialog");
        const dialogComponent = dialogSurface
            ? createStudioDialogComponent({
                  sessionId,
                  bpCore,
                  bundle,
                  surface: dialogSurface,
                  rendererRegistry,
                  lifecycleRef,
                  makeStateAccessors,
                  openSurfaceWithTransition,
                  closeLayerWithTransition,
                  startStoryInGame: request =>
                      startStoryInGameRef.current?.(request) ??
                      Promise.reject(new Error("Start Game is not available")),
                  writeSaveInGame: id =>
                      writeSaveInGameRef.current?.(id) ??
                      Promise.reject(new Error("Write Save is not available")),
                  loadSaveInGame: id =>
                      loadSaveInGameRef.current?.(id) ??
                      Promise.reject(new Error("Load Save is not available")),
                  listSaveIds: () =>
                      listSaveIdsRef.current?.() ??
                      Promise.reject(new Error("List Saves is not available")),
                  getSavePreview: id =>
                      getSavePreviewRef.current?.(id) ??
                      Promise.reject(new Error("Get Save Preview is not available")),
                  setWidgetPatchesByScope,
                  widgetPatchesByScopeRef,
                  widgetRuntimeStore,
              })
            : undefined;
        const gameConfig: ConstructorParameters<typeof Game>[0] = {
            app: { debug: false },
            width,
            height,
            aspectRatio: width / height,
            ratioUpdateInterval: 0,
            contentContainerId: `__nlr_dev_stage_${sessionId.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
            ...(dialogComponent ? { dialog: dialogComponent, dialogWidth: width, dialogHeight: height } : {}),
        };
        const game = new Game(gameConfig);

        const ready = new Promise<void>((resolve, reject) => {
            pendingGameStartsRef.current.set(sessionId, { resolve, reject });
        });

        setGameStageVisible(false);
        setStudioPageHiddenForGame(false);
        setNlrSession({
            id: sessionId,
            game,
            compiled,
            width,
            height,
        });

        await ready;
        await waitForAnimationFrame();
        setGameStageVisible(true);
        setStudioPageHiddenForGame(true);
    }, [
        activeSurface,
        bpCore,
        bundle,
        closeLayerWithTransition,
        lifecycleRef,
        makeStateAccessors,
        openSurfaceWithTransition,
        rejectPendingGameStarts,
        rendererRegistry,
        widgetRuntimeStore,
    ]);
    startStoryInGameRef.current = startStoryInGame;

    const handleNlrFirstSceneReady = useCallback((sessionId: string) => {
        const pending = pendingGameStartsRef.current.get(sessionId);
        if (!pending) {
            return;
        }
        pendingGameStartsRef.current.delete(sessionId);
        pending.resolve();
    }, []);

    const handleNlrLiveGameReady = useCallback((sessionId: string, liveGame: LiveGame) => {
        if (nlrSession?.id !== sessionId) {
            return;
        }
        nlrLiveGameRef.current = liveGame;
        nlrLiveGameSessionIdRef.current = sessionId;
    }, [nlrSession?.id]);

    const handleNlrStageError = useCallback((error: Error) => {
        rejectPendingGameStarts(error);
        console.error("[DevMode][NLR] Player error", error);
    }, [rejectPendingGameStarts]);

    useEffect(() => {
        if (!bundle || !activeStoryRequestRef.current) {
            return;
        }
        if (activeStoryRevisionRef.current === bundle.revision) {
            return;
        }
        const request = activeStoryRequestRef.current;
        void startStoryInGame(request).catch(error => {
            console.error("[DevMode][NLR] Hot reload restart failed", error);
        });
    }, [bundle, startStoryInGame]);

    useEffect(() => {
        activeStoryRequestRef.current = null;
        activeStoryRevisionRef.current = null;
        rejectPendingGameStarts(new Error("Dev Mode session changed"));
        nlrLiveGameRef.current = null;
        nlrLiveGameSessionIdRef.current = null;
        clearDevModeSavePreviewImages();
        setNlrSession(null);
        setGameStageVisible(false);
        setStudioPageHiddenForGame(false);
    }, [bundle?.bundleId, rejectPendingGameStarts, surface?.id]);

    useEffect(() => {
        nlrLiveGameRef.current = null;
        nlrLiveGameSessionIdRef.current = null;
    }, [nlrSession?.id]);

    const hostApi = useMemo(() => {
        if (!bpCore || !uiDocument || !activeSurface) {
            return null;
        }
        const runtimeScopeId = activeRuntimeScopeId || activeSurface.id;
        return createDevModeBlueprintHostApi({
            document: uiDocument,
            scope: bpCore.scopeBridge,
            activeSurfaceId: activeSurface.id,
            runtimeScopeId,
            emit: e => bpCore.debug.emit(e),
            onOpenSurface: openSurfaceWithTransition,
            onCloseLayer: closeLayerWithTransition,
            onStartStory: startStoryInGame,
            onWriteSave: writeSaveInGame,
            onLoadSave: loadSaveInGame,
            onListSaveIds: listSaveIds,
            onGetSavePreview: getSavePreview,
            onWidgetPatch: (elementId, patch) => {
                setWidgetPatchesByScope(prev => ({
                    ...prev,
                    [runtimeScopeId]: {
                        ...(prev[runtimeScopeId] ?? {}),
                        [elementId]: {
                            ...(prev[runtimeScopeId]?.[elementId] ?? {}),
                            ...patch,
                        },
                    },
                }));
            },
            onElementFlush: (elementId, payload) => {
                void hostAdapterRef.current?.blueprintRuntime?.dispatchElementBlueprintEvent(
                    elementId,
                    "flush",
                    payload,
                );
            },
            widgetRuntimeStore,
        });
    }, [
        activeRuntimeScopeId,
        bpCore,
        uiDocument,
        activeSurface,
        openSurfaceWithTransition,
        closeLayerWithTransition,
        startStoryInGame,
        writeSaveInGame,
        loadSaveInGame,
        listSaveIds,
        getSavePreview,
        widgetRuntimeStore,
    ]);

    const hostAdapter = useMemo((): UIHostAdapter => {
        if (!activeSurface) {
            return noopHostAdapter;
        }
        if (!bpCore || !hostApi || !bundle) {
            return staticDevHostAdapter(activeSurface);
        }
        return createDevModeBlueprintHostAdapter({
            bundle,
            surface: activeSurface,
            runtimeScopeId: activeRuntimeScopeId || activeSurface.id,
            scopeBridge: bpCore.scopeBridge,
            debug: bpCore.debug,
            hostApi,
            executionManager: bpCore.executionManager,
        });
    }, [activeRuntimeScopeId, bundle, activeSurface, bpCore, hostApi]);

    useEffect(() => {
        hostAdapterRef.current = hostAdapter;
    }, [hostAdapter]);

    useEffect(() => {
        if (!bpCore || !bundle || !activeSurface || !hostAdapter.blueprintRuntime) {
            return undefined;
        }

        const dispatchKeyboardEvent = (eventName: "keyDown" | "keyUp", event: KeyboardEvent) => {
            const runtimeScopeId = activeRuntimeScopeId || activeSurface.id;
            const acc = makeStateAccessors(runtimeScopeId);
            if (!acc) {
                return;
            }
            const eventPayload = keyboardBlueprintPayload(event);
            void (async () => {
                await dispatchGlobalBlueprintEvent({
                    blueprintDocument: bundle.ui.localBlueprints,
                    eventName,
                    eventPayload,
                    hostAdapter,
                    debug: bpCore.debug,
                    getSurfaceState: acc.get,
                    setSurfaceState: acc.set,
                    executionManager: bpCore.executionManager,
                });
                await dispatchSurfaceBlueprintEvent({
                    blueprintDocument: bundle.ui.localBlueprints,
                    surfaceId: activeSurface.id,
                    runtimeScopeId,
                    eventName,
                    eventPayload,
                    hostAdapter,
                    debug: bpCore.debug,
                    getSurfaceState: acc.get,
                    setSurfaceState: acc.set,
                    executionManager: bpCore.executionManager,
                });
            })();
        };

        const onKeyDown = (event: KeyboardEvent) => dispatchKeyboardEvent("keyDown", event);
        const onKeyUp = (event: KeyboardEvent) => dispatchKeyboardEvent("keyUp", event);
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
        };
    }, [activeRuntimeScopeId, activeSurface, bpCore, bundle, hostAdapter, makeStateAccessors]);

    // Reset lifecycle tracking on new session
    useEffect(() => {
        lifecycleRef.current.reset();
        appBootFiredRef.current = null;
    }, [bundle?.bundleId, bundle?.revision]);

    // Dispatch globalMain appBoot once when runtime becomes available
    useEffect(() => {
        if (!bpCore || !bundle || !hostAdapter.blueprintRuntime) {
            return;
        }
        const sig = `${bundle.bundleId}:${bundle.revision}`;
        if (appBootFiredRef.current === sig) {
            return;
        }
        appBootFiredRef.current = sig;
        const acc = makeStateAccessors((activeRuntimeScopeId || surface?.id) ?? "");
        if (!acc) {
            return;
        }
        void dispatchGlobalBlueprintEvent({
            blueprintDocument: bundle.ui.localBlueprints,
            eventName: "appBoot",
            hostAdapter,
            debug: bpCore.debug,
            getSurfaceState: acc.get,
            setSurfaceState: acc.set,
            executionManager: bpCore.executionManager,
        });
    }, [activeRuntimeScopeId, bpCore, bundle, hostAdapter, makeStateAccessors, surface?.id]);

    const nestedSurfaceRuntime = useMemo<NestedSurfaceRuntime | undefined>(() => {
        if (!bpCore || !bundle || !uiDocument) {
            return undefined;
        }
        const globalReader = {
            get: (key: string) => bpCore.scopeBridge.globalGet(key),
            subscribe: (listener: () => void) => bpCore.scopeBridge.subscribeGlobals(listener),
        };
        return {
            createHostAdapter: input => {
                const runtimeScopeId = input.runtimeScopeId;
                let nestedHostAdapter: UIHostAdapter | null = null;
                const hostApi = createDevModeBlueprintHostApi({
                    document: uiDocument,
                    scope: bpCore.scopeBridge,
                    activeSurfaceId: input.targetSurface.id,
                    runtimeScopeId,
                    frameParams: input.params,
                    onFrameEmit: async (eventName, data) => {
                        await input.parentHostAdapter.blueprintRuntime?.dispatchElementBlueprintEvent(
                            input.frameElement.id,
                            "pageEvent",
                            { event: eventName, data },
                        );
                    },
                    emit: e => bpCore.debug.emit(e),
                    onOpenSurface: openSurfaceWithTransition,
                    onCloseLayer: closeLayerWithTransition,
                    onStartStory: startStoryInGame,
                    onWriteSave: writeSaveInGame,
                    onLoadSave: loadSaveInGame,
                    onListSaveIds: listSaveIds,
                    onGetSavePreview: getSavePreview,
                    onWidgetPatch: (elementId, patch) => {
                        setWidgetPatchesByScope(prev => ({
                            ...prev,
                            [runtimeScopeId]: {
                                ...(prev[runtimeScopeId] ?? {}),
                                [elementId]: {
                                    ...(prev[runtimeScopeId]?.[elementId] ?? {}),
                                    ...patch,
                                },
                            },
                        }));
                    },
                    onElementFlush: (elementId, payload) => {
                        void nestedHostAdapter?.blueprintRuntime?.dispatchElementBlueprintEvent(
                            elementId,
                            "flush",
                            payload,
                        );
                    },
                    widgetRuntimeStore,
                });
                nestedHostAdapter = createDevModeBlueprintHostAdapter({
                    bundle,
                    surface: input.targetSurface,
                    runtimeScopeId,
                    scopeBridge: bpCore.scopeBridge,
                    debug: bpCore.debug,
                    hostApi,
                    executionManager: bpCore.executionManager,
                });
                return nestedHostAdapter;
            },
            createBindingContext: input => ({
                blueprintDocument: bundle.ui.localBlueprints,
                surfaceState: bpCore.scopeBridge.getSurfaceStore(input.runtimeScopeId),
                debug: bpCore.debug,
                coalescer: bpCore.bindingDebugCoalescer,
                globalState: globalReader,
            }),
            mountSurface: input => {
                const acc = makeStateAccessors(input.runtimeScopeId);
                if (!acc) {
                    return undefined;
                }
                if (lifecycleRef.current.onSurfaceEnter(input.runtimeScopeId)) {
                    bpCore.executionManager.openScope(input.runtimeScopeId);
                    void dispatchSurfaceBlueprintEvent({
                        blueprintDocument: bundle.ui.localBlueprints,
                        surfaceId: input.targetSurface.id,
                        runtimeScopeId: input.runtimeScopeId,
                        eventName: "surfaceInit",
                        hostAdapter: input.hostAdapter,
                        debug: bpCore.debug,
                        getSurfaceState: acc.get,
                        setSurfaceState: acc.set,
                        executionManager: bpCore.executionManager,
                    });
                }
                return () => {
                    lifecycleRef.current.onSurfaceExit(input.runtimeScopeId);
                    bpCore.executionManager.closeScope(input.runtimeScopeId, "Surface unmounted");
                    void dispatchSurfaceBlueprintEvent({
                        blueprintDocument: bundle.ui.localBlueprints,
                        surfaceId: input.targetSurface.id,
                        runtimeScopeId: input.runtimeScopeId,
                        eventName: "surfaceUnmount",
                        hostAdapter: input.hostAdapter,
                        debug: bpCore.debug,
                        getSurfaceState: acc.get,
                        setSurfaceState: acc.set,
                        executionManager: bpCore.executionManager,
                        allowClosedScopeExecution: true,
                    });
                };
            },
            getWidgetRuntimePatches: input => widgetPatchesByScopeRef.current[input.runtimeScopeId] ?? {},
        };
    }, [
        bpCore,
        bundle,
        closeLayerWithTransition,
        makeStateAccessors,
        openSurfaceWithTransition,
        startStoryInGame,
        writeSaveInGame,
        loadSaveInGame,
        listSaveIds,
        getSavePreview,
        uiDocument,
        widgetRuntimeStore,
    ]);

    if (!bundle) {
        return (
            <div className="flex h-full w-full min-h-0 flex-col overflow-hidden">
                <SessionErrorBanner sessionError={sessionError} onDismissSessionError={onDismissSessionError} />
                <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
                    Waiting for Dev Mode payload...
                </div>
            </div>
        );
    }

    if (!surface) {
        return (
            <div className="flex h-full w-full min-h-0 flex-col overflow-hidden">
                <SessionErrorBanner sessionError={sessionError} onDismissSessionError={onDismissSessionError} />
                <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
                    Surface not found: {surfaceId}
                </div>
            </div>
        );
    }

    if (!activeSurface) {
        return (
            <div className="flex h-full w-full min-h-0 flex-col overflow-hidden">
                <SessionErrorBanner sessionError={sessionError} onDismissSessionError={onDismissSessionError} />
                <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
                    Surface not available
                </div>
            </div>
        );
    }

    const aspectRatio = activeSurface.designSize.width / activeSurface.designSize.height;
    const baseWidth = activeSurface.designSize.width;

    const uidoc = uiDocument!;
    const reducedMotion = prefersReducedMotion === true;
    const visibleSurfaceEntries = visibleEntries
        .map(entry => {
            const visibleSurface = uidoc.surfaces.find(s => s.id === entry.surfaceId);
            return visibleSurface ? { entry, surface: visibleSurface } : null;
        })
        .filter((item): item is { entry: DevModeNavEntry; surface: UISurface } => Boolean(item));

    return (
        <div className="flex h-full w-full min-h-0 flex-col overflow-hidden">
            <SessionErrorBanner sessionError={sessionError} onDismissSessionError={onDismissSessionError} />
            <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
                <div className="min-h-0 min-w-0 flex-1">
                    <FixedAspectRatioContainer
                        aspectRatio={aspectRatio}
                        baseWidth={baseWidth}
                        className="overflow-hidden"
                        debounceMs={0}
                        onUpdate={handleAspectUpdate}
                    >
                        <div className="relative h-full w-full overflow-hidden">
                            <NlrStageLayer
                                session={nlrSession}
                                interactive={gameStageVisible}
                                onFirstSceneReady={handleNlrFirstSceneReady}
                                onLiveGameReady={handleNlrLiveGameReady}
                                onError={handleNlrStageError}
                            />
                            <AnimatePresence
                                custom={transitionDirectionRef.current}
                                initial={false}
                                mode={studioPageHiddenForGame ? "sync" : surfacePresenceMode}
                                onExitComplete={handleSurfaceExitComplete}
                            >
                                {!studioPageHiddenForGame
                                    ? visibleSurfaceEntries.map(({ entry, surface: visibleSurface }, layerIndex) => (
                                          <DevModeAppSurfaceLayer
                                              key={entry.key}
                                              entry={entry}
                                              layerIndex={layerIndex}
                                              bpCore={bpCore}
                                              bundle={bundle}
                                              uidoc={uidoc}
                                              surface={visibleSurface}
                                              rendererRegistry={rendererRegistry}
                                              scale={scale}
                                              lifecycleRef={lifecycleRef}
                                              makeStateAccessors={makeStateAccessors}
                                              openSurfaceWithTransition={openSurfaceWithTransition}
                                              closeLayerWithTransition={closeLayerWithTransition}
                                              startStoryInGame={startStoryInGame}
                                              writeSaveInGame={writeSaveInGame}
                                              loadSaveInGame={loadSaveInGame}
                                              listSaveIds={listSaveIds}
                                              getSavePreview={getSavePreview}
                                              setWidgetPatchesByScope={setWidgetPatchesByScope}
                                              widgetPatchesByScope={widgetPatchesByScope}
                                              widgetPatchesByScopeRef={widgetPatchesByScopeRef}
                                              widgetRuntimeStore={widgetRuntimeStore}
                                              nestedSurfaceRuntime={nestedSurfaceRuntime}
                                              reducedMotion={reducedMotion}
                                              onPrepaintReady={handleSurfaceLayerPrepaintReady}
                                              onEnterComplete={markActiveEnterComplete}
                                          />
                                      ))
                                    : null}
                            </AnimatePresence>
                        </div>
                    </FixedAspectRatioContainer>
                </div>

                <AnimatePresence>
                    {bpCore && blueprintPanelOpen ? (
                        <motion.div
                            key="blueprint-devtools"
                            role="complementary"
                            aria-label="Blueprint DevTools"
                            className="pointer-events-auto absolute inset-y-0 right-0 z-30 flex w-[min(100%,380px)] max-w-full flex-col overflow-hidden border-l border-white/10 bg-[#0d0f11] shadow-[-8px_0_24px_rgba(0,0,0,0.35)]"
                            initial={{ x: "100%" }}
                            animate={{ x: 0 }}
                            exit={{ x: "100%" }}
                            transition={{ type: "tween", duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                        >
                            <BlueprintRuntimeDebugPanel
                                debug={bpCore.debug}
                                blueprintDocument={bundle.ui.localBlueprints}
                                uiDocument={uidoc}
                                activeSurfaceId={activeSurface.id}
                                scopeBridge={bpCore.scopeBridge}
                                widgetRuntimeStore={widgetRuntimeStore}
                                projectPath={projectPath}
                                className="h-full min-h-0 w-full border-l-0"
                            />
                        </motion.div>
                    ) : null}
                </AnimatePresence>

                {bpCore ? (
                    <div className="pointer-events-none absolute inset-0 z-40">
                        <div className="pointer-events-auto absolute bottom-3 left-3">
                            <div className="relative flex w-11 flex-col items-start">
                                {devtoolsMenuOpen ? (
                                    <div
                                        ref={devtoolsMenuRef}
                                        role="menu"
                                        aria-label="Preview debug tools"
                                        className="absolute bottom-full left-0 z-10 mb-2 w-[min(15rem,calc(100vw-1.5rem))] rounded-md border border-white/10 bg-[#0b0d12] py-1 shadow-lg"
                                    >
                                        <button
                                            type="button"
                                            role="menuitem"
                                            aria-pressed={blueprintPanelOpen}
                                            className={`flex w-full cursor-default items-center gap-2 px-3 py-2 text-left text-xs transition-colors ${
                                                blueprintPanelOpen
                                                    ? "bg-white/15 text-white"
                                                    : "text-gray-400 hover:bg-white/10 hover:text-white"
                                            }`}
                                            onClick={() => {
                                                setBlueprintPanelOpen(prev => !prev);
                                                setDevtoolsMenuOpen(false);
                                            }}
                                        >
                                            <span
                                                className="flex h-3.5 w-3.5 shrink-0 items-center justify-center"
                                                aria-hidden
                                            >
                                                {blueprintPanelOpen ? (
                                                    <Check className="h-3.5 w-3.5 text-primary" />
                                                ) : null}
                                            </span>
                                            <span className="min-w-0 flex-1 truncate">Blueprint DevTools</span>
                                        </button>
                                    </div>
                                ) : null}
                                <button
                                    ref={devtoolsFabRef}
                                    type="button"
                                    className="pointer-events-auto flex h-11 w-11 shrink-0 cursor-default items-center justify-center rounded-full border border-white/15 bg-[#0b0d12] shadow-md outline-none ring-white/20 transition-colors duration-150 hover:border-white/22 hover:bg-[#151a24] hover:shadow-lg focus-visible:ring-2"
                                    aria-label={devtoolsMenuOpen ? "Close preview debug tools menu" : "Open preview debug tools menu"}
                                    aria-expanded={devtoolsMenuOpen}
                                    aria-haspopup="menu"
                                    onClick={() => setDevtoolsMenuOpen(prev => !prev)}
                                >
                                    <img src="/favicon.ico" alt="" className="h-7 w-7 rounded-full" draggable={false} />
                                </button>
                            </div>
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
