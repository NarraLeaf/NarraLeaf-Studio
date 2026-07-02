import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type Dispatch,
    type MutableRefObject,
    type ReactNode,
    type SetStateAction,
} from "react";
import { AnimatePresence, useReducedMotion } from "motion/react";
import { Game, KeyBindingType, type LiveGame, type SavedGame } from "narraleaf-react";
import type { DevModeBundle, DevModeStartStoryRequest } from "@shared/types/devMode";
import type { GameRuntimePackV1 } from "@shared/types/gameRuntime";
import type { UISurface } from "@shared/types/ui-editor/document";
import { toBlueprintImageAsset, type BlueprintImageAsset } from "@shared/types/blueprint/valueTypes";
import { WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import type {
    NestedSurfaceRuntime,
    SurfaceBlueprintBindingContext,
} from "@/lib/ui-editor/runtime/surface/SurfaceElementTree";
import { GameSurfaceRenderer } from "@/lib/ui-editor/runtime/surface/GameSurfaceRenderer";
import { SurfaceAnimationLayer } from "@/lib/ui-editor/runtime/surface/SurfaceAnimationLayer";
import {
    resolvePageAnimationMotion,
    type PageAnimationNavigationDirection,
} from "@/lib/ui-editor/runtime/pageAnimation";
import { getSurfaceBackgroundColor } from "@/lib/ui-editor/runtime/surfaceBackground";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { BuiltinElementRenderers } from "@/lib/ui-editor/runtime/builtin";
import { getGameRuntimeBridge } from "@/lib/ui-editor/runtime/gameRuntimeBridge";
import { registerDevModeSavePreviewImage } from "@/lib/ui-editor/runtime/devModeSavePreviewAssets";
import {
    createDevModeBlueprintHostApi,
    type DevModeWidgetRuntimePatch,
} from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { createDevModeBlueprintHostAdapter } from "@/lib/ui-editor/runtime/hostAdapters/devModeBlueprintHostAdapter";
import { ScopeStoreBridge } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import { DebugBridge } from "@/lib/ui-editor/blueprint-runtime/DebugBridge";
import { BindingDebugCoalescer } from "@/lib/ui-editor/blueprint-runtime/BindingDebugCoalescer";
import { BlueprintExecutionManager } from "@/lib/ui-editor/blueprint-runtime/BlueprintExecutionManager";
import { mountBlueprintCompiledScripts } from "@/lib/ui-editor/blueprint-runtime/mountBlueprintScripts";
import { SurfaceLifecycleManager } from "@/lib/ui-editor/blueprint-runtime/SurfaceLifecycleManager";
import {
    dispatchGlobalBlueprintEvent,
    dispatchSurfaceBlueprintEvent,
} from "@/lib/ui-editor/blueprint-runtime/BlueprintDispatcher";
import { getOrCreateDomEventPropagationControl } from "@/lib/ui-editor/runtime/eventPropagationControl";
import { compileStudioStoryToNlr } from "@/apps/dev-mode/nlr/storyCompiler";
import { NlrStageLayer, type NlrStageSession } from "@/apps/dev-mode/nlr/NlrStageLayer";
import {
    preloadRuntimePackAssets,
    type RuntimeSurfacePreloadResult,
} from "./surfaceResourcePreload";

type RuntimeCore = {
    scopeBridge: ScopeStoreBridge;
    debug: DebugBridge;
    bindingDebugCoalescer: BindingDebugCoalescer;
    executionManager: BlueprintExecutionManager;
};

type RuntimeNavEntry = {
    key: string;
    surfaceId: string;
    runtimeScopeId: string;
    props: Record<string, unknown>;
    direction: PageAnimationNavigationDirection;
};

type RuntimeHostAdapterBundle = {
    hostAdapter: UIHostAdapter;
    bindingContext: SurfaceBlueprintBindingContext;
    runtimeScopeId: string;
};

function mergeWidgetRuntimePatch(
    current: Record<string, Record<string, DevModeWidgetRuntimePatch>>,
    runtimeScopeId: string,
    elementId: string,
    patch: DevModeWidgetRuntimePatch,
): Record<string, Record<string, DevModeWidgetRuntimePatch>> {
    return {
        ...current,
        [runtimeScopeId]: {
            ...(current[runtimeScopeId] ?? {}),
            [elementId]: {
                ...(current[runtimeScopeId]?.[elementId] ?? {}),
                ...patch,
            },
        },
    };
}

function applyWidgetRuntimePatch(input: {
    setWidgetPatchesByScope: Dispatch<SetStateAction<Record<string, Record<string, DevModeWidgetRuntimePatch>>>>;
    widgetPatchesByScopeRef: MutableRefObject<Record<string, Record<string, DevModeWidgetRuntimePatch>>>;
    runtimeScopeId: string;
    elementId: string;
    patch: DevModeWidgetRuntimePatch;
}): void {
    const next = mergeWidgetRuntimePatch(
        input.widgetPatchesByScopeRef.current,
        input.runtimeScopeId,
        input.elementId,
        input.patch,
    );
    input.widgetPatchesByScopeRef.current = next;
    input.setWidgetPatchesByScope(next);
}

function cloneProps(props: Record<string, unknown> | undefined): Record<string, unknown> {
    if (!props) {
        return {};
    }
    try {
        return JSON.parse(JSON.stringify(props)) as Record<string, unknown>;
    } catch {
        return {};
    }
}

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

function findSurface(bundle: DevModeBundle, surfaceId: string | undefined): UISurface | null {
    if (surfaceId) {
        const surface = bundle.ui.uidoc.surfaces.find(item => item.id === surfaceId);
        if (surface) {
            return surface;
        }
    }
    return bundle.ui.uidoc.surfaces.find(surface => surface.kind === "appSurface") ?? bundle.ui.uidoc.surfaces[0] ?? null;
}

function createNavEntry(
    surfaceId: string,
    props?: Record<string, unknown>,
    direction: PageAnimationNavigationDirection = "forward",
): RuntimeNavEntry {
    const key = `${surfaceId}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    return {
        key,
        surfaceId,
        runtimeScopeId: key,
        props: cloneProps(props),
        direction,
    };
}

function markLastEntryDirection(
    entries: RuntimeNavEntry[],
    direction: PageAnimationNavigationDirection,
): RuntimeNavEntry[] {
    if (entries.length === 0) {
        return entries;
    }
    const last = entries[entries.length - 1]!;
    return [
        ...entries.slice(0, -1),
        { ...last, direction },
    ];
}

function resolveScale(surface: UISurface | null, width: number, height: number): number {
    if (!surface || width <= 0 || height <= 0) {
        return 1;
    }
    const scale = Math.min(width / surface.designSize.width, height / surface.designSize.height);
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function normalizeError(error: unknown): string {
    if (error instanceof Error) {
        return error.stack || error.message;
    }
    return String(error);
}

function useViewportSize(): { width: number; height: number } {
    const [size, setSize] = useState(() => ({
        width: window.innerWidth || 1280,
        height: window.innerHeight || 720,
    }));

    useEffect(() => {
        const update = () => {
            setSize({
                width: window.innerWidth || 1280,
                height: window.innerHeight || 720,
            });
        };
        window.addEventListener("resize", update);
        return () => window.removeEventListener("resize", update);
    }, []);

    return size;
}

function useRuntimePack(): {
    pack: GameRuntimePackV1 | null;
    error: string | null;
} {
    const [pack, setPack] = useState<GameRuntimePackV1 | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let disposed = false;
        const bridge = getGameRuntimeBridge();
        if (!bridge) {
            setError("Runtime bridge is not available");
            return;
        }
        void bridge.readPack()
            .then(nextPack => {
                if (!disposed) {
                    setPack(nextPack);
                    setError(null);
                }
            })
            .catch(err => {
                if (!disposed) {
                    setError(normalizeError(err));
                }
            });
        return () => {
            disposed = true;
        };
    }, []);

    return { pack, error };
}

function useRuntimeCore(pack: GameRuntimePackV1 | null): RuntimeCore | null {
    const [core, setCore] = useState<RuntimeCore | null>(null);

    useEffect(() => {
        if (!pack) {
            setCore(null);
            return;
        }
        const bridge = getGameRuntimeBridge();
        if (!bridge) {
            setCore(null);
            return;
        }

        mountBlueprintCompiledScripts(pack.bundle);
        const nextCore: RuntimeCore = {
            scopeBridge: new ScopeStoreBridge(),
            debug: new DebugBridge(),
            bindingDebugCoalescer: new BindingDebugCoalescer(),
            executionManager: new BlueprintExecutionManager(),
        };
        nextCore.scopeBridge.setPersistenceAdapter({
            getAll: async () => bridge.persistence.getAll(),
            getValue: async key => bridge.persistence.getValue(key),
            setValue: async (key, value) => bridge.persistence.setValue(key, value),
            removeValue: async key => bridge.persistence.removeValue(key),
        });
        const unsubscribeDebug = nextCore.debug.subscribeEvents(event => {
            if (event.type === "execution.error") {
                bridge.log("error", event.message);
            } else if (event.type === "devtools.log") {
                const level = event.level === "error" || event.level === "warning" ? event.level : "info";
                bridge.log(level, event.message);
            }
        });
        setCore(nextCore);

        return () => {
            unsubscribeDebug();
            nextCore.executionManager.cancelAll("Preview runtime disposed");
            nextCore.scopeBridge.setPersistenceAdapter(null);
        };
    }, [pack]);

    return core;
}

function RuntimeErrorScreen(props: { message: string }): ReactNode {
    return (
        <div className="flex h-screen w-screen items-center justify-center bg-neutral-950 p-8 text-neutral-100">
            <pre className="max-h-full max-w-full overflow-auto whitespace-pre-wrap rounded border border-red-800/70 bg-red-950/50 p-4 text-xs leading-relaxed text-red-100">
                {props.message}
            </pre>
        </div>
    );
}

function RuntimeLoadingScreen(): ReactNode {
    return <div className="h-screen w-screen bg-black" />;
}

function useRuntimePackPreload(input: {
    pack: GameRuntimePackV1 | null;
    firstSurface: UISurface | null;
}): {
    ready: boolean;
    result: RuntimeSurfacePreloadResult | null;
} {
    const { pack, firstSurface } = input;
    const [state, setState] = useState<{
        key: string | null;
        ready: boolean;
        result: RuntimeSurfacePreloadResult | null;
    }>({ key: null, ready: false, result: null });

    useEffect(() => {
        const bridge = getGameRuntimeBridge();
        if (!pack || !firstSurface || !bridge) {
            setState({ key: null, ready: false, result: null });
            return;
        }
        const preloadKey = `${pack.bundle.bundleId}:${pack.bundle.revision}:${firstSurface.id}`;
        let cancelled = false;
        setState({ key: preloadKey, ready: false, result: null });
        void preloadRuntimePackAssets({
            pack,
            firstSurface,
            assetUrl: assetId => bridge.assetUrl(assetId),
        }).then(result => {
            if (cancelled) {
                return;
            }
            if (result.timedOut) {
                bridge.log(
                    "warning",
                    `[Runtime] Asset preload timed out after 10s: first screen ${result.firstSurfaceLoaded}/${result.firstSurfaceAssetIds.length}, total ${result.loaded}/${result.assetIds.length}`,
                );
            } else if (result.failed.length > 0) {
                bridge.log(
                    "warning",
                    `[Runtime] Asset preload finished with ${result.failed.length} failed asset(s): ${result.failed.join(", ")}`,
                );
            } else {
                bridge.log("info", `[Runtime] Asset preload finished: ${result.assetIds.length} asset(s)`);
            }
            setState({ key: preloadKey, ready: true, result });
        }).catch(err => {
            if (cancelled) {
                return;
            }
            bridge.log("warning", `[Runtime] Surface preload failed: ${normalizeError(err)}`);
            setState({
                key: preloadKey,
                ready: true,
                result: {
                    assetIds: [],
                    firstSurfaceAssetIds: [],
                    loaded: 0,
                    firstSurfaceLoaded: 0,
                    failed: [],
                    firstSurfaceFailed: [],
                    firstSurfaceComplete: false,
                    timedOut: false,
                },
            });
        });
        return () => {
            cancelled = true;
        };
    }, [firstSurface, pack]);

    const expectedKey = pack && firstSurface
        ? `${pack.bundle.bundleId}:${pack.bundle.revision}:${firstSurface.id}`
        : null;
    return {
        ready: Boolean(expectedKey && state.key === expectedKey && state.ready),
        result: expectedKey && state.key === expectedKey ? state.result : null,
    };
}

function RuntimeViewportFrame(props: {
    surface: UISurface;
    scale: number;
    children?: ReactNode;
}): ReactNode {
    const { surface, scale, children } = props;
    return (
        <div className="relative h-screen w-screen overflow-hidden bg-black text-white">
            <div
                className="absolute left-1/2 top-1/2 overflow-hidden"
                style={{
                    width: surface.designSize.width * scale,
                    height: surface.designSize.height * scale,
                    transform: "translate(-50%, -50%)",
                    backgroundColor: getSurfaceBackgroundColor(surface),
                }}
            >
                {children}
            </div>
        </div>
    );
}

function RuntimeSurfaceLayer(props: {
    pack: GameRuntimePackV1;
    core: RuntimeCore;
    entry: RuntimeNavEntry;
    surface: UISurface;
    rendererRegistry: ElementRendererRegistry;
    scale: number;
    hostAdapterBundle: RuntimeHostAdapterBundle;
    widgetPatchesByScope: Record<string, Record<string, DevModeWidgetRuntimePatch>>;
    widgetPatchesByScopeRef: MutableRefObject<Record<string, Record<string, DevModeWidgetRuntimePatch>>>;
    widgetRuntimeStore: WidgetRuntimeStateStore;
    lifecycleRef: MutableRefObject<SurfaceLifecycleManager>;
    nestedSurfaceRuntime?: NestedSurfaceRuntime;
    blueprintLifecycleReady: boolean;
    reducedMotion: boolean;
    onPrepaintReady: (entryKey: string) => void;
}): ReactNode {
    const {
        pack,
        core,
        entry,
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
        onPrepaintReady,
    } = props;
    const [surfaceLifecycleSignals, setSurfaceLifecycleSignals] = useState({
        beforeSurfaceExit: 0,
        afterSurfaceEnter: 0,
    });
    const transitionStateRef = useRef({ isEntering: true, isExiting: false });

    useEffect(() => {
        if (hostAdapterBundle.hostAdapter.blueprintRuntime) {
            hostAdapterBundle.hostAdapter.blueprintRuntime.getSurfaceTransitionState = () => transitionStateRef.current;
        }
    }, [hostAdapterBundle.hostAdapter]);

    useEffect(() => {
        const { runtimeScopeId, hostAdapter } = hostAdapterBundle;
        if (!blueprintLifecycleReady || !hostAdapter.blueprintRuntime) {
            return undefined;
        }
        core.executionManager.openScope(runtimeScopeId);
        if (lifecycleRef.current.onSurfaceEnter(runtimeScopeId)) {
            const surfaceStore = core.scopeBridge.getSurfaceStore(runtimeScopeId);
            void dispatchSurfaceBlueprintEvent({
                blueprintDocument: pack.bundle.ui.localBlueprints,
                surfaceId: surface.id,
                runtimeScopeId,
                eventName: "surfaceInit",
                hostAdapter,
                debug: core.debug,
                getSurfaceState: key => surfaceStore.get(key),
                setSurfaceState: (key, value) => surfaceStore.set(key, value),
                executionManager: core.executionManager,
            });
        }
        return () => {
            lifecycleRef.current.onSurfaceExit(runtimeScopeId);
            core.executionManager.closeScope(runtimeScopeId, "Preview surface unmounted");
            const surfaceStore = core.scopeBridge.getSurfaceStore(runtimeScopeId);
            void dispatchSurfaceBlueprintEvent({
                blueprintDocument: pack.bundle.ui.localBlueprints,
                surfaceId: surface.id,
                runtimeScopeId,
                eventName: "surfaceUnmount",
                hostAdapter,
                debug: core.debug,
                getSurfaceState: key => surfaceStore.get(key),
                setSurfaceState: (key, value) => surfaceStore.set(key, value),
                executionManager: core.executionManager,
                allowClosedScopeExecution: true,
            });
        };
    }, [blueprintLifecycleReady, core, hostAdapterBundle, lifecycleRef, pack.bundle.ui.localBlueprints, surface.id]);

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

    return (
        <SurfaceAnimationLayer
            prepaintKey={entry.key}
            direction={entry.direction}
            pageMotion={pageMotion}
            className="absolute inset-0"
            style={{ backgroundColor: getSurfaceBackgroundColor(surface) }}
            presentZIndex={10}
            exitZIndex={20}
            surfaceId={surface.id}
            surfaceKind={surface.kind}
            resolveExit={resolveExit}
            onPrepaintReady={onPrepaintReady}
            onBeforeExit={() => dispatchSurfaceTransitionEvent("beforeSurfaceExit")}
            onEnterComplete={() => dispatchSurfaceTransitionEvent("afterSurfaceEnter")}
        >
            <WidgetRuntimeStateProvider externalStore={widgetRuntimeStore}>
                <GameSurfaceRenderer
                    document={pack.bundle.ui.uidoc}
                    surface={surface}
                    rendererRegistry={rendererRegistry}
                    scale={scale}
                    hostAdapter={hostAdapterBundle.hostAdapter}
                    blueprintBindingContext={hostAdapterBundle.bindingContext}
                    widgetRuntimePatches={widgetPatchesByScope[entry.runtimeScopeId]}
                    getWidgetRuntimePatches={() => widgetPatchesByScopeRef.current[entry.runtimeScopeId]}
                    nestedSurfaceRuntime={nestedSurfaceRuntime}
                    surfaceLifecycleSignals={surfaceLifecycleSignals}
                    blueprintLifecycleReady={blueprintLifecycleReady}
                />
            </WidgetRuntimeStateProvider>
        </SurfaceAnimationLayer>
    );
}

export function GameRuntimeApp() {
    const { pack, error } = useRuntimePack();
    const core = useRuntimeCore(pack);
    const viewport = useViewportSize();
    const bridge = getGameRuntimeBridge();
    const rendererRegistry = useMemo(() => new ElementRendererRegistry(BuiltinElementRenderers), []);
    const widgetRuntimeStore = useMemo(() => new WidgetRuntimeStateStore(), []);
    const [widgetPatchesByScope, setWidgetPatchesByScope] = useState<Record<string, Record<string, DevModeWidgetRuntimePatch>>>({});
    const widgetPatchesByScopeRef = useRef(widgetPatchesByScope);
    const [navStack, setNavStack] = useState<RuntimeNavEntry[]>([]);
    const [prepaintReadyKeys, setPrepaintReadyKeys] = useState<Set<string>>(() => new Set());
    const [nlrSession, setNlrSession] = useState<NlrStageSession | null>(null);
    const liveGameRef = useRef<LiveGame | null>(null);
    const lifecycleRef = useRef(new SurfaceLifecycleManager());
    const appBootFiredRef = useRef<string | null>(null);
    const storyEntryStartedRef = useRef<string | null>(null);
    const prefersReducedMotion = useReducedMotion();

    useEffect(() => {
        widgetPatchesByScopeRef.current = widgetPatchesByScope;
    }, [widgetPatchesByScope]);

    useEffect(() => {
        if (!pack) {
            setNavStack([]);
            return;
        }
        const entrySurfaceId = pack.entry.kind === "surface" ? pack.entry.surfaceId : pack.entry.surfaceId;
        const surface = findSurface(pack.bundle, entrySurfaceId);
        setPrepaintReadyKeys(new Set());
        setNavStack(surface ? [createNavEntry(surface.id)] : []);
    }, [pack]);

    const activeEntry = navStack[navStack.length - 1] ?? null;
    const activeSurface = pack && activeEntry ? findSurface(pack.bundle, activeEntry.surfaceId) : null;
    const firstEntry = navStack[0] ?? null;
    const firstSurface = pack && firstEntry ? findSurface(pack.bundle, firstEntry.surfaceId) : activeSurface;
    const preload = useRuntimePackPreload({ pack, firstSurface });
    const runtimeReady = preload.ready;
    const scale = resolveScale(activeSurface, viewport.width, viewport.height);

    const markSurfacePrepaintReady = useCallback((entryKey: string) => {
        setPrepaintReadyKeys(prev => {
            if (prev.has(entryKey)) {
                return prev;
            }
            const next = new Set(prev);
            next.add(entryKey);
            return next;
        });
    }, []);

    const openSurface = useCallback((surfaceId: string, props?: Record<string, unknown>) => {
        if (!pack) {
            return;
        }
        const surface = findSurface(pack.bundle, surfaceId);
        if (!surface) {
            throw new Error(`Open Page: surface not found: ${surfaceId}`);
        }
        setNavStack(current => [...current, createNavEntry(surface.id, props, "forward")]);
    }, [pack]);

    const closeLayer = useCallback(() => {
        setNavStack(current => current.length > 1 ? markLastEntryDirection(current.slice(0, -1), "back") : current);
    }, []);

    const startStoryInGame = useCallback(async (request: DevModeStartStoryRequest): Promise<void> => {
        if (!pack || !activeSurface) {
            throw new Error("Start Game: runtime surface is not available");
        }
        const storyId = String(request.storyId ?? "").trim();
        const sceneId = String(request.sceneId ?? "").trim();
        if (!storyId || !sceneId) {
            throw new Error("Start Game: storyId and sceneId are required");
        }
        const storyDocument =
            pack.bundle.storyLibrary?.documents[storyId] ??
            Object.values(pack.bundle.storyLibrary?.documents ?? {}).find(document => document.id === storyId);
        if (!storyDocument) {
            throw new Error(`Start Game: story not found: ${storyId}`);
        }
        if (!storyDocument.scenes[sceneId]) {
            throw new Error(`Start Game: scene not found: ${sceneId}`);
        }

        const compiled = await compileStudioStoryToNlr({
            document: storyDocument,
            sceneId,
            characters: pack.bundle.storyLibrary?.characters,
            animations: pack.bundle.storyLibrary?.animations,
            resolveAssetUrl: assetId => bridge?.assetUrl(assetId) ?? assetId,
        });
        if (compiled.diagnostics.length > 0) {
            for (const diagnostic of compiled.diagnostics) {
                bridge?.log(diagnostic.level === "error" ? "error" : "warning", diagnostic.message);
            }
        }

        const { width, height } = activeSurface.designSize;
        const game = new Game({
            app: { debug: false },
            width,
            height,
            aspectRatio: width / height,
            ratioUpdateInterval: 0,
            contentContainerId: `__nlr_preview_stage_${Date.now()}`,
        });
        game.keyMap.setKeyBinding(KeyBindingType.nextAction, null);
        liveGameRef.current = null;
        setNlrSession({
            id: `${pack.bundle.bundleId}:${pack.bundle.revision}:${Date.now()}`,
            game,
            compiled,
            width,
            height,
        });
    }, [activeSurface, bridge, pack]);

    useEffect(() => {
        if (!runtimeReady || !pack || pack.entry.kind !== "story" || !activeSurface) {
            return;
        }
        if (activeEntry && !prepaintReadyKeys.has(activeEntry.key)) {
            return;
        }
        const sig = `${pack.bundle.bundleId}:${pack.bundle.revision}:${pack.entry.storyId}:${pack.entry.sceneId}`;
        if (storyEntryStartedRef.current === sig) {
            return;
        }
        storyEntryStartedRef.current = sig;
        void startStoryInGame({ storyId: pack.entry.storyId, sceneId: pack.entry.sceneId }).catch(err => {
            storyEntryStartedRef.current = null;
            bridge?.log("error", normalizeError(err));
        });
    }, [activeEntry, activeSurface, bridge, pack, prepaintReadyKeys, runtimeReady, startStoryInGame]);

    const writeSave = useCallback(async (id: string, metadata: unknown, screenshot?: boolean) => {
        if (!bridge) {
            throw new Error("Save Game: runtime bridge is not available");
        }
        const liveGame = liveGameRef.current;
        if (!liveGame) {
            throw new Error("Save Game: active game is not available");
        }
        let capture: string | undefined;
        if (screenshot === true && typeof liveGame.capturePng === "function") {
            capture = await liveGame.capturePng().catch(() => undefined);
        }
        await bridge.save.write(id, liveGame.serialize(), capture, metadata);
    }, [bridge]);

    const loadSave = useCallback(async (id: string) => {
        if (!bridge) {
            throw new Error("Load Save: runtime bridge is not available");
        }
        const liveGame = liveGameRef.current;
        if (!liveGame) {
            throw new Error("Load Save: active game is not available");
        }
        const record = await bridge.save.read(id);
        if (!record) {
            throw new Error(`Load Save: save not found: ${id}`);
        }
        liveGame.game.router.clear().cleanHistory();
        liveGame.newGame().deserialize(record.savedGame as SavedGame);
        await liveGame.waitForRouterExit().promise;
    }, [bridge]);

    const deleteSave = useCallback(async (id: string) => {
        if (!bridge) {
            throw new Error("Delete Save: runtime bridge is not available");
        }
        await bridge.save.delete(id);
    }, [bridge]);

    const listSaveIds = useCallback(async (): Promise<string[]> => {
        if (!bridge) {
            return [];
        }
        return bridge.save.listIds();
    }, [bridge]);

    const getSaveMetadata = useCallback(async (id: string): Promise<unknown> => {
        const record = await bridge?.save.read(id);
        return record?.metadata.user ?? null;
    }, [bridge]);

    const getSavePreview = useCallback(async (id: string): Promise<BlueprintImageAsset | null> => {
        const capture = await bridge?.save.readPreview(id);
        if (!capture) {
            return null;
        }
        return toBlueprintImageAsset(registerDevModeSavePreviewImage(id, capture));
    }, [bridge]);

    const clearGameAndOpenSurface = useCallback(async (surfaceId: string): Promise<void> => {
        setNlrSession(null);
        liveGameRef.current = null;
        await openSurface(surfaceId);
    }, [openSurface]);

    const hostAdapterBundle = useMemo(() => {
        if (!pack || !core || !activeSurface || !activeEntry) {
            return null;
        }
        const runtimeScopeId = activeEntry.runtimeScopeId;
        let hostAdapter: UIHostAdapter | null = null;
        const hostApi = createDevModeBlueprintHostApi({
            document: pack.bundle.ui.uidoc,
            scope: core.scopeBridge,
            activeSurfaceId: activeSurface.id,
            runtimeScopeId,
            pageProps: activeEntry.props,
            emit: event => core.debug.emit(event),
            onOpenSurface: openSurface,
            onCloseLayer: closeLayer,
            onQuitApplication: () => bridge?.close(),
            onStartStory: startStoryInGame,
            onIsInGame: () => liveGameRef.current != null,
            onIsGameOverlay: () => false,
            onQuitGame: clearGameAndOpenSurface,
            onWriteSave: writeSave,
            onLoadSave: loadSave,
            onDeleteSave: deleteSave,
            onListSaveIds: listSaveIds,
            onGetSaveMetadata: getSaveMetadata,
            onGetSavePreview: getSavePreview,
            onGetNametag: () => null,
            onNext: async () => {
                const gameState = liveGameRef.current?.getGameState();
                const clickTarget = gameState?.mainContentNode ?? gameState?.playerCurrent;
                clickTarget?.click();
            },
            onSkip: async () => liveGameRef.current?.skipDialog(),
            onShowDialog: async () => liveGameRef.current?.game.preference.setPreference("showDialog", true),
            onHideDialog: async () => liveGameRef.current?.game.preference.setPreference("showDialog", false),
            onToggleDialogDisplay: async () => {
                const preference = liveGameRef.current?.game.preference;
                preference?.setPreference("showDialog", preference.getPreference("showDialog") !== true);
            },
            onSetSentenceSpeed: async cps => {
                const value = typeof cps === "number" ? cps : Number(cps);
                if (Number.isFinite(value) && value > 0) {
                    liveGameRef.current?.game.preference.setPreference("cps", value);
                }
            },
            onWidgetPatch: (elementId, patch) => {
                applyWidgetRuntimePatch({
                    setWidgetPatchesByScope,
                    widgetPatchesByScopeRef,
                    runtimeScopeId,
                    elementId,
                    patch,
                });
            },
            onElementFlush: (elementId, payload) => {
                void hostAdapter?.blueprintRuntime?.dispatchElementBlueprintEvent(
                    elementId,
                    "flush",
                    payload,
                );
            },
            widgetRuntimeStore,
        });
        hostAdapter = createDevModeBlueprintHostAdapter({
            bundle: pack.bundle,
            surface: activeSurface,
            runtimeScopeId,
            scopeBridge: core.scopeBridge,
            debug: core.debug,
            hostApi,
            executionManager: core.executionManager,
        });
        const bindingContext: SurfaceBlueprintBindingContext = {
            blueprintDocument: pack.bundle.ui.localBlueprints,
            surfaceState: core.scopeBridge.getSurfaceStore(runtimeScopeId),
            debug: core.debug,
            coalescer: core.bindingDebugCoalescer,
            globalState: {
                get: key => core.scopeBridge.globalGet(key),
                subscribe: listener => core.scopeBridge.subscribeGlobals(listener),
            },
        };
        return {
            hostAdapter,
            bindingContext,
            runtimeScopeId,
        } satisfies RuntimeHostAdapterBundle;
    }, [
        activeEntry,
        activeSurface,
        bridge,
        clearGameAndOpenSurface,
        closeLayer,
        core,
        deleteSave,
        getSaveMetadata,
        getSavePreview,
        listSaveIds,
        loadSave,
        openSurface,
        pack,
        startStoryInGame,
        widgetRuntimeStore,
        writeSave,
    ]);

    const nestedSurfaceRuntime = useMemo<NestedSurfaceRuntime | undefined>(() => {
        if (!pack || !core) {
            return undefined;
        }
        const globalState = {
            get: (key: string) => core.scopeBridge.globalGet(key),
            subscribe: (listener: () => void) => core.scopeBridge.subscribeGlobals(listener),
        };
        return {
            createHostAdapter: input => {
                const runtimeScopeId = input.runtimeScopeId;
                let nestedHostAdapter: UIHostAdapter | null = null;
                const hostApi = createDevModeBlueprintHostApi({
                    document: pack.bundle.ui.uidoc,
                    scope: core.scopeBridge,
                    activeSurfaceId: input.targetSurface.id,
                    runtimeScopeId,
                    pageProps: input.params,
                    frameParams: input.params,
                    onFrameEmit: async (eventName, data) => {
                        await input.parentHostAdapter.blueprintRuntime?.dispatchElementBlueprintEvent(
                            input.frameElement.id,
                            "pageEvent",
                            { event: eventName, data },
                        );
                    },
                    emit: event => core.debug.emit(event),
                    onOpenSurface: openSurface,
                    onCloseLayer: closeLayer,
                    onQuitApplication: () => bridge?.close(),
                    onStartStory: startStoryInGame,
                    onIsInGame: () => liveGameRef.current != null,
                    onIsGameOverlay: () =>
                        input.parentHostAdapter.blueprintRuntime?.hostApi?.game.isGameOverlay() === true,
                    onQuitGame: clearGameAndOpenSurface,
                    onWriteSave: writeSave,
                    onLoadSave: loadSave,
                    onDeleteSave: deleteSave,
                    onListSaveIds: listSaveIds,
                    onGetSaveMetadata: getSaveMetadata,
                    onGetSavePreview: getSavePreview,
                    onGetNametag: () => null,
                    onNext: async () => {
                        const gameState = liveGameRef.current?.getGameState();
                        const clickTarget = gameState?.mainContentNode ?? gameState?.playerCurrent;
                        clickTarget?.click();
                    },
                    onSkip: async () => liveGameRef.current?.skipDialog(),
                    onShowDialog: async () => liveGameRef.current?.game.preference.setPreference("showDialog", true),
                    onHideDialog: async () => liveGameRef.current?.game.preference.setPreference("showDialog", false),
                    onToggleDialogDisplay: async () => {
                        const preference = liveGameRef.current?.game.preference;
                        preference?.setPreference("showDialog", preference.getPreference("showDialog") !== true);
                    },
                    onSetSentenceSpeed: async cps => {
                        const value = typeof cps === "number" ? cps : Number(cps);
                        if (Number.isFinite(value) && value > 0) {
                            liveGameRef.current?.game.preference.setPreference("cps", value);
                        }
                    },
                    onWidgetPatch: (elementId, patch) => {
                        applyWidgetRuntimePatch({
                            setWidgetPatchesByScope,
                            widgetPatchesByScopeRef,
                            runtimeScopeId,
                            elementId,
                            patch,
                        });
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
                    bundle: pack.bundle,
                    surface: input.targetSurface,
                    runtimeScopeId,
                    scopeBridge: core.scopeBridge,
                    debug: core.debug,
                    hostApi,
                    executionManager: core.executionManager,
                });
                return nestedHostAdapter;
            },
            createBindingContext: input => ({
                blueprintDocument: pack.bundle.ui.localBlueprints,
                surfaceState: core.scopeBridge.getSurfaceStore(input.runtimeScopeId),
                debug: core.debug,
                coalescer: core.bindingDebugCoalescer,
                globalState,
            }),
            mountSurface: input => {
                const surfaceStore = core.scopeBridge.getSurfaceStore(input.runtimeScopeId);
                if (lifecycleRef.current.onSurfaceEnter(input.runtimeScopeId)) {
                    core.executionManager.openScope(input.runtimeScopeId);
                    void dispatchSurfaceBlueprintEvent({
                        blueprintDocument: pack.bundle.ui.localBlueprints,
                        surfaceId: input.targetSurface.id,
                        runtimeScopeId: input.runtimeScopeId,
                        eventName: "surfaceInit",
                        hostAdapter: input.hostAdapter,
                        debug: core.debug,
                        getSurfaceState: key => surfaceStore.get(key),
                        setSurfaceState: (key, value) => surfaceStore.set(key, value),
                        executionManager: core.executionManager,
                    });
                }
                return () => {
                    lifecycleRef.current.onSurfaceExit(input.runtimeScopeId);
                    core.executionManager.closeScope(input.runtimeScopeId, "Preview nested surface unmounted");
                    void dispatchSurfaceBlueprintEvent({
                        blueprintDocument: pack.bundle.ui.localBlueprints,
                        surfaceId: input.targetSurface.id,
                        runtimeScopeId: input.runtimeScopeId,
                        eventName: "surfaceUnmount",
                        hostAdapter: input.hostAdapter,
                        debug: core.debug,
                        getSurfaceState: key => surfaceStore.get(key),
                        setSurfaceState: (key, value) => surfaceStore.set(key, value),
                        executionManager: core.executionManager,
                        allowClosedScopeExecution: true,
                    });
                };
            },
            getWidgetRuntimePatches: input => widgetPatchesByScopeRef.current[input.runtimeScopeId] ?? {},
        };
    }, [
        bridge,
        closeLayer,
        core,
        clearGameAndOpenSurface,
        deleteSave,
        getSaveMetadata,
        getSavePreview,
        listSaveIds,
        loadSave,
        openSurface,
        pack,
        startStoryInGame,
        widgetRuntimeStore,
        writeSave,
    ]);

    useEffect(() => {
        lifecycleRef.current.reset();
        appBootFiredRef.current = null;
        storyEntryStartedRef.current = null;
    }, [pack?.bundle.bundleId, pack?.bundle.revision]);

    useEffect(() => {
        if (!runtimeReady || !pack || !core || !hostAdapterBundle) {
            return;
        }
        if (activeEntry && !prepaintReadyKeys.has(activeEntry.key)) {
            return;
        }
        const sig = `${pack.bundle.bundleId}:${pack.bundle.revision}`;
        if (appBootFiredRef.current === sig) {
            return;
        }
        appBootFiredRef.current = sig;
        const surfaceStore = core.scopeBridge.getSurfaceStore(hostAdapterBundle.runtimeScopeId);
        void dispatchGlobalBlueprintEvent({
            blueprintDocument: pack.bundle.ui.localBlueprints,
            eventName: "appBoot",
            hostAdapter: hostAdapterBundle.hostAdapter,
            debug: core.debug,
            getSurfaceState: key => surfaceStore.get(key),
            setSurfaceState: (key, value) => surfaceStore.set(key, value),
            executionManager: core.executionManager,
        });
    }, [activeEntry, core, hostAdapterBundle, pack, prepaintReadyKeys, runtimeReady]);

    useEffect(() => {
        if (!runtimeReady || !pack || !core || !hostAdapterBundle || !activeSurface) {
            return;
        }
        const dispatchKeyboardEvent = (eventName: "keyDown" | "keyUp", event: KeyboardEvent) => {
            const payload = keyboardBlueprintPayload(event);
            const eventControl = getOrCreateDomEventPropagationControl(event);
            const surfaceStore = core.scopeBridge.getSurfaceStore(hostAdapterBundle.runtimeScopeId);
            void dispatchGlobalBlueprintEvent({
                blueprintDocument: pack.bundle.ui.localBlueprints,
                eventName,
                eventPayload: payload,
                eventControl,
                hostAdapter: hostAdapterBundle.hostAdapter,
                debug: core.debug,
                getSurfaceState: key => surfaceStore.get(key),
                setSurfaceState: (key, value) => surfaceStore.set(key, value),
                executionManager: core.executionManager,
            }).then(() => {
                if (eventControl.isPropagationStopped()) {
                    return;
                }
                return dispatchSurfaceBlueprintEvent({
                    blueprintDocument: pack.bundle.ui.localBlueprints,
                    surfaceId: activeSurface.id,
                    runtimeScopeId: hostAdapterBundle.runtimeScopeId,
                    eventName,
                    eventPayload: payload,
                    eventControl,
                    hostAdapter: hostAdapterBundle.hostAdapter,
                    debug: core.debug,
                    getSurfaceState: key => surfaceStore.get(key),
                    setSurfaceState: (key, value) => surfaceStore.set(key, value),
                    executionManager: core.executionManager,
                });
            }).catch(err => bridge?.log("error", normalizeError(err)));
        };
        const onKeyDown = (event: KeyboardEvent) => dispatchKeyboardEvent("keyDown", event);
        const onKeyUp = (event: KeyboardEvent) => dispatchKeyboardEvent("keyUp", event);
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
        };
    }, [activeSurface, bridge, core, hostAdapterBundle, pack, runtimeReady]);

    if (error) {
        return <RuntimeErrorScreen message={error} />;
    }
    if (!pack || !activeSurface || !activeEntry) {
        return <RuntimeLoadingScreen />;
    }
    if (!runtimeReady || !core || !hostAdapterBundle) {
        return <RuntimeViewportFrame surface={activeSurface} scale={scale} />;
    }

    return (
        <RuntimeViewportFrame surface={activeSurface} scale={scale}>
            <NlrStageLayer
                session={nlrSession}
                interactive={true}
                onFirstSceneReady={() => undefined}
                onLiveGameReady={(_sessionId, liveGame) => {
                    liveGameRef.current = liveGame;
                }}
                onError={err => bridge?.log("error", normalizeError(err))}
            />
            <div className="absolute inset-0 z-10">
                <AnimatePresence initial={false} mode="sync">
                    <RuntimeSurfaceLayer
                        key={activeEntry.key}
                        pack={pack}
                        core={core}
                        entry={activeEntry}
                        surface={activeSurface}
                        rendererRegistry={rendererRegistry}
                        scale={scale}
                        hostAdapterBundle={hostAdapterBundle}
                        widgetPatchesByScope={widgetPatchesByScope}
                        widgetPatchesByScopeRef={widgetPatchesByScopeRef}
                        widgetRuntimeStore={widgetRuntimeStore}
                        lifecycleRef={lifecycleRef}
                        nestedSurfaceRuntime={nestedSurfaceRuntime}
                        blueprintLifecycleReady={prepaintReadyKeys.has(activeEntry.key)}
                        reducedMotion={prefersReducedMotion === true}
                        onPrepaintReady={markSurfacePrepaintReady}
                    />
                </AnimatePresence>
            </div>
        </RuntimeViewportFrame>
    );
}
