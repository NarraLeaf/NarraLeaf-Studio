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
import {
    Dialog as NlrDialog,
    FixedAspectRatioContainer,
    Game,
    KeyBindingType,
    useDialog,
    type LiveGame,
    type SavedGame,
} from "narraleaf-react";
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
import { getOrCreateDomEventPropagationControl } from "@/lib/ui-editor/runtime/eventPropagationControl";
import { SurfaceLifecycleManager } from "@/lib/ui-editor/blueprint-runtime/SurfaceLifecycleManager";
import { getInterface } from "@/lib/app/bridge";
import {
    resolvePageAnimationMotion,
    type PageAnimationNavigationDirection,
} from "@/lib/ui-editor/runtime/pageAnimation";
import { NlrStageLayer, type NlrStageSession } from "@/lib/ui-editor/runtime/game/NlrStageLayer";
import { compileStudioStoryToNlr } from "@/lib/ui-editor/runtime/game/storyCompiler";
import {
    clearDevModeSavePreviewImages,
    registerDevModeSavePreviewImage,
} from "@/lib/ui-editor/runtime/devModeSavePreviewAssets";
import { BLUEPRINT_GAME_NAMETAG_STATE_KEY } from "@shared/types/blueprint/hostApi";
import { collectDialogFlushElementIds } from "@/lib/ui-editor/runtime/game/dialogFlushTargets";
import {
    createSurfaceNavigationCloseUpdate,
    createSurfaceNavigationOpenUpdate,
    type SurfaceNavigationEntry,
    type SurfaceNavigationPresentation,
} from "@/lib/ui-editor/runtime/game/surfaceNavigationController";
import { resolveDevModeViewportSize } from "./devModeViewport";

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

const staticDevHostAdapter = (surface: UISurface): UIHostAdapter => ({
    host: surface.host,
});

const noopHostAdapter: UIHostAdapter = {
    host: "app",
};

type DevModePageProps = Record<string, unknown>;
type DevModePagePresentation = SurfaceNavigationPresentation;
type DevModeOpenSurfaceOptions = {
    presentation?: DevModePagePresentation;
};

function cloneDevModePageProps(props: DevModePageProps | undefined): DevModePageProps {
    if (!props) {
        return {};
    }
    try {
        return JSON.parse(JSON.stringify(props)) as DevModePageProps;
    } catch {
        return {};
    }
}

type DevModeNavEntry = SurfaceNavigationEntry<DevModePageProps, DevModePagePresentation> & {
    sessionKey: string;
};

type DevModeBlueprintRuntimeCore = NonNullable<ReturnType<typeof useDevModeBlueprintRuntime>>;

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
        if (!bpCore || !hasBlueprintRuntime || !currentHostAdapter?.blueprintRuntime) {
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
            hostAdapter: currentHostAdapter,
            debug: bpCore.debug,
            getSurfaceState: acc.get,
            setSurfaceState: acc.set,
            executionManager: bpCore.executionManager,
        });
    }, [bpCore, bundle, hasBlueprintRuntime, lifecycleRef, makeStateAccessors, runtimeScopeId, surface.id]);

    useEffect(() => {
        if (!bpCore || !hasBlueprintRuntime) {
            return undefined;
        }
        const surfaceToUnmount = surface.id;
        const scopeToUnmount = runtimeScopeId;
        return () => {
            const currentHostAdapter = latestRuntimeHostAdapterRef.current;
            lifecycleRef.current.onSurfaceExit(scopeToUnmount);
            bpCore.executionManager.closeScope(scopeToUnmount, "Surface unmounted");
            const acc = makeStateAccessors(scopeToUnmount);
            if (!acc || !currentHostAdapter?.blueprintRuntime) {
                return;
            }
            void dispatchSurfaceBlueprintEvent({
                blueprintDocument: bundle.ui.localBlueprints,
                surfaceId: surfaceToUnmount,
                runtimeScopeId: scopeToUnmount,
                eventName: "surfaceUnmount",
                hostAdapter: currentHostAdapter,
                debug: bpCore.debug,
                getSurfaceState: acc.get,
                setSurfaceState: acc.set,
                executionManager: bpCore.executionManager,
                allowClosedScopeExecution: true,
            });
        };
    }, [bpCore, bundle, hasBlueprintRuntime, lifecycleRef, makeStateAccessors, runtimeScopeId, surface.id]);

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

function StudioDialogStateBridge(props: {
    bpCore: DevModeBlueprintRuntimeCore | null;
    getCurrentNametag: () => string | null;
    flushDialogElements: () => void;
}) {
    const { bpCore, getCurrentNametag, flushDialogElements } = props;
    const dialog = useDialog();

    useEffect(() => {
        if (!bpCore) {
            return;
        }
        const nametag = dialog.isNarrator ? null : getCurrentNametag();
        bpCore.scopeBridge.globalSet(BLUEPRINT_GAME_NAMETAG_STATE_KEY, nametag);
        flushDialogElements();
    }, [bpCore, dialog.done, dialog.isNarrator, dialog.text, flushDialogElements, getCurrentNametag]);

    return null;
}

function StudioDialogSlotSurface(props: {
    sessionId: string;
    bpCore: DevModeBlueprintRuntimeCore | null;
    bundle: DevModeBundle;
    surface: UIStageSurface;
    rendererRegistry: ElementRendererRegistry;
    lifecycleRef: MutableRefObject<SurfaceLifecycleManager>;
    makeStateAccessors: (surfaceId: string) => SurfaceStateAccessors | null;
    openSurfaceWithTransition: (
        surfaceId: string,
        props?: DevModePageProps,
        options?: DevModeOpenSurfaceOptions,
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
    setDialogVirtualClickTarget: (target: HTMLElement | null) => void;
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
        setDialogVirtualClickTarget,
        setWidgetPatchesByScope,
        widgetPatchesByScopeRef,
        widgetRuntimeStore,
    } = props;
    const runtimeScopeId = useMemo(() => dialogSlotRuntimeScopeId(sessionId, surface.id), [sessionId, surface.id]);
    const hostAdapterRef = useRef<UIHostAdapter | null>(null);
    const document = bundle.ui.uidoc;
    const setVirtualClickTarget = useCallback(
        (target: HTMLElement | null) => {
            setDialogVirtualClickTarget(target);
        },
        [setDialogVirtualClickTarget],
    );

    useEffect(() => () => setDialogVirtualClickTarget(null), [setDialogVirtualClickTarget]);

    const hostApi = useMemo(() => {
        if (!bpCore) {
            return null;
        }
        return createDevModeBlueprintHostApi({
            document,
            scope: bpCore.scopeBridge,
            activeSurfaceId: surface.id,
            runtimeScopeId,
            pageProps: {},
            emit: e => bpCore.debug.emit(e),
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
        bpCore,
        closeLayerWithTransition,
        document,
        openSurfaceWithTransition,
        quitApplication,
        runtimeScopeId,
        setWidgetPatchesByScope,
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

    const dialogFlushElementIds = useMemo(
        () => collectDialogFlushElementIds({
            document,
            blueprintDocument: bundle.ui.localBlueprints,
            surface,
        }),
        [bundle.ui.localBlueprints, document, surface],
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
        <NlrDialog ref={setVirtualClickTarget} style={{ width: "100%", height: "100%", position: "relative" }}>
            <StudioDialogStateBridge
                bpCore={bpCore}
                getCurrentNametag={getCurrentNametag}
                flushDialogElements={flushDialogElements}
            />
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
                        getWidgetRuntimePatches={() => widgetPatchesByScopeRef.current[runtimeScopeId] ?? {}}
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
    openSurfaceWithTransition: (
        surfaceId: string,
        props?: DevModePageProps,
        options?: DevModeOpenSurfaceOptions,
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
    setWidgetPatchesByScope: Dispatch<SetStateAction<Record<string, Record<string, DevModeWidgetRuntimePatch>>>>;
    widgetPatchesByScope: Record<string, Record<string, DevModeWidgetRuntimePatch>>;
    widgetPatchesByScopeRef: MutableRefObject<Record<string, Record<string, DevModeWidgetRuntimePatch>>>;
    widgetRuntimeStore: WidgetRuntimeStateStore;
    nestedSurfaceRuntime?: NestedSurfaceRuntime;
    reducedMotion: boolean;
    active: boolean;
    onInteractionReadyChange: (entryKey: string, ready: boolean) => void;
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
        setWidgetPatchesByScope,
        widgetPatchesByScope,
        widgetPatchesByScopeRef,
        widgetRuntimeStore,
        nestedSurfaceRuntime,
        reducedMotion,
        active,
        onInteractionReadyChange,
        onPrepaintReady,
        onEnterComplete,
    } = props;
    const runtimeScopeId = entry.key || surface.id;
    const hostAdapterRef = useRef<UIHostAdapter | null>(null);
    const [surfaceInteractive, setSurfaceInteractive] = useState(false);
    const [surfaceLifecycleSignals, setSurfaceLifecycleSignals] = useState({
        beforeSurfaceExit: 0,
        afterSurfaceEnter: 0,
    });
    const surfaceTransitionStateRef = useRef({ isEntering: true, isExiting: false });
    const effectiveInteractive = active && surfaceInteractive;

    const hostApi = useMemo(() => {
        if (!bpCore) {
            return null;
        }
        return createDevModeBlueprintHostApi({
            document: uidoc,
            scope: bpCore.scopeBridge,
            activeSurfaceId: surface.id,
            runtimeScopeId,
            pageProps: entry.props,
            emit: e => bpCore.debug.emit(e),
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
            onIsGameOverlay: () => entry.presentation === "gameOverlay",
            onQuitGame: quitGame,
            onNext: nextInGame,
            onSkip: skipInGame,
            onShowDialog: showDialogInGame,
            onHideDialog: hideDialogInGame,
            onToggleDialogDisplay: toggleDialogDisplayInGame,
            onSetSentenceSpeed: setSentenceSpeedInGame,
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
        bpCore,
        closeLayerWithTransition,
        entry.props,
        entry.presentation,
        openSurfaceWithTransition,
        quitApplication,
        runtimeScopeId,
        setWidgetPatchesByScope,
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
        surface.id,
        uidoc,
        widgetRuntimeStore,
    ]);

    const hostAdapter = useMemo((): UIHostAdapter => {
        const adapter =
            !bpCore || !hostApi
                ? staticDevHostAdapter(surface)
                : createDevModeBlueprintHostAdapter({
                      bundle,
                      surface,
                      runtimeScopeId,
                      scopeBridge: bpCore.scopeBridge,
                      debug: bpCore.debug,
                      hostApi,
                      executionManager: bpCore.executionManager,
                  });
        if (adapter.blueprintRuntime) {
            adapter.blueprintRuntime.getSurfaceTransitionState = () => surfaceTransitionStateRef.current;
        }
        return adapter;
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

    const dispatchSurfaceTransitionEvent = useCallback(
        (eventName: "beforeSurfaceExit" | "afterSurfaceEnter") => {
            surfaceTransitionStateRef.current =
                eventName === "beforeSurfaceExit"
                    ? { isEntering: false, isExiting: true }
                    : { isEntering: false, isExiting: false };
            void hostAdapter.blueprintRuntime?.dispatchSurfaceBlueprintEvent?.(eventName);
            setSurfaceLifecycleSignals(prev => ({
                ...prev,
                [eventName]: prev[eventName] + 1,
            }));
        },
        [hostAdapter],
    );

    const handleBeforeExit = useCallback(
        (entryKey: string) => {
            if (entryKey !== entry.key) {
                return;
            }
            setSurfaceInteractive(false);
            widgetRuntimeStore.clearInteractionStateForScope(runtimeScopeId);
            onInteractionReadyChange(entry.key, false);
            dispatchSurfaceTransitionEvent("beforeSurfaceExit");
        },
        [dispatchSurfaceTransitionEvent, entry.key, onInteractionReadyChange, runtimeScopeId, widgetRuntimeStore],
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
        widgetRuntimeStore.clearInteractionStateForScope(runtimeScopeId);
        onInteractionReadyChange(entry.key, false);
    }, [active, entry.key, onInteractionReadyChange, runtimeScopeId, widgetRuntimeStore]);

    useEffect(() => () => {
        widgetRuntimeStore.clearInteractionStateForScope(runtimeScopeId);
        onInteractionReadyChange(entry.key, false);
    }, [entry.key, onInteractionReadyChange, runtimeScopeId, widgetRuntimeStore]);

    return (
        <SurfaceAnimationLayer
            prepaintKey={entry.key}
            direction={entry.direction}
            pageMotion={pageMotion}
            className="absolute inset-0 flex items-center justify-center"
            presentZIndex={10 + layerIndex}
            exitZIndex={entry.exitBehind ? 0 : 30 + layerIndex}
            interactive={effectiveInteractive}
            resolveExit={resolveExit}
            onPrepaintReady={onPrepaintReady}
            onBeforeExit={handleBeforeExit}
            onEnterComplete={handleEnterComplete}
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
                        getWidgetRuntimePatches={() =>
                            widgetPatchesByScopeRef.current[runtimeScopeId] ?? widgetPatchesByScope[runtimeScopeId] ?? {}
                        }
                        nestedSurfaceRuntime={nestedSurfaceRuntime}
                        surfaceLifecycleSignals={surfaceLifecycleSignals}
                        interactive={effectiveInteractive}
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
    const bpCore = useDevModeBlueprintRuntime(bundle, projectPath);
    const prefersReducedMotion = useReducedMotion();
    const [navStack, setNavStack] = useState<DevModeNavEntry[]>([]);
    const [visibleEntries, setVisibleEntries] = useState<DevModeNavEntry[]>([]);
    const [surfacePresenceMode, setSurfacePresenceMode] = useState<"sync" | "wait">("sync");
    const [interactionReadyKeys, setInteractionReadyKeys] = useState<Set<string>>(() => new Set());
    const navStackRef = useRef<DevModeNavEntry[]>([]);
    const visibleEntriesRef = useRef<DevModeNavEntry[]>([]);
    const navEntrySeqRef = useRef(0);
    const activeNavKeyRef = useRef<string | null>(null);
    const activeEntryRef = useRef<DevModeNavEntry | null>(null);
    const activeSurfaceRef = useRef<UISurface | null>(null);
    const pendingWaitEntryRef = useRef<DevModeNavEntry | null>(null);
    const pendingUnderlayReadyKeyRef = useRef<string | null>(null);
    const pendingRemoveAfterEnterKeyRef = useRef<string | null>(null);
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
    const [gameHiddenNavKeys, setGameHiddenNavKeys] = useState<Set<string>>(() => new Set());
    const studioPageHiddenForGameRef = useRef(false);
    const gameHiddenNavKeysRef = useRef(gameHiddenNavKeys);
    const nlrSessionSeqRef = useRef(0);
    const activeStoryRequestRef = useRef<DevModeStartStoryRequest | null>(null);
    const activeStoryRevisionRef = useRef<number | null>(null);
    const startStoryInGameRef = useRef<((request: DevModeStartStoryRequest) => Promise<void>) | null>(null);
    const writeSaveInGameRef = useRef<((id: string, metadata?: unknown, screenshot?: boolean) => Promise<void>) | null>(null);
    const loadSaveInGameRef = useRef<((id: string) => Promise<void>) | null>(null);
    const deleteSaveInGameRef = useRef<((id: string) => Promise<void>) | null>(null);
    const listSaveIdsRef = useRef<(() => Promise<string[]>) | null>(null);
    const getSaveMetadataRef = useRef<((id: string) => Promise<unknown>) | null>(null);
    const getSavePreviewRef = useRef<((id: string) => Promise<BlueprintImageAsset | null>) | null>(null);
    const getCurrentNametagRef = useRef<(() => string | null) | null>(null);
    const isInGameRef = useRef<(() => boolean) | null>(null);
    const quitGameRef = useRef<((surfaceId: string) => Promise<void>) | null>(null);
    const quitApplicationRef = useRef<(() => Promise<void>) | null>(null);
    const nextInGameRef = useRef<(() => Promise<void>) | null>(null);
    const skipInGameRef = useRef<(() => Promise<void>) | null>(null);
    const showDialogInGameRef = useRef<(() => Promise<void>) | null>(null);
    const hideDialogInGameRef = useRef<(() => Promise<void>) | null>(null);
    const toggleDialogDisplayInGameRef = useRef<(() => Promise<void>) | null>(null);
    const setSentenceSpeedInGameRef = useRef<((cps: number) => Promise<void>) | null>(null);
    const nlrLiveGameRef = useRef<LiveGame | null>(null);
    const nlrLiveGameSessionIdRef = useRef<string | null>(null);
    const nlrDialogVirtualClickTargetRef = useRef<HTMLElement | null>(null);
    const nlrCharacterPromptTokenRef = useRef<{ cancel(): void } | null>(null);
    const currentDialogNametagRef = useRef<string | null>(null);
    const pendingGameStartsRef = useRef(new Map<string, { resolve: () => void; reject: (error: Error) => void }>());
    const openSurfaceWithTransitionRef = useRef<((surfaceId: string, props?: DevModePageProps) => Promise<void>) | null>(null);
    const closeLayerWithTransitionRef = useRef<(() => Promise<void>) | null>(null);
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
    const runtimeSessionKey = useMemo(
        () => `${bundle?.bundleId ?? "pending"}:${bundle?.revision ?? "pending"}:${surface?.id ?? ""}`,
        [bundle?.bundleId, bundle?.revision, surface?.id],
    );

    useEffect(() => {
        if (surface?.id) {
            navEntrySeqRef.current += 1;
            const initialEntry: DevModeNavEntry = {
                key: `${surface.id}:${navEntrySeqRef.current}`,
                sessionKey: runtimeSessionKey,
                surfaceId: surface.id,
                direction: "forward",
                waitForExit: false,
                props: {},
                presentation: "appPage",
            };
            pendingWaitEntryRef.current = null;
            pendingUnderlayReadyKeyRef.current = null;
            pendingRemoveAfterEnterKeyRef.current = null;
            transitionDirectionRef.current = "forward";
            setSurfacePresenceMode("sync");
            setInteractionReadyKeys(new Set());
            setNavStack([initialEntry]);
            setVisibleEntries([initialEntry]);
            widgetPatchesByScopeRef.current = {};
            setWidgetPatchesByScope({});
            gameHiddenNavKeysRef.current = new Set();
            setGameHiddenNavKeys(new Set());
            studioPageHiddenForGameRef.current = false;
            setStudioPageHiddenForGame(false);
        }
    }, [runtimeSessionKey, surface?.id]);

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

    const latestEntry = navStack.length > 0 ? navStack[navStack.length - 1]! : null;
    const activeEntry = latestEntry?.sessionKey === runtimeSessionKey ? latestEntry : null;
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
                }, Math.max(0, durationMs) + SURFACE_PREPAINT_TIMEOUT_MS + 180);
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

    const createNavEntry = useCallback(
        (
            surfaceId: string,
            direction: PageAnimationNavigationDirection,
            waitForExit: boolean,
            props?: DevModePageProps,
            presentation: DevModePagePresentation = "appPage",
        ): DevModeNavEntry => {
            navEntrySeqRef.current += 1;
            return {
                key: `${surfaceId}:${navEntrySeqRef.current}`,
                sessionKey: runtimeSessionKey,
                surfaceId,
                direction,
                waitForExit,
                props: cloneDevModePageProps(props),
                presentation,
            };
        },
        [runtimeSessionKey],
    );

    const isGameHiddenEntry = useCallback((entry: DevModeNavEntry | null | undefined): boolean => {
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

    const openSurfaceWithTransition = useCallback(
        (
            nextSurfaceId: string,
            props?: DevModePageProps,
            options?: DevModeOpenSurfaceOptions,
        ): Promise<void> => {
            const from = activeSurfaceRef.current;
            const target = uiDocument?.surfaces.find(s => s.id === nextSurfaceId) ?? null;
            const currentEntry = activeEntryRef.current;
            const currentHiddenForGame = isGameHiddenEntry(currentEntry);
            const presentation =
                options?.presentation ?? (studioPageHiddenForGameRef.current ? "gameOverlay" : "appPage");
            const update = createSurfaceNavigationOpenUpdate({
                navStack: navStackRef.current,
                visibleEntries: visibleEntriesRef.current,
                activeEntry: currentEntry,
                fromSurface: from,
                targetSurface: target,
                currentHiddenForGame,
                prefersReducedMotion,
                createNextEntry: waitForExit =>
                    createNavEntry(nextSurfaceId, "forward", waitForExit, props, presentation),
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
        },
        [
            beginTransitionWait,
            createNavEntry,
            isGameHiddenEntry,
            prefersReducedMotion,
            resetSurfaceInteractionReadiness,
            uiDocument?.surfaces,
        ],
    );

    const closeLayerWithTransition = useCallback((): Promise<void> => {
        const currentStack = navStackRef.current;
        if (currentStack.length <= 1) {
            return Promise.resolve();
        }
        const nextEntryBase = currentStack[currentStack.length - 2]!;
        const target = uiDocument?.surfaces.find(s => s.id === nextEntryBase.surfaceId) ?? null;
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
        prefersReducedMotion,
        resetSurfaceInteractionReadiness,
        uiDocument?.surfaces,
    ]);

    openSurfaceWithTransitionRef.current = openSurfaceWithTransition;
    closeLayerWithTransitionRef.current = closeLayerWithTransition;

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

    const getCurrentNametag = useCallback((): string | null => {
        const liveGameSpeaker = readNlrLastDialogSpeaker(nlrLiveGameRef.current);
        return liveGameSpeaker ?? currentDialogNametagRef.current;
    }, []);
    getCurrentNametagRef.current = getCurrentNametag;

    const clearCurrentDialogNametag = useCallback(() => {
        currentDialogNametagRef.current = null;
        bpCore?.scopeBridge.globalSet(BLUEPRINT_GAME_NAMETAG_STATE_KEY, null);
    }, [bpCore]);

    const isInGame = useCallback((): boolean => {
        return Boolean(gameStageVisible && nlrSession?.id);
    }, [gameStageVisible, nlrSession?.id]);
    isInGameRef.current = isInGame;

    const setNlrDialogVirtualClickTarget = useCallback((target: HTMLElement | null): void => {
        nlrDialogVirtualClickTargetRef.current = target;
    }, []);

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
    nextInGameRef.current = nextInGame;

    const skipInGame = useCallback(async (): Promise<void> => {
        requireActiveLiveGame("Skip").skipDialog();
    }, [requireActiveLiveGame]);
    skipInGameRef.current = skipInGame;

    const showDialogInGame = useCallback(async (): Promise<void> => {
        requireActiveLiveGame("Show Dialog").game.preference.setPreference("showDialog", true);
    }, [requireActiveLiveGame]);
    showDialogInGameRef.current = showDialogInGame;

    const hideDialogInGame = useCallback(async (): Promise<void> => {
        requireActiveLiveGame("Hide Dialog").game.preference.setPreference("showDialog", false);
    }, [requireActiveLiveGame]);
    hideDialogInGameRef.current = hideDialogInGame;

    const toggleDialogDisplayInGame = useCallback(async (): Promise<void> => {
        const preference = requireActiveLiveGame("Toggle Dialog Display").game.preference;
        preference.setPreference("showDialog", preference.getPreference("showDialog") !== true);
    }, [requireActiveLiveGame]);
    toggleDialogDisplayInGameRef.current = toggleDialogDisplayInGame;

    const setSentenceSpeedInGame = useCallback(async (cps: number): Promise<void> => {
        const value = typeof cps === "number" ? cps : Number(cps);
        if (!Number.isFinite(value) || value <= 0) {
            throw new Error("Set Sentence Speed: CPS must be a positive number");
        }
        requireActiveLiveGame("Set Sentence Speed").game.preference.setPreference("cps", value);
    }, [requireActiveLiveGame]);
    setSentenceSpeedInGameRef.current = setSentenceSpeedInGame;

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
        nlrLiveGameRef.current = null;
        nlrLiveGameSessionIdRef.current = null;
        clearCurrentDialogNametag();
        // Keep the Player mounted as a visual underlay until the return Page is ready in front.
        setGameStageVisible(false);
        await openSurfaceWithTransition(targetSurfaceId, undefined, { presentation: "appPage" });
        setNlrSession(null);
        clearGameHiddenStudioPages();
    }, [clearCurrentDialogNametag, clearGameHiddenStudioPages, openSurfaceWithTransition, rejectPendingGameStarts]);
    quitGameRef.current = quitGame;

    const quitApplication = useCallback(async (): Promise<void> => {
        const result = await getInterface().devMode.stop();
        if (!result.success) {
            throw new Error(result.error ?? "Quit failed");
        }
    }, []);
    quitApplicationRef.current = quitApplication;

    const writeSaveInGame = useCallback(async (id: string, metadata?: unknown, screenshot?: boolean): Promise<void> => {
        const projectRef = requireSaveProjectRef("Save Game");
        const liveGame = requireActiveLiveGame("Save Game");
        const savedGame = liveGame.serialize();
        let capture: string | undefined;
        if (screenshot === true) {
            capture = await liveGame.capturePng();
        }
        const result = await getInterface().devMode.save.write(projectRef, id, savedGame, capture, metadata);
        if (!result.success) {
            throw new Error(result.error ?? `Save Game failed: ${id}`);
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
        hideCurrentStudioPagesForGame();
    }, [hideCurrentStudioPagesForGame, requireActiveLiveGame, requireSaveProjectRef]);
    loadSaveInGameRef.current = loadSaveInGame;

    const deleteSaveInGame = useCallback(async (id: string): Promise<void> => {
        const projectRef = requireSaveProjectRef("Delete Save");
        const result = await getInterface().devMode.save.delete(projectRef, id);
        if (!result.success) {
            throw new Error(result.error ?? `Delete Save failed: ${id}`);
        }
    }, [requireSaveProjectRef]);
    deleteSaveInGameRef.current = deleteSaveInGame;

    const listSaveIds = useCallback(async (): Promise<string[]> => {
        const projectRef = requireSaveProjectRef("List Saves");
        const result = await getInterface().devMode.save.listIds(projectRef);
        if (!result.success) {
            throw new Error(result.error ?? "List Saves failed");
        }
        return result.data.ids;
    }, [requireSaveProjectRef]);
    listSaveIdsRef.current = listSaveIds;

    const getSaveMetadata = useCallback(async (id: string): Promise<unknown> => {
        const projectRef = requireSaveProjectRef("Get Save Metadata");
        const result = await getInterface().devMode.save.read(projectRef, id);
        if (!result.success) {
            throw new Error(result.error ?? `Get Save Metadata failed: ${id}`);
        }
        const metadata = result.data.record?.metadata.user;
        if (metadata === undefined) {
            return null;
        }
        try {
            const serialized = JSON.stringify(metadata);
            return serialized === undefined ? null : JSON.parse(serialized);
        } catch {
            return null;
        }
    }, [requireSaveProjectRef]);
    getSaveMetadataRef.current = getSaveMetadata;

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
                  openSurfaceWithTransition: (surfaceId, props) =>
                      openSurfaceWithTransitionRef.current?.(surfaceId, props) ??
                      Promise.reject(new Error("Open Page is not available")),
                  closeLayerWithTransition: () =>
                      closeLayerWithTransitionRef.current?.() ??
                      Promise.reject(new Error("Go Back is not available")),
                  quitApplication: () =>
                      quitApplicationRef.current?.() ??
                      Promise.reject(new Error("Quit is not available")),
                  startStoryInGame: request =>
                      startStoryInGameRef.current?.(request) ??
                      Promise.reject(new Error("Start Game is not available")),
                  writeSaveInGame: (id, metadata, screenshot) =>
                      writeSaveInGameRef.current?.(id, metadata, screenshot) ??
                      Promise.reject(new Error("Save Game is not available")),
                  loadSaveInGame: id =>
                      loadSaveInGameRef.current?.(id) ??
                      Promise.reject(new Error("Load Save is not available")),
                  deleteSaveInGame: id =>
                      deleteSaveInGameRef.current?.(id) ??
                      Promise.reject(new Error("Delete Save is not available")),
                  listSaveIds: () =>
                      listSaveIdsRef.current?.() ??
                      Promise.reject(new Error("List Saves is not available")),
                  getSaveMetadata: id =>
                      getSaveMetadataRef.current?.(id) ??
                      Promise.reject(new Error("Get Save Metadata is not available")),
                  getSavePreview: id =>
                      getSavePreviewRef.current?.(id) ??
                      Promise.reject(new Error("Get Save Preview is not available")),
                  getCurrentNametag: () => getCurrentNametagRef.current?.() ?? null,
                  isInGame: () => isInGameRef.current?.() ?? false,
                  quitGame: surfaceId =>
                      quitGameRef.current?.(surfaceId) ??
                      Promise.reject(new Error("Quit Game is not available")),
                  nextInGame: () =>
                      nextInGameRef.current?.() ??
                      Promise.reject(new Error("Next is not available")),
                  skipInGame: () =>
                      skipInGameRef.current?.() ??
                      Promise.reject(new Error("Skip is not available")),
                  showDialogInGame: () =>
                      showDialogInGameRef.current?.() ??
                      Promise.reject(new Error("Show Dialog is not available")),
                  hideDialogInGame: () =>
                      hideDialogInGameRef.current?.() ??
                      Promise.reject(new Error("Hide Dialog is not available")),
                  toggleDialogDisplayInGame: () =>
                      toggleDialogDisplayInGameRef.current?.() ??
                      Promise.reject(new Error("Toggle Dialog Display is not available")),
                  setSentenceSpeedInGame: cps =>
                      setSentenceSpeedInGameRef.current?.(cps) ??
                      Promise.reject(new Error("Set Sentence Speed is not available")),
                  setDialogVirtualClickTarget: setNlrDialogVirtualClickTarget,
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
        game.keyMap.setKeyBinding(KeyBindingType.nextAction, null);

        const ready = new Promise<void>((resolve, reject) => {
            pendingGameStartsRef.current.set(sessionId, { resolve, reject });
        });

        setGameStageVisible(false);
        clearGameHiddenStudioPages();
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
        bpCore,
        bundle,
        clearGameHiddenStudioPages,
        hideCurrentStudioPagesForGame,
        lifecycleRef,
        makeStateAccessors,
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
        nlrCharacterPromptTokenRef.current?.cancel();
        nlrCharacterPromptTokenRef.current = liveGame.onCharacterPrompt(({ character }) => {
            const nametag = readNlrCharacterName(character);
            currentDialogNametagRef.current = nametag;
            bpCore?.scopeBridge.globalSet(BLUEPRINT_GAME_NAMETAG_STATE_KEY, nametag);
        });
        nlrLiveGameRef.current = liveGame;
        nlrLiveGameSessionIdRef.current = sessionId;
    }, [bpCore, nlrSession?.id]);

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
        nlrCharacterPromptTokenRef.current?.cancel();
        nlrCharacterPromptTokenRef.current = null;
        nlrDialogVirtualClickTargetRef.current = null;
        nlrLiveGameRef.current = null;
        nlrLiveGameSessionIdRef.current = null;
        clearCurrentDialogNametag();
        clearDevModeSavePreviewImages();
        setNlrSession(null);
        setGameStageVisible(false);
        clearGameHiddenStudioPages();
    }, [bundle?.bundleId, clearCurrentDialogNametag, clearGameHiddenStudioPages, rejectPendingGameStarts, surface?.id]);

    useEffect(() => {
        nlrCharacterPromptTokenRef.current?.cancel();
        nlrCharacterPromptTokenRef.current = null;
        nlrDialogVirtualClickTargetRef.current = null;
        nlrLiveGameRef.current = null;
        nlrLiveGameSessionIdRef.current = null;
        clearCurrentDialogNametag();
    }, [clearCurrentDialogNametag, nlrSession?.id]);

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
            pageProps: activeEntry?.props,
            emit: e => bpCore.debug.emit(e),
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
            onIsGameOverlay: () => activeEntry?.presentation === "gameOverlay",
            onQuitGame: quitGame,
            onNext: nextInGame,
            onSkip: skipInGame,
            onShowDialog: showDialogInGame,
            onHideDialog: hideDialogInGame,
            onToggleDialogDisplay: toggleDialogDisplayInGame,
            onSetSentenceSpeed: setSentenceSpeedInGame,
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
        activeRuntimeScopeId,
        activeEntry?.props,
        activeEntry?.presentation,
        bpCore,
        uiDocument,
        activeSurface,
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

    const activeSurfaceInteractionReady = Boolean(
        activeEntry &&
        interactionReadyKeys.has(activeEntry.key) &&
        (!studioPageHiddenForGame || !gameHiddenNavKeys.has(activeEntry.key)),
    );

    useEffect(() => {
        if (!bpCore || !bundle || !activeSurface || !hostAdapter.blueprintRuntime || !activeSurfaceInteractionReady) {
            return undefined;
        }

        const dispatchKeyboardEvent = (eventName: "keyDown" | "keyUp", event: KeyboardEvent) => {
            const runtimeScopeId = activeRuntimeScopeId || activeSurface.id;
            const acc = makeStateAccessors(runtimeScopeId);
            if (!acc) {
                return;
            }
            const eventPayload = keyboardBlueprintPayload(event);
            const eventControl = getOrCreateDomEventPropagationControl(event);
            if (eventControl.isPropagationStopped()) {
                return;
            }
            void (async () => {
                await dispatchGlobalBlueprintEvent({
                    blueprintDocument: bundle.ui.localBlueprints,
                    eventName,
                    eventPayload,
                    eventControl,
                    hostAdapter,
                    debug: bpCore.debug,
                    getSurfaceState: acc.get,
                    setSurfaceState: acc.set,
                    executionManager: bpCore.executionManager,
                });
                if (eventControl.isPropagationStopped()) {
                    return;
                }
                await dispatchSurfaceBlueprintEvent({
                    blueprintDocument: bundle.ui.localBlueprints,
                    surfaceId: activeSurface.id,
                    runtimeScopeId,
                    eventName,
                    eventPayload,
                    eventControl,
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
    }, [
        activeRuntimeScopeId,
        activeSurface,
        activeSurfaceInteractionReady,
        bpCore,
        bundle,
        hostAdapter,
        makeStateAccessors,
    ]);

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
                    pageProps: input.params,
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
                    onIsGameOverlay: () =>
                        input.parentHostAdapter.blueprintRuntime?.hostApi?.game.isGameOverlay() === true,
                    onQuitGame: quitGame,
                    onNext: nextInGame,
                    onSkip: skipInGame,
                    onShowDialog: showDialogInGame,
                    onHideDialog: hideDialogInGame,
                    onToggleDialogDisplay: toggleDialogDisplayInGame,
                    onSetSentenceSpeed: setSentenceSpeedInGame,
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

    const viewportSize = resolveDevModeViewportSize({
        activeSurfaceDesignSize: activeSurface.designSize,
        gameViewport: nlrSession ? { width: nlrSession.width, height: nlrSession.height } : null,
    });
    const aspectRatio = viewportSize.width / viewportSize.height;
    const baseWidth = viewportSize.width;

    const uidoc = uiDocument!;
    const reducedMotion = prefersReducedMotion === true;
    const visibleSurfaceEntries = visibleEntries
        .filter(entry => entry.sessionKey === runtimeSessionKey)
        .filter(entry => !studioPageHiddenForGame || !gameHiddenNavKeys.has(entry.key))
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
                                mode={surfacePresenceMode}
                                onExitComplete={handleSurfaceExitComplete}
                            >
                                {visibleSurfaceEntries.map(({ entry, surface: visibleSurface }, layerIndex) => (
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
                                        quitApplication={quitApplication}
                                        startStoryInGame={startStoryInGame}
                                        writeSaveInGame={writeSaveInGame}
                                        loadSaveInGame={loadSaveInGame}
                                        deleteSaveInGame={deleteSaveInGame}
                                        listSaveIds={listSaveIds}
                                        getSaveMetadata={getSaveMetadata}
                                        getSavePreview={getSavePreview}
                                        getCurrentNametag={getCurrentNametag}
                                        isInGame={isInGame}
                                        quitGame={quitGame}
                                        nextInGame={nextInGame}
                                        skipInGame={skipInGame}
                                        showDialogInGame={showDialogInGame}
                                        hideDialogInGame={hideDialogInGame}
                                        toggleDialogDisplayInGame={toggleDialogDisplayInGame}
                                        setSentenceSpeedInGame={setSentenceSpeedInGame}
                                        setWidgetPatchesByScope={setWidgetPatchesByScope}
                                        widgetPatchesByScope={widgetPatchesByScope}
                                        widgetPatchesByScopeRef={widgetPatchesByScopeRef}
                                        widgetRuntimeStore={widgetRuntimeStore}
                                        nestedSurfaceRuntime={nestedSurfaceRuntime}
                                        reducedMotion={reducedMotion}
                                        active={entry.key === activeEntry?.key}
                                        onInteractionReadyChange={handleSurfaceInteractionReadyChange}
                                        onPrepaintReady={handleSurfaceLayerPrepaintReady}
                                        onEnterComplete={markActiveEnterComplete}
                                    />
                                ))}
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
