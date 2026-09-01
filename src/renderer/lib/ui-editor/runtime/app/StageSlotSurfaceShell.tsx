import {
    useCallback,
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
import type { AutoSaveEntry, SaveRecordLine, SaveRecordPlaytime, SaveRecordTimes } from "@shared/types/saves";
import type { GameProgressImportOutcome } from "@shared/types/gameProgress";
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
    type BlueprintLayerShowRequest,
    type BlueprintStoryEnding,
    type DevModeWidgetRuntimePatch,
} from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import type { BlueprintNetworkFetchRequest, BlueprintNetworkFetchResult } from "@shared/types/blueprint/network";
import type { BlueprintOpenExternalRequest, BlueprintOpenExternalResult } from "@shared/types/blueprint/externalLink";
import type { BlueprintPointerMoveRequest, BlueprintPointerMoveResult } from "@shared/types/blueprint/pointer";
import type { GameStorageDurability } from "@shared/types/gameRuntime";
import { createDevModeBlueprintHostAdapter } from "@/lib/ui-editor/runtime/hostAdapters/devModeBlueprintHostAdapter";
import type { ProjectAudioTrack } from "@shared/types/audioTrack";
import type { SoundTransport } from "./soundTransport";
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
    /** The player asked for less motion: the widgets on a slot surface stay put. */
    reducedMotion?: boolean;
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
    goBackWithTransition: () => Promise<void>;
    quitApplication: () => Promise<void>;
    /** Hosts without a real application window (story preview) leave these unset. */
    getFullscreen?: () => Promise<boolean>;
    setFullscreen?: (fullscreen: boolean) => Promise<void>;
    getWindowScaleOptions?: () => Promise<number[]>;
    getWindowScale?: () => Promise<number>;
    setWindowScale?: (scale: number) => Promise<void>;
    getWindowSize?: () => Promise<{ width: number; height: number }>;
    setWindowSize?: (width: number, height: number) => Promise<void>;
    startStoryInGame: (request: DevModeStartStoryRequest) => Promise<void>;
    writeSaveInGame: (id: string, metadata?: unknown, screenshot?: boolean) => Promise<void>;
    /** Resolves false when the save was not applied; `Load Save` routes that to its `Failed` pin. */
    loadSaveInGame: (id: string) => Promise<boolean>;
    deleteSaveInGame: (id: string) => Promise<void>;
    listSaveIds: () => Promise<string[]>;
    getSaveMetadata: (id: string) => Promise<unknown>;
    getSaveTimes: (id: string) => Promise<SaveRecordTimes | null>;
    getSaveLine: (id: string) => Promise<SaveRecordLine | null>;
    getSavePlaytime: (id: string) => Promise<SaveRecordPlaytime | null>;
    getSavePreview: (id: string) => Promise<BlueprintImageAsset | null>;
    /** The running playthrough's playtime, in seconds. */
    getPlaytime: () => number;
    /** Seconds ever spent in this project, across every playthrough. */
    getTotalPlaytime: () => number;
    writeAutoSaveInGame: () => Promise<void>;
    listAutoSaves: () => Promise<AutoSaveEntry[]>;
    getHistoryInGame: () => BlueprintGameHistoryEntry[];
    /** The lines the player has stepped back past, nearest first. Empty unless they have. */
    getFutureInGame: () => BlueprintGameHistoryEntry[];
    restoreHistoryInGame: (id?: string) => Promise<void>;
    /** Step the play head forward one line, back over a line already read. */
    redoHistoryInGame: () => Promise<void>;
    canUndoHistoryInGame: () => boolean;
    canRedoHistoryInGame: () => boolean;
    /**
     * Carrying a playthrough between two editions of one title, for the Export/Import Progress
     * nodes. Optional on the same terms as {@link soundTransport}: a host with no shell behind it
     * (the in-editor story preview) genuinely cannot write the document, and the bridge answers the
     * node with a refusal the author's graph can hear. It is not optional for a real session - a
     * title screen is exactly the kind of surface an author builds out of Game UI slots, and
     * without these both nodes reported "progress cannot be written here" inside a dialogue,
     * choice or NVL slot while working perfectly one surface above.
     */
    exportProgressInGame?: () => Promise<{ outcome: "written" | "failed"; error: string }>;
    importProgressInGame?: () => Promise<GameProgressImportOutcome>;
    getCurrentNametag: () => string | null;
    /**
     * Invert a dialog-avatar URL back to the asset id it was compiled from. The engine resolves
     * avatars to URLs; a blueprint pin carries an `ImageAsset`. Absent on hosts with no compiled
     * story, where there are no avatars to invert.
     */
    resolveAvatarAssetId?: (url: string) => string | null;
    getNotificationsInGame: () => BlueprintGameNotification[];
    getChoiceCountInGame: () => number;
    isNvlModeInGame: () => boolean;
    /** Optional: hosts without a text-read tracker (story preview) fall back to the mirrored state key. */
    isCurrentTextReadInGame?: () => boolean;
    /** Optional: hosts without a text-read tracker fall back to wiping the persistence key directly. */
    clearTextReadInGame?: () => Promise<void>;
    /**
     * The rest of the game host, forwarded verbatim.
     *
     * A slot surface builds its own host API, and every callback left off this build is a node
     * that answers with the bridge's default - `false`, `{found:false}`, an empty list - without
     * throwing and without a diagnostic. That has now happened four times (sound, progress,
     * saved variables, and this batch), so the guard is no longer a list somebody remembers to
     * extend: `stageSlotHostForwarding.test.ts` compares this file with the page path and fails
     * naming whatever is missing.
     *
     * Several of these are the ones most likely to be reached for from a stage slot in the first
     * place: a replay button on the dialogue box (`onPlayVoice`), an already-read mark on the
     * choice list (`onIsTextRead` / `onIsOptionPicked`), a confirm layer from the quick menu
     * (`onShowLayer` / `onWaitLayer`), an endings counter on an on-stage strip.
     */
    clearPages?: () => void | Promise<void>;
    clearGameOverlay?: () => void | Promise<void>;
    showLayer?: (request: BlueprintLayerShowRequest) => string;
    hideLayer?: (handle: string) => Promise<void> | void;
    hideLayerGroup?: (group: string) => Promise<void> | void;
    waitLayer?: (handle: string) => Promise<unknown>;
    closeOwnLayer?: (runtimeScopeId: string, result: unknown) => boolean;
    isLayerMounted?: (handle: string) => boolean;
    captureRun?: () => unknown | null;
    readSaveGame?: (id: string) => Promise<unknown | null> | unknown | null;
    hasReadTextInGame?: (textId: string) => boolean;
    isSceneVisitedInGame?: (sceneId: string) => boolean;
    isOptionPickedInGame?: (optionId: string) => boolean;
    clearVisitedInGame?: () => void;
    isEndingReachedInGame?: (endingId: string) => boolean;
    isDlcInstalledInGame?: (dlcId: string) => boolean;
    listEndingsInGame?: (storyId: string) => BlueprintStoryEnding[];
    clearEndingStateInGame?: (endingId: string) => Promise<void> | void;
    clearEndingsInGame?: () => Promise<void> | void;
    networkFetch?: (request: BlueprintNetworkFetchRequest) => Promise<BlueprintNetworkFetchResult>;
    movePointer?: (request: BlueprintPointerMoveRequest) => Promise<BlueprintPointerMoveResult>;
    openExternal?: (request: BlueprintOpenExternalRequest) => Promise<BlueprintOpenExternalResult>;
    storageDurability?: () => Promise<GameStorageDurability>;
    playVoiceUnit?: (unitId: string) => Promise<boolean>;
    playChoiceVoiceUnit?: (unitId: string, options: { interruptOthers: boolean }) => Promise<boolean>;

    /**
     * The running playthrough's saved variables.
     *
     * A slot surface needs these as much as a page does, and arguably more: the screens that show
     * a counter while the story plays - a HUD, an affection meter, a status strip - are the
     * on-stage ones. Without them the nodes answer `found: false` and refuse the write with
     * "game runtime is not available" while a game is plainly running.
     */
    getSavedVariableInGame: (variableId: string) => { value: unknown; found: boolean };
    setSavedVariableInGame: (variableId: string, value: unknown) => void;
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
    /**
     * The session's sound transport.
     *
     * Optional because a host may back no audio at all (the in-editor story preview), in which case
     * the sound nodes degrade to their warned no-op exactly as they do on a Page previewed in
     * Studio. It is *not* optional in the sense of "nice to have": a slot surface without it is the
     * shipped defect where a button-click sound in a dialogue box, choice or NVL surface silently
     * did nothing, because this shell built its host API with none of the sound callbacks the
     * top-level surfaces pass.
     */
    soundTransport?: SoundTransport;
    /** Project audio tracks (from the bundle); resolves the video widget's mixer volume. */
    audioTracks?: readonly ProjectAudioTrack[];
    /** Preference stream so a mid-playback volume-slider drag reaches host-owned media elements. */
    subscribeGamePreferences?: (listener: () => void) => () => void;
    /**
     * The player changed the language from inside the game. A slot surface is exactly where that
     * happens — a language picker built into a dialogue-box quick menu — and `GameApp` owns what it
     * costs (writing a save, restarting, returning to the playthrough), so the slot bridge only
     * forwards the request rather than deciding anything.
     *
     * Optional for the same reason `getFullscreen` is: what it does is restart the application and
     * come back to the save it just wrote, and the story preview has no application to restart. That
     * host leaves it unset, and a `Set Language` node on a slot surface there reaches nothing —
     * which is the truth about the capability, not a gap to fill with a partial imitation.
     */
    localeChangedInGame?: (code: string) => Promise<void>;
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
    /**
     * Which drawing of this slot's surface this is, for the slot that can have several at once - see
     * `stageSlotRuntimeScopeId`. Left at zero by every slot drawn once, which is all of them but
     * choice, and by the first menu when there are several.
     */
    slot?: number;
}): StageSlotSurfaceRuntime {
    const { options, surface, slotId, slot = 0 } = input;
    const {
        sessionId,
        core,
        bundle,
        widgetRuntimeStore,
        setWidgetPatchesByScope,
        widgetPatchesByScopeRef,
    } = options;
    const runtimeScopeId = useMemo(
        () => stageSlotRuntimeScopeId(sessionId, slotId, surface.id, slot),
        [sessionId, slotId, surface.id, slot],
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
            onPageBack: options.goBackWithTransition,
            onQuitApplication: options.quitApplication,
            onGetFullscreen: options.getFullscreen,
            onSetFullscreen: options.setFullscreen,
            onGetWindowScaleOptions: options.getWindowScaleOptions,
            onGetWindowScale: options.getWindowScale,
            onSetWindowScale: options.setWindowScale,
            onGetWindowSize: options.getWindowSize,
            onSetWindowSize: options.setWindowSize,
            onStartStory: options.startStoryInGame,
            onWriteSave: options.writeSaveInGame,
            onLoadSave: options.loadSaveInGame,
            onDeleteSave: options.deleteSaveInGame,
            onListSaveIds: options.listSaveIds,
            onGetSaveMetadata: options.getSaveMetadata,
            onGetSaveTimes: options.getSaveTimes,
            onGetSaveLine: options.getSaveLine,
            onGetSavePlaytime: options.getSavePlaytime,
            onGetPlaytime: options.getPlaytime,
            onGetTotalPlaytime: options.getTotalPlaytime,
            onGetSavePreview: options.getSavePreview,
            onWriteAutoSave: options.writeAutoSaveInGame,
            onListAutoSaves: options.listAutoSaves,
            onGetHistory: options.getHistoryInGame,
            onGetFuture: options.getFutureInGame,
            onRestoreHistory: options.restoreHistoryInGame,
            onRedoHistory: options.redoHistoryInGame,
            onCanUndoHistory: options.canUndoHistoryInGame,
            onCanRedoHistory: options.canRedoHistoryInGame,
            onExportProgress: options.exportProgressInGame,
            onImportProgress: options.importProgressInGame,
            onGetNametag: options.getCurrentNametag,
            onGetNotifications: options.getNotificationsInGame,
            onGetChoiceCount: options.getChoiceCountInGame,
            onIsNvlMode: options.isNvlModeInGame,
            onIsCurrentTextRead: options.isCurrentTextReadInGame,
            onClearTextRead: options.clearTextReadInGame,
            onGetSavedVariable: options.getSavedVariableInGame,
            onSetSavedVariable: options.setSavedVariableInGame,
            onClearPages: options.clearPages,
            onClearGameOverlay: options.clearGameOverlay,
            onShowLayer: options.showLayer,
            onHideLayer: options.hideLayer,
            onHideLayerGroup: options.hideLayerGroup,
            onWaitLayer: options.waitLayer,
            onCloseOwnLayer: options.closeOwnLayer,
            onIsLayerMounted: options.isLayerMounted,
            onCaptureRun: options.captureRun,
            onReadSaveGame: options.readSaveGame,
            onIsTextRead: options.hasReadTextInGame,
            onIsSceneVisited: options.isSceneVisitedInGame,
            onIsOptionPicked: options.isOptionPickedInGame,
            onClearVisited: options.clearVisitedInGame,
            onIsEndingReached: options.isEndingReachedInGame,
            onIsDlcInstalled: options.isDlcInstalledInGame,
            onListEndings: options.listEndingsInGame,
            onClearEndingState: options.clearEndingStateInGame,
            onClearEndings: options.clearEndingsInGame,
            onNetworkFetch: options.networkFetch,
            onMovePointer: options.movePointer,
            onOpenExternal: options.openExternal,
            onStorageDurability: options.storageDurability,
            onPlayVoice: options.playVoiceUnit,
            onPlayChoiceVoice: options.playChoiceVoiceUnit,
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
            // The same sound callbacks the top-level surfaces pass. Left off, `sound.play` returns null
            // and every transport node is a silent no-op, so an authored click sound inside a
            // dialogue box just never happens.
            onPlaySound: options.soundTransport?.play,
            onStopSound: options.soundTransport?.stop,
            onPauseSound: options.soundTransport?.pause,
            onResumeSound: options.soundTransport?.resume,
            onSetSoundVolume: options.soundTransport?.setVolume,
            onSeekSound: options.soundTransport?.seek,
            onIsSoundPlaying: options.soundTransport?.isPlaying,
            onGetTrackVolume: options.soundTransport?.getTrackVolume,
            onSetTrackVolume: options.soundTransport?.setTrackVolume,
            audioTracks: options.audioTracks,
            onSubscribeGamePreferences: options.subscribeGamePreferences,
            onLocaleChanged: options.localeChangedInGame,
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
            // What this scope is already showing. A slot surface is rebuilt whenever the engine
            // gives its box a new key - which the dialog box gets whenever the gap between two
            // lines outlives the replacement grace - and the patches painted before that survive
            // in the host's map. Without them the new host API believes the drawing is untouched
            // and drops every write that returns an element to its authored value.
            initialWidgetPatches: widgetPatchesByScopeRef.current[runtimeScopeId],
            widgetRuntimeStore,
            localizationConfig: bundle.localization ?? null,
            // The dub languages this build ships. `onPlayVoice` and `onPlayChoiceVoice` are already
            // forwarded above, but they are only half the family: without this the bridge answers
            // `voice.listLocales()` with an empty list, `voice.getLocale()` with the empty string,
            // and `Set Voice Language` throws "This project has no voice languages configured" -
            // which blames the project for a field the host never handed over. A dub picker in a
            // dialogue-box quick menu is exactly where an author puts one.
            voiceConfig: bundle.voice ?? null,
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

    // Assigned while rendering rather than from an effect: the ref is read by children (the dialog
    // slot's state bridge flushes through it), and a child's effect runs before this component's
    // does. Filled in from an effect, the very first flush after a mount found `null` and was
    // dropped without a word - which is how a scene jump used to leave the previous speaker's
    // avatar on the line that replaced it. Mirroring a memoized value is idempotent, so a repeated
    // render writes the same adapter.
    hostAdapterRef.current = hostAdapter;

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

/** See the note on `NO_WIDGET_RUNTIME_PATCHES` in AppSurfaceLayer: a fresh `{}` defeats the memo. */
const NO_WIDGET_RUNTIME_PATCHES: Record<string, DevModeWidgetRuntimePatch> = {};

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
    /** Display-only slot: no widget inside takes pointer events (notification toasts). */
    passive?: boolean;
}) {
    const { options, surface, runtime, surfacePointerEvents, passive } = props;
    const { core, bundle, rendererRegistry, lifecycleRef, makeStateAccessors, widgetRuntimeStore, widgetPatchesByScopeRef } = options;
    const document = bundle.ui.uidoc;
    const { runtimeScopeId, hostAdapter } = runtime;
    const [subscriptionsReady, setSubscriptionsReady] = useState(false);
    const handleRuntimeSubscriptionsReady = useCallback(() => setSubscriptionsReady(true), []);
    const getWidgetRuntimePatches = useCallback(
        () => widgetPatchesByScopeRef.current[runtimeScopeId] ?? NO_WIDGET_RUNTIME_PATCHES,
        [runtimeScopeId, widgetPatchesByScopeRef],
    );

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
            persistentVariables: bundle.ui.persistentVariables,
            surfaceState: core.scopeBridge.getSurfaceStore(runtimeScopeId),
            debug: core.debug,
            coalescer: core.bindingDebugCoalescer,
            globalState: globalStateReader,
        };
    }, [core, bundle.ui.localBlueprints, globalStateReader, runtimeScopeId]);

    return (
        <SurfaceLifecycleBoundary
            core={core}
            ready={subscriptionsReady}
            blueprintDocument={bundle.ui.localBlueprints}
            persistentVariables={bundle.ui.persistentVariables}
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
                    getWidgetRuntimePatches={getWidgetRuntimePatches}
                    surfaceLifecycleSignals={STATIC_SURFACE_LIFECYCLE_SIGNALS}
                    onRuntimeSubscriptionsReady={handleRuntimeSubscriptionsReady}
                    surfacePointerEvents={surfacePointerEvents}
                    passive={passive}
                    // A Game UI slot has no page animation of its own - it appears when the scene
                    // says so - but the widgets on it can still arrive and leave on their own terms.
                    elementAnimations
                    reducedMotion={options.reducedMotion === true}
                    // The uidoc here is the compiled bundle's; nothing edits it in place.
                    staticDocument
                />
            </WidgetRuntimeStateProvider>
        </SurfaceLifecycleBoundary>
    );
}
