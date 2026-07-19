import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type Dispatch,
    type MutableRefObject,
    type SetStateAction,
} from "react";
import type { DevModeBundle, DevModeStartStoryRequest } from "@shared/types/devMode";
import type { UIStageSlotId, UIStageSurface } from "@shared/types/ui-editor/document";
import type { BlueprintImageAsset } from "@shared/types/blueprint/valueTypes";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import type { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { GameSurfaceRenderer } from "@/lib/ui-editor/runtime/surface/GameSurfaceRenderer";
import { WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import {
    createDevModeBlueprintHostApi,
    type BlueprintGameHistoryEntry,
    type BlueprintGameNotification,
    type BlueprintGamePreferenceKey,
    type BlueprintGamePreferenceValue,
    type DevModeWidgetRuntimePatch,
} from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { createDevModeBlueprintHostAdapter } from "@/lib/ui-editor/runtime/hostAdapters/devModeBlueprintHostAdapter";
import type { BlueprintRuntimeCore } from "@/lib/ui-editor/runtime/game/useBlueprintRuntimeCore";
import type { SurfaceLifecycleOrchestrator } from "./lifecycle/surfaceLifecycleOrchestrator";
import { collectSurfaceFlushElementIds } from "@/lib/ui-editor/runtime/game/surfaceFlushTargets";
import { SurfaceLifecycleBoundary } from "./SurfaceLifecycleBoundary";
import { applyWidgetRuntimePatch } from "./widgetRuntimePatches";
import { stageSlotRuntimeScopeId } from "./stageSlots";
import { staticSurfaceHostAdapter, type OpenSurfaceOptions, type PageProps, type SurfaceStateAccessors } from "./types";

/**
 * Host callbacks shared by every Game UI slot surface. Built once per NLR session in
 * `GameApp.mountNlrSession()` and passed to each slot component factory.
 */
export type GameUiSlotHostOptions = {
    sessionId: string;
    core: BlueprintRuntimeCore | null;
    bundle: DevModeBundle;
    rendererRegistry: ElementRendererRegistry;
    lifecycleRef: MutableRefObject<SurfaceLifecycleOrchestrator>;
    makeStateAccessors: (runtimeScopeId: string) => SurfaceStateAccessors | null;
    openSurfaceWithTransition: (
        surfaceId: string,
        props?: PageProps,
        options?: OpenSurfaceOptions,
    ) => Promise<void>;
    closeLayerWithTransition: () => Promise<void>;
    quitApplication: () => Promise<void>;
    /** Hosts without a real application window (story preview) leave these unset. */
    getFullscreen?: () => Promise<boolean>;
    setFullscreen?: (fullscreen: boolean) => Promise<void>;
    startStoryInGame: (request: DevModeStartStoryRequest) => Promise<void>;
    writeSaveInGame: (id: string, metadata?: unknown, screenshot?: boolean) => Promise<void>;
    loadSaveInGame: (id: string) => Promise<void>;
    deleteSaveInGame: (id: string) => Promise<void>;
    listSaveIds: () => Promise<string[]>;
    getSaveMetadata: (id: string) => Promise<unknown>;
    getSavePreview: (id: string) => Promise<BlueprintImageAsset | null>;
    getHistoryInGame: () => BlueprintGameHistoryEntry[];
    restoreHistoryInGame: (id?: string) => Promise<void>;
    getCurrentNametag: () => string | null;
    getNotificationsInGame: () => BlueprintGameNotification[];
    getChoiceCountInGame: () => number;
    isNvlModeInGame: () => boolean;
    /** Optional: hosts without a text-read tracker (story preview) fall back to the mirrored state key. */
    isCurrentTextReadInGame?: () => boolean;
    /** Optional: hosts without a text-read tracker fall back to wiping the persistence key directly. */
    clearTextReadInGame?: () => Promise<void>;
    selectChoiceInGame: (index: number) => Promise<void>;
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
    setWidgetPatchesByScope: Dispatch<SetStateAction<Record<string, Record<string, DevModeWidgetRuntimePatch>>>>;
    widgetPatchesByScopeRef: MutableRefObject<Record<string, Record<string, DevModeWidgetRuntimePatch>>>;
    widgetRuntimeStore: WidgetRuntimeStateStore;
};

export type StageSlotSurfaceRuntime = {
    runtimeScopeId: string;
    hostAdapter: UIHostAdapter;
    hostAdapterRef: MutableRefObject<UIHostAdapter | null>;
    /** Dispatches `flush` to every element of this surface with value bindings or flush logic. */
    flushSlotElements: () => void;
};

/** Widget-runtime store key for a slot surface element (matches `scopedWidgetRuntimeKey`). */
export function stageSlotWidgetRuntimeKey(runtimeScopeId: string, elementId: string): string {
    return `${runtimeScopeId}\0${elementId}`;
}

/** Collects element ids of the given widget type inside the surface tree (document order). */
export function collectSurfaceElementIdsByType(
    document: DevModeBundle["ui"]["uidoc"],
    surface: UIStageSurface,
    elementType: string,
): string[] {
    const out: string[] = [];
    const visit = (elementId: string) => {
        const element = document.elements[elementId];
        if (!element) {
            return;
        }
        if (element.type === elementType) {
            out.push(elementId);
        }
        for (const childId of element.childrenIds ?? []) {
            visit(childId);
        }
    };
    visit(surface.rootElementId);
    return out;
}

/**
 * Slot-agnostic runtime wiring shared by all Game UI slot surfaces: per-slot blueprint host
 * API/adapter (scoped to `nlr:<sessionId>:slot:<slotId>:<surfaceId>`) and flush dispatch to the
 * surface's value-bound / flush-capable elements.
 */
export function useStageSlotSurfaceRuntime(input: {
    options: GameUiSlotHostOptions;
    surface: UIStageSurface;
    slotId: UIStageSlotId;
}): StageSlotSurfaceRuntime {
    const { options, surface, slotId } = input;
    const {
        sessionId,
        core,
        bundle,
        widgetRuntimeStore,
        setWidgetPatchesByScope,
        widgetPatchesByScopeRef,
    } = options;
    const runtimeScopeId = useMemo(
        () => stageSlotRuntimeScopeId(sessionId, slotId, surface.id),
        [sessionId, slotId, surface.id],
    );
    const hostAdapterRef = useRef<UIHostAdapter | null>(null);
    const document = bundle.ui.uidoc;

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
            onOpenSurface: options.openSurfaceWithTransition,
            onCloseLayer: options.closeLayerWithTransition,
            onQuitApplication: options.quitApplication,
            onGetFullscreen: options.getFullscreen,
            onSetFullscreen: options.setFullscreen,
            onStartStory: options.startStoryInGame,
            onWriteSave: options.writeSaveInGame,
            onLoadSave: options.loadSaveInGame,
            onDeleteSave: options.deleteSaveInGame,
            onListSaveIds: options.listSaveIds,
            onGetSaveMetadata: options.getSaveMetadata,
            onGetSavePreview: options.getSavePreview,
            onGetHistory: options.getHistoryInGame,
            onRestoreHistory: options.restoreHistoryInGame,
            onGetNametag: options.getCurrentNametag,
            onGetNotifications: options.getNotificationsInGame,
            onGetChoiceCount: options.getChoiceCountInGame,
            onIsNvlMode: options.isNvlModeInGame,
            onIsCurrentTextRead: options.isCurrentTextReadInGame,
            onClearTextRead: options.clearTextReadInGame,
            onSelectChoice: options.selectChoiceInGame,
            onIsInGame: options.isInGame,
            onIsGameOverlay: () => true,
            onQuitGame: options.quitGame,
            onNext: options.nextInGame,
            onSkip: options.skipInGame,
            onShowDialog: options.showDialogInGame,
            onHideDialog: options.hideDialogInGame,
            onToggleDialogDisplay: options.toggleDialogDisplayInGame,
            onSetSentenceSpeed: options.setSentenceSpeedInGame,
            onGetGamePreference: options.getGamePreferenceInGame,
            onSetGamePreference: options.setGamePreferenceInGame,
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
            localizationConfig: bundle.localization ?? null,
        });
    }, [
        core,
        document,
        options,
        runtimeScopeId,
        setWidgetPatchesByScope,
        surface.id,
        widgetPatchesByScopeRef,
        widgetRuntimeStore,
    ]);

    const hostAdapter = useMemo((): UIHostAdapter => {
        if (!core || !hostApi) {
            return {
                ...staticSurfaceHostAdapter(surface),
                gameUiRuntime: { slotId },
            };
        }
        return {
            ...createDevModeBlueprintHostAdapter({
                bundle,
                surface,
                runtimeScopeId,
                scopeBridge: core.scopeBridge,
                debug: core.debug,
                hostApi,
                executionManager: core.executionManager,
            }),
            gameUiRuntime: { slotId },
        };
    }, [core, bundle, hostApi, runtimeScopeId, slotId, surface]);

    useEffect(() => {
        hostAdapterRef.current = hostAdapter;
    }, [hostAdapter]);

    const flushElementIds = useMemo(
        () => collectSurfaceFlushElementIds({
            document,
            blueprintDocument: bundle.ui.localBlueprints,
            surface,
        }),
        [bundle.ui.localBlueprints, document, surface],
    );
    const flushSlotElements = useCallback(() => {
        for (const elementId of flushElementIds) {
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
    }, [document, flushElementIds, surface.id]);

    return { runtimeScopeId, hostAdapter, hostAdapterRef, flushSlotElements };
}

const STATIC_SURFACE_LIFECYCLE_SIGNALS = { beforeSurfaceExit: 0, afterSurfaceEnter: 0 };

/**
 * Shared render body for Game UI slot surfaces: lifecycle boundary + widget runtime provider +
 * surface renderer. Slot components wrap this in their slot-specific NLR chrome.
 *
 * Mirrors {@link AppSurfaceLayer}'s coordination: `core` is withheld from the lifecycle boundary
 * until the surface renderer has registered its blueprint runtime subscriptions
 * (`onRuntimeSubscriptionsReady`). This prevents Dev Mode's StrictMode throwaway mount from
 * closing the execution scope, which would otherwise abort the real mount's widget `init` dispatch
 * (an already-closed scope cancels queued executions).
 */
export function StageSlotSurfaceBody(props: {
    options: GameUiSlotHostOptions;
    surface: UIStageSurface;
    runtime: StageSlotSurfaceRuntime;
    /** "none" makes the surface shell click-through (On-Stage overlay). */
    surfacePointerEvents?: CSSProperties["pointerEvents"];
}) {
    const { options, surface, runtime, surfacePointerEvents } = props;
    const { core, bundle, rendererRegistry, lifecycleRef, makeStateAccessors, widgetRuntimeStore, widgetPatchesByScopeRef } = options;
    const document = bundle.ui.uidoc;
    const { runtimeScopeId, hostAdapter } = runtime;
    const [subscriptionsReady, setSubscriptionsReady] = useState(false);
    const handleRuntimeSubscriptionsReady = useCallback(() => setSubscriptionsReady(true), []);

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
            blueprintDocument: bundle.ui.localBlueprints,
            surfaceState: core.scopeBridge.getSurfaceStore(runtimeScopeId),
            debug: core.debug,
            coalescer: core.bindingDebugCoalescer,
            globalState: globalStateReader,
        };
    }, [core, bundle.ui.localBlueprints, globalStateReader, runtimeScopeId]);

    return (
        <SurfaceLifecycleBoundary
            core={subscriptionsReady ? core : null}
            blueprintDocument={bundle.ui.localBlueprints}
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
                    surfaceLifecycleSignals={STATIC_SURFACE_LIFECYCLE_SIGNALS}
                    onRuntimeSubscriptionsReady={handleRuntimeSubscriptionsReady}
                    surfacePointerEvents={surfacePointerEvents}
                />
            </WidgetRuntimeStateProvider>
        </SurfaceLifecycleBoundary>
    );
}
