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
import { AnimatePresence, useReducedMotion } from "motion/react";
import {
    Dialog as NlrDialog,
    Game,
    KeyBindingType,
    useDialog,
    type LiveGame,
    type SavedGame,
} from "narraleaf-react";
import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";
import type { DevModeBundle, DevModeStartStoryRequest } from "@shared/types/devMode";
import type { GameRuntimePackV1 } from "@shared/types/gameRuntime";
import type { UIDocument, UIStageSlotId, UIStageSurface, UISurface } from "@shared/types/ui-editor/document";
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
import {
    clearDevModeSavePreviewImages,
    registerDevModeSavePreviewImage,
} from "@/lib/ui-editor/runtime/devModeSavePreviewAssets";
import {
    createDevModeBlueprintHostApi,
    type BlueprintGamePreferenceKey,
    type BlueprintGamePreferenceValue,
    type DevModeWidgetRuntimePatch,
} from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { createDevModeBlueprintHostAdapter } from "@/lib/ui-editor/runtime/hostAdapters/devModeBlueprintHostAdapter";
import {
    useBlueprintRuntimeCore,
    type BlueprintRuntimeCore,
} from "@/lib/ui-editor/runtime/game/useBlueprintRuntimeCore";
import { SurfaceLifecycleManager } from "@/lib/ui-editor/blueprint-runtime/SurfaceLifecycleManager";
import {
    dispatchGlobalBlueprintEvent,
    dispatchSurfaceBlueprintEvent,
} from "@/lib/ui-editor/blueprint-runtime/BlueprintDispatcher";
import { getOrCreateDomEventPropagationControl } from "@/lib/ui-editor/runtime/eventPropagationControl";
import { compileStudioStoryToNlr } from "@/lib/ui-editor/runtime/game/storyCompiler";
import { NlrStageLayer, type NlrStageSession } from "@/lib/ui-editor/runtime/game/NlrStageLayer";
import { BLUEPRINT_GAME_NAMETAG_STATE_KEY } from "@shared/types/blueprint/hostApi";
import { collectDialogFlushElementIds } from "@/lib/ui-editor/runtime/game/dialogFlushTargets";
import {
    createSurfaceNavigationCloseUpdate,
    createSurfaceNavigationOpenUpdate,
    type SurfaceNavigationEntry,
    type SurfaceNavigationPresentation,
} from "@/lib/ui-editor/runtime/game/surfaceNavigationController";
import {
    preloadRuntimePackAssets,
    type RuntimeSurfacePreloadResult,
} from "./surfaceResourcePreload";

type RuntimeCore = BlueprintRuntimeCore;

type RuntimeNavEntry = SurfaceNavigationEntry<Record<string, unknown>, RuntimePagePresentation> & {
    runtimeScopeId: string;
};

type RuntimePagePresentation = SurfaceNavigationPresentation;
type RuntimeOpenSurfaceOptions = {
    presentation?: RuntimePagePresentation;
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

type SurfaceStateAccessors = {
    get: (key: string) => unknown;
    set: (key: string, value: unknown) => void;
};

type NlrCharacterLike = {
    state?: {
        name?: unknown;
    };
};

type NlrLiveGameWithLastDialog = LiveGame & {
    lastDialog?: {
        speaker?: unknown;
    } | null;
};

function coerceNametagValue(value: unknown): string | null {
    if (value == null) {
        return null;
    }
    const text = String(value);
    return text.trim().length > 0 ? text : null;
}

function readNlrCharacterName(character: unknown): string | null {
    return coerceNametagValue((character as NlrCharacterLike | null | undefined)?.state?.name);
}

function readNlrLastDialogSpeaker(liveGame: LiveGame | null): string | null {
    const lastDialog = (liveGame as NlrLiveGameWithLastDialog | null)?.lastDialog;
    return lastDialog ? coerceNametagValue(lastDialog.speaker) : null;
}

function waitForAnimationFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
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

function findStageSurfaceForSlot(document: UIDocument, slotId: UIStageSlotId): UIStageSurface | null {
    const matches = document.surfaces.filter((surface): surface is UIStageSurface =>
        surface.kind === "stageSurface" && surface.mount.slotId === slotId
    );
    if (matches.length > 1) {
        console.warn(
            `[Runtime][GameUI] Multiple active surfaces found for slot "${slotId}". ` +
            `Using the first surface in document order: ${matches[0]?.id ?? "(unknown)"}.`,
        );
    }
    return matches[0] ?? null;
}

function dialogSlotRuntimeScopeId(sessionId: string, surfaceId: string): string {
    return `nlr:${sessionId}:slot:dialog:${surfaceId}`;
}

const staticRuntimeHostAdapter = (surface: UISurface): UIHostAdapter => ({
    host: surface.host,
});

function createNavEntry(
    surfaceId: string,
    direction: PageAnimationNavigationDirection = "forward",
    waitForExit = false,
    props?: Record<string, unknown>,
    presentation: RuntimePagePresentation = "appPage",
): RuntimeNavEntry {
    const key = `${surfaceId}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    return {
        key,
        surfaceId,
        runtimeScopeId: key,
        props: cloneProps(props),
        direction,
        waitForExit,
        presentation,
    };
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
    const bridge = getGameRuntimeBridge();
    const persistenceAdapter = useMemo(() => {
        if (!bridge) {
            return null;
        }
        return {
            getAll: async () => bridge.persistence.getAll(),
            getValue: async (key: string) => bridge.persistence.getValue(key),
            setValue: async (key: string, value: unknown) => bridge.persistence.setValue(key, value),
            removeValue: async (key: string) => bridge.persistence.removeValue(key),
        };
    }, [bridge]);
    const onDebugEvent = useCallback((event: BlueprintDebugEvent) => {
        if (!bridge) {
            return;
        }
        if (event.type === "execution.error") {
            bridge.log("error", event.message);
        } else if (event.type === "devtools.log") {
            const level = event.level === "error" || event.level === "warning" ? event.level : "info";
            bridge.log(level, event.message);
        }
    }, [bridge]);

    return useBlueprintRuntimeCore(pack?.bundle ?? null, {
        persistenceAdapter,
        onDebugEvent,
        disposeMessage: "Preview runtime disposed",
    });
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

function RuntimeSurfaceLifecycleLayer(props: {
    core: RuntimeCore | null;
    pack: GameRuntimePackV1;
    surface: UISurface;
    runtimeScopeId: string;
    hostAdapter: UIHostAdapter;
    lifecycleRef: MutableRefObject<SurfaceLifecycleManager>;
    makeStateAccessors: (runtimeScopeId: string) => SurfaceStateAccessors | null;
    children: ReactNode;
}) {
    const { core, pack, surface, runtimeScopeId, hostAdapter, lifecycleRef, makeStateAccessors, children } = props;
    const latestRuntimeHostAdapterRef = useRef<UIHostAdapter | null>(
        hostAdapter.blueprintRuntime ? hostAdapter : null,
    );
    const hasBlueprintRuntime = Boolean(hostAdapter.blueprintRuntime);

    useEffect(() => {
        if (hostAdapter.blueprintRuntime) {
            latestRuntimeHostAdapterRef.current = hostAdapter;
        }
    }, [hostAdapter]);

    useEffect(() => {
        const currentHostAdapter = latestRuntimeHostAdapterRef.current;
        if (!core || !hasBlueprintRuntime || !currentHostAdapter?.blueprintRuntime) {
            return;
        }
        let cancelled = false;
        void (async () => {
            await waitForAnimationFrame();
            if (cancelled) {
                return;
            }
            core.executionManager.openScope(runtimeScopeId);
            if (!lifecycleRef.current.onSurfaceEnter(runtimeScopeId)) {
                return;
            }
            const acc = makeStateAccessors(runtimeScopeId);
            if (!acc) {
                return;
            }
            void dispatchSurfaceBlueprintEvent({
                blueprintDocument: pack.bundle.ui.localBlueprints,
                surfaceId: surface.id,
                runtimeScopeId,
                eventName: "surfaceInit",
                hostAdapter: currentHostAdapter,
                debug: core.debug,
                getSurfaceState: acc.get,
                setSurfaceState: acc.set,
                executionManager: core.executionManager,
            });
        })();
        return () => {
            cancelled = true;
        };
    }, [core, hasBlueprintRuntime, lifecycleRef, makeStateAccessors, pack.bundle.ui.localBlueprints, runtimeScopeId, surface.id]);

    useEffect(() => {
        if (!core || !hasBlueprintRuntime) {
            return undefined;
        }
        const surfaceToUnmount = surface.id;
        const scopeToUnmount = runtimeScopeId;
        return () => {
            const currentHostAdapter = latestRuntimeHostAdapterRef.current;
            lifecycleRef.current.onSurfaceExit(scopeToUnmount);
            core.executionManager.closeScope(scopeToUnmount, "Preview surface unmounted");
            const acc = makeStateAccessors(scopeToUnmount);
            if (!acc || !currentHostAdapter?.blueprintRuntime) {
                return;
            }
            void dispatchSurfaceBlueprintEvent({
                blueprintDocument: pack.bundle.ui.localBlueprints,
                surfaceId: surfaceToUnmount,
                runtimeScopeId: scopeToUnmount,
                eventName: "surfaceUnmount",
                hostAdapter: currentHostAdapter,
                debug: core.debug,
                getSurfaceState: acc.get,
                setSurfaceState: acc.set,
                executionManager: core.executionManager,
                allowClosedScopeExecution: true,
            });
        };
    }, [core, hasBlueprintRuntime, lifecycleRef, makeStateAccessors, pack.bundle.ui.localBlueprints, runtimeScopeId, surface.id]);

    return <>{children}</>;
}

function RuntimeDialogStateBridge(props: {
    core: RuntimeCore | null;
    getCurrentNametag: () => string | null;
    flushDialogElements: () => void;
}) {
    const { core, getCurrentNametag, flushDialogElements } = props;
    const dialog = useDialog();

    useEffect(() => {
        if (!core) {
            return;
        }
        const nametag = dialog.isNarrator ? null : getCurrentNametag();
        core.scopeBridge.globalSet(BLUEPRINT_GAME_NAMETAG_STATE_KEY, nametag);
        flushDialogElements();
    }, [core, dialog.done, dialog.isNarrator, dialog.text, flushDialogElements, getCurrentNametag]);

    return null;
}

function RuntimeDialogSlotSurface(props: {
    sessionId: string;
    core: RuntimeCore | null;
    pack: GameRuntimePackV1;
    surface: UIStageSurface;
    rendererRegistry: ElementRendererRegistry;
    lifecycleRef: MutableRefObject<SurfaceLifecycleManager>;
    makeStateAccessors: (runtimeScopeId: string) => SurfaceStateAccessors | null;
    openSurfaceWithTransition: (
        surfaceId: string,
        props?: Record<string, unknown>,
        options?: RuntimeOpenSurfaceOptions,
    ) => Promise<void>;
    closeLayerWithTransition: () => Promise<void>;
    quitApplication: () => Promise<void>;
    startStoryInGame: (request: DevModeStartStoryRequest) => Promise<void>;
    writeSaveInGame: (id: string, metadata?: unknown, screenshot?: boolean) => Promise<void>;
    loadSaveInGame: (id: string) => Promise<void>;
    deleteSaveInGame: (id: string) => Promise<void>;
    listSaveIds: () => Promise<string[]>;
    getSaveMetadata: (id: string) => Promise<unknown>;
    getSavePreview: (id: string) => Promise<BlueprintImageAsset | null>;
    getCurrentNametag: () => string | null;
    isInGame: () => boolean;
    quitGame: (surfaceId: string) => Promise<void>;
    nextInGame: () => Promise<void>;
    skipInGame: () => Promise<void>;
    showDialogInGame: () => Promise<void>;
    hideDialogInGame: () => Promise<void>;
    toggleDialogDisplayInGame: () => Promise<void>;
    setSentenceSpeedInGame: (cps: number) => Promise<void>;
    getGamePreferenceInGame: (key: BlueprintGamePreferenceKey) => BlueprintGamePreferenceValue;
    setGamePreferenceInGame: (key: BlueprintGamePreferenceKey, value: BlueprintGamePreferenceValue) => Promise<void>;
    setDialogVirtualClickTarget: (target: HTMLElement | null) => void;
    setWidgetPatchesByScope: Dispatch<SetStateAction<Record<string, Record<string, DevModeWidgetRuntimePatch>>>>;
    widgetPatchesByScopeRef: MutableRefObject<Record<string, Record<string, DevModeWidgetRuntimePatch>>>;
    widgetRuntimeStore: WidgetRuntimeStateStore;
}) {
    const {
        sessionId,
        core,
        pack,
        surface,
        rendererRegistry,
        lifecycleRef,
        makeStateAccessors,
        openSurfaceWithTransition,
        closeLayerWithTransition,
        quitApplication,
        startStoryInGame,
        writeSaveInGame,
        loadSaveInGame,
        deleteSaveInGame,
        listSaveIds,
        getSaveMetadata,
        getSavePreview,
        getCurrentNametag,
        isInGame,
        quitGame,
        nextInGame,
        skipInGame,
        showDialogInGame,
        hideDialogInGame,
        toggleDialogDisplayInGame,
        setSentenceSpeedInGame,
        getGamePreferenceInGame,
        setGamePreferenceInGame,
        setDialogVirtualClickTarget,
        setWidgetPatchesByScope,
        widgetPatchesByScopeRef,
        widgetRuntimeStore,
    } = props;
    const runtimeScopeId = useMemo(() => dialogSlotRuntimeScopeId(sessionId, surface.id), [sessionId, surface.id]);
    const hostAdapterRef = useRef<UIHostAdapter | null>(null);
    const document = pack.bundle.ui.uidoc;

    useEffect(() => () => setDialogVirtualClickTarget(null), [setDialogVirtualClickTarget]);

    const hostApi = useMemo(() => {
        if (!core) {
            return null;
        }
        return createDevModeBlueprintHostApi({
            document,
            scope: core.scopeBridge,
            activeSurfaceId: surface.id,
            runtimeScopeId,
            pageProps: {},
            emit: event => core.debug.emit(event),
            onOpenSurface: openSurfaceWithTransition,
            onCloseLayer: closeLayerWithTransition,
            onQuitApplication: quitApplication,
            onStartStory: startStoryInGame,
            onWriteSave: writeSaveInGame,
            onLoadSave: loadSaveInGame,
            onDeleteSave: deleteSaveInGame,
            onListSaveIds: listSaveIds,
            onGetSaveMetadata: getSaveMetadata,
            onGetSavePreview: getSavePreview,
            onGetNametag: getCurrentNametag,
            onIsInGame: isInGame,
            onIsGameOverlay: () => true,
            onQuitGame: quitGame,
            onNext: nextInGame,
            onSkip: skipInGame,
            onShowDialog: showDialogInGame,
            onHideDialog: hideDialogInGame,
            onToggleDialogDisplay: toggleDialogDisplayInGame,
            onSetSentenceSpeed: setSentenceSpeedInGame,
            onGetGamePreference: getGamePreferenceInGame,
            onSetGamePreference: setGamePreferenceInGame,
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
                void hostAdapterRef.current?.blueprintRuntime?.dispatchElementBlueprintEvent(
                    elementId,
                    "flush",
                    payload,
                );
            },
            widgetRuntimeStore,
        });
    }, [
        core,
        closeLayerWithTransition,
        deleteSaveInGame,
        document,
        getCurrentNametag,
        getSaveMetadata,
        getSavePreview,
        hideDialogInGame,
        isInGame,
        listSaveIds,
        loadSaveInGame,
        nextInGame,
        openSurfaceWithTransition,
        quitApplication,
        quitGame,
        runtimeScopeId,
        setSentenceSpeedInGame,
        getGamePreferenceInGame,
        setGamePreferenceInGame,
        setWidgetPatchesByScope,
        showDialogInGame,
        skipInGame,
        startStoryInGame,
        surface.id,
        toggleDialogDisplayInGame,
        widgetRuntimeStore,
        widgetPatchesByScopeRef,
        writeSaveInGame,
    ]);

    const hostAdapter = useMemo((): UIHostAdapter => {
        if (!core || !hostApi) {
            return {
                ...staticRuntimeHostAdapter(surface),
                gameUiRuntime: { slotId: "dialog" },
            };
        }
        return {
            ...createDevModeBlueprintHostAdapter({
                bundle: pack.bundle,
                surface,
                runtimeScopeId,
                scopeBridge: core.scopeBridge,
                debug: core.debug,
                hostApi,
                executionManager: core.executionManager,
            }),
            gameUiRuntime: { slotId: "dialog" },
        };
    }, [core, hostApi, pack.bundle, runtimeScopeId, surface]);

    useEffect(() => {
        hostAdapterRef.current = hostAdapter;
    }, [hostAdapter]);

    const dialogFlushElementIds = useMemo(
        () => collectDialogFlushElementIds({
            document,
            blueprintDocument: pack.bundle.ui.localBlueprints,
            surface,
        }),
        [document, pack.bundle.ui.localBlueprints, surface],
    );
    const flushDialogElements = useCallback(() => {
        for (const elementId of dialogFlushElementIds) {
            const element = document.elements[elementId];
            if (!element) {
                continue;
            }
            void hostAdapterRef.current?.blueprintRuntime?.dispatchElementBlueprintEvent(
                elementId,
                "flush",
                {
                    element: {
                        surfaceId: surface.id,
                        elementId,
                        elementType: element.type,
                    },
                },
            );
        }
    }, [dialogFlushElementIds, document, surface.id]);

    const globalStateReader = useMemo(() => {
        if (!core) {
            return undefined;
        }
        return {
            get: (key: string) => core.scopeBridge.globalGet(key),
            subscribe: (listener: () => void) => core.scopeBridge.subscribeGlobals(listener),
        };
    }, [core]);

    const bindingContext = useMemo(() => {
        if (!core) {
            return null;
        }
        return {
            blueprintDocument: pack.bundle.ui.localBlueprints,
            surfaceState: core.scopeBridge.getSurfaceStore(runtimeScopeId),
            debug: core.debug,
            coalescer: core.bindingDebugCoalescer,
            globalState: globalStateReader,
        };
    }, [core, globalStateReader, pack.bundle.ui.localBlueprints, runtimeScopeId]);

    return (
        <NlrDialog
            ref={setDialogVirtualClickTarget}
            style={{ width: "100%", height: "100%", position: "relative" }}
        >
            <RuntimeDialogStateBridge
                core={core}
                getCurrentNametag={getCurrentNametag}
                flushDialogElements={flushDialogElements}
            />
            <RuntimeSurfaceLifecycleLayer
                core={core}
                pack={pack}
                surface={surface}
                runtimeScopeId={runtimeScopeId}
                hostAdapter={hostAdapter}
                lifecycleRef={lifecycleRef}
                makeStateAccessors={makeStateAccessors}
            >
                <WidgetRuntimeStateProvider externalStore={widgetRuntimeStore}>
                    <GameSurfaceRenderer
                        document={document}
                        surface={surface}
                        rendererRegistry={rendererRegistry}
                        scale={1}
                        hostAdapter={hostAdapter}
                        blueprintBindingContext={bindingContext}
                        getWidgetRuntimePatches={() => widgetPatchesByScopeRef.current[runtimeScopeId] ?? {}}
                    />
                </WidgetRuntimeStateProvider>
            </RuntimeSurfaceLifecycleLayer>
        </NlrDialog>
    );
}

function createRuntimeDialogComponent(options: ComponentProps<typeof RuntimeDialogSlotSurface>) {
    return function RuntimeDialogGameUI() {
        return <RuntimeDialogSlotSurface {...options} />;
    };
}

function RuntimeSurfaceLayer(props: {
    pack: GameRuntimePackV1;
    core: RuntimeCore;
    entry: RuntimeNavEntry;
    layerIndex: number;
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
    active: boolean;
    onInteractionReadyChange: (entryKey: string, ready: boolean) => void;
    onPrepaintReady: (entryKey: string) => void;
    onEnterComplete: (entryKey: string) => void;
}): ReactNode {
    const {
        pack,
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
            <RuntimeSurfaceLifecycleLayer
                core={surfaceBlueprintLifecycleReady ? core : null}
                pack={pack}
                surface={surface}
                runtimeScopeId={hostAdapterBundle.runtimeScopeId}
                hostAdapter={hostAdapterBundle.hostAdapter}
                lifecycleRef={lifecycleRef}
                makeStateAccessors={makeStateAccessors}
            >
                <WidgetRuntimeStateProvider externalStore={widgetRuntimeStore}>
                    <GameSurfaceRenderer
                        document={pack.bundle.ui.uidoc}
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
            </RuntimeSurfaceLifecycleLayer>
        </SurfaceAnimationLayer>
    );
}

function RuntimeSurfaceLayerWithAdapter(props: {
    pack: GameRuntimePackV1;
    core: RuntimeCore;
    entry: RuntimeNavEntry;
    layerIndex: number;
    surface: UISurface;
    rendererRegistry: ElementRendererRegistry;
    scale: number;
    createHostAdapterBundle: (entry: RuntimeNavEntry, surface: UISurface) => RuntimeHostAdapterBundle | null;
    widgetPatchesByScope: Record<string, Record<string, DevModeWidgetRuntimePatch>>;
    widgetPatchesByScopeRef: MutableRefObject<Record<string, Record<string, DevModeWidgetRuntimePatch>>>;
    widgetRuntimeStore: WidgetRuntimeStateStore;
    lifecycleRef: MutableRefObject<SurfaceLifecycleManager>;
    nestedSurfaceRuntime?: NestedSurfaceRuntime;
    blueprintLifecycleReady: boolean;
    reducedMotion: boolean;
    active: boolean;
    onInteractionReadyChange: (entryKey: string, ready: boolean) => void;
    onPrepaintReady: (entryKey: string) => void;
    onEnterComplete: (entryKey: string) => void;
}) {
    const {
        entry,
        surface,
        createHostAdapterBundle,
    } = props;
    const hostAdapterBundle = useMemo(
        () => createHostAdapterBundle(entry, surface),
        [createHostAdapterBundle, entry, surface],
    );
    if (!hostAdapterBundle) {
        return null;
    }
    return <RuntimeSurfaceLayer {...props} hostAdapterBundle={hostAdapterBundle} />;
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
    const [visibleEntries, setVisibleEntries] = useState<RuntimeNavEntry[]>([]);
    const [surfacePresenceMode, setSurfacePresenceMode] = useState<"sync" | "wait">("sync");
    const [prepaintReadyKeys, setPrepaintReadyKeys] = useState<Set<string>>(() => new Set());
    const [interactionReadyKeys, setInteractionReadyKeys] = useState<Set<string>>(() => new Set());
    const [nlrSession, setNlrSession] = useState<NlrStageSession | null>(null);
    const [gameStageVisible, setGameStageVisible] = useState(false);
    const [studioPageHiddenForGame, setStudioPageHiddenForGame] = useState(false);
    const [gameHiddenNavKeys, setGameHiddenNavKeys] = useState<Set<string>>(() => new Set());
    const navStackRef = useRef<RuntimeNavEntry[]>([]);
    const visibleEntriesRef = useRef<RuntimeNavEntry[]>([]);
    const activeNavKeyRef = useRef<string | null>(null);
    const activeEntryRef = useRef<RuntimeNavEntry | null>(null);
    const activeSurfaceRef = useRef<UISurface | null>(null);
    const pendingWaitEntryRef = useRef<RuntimeNavEntry | null>(null);
    const pendingUnderlayReadyKeyRef = useRef<string | null>(null);
    const pendingRemoveAfterEnterKeyRef = useRef<string | null>(null);
    const transitionDirectionRef = useRef<PageAnimationNavigationDirection>("forward");
    const transitionWaitRef = useRef<{
        resolve: (() => void) | null;
        timeoutId: ReturnType<typeof setTimeout> | null;
        enterDone: boolean;
        exitDone: boolean;
    }>({ resolve: null, timeoutId: null, enterDone: true, exitDone: true });
    const studioPageHiddenForGameRef = useRef(false);
    const gameHiddenNavKeysRef = useRef(gameHiddenNavKeys);
    const lifecycleRef = useRef(new SurfaceLifecycleManager());
    const appBootFiredRef = useRef<string | null>(null);
    const gameReadyFiredRef = useRef<string | null>(null);
    const storyEntryStartedRef = useRef<string | null>(null);
    const cleanupBundleIdRef = useRef<string | null>(null);
    const activeStoryRequestRef = useRef<DevModeStartStoryRequest | null>(null);
    const activeStoryRevisionRef = useRef<number | null>(null);
    const pendingGameStartsRef = useRef(new Map<string, { resolve: () => void; reject: (error: Error) => void }>());
    const nlrLiveGameRef = useRef<LiveGame | null>(null);
    const nlrLiveGameSessionIdRef = useRef<string | null>(null);
    const nlrDialogVirtualClickTargetRef = useRef<HTMLElement | null>(null);
    const nlrCharacterPromptTokenRef = useRef<{ cancel(): void } | null>(null);
    const currentDialogNametagRef = useRef<string | null>(null);
    const prefersReducedMotion = useReducedMotion();

    useEffect(() => {
        widgetPatchesByScopeRef.current = widgetPatchesByScope;
    }, [widgetPatchesByScope]);

    useEffect(() => {
        navStackRef.current = navStack;
    }, [navStack]);

    useEffect(() => {
        visibleEntriesRef.current = visibleEntries;
    }, [visibleEntries]);

    useEffect(() => {
        studioPageHiddenForGameRef.current = studioPageHiddenForGame;
    }, [studioPageHiddenForGame]);

    useEffect(() => {
        gameHiddenNavKeysRef.current = gameHiddenNavKeys;
    }, [gameHiddenNavKeys]);

    useEffect(() => {
        if (!pack) {
            setNavStack([]);
            setVisibleEntries([]);
            return;
        }
        const entrySurfaceId = pack.entry.kind === "surface" ? pack.entry.surfaceId : pack.entry.surfaceId;
        const surface = findSurface(pack.bundle, entrySurfaceId);
        setPrepaintReadyKeys(new Set());
        setInteractionReadyKeys(new Set());
        pendingWaitEntryRef.current = null;
        pendingUnderlayReadyKeyRef.current = null;
        pendingRemoveAfterEnterKeyRef.current = null;
        transitionDirectionRef.current = "forward";
        setSurfacePresenceMode("sync");
        const initial = surface ? createNavEntry(surface.id, "forward", false) : null;
        setNavStack(initial ? [initial] : []);
        setVisibleEntries(initial ? [initial] : []);
        widgetPatchesByScopeRef.current = {};
        setWidgetPatchesByScope({});
        gameHiddenNavKeysRef.current = new Set();
        setGameHiddenNavKeys(new Set());
        studioPageHiddenForGameRef.current = false;
        setStudioPageHiddenForGame(false);
        setGameStageVisible(false);
    }, [pack]);

    const activeEntry = navStack[navStack.length - 1] ?? null;
    const activeSurface = pack && activeEntry ? findSurface(pack.bundle, activeEntry.surfaceId) : null;

    useEffect(() => {
        activeNavKeyRef.current = activeEntry?.key ?? null;
        activeEntryRef.current = activeEntry;
        activeSurfaceRef.current = activeSurface;
    }, [activeEntry, activeSurface]);
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
        (
            durationMs: number,
            options?: { waitForEnter?: boolean; waitForExit?: boolean },
        ): Promise<void> => {
            completeTransitionWait();
            const waitForEnter = options?.waitForEnter ?? true;
            const waitForExit = options?.waitForExit ?? true;
            if (!waitForEnter && !waitForExit) {
                return Promise.resolve();
            }
            return new Promise(resolve => {
                const timeoutId = setTimeout(() => {
                    completeTransitionWait();
                }, Math.max(0, durationMs) + 1080);
                transitionWaitRef.current = {
                    resolve,
                    timeoutId,
                    enterDone: !waitForEnter,
                    exitDone: !waitForExit,
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
            if (pendingRemoveAfterEnterKeyRef.current === entryKey) {
                pendingRemoveAfterEnterKeyRef.current = null;
                setVisibleEntries(prev => prev.filter(entry => entry.key === entryKey));
            }
            tryCompleteTransitionWait();
        },
        [tryCompleteTransitionWait],
    );

    const markExitComplete = useCallback(() => {
        transitionWaitRef.current.exitDone = true;
        tryCompleteTransitionWait();
    }, [tryCompleteTransitionWait]);

    const handleSurfaceLayerPrepaintReady = useCallback((entryKey: string) => {
        markSurfacePrepaintReady(entryKey);
        if (pendingUnderlayReadyKeyRef.current !== entryKey) {
            return;
        }
        pendingUnderlayReadyKeyRef.current = null;
        setVisibleEntries(prev => prev.filter(entry => entry.key === entryKey));
    }, [markSurfacePrepaintReady]);

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

    const handleSurfaceInteractionReadyChange = useCallback((entryKey: string, ready: boolean) => {
        setInteractionReadyKeys(prev => {
            const alreadyReady = prev.has(entryKey);
            if (alreadyReady === ready) {
                return prev;
            }
            const next = new Set(prev);
            if (ready) {
                next.add(entryKey);
            } else {
                next.delete(entryKey);
            }
            return next;
        });
    }, []);

    const resetSurfaceInteractionReadiness = useCallback(() => {
        setInteractionReadyKeys(prev => (prev.size === 0 ? prev : new Set()));
    }, []);

    const isGameHiddenEntry = useCallback((entry: RuntimeNavEntry | null | undefined): boolean => {
        return Boolean(entry && studioPageHiddenForGameRef.current && gameHiddenNavKeysRef.current.has(entry.key));
    }, []);

    const hideCurrentStudioPagesForGame = useCallback(() => {
        const hiddenKeys = new Set(navStackRef.current.map(entry => entry.key));
        gameHiddenNavKeysRef.current = hiddenKeys;
        studioPageHiddenForGameRef.current = true;
        setGameHiddenNavKeys(hiddenKeys);
        setStudioPageHiddenForGame(true);
        setVisibleEntries(prev => prev.filter(entry => !hiddenKeys.has(entry.key)));
        pendingWaitEntryRef.current = null;
        pendingUnderlayReadyKeyRef.current = null;
        pendingRemoveAfterEnterKeyRef.current = null;
        setSurfacePresenceMode("sync");
        resetSurfaceInteractionReadiness();
        completeTransitionWait();
    }, [completeTransitionWait, resetSurfaceInteractionReadiness]);

    const clearGameHiddenStudioPages = useCallback(() => {
        const emptyKeys = new Set<string>();
        gameHiddenNavKeysRef.current = emptyKeys;
        studioPageHiddenForGameRef.current = false;
        setGameHiddenNavKeys(emptyKeys);
        setStudioPageHiddenForGame(false);
    }, []);

    const openSurface = useCallback((
        surfaceId: string,
        props?: Record<string, unknown>,
        options?: RuntimeOpenSurfaceOptions,
    ): Promise<void> => {
        if (!pack) {
            return Promise.resolve();
        }
        const from = activeSurfaceRef.current;
        const target = findSurface(pack.bundle, surfaceId);
        const currentEntry = activeEntryRef.current;
        if (!target) {
            return Promise.reject(new Error(`Open Page: surface not found: ${surfaceId}`));
        }
        const currentHiddenForGame = isGameHiddenEntry(currentEntry);
        const presentation = options?.presentation ?? (studioPageHiddenForGameRef.current ? "gameOverlay" : "appPage");
        const update = createSurfaceNavigationOpenUpdate({
            navStack: navStackRef.current,
            visibleEntries: visibleEntriesRef.current,
            activeEntry: currentEntry,
            fromSurface: from,
            targetSurface: target,
            currentHiddenForGame,
            prefersReducedMotion,
            createNextEntry: waitForExit => createNavEntry(target.id, "forward", waitForExit, props, presentation),
        });
        transitionDirectionRef.current = update.direction;
        const wait = beginTransitionWait(
            update.transitionDurationMs,
            update.transitionWaitOptions,
        );
        resetSurfaceInteractionReadiness();
        pendingWaitEntryRef.current = update.pendingWaitEntry;
        pendingUnderlayReadyKeyRef.current = update.pendingUnderlayReadyKey;
        pendingRemoveAfterEnterKeyRef.current = update.pendingRemoveAfterEnterKey;
        setSurfacePresenceMode(update.surfacePresenceMode);
        setNavStack(update.navStack);
        setVisibleEntries(update.visibleEntries);
        return wait;
    }, [
        beginTransitionWait,
        isGameHiddenEntry,
        pack,
        prefersReducedMotion,
        resetSurfaceInteractionReadiness,
    ]);

    const closeLayer = useCallback((): Promise<void> => {
        const currentStack = navStackRef.current;
        if (!pack || currentStack.length <= 1) {
            return Promise.resolve();
        }
        const nextEntryBase = currentStack[currentStack.length - 2]!;
        const target = findSurface(pack.bundle, nextEntryBase.surfaceId);
        const from = activeSurfaceRef.current;
        const targetHiddenForGame = isGameHiddenEntry(nextEntryBase);
        const update = createSurfaceNavigationCloseUpdate({
            navStack: currentStack,
            fromSurface: from,
            targetSurface: target,
            targetHiddenForGame,
            prefersReducedMotion,
        });
        if (!update) {
            return Promise.resolve();
        }
        transitionDirectionRef.current = update.direction;
        const wait = beginTransitionWait(
            update.transitionDurationMs,
            update.transitionWaitOptions,
        );
        resetSurfaceInteractionReadiness();
        pendingWaitEntryRef.current = update.pendingWaitEntry;
        pendingUnderlayReadyKeyRef.current = update.pendingUnderlayReadyKey;
        pendingRemoveAfterEnterKeyRef.current = update.pendingRemoveAfterEnterKey;
        setSurfacePresenceMode(update.surfacePresenceMode);
        setNavStack(update.navStack);
        setVisibleEntries(update.visibleEntries);
        return wait;
    }, [
        beginTransitionWait,
        isGameHiddenEntry,
        pack,
        prefersReducedMotion,
        resetSurfaceInteractionReadiness,
    ]);

    const makeStateAccessors = useCallback(
        (runtimeScopeId: string): SurfaceStateAccessors | null => {
            if (!core) {
                return null;
            }
            const store = core.scopeBridge.getSurfaceStore(runtimeScopeId);
            return {
                get: (key: string) => store.get(key),
                set: (key: string, value: unknown) => store.set(key, value),
            };
        },
        [core],
    );

    const rejectPendingGameStarts = useCallback((gameError: Error) => {
        pendingGameStartsRef.current.forEach(pending => pending.reject(gameError));
        pendingGameStartsRef.current.clear();
    }, []);

    const clearCurrentDialogNametag = useCallback(() => {
        currentDialogNametagRef.current = null;
        core?.scopeBridge.globalSet(BLUEPRINT_GAME_NAMETAG_STATE_KEY, null);
    }, [core]);

    const getCurrentNametag = useCallback((): string | null => {
        const liveGameSpeaker = readNlrLastDialogSpeaker(nlrLiveGameRef.current);
        return liveGameSpeaker ?? currentDialogNametagRef.current;
    }, []);

    const isInGame = useCallback((): boolean => {
        return Boolean(gameStageVisible && nlrSession?.id);
    }, [gameStageVisible, nlrSession?.id]);

    const setNlrDialogVirtualClickTarget = useCallback((target: HTMLElement | null): void => {
        nlrDialogVirtualClickTargetRef.current = target;
    }, []);

    const requireActiveLiveGame = useCallback((operation: string): LiveGame => {
        if (!nlrSession?.id || nlrLiveGameSessionIdRef.current !== nlrSession.id || !nlrLiveGameRef.current) {
            throw new Error(`${operation}: game runtime is not available`);
        }
        return nlrLiveGameRef.current;
    }, [nlrSession?.id]);

    const nextInGame = useCallback(async (): Promise<void> => {
        const dialogClickTarget = nlrDialogVirtualClickTargetRef.current;
        if (dialogClickTarget?.isConnected) {
            dialogClickTarget.click();
            return;
        }
        const liveGame = requireActiveLiveGame("Next");
        const gameState = liveGame.getGameState();
        if (!gameState) {
            throw new Error("Next: game state is not available");
        }
        const clickTarget = gameState.mainContentNode ?? gameState.playerCurrent;
        if (!clickTarget) {
            throw new Error("Next: virtual click target is not available");
        }
        clickTarget.click();
    }, [requireActiveLiveGame]);

    const skipInGame = useCallback(async (): Promise<void> => {
        requireActiveLiveGame("Skip").skipDialog();
    }, [requireActiveLiveGame]);

    const showDialogInGame = useCallback(async (): Promise<void> => {
        requireActiveLiveGame("Show Dialog").game.preference.setPreference("showDialog", true);
    }, [requireActiveLiveGame]);

    const hideDialogInGame = useCallback(async (): Promise<void> => {
        requireActiveLiveGame("Hide Dialog").game.preference.setPreference("showDialog", false);
    }, [requireActiveLiveGame]);

    const toggleDialogDisplayInGame = useCallback(async (): Promise<void> => {
        const preference = requireActiveLiveGame("Toggle Dialog Display").game.preference;
        preference.setPreference("showDialog", preference.getPreference("showDialog") !== true);
    }, [requireActiveLiveGame]);

    const setSentenceSpeedInGame = useCallback(async (cps: number): Promise<void> => {
        const value = typeof cps === "number" ? cps : Number(cps);
        if (!Number.isFinite(value) || value <= 0) {
            throw new Error("Set Sentence Speed: CPS must be a positive number");
        }
        requireActiveLiveGame("Set Sentence Speed").game.preference.setPreference("cps", value);
    }, [requireActiveLiveGame]);

    const getGamePreferenceInGame = useCallback((key: BlueprintGamePreferenceKey): BlueprintGamePreferenceValue => {
        const preference = requireActiveLiveGame(`Get ${key} Preference`).game.preference as {
            getPreference: (preferenceKey: BlueprintGamePreferenceKey) => unknown;
        };
        return preference.getPreference(key) as BlueprintGamePreferenceValue;
    }, [requireActiveLiveGame]);

    const setGamePreferenceInGame = useCallback(async (
        key: BlueprintGamePreferenceKey,
        value: BlueprintGamePreferenceValue,
    ): Promise<void> => {
        const preference = requireActiveLiveGame(`Set ${key} Preference`).game.preference as {
            setPreference: (preferenceKey: BlueprintGamePreferenceKey, preferenceValue: BlueprintGamePreferenceValue) => void;
        };
        preference.setPreference(key, value);
    }, [requireActiveLiveGame]);

    const quitGame = useCallback(async (surfaceId: string): Promise<void> => {
        const targetSurfaceId = String(surfaceId ?? "").trim();
        if (!targetSurfaceId) {
            throw new Error("Quit Game: surfaceId is required");
        }
        rejectPendingGameStarts(new Error("Quit Game"));
        activeStoryRequestRef.current = null;
        activeStoryRevisionRef.current = null;
        nlrCharacterPromptTokenRef.current?.cancel();
        nlrCharacterPromptTokenRef.current = null;
        nlrDialogVirtualClickTargetRef.current = null;
        gameReadyFiredRef.current = null;
        nlrLiveGameRef.current = null;
        nlrLiveGameSessionIdRef.current = null;
        clearCurrentDialogNametag();
        setGameStageVisible(false);
        await openSurface(targetSurfaceId, undefined, { presentation: "appPage" });
        setNlrSession(null);
        clearGameHiddenStudioPages();
    }, [clearCurrentDialogNametag, clearGameHiddenStudioPages, openSurface, rejectPendingGameStarts]);

    const quitApplication = useCallback(async (): Promise<void> => {
        await bridge?.close();
    }, [bridge]);

    const writeSave = useCallback(async (id: string, metadata: unknown, screenshot?: boolean) => {
        if (!bridge) {
            throw new Error("Save Game: runtime bridge is not available");
        }
        const liveGame = requireActiveLiveGame("Save Game");
        let capture: string | undefined;
        if (screenshot === true && typeof liveGame.capturePng === "function") {
            capture = await liveGame.capturePng().catch(() => undefined);
        }
        await bridge.save.write(id, liveGame.serialize(), capture, metadata);
    }, [bridge, requireActiveLiveGame]);

    const loadSave = useCallback(async (id: string) => {
        if (!bridge) {
            throw new Error("Load Save: runtime bridge is not available");
        }
        const liveGame = requireActiveLiveGame("Load Save");
        const record = await bridge.save.read(id);
        if (!record) {
            throw new Error(`Load Save: save not found: ${id}`);
        }
        liveGame.game.router.clear().cleanHistory();
        liveGame.newGame().deserialize(record.savedGame as SavedGame);
        await liveGame.waitForRouterExit().promise;
        setGameStageVisible(true);
        hideCurrentStudioPagesForGame();
    }, [bridge, hideCurrentStudioPagesForGame, requireActiveLiveGame]);

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
        const metadata = record?.metadata.user;
        if (metadata === undefined) {
            return null;
        }
        try {
            const serialized = JSON.stringify(metadata);
            return serialized === undefined ? null : JSON.parse(serialized);
        } catch {
            return null;
        }
    }, [bridge]);

    const getSavePreview = useCallback(async (id: string): Promise<BlueprintImageAsset | null> => {
        const capture = await bridge?.save.readPreview(id);
        if (!capture) {
            return null;
        }
        return toBlueprintImageAsset(registerDevModeSavePreviewImage(id, capture));
    }, [bridge]);

    const startStoryInGame = useCallback(async (request: DevModeStartStoryRequest): Promise<void> => {
        if (!pack || !activeSurface || !core) {
            throw new Error("Start Game: runtime surface is not available");
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

        rejectPendingGameStarts(new Error("Start Game superseded by a newer session"));
        activeStoryRequestRef.current = { storyId, sceneId };
        activeStoryRevisionRef.current = pack.bundle.revision;

        const { width, height } = activeSurface.designSize;
        const sessionId = `${pack.bundle.bundleId}:${pack.bundle.revision}:${Date.now()}`;
        const dialogSurface = findStageSurfaceForSlot(pack.bundle.ui.uidoc, "dialog");
        const dialogComponent = dialogSurface
            ? createRuntimeDialogComponent({
                  sessionId,
                  core,
                  pack,
                  surface: dialogSurface,
                  rendererRegistry,
                  lifecycleRef,
                  makeStateAccessors,
                  openSurfaceWithTransition: openSurface,
                  closeLayerWithTransition: closeLayer,
                  quitApplication,
                  startStoryInGame,
                  writeSaveInGame: (id, metadata, screenshot) => writeSave(id, metadata, screenshot),
                  loadSaveInGame: id => loadSave(id),
                  deleteSaveInGame: id => deleteSave(id),
                  listSaveIds,
                  getSaveMetadata,
                  getSavePreview,
                  getCurrentNametag,
                  isInGame,
                  quitGame,
                  nextInGame,
                  skipInGame,
                  showDialogInGame,
                  hideDialogInGame,
                  toggleDialogDisplayInGame,
                  setSentenceSpeedInGame,
                  getGamePreferenceInGame,
                  setGamePreferenceInGame,
                  setDialogVirtualClickTarget: setNlrDialogVirtualClickTarget,
                  setWidgetPatchesByScope,
                  widgetPatchesByScopeRef,
                  widgetRuntimeStore,
              })
            : undefined;
        const game = new Game({
            app: { debug: false },
            width,
            height,
            aspectRatio: width / height,
            ratioUpdateInterval: 0,
            contentContainerId: `__nlr_preview_stage_${sessionId.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
            ...(dialogComponent ? { dialog: dialogComponent, dialogWidth: width, dialogHeight: height } : {}),
        });
        game.keyMap.setKeyBinding(KeyBindingType.nextAction, null);
        const ready = new Promise<void>((resolve, reject) => {
            pendingGameStartsRef.current.set(sessionId, { resolve, reject });
        });
        setGameStageVisible(false);
        clearGameHiddenStudioPages();
        gameReadyFiredRef.current = null;
        nlrLiveGameRef.current = null;
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
        hideCurrentStudioPagesForGame();
    }, [
        activeSurface,
        bridge,
        clearGameHiddenStudioPages,
        closeLayer,
        core,
        deleteSave,
        getCurrentNametag,
        getGamePreferenceInGame,
        getSaveMetadata,
        getSavePreview,
        hideCurrentStudioPagesForGame,
        hideDialogInGame,
        isInGame,
        lifecycleRef,
        listSaveIds,
        loadSave,
        makeStateAccessors,
        nextInGame,
        openSurface,
        pack,
        quitApplication,
        quitGame,
        rejectPendingGameStarts,
        rendererRegistry,
        setNlrDialogVirtualClickTarget,
        setSentenceSpeedInGame,
        setGamePreferenceInGame,
        showDialogInGame,
        skipInGame,
        toggleDialogDisplayInGame,
        widgetRuntimeStore,
        writeSave,
    ]);

    useEffect(() => {
        if (!runtimeReady || !pack || !core || pack.entry.kind !== "story" || !activeSurface) {
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
    }, [activeEntry, activeSurface, bridge, core, pack, prepaintReadyKeys, runtimeReady, startStoryInGame]);

    const createHostAdapterBundle = useCallback((entry: RuntimeNavEntry, surface: UISurface) => {
        if (!pack || !core) {
            return null;
        }
        const runtimeScopeId = entry.runtimeScopeId;
        let hostAdapter: UIHostAdapter | null = null;
        const hostApi = createDevModeBlueprintHostApi({
            document: pack.bundle.ui.uidoc,
            scope: core.scopeBridge,
            activeSurfaceId: surface.id,
            runtimeScopeId,
            pageProps: entry.props,
            emit: event => core.debug.emit(event),
            onOpenSurface: openSurface,
            onCloseLayer: closeLayer,
            onQuitApplication: quitApplication,
            onStartStory: startStoryInGame,
            onIsInGame: isInGame,
            onIsGameOverlay: () => entry.presentation === "gameOverlay",
            onQuitGame: quitGame,
            onWriteSave: writeSave,
            onLoadSave: loadSave,
            onDeleteSave: deleteSave,
            onListSaveIds: listSaveIds,
            onGetSaveMetadata: getSaveMetadata,
            onGetSavePreview: getSavePreview,
            onGetNametag: getCurrentNametag,
            onNext: nextInGame,
            onSkip: skipInGame,
            onShowDialog: showDialogInGame,
            onHideDialog: hideDialogInGame,
            onToggleDialogDisplay: toggleDialogDisplayInGame,
            onSetSentenceSpeed: setSentenceSpeedInGame,
            onGetGamePreference: getGamePreferenceInGame,
            onSetGamePreference: setGamePreferenceInGame,
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
            surface,
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
        closeLayer,
        core,
        deleteSave,
        getCurrentNametag,
        getGamePreferenceInGame,
        getSaveMetadata,
        getSavePreview,
        hideDialogInGame,
        isInGame,
        listSaveIds,
        loadSave,
        nextInGame,
        openSurface,
        pack,
        quitApplication,
        quitGame,
        setSentenceSpeedInGame,
        setGamePreferenceInGame,
        showDialogInGame,
        skipInGame,
        startStoryInGame,
        toggleDialogDisplayInGame,
        widgetRuntimeStore,
        writeSave,
    ]);

    const hostAdapterBundle = useMemo(() => {
        if (!activeEntry || !activeSurface) {
            return null;
        }
        return createHostAdapterBundle(activeEntry, activeSurface);
    }, [activeEntry, activeSurface, createHostAdapterBundle]);

    const activeSurfaceKeyboardReady = Boolean(
        activeEntry &&
        prepaintReadyKeys.has(activeEntry.key) &&
        (!studioPageHiddenForGame || !gameHiddenNavKeys.has(activeEntry.key)),
    );

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
                    onQuitApplication: quitApplication,
                    onStartStory: startStoryInGame,
                    onIsInGame: isInGame,
                    onIsGameOverlay: () =>
                        input.parentHostAdapter.blueprintRuntime?.hostApi?.game.isGameOverlay() === true,
                    onQuitGame: quitGame,
                    onWriteSave: writeSave,
                    onLoadSave: loadSave,
                    onDeleteSave: deleteSave,
                    onListSaveIds: listSaveIds,
                    onGetSaveMetadata: getSaveMetadata,
                    onGetSavePreview: getSavePreview,
                    onGetNametag: getCurrentNametag,
                    onNext: nextInGame,
                    onSkip: skipInGame,
                    onShowDialog: showDialogInGame,
                    onHideDialog: hideDialogInGame,
                    onToggleDialogDisplay: toggleDialogDisplayInGame,
                    onSetSentenceSpeed: setSentenceSpeedInGame,
                    onGetGamePreference: getGamePreferenceInGame,
                    onSetGamePreference: setGamePreferenceInGame,
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
        closeLayer,
        core,
        deleteSave,
        getCurrentNametag,
        getGamePreferenceInGame,
        getSaveMetadata,
        getSavePreview,
        hideDialogInGame,
        isInGame,
        listSaveIds,
        loadSave,
        nextInGame,
        openSurface,
        pack,
        quitApplication,
        quitGame,
        setSentenceSpeedInGame,
        setGamePreferenceInGame,
        showDialogInGame,
        skipInGame,
        startStoryInGame,
        toggleDialogDisplayInGame,
        widgetRuntimeStore,
        writeSave,
    ]);

    useEffect(() => {
        lifecycleRef.current.reset();
        appBootFiredRef.current = null;
        gameReadyFiredRef.current = null;
        storyEntryStartedRef.current = null;
    }, [pack?.bundle.bundleId, pack?.bundle.revision]);

    useEffect(() => {
        if (!pack || !activeStoryRequestRef.current) {
            return;
        }
        if (activeStoryRevisionRef.current === pack.bundle.revision) {
            return;
        }
        const request = activeStoryRequestRef.current;
        void startStoryInGame(request).catch(err => {
            bridge?.log("error", `[Runtime] Story hot reload restart failed: ${normalizeError(err)}`);
        });
    }, [bridge, pack, startStoryInGame]);

    useEffect(() => {
        const nextBundleId = pack?.bundle.bundleId ?? null;
        if (cleanupBundleIdRef.current === nextBundleId) {
            return;
        }
        const hadPreviousBundle = cleanupBundleIdRef.current !== null;
        cleanupBundleIdRef.current = nextBundleId;
        if (!hadPreviousBundle) {
            return;
        }
        activeStoryRequestRef.current = null;
        activeStoryRevisionRef.current = null;
        rejectPendingGameStarts(new Error("Preview runtime session changed"));
        nlrCharacterPromptTokenRef.current?.cancel();
        nlrCharacterPromptTokenRef.current = null;
        nlrDialogVirtualClickTargetRef.current = null;
        gameReadyFiredRef.current = null;
        nlrLiveGameRef.current = null;
        nlrLiveGameSessionIdRef.current = null;
        clearCurrentDialogNametag();
        clearDevModeSavePreviewImages();
        setNlrSession(null);
        setGameStageVisible(false);
        clearGameHiddenStudioPages();
    }, [
        clearCurrentDialogNametag,
        clearGameHiddenStudioPages,
        pack?.bundle.bundleId,
        rejectPendingGameStarts,
    ]);

    useEffect(() => {
        nlrCharacterPromptTokenRef.current?.cancel();
        nlrCharacterPromptTokenRef.current = null;
        nlrDialogVirtualClickTargetRef.current = null;
        gameReadyFiredRef.current = null;
        nlrLiveGameRef.current = null;
        nlrLiveGameSessionIdRef.current = null;
        clearCurrentDialogNametag();
    }, [clearCurrentDialogNametag, nlrSession?.id]);

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
        if (!runtimeReady || !pack || !core || !hostAdapterBundle || !activeSurface || !activeSurfaceKeyboardReady) {
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
    }, [activeSurface, activeSurfaceKeyboardReady, bridge, core, hostAdapterBundle, pack, runtimeReady]);

    if (error) {
        return <RuntimeErrorScreen message={error} />;
    }
    if (!pack || !activeSurface || !activeEntry) {
        return <RuntimeLoadingScreen />;
    }
    if (!runtimeReady || !core || !hostAdapterBundle) {
        return <RuntimeViewportFrame surface={activeSurface} scale={scale} />;
    }

    const visibleSurfaceEntries = pack.bundle.ui.uidoc.surfaces.length > 0
        ? visibleEntries
            .filter(entry => !studioPageHiddenForGame || !gameHiddenNavKeys.has(entry.key))
            .map(entry => {
                const visibleSurface = pack.bundle.ui.uidoc.surfaces.find(surface => surface.id === entry.surfaceId);
                return visibleSurface ? { entry, surface: visibleSurface } : null;
            })
            .filter((item): item is { entry: RuntimeNavEntry; surface: UISurface } => Boolean(item))
        : [];

    return (
        <RuntimeViewportFrame surface={activeSurface} scale={scale}>
            <NlrStageLayer
                session={nlrSession}
                interactive={gameStageVisible}
                onFirstSceneReady={sessionId => {
                    const pending = pendingGameStartsRef.current.get(sessionId);
                    if (!pending) {
                        return;
                    }
                    pendingGameStartsRef.current.delete(sessionId);
                    pending.resolve();
                }}
                onLiveGameReady={async (sessionId, liveGame) => {
                    if (nlrSession?.id !== sessionId) {
                        return;
                    }
                    nlrCharacterPromptTokenRef.current?.cancel();
                    nlrCharacterPromptTokenRef.current = liveGame.onCharacterPrompt(({ character }) => {
                        const nametag = readNlrCharacterName(character);
                        currentDialogNametagRef.current = nametag;
                        core.scopeBridge.globalSet(BLUEPRINT_GAME_NAMETAG_STATE_KEY, nametag);
                    });
                    nlrLiveGameRef.current = liveGame;
                    nlrLiveGameSessionIdRef.current = sessionId;
                    if (gameReadyFiredRef.current === sessionId) {
                        return;
                    }
                    gameReadyFiredRef.current = sessionId;
                    const surfaceStore = core.scopeBridge.getSurfaceStore(hostAdapterBundle.runtimeScopeId);
                    await dispatchGlobalBlueprintEvent({
                        blueprintDocument: pack.bundle.ui.localBlueprints,
                        eventName: "gameReady",
                        hostAdapter: hostAdapterBundle.hostAdapter,
                        debug: core.debug,
                        getSurfaceState: key => surfaceStore.get(key),
                        setSurfaceState: (key, value) => surfaceStore.set(key, value),
                        executionManager: core.executionManager,
                    });
                }}
                onError={err => {
                    rejectPendingGameStarts(err);
                    bridge?.log("error", normalizeError(err));
                }}
            />
            <div className="pointer-events-none absolute inset-0 z-10">
                <AnimatePresence
                    custom={transitionDirectionRef.current}
                    initial={false}
                    mode={surfacePresenceMode}
                    onExitComplete={handleSurfaceExitComplete}
                >
                    {visibleSurfaceEntries.map(({ entry, surface }, layerIndex) => {
                        return (
                            <RuntimeSurfaceLayerWithAdapter
                                key={entry.key}
                                pack={pack}
                                core={core}
                                entry={entry}
                                layerIndex={layerIndex}
                                surface={surface}
                                rendererRegistry={rendererRegistry}
                                scale={scale}
                                createHostAdapterBundle={createHostAdapterBundle}
                                widgetPatchesByScope={widgetPatchesByScope}
                                widgetPatchesByScopeRef={widgetPatchesByScopeRef}
                                widgetRuntimeStore={widgetRuntimeStore}
                                lifecycleRef={lifecycleRef}
                                nestedSurfaceRuntime={nestedSurfaceRuntime}
                                blueprintLifecycleReady={prepaintReadyKeys.has(entry.key)}
                                reducedMotion={prefersReducedMotion === true}
                                active={entry.key === activeEntry.key}
                                onInteractionReadyChange={handleSurfaceInteractionReadyChange}
                                onPrepaintReady={handleSurfaceLayerPrepaintReady}
                                onEnterComplete={markActiveEnterComplete}
                            />
                        );
                    })}
                </AnimatePresence>
            </div>
        </RuntimeViewportFrame>
    );
}
