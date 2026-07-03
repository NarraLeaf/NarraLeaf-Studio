import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    type ComponentProps,
    type Dispatch,
    type MutableRefObject,
    type SetStateAction,
} from "react";
import { Dialog as NlrDialog } from "narraleaf-react";
import type { DevModeBundle, DevModeStartStoryRequest } from "@shared/types/devMode";
import type { UIStageSurface } from "@shared/types/ui-editor/document";
import type { BlueprintImageAsset } from "@shared/types/blueprint/valueTypes";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import type { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { GameSurfaceRenderer } from "@/lib/ui-editor/runtime/surface/GameSurfaceRenderer";
import { WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import {
    createDevModeBlueprintHostApi,
    type BlueprintGamePreferenceKey,
    type BlueprintGamePreferenceValue,
    type DevModeWidgetRuntimePatch,
} from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { createDevModeBlueprintHostAdapter } from "@/lib/ui-editor/runtime/hostAdapters/devModeBlueprintHostAdapter";
import type { BlueprintRuntimeCore } from "@/lib/ui-editor/runtime/game/useBlueprintRuntimeCore";
import type { SurfaceLifecycleOrchestrator } from "./lifecycle/surfaceLifecycleOrchestrator";
import { collectDialogFlushElementIds } from "@/lib/ui-editor/runtime/game/dialogFlushTargets";
import { DialogStateBridge } from "./DialogStateBridge";
import { SurfaceLifecycleBoundary } from "./SurfaceLifecycleBoundary";
import { applyWidgetRuntimePatch } from "./widgetRuntimePatches";
import { dialogSlotRuntimeScopeId } from "./stageSlots";
import { staticSurfaceHostAdapter, type OpenSurfaceOptions, type PageProps, type SurfaceStateAccessors } from "./types";

/**
 * Renders the Game UI dialog slot surface inside the NarraLeaf <Dialog>
 * component, wiring its own blueprint host adapter scoped to the dialog
 * slot runtime scope and flushing dialog-bound elements on dialog changes.
 */
export function DialogSlotSurface(props: {
    sessionId: string;
    core: BlueprintRuntimeCore | null;
    bundle: DevModeBundle;
    surface: UIStageSurface;
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
        getGamePreferenceInGame,
        setGamePreferenceInGame,
        setDialogVirtualClickTarget,
        setWidgetPatchesByScope,
        widgetPatchesByScopeRef,
        widgetRuntimeStore,
    } = props;
    const runtimeScopeId = useMemo(() => dialogSlotRuntimeScopeId(sessionId, surface.id), [sessionId, surface.id]);
    const hostAdapterRef = useRef<UIHostAdapter | null>(null);
    const document = bundle.ui.uidoc;

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
                ...staticSurfaceHostAdapter(surface),
                gameUiRuntime: { slotId: "dialog" },
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
            gameUiRuntime: { slotId: "dialog" },
        };
    }, [core, bundle, hostApi, runtimeScopeId, surface]);

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
        <NlrDialog
            ref={setDialogVirtualClickTarget}
            style={{ width: "100%", height: "100%", position: "relative" }}
        >
            <DialogStateBridge
                core={core}
                getCurrentNametag={getCurrentNametag}
                flushDialogElements={flushDialogElements}
            />
            <SurfaceLifecycleBoundary
                core={core}
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
                    />
                </WidgetRuntimeStateProvider>
            </SurfaceLifecycleBoundary>
        </NlrDialog>
    );
}

export function createDialogSlotComponent(options: ComponentProps<typeof DialogSlotSurface>) {
    return function DialogSlotGameUI() {
        return <DialogSlotSurface {...options} />;
    };
}
