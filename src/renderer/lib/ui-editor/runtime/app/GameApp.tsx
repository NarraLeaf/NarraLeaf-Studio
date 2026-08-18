import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { AnimatePresence, MotionConfig, useReducedMotion } from "motion/react";
import { Sound, type LiveGame, type SavedGame, type Scene } from "narraleaf-react";
import {
    readWrappedStorableNamespace,
    readWrappedStorableValue,
} from "@shared/utils/storableValue";
import {
    buildSaveCompatibilityStamp,
    normalizeSaveCompatibilityConfiguration,
    planSaveResume,
    readSaveCompatibilityStamp,
} from "@shared/types/saveCompatibility";
import type { DevModeStartStoryRequest } from "@shared/types/devMode";
import {
    LOCALE_STORAGE_KEY,
    characterTranslationUnitId,
    matchSystemLocale,
    resolveLocalizedUnitText,
} from "@shared/types/localization";
import { VOICE_LOCALE_STORAGE_KEY } from "@shared/types/voice";
import {
    isAutoSaveId,
    isReservedSaveId,
    normalizeAutoSaveConfiguration,
    parseAutoSaveSlotIndex,
    type AutoSaveEntry,
    type SaveRecordLine,
    type SaveRecordPlaytime,
    type SaveRecordTimes,
} from "@shared/types/saves";
import {
    GameLocalizationContext,
    type GameLocalizationRuntime,
} from "@/lib/ui-editor/runtime/localization/GameLocalizationContext";
import type { UISurface } from "@shared/types/ui-editor/document";
import { toBlueprintImageAsset, type BlueprintImageAsset } from "@shared/types/blueprint/valueTypes";
import {
    clearCharacterAvatarAssets,
    registerCharacterAvatarAssets,
} from "@/lib/ui-editor/runtime/characterAvatarAssets";
import {
    BLUEPRINT_GAME_CHARACTERS_STATE_KEY,
    BLUEPRINT_GAME_NAMETAG_STATE_KEY,
    BLUEPRINT_GAME_SPEAKER_CHARACTER_ID_STATE_KEY,
    BLUEPRINT_GAME_SPEAKER_COLOR_STATE_KEY,
    BLUEPRINT_GAME_TEXT_READ_STATE_KEY,
    BLUEPRINT_TEXT_READ_PERSISTENCE_KEY,
} from "@shared/types/blueprint/hostApi";
import { toBlueprintCharacterInfo } from "@shared/types/blueprint/characterInfo";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import type { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import type {
    NestedSurfaceRuntime,
    SurfaceBlueprintBindingContext,
} from "@/lib/ui-editor/runtime/surface/SurfaceElementTree";
import type { PageAnimationNavigationDirection } from "@/lib/ui-editor/runtime/pageAnimation";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import {
    createDevModeBlueprintHostApi,
    type BlueprintLayerShowRequest,
    type DevModeWidgetRuntimePatch,
} from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { createDevModeBlueprintHostAdapter } from "@/lib/ui-editor/runtime/hostAdapters/devModeBlueprintHostAdapter";
import {
    useBlueprintRuntimeCore,
    type BlueprintRuntimeCore,
} from "@/lib/ui-editor/runtime/game/useBlueprintRuntimeCore";
import {
    executeLifecycleCommands,
    SurfaceLifecycleOrchestrator,
} from "./lifecycle/surfaceLifecycleOrchestrator";
import {
    dispatchGlobalBlueprintEvent,
    dispatchSurfaceBlueprintEvent,
    dispatchWidgetsBlueprintEvent,
} from "@/lib/ui-editor/blueprint-runtime/BlueprintDispatcher";
import { subscribeGamePreferenceChanges } from "@/lib/ui-editor/blueprint-runtime/gamePreferenceSubscription";
import {
    createEventPropagationControl,
    getOrCreateDomEventPropagationControl,
} from "@/lib/ui-editor/runtime/eventPropagationControl";
import {
    compileStudioStoryToNlr,
    createEmptyCompiledNlrStory,
    type CompiledNlrStory,
} from "@/lib/ui-editor/runtime/game/storyCompiler";
import {
    isStoryVisited,
    readStoryVisitedIds,
    STORY_VISITED_OPTIONS_KEY,
    STORY_VISITED_SCENES_KEY,
    type StoryVisitedKey,
} from "@/lib/ui-editor/runtime/game/storyVisited";
import {
    applyGameProgressVariables,
    collectGameProgressVariables,
    mergeVisitedSceneIds,
    toImportOutcome,
    type GameProgressVariableDef,
} from "@/lib/ui-editor/runtime/app/gameProgress";
import type {
    GameProgressAnchor,
    GameProgressDocumentV1,
    GameProgressImportOutcome,
} from "@shared/types/gameProgress";
import {
    collectSavedVariableView,
    computeStoryStageSnapshot,
    savedVariableDefsFromView,
} from "@/lib/ui-editor/runtime/game/storyStageSnapshot";
import { createPuppetStageHandle, loadPuppetBackends } from "@/lib/ui-editor/runtime/game/puppetBackendHost";
import { createStageSurfaceImageBackend, createStageSurfacePuppetBackend } from "@/lib/ui-editor/runtime/game/stageSurfaceBackend";
import { collectStageFrameSizes } from "@/lib/ui-editor/runtime/game/stageFrameSizes";
import { savedVariableDefs, sceneVariableDefs, storyPersistentDefs } from "@shared/types/story";
import { resolveStagePreloadTarget } from "@/lib/ui-editor/runtime/game/resolveDefaultLaunchScene";
import { NlrStageLayer, type NlrStageSession } from "@/lib/ui-editor/runtime/game/NlrStageLayer";
import { RuntimePluginOverlayLayer } from "@/lib/ui-editor/runtime/plugins/RuntimePluginOverlayLayer";
import type { RuntimePluginHostController } from "@/lib/ui-editor/runtime/plugins/runtimePluginHostController";
import {
    clearDevModeSavePreviewImages,
    registerDevModeSavePreviewImage,
} from "@/lib/ui-editor/runtime/devModeSavePreviewAssets";
import type { SurfaceNavigationPresentation } from "@/lib/ui-editor/runtime/game/surfaceNavigationController";
import {
    AppSurfaceLayerWithAdapter,
    type AppSurfaceLayerNavEntry,
} from "./AppSurfaceLayer";
import type { ChoiceSlotRuntime } from "./ChoiceSlotSurface";
import type { GameUiSlotHostOptions } from "./StageSlotSurfaceShell";
import {
    createGameUiSlotComponents,
    createLiveGameUiCallbacks,
    createNlrGameWithGameUi,
    fastForwardToNextChoice,
    restoreLiveGameToHistory,
    STUDIO_SKIP_KEY_BINDING,
} from "./gameUiSlots";
import { audioClipRegionToSoundConfig } from "@shared/types/audio";
import type { ProjectAudioTrack } from "@shared/types/audioTrack";
import { createSoundTransport } from "./soundTransport";
import { attachAudioBusPersistence, audioTracksToBusDeclarations } from "./audioBusRuntime";
import { attachPlayerPreferences, type PreferenceStoreLike } from "./preferenceRuntime";
import { loadSaveIntoGame, SAVE_LOAD_NOTICE_DURATION_MS, type SaveLoadOutcome } from "./saveLoad";
import { applyLocaleChange, resumeAfterLocaleRestart } from "./localeRestart";
import { createSkipRunController } from "./skipRunController";
import { createSessionGate } from "./sessionGate";
import { applyWidgetRuntimePatch } from "./widgetRuntimePatches";
import { clonePageProps } from "./pageProps";
import { keyboardBlueprintPayload } from "./keyboardBlueprintPayload";
import { isTextEntryTarget } from "./isTextEntryTarget";
import { readNlrCharacterName } from "./nlrDialogReaders";
import {
    createNlrDialogReadHooks,
    createReadKeyResolver,
    createTextReadTracker,
    type TextReadTracker,
} from "./textReadTracker";
import { withDeadline } from "./frameTiming";
import { NavigationController } from "./navigation/NavigationController";
import { useSurfaceNavigation } from "./navigation/useSurfaceNavigation";
import { LayerStackController, mountSurfaceLayer, type SurfaceLayerEntry } from "./layers/LayerStackController";
import { useLayerStack } from "./layers/useLayerStack";
import { resolveCompositeInput } from "./layers/compositeInput";
import { buildCompositeView } from "./layers/compositeView";
import type { AppNavEntry, HostAdapterBundle, OpenSurfaceOptions, PageProps, SurfaceStateAccessors } from "./types";
import type {
    GameAppFrameContext,
    GameAppHost,
    GameAppLogLevel,
    GameAppOverlayContext,
    GameAppSaveBridge,
    GameAppSaveRecord,
    GameAppStoryRuntimeBridge,
} from "./GameAppHost";
import { useAutoSave } from "./useAutoSave";
import { usePlaytime } from "./usePlaytime";
import { readSavePlaytimeSeconds } from "@shared/utils/runtimeSaveRecord";

// Outer safety net: if the environment never comes up at all, start the surface system anyway
// rather than sit on the loading step forever. Generous on purpose — it has to sit *outside*
// STAGE_WARMUP_TIMEOUT_MS, because cutting a warm-up short is the one failure that shows up as
// in-game stutter, and boot latency is explicitly not what this trades against.
const NLR_BOOT_PRELOAD_TIMEOUT_MS = 45_000;
/**
 * How long a load waits for the page the player was on to finish leaving. Generous next to any
 * authored page transition and short next to a player wondering whether the game is stuck.
 */
const SAVE_LOAD_ROUTER_EXIT_TIMEOUT_MS = 3000;
/**
 * How long the resume after a language restart waits for an environment to come up, and how often
 * it looks. Long enough to cover a cold boot that has a scene to fetch and decode; bounded so a
 * boot that never produces one leaves the parked run for the next one instead of waiting forever.
 */
const LOCALE_RESUME_SESSION_WAIT_MS = 30_000;
const LOCALE_RESUME_POLL_MS = 200;
/**
 * How long the environment has to stand still before the parked run is loaded into it. Covers the
 * gap between a mount publishing its live game and whatever started that mount entering the game.
 */
const LOCALE_RESUME_SETTLE_MS = 1000;
// How long a mount waits for the first scene to be fetched and decoded. Long enough that a real
// project's opening scene always finishes: a longer loading step is the cheaper cost, since the
// alternative is the player paying for it on a button they just pressed. Bounded only so a broken
// asset degrades to "start pays for it" instead of never starting.
const STAGE_WARMUP_TIMEOUT_MS = 30_000;

/**
 * Where the layer stack starts counting, in the surface layer's own index space.
 *
 * Not simply one past however many page entries happen to be mounted. A page entry on its way out is
 * drawn at `30 + layerIndex` so it can pass over the page arriving underneath it, and a layer sitting
 * immediately above the page lane would be crossed by that exit - a modal would disappear behind the
 * screen it was covering, for the length of one transition. Starting the layers clear of the page
 * lane's exit band keeps a layer above the pages whatever the pages are doing, and keeps each layer's
 * own z fixed instead of shifting as a transition opens and closes.
 */
const LAYER_STACK_INDEX_BASE = 32;

/**
 * A pending mount or game entry that was abandoned because something took over: a newer bundle
 * revision, a quit, a session change. Whatever superseded it now owns the environment, so this is
 * ordinary control flow and not a broken runtime — reporting it as an error made routine hot reloads
 * look like failures ("NLR hot reload restart failed") while the newer session was coming up fine.
 */
class NlrSessionSupersededError extends Error {
    constructor(reason: string) {
        super(reason);
        this.name = "NlrSessionSupersededError";
    }
}

export type GameAppNavEntry = AppNavEntry;

function normalizeError(error: unknown): string {
    if (error instanceof Error) {
        return error.stack ?? error.message;
    }
    return String(error);
}

/**
 * The sentence a failure states, without the stack.
 *
 * `normalizeError` prefers the stack, which is right for a console line and wrong for anything shown
 * to an author: the first thing they should read is what went wrong, not which of our frames noticed.
 * The stack still travels, next to it rather than instead of it (see {@link GameAppRuntimeIssue}).
 */
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message || String(error) : String(error);
}

function errorStack(error: unknown): string | undefined {
    return error instanceof Error ? error.stack ?? undefined : undefined;
}

function findSurface(bundle: GameAppHost["bundle"], surfaceId: string | null | undefined): UISurface | null {
    if (surfaceId) {
        const surface = bundle.ui.uidoc.surfaces.find(item => item.id === surfaceId);
        if (surface) {
            return surface;
        }
    }
    return bundle.ui.uidoc.surfaces.find(surface => surface.kind === "appSurface") ?? bundle.ui.uidoc.surfaces[0] ?? null;
}

export type GameAppProps = {
    host: GameAppHost;
    rendererRegistry: ElementRendererRegistry;
    /** Scale for surface layers, resolved by the host from its viewport strategy. */
    getScale: (activeSurface: UISurface) => number;
    /** Host frame (viewport/aspect container) rendered around the game content. */
    renderFrame: (ctx: GameAppFrameContext) => ReactNode;
    /** Rendered while the navigation stack has no active surface yet. */
    renderPlaceholder?: () => ReactNode;
    /** Host overlays (e.g. debug tools) rendered as siblings above the frame. */
    renderOverlays?: (ctx: GameAppOverlayContext) => ReactNode;
    /**
     * Runtime plugin capability backends for this environment. The shell builds
     * it before the plugins load (setup runs during boot); GameApp attaches the
     * live blueprint runtime and NarraLeaf session to it as they come up, and
     * renders the plugins' overlays. Absent for hosts that load no plugins (the
     * workspace story preview).
     */
    pluginHost?: RuntimePluginHostController;
    /**
     * The layer stack composited over the page lane. Supplied by a caller that needs to reach it -
     * `mountSurfaceLayer` takes the controller - and otherwise created here and left empty, which is
     * every host today.
     */
    layerStack?: LayerStackController;
};

/**
 * Shared game application orchestrator: owns the blueprint runtime core, the
 * surface navigation stack and transitions, the NarraLeaf environment boot /
 * story lifecycle, saves, keyboard dispatch, and appBoot/gameReady events.
 * Studio Dev Mode and the standalone game runtime render this component and
 * differ only in the injected GameAppHost.
 */
export function GameApp(props: GameAppProps): ReactNode {
    const {
        host,
        rendererRegistry,
        getScale,
        renderFrame,
        renderPlaceholder,
        renderOverlays,
        pluginHost,
        layerStack: providedLayerStack,
    } = props;
    const bundle = host.bundle;
    const core = useBlueprintRuntimeCore(bundle, {
        persistenceAdapter: host.persistenceAdapter,
        onDebugEvent: host.onDebugEvent,
        debuggerEnabled: host.debuggerEnabled,
        disposeMessage: host.disposeMessage,
    });
    // Runtime plugins reach story variables and the player's language through the
    // blueprint runtime, so those capabilities only become real once it exists.
    // Re-attaches on a bundle swap (Dev Mode live reload); the plugins' own
    // subscriptions live on the controller and are untouched by it.
    useEffect(() => {
        if (!pluginHost || !core) {
            return;
        }
        return pluginHost.attachRuntime({ scope: core.scopeBridge, bundle });
    }, [bundle, core, pluginHost]);
    // First-launch language pick: when no stored locale is valid for this project,
    // match the system language against the configured locales and persist it.
    // The stored value stays authoritative afterwards (player choice wins).
    useEffect(() => {
        const localization = bundle.localization;
        if (!core || !localization) {
            return;
        }
        let cancelled = false;
        void (async () => {
            try {
                const stored = await core.scopeBridge.persistenceGetAsync(LOCALE_STORAGE_KEY);
                if (cancelled || (typeof stored === "string" && localization.locales.some(locale => locale.code === stored))) {
                    return;
                }
                const candidates = typeof navigator !== "undefined"
                    ? [...(navigator.languages ?? []), navigator.language]
                    : [];
                const matched = matchSystemLocale(localization.locales, candidates);
                if (!cancelled && matched && matched !== localization.sourceLocale) {
                    // Session-only: re-derived from `navigator` on every boot, so storing it
                    // would pin a guess and stop the game following an OS language change. An
                    // explicit choice goes through the Set Language node, which does store.
                    core.scopeBridge.persistenceSetSessionOnly(LOCALE_STORAGE_KEY, matched);
                }
            } catch {
                // Non-fatal: the game falls back to the source language.
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [core, bundle.localization]);
    // Localized UI text: widget renderers resolve display text through this
    // context and re-render on language changes (persistence subscription).
    const gameLocalizationRuntime = useMemo<GameLocalizationRuntime | null>(() => {
        const localization = bundle.localization;
        if (!localization || !core) {
            return null;
        }
        return {
            bundle: localization,
            getLocale: () => {
                const stored = core.scopeBridge.persistenceGet(LOCALE_STORAGE_KEY);
                return typeof stored === "string" && stored ? stored : localization.sourceLocale;
            },
            subscribe: listener => core.scopeBridge.subscribePersistence(listener),
        };
    }, [bundle.localization, core]);
    const widgetRuntimeStore = useMemo(() => new WidgetRuntimeStateStore(), []);
    // Localized character nametag: NLR reports the authored (source-language)
    // name; map it back to its character and translate the `char:<id>` unit for
    // the current locale. Applied at the single point where the nametag enters
    // the dialog state, so the ref, global state, and host API all see the
    // translated name. Like story text, a mid-line language switch applies from
    // the next spoken line.
    const translateCharacterName = useCallback((name: string | null): string | null => {
        const localization = bundle.localization;
        if (!name || !localization || !core) {
            return name;
        }
        const character = bundle.storyLibrary?.characters.find(entry => entry.name === name);
        if (!character) {
            return name;
        }
        const stored = core.scopeBridge.persistenceGet(LOCALE_STORAGE_KEY);
        const locale = typeof stored === "string" && stored ? stored : localization.sourceLocale;
        return resolveLocalizedUnitText(localization, locale, characterTranslationUnitId(character.id)) ?? name;
    }, [bundle.localization, bundle.storyLibrary, core]);
    /**
     * The speaking character's *id*, from the authored name NLR reports.
     *
     * Same match `translateCharacterName` makes, and for the same reason it is done on the source
     * name: that is the only name the engine ever hands back. A `/temp` speaker is in no table and
     * resolves to null.
     */
    const resolveSpeakerCharacterId = useCallback((sourceName: string | null): string | null => {
        if (!sourceName) {
            return null;
        }
        return bundle.storyLibrary?.characters.find(entry => entry.name === sourceName)?.id ?? null;
    }, [bundle.storyLibrary]);
    /**
     * Mirror the project's character table into blueprint global state, so `Get Character` can
     * answer without the graph reaching into the bundle.
     *
     * Once per bundle: the table is authoring data baked into the build, and nothing in a running
     * game edits it. Every host that shares this scope bridge - the app surfaces and each Game UI
     * slot surface - reads the same mirror, which is why no slot has to wire a callback of its own.
     *
     * `color` is additive on the summary, so a bundle built before it existed simply mirrors with no
     * colour - `toBlueprintCharacterInfo` treats absent and empty alike.
     */
    useEffect(() => {
        if (!core) {
            return;
        }
        const table = (bundle.storyLibrary?.characters ?? []).flatMap(entry => {
            const info = toBlueprintCharacterInfo({
                id: entry.id,
                name: entry.name,
                color: entry.color,
                avatarAssetId: entry.defaultAvatarAssetId,
            });
            return info ? [info] : [];
        });
        core.scopeBridge.globalSet(BLUEPRINT_GAME_CHARACTERS_STATE_KEY, table);
    }, [bundle.storyLibrary, core]);
    const [widgetPatchesByScope, setWidgetPatchesByScope] = useState<Record<string, Record<string, DevModeWidgetRuntimePatch>>>({});
    const widgetPatchesByScopeRef = useRef(widgetPatchesByScope);
    const navigation = useMemo(() => new NavigationController(), []);
    const navState = useSurfaceNavigation(navigation);
    const { navStack, visibleEntries, presenceMode: surfacePresenceMode } = navState;
    // Beside the page lane, never inside it: the navigation machine's rules are about replacing one
    // screen with another, and a layer replaces nothing. An empty stack is what makes paging behave
    // exactly as it did before layers existed.
    const layerStack = useMemo(() => providedLayerStack ?? new LayerStackController(), [providedLayerStack]);
    const layerState = useLayerStack(layerStack);
    const layers = layerState.layers;
    const [prepaintReadyKeys, setPrepaintReadyKeys] = useState<Set<string>>(() => new Set());
    const [interactionReadyKeys, setInteractionReadyKeys] = useState<Set<string>>(() => new Set());
    const [nlrSession, setNlrSessionState] = useState<NlrStageSession | null>(null);
    const [nlrPreloadDone, setNlrPreloadDone] = useState(false);
    const [gameStageVisible, setGameStageVisibleState] = useState(false);
    /**
     * Ref mirrors of the two pieces of session state a Game UI slot surface has to be able to ask
     * about at *call* time rather than at build time — see `createSessionGate` for why. Both states
     * stay: the stage re-renders on them. They are written through these two setters so a mirror can
     * never drift from the state it mirrors.
     */
    const nlrSessionIdRef = useRef<string | null>(null);
    const gameStageVisibleRef = useRef(false);
    const setNlrSession = useCallback((session: NlrStageSession | null): void => {
        nlrSessionIdRef.current = session?.id ?? null;
        setNlrSessionState(session);
    }, []);
    const setGameStageVisible = useCallback((visible: boolean): void => {
        gameStageVisibleRef.current = visible;
        setGameStageVisibleState(visible);
    }, []);
    const [studioPageHiddenForGame, setStudioPageHiddenForGame] = useState(false);
    const [gameHiddenNavKeys, setGameHiddenNavKeys] = useState<Set<string>>(() => new Set());
    const navEntrySeqRef = useRef(0);
    const studioPageHiddenForGameRef = useRef(false);
    const gameHiddenNavKeysRef = useRef(gameHiddenNavKeys);
    const lifecycleRef = useRef(new SurfaceLifecycleOrchestrator());
    const appBootFiredRef = useRef<string | null>(null);
    const gameReadyFiredRef = useRef<string | null>(null);
    const nlrBootStartedRef = useRef<string | null>(null);
    // Holds the current boot-launch closure. The boot effect calls it through this ref so its
    // own deps stay minimal ([bootReady, bundle.bundleId]) and it does NOT re-run (and cancel an
    // in-flight boot) when nlrSession / hostAdapterBundle identities churn — the boot itself
    // mutates nlrSession, which would otherwise self-cancel before nlrPreloadDone is ever set.
    const runBootRef = useRef<(() => Promise<void>) | null>(null);
    // Whether the currently mounted NLR environment has actually entered a game (newGame() called).
    // The boot preload mounts the environment (fires gameReady) but does NOT enter — this stays false
    // until Start Game / Load Save.
    const gameEnteredRef = useRef(false);
    // Resolves when the environment is initialised (gameReady dispatched), gating the surface system.
    const pendingEnvReadyRef = useRef(new Map<string, { resolve: () => void; reject: (error: Error) => void }>());
    // Resolves when the mounted session's first-scene assets are fetched and decoded (the stage
    // layer's `onEnvironmentReady`). The boot step waits on it so the cost is paid behind the
    // loading screen rather than between "Start Game" and the first painted frame; `enterMountedGame`
    // waits on it too, for the paths that enter without going through boot.
    const pendingAssetsReadyRef = useRef(new Map<string, { resolve: () => void }>());
    const stageWarmupRef = useRef<{ sessionId: string; promise: Promise<void> } | null>(null);
    // Disposes the previous session's bus-volume subscription. One per mounted `Game`: a relaunch
    // builds a new mixer, and a listener left on the old one would keep writing a dead game's
    // volumes over the live one's.
    const audioBusPersistenceRef = useRef<(() => void) | null>(null);
    // Same shape, same reason, for the preference store: the listener belongs to one `Game`.
    const playerPreferencesRef = useRef<(() => void) | null>(null);
    const startStoryInGameRef = useRef<
        ((request: DevModeStartStoryRequest, options?: { forceReinit?: boolean }) => Promise<void>) | null
    >(null);
    const cleanupBundleIdRef = useRef<string | null>(null);
    /** The runtime core whose language-restart resume has already been attempted. */
    const localeResumeAttemptedRef = useRef<unknown>(null);
    const activeStoryRequestRef = useRef<DevModeStartStoryRequest | null>(null);
    const activeStoryRevisionRef = useRef<number | null>(null);
    const pendingGameStartsRef = useRef(new Map<string, { resolve: () => void; reject: (error: Error) => void }>());
    const nlrLiveGameRef = useRef<LiveGame | null>(null);
    const nlrLiveGameSessionIdRef = useRef<string | null>(null);
    // Built once and never rebuilt, because a Game UI slot surface holds whichever copy it was given
    // when its session was mounted. Both members read the refs above at call time.
    /**
     * The session gate. `isPlaythroughRunning` lives inside it rather than beside its three callers
     * here for the reason the gate exists at all: a Game UI slot surface keeps the callbacks it was
     * built with, and this one used to read the session *state*, which a slot's copy sees as null
     * for that game's whole life. MEASURED: changing the language from the quick menu changed it
     * under a running playthrough and never restarted, while the same control on a page did.
     */
    const {
        isInGame,
        requireLiveGame: requireActiveLiveGame,
        isPlaythroughRunning,
        hasLiveGame,
    } = useMemo(() => createSessionGate<LiveGame>({
        sessionId: nlrSessionIdRef,
        liveGameSessionId: nlrLiveGameSessionIdRef,
        liveGame: nlrLiveGameRef,
        stageVisible: gameStageVisibleRef,
        gameEntered: gameEnteredRef,
    }), []);
    /**
     * The stopwatch behind `Get Playtime`, the reading written onto every save, and the title's
     * running total. Mounted here rather than beside the autosave scheduler because `writeSave`
     * below reads it, and a save has to record the time at the moment it is written.
     */
    const playtime = usePlaytime({
        isPlaying: isPlaythroughRunning,
        // Optional-chained because the runtime core is null until the bundle mounts. A read that
        // lands before it resolves to nothing, and the total simply starts this session from zero;
        // a write that early has nothing to write, because nothing has been played yet.
        persistenceGetAsync: async key => core?.scopeBridge.persistenceGetAsync(key),
        // Not awaited: the value is readable the moment this returns, the clock has already
        // counted the seconds, and a failed disk write only means the next flush carries them.
        persistenceSet: (key, value) => {
            void core?.scopeBridge.persistenceSet(key, value);
        },
    });
    const nlrDialogVirtualClickTargetRef = useRef<HTMLElement | null>(null);
    const nlrCharacterPromptTokenRef = useRef<{ cancel(): void } | null>(null);
    const nlrPreferenceTokenRef = useRef<{ cancel(): void } | null>(null);
    // Play head + call-stack introspection (Dev Mode story-runtime panel). The current-action token
    // is re-bound to whichever LiveGame is live; `currentActionListenersRef` is a stable fan-out so
    // panel subscriptions survive relaunches. `nlrCompiledRef` mirrors the mounted session's compiled
    // story (action bindings + variable namespace names) for the bridge to read at call time.
    const nlrCurrentActionTokenRef = useRef<{ cancel(): void } | null>(null);
    const currentActionIdRef = useRef<string | null>(null);
    const currentActionListenersRef = useRef<Set<(actionId: string | null) => void>>(new Set());
    const nlrCompiledRef = useRef<CompiledNlrStory | null>(null);
    /**
     * The Studio scene the player is in right now, as opposed to the one the story was launched at.
     *
     * `activeStoryRequestRef` holds the launch request and never moves, so a player three scenes
     * into a demo would be handed back to scene one. The engine's own mount/unmount events are the
     * only live source (the same pair the runtime plugin host listens to), and the Scene->id map is
     * the inverse of the compile's own table. Re-bound per session in `onLiveGameReady`.
     */
    const currentSceneIdRef = useRef<string | null>(null);
    const nlrSceneTokensRef = useRef<Array<{ cancel(): void }>>([]);
    /** Drop the scene subscriptions of a session that is going away, and forget where it was. */
    const cancelSceneTracking = useCallback((): void => {
        for (const token of nlrSceneTokensRef.current.splice(0)) {
            try {
                token.cancel();
            } catch {
                // A session the engine already tore down; nothing to undo.
            }
        }
        currentSceneIdRef.current = null;
    }, []);
    /**
     * A progress document that arrived before the story it belongs to was started.
     *
     * `Import Progress` is wired ahead of `Start Game` - that is the whole shape of the feature, the
     * scene id comes out of one and goes into the other - and `Start Game` calls `liveGame.newGame()`,
     * which clears every namespace and rebuilds it from its defaults. Saved values written before
     * that would be wiped by it, so they wait here and are applied in `enterMountedGame` the moment
     * after `newGame()`. Persistent values do not wait: they live outside the engine and survive.
     */
    const pendingImportedProgressRef = useRef<GameProgressDocumentV1 | null>(null);
    /**
     * A save whose saved-scope values are being carried into a story that is being started again.
     *
     * The `Return to where it stopped` policy relaunches instead of loading, and a relaunch is a
     * `Start Game`: it calls `newGame()`, which clears every namespace. The values wait here for
     * the same reason an imported progress document does, and are applied at the same moment.
     */
    const pendingCarriedSaveRef = useRef<SavedGame | null>(null);
    /**
     * The story row the engine was last executing, or undefined when nothing was.
     *
     * Reads the same action↔block table the Dev Mode timeline reads, so a failure lands on exactly
     * the row the play head is showing rather than on a second, differently-derived answer.
     */
    const playHeadBlockId = useCallback((): string | undefined => {
        const actionId = currentActionIdRef.current;
        if (!actionId) {
            return undefined;
        }
        return nlrCompiledRef.current?.actionIdBindings.find(binding => binding.staticId === actionId)?.blockId;
    }, []);
    /**
     * Log a failure AND, for hosts that can point into the story, say where it came from.
     *
     * Both, always: the console line is what a packaged build has, and dropping it here would trade
     * one blind spot for another.
     */
    const reportFailure = useCallback((error: unknown, options?: { prefix?: string }) => {
        const prefix = options?.prefix ?? "";
        host.log("error", `${prefix}${normalizeError(error)}`);
        // Compile diagnostics report their own block and do not come through here; everything that
        // does is a thrown failure, so the play head is the only attribution available.
        const blockId = playHeadBlockId();
        host.reportIssue?.({
            level: "error",
            message: `${prefix}${errorMessage(error)}`,
            origin: blockId ? "playHead" : "session",
            ...(blockId ? { blockId } : {}),
            ...(errorStack(error) ? { stack: errorStack(error) } : {}),
        });
    }, [host, playHeadBlockId]);
    const textReadTrackerRef = useRef<TextReadTracker | null>(null);
    const preferenceSnapshotRef = useRef<Record<string, unknown>>({});
    const dispatchPreferenceChangeRef = useRef<
        ((key: string, value: unknown, previousValue: unknown) => void) | null
    >(null);
    /**
     * Host-side listeners on the preference stream, kept beside the blueprint `gamePreferenceChanged`
     * dispatch rather than folded into it: a widget that has to re-read a volume is not an authored
     * event and must not show up in the blueprint debug stream. Backs
     * `hostApi.sound.subscribeMixerChanges`, which is how the video widget follows a slider drag.
     */
    const preferenceListenersRef = useRef<Set<() => void>>(new Set());
    const subscribeGamePreferences = useCallback((listener: () => void) => {
        preferenceListenersRef.current.add(listener);
        return () => {
            preferenceListenersRef.current.delete(listener);
        };
    }, []);
    const currentDialogNametagRef = useRef<string | null>(null);
    const choiceRuntimeRef = useRef<ChoiceSlotRuntime | null>(null);
    const prefersReducedMotion = useReducedMotion();

    useEffect(() => {
        widgetPatchesByScopeRef.current = widgetPatchesByScope;
    }, [widgetPatchesByScope]);

    useEffect(() => {
        studioPageHiddenForGameRef.current = studioPageHiddenForGame;
    }, [studioPageHiddenForGame]);

    useEffect(() => {
        gameHiddenNavKeysRef.current = gameHiddenNavKeys;
    }, [gameHiddenNavKeys]);

    const createNavEntry = useCallback(
        (
            surfaceId: string,
            direction: PageAnimationNavigationDirection,
            waitForExit: boolean,
            props?: PageProps,
            presentation: SurfaceNavigationPresentation = "appPage",
        ): GameAppNavEntry => {
            navEntrySeqRef.current += 1;
            const key = `${surfaceId}:${navEntrySeqRef.current}`;
            return {
                key,
                runtimeScopeId: key,
                sessionKey: host.sessionKey,
                surfaceId,
                direction,
                waitForExit,
                props: clonePageProps(props),
                presentation,
            };
        },
        [host.sessionKey],
    );

    useEffect(() => {
        const surface = findSurface(bundle, host.entrySurfaceId);
        setPrepaintReadyKeys(new Set());
        setInteractionReadyKeys(new Set());
        navigation.reset(surface ? createNavEntry(surface.id, "forward", false) : null);
        layerStack.clear();
        widgetPatchesByScopeRef.current = {};
        setWidgetPatchesByScope({});
        gameHiddenNavKeysRef.current = new Set();
        setGameHiddenNavKeys(new Set());
        studioPageHiddenForGameRef.current = false;
        setStudioPageHiddenForGame(false);
        setGameStageVisible(false);
        // Navigation only. Everything here has to re-run on every bundle, hot reload included: nav
        // entries carry `host.sessionKey`, the visible-entry filter compares that against the
        // current one, and Dev Mode puts the revision in it - so entries stamped by the previous
        // revision are all filtered out, and re-stamping them is what keeps the stage drawn.
        //
        // Tearing down the NLR environment used to live here too. It does not any more: see the
        // effect directly below.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bundle, createNavEntry, host.entrySurfaceId, navigation]);

    /**
     * Tear the NLR environment down when the SESSION changes - and deliberately not when a hot
     * reload merely bumps the revision.
     *
     * Split out of the navigation reset above, because sharing that effect's `bundle` dependency is
     * what blanked a running Dev Mode on the author's first save. The sequence: a save bumps the
     * revision, the shared effect set `nlrPreloadDone` back to false, and nothing raised it again -
     * the boot effect is keyed on the session id, so it does not re-run for a reload, and the hot
     * reload path further down restarts the environment without touching that flag. The entire
     * surface stack renders behind it, so the game went blank and stayed blank until Dev Mode was
     * restarted, with no error raised anywhere. MEASURED: 6 saves out of 6 before this split, 0
     * after.
     *
     * Deps are the session, not a ref-compared signature, so this still re-runs on the
     * React.StrictMode mount/unmount/mount cycle the dev host uses: the throwaway mount's boot is
     * cancelled, this clears `nlrBootStartedRef`, and the real mount's boot runs to completion.
     */
    useEffect(() => {
        nlrBootStartedRef.current = null;
        gameReadyFiredRef.current = null;
        nlrLiveGameRef.current = null;
        nlrLiveGameSessionIdRef.current = null;
        stageWarmupRef.current = null;
        nlrCurrentActionTokenRef.current?.cancel();
        nlrCurrentActionTokenRef.current = null;
        currentActionIdRef.current = null;
        cancelSceneTracking();
        nlrCompiledRef.current = null;
        gameEnteredRef.current = false;
        setNlrPreloadDone(false);
        setNlrSession(null);
    }, [bundle.bundleId, host.entrySurfaceId]);

    const activeEntry = navStack[navStack.length - 1] ?? null;
    const activeSurface = activeEntry ? findSurface(bundle, activeEntry.surfaceId) : null;

    const scale = activeSurface ? getScale(activeSurface) : 1;

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

    const markActiveEnterComplete = useCallback(
        (entryKey: string) => {
            navigation.markEnterComplete(entryKey);
        },
        [navigation],
    );

    const handleSurfaceLayerPrepaintReady = useCallback((entryKey: string) => {
        markSurfacePrepaintReady(entryKey);
        navigation.markPrepaintReady(entryKey);
    }, [markSurfacePrepaintReady, navigation]);

    const handleSurfaceExitComplete = useCallback(() => {
        navigation.markAllExited();
    }, [navigation]);

    /**
     * Every layer that was leaving has left.
     *
     * This is what releases a queued layer of a mutually exclusive group, and what settles a
     * `Hide Layer`. Taken from the presence group rather than from a duration because the exit is
     * authored per page: a timer here would be wrong for every page whose animation someone retimes,
     * and wrong in the direction that shows two layers of one group at once. The layer itself is
     * what makes that safe to depend on - it bounds how long it waits for its own contents, so this
     * arrives whatever the page turns out to be holding (see `SurfaceAnimationLayer`).
     */
    const handleLayerExitComplete = useCallback(() => {
        layerStack.notifyExitComplete();
    }, [layerStack]);

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

    const isGameHiddenEntry = useCallback((entry: GameAppNavEntry | null | undefined): boolean => {
        return Boolean(entry && studioPageHiddenForGameRef.current && gameHiddenNavKeysRef.current.has(entry.key));
    }, []);

    const hideCurrentStudioPagesForGame = useCallback(() => {
        const hiddenKeys = new Set(navigation.getState().navStack.map(entry => entry.key));
        gameHiddenNavKeysRef.current = hiddenKeys;
        studioPageHiddenForGameRef.current = true;
        setGameHiddenNavKeys(hiddenKeys);
        setStudioPageHiddenForGame(true);
        resetSurfaceInteractionReadiness();
        navigation.hideAllForGame();
        // Layers are not serialised, so nothing about them survives a load, and the two callers of
        // this are exactly the moments the game takes the screen: starting a story and applying a
        // save. A layer left standing across either would belong to a run that no longer exists.
        layerStack.clear();
    }, [layerStack, navigation, resetSurfaceInteractionReadiness]);

    const clearGameHiddenStudioPages = useCallback(() => {
        const emptyKeys = new Set<string>();
        gameHiddenNavKeysRef.current = emptyKeys;
        studioPageHiddenForGameRef.current = false;
        setGameHiddenNavKeys(emptyKeys);
        setStudioPageHiddenForGame(false);
    }, []);

    const openSurface = useCallback((
        surfaceId: string,
        props?: PageProps,
        options?: OpenSurfaceOptions,
    ): Promise<void> => {
        const currentStack = navigation.getState().navStack;
        const currentEntry = currentStack[currentStack.length - 1] ?? null;
        const from = currentEntry ? findSurface(bundle, currentEntry.surfaceId) : null;
        const target = findSurface(bundle, surfaceId);
        if (!target) {
            return Promise.reject(new Error(`Open Page: surface not found: ${surfaceId}`));
        }
        const currentHiddenForGame = isGameHiddenEntry(currentEntry);
        const presentation = options?.presentation ?? (studioPageHiddenForGameRef.current ? "gameOverlay" : "appPage");
        resetSurfaceInteractionReadiness();
        return navigation.open({
            fromSurface: from,
            targetSurface: target,
            currentHiddenForGame,
            reducedMotion: prefersReducedMotion,
            elements: bundle.ui.uidoc.elements,
            createNextEntry: waitForExit => createNavEntry(target.id, "forward", waitForExit, props, presentation),
        });
    }, [
        bundle,
        createNavEntry,
        isGameHiddenEntry,
        navigation,
        prefersReducedMotion,
        resetSurfaceInteractionReadiness,
    ]);

    /**
     * Close down to `targetIndex` in one transition. `goBack` is this with the default index;
     * `clearPages` and `clearGameOverlay` name a lower one.
     */
    const closeToIndex = useCallback((targetIndex: number): Promise<void> => {
        const currentStack = navigation.getState().navStack;
        if (currentStack.length <= 1 || targetIndex >= currentStack.length - 1) {
            return Promise.resolve();
        }
        const nextEntryBase = currentStack[targetIndex]!;
        const currentEntry = currentStack[currentStack.length - 1]!;
        const from = findSurface(bundle, currentEntry.surfaceId);
        const target = findSurface(bundle, nextEntryBase.surfaceId);
        const targetHiddenForGame = isGameHiddenEntry(nextEntryBase);
        resetSurfaceInteractionReadiness();
        return navigation.close({
            fromSurface: from,
            targetSurface: target,
            targetHiddenForGame,
            reducedMotion: prefersReducedMotion,
            elements: bundle.ui.uidoc.elements,
            targetIndex,
        });
    }, [
        bundle,
        isGameHiddenEntry,
        navigation,
        prefersReducedMotion,
        resetSurfaceInteractionReadiness,
    ]);

    /**
     * Empty the page stack down to its root. This is what `Go Page` with no page selected means: the
     * dropdown offers "None", and choosing to show no page has to mean no page, not one page fewer.
     * The root itself stays - it is the title screen, or the entries the game hid when it started, and
     * an empty stack would render nothing at all.
     */
    const clearPages = useCallback((): Promise<void> => closeToIndex(0), [closeToIndex]);

    /**
     * Dismiss everything the player opened over a running game, and do nothing at all when no game is
     * running. The entries hidden when the game started are a prefix of the stack (they were the whole
     * stack at that moment), so the landing spot is the last one of those.
     */
    const clearGameOverlay = useCallback((): Promise<void> => {
        if (!studioPageHiddenForGameRef.current) {
            return Promise.resolve();
        }
        const currentStack = navigation.getState().navStack;
        let lastHidden = -1;
        for (let i = 0; i < currentStack.length; i++) {
            if (gameHiddenNavKeysRef.current.has(currentStack[i]!.key)) {
                lastHidden = i;
            }
        }
        if (lastHidden < 0) {
            return Promise.resolve();
        }
        return closeToIndex(lastHidden);
    }, [closeToIndex, navigation]);

    const goBackPage = useCallback((): Promise<void> => {
        const currentStack = navigation.getState().navStack;
        if (currentStack.length <= 1) {
            return Promise.resolve();
        }
        const nextEntryBase = currentStack[currentStack.length - 2]!;
        const currentEntry = currentStack[currentStack.length - 1]!;
        const from = findSurface(bundle, currentEntry.surfaceId);
        const target = findSurface(bundle, nextEntryBase.surfaceId);
        const targetHiddenForGame = isGameHiddenEntry(nextEntryBase);
        resetSurfaceInteractionReadiness();
        return navigation.close({
            fromSurface: from,
            targetSurface: target,
            targetHiddenForGame,
            reducedMotion: prefersReducedMotion,
            elements: bundle.ui.uidoc.elements,
        });
    }, [
        bundle,
        isGameHiddenEntry,
        navigation,
        prefersReducedMotion,
        resetSurfaceInteractionReadiness,
    ]);

    /**
     * Back, over the whole composite: close the top layer when that layer allows it, and otherwise do
     * exactly what Back has always done to the page stack.
     *
     * Only the top layer is consulted. One that refuses dismissal reports so and Back falls through
     * to the page lane, which is the behaviour with no layers at all.
     */
    const goBack = useCallback((): Promise<void> => {
        if (layerStack.dismissTop()) {
            return Promise.resolve();
        }
        return goBackPage();
    }, [goBackPage, layerStack]);

    /**
     * `Show Layer`. The owner is whichever surface asked, which is what makes the layer die with it.
     */
    const showLayer = useCallback((request: BlueprintLayerShowRequest): string => {
        return mountSurfaceLayer(layerStack, {
            surfaceId: request.surfaceId,
            props: request.props,
            modal: request.modal,
            dismissible: request.dismissible,
            group: request.group,
            ownerScopeId: request.ownerScopeId,
        });
    }, [layerStack]);

    const hideLayer = useCallback(async (handle: string): Promise<void> => {
        await layerStack.hideAndWaitForExit(handle);
    }, [layerStack]);

    const hideLayerGroup = useCallback(async (group: string): Promise<void> => {
        await layerStack.hideGroupAndWaitForExit(group);
    }, [layerStack]);

    const waitLayer = useCallback((handle: string): Promise<unknown> => {
        return layerStack.waitForClose(handle);
    }, [layerStack]);

    /**
     * `Close This Layer`. A layer's key IS its runtime scope id, so the graph's own scope is the
     * handle - which is why the page inside a layer never has to be told one.
     */
    const closeOwnLayer = useCallback((runtimeScopeId: string, result: unknown): boolean => {
        return layerStack.closeWithResult(runtimeScopeId, result);
    }, [layerStack]);

    const isLayerMounted = useCallback((handle: string): boolean => {
        return layerStack.isPresent(handle);
    }, [layerStack]);

    /**
     * A closing scope takes its layers with it.
     *
     * Subscribed to the execution manager rather than to a React unmount, because that one call is
     * where every surface's scope ends - a page navigated away from, a layer closed, a nested surface
     * inside a frame - and a layer left standing after the screen that showed it is exactly the
     * orphan this system is not allowed to produce. Cascades by itself: the layers dropped here
     * unmount, closing their own scopes, which brings this listener round again for anything they
     * showed in turn.
     */
    useEffect(() => {
        if (!core) {
            return;
        }
        return core.executionManager.subscribeScopeClosed(scopeId => {
            layerStack.hideOwnedBy(scopeId);
        });
    }, [core, layerStack]);

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
        pendingEnvReadyRef.current.forEach(pending => pending.reject(gameError));
        pendingEnvReadyRef.current.clear();
        // A warm-up that will never report in is *resolved*, not rejected: it is an optimisation,
        // and a superseded or broken preload must not stall a boot or a game start.
        pendingAssetsReadyRef.current.forEach(pending => pending.resolve());
        pendingAssetsReadyRef.current.clear();
    }, []);

    const clearCurrentDialogNametag = useCallback(() => {
        currentDialogNametagRef.current = null;
        core?.scopeBridge.globalSet(BLUEPRINT_GAME_NAMETAG_STATE_KEY, null);
        // Who was speaking and what colour that made the nametag are part of the same fact; leaving
        // either behind would tint a screen after the game they belonged to is gone.
        core?.scopeBridge.globalSet(BLUEPRINT_GAME_SPEAKER_CHARACTER_ID_STATE_KEY, null);
        core?.scopeBridge.globalSet(BLUEPRINT_GAME_SPEAKER_COLOR_STATE_KEY, null);
    }, [core]);

    const setChoiceRuntime = useCallback((runtime: ChoiceSlotRuntime | null): void => {
        choiceRuntimeRef.current = runtime;
    }, []);

    const detachTextReadTracker = useCallback(() => {
        textReadTrackerRef.current?.detach();
        textReadTrackerRef.current = null;
    }, []);

    const isCurrentTextReadInGame = useCallback((): boolean => {
        return textReadTrackerRef.current?.isCurrentTextRead() === true;
    }, []);

    /**
     * Has this specific line ever been read. Backs the voice EXTRA lock, since
     * the read set and the voice table share one key space (the line's textId).
     * No tracker means no game yet, which reads as "not read" rather than
     * throwing - an EXTRA screen opened from the title menu still lays out.
     */
    const hasReadTextInGame = useCallback((textId: string): boolean => {
        return textReadTrackerRef.current?.hasRead(textId) === true;
    }, []);

    const clearTextReadInGame = useCallback(async (): Promise<void> => {
        const tracker = textReadTrackerRef.current;
        if (tracker) {
            // The live tracker owns the write path; a direct wipe would race
            // its debounced persistence.
            tracker.clearAll();
            return;
        }
        if (!core) {
            throw new Error("Clear Text Read: runtime is not ready");
        }
        await core.scopeBridge.persistenceSet(BLUEPRINT_TEXT_READ_PERSISTENCE_KEY, []);
        core.scopeBridge.globalSet(BLUEPRINT_GAME_TEXT_READ_STATE_KEY, false);
    }, [core]);

    /**
     * The visited record, read straight off the live `Storable` (see `runtime/game/storyVisited`).
     *
     * Read rather than mirrored into global state, unlike the text-read flag next door: the record
     * only ever changes while the story runs, and a mirror would need a write beat on every scene
     * entry and every pick just to stay honest. Both callbacks resolve the namespace through the
     * CURRENT compile (`nlrCompiledRef`), because a recompile mints a new namespace name.
     *
     * No live game means no record, which reads as "not visited" rather than throwing - a title
     * screen asking whether a route is unlocked has to render before any game exists.
     */
    const readVisited = useCallback((key: StoryVisitedKey, id: string): boolean => {
        const liveGame = nlrLiveGameRef.current;
        const namespaceName = nlrCompiledRef.current?.visitedNamespaceName;
        if (!liveGame || !namespaceName || !id) {
            return false;
        }
        try {
            return isStoryVisited(liveGame.getStorable(), namespaceName, key, id);
        } catch {
            return false;
        }
    }, []);

    const isSceneVisitedInGame = useCallback((sceneId: string): boolean => {
        return readVisited(STORY_VISITED_SCENES_KEY, sceneId);
    }, [readVisited]);

    const isOptionPickedInGame = useCallback((optionId: string): boolean => {
        return readVisited(STORY_VISITED_OPTIONS_KEY, optionId);
    }, [readVisited]);

    const clearVisitedInGame = useCallback((): void => {
        const liveGame = nlrLiveGameRef.current;
        const namespaceName = nlrCompiledRef.current?.visitedNamespaceName;
        if (!liveGame || !namespaceName) {
            return;
        }
        try {
            const storable = liveGame.getStorable();
            if (!storable.hasNamespace(namespaceName)) {
                return;
            }
            // Emptied rather than `reset()`: reset restores the namespace's construction defaults,
            // which happen to be the same two empty arrays today, but tying "wipe" to "whatever the
            // defaults are" would quietly change meaning if a default were ever seeded.
            const namespace = storable.getNamespace(namespaceName);
            namespace.set(STORY_VISITED_SCENES_KEY, []);
            namespace.set(STORY_VISITED_OPTIONS_KEY, []);
        } catch {
            // A storable that refuses the write is not worth crashing a settings page over.
        }
    }, []);

    /**
     * Carrying a playthrough between two editions of one title - the Export/Import Progress nodes.
     *
     * A demo and the full game are separate packages with separate app ids, so they keep separate
     * save directories and cannot read each other's files. What crosses is one plain JSON document,
     * written and read by whichever shell is running (see `@shared/types/gameProgress`); this side
     * only decides WHAT the playthrough holds and what an arriving document does to it.
     */

    /** Which story document is running, resolved the way `compileStoryRequest` resolves it. */
    const resolveRunningStoryDocument = useCallback(() => {
        const storyId = activeStoryRequestRef.current?.storyId;
        if (!storyId) {
            return undefined;
        }
        return bundle.storyLibrary?.documents[storyId]
            ?? Object.values(bundle.storyLibrary?.documents ?? {}).find(document => document.id === storyId);
    }, [bundle]);

    /**
     * Every project-level variable this build declares, merged exactly as the editors merge them:
     * the registry baked into the bundle plus the running story's own `/save` and `/persis` rows.
     * Reading either surface alone would silently drop half an author's variables.
     */
    const progressVariableDefs = useCallback((): {
        saved: GameProgressVariableDef[];
        persistent: GameProgressVariableDef[];
    } => {
        const storyDocument = resolveRunningStoryDocument();
        return {
            saved: Object.values({
                ...(storyDocument ? savedVariableDefs(storyDocument) : {}),
                ...bundle.ui.savedVariables,
            }),
            persistent: Object.values({
                ...(storyDocument ? storyPersistentDefs(storyDocument) : {}),
                ...bundle.ui.persistentVariables,
            }),
        };
    }, [bundle, resolveRunningStoryDocument]);

    /** One saved value off the live store, or `undefined` when the playthrough never wrote it. */
    const readSavedProgressValue = useCallback((storageKey: string): unknown => {
        const liveGame = nlrLiveGameRef.current;
        const namespaceName = nlrCompiledRef.current?.savedNamespaceName;
        if (!liveGame || !namespaceName) {
            return undefined;
        }
        const storable = liveGame.getStorable();
        if (!storable.hasNamespace(namespaceName)) {
            return undefined;
        }
        const namespace = storable.getNamespace(namespaceName);
        return namespace.has(storageKey) ? namespace.get(storageKey) : undefined;
    }, []);

    /**
     * The saved half of an arriving document, written into the live store.
     *
     * Separate from the import call because of when it has to run: an import made before `Start
     * Game` has to wait for the `newGame()` that would otherwise wipe it. Same code, two moments.
     */
    const applyImportedSavedProgress = useCallback((document: GameProgressDocumentV1): void => {
        const liveGame = nlrLiveGameRef.current;
        const compiled = nlrCompiledRef.current;
        if (!liveGame || !compiled) {
            return;
        }
        const storable = liveGame.getStorable();
        const savedNamespaceName = compiled.savedNamespaceName;
        if (savedNamespaceName && storable.hasNamespace(savedNamespaceName)) {
            const namespace = storable.getNamespace(savedNamespaceName);
            applyGameProgressVariables(
                progressVariableDefs().saved,
                document.savedVariables,
                (storageKey, value) => namespace.set(storageKey, value as never),
            );
        }
        const visitedNamespaceName = compiled.visitedNamespaceName;
        if (visitedNamespaceName && document.visitedSceneIds.length > 0 && storable.hasNamespace(visitedNamespaceName)) {
            const merged = mergeVisitedSceneIds(
                readStoryVisitedIds(storable, visitedNamespaceName, STORY_VISITED_SCENES_KEY),
                document.visitedSceneIds,
            );
            // A new array, never a push: `Namespace.set` compares what it is handed against what it
            // holds, and mutating the stored array in place would make both sides the same object.
            storable.getNamespace(visitedNamespaceName).set(STORY_VISITED_SCENES_KEY, merged);
        }
    }, [progressVariableDefs]);

    /**
     * Put a save's saved-scope values into the story that has just been started again.
     *
     * The whole namespace rather than the project's declared variables: a story's own `/save` rows
     * declare saved variables too, and a player relaunched into their chapter with half their flags
     * would be in a state no playthrough could have produced. Read straight off the serialized
     * store, which is where a load would have read it from as well.
     */
    const applyCarriedSaveState = useCallback((savedGame: SavedGame): void => {
        const liveGame = nlrLiveGameRef.current;
        const compiled = nlrCompiledRef.current;
        if (!liveGame || !compiled) {
            return;
        }
        const store = (savedGame as unknown as { game?: { store?: Record<string, unknown> } }).game?.store;
        if (!store || typeof store !== "object") {
            return;
        }
        const storable = liveGame.getStorable();
        const savedNamespaceName = compiled.savedNamespaceName;
        const savedValues = savedNamespaceName ? store[savedNamespaceName] : undefined;
        if (savedNamespaceName && savedValues && typeof savedValues === "object" && storable.hasNamespace(savedNamespaceName)) {
            const namespace = storable.getNamespace(savedNamespaceName);
            // Unwrapped first. A save holds `{type, data, dates?, undefineds?}` per value, and
            // `set` takes the value - handing it the wrapper stores an object where the author
            // declared a boolean, which reads back as truthy-but-not-true and quietly sends every
            // condition down its other branch. See `readWrappedStorableValue`.
            for (const [key, value] of Object.entries(readWrappedStorableNamespace(savedValues))) {
                namespace.set(key, value as never);
            }
        }
        const visitedNamespaceName = compiled.visitedNamespaceName;
        const visitedValues = visitedNamespaceName ? store[visitedNamespaceName] : undefined;
        const visited = visitedValues && typeof visitedValues === "object"
            ? readWrappedStorableValue((visitedValues as Record<string, unknown>)[STORY_VISITED_SCENES_KEY])
            : undefined;
        if (visitedNamespaceName && Array.isArray(visited) && storable.hasNamespace(visitedNamespaceName)) {
            const merged = mergeVisitedSceneIds(
                readStoryVisitedIds(storable, visitedNamespaceName, STORY_VISITED_SCENES_KEY),
                visited.filter((id): id is string => typeof id === "string"),
            );
            // A new array, never a push - see `applyImportedSavedProgress`.
            storable.getNamespace(visitedNamespaceName).set(STORY_VISITED_SCENES_KEY, merged);
        }
    }, []);

    const exportProgressInGame = useCallback(async (): Promise<{ outcome: "written" | "failed"; error: string }> => {
        if (!host.exportProgress) {
            return {
                outcome: "failed",
                error: "Progress cannot be written here. Run the project in Dev Mode to carry it.",
            };
        }
        const defs = progressVariableDefs();
        const storyDocument = resolveRunningStoryDocument();
        const liveGame = nlrLiveGameRef.current;
        const compiled = nlrCompiledRef.current;
        // No running story is a legitimate export rather than an error: a player may have
        // persistent variables worth carrying and no playthrough in progress. That exports the
        // persistent half and anchors nowhere.
        const savedVariables = liveGame && compiled?.savedNamespaceName
            ? await collectGameProgressVariables(defs.saved, readSavedProgressValue)
            : {};
        const persistentVariables = core
            ? await collectGameProgressVariables(defs.persistent, key => core.scopeBridge.persistenceGetAsync(key))
            : {};
        const anchorSceneId = currentSceneIdRef.current
            ?? (gameEnteredRef.current ? activeStoryRequestRef.current?.sceneId ?? null : null);
        const anchor: GameProgressAnchor | null = anchorSceneId
            ? {
                sceneId: anchorSceneId,
                // The same expression the compiler names the engine scene with, read off the story
                // document rather than off the `Scene`: the engine exposes no name accessor, and
                // nothing resolves a scene by this - it is here so the file reads.
                sceneRuntimeName: storyDocument?.scenes[anchorSceneId]?.runtimeName
                    || storyDocument?.scenes[anchorSceneId]?.name
                    || anchorSceneId,
            }
            : null;
        const visitedSceneIds = liveGame && compiled?.visitedNamespaceName
            ? readStoryVisitedIds(liveGame.getStorable(), compiled.visitedNamespaceName, STORY_VISITED_SCENES_KEY)
            : [];
        const result = await host.exportProgress({
            storyId: activeStoryRequestRef.current?.storyId ?? "",
            savedVariables,
            persistentVariables,
            anchor,
            visitedSceneIds,
        });
        return result.outcome === "written"
            ? { outcome: "written", error: "" }
            : { outcome: "failed", error: result.error };
    }, [core, host, progressVariableDefs, readSavedProgressValue, resolveRunningStoryDocument]);

    const importProgressInGame = useCallback(async (): Promise<GameProgressImportOutcome> => {
        if (!host.importProgress) {
            return {
                outcome: "failed",
                sceneId: "",
                error: "Progress cannot be read here. Run the project in Dev Mode to carry it.",
            };
        }
        const result = await host.importProgress();
        if (result.outcome !== "found") {
            return { outcome: result.outcome, sceneId: "", error: result.error ?? "" };
        }
        const imported = result.document;
        // Persistent first and unconditionally: those values live outside the engine, so they are
        // already correct whether or not a story ever starts, and `newGame()` does not touch them.
        if (core) {
            applyGameProgressVariables(
                progressVariableDefs().persistent,
                imported.persistentVariables,
                (storageKey, value) => {
                    void core.scopeBridge.persistenceSet(storageKey, value);
                },
            );
        }
        if (gameEnteredRef.current && nlrLiveGameRef.current) {
            applyImportedSavedProgress(imported);
        } else {
            // See `pendingImportedProgressRef`: the `Start Game` this node's scene id feeds calls
            // `newGame()`, which would clear anything written now.
            pendingImportedProgressRef.current = imported;
        }
        return toImportOutcome(imported);
    }, [applyImportedSavedProgress, core, host, progressVariableDefs]);

    /**
     * Surface a failed save screenshot to the Blueprint console. Capture is best-effort — the save
     * still succeeds without a preview — but staying silent made a requested capture look like the
     * Save Game node was ignoring its Capture pin.
     */
    const reportSaveCaptureFailure = useCallback((id: string, reason: string): void => {
        const message = `Save Game: screenshot capture failed for "${id}": ${reason}`;
        core?.debug.emit({ type: "devtools.log", level: "warn", message });
        host.log("warning", message);
    }, [core, host.log]);

    const setNlrDialogVirtualClickTarget = useCallback((target: HTMLElement | null): void => {
        nlrDialogVirtualClickTargetRef.current = target;
    }, []);

    // Read through the *mounted* session's compile, never a captured one: a recompile mints new
    // avatar URLs, and an inverse from the previous compile would answer with a stale asset id.
    const resolveAvatarAssetId = useCallback(
        (url: string): string | null => nlrCompiledRef.current?.avatarAssetIdByUrl.get(url) ?? null,
        [],
    );

    /** The dub language in force: the player's stored choice when the game ships that language, else the first. */
    const readVoiceLocale = useCallback((): string => {
        const voice = bundle.voice;
        if (!voice || !core) {
            return "";
        }
        const stored = core.scopeBridge.persistenceGet(VOICE_LOCALE_STORAGE_KEY);
        if (typeof stored === "string" && stored && voice.voicedLocales.some(entry => entry.code === stored)) {
            return stored;
        }
        return voice.voicedLocales[0]?.code ?? "";
    }, [bundle.voice, core]);

    /**
     * A dub-language change re-points the takes on the running game.
     *
     * The compile carries every language's table and every scene shares one voices object, so this is
     * a repopulate rather than a recompile: the next spoken line plays the new language, which is the
     * same rule a text-language switch follows. Before this, `nls.voiceLocale` was read once at
     * compile time and nothing in a shipped game could change it - a project could author a second
     * dub, ship its audio, and never play a second of it.
     */
    useEffect(() => {
        if (!core || !bundle.voice) {
            return;
        }
        let applied = readVoiceLocale();
        return core.scopeBridge.subscribePersistence(() => {
            const next = readVoiceLocale();
            if (next === applied) {
                return;
            }
            if (nlrCompiledRef.current?.setVoiceLocale?.(next)) {
                applied = next;
            }
        });
    }, [core, bundle.voice, readVoiceLocale]);

    const {
        getCurrentNametag,
        getNotificationsInGame,
        getFutureInGame,
        getHistoryInGame,
        canRedoHistoryInGame,
        canUndoHistoryInGame,
        redoHistoryInGame,
        restoreHistoryInGame,
        getChoiceCountInGame,
        isNvlModeInGame,
        selectChoiceInGame,
        nextInGame,
        skipInGame,
        showDialogInGame,
        hideDialogInGame,
        toggleDialogDisplayInGame,
        setSentenceSpeedInGame,
        getGamePreferenceInGame,
        setGamePreferenceInGame,
    } = useMemo(() => createLiveGameUiCallbacks({
        requireLiveGame: requireActiveLiveGame,
        getLiveGame: () => nlrLiveGameRef.current,
        choiceRuntimeRef,
        currentDialogNametagRef,
        dialogVirtualClickTargetRef: nlrDialogVirtualClickTargetRef,
    }), [requireActiveLiveGame]);

    /**
     * Backs the blueprint `sound` family. Built once per host and ref-backed, so
     * its identity is stable across relaunches; it reads the live game through
     * the ref and degrades to a warned no-op when there is none.
     *
     * `Sound.sound` vs the per-bus constructors: the resolved bus id is passed as
     * `type` so the engine routes it into that bus's gain node, which is what
     * makes the player's mixer apply. `Sound.bgm()` is deliberately not used -
     * the engine blocks `play()` on a bgm-typed element, and the token path here
     * is the other one.
     */
    const soundTransport = useMemo(() => createSoundTransport({
        getLiveGame: () => nlrLiveGameRef.current,
        resolveAssetUrl: (assetId, assetType) => host.resolveStoryAssetUrl(assetId, assetType),
        // The bus and the loop default a play inherits. Absent on a bundle that predates tracks,
        // which the transport reads as the built-ins.
        getAudioTracks: () => bundle.audio?.tracks,
        // The in/out points the author marked on the asset apply here exactly as they do in a story
        // row, so a music page loops a track's body rather than the whole file.
        createSound: ({ src, busId, loop, volume, assetId }) => new Sound({
            src,
            // An arbitrary bus id, not one of three enum members: the tracks declared at boot are
            // the buses, so `voice/alice` routes here with nothing to map it through.
            type: busId,
            loop,
            volume,
            ...audioClipRegionToSoundConfig(bundle.audio?.clips?.[assetId]),
        }),
        log: (level, message) => host.log(level, message),
    }), [bundle, host]);

    useEffect(() => () => soundTransport.dispose(), [soundTransport]);

    /**
     * Replay one line's take in the dub language currently in force.
     *
     * A fresh `Sound` per replay rather than the scene table's instance: the audio manager keys a
     * playing token by instance, so reusing it would fight with the line that is still on screen.
     * The bus comes from the compile, so a per-character voice bus - and the player's fader for it -
     * applies to a replay exactly as it does to the line itself.
     */
    const playVoiceUnit = useCallback(async (unitId: string): Promise<boolean> => {
        const liveGame = nlrLiveGameRef.current;
        const playback = unitId ? nlrCompiledRef.current?.getVoicePlayback?.(unitId) : null;
        if (!liveGame || !playback) {
            return false;
        }
        try {
            await liveGame.playSound(new Sound({ src: playback.src, type: playback.busId }));
            return true;
        } catch (error) {
            host.log("warning", `Play Voice: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }, [host]);

    // Mount-scoped, not session-scoped: each mount replaces the previous subscription itself, and
    // this is only the last one, on the way out.
    useEffect(() => () => {
        audioBusPersistenceRef.current?.();
        audioBusPersistenceRef.current = null;
        playerPreferencesRef.current?.();
        playerPreferencesRef.current = null;
    }, []);

    const fastForwardToNextChoiceInGame = useCallback(async (): Promise<void> => {
        const liveGame = requireActiveLiveGame("Skip To Next Choice");
        await fastForwardToNextChoice(liveGame, choiceRuntimeRef);
    }, [requireActiveLiveGame]);

    // Read/write bridge over the running story runtime for the Dev Mode story-runtime panel. Fully
    // ref-backed so its identity is stable across renders and relaunches; every method degrades to
    // null / no-op / reject when no game is running.
    const storyRuntime = useMemo<GameAppStoryRuntimeBridge>(() => ({
        getStoryContext: () => {
            const request = activeStoryRequestRef.current;
            return request
                ? {
                    storyId: request.storyId,
                    sceneId: request.sceneId,
                    startBlockId: request.startBlockId,
                    snapshotId: request.snapshotId,
                }
                : null;
        },
        getActionIdBindings: () => nlrCompiledRef.current?.actionIdBindings ?? [],
        getVariableNamespaces: () => ({
            saved: nlrCompiledRef.current?.savedNamespaceName || null,
            visited: nlrCompiledRef.current?.visitedNamespaceName || null,
            sceneLocal: nlrCompiledRef.current?.sceneLocalNamespaceNames ?? {},
        }),
        getCurrentActionId: () => currentActionIdRef.current,
        subscribeCurrentAction: listener => {
            currentActionListenersRef.current.add(listener);
            return () => {
                currentActionListenersRef.current.delete(listener);
            };
        },
        getStackSnapshot: () => {
            const liveGame = nlrLiveGameRef.current;
            if (!liveGame) {
                return null;
            }
            try {
                return liveGame.getStackSnapshot();
            } catch {
                return null;
            }
        },
        readStorableNamespace: name => {
            const liveGame = nlrLiveGameRef.current;
            if (!liveGame || !name) {
                return null;
            }
            try {
                const storable = liveGame.getStorable();
                if (!storable.hasNamespace(name)) {
                    return null;
                }
                const namespace = storable.getNamespace(name);
                const values: Record<string, unknown> = {};
                for (const [key, value] of namespace.entries()) {
                    values[String(key)] = value;
                }
                return values;
            } catch {
                return null;
            }
        },
        writeStorableValue: (name, key, value) => {
            const liveGame = nlrLiveGameRef.current;
            if (!liveGame || !name) {
                return false;
            }
            try {
                const storable = liveGame.getStorable();
                if (!storable.hasNamespace(name)) {
                    return false;
                }
                storable.getNamespace(name).set(key, value as never);
                return true;
            } catch {
                return false;
            }
        },
        getPlayedBlockTokens: () => {
            const liveGame = nlrLiveGameRef.current;
            const bindings = nlrCompiledRef.current?.actionIdBindings;
            if (!liveGame || !bindings?.length) {
                return {};
            }
            try {
                // Backlog entries carry the very Action object the compiler bound, so the block is
                // resolved by identity — no id parsing, and immune to a story compiled with more
                // than one copy of a scene (a row-precise launch compiles the entry scene twice).
                // Keyed by identity, so the map is typed by reference rather than by the binding's
                // narrower Action union (the backlog hands back the base `Action`).
                const blockByAction = new Map<unknown, string>(
                    bindings.map(binding => [binding.action, binding.blockId]),
                );
                const tokens: Record<string, string> = {};
                for (const entry of liveGame.getHistory()) {
                    const blockId = blockByAction.get(entry.action);
                    // A pending line is still being played; it has no usable restore snapshot yet.
                    if (!blockId || entry.isPending === true || entry.snapshot == null || !entry.token) {
                        continue;
                    }
                    // Last write wins: a re-entered row restores to its most recent visit.
                    tokens[blockId] = entry.token;
                }
                return tokens;
            } catch {
                return {};
            }
        },
        restoreToHistoryToken: token => {
            const liveGame = nlrLiveGameRef.current;
            if (!liveGame) {
                return false;
            }
            try {
                return restoreLiveGameToHistory(liveGame, token);
            } catch {
                return false;
            }
        },
        relaunch: async ({ sceneId, startBlockId, snapshotId }) => {
            const request = activeStoryRequestRef.current;
            if (!request) {
                throw new Error("Relaunch: no active story");
            }
            const start = startStoryInGameRef.current;
            if (!start) {
                throw new Error("Relaunch: runtime is not ready");
            }
            await start(
                { storyId: request.storyId, sceneId: sceneId ?? request.sceneId, startBlockId, snapshotId },
                { forceReinit: true },
            );
        },
    }), []);

    const quitGame = useCallback(async (surfaceId: string): Promise<void> => {
        const targetSurfaceId = String(surfaceId ?? "").trim();
        if (!targetSurfaceId) {
            throw new Error("Quit Game: surfaceId is required");
        }
        rejectPendingGameStarts(new NlrSessionSupersededError("Quit Game"));
        activeStoryRequestRef.current = null;
        activeStoryRevisionRef.current = null;
        gameEnteredRef.current = false;
        nlrCharacterPromptTokenRef.current?.cancel();
        nlrCharacterPromptTokenRef.current = null;
        nlrPreferenceTokenRef.current?.cancel();
        nlrPreferenceTokenRef.current = null;
        nlrCurrentActionTokenRef.current?.cancel();
        nlrCurrentActionTokenRef.current = null;
        currentActionIdRef.current = null;
        cancelSceneTracking();
        nlrCompiledRef.current = null;
        clearCharacterAvatarAssets();
        detachTextReadTracker();
        preferenceSnapshotRef.current = {};
        nlrDialogVirtualClickTargetRef.current = null;
        gameReadyFiredRef.current = null;
        nlrLiveGameRef.current = null;
        nlrLiveGameSessionIdRef.current = null;
        stageWarmupRef.current = null;
        choiceRuntimeRef.current = null;
        clearCurrentDialogNametag();
        setGameStageVisible(false);
        await openSurface(targetSurfaceId, undefined, { presentation: "appPage" });
        setNlrSession(null);
        clearGameHiddenStudioPages();
    }, [clearCurrentDialogNametag, clearGameHiddenStudioPages, detachTextReadTracker, openSurface, rejectPendingGameStarts]);

    /**
     * The story ran out of rows, and this build declares a page to land on.
     *
     * Routed through `quitGame` rather than through a navigation of its own, because ending a story
     * and quitting one are the same act as far as everything downstream is concerned: the session
     * has to be torn down, the tokens cancelled, the stage hidden and the surface stack put back on
     * an app page. A second path would be a second place for one of those to be forgotten.
     *
     * Nothing at all happens when the host declares no page. That is deliberate and is exactly the
     * behaviour every build had before the ending page existed: the last frame stays on screen. A
     * default screen here would be one nobody authored, shown to players of projects that never
     * asked for it.
     */
    const endingSurfaceId = host.endingSurfaceId?.trim() ?? "";
    const handleStoryEnd = useCallback(() => {
        if (!endingSurfaceId) {
            return;
        }
        void quitGame(endingSurfaceId).catch(error => {
            // Reported rather than thrown: the story is over either way, and a page that will not
            // open must not take the window down with it.
            host.log("error", `[${host.id}] the ending page could not be opened: ${normalizeError(error)}`);
        });
    }, [endingSurfaceId, host, quitGame]);

    /**
     * What this build stamps into the saves it writes, and compares the saves it is asked to load
     * against. One value for both halves: a stamp written by one rule and read by another would
     * make a build disagree with its own saves.
     *
     * Null when the bundle carries no story hash - a bundle assembled before hashes existed - which
     * turns every comparison into "cannot be compared" and leaves loading exactly as it was.
     */
    const saveStamp = useMemo(
        () => (bundle.storyHash
            ? buildSaveCompatibilityStamp({ storyHash: bundle.storyHash, gameVersion: bundle.gameVersion })
            : null),
        [bundle.gameVersion, bundle.storyHash],
    );
    const saveCompatibilityConfig = useMemo(
        () => normalizeSaveCompatibilityConfiguration(bundle.saveCompatibility),
        [bundle.saveCompatibility],
    );
    const writeSave = useCallback(async (id: string, metadata?: unknown, screenshot?: boolean) => {
        const liveGame = requireActiveLiveGame("Save Game");
        let capture: string | undefined;
        if (screenshot === true) {
            if (typeof liveGame.capturePng !== "function") {
                reportSaveCaptureFailure(id, "the game runtime does not support capturePng");
            } else {
                try {
                    capture = await liveGame.capturePng();
                } catch (error) {
                    // The save itself still goes through — a failed preview must not lose progress.
                    reportSaveCaptureFailure(id, normalizeError(error));
                }
            }
        }
        await host.saveStore.write(
            id,
            liveGame.serialize(),
            capture,
            metadata,
            saveStamp ?? undefined,
            playtime.getRunSeconds(),
        );
        // Host-side, after the write landed: every shell reports it the same way,
        // and a failed write never announces a save that does not exist.
        pluginHost?.emitSaveWritten(id);
    }, [
        host.saveStore,
        playtime,
        pluginHost,
        reportSaveCaptureFailure,
        requireActiveLiveGame,
        saveStamp,
    ]);

    /**
     * The scene a save's position names, as this build ships it.
     *
     * The story id the position carries is only a hint: it comes out of an anchor written by
     * another build, which may have split or renamed its documents. It is tried first and the
     * library is searched when it does not hold the scene, so a save survives a story being moved
     * between documents. Null when no document in this build has that scene at all.
     */
    const resolveSavedScene = useCallback((storyId: string, sceneId: string): {
        storyId: string;
        scene: { blocks?: Record<string, unknown> };
    } | null => {
        const documents = bundle.storyLibrary?.documents;
        if (!documents || !sceneId) {
            return null;
        }
        const named = storyId ? documents[storyId] : undefined;
        if (named?.scenes?.[sceneId]) {
            return { storyId, scene: named.scenes[sceneId] };
        }
        for (const [candidateId, document] of Object.entries(documents)) {
            if (document?.scenes?.[sceneId]) {
                return { storyId: candidateId, scene: document.scenes[sceneId] };
            }
        }
        return null;
    }, [bundle.storyLibrary]);

    /**
     * Load a save, or leave the run that is going exactly where it is.
     *
     * Resolves either way and says which happened. Reaching for the outcome rather than a throw is
     * what lets the Saves panel report a refusal precisely; `loadSaveAction` turns the same outcome
     * back into a rejection for the two surfaces whose callers are written against one. It still
     * throws outright when there is no game runtime, which is a caller mistake rather than an
     * outcome of loading.
     */
    const loadSave = useCallback(async (id: string): Promise<SaveLoadOutcome> => {
        const liveGame = requireActiveLiveGame("Load Save");

        // Captured on the way past rather than re-read afterwards: a save record carries a whole
        // serialized playthrough, and reading one twice to look at one number would double the
        // cost of every load.
        let storedPlaytimeSeconds: number | undefined;
        const outcome = await loadSaveIntoGame({
            id,
            readRecord: async () => {
                const record = await host.saveStore.read(id);
                storedPlaytimeSeconds = readSavePlaytimeSeconds(record?.metadata.playtimeSeconds);
                return record;
            },
            currentStamp: saveStamp,
            compatibilityConfig: saveCompatibilityConfig,
            game: {
                // `constructMaps` is the engine's own lookup table for a load and caches on the
                // live game, so checking against it is checking against exactly what `deserialize`
                // is about to read. It carries no type in the published surface, so what comes
                // back is checked rather than assumed: the name surviving says nothing about the
                // shape, and a table read as empty would answer "not in this story" for every id
                // and refuse every save. Anything unexpected leaves the snapshot as the only
                // protection instead.
                resolveStoryMaps: () => {
                    const construct = (liveGame as unknown as {
                        constructMaps?: () => unknown;
                    }).constructMaps;
                    if (typeof construct !== "function") {
                        return null;
                    }
                    const tables = construct.call(liveGame);
                    if (!Array.isArray(tables) || tables.length < 2) {
                        return null;
                    }
                    const [actions, elements] = tables as unknown[];
                    if (!(actions instanceof Map) || !(elements instanceof Map)) {
                        return null;
                    }
                    return {
                        hasAction: actionId => actions.has(actionId),
                        hasElement: elementId => elements.has(elementId),
                    };
                },
                readStoryHash: () => liveGame.story?.hash() ?? null,
                snapshot: () => liveGame.serialize(),
                apply: savedGame => {
                    liveGame.game.router.clear().cleanHistory();
                    liveGame.newGame().deserialize(savedGame);
                },
                restore: snapshot => liveGame.deserialize(snapshot),
                // `deserialize` takes this lock on the way in and gives it back from a render it
                // schedules on the way out, so a throw in between keeps it. It is a flag, not a
                // count, which is why one balanced load afterwards cannot clear it and every later
                // load in the session would sit there locked.
                releaseLoadLock: () => liveGame.getGameState()?.rollLock.unlock(),
                /**
                 * The `Return to where it stopped` policy: a story launch, not a load.
                 *
                 * `forceReinit` is passed because the fast path in `startStoryInGame` skips the
                 * recompile when the mounted story already matches the request - which is exactly
                 * the case here, and exactly the case where reusing the mounted session would drop
                 * the row the player is being put back on.
                 */
                relaunch: async target => {
                    const start = startStoryInGameRef.current;
                    if (!start) {
                        throw new Error("the story cannot be started here");
                    }
                    const found = resolveSavedScene(target.storyId, target.sceneId);
                    // Reported rather than thrown: nothing has been touched yet, and a throw here
                    // would be read as a run that was spent halfway.
                    if (!found) {
                        return "nowhere";
                    }
                    // Asked before launching, never inferred from a failure: a launch handed a row
                    // that is gone plays the scene from the top and says nothing (see
                    // `collectStoryPlaybackPlan`), so waiting for a throw would report every
                    // degraded landing as a row-precise one.
                    const hasRow = Boolean(target.blockId && found.scene.blocks?.[target.blockId]);
                    // Queued rather than written: the launch calls `newGame()`, which clears every
                    // namespace, so values written now would be the ones it wipes.
                    pendingCarriedSaveRef.current = target.savedGame;
                    try {
                        await start({
                            storyId: found.storyId,
                            sceneId: target.sceneId,
                            ...(hasRow && target.blockId ? { startBlockId: target.blockId } : {}),
                        }, { forceReinit: true });
                    } catch (error) {
                        pendingCarriedSaveRef.current = null;
                        throw error;
                    }
                    return hasRow ? "row" : "scene";
                },
            },
            // The engine's notification channel, which draws through the project's Notifications
            // surface when it has one and the engine's own component when it does not.
            //
            // It draws inside the Player, and `NlrStageLayer` puts the whole Player behind
            // `visibility: hidden` until the host reveals the stage. A refusal raised while the
            // stage is hidden is therefore queued into a hidden layer and times out unseen. That is
            // every load that fails before the stage has ever been shown; a load from an in-game
            // menu drawn over a visible stage is seen.
            notifyPlayer: message => liveGame.notify(message, SAVE_LOAD_NOTICE_DURATION_MS),
            report: (level, message) => {
                host.log(level, message);
                host.reportIssue?.({ level, message, origin: "session" });
            },
        });
        if (outcome.status !== "loaded") {
            return outcome;
        }
        // A relaunch has already entered and revealed its own session (that is what `Start Game`
        // does); the live game this closure captured is the one it replaced. Waiting on it here
        // would wait on a session nobody is driving any more.
        if (outcome.applied !== "save") {
            return outcome;
        }
        // Only here: a load that was refused or rolled back leaves the player on the run they were
        // already having, and that run's stopwatch has to keep its own reading. A record with no
        // reading (written before playtime was tracked) starts the inherited run from zero, which
        // is the only honest answer when nobody was counting.
        playtime.seedRun(storedPlaytimeSeconds ?? 0);
        gameEnteredRef.current = true;
        /**
         * Let the page the player was on finish leaving before the stage is revealed - but never
         * wait on one that is not there.
         *
         * The wait is for the NEXT exit-complete event, which the load's own `router.clear()`
         * produces only when a page was open. Every load the product shipped with came from one (a
         * save screen, a title screen), so the event always arrived. A load taken with the stage
         * already on screen and nothing over it produces no exit at all, and an unbounded wait then
         * never returns: the save IS applied and the player is back where they were, while
         * everything after this line - the reveal, and whatever the caller meant to do next - simply
         * never happens. MEASURED: resuming after a language restart left the parked save on disk
         * for exactly this reason, on a run that had otherwise gone perfectly.
         *
         * A deadline rather than a check for an open page, because the failure is the same shape
         * whatever caused it: an exit that does not arrive must not strand the caller.
         */
        await withDeadline(liveGame.waitForRouterExit().promise, SAVE_LOAD_ROUTER_EXIT_TIMEOUT_MS);
        setGameStageVisible(true);
        hideCurrentStudioPagesForGame();
        return outcome;
    }, [
        hideCurrentStudioPagesForGame,
        host.log,
        host.reportIssue,
        host.saveStore,
        requireActiveLiveGame,
        resolveSavedScene,
        saveCompatibilityConfig,
        saveStamp,
    ]);

    /**
     * The same load for the surfaces declared as `Promise<void>`: the blueprint host API and the
     * plugin save API.
     *
     * It rejects on a refusal, which is what those two have always done and what any caller with a
     * `catch` around them is written against. Nothing is at stake by the time it throws - the
     * player has been told, the author has been told, and the run is where it was - so the throw
     * carries information and no longer carries a destroyed game with it.
     */
    const loadSaveAction = useCallback(async (id: string): Promise<void> => {
        const outcome = await loadSave(id);
        if (outcome.status === "refused") {
            throw new Error(`Load Save: "${id}" was not applied. ${outcome.detail}`);
        }
    }, [loadSave]);

    /**
     * The same load for a graph, which hears a refusal as a branch rather than as an error.
     *
     * `Load Save` carries a `Failed` pin, and a refusal is the ordinary end of asking for an old
     * save: the player has been told, the author has been told, and the run is where it was. A
     * throw here would put a red error in front of an author whose title screen is already handling
     * the case. Anything that is a caller mistake - no game runtime - still throws, from `loadSave`.
     */
    const loadSaveForGraph = useCallback(async (id: string): Promise<boolean> => {
        return (await loadSave(id)).status === "loaded";
    }, [loadSave]);

    const deleteSave = useCallback(async (id: string) => {
        await host.saveStore.remove(id);
    }, [host.saveStore]);

    /**
     * Report a language-restart step to both channels a host has, on one call.
     *
     * Everything this reports is a failure the author has to be able to see, and Dev Mode's issues
     * panel only shows what comes through `reportIssue`. `session` is the honest origin: none of it
     * happens while a story row is running - the player is in a menu - so there is no row to blame.
     */
    const reportLocaleRestart = useCallback((level: GameAppLogLevel, message: string) => {
        host.log(level, `[${host.id}] ${message}`);
        if (level !== "info") {
            host.reportIssue?.({ level, message, origin: "session" });
        }
    }, [host]);

    /**
     * The player picked a language. Everything that makes that more than a stored string.
     *
     * See `localeRestart` for why a running playthrough is restarted rather than told: the language
     * is already inside the rendered text, the backlog, the sentence being typed, the voice under
     * it and the assets held for the scene, and none of those can be rewritten in place. Nothing
     * happens at all on a title screen or a settings page opened before a run started, which is
     * where most players change it.
     */
    const handleLocaleChanged = useCallback(async (): Promise<void> => {
        await applyLocaleChange({
            isPlaythroughRunning,
            writeSave: id => writeSave(id),
            persistenceSet: async (key, value) => {
                await core?.scopeBridge.persistenceSet(key, value);
            },
            restartApplication: host.restartApplication,
            report: reportLocaleRestart,
        });
    }, [core, host.restartApplication, isPlaythroughRunning, reportLocaleRestart, writeSave]);

    /**
     * Put the player back into the run a language change restarted the game out of.
     *
     * Waits for a live game before it reads anything, and that wait is the point. The two paths that
     * bring an environment up - the boot preload and a Dev Mode reload - both finish asynchronously
     * and both have branches that end early (a superseded mount, a story that would not compile), so
     * hanging the resume off the end of either meant it silently did not happen. MEASURED: two runs
     * of the same acceptance, one resumed and one came back to the title screen with the run still
     * parked. It waits for the fact it needs instead, and gives up rather than blocking anything.
     *
     * The marker is only read once a game exists to load into, so a boot that never gets one leaves
     * it for the next boot rather than consuming it into nothing.
     */
    const resumeLocaleRestart = useCallback(async (): Promise<void> => {
        if (!core) {
            return;
        }
        const scope = core.scopeBridge;
        const deadline = Date.now() + LOCALE_RESUME_SESSION_WAIT_MS;
        const settle = (ms = LOCALE_RESUME_POLL_MS) => new Promise(resolve => { window.setTimeout(resolve, ms); });
        /**
         * The environment this launch is meant to resume into, ready and standing still.
         *
         * Two conditions, both learned from a real run. The session has to belong to THIS bundle
         * revision: the refs still describe the previous one until a reload's mount replaces them,
         * and a load into the session being torn down is thrown away by the mount that follows -
         * the player lands at the top of the scene with their parked run already deleted. And the
         * environment has to have stopped moving: a mount publishes its live game a moment before
         * whatever started it enters the game, and entering calls `newGame()`, which wipes exactly
         * what the load just put back.
         */
        const sessionPrefix = `${bundle.bundleId}:${bundle.revision}:`;
        const environmentIsMine = () => Boolean(hasLiveGame() && nlrSessionIdRef.current?.startsWith(sessionPrefix));
        // Before the marker is even read: a launch that never produces a game must leave it for the
        // next one rather than consume it into nothing.
        while (!environmentIsMine()) {
            if (Date.now() > deadline) {
                return;
            }
            await settle();
        }
        await settle(LOCALE_RESUME_SETTLE_MS);
        if (!environmentIsMine()) {
            return;
        }
        /**
         * The load, retried while the environment is still settling.
         *
         * A game existing when the marker is read does not mean one exists a tick later: the
         * environment that is up may be the one being replaced, and a mount nulls the live game
         * before it publishes the new one. MEASURED: the resume read the marker, reached the load,
         * and was told "game runtime is not available" - by a session that came up two seconds
         * later. The gate is asked again after a failure to tell that apart from a load that failed
         * with a game right there in front of it, which is not something waiting can fix.
         */
        const loadParkedSave = async (id: string): Promise<boolean> => {
            for (;;) {
                try {
                    return await loadSaveForGraph(id);
                } catch (error) {
                    if (hasLiveGame() || Date.now() > deadline) {
                        throw error;
                    }
                }
                await settle();
                while (!hasLiveGame()) {
                    if (Date.now() > deadline) {
                        throw new Error("no game runtime came up to resume into");
                    }
                    await settle();
                }
            }
        };
        try {
            await resumeAfterLocaleRestart({
                persistenceGetAsync: key => scope.persistenceGetAsync(key),
                persistenceSet: (key, value) => scope.persistenceSet(key, value),
                loadSave: loadParkedSave,
                deleteSave,
                report: reportLocaleRestart,
            });
        } catch (error) {
            // Contained here rather than raised: both callers are a boot, and a boot that reports
            // itself as failed takes the whole stage down with it. Nothing that can go wrong in a
            // resume is worse than the title screen the player gets by falling through it.
            reportLocaleRestart("error", `The playthrough could not be resumed after the language change: ${normalizeError(error)}`);
        }
    }, [
        bundle.bundleId,
        bundle.revision,
        core,
        deleteSave,
        hasLiveGame,
        loadSaveForGraph,
        reportLocaleRestart,
    ]);

    // `saves.write` for runtime plugins: the very same paths the Save Game /
    // Load Save nodes take, so a plugin save is indistinguishable from an
    // authored one. Screenshots are left off — the plugin API takes no capture
    // flag, and a capture the caller never asked for is a cost, not a default.
    useEffect(() => {
        if (!pluginHost) {
            return;
        }
        return pluginHost.attachSaveActions({
            write: (id, metadata) => writeSave(id, metadata),
            load: loadSaveAction,
        });
    }, [loadSaveAction, pluginHost, writeSave]);

    // Player slots only. Autosaves live in the same store under reserved ids and
    // are listed by List Auto Saves instead, so an authored Save/Load screen
    // built on this never has to filter Studio's bookkeeping out of its grid.
    // The same goes for the run parked by a language restart, which is nobody's
    // slot and is gone again by the time the player reaches a save screen.
    // (The plugin `saves.listIds` surface is deliberately left raw - it is
    // documented as direct store access, not the authoring view.)
    const listSaveIds = useCallback(async (): Promise<string[]> => {
        const headers = await host.saveStore.listHeaders();
        return headers
            .filter(header => !isReservedSaveId(header.id))
            // The same decision the load itself makes, from the same header bytes: a slot this
            // project would refuse is a slot a save screen must not draw a Load button on.
            .filter(header => planSaveResume(
                readSaveCompatibilityStamp(header.compatibility),
                saveStamp,
                saveCompatibilityConfig,
            ).plan.action !== "discard")
            .map(header => header.id);
    }, [host.saveStore, saveCompatibilityConfig, saveStamp]);

    /**
     * The save slots, published for host debug overlays.
     *
     * Assembled from the very callbacks the Save/Load nodes are wired to rather than from
     * `host.saveStore` directly, so the Saves panel's "load this slot" is the same operation a
     * player's Load button performs - including `listSaveIds`' autosave filter, which is what makes
     * the panel's list the list an authored save screen would show.
     */
    const savesBridge = useMemo<GameAppSaveBridge>(() => ({
        listIds: listSaveIds,
        read: id => host.saveStore.read(id),
        load: loadSave,
        remove: deleteSave,
    }), [deleteSave, host.saveStore, listSaveIds, loadSave]);

    const autoSaveConfig = useMemo(
        () => normalizeAutoSaveConfiguration(bundle.autoSave),
        [bundle.autoSave],
    );

    /** Every reserved autosave currently on disk, with its timestamps. */
    const listAutoSaves = useCallback(async (): Promise<AutoSaveEntry[]> => {
        const ids = (await host.saveStore.listIds()).filter(isAutoSaveId);
        const entries = await Promise.all(ids.map(async (id): Promise<AutoSaveEntry | null> => {
            let record: GameAppSaveRecord | null;
            try {
                record = await host.saveStore.read(id);
            } catch {
                return null; // a corrupt slot must not take the whole list down
            }
            if (!record) {
                return null;
            }
            // The same policy `List Saves` applies, for the same reason: a "continue" button on an
            // autosave this project would refuse is a button that cannot work. Autosaves carry the
            // same stamp - they are ordinary records under reserved ids.
            const resume = planSaveResume(
                readSaveCompatibilityStamp(record.metadata.compatibility),
                saveStamp,
                saveCompatibilityConfig,
            );
            if (resume.plan.action === "discard") {
                return null;
            }
            const updatedAt = Date.parse(record.metadata.updatedAt ?? "");
            const createdAt = Date.parse(record.metadata.createdAt ?? "");
            return {
                id,
                slot: parseAutoSaveSlotIndex(id) ?? 0,
                timestamp: Number.isFinite(updatedAt) ? updatedAt : 0,
                createdAt: Number.isFinite(createdAt) ? createdAt : 0,
                metadata: record.metadata.user ?? null,
            };
        }));
        return entries.filter((entry): entry is AutoSaveEntry => entry !== null)
            .sort((a, b) => b.timestamp - a.timestamp);
    }, [host.saveStore, saveCompatibilityConfig, saveStamp]);

    const autoSave = useAutoSave({
        config: autoSaveConfig,
        // The same gate `writeSave` itself enforces, so a true here always means
        // the write can actually serialize something.
        isPlaying: isPlaythroughRunning,
        // Screenshots on: the point of an autosave ring is a screen that lists
        // it, and a list of thumbnail-less rows is a worse feature. The cost is
        // bounded by the scheduler's play-head gate - an idle game captures
        // nothing.
        write: id => writeSave(id, null, true),
        listStored: listAutoSaves,
        subscribeStoryAdvanced: storyRuntime.subscribeCurrentAction,
        log: host.log,
    });

    const getSaveMetadata = useCallback(async (id: string): Promise<unknown> => {
        const record = await host.saveStore.read(id);
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
    }, [host.saveStore]);

    /**
     * One slot's stamps, read from the record the store already keeps.
     *
     * The store writes ISO strings; a graph wants numbers, and the conversion happens here so every
     * consumer sees the same epoch milliseconds `listAutoSaves` publishes. A record whose stamp is
     * missing or unparseable answers 0 for that field rather than dropping the whole slot - the
     * slot exists, and a save screen still has a row to draw for it.
     */
    const getSaveTimes = useCallback(async (id: string): Promise<SaveRecordTimes | null> => {
        const record = await host.saveStore.read(id);
        if (!record) {
            return null;
        }
        const toMs = (iso: string | undefined): number => {
            const parsed = Date.parse(iso ?? "");
            return Number.isFinite(parsed) ? parsed : 0;
        };
        return {
            savedAt: toMs(record.metadata.updatedAt),
            createdAt: toMs(record.metadata.createdAt),
        };
    }, [host.saveStore]);

    /**
     * Where one slot stopped, read from the engine metadata inside the record.
     *
     * `savedGame` is `unknown` on the record by design - the store keeps whatever the engine
     * serialized and does not model it - so the two fields are picked out defensively here rather
     * than cast. A save from an older engine that never wrote them, or a record whose blob is not
     * an object at all, still answers as a slot that exists with nothing to quote; refusing to
     * report the slot would take a row off the player's save screen over a missing caption.
     */
    /**
     * How long the playthrough behind one slot was played.
     *
     * Its own read, like `Get Save Time` and `Get Save Line` before it. A record written before
     * playtime was tracked answers `recorded: false` rather than zero seconds: a save screen has to
     * be able to leave that row blank instead of stating the player finished in no time at all.
     */
    const getSavePlaytime = useCallback(async (id: string): Promise<SaveRecordPlaytime | null> => {
        const record = await host.saveStore.read(id);
        if (!record) {
            return null;
        }
        const seconds = readSavePlaytimeSeconds(record.metadata.playtimeSeconds);
        return seconds === undefined
            ? { seconds: 0, recorded: false }
            : { seconds, recorded: true };
    }, [host.saveStore]);

    const getSaveLine = useCallback(async (id: string): Promise<SaveRecordLine | null> => {
        const record = await host.saveStore.read(id);
        if (!record) {
            return null;
        }
        const savedGame = record.savedGame;
        const meta =
            savedGame && typeof savedGame === "object"
                ? (savedGame as { meta?: unknown }).meta
                : undefined;
        const fields = meta && typeof meta === "object" ? (meta as Record<string, unknown>) : {};
        const toText = (raw: unknown): string => (typeof raw === "string" ? raw : "");
        return {
            line: toText(fields.lastSentence),
            speaker: toText(fields.lastSpeaker),
        };
    }, [host.saveStore]);

    const getSavePreview = useCallback(async (id: string): Promise<BlueprintImageAsset | null> => {
        const capture = await host.saveStore.readPreview(id);
        if (!capture) {
            return null;
        }
        return toBlueprintImageAsset(registerDevModeSavePreviewImage(id, capture));
    }, [host.saveStore]);

    const compileStoryRequest = useCallback(async (
        request: DevModeStartStoryRequest,
    ): Promise<CompiledNlrStory> => {
        const storyId = String(request.storyId ?? "").trim();
        const sceneId = String(request.sceneId ?? "").trim();
        if (!storyId) {
            throw new Error("Start Game: storyId is required");
        }
        if (!sceneId) {
            throw new Error("Start Game: sceneId is required");
        }
        const storyDocument =
            bundle.storyLibrary?.documents[storyId] ??
            Object.values(bundle.storyLibrary?.documents ?? {}).find(document => document.id === storyId);
        if (!storyDocument) {
            const indexedStoryIds = bundle.storyLibrary?.index.stories.map(story => story.id).join(", ") || "(none)";
            const documentStoryIds = Object.values(bundle.storyLibrary?.documents ?? {}).map(document => document.id).join(", ") || "(none)";
            throw new Error(
                `Start Game: story not found: ${storyId}. ` +
                `Bundle index story ids: ${indexedStoryIds}. Bundle document ids: ${documentStoryIds}.`,
            );
        }
        if (!storyDocument.scenes[sceneId]) {
            throw new Error(`Start Game: scene not found: ${sceneId}`);
        }
        // Row-precise launch ("play from here"): compute the settled stage at the target row and hand
        // the compiler a launch spec, so the entry scene pre-poses there and plays the real story on.
        const startBlockId = request.startBlockId?.trim() || undefined;
        const launch = startBlockId
            ? {
                targetBlockId: startBlockId,
                snapshot: computeStoryStageSnapshot({
                    document: storyDocument,
                    sceneId,
                    targetBlockId: startBlockId,
                    animations: bundle.storyLibrary?.animations,
                    // Without the registry table the walk only knows story-declared `/save` rows, so a
                    // "play from here" launch would enter with every registry-backed saved variable at
                    // nothing and every `/set` on one silently dropped.
                    savedVariables: bundle.ui.savedVariables,
                }),
            }
            : undefined;
        // Overlay the selected Scene Snapshot's variable overrides: scene/saved values feed the
        // pre-pose seeds; persistent values seed the host bridge (the compiled story reads them live).
        const snapshotId = request.snapshotId?.trim() || undefined;
        if (launch && snapshotId) {
            const scene = storyDocument.scenes[sceneId];
            const overrides = scene?.sceneSnapshots?.find(entry => entry.id === snapshotId)?.values;
            if (overrides) {
                const sceneDefs = scene ? sceneVariableDefs(scene) : {};
                // Merged, not `savedVariableDefs` alone: an override key is `saved:<variableId>`, and
                // since `saved` became a registry scope that id may belong to a registry entry rather
                // than to a `/save` row - reading only the document would drop those overrides.
                const savedDefs = savedVariableDefsFromView(
                    collectSavedVariableView(storyDocument, bundle.ui.savedVariables),
                );
                for (const [refKey, value] of Object.entries(overrides)) {
                    if (refKey.startsWith("scene:")) {
                        const def = sceneDefs[refKey.slice("scene:".length)];
                        if (def) launch.snapshot.sceneVariables[def.storageKey] = value;
                    } else if (refKey.startsWith("saved:")) {
                        const def = savedDefs[refKey.slice("saved:".length)];
                        if (def) launch.snapshot.savedVariables[def.storageKey] = value;
                    } else if (refKey.startsWith("persistent:")) {
                        core?.scopeBridge.persistenceSet(refKey.slice("persistent:".length), value);
                    }
                }
            }
        }
        // Built as a typed local rather than inline so the two audio fields travel as ordinary
        // properties, not as excess ones on a fresh object literal: `audioTracks` is added to
        // `CompileInput` by the story milestone, and this half has to compile before and after that
        // lands. Once it has, the intersection below is a no-op.
        const compileInput: Parameters<typeof compileStudioStoryToNlr>[0]
            & { audioTracks?: readonly ProjectAudioTrack[] } = {
            document: storyDocument,
            sceneId,
            launch,
            characters: bundle.storyLibrary?.characters,
            animations: bundle.storyLibrary?.animations,
            resolveAssetUrl: host.resolveStoryAssetUrl,
            blueprintDocument: bundle.ui.localBlueprints,
            persistentVariables: bundle.ui.persistentVariables,
            // The saved half of the same registry. This is the call both shipping runtimes go through
            // — Dev Mode and the packaged game — so leaving it out meant a project-level saved variable
            // existed in the editor and nowhere else.
            savedVariables: bundle.ui.savedVariables,
            persistence: core
                ? {
                      get: key => core.scopeBridge.persistenceGet(key),
                      set: (key, value) => core.scopeBridge.persistenceSet(key, value),
                  }
                : undefined,
            localization: bundle.localization && core
                ? {
                      ...bundle.localization,
                      getLocale: () => {
                          const stored = core.scopeBridge.persistenceGet(LOCALE_STORAGE_KEY);
                          return typeof stored === "string" && stored
                              ? stored
                              : bundle.localization!.sourceLocale;
                      },
                  }
                : undefined,
            voice: bundle.voice && core
                ? { ...bundle.voice, getVoiceLocale: readVoiceLocale }
                : undefined,
            // The in/out/loop points the author marked and the project's audio tracks. Only the
            // in-editor scene preview used to pass these, so every marked loop point and every
            // track was silently dropped in Dev Mode *and* in the packaged build - the two places
            // the feature actually has to work. Both runtimes reach the compiler through this call.
            audioClips: bundle.audio?.clips,
            audioTracks: bundle.audio?.tracks,
            // A frame's box is the size its surface was drawn at. The compiler holds the story and
            // this host holds both documents, so the sizes are handed over rather than looked up.
            stageFrameSizes: collectStageFrameSizes(bundle.ui.uidoc),
        };
        const compiled = await compileStudioStoryToNlr(compileInput);
        if (compiled.diagnostics.length > 0) {
            for (const diagnostic of compiled.diagnostics) {
                const level = diagnostic.level === "error" ? "error" : "warning";
                host.log(level, diagnostic.message);
                // The compiler already knows which block it was translating when it complained. That
                // was being dropped on the floor here, which is why "Invalid command, skipped: /show
                // …" arrived as prose with no way back to the row that wrote it.
                host.reportIssue?.({
                    level,
                    message: diagnostic.message,
                    origin: "compile",
                    ...(diagnostic.blockId ? { blockId: diagnostic.blockId } : {}),
                });
            }
        }
        return compiled;
    }, [bundle, core, host, readVoiceLocale]);

    // Mount the NLR environment (Game/LiveGame + Player via NlrStageLayer) for the given compiled
    // story and initialise it: gameReady fires (via onLiveGameReady) and assets preheat, but the
    // game does NOT enter — liveGame.newGame() is only called later by enterMountedGame(). Resolves
    // once the environment is ready. Kept hidden behind the surfaces.
    const mountNlrSession = useCallback(async (
        compiled: CompiledNlrStory,
        options: { storyRequest: DevModeStartStoryRequest | null },
    ): Promise<string> => {
        if (!activeSurface || !core) {
            throw new Error("Start Game: active surface is not available");
        }
        rejectPendingGameStarts(new NlrSessionSupersededError("NLR environment superseded by a newer session"));
        activeStoryRequestRef.current = options.storyRequest;
        activeStoryRevisionRef.current = bundle.revision;
        gameEnteredRef.current = false;

        const { width, height } = activeSurface.designSize;
        const sessionId = `${bundle.bundleId}:${bundle.revision}:${Date.now()}`;
        // One shared host-callback bundle for every Game UI slot surface of this session.
        const slotHostOptions: GameUiSlotHostOptions = {
            sessionId,
            core,
            bundle,
            rendererRegistry,
            lifecycleRef,
            makeStateAccessors,
            openSurfaceWithTransition: openSurface,
            goBackWithTransition: goBack,
            quitApplication: host.quitApplication,
            getFullscreen: host.getFullscreen,
            setFullscreen: host.setFullscreen,
            startStoryInGame: request =>
                startStoryInGameRef.current?.(request) ??
                Promise.reject(new Error("Start Game: runtime is not ready")),
            writeSaveInGame: (id, metadata, screenshot) => writeSave(id, metadata, screenshot),
            loadSaveInGame: loadSaveForGraph,
            deleteSaveInGame: id => deleteSave(id),
            listSaveIds,
            getSaveMetadata,
            getSaveTimes,
            getSaveLine,
            getSavePlaytime,
            getSavePreview,
            getPlaytime: playtime.getRunSeconds,
            getTotalPlaytime: playtime.getTotalSeconds,
            writeAutoSaveInGame: autoSave.writeNow,
            listAutoSaves,
            getHistoryInGame,
            getFutureInGame,
            restoreHistoryInGame,
            redoHistoryInGame,
            canUndoHistoryInGame,
            canRedoHistoryInGame,
            exportProgressInGame,
            importProgressInGame,
            getCurrentNametag,
            resolveAvatarAssetId,
            getNotificationsInGame,
            getChoiceCountInGame,
            isNvlModeInGame,
            isCurrentTextReadInGame,
            clearTextReadInGame,
            selectChoiceInGame,
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
            // The sound family. A slot surface builds its own host API, and it used to build one
            // with none of these - so a button-click sound inside a dialogue box, a choice or an NVL
            // surface did nothing at all, with no diagnostic anywhere.
            soundTransport,
            audioTracks: bundle.audio?.tracks,
            subscribeGamePreferences,
            // A language picker is exactly the kind of thing an author builds into a dialogue-box
            // quick menu, and a slot surface's Set Language reaches this and nothing else.
            localeChangedInGame: handleLocaleChanged,
            setWidgetPatchesByScope,
            widgetPatchesByScopeRef,
            widgetRuntimeStore,
            reducedMotion: prefersReducedMotion === true,
        };
        const slots = createGameUiSlotComponents({
            uidoc: bundle.ui.uidoc,
            logLabel: host.id,
            slotHostOptions,
            setDialogVirtualClickTarget: setNlrDialogVirtualClickTarget,
            setChoiceRuntime,
        });
        const onStageNode = slots.onStageNode;
        const game = createNlrGameWithGameUi({
            width,
            height,
            contentContainerId: `__nlr_preview_stage_${sessionId.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
            slots,
            // NLR clamps its stage to 800×450 by default; windows smaller than that would crop
            // and offset the stage instead of letterboxing down (same override as the story
            // preview, which embeds into arbitrarily small panes).
            minStageSize: { width: 1, height: 1 },
            // The project's mixer, declared at boot. This is the *only* moment the shape of the
            // tree can be set: the engine realizes it into gain nodes when audio starts and never
            // re-shapes it. A bundle with no track table declares nothing and gets the engine's
            // three seeded buses, which is exactly the pre-bus behaviour.
            audioBuses: audioTracksToBusDeclarations(bundle.audio?.tracks),
            // The `skipReadText` preference cannot be honoured from outside the engine's own skip
            // loop, so the game app runs its own; see the effect that builds `skipRunController`.
            hostOwnsSkipKey: true,
        });
        // The author's preference defaults, then whatever the player has chosen on top of them.
        // Before the audio buses on purpose: the three seeded buses and the volume preferences are
        // two views of one storage in the engine, so the buses' own restore is the more specific
        // answer and has to land second.
        playerPreferencesRef.current?.();
        playerPreferencesRef.current = await attachPlayerPreferences({
            preference: (game as { preference?: PreferenceStoreLike }).preference,
            defaults: bundle.preferences,
            read: key => core.scopeBridge.persistenceGetAsync(key),
            write: (key, value) => core.scopeBridge.persistenceSet(key, value),
            log: (level, message) => host.log(level, message),
        });
        // The player's own volumes, restored on top of the author's declaration and written back on
        // every change. Deliberately here rather than after the Player mounts: setting a volume for
        // a bus whose channel does not exist yet is normal and is applied when it is realized, so
        // doing it now closes the window where the first clip plays at the wrong level.
        audioBusPersistenceRef.current?.();
        audioBusPersistenceRef.current = await attachAudioBusPersistence({
            mixer: (game as { audioBuses?: Parameters<typeof attachAudioBusPersistence>[0]["mixer"] }).audioBuses,
            read: key => core.scopeBridge.persistenceGetAsync(key),
            write: (key, value) => core.scopeBridge.persistenceSet(key, value),
            onVolumeChange: () => preferenceListenersRef.current.forEach(listener => listener()),
            log: (level, message) => host.log(level, message),
        });
        // Before the Player mounts, not after: a puppet looks its backend up once, when its
        // component mounts, so anything registered later is simply not there for it. Failures are
        // already reported by the loader and never rejected — a broken author-supplied runtime
        // costs the stage nothing but the characters it would have drawn.
        if (host.listPuppetBackendModules) {
            try {
                const sources = await host.listPuppetBackendModules();
                if (sources.length > 0) {
                    await loadPuppetBackends(game, sources, { log: host.log });
                }
            } catch (error) {
                host.log("warning", `Puppet backends could not be discovered: ${normalizeError(error)}`);
            }
        }
        // Studio's own half of both host seams: a Game UI surface drawn inside a stage element's
        // box. Registered on both because which one carries a frame depends on who is framed — an
        // image for a character Studio draws, a puppet for one an author's runtime draws. After the
        // author's puppet backends, so a project can still shadow the name.
        const stageSurfaceHost = {
            uidoc: bundle.ui.uidoc,
            slotHostOptions,
            log: host.log,
        };
        game.registerPuppetBackend(createStageSurfacePuppetBackend(stageSurfaceHost));
        game.registerImageBackend(createStageSurfaceImageBackend(stageSurfaceHost));
        const environmentReady = new Promise<void>((resolve, reject) => {
            pendingEnvReadyRef.current.set(sessionId, { resolve, reject });
        });
        // The first scene's assets, warmed while this mount is still hidden behind the host's
        // loading step. Bounded: a slow or broken asset degrades to the old behaviour (paid on
        // entry) instead of holding the boot open.
        const assetsReady = withDeadline(
            new Promise<void>(resolve => {
                pendingAssetsReadyRef.current.set(sessionId, { resolve });
            }),
            STAGE_WARMUP_TIMEOUT_MS,
            () => {
                pendingAssetsReadyRef.current.delete(sessionId);
                host.log(
                    "warning",
                    `[${host.id}] first-scene preload did not finish in ${STAGE_WARMUP_TIMEOUT_MS}ms; `
                    + "continuing without a warm stage",
                );
            },
        );
        stageWarmupRef.current = { sessionId, promise: assetsReady };
        setGameStageVisible(false);
        clearGameHiddenStudioPages();
        gameReadyFiredRef.current = null;
        nlrLiveGameRef.current = null;
        nlrCurrentActionTokenRef.current?.cancel();
        nlrCurrentActionTokenRef.current = null;
        currentActionIdRef.current = null;
        cancelSceneTracking();
        nlrCompiledRef.current = compiled;
        registerCharacterAvatarAssets(compiled.avatarAssetIdByUrl);
        choiceRuntimeRef.current = null;
        setNlrSession({
            id: sessionId,
            game,
            compiled,
            width,
            height,
            onStageNode,
        });
        await environmentReady;
        // Hold the mount open until the stage is warm. Callers mount either from boot (loading
        // step on screen) or from a Start Game that could not fast-path, and both would otherwise
        // reveal a stage that still has to fetch and decode its first scene.
        await assetsReady;
        return sessionId;
    }, [
        activeSurface,
        bundle,
        clearGameHiddenStudioPages,
        goBack,
        core,
        deleteSave,
        exportProgressInGame,
        importProgressInGame,
        getChoiceCountInGame,
        getCurrentNametag,
        resolveAvatarAssetId,
        getGamePreferenceInGame,
        getFutureInGame,
        getHistoryInGame,
        getNotificationsInGame,
        getSaveMetadata,
        getSaveTimes,
        getSaveLine,
        getSavePlaytime,
        getSavePreview,
        handleLocaleChanged,
        autoSave.writeNow,
        listAutoSaves,
        hideDialogInGame,
        host.id,
        host.log,
        host.listPuppetBackendModules,
        host.quitApplication,
        host.getFullscreen,
        host.setFullscreen,
        isCurrentTextReadInGame,
        clearTextReadInGame,
        isInGame,
        isNvlModeInGame,
        listSaveIds,
        loadSaveAction,
        makeStateAccessors,
        nextInGame,
        openSurface,
        quitGame,
        rejectPendingGameStarts,
        rendererRegistry,
        canRedoHistoryInGame,
        canUndoHistoryInGame,
        redoHistoryInGame,
        restoreHistoryInGame,
        selectChoiceInGame,
        setChoiceRuntime,
        setNlrDialogVirtualClickTarget,
        setSentenceSpeedInGame,
        setGamePreferenceInGame,
        showDialogInGame,
        skipInGame,
        toggleDialogDisplayInGame,
        widgetRuntimeStore,
        writeSave,
    ]);

    // Enter (start playing) the currently mounted environment: call newGame() on the live game,
    // wait for the first scene to be visually ready, then reveal the stage over the surfaces.
    const enterMountedGame = useCallback(async (): Promise<void> => {
        const liveGame = nlrLiveGameRef.current;
        const sessionId = nlrLiveGameSessionIdRef.current;
        if (!liveGame || !sessionId) {
            throw new Error("Start Game: game environment is not ready");
        }
        // Normally already settled — the boot step waited on it. It can still be pending when the
        // environment was mounted without a boot gate, and entering before the warm-up lands would
        // put the fetch/decode right back on the start path.
        if (stageWarmupRef.current?.sessionId === sessionId) {
            await stageWarmupRef.current.promise;
        }
        const sceneReady = new Promise<void>((resolve, reject) => {
            pendingGameStartsRef.current.set(sessionId, { resolve, reject });
        });
        liveGame.newGame();
        // A fresh playthrough starts the stopwatch from nothing. A load overwrites this moments
        // later with the reading it inherited; nothing else in the file resets it.
        playtime.seedRun(0);
        gameEnteredRef.current = true;
        // A document imported before this point has been waiting for exactly this moment:
        // `newGame()` clears every namespace and rebuilds it from its defaults, so anything written
        // earlier is gone and anything written now stands. See `pendingImportedProgressRef`.
        const importedProgress = pendingImportedProgressRef.current;
        if (importedProgress) {
            pendingImportedProgressRef.current = null;
            applyImportedSavedProgress(importedProgress);
        }
        const carriedSave = pendingCarriedSaveRef.current;
        if (carriedSave) {
            pendingCarriedSaveRef.current = null;
            applyCarriedSaveState(carriedSave);
        }
        // `onFirstSceneReady` already ends on a painted frame (see waitForStageVisualReadyWithTimeout),
        // so there is nothing left to wait for here: an extra frame only delays the UI's exit.
        await sceneReady;
        setGameStageVisible(true);
        hideCurrentStudioPagesForGame();
    }, [applyCarriedSaveState, applyImportedSavedProgress, hideCurrentStudioPagesForGame]);

    const startStoryInGame = useCallback(async (
        request: DevModeStartStoryRequest,
        options?: { forceReinit?: boolean },
    ): Promise<void> => {
        if (!activeSurface || !core) {
            throw new Error("Start Game: active surface is not available");
        }
        const storyId = String(request.storyId ?? "").trim();
        const sceneId = String(request.sceneId ?? "").trim();
        const startBlockId = request.startBlockId?.trim() || undefined;
        const snapshotId = request.snapshotId?.trim() || undefined;

        // Fast path: the environment is already mounted with this story from the boot preload and
        // has not entered a game yet. Just enter it (newGame + reveal) — no recompile, no re-mount,
        // and gameReady does not fire again. A row-precise launch never fast-paths: the pre-posed
        // entry scene depends on the target row, so it must recompile.
        if (
            !options?.forceReinit &&
            !startBlockId &&
            nlrLiveGameRef.current &&
            !gameEnteredRef.current &&
            activeStoryRequestRef.current?.storyId === storyId &&
            activeStoryRequestRef.current?.sceneId === sceneId
        ) {
            await enterMountedGame();
            return;
        }

        const compiled = await compileStoryRequest({ storyId, sceneId, startBlockId, snapshotId });
        await mountNlrSession(compiled, { storyRequest: { storyId, sceneId, startBlockId, snapshotId } });
        await enterMountedGame();
    }, [activeSurface, compileStoryRequest, core, enterMountedGame, mountNlrSession]);

    // Boot-time init of the default scene environment: mount + preheat, WITHOUT entering the game.
    const initDefaultSceneEnvironment = useCallback(async (
        request: DevModeStartStoryRequest,
    ): Promise<void> => {
        const compiled = await compileStoryRequest(request);
        await mountNlrSession(compiled, { storyRequest: request });
    }, [compileStoryRequest, mountNlrSession]);

    const startEmptyNlrEnvironment = useCallback(async (): Promise<void> => {
        await mountNlrSession(createEmptyCompiledNlrStory(), { storyRequest: null });
    }, [mountNlrSession]);

    useEffect(() => {
        startStoryInGameRef.current = startStoryInGame;
    }, [startStoryInGame]);

    const createHostAdapterBundle = useCallback((entry: AppSurfaceLayerNavEntry, surface: UISurface) => {
        if (!core) {
            return null;
        }
        const runtimeScopeId = entry.runtimeScopeId;
        let hostAdapter: UIHostAdapter | null = null;
        const hostApi = createDevModeBlueprintHostApi({
            document: bundle.ui.uidoc,
            scope: core.scopeBridge,
            activeSurfaceId: surface.id,
            runtimeScopeId,
            pageProps: entry.props,
            emit: event => core.debug.emit(event),
            onOpenSurface: openSurface,
            onPageBack: goBack,
            onClearPages: clearPages,
            onClearGameOverlay: clearGameOverlay,
            onQuitApplication: host.quitApplication,
            onGetFullscreen: host.getFullscreen,
            onSetFullscreen: host.setFullscreen,
            onShowLayer: showLayer,
            onHideLayer: hideLayer,
            onHideLayerGroup: hideLayerGroup,
            onWaitLayer: waitLayer,
            onCloseOwnLayer: closeOwnLayer,
            onIsLayerMounted: isLayerMounted,
            onStartStory: startStoryInGame,
            onIsInGame: isInGame,
            onIsGameOverlay: () => entry.presentation === "gameOverlay",
            onQuitGame: quitGame,
            onWriteSave: writeSave,
            onLoadSave: loadSaveForGraph,
            onDeleteSave: deleteSave,
            onListSaveIds: listSaveIds,
            onGetSaveMetadata: getSaveMetadata,
            onGetSaveTimes: getSaveTimes,
            onGetSaveLine: getSaveLine,
            onGetSavePlaytime: getSavePlaytime,
            onGetPlaytime: playtime.getRunSeconds,
            onGetTotalPlaytime: playtime.getTotalSeconds,
            onGetSavePreview: getSavePreview,
            onWriteAutoSave: autoSave.writeNow,
            onListAutoSaves: listAutoSaves,
            onGetHistory: getHistoryInGame,
            onGetFuture: getFutureInGame,
            onRestoreHistory: restoreHistoryInGame,
            onRedoHistory: redoHistoryInGame,
            onCanUndoHistory: canUndoHistoryInGame,
            onCanRedoHistory: canRedoHistoryInGame,
            onGetNametag: getCurrentNametag,
            onGetNotifications: getNotificationsInGame,
            onGetChoiceCount: getChoiceCountInGame,
            onIsNvlMode: isNvlModeInGame,
            onIsCurrentTextRead: isCurrentTextReadInGame,
            onIsTextRead: hasReadTextInGame,
            onClearTextRead: clearTextReadInGame,
            onIsSceneVisited: isSceneVisitedInGame,
            onIsOptionPicked: isOptionPickedInGame,
            onClearVisited: clearVisitedInGame,
            onSelectChoice: selectChoiceInGame,
            onNext: nextInGame,
            onSkip: skipInGame,
            onShowDialog: showDialogInGame,
            onHideDialog: hideDialogInGame,
            onToggleDialogDisplay: toggleDialogDisplayInGame,
            onSetSentenceSpeed: setSentenceSpeedInGame,
            onGetGamePreference: getGamePreferenceInGame,
            onSetGamePreference: setGamePreferenceInGame,
            onPlaySound: soundTransport.play,
            onStopSound: soundTransport.stop,
            onPauseSound: soundTransport.pause,
            onResumeSound: soundTransport.resume,
            onSetSoundVolume: soundTransport.setVolume,
            onSeekSound: soundTransport.seek,
            onIsSoundPlaying: soundTransport.isPlaying,
            onGetTrackVolume: soundTransport.getTrackVolume,
            onSetTrackVolume: soundTransport.setTrackVolume,
            onNetworkFetch: host.networkFetch,
            onMovePointer: host.movePointer,
            onOpenExternal: host.openExternal,
            onExportProgress: exportProgressInGame,
            onImportProgress: importProgressInGame,
            audioTracks: bundle.audio?.tracks,
            onSubscribeGamePreferences: subscribeGamePreferences,
            onLocaleChanged: handleLocaleChanged,
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
            localizationConfig: bundle.localization ?? null,
            voiceConfig: bundle.voice ?? null,
            onPlayVoice: playVoiceUnit,
        });
        hostAdapter = createDevModeBlueprintHostAdapter({
            bundle,
            surface,
            runtimeScopeId,
            scopeBridge: core.scopeBridge,
            debug: core.debug,
            hostApi,
            executionManager: core.executionManager,
        });
        const bindingContext: SurfaceBlueprintBindingContext = {
            blueprintDocument: bundle.ui.localBlueprints,
            persistentVariables: bundle.ui.persistentVariables,
            surfaceState: core.scopeBridge.getSurfaceStore(runtimeScopeId),
            debug: core.debug,
            coalescer: core.bindingDebugCoalescer,
            globalState: {
                get: key => core.scopeBridge.globalGet(key),
                subscribe: listener => core.scopeBridge.subscribeGlobals(listener),
            },
            pageProps: entry.props,
        };
        return {
            hostAdapter,
            bindingContext,
            runtimeScopeId,
        } satisfies HostAdapterBundle;
    }, [
        bundle,
        goBack,
        core,
        deleteSave,
        getChoiceCountInGame,
        getCurrentNametag,
        getGamePreferenceInGame,
        getFutureInGame,
        getHistoryInGame,
        getNotificationsInGame,
        getSaveMetadata,
        getSaveTimes,
        getSaveLine,
        getSavePlaytime,
        getSavePreview,
        handleLocaleChanged,
        autoSave.writeNow,
        listAutoSaves,
        hideDialogInGame,
        host.quitApplication,
        host.getFullscreen,
        host.setFullscreen,
        showLayer,
        hideLayer,
        hideLayerGroup,
        waitLayer,
        closeOwnLayer,
        isLayerMounted,
        isCurrentTextReadInGame,
        clearTextReadInGame,
        isInGame,
        isNvlModeInGame,
        listSaveIds,
        loadSaveAction,
        nextInGame,
        openSurface,
        quitGame,
        canRedoHistoryInGame,
        canUndoHistoryInGame,
        redoHistoryInGame,
        restoreHistoryInGame,
        selectChoiceInGame,
        setSentenceSpeedInGame,
        setGamePreferenceInGame,
        setWidgetPatchesByScope,
        showDialogInGame,
        skipInGame,
        startStoryInGame,
        toggleDialogDisplayInGame,
        widgetPatchesByScopeRef,
        widgetRuntimeStore,
        exportProgressInGame,
        importProgressInGame,
        writeSave,
    ]);

    const hostAdapterBundle = useMemo(() => {
        if (!activeEntry || !activeSurface) {
            return null;
        }
        return createHostAdapterBundle(activeEntry, activeSurface);
    }, [activeEntry, activeSurface, createHostAdapterBundle]);

    // Boot the NarraLeaf React environment as a load step BEFORE the surface system starts:
    // preload the configured default scene (or launch directly into a story entry), otherwise
    // boot an empty NLR environment. gameReady fires here, once, at boot.
    runBootRef.current = async () => {
        if (host.bootAction.kind === "story") {
            // A direct story launch enters the game immediately after the environment mounts.
            // `startBlockId` (row-precise "play from here") pre-poses the entry scene at that row.
            await startStoryInGame({
                storyId: host.bootAction.storyId,
                sceneId: host.bootAction.sceneId,
                startBlockId: host.bootAction.startBlockId,
                snapshotId: host.bootAction.snapshotId,
            });
        } else {
            // Menu launch: initialise the environment (gameReady) and fully warm the scene the
            // project's Start Game would enter — fetched and decoded — but do NOT enter the game;
            // the player stays on the menu. Getting the target right is the whole point: a warm
            // environment for the wrong scene has to be recompiled and remounted on start.
            const defaultScene = resolveStagePreloadTarget(bundle);
            if (defaultScene) {
                await initDefaultSceneEnvironment(defaultScene);
            } else {
                await startEmptyNlrEnvironment();
            }
        }
    };

    // Requires hostAdapterBundle so NlrStageLayer mounts and can drive onLiveGameReady. The deps are
    // intentionally narrow - the readiness signal and the session key, nothing else: the boot mutates
    // nlrSession (and therefore hostAdapterBundle), and re-running on that churn would cancel the
    // in-flight boot before nlrPreloadDone is set. StrictMode re-boot safety comes from the
    // per-session nav-reset effect clearing nlrBootStartedRef, not from this effect's deps.
    //
    // Keyed on `bundle.bundleId` - the SESSION - and deliberately not on the revision. A hot reload
    // is owned by the `bundle.revision` effect below, which restarts the NLR environment in place;
    // booting again from here as well starts a second mount of the same session, and the loser's
    // `environmentReady` (which has no deadline, unlike the stage warmup beside it) then never
    // resolves. MEASURED: re-keying this on the session key left `runBoot` hanging on 7 reloads out
    // of 8, and the stage came back only when the 45s preload timeout fired.
    const bootReady = Boolean(host.ready && core && activeSurface && hostAdapterBundle);
    useEffect(() => {
        if (!bootReady) {
            return;
        }
        const sig = bundle.bundleId;
        if (nlrBootStartedRef.current === sig) {
            return;
        }
        nlrBootStartedRef.current = sig;

        let cancelled = false;
        const finish = () => {
            if (!cancelled) {
                setNlrPreloadDone(true);
            }
        };
        const timeoutId = setTimeout(() => {
            host.log("warning", `[${host.id}] NLR environment preload timed out; starting surface system`);
            finish();
        }, NLR_BOOT_PRELOAD_TIMEOUT_MS);

        void (async () => {
            try {
                await runBootRef.current?.();
            } catch (err) {
                if (cancelled) {
                    // nothing to report; the effect was torn down
                } else if (err instanceof NlrSessionSupersededError) {
                    // A later mount owns the environment now, so this boot is done rather than
                    // broken — and the guard stays set, because retrying it would fight that mount.
                    host.log("info", `[${host.id}] NLR boot superseded: ${err.message}`);
                } else {
                    nlrBootStartedRef.current = null;
                    reportFailure(err);
                }
            } finally {
                clearTimeout(timeoutId);
                finish();
            }
        })();

        return () => {
            cancelled = true;
            clearTimeout(timeoutId);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bootReady, bundle.bundleId]);

    /**
     * The one place a language restart is resumed from.
     *
     * Keyed on the runtime core rather than hung off the boot or the reload that produced one. Two
     * reasons, both measured on a real run:
     *
     *  - Both of those paths are asynchronous and both have branches that end early (a superseded
     *    mount, a story that would not compile), so a resume that lives inside one of them is
     *    skipped exactly when it is needed.
     *  - The core is what owns the persistence store, and a reload builds a NEW one while the old
     *    one's adapter is detached and its values cleared. Keying on the bundle instead fired this
     *    on the render *before* the new core arrived, read the store through the dead one, and
     *    concluded that nothing was parked - while the marker sat on disk and the player's run sat
     *    in a save nobody would ever read again.
     *
     * One attempt per environment, waiting for the environment itself, and a no-op in every launch
     * that owes nothing - which is all of them but the one immediately after a language change.
     */
    useEffect(() => {
        if (!host.ready || !core || !nlrPreloadDone) {
            return;
        }
        if (localeResumeAttemptedRef.current === core) {
            return;
        }
        localeResumeAttemptedRef.current = core;
        void resumeLocaleRestart();
    }, [core, host.ready, nlrPreloadDone, resumeLocaleRestart]);

    const visibleSurfaceEntries = bundle.ui.uidoc.surfaces.length > 0
        ? visibleEntries
            .filter(entry => entry.sessionKey === host.sessionKey)
            .filter(entry => !studioPageHiddenForGame || !gameHiddenNavKeys.has(entry.key))
            .map(entry => {
                const visibleSurface = bundle.ui.uidoc.surfaces.find(surface => surface.id === entry.surfaceId);
                return visibleSurface ? { entry, surface: visibleSurface } : null;
            })
            .filter((item): item is { entry: GameAppNavEntry; surface: UISurface } => Boolean(item))
        : [];

    const visibleLayers = layers
        .map(layer => {
            const layerSurface = bundle.ui.uidoc.surfaces.find(surface => surface.id === layer.surfaceId);
            return layerSurface ? { layer, surface: layerSurface } : null;
        })
        .filter((item): item is { layer: SurfaceLayerEntry; surface: UISurface } => Boolean(item));

    /**
     * Who takes pointer input and who takes the keys, across the page lane and the layers at once.
     *
     * The single place either question is answered. With an empty layer stack it reduces to the
     * comparison the surface layers used to make for themselves - the entry the page stack is
     * settling on, and nothing else.
     */
    const compositeInput = resolveCompositeInput({
        pageEntries: visibleSurfaceEntries.map(item => item.entry),
        activePageKey: activeEntry?.key ?? null,
        layers: visibleLayers.map(item => item.layer),
    });

    /**
     * Which layers this render left off the screen, told to the stack that holds them.
     *
     * A layer naming a surface the running bundle does not have is filtered out above, so the stack
     * says it is present while nothing of it is drawn. Removing one starts no exit animation, and
     * the presence group therefore never reports one finished: `Hide Layer` waited for a frame that
     * was never coming, and a mutually exclusive group stayed occupied by something invisible. The
     * stack settles those waits itself once it knows which of its layers have no frame to lose.
     */
    const renderedLayerKeys = new Set(nlrPreloadDone ? visibleLayers.map(item => item.layer.key) : []);
    const unrenderedLayerKeys = layers
        .filter(layer => !renderedLayerKeys.has(layer.key))
        .map(layer => layer.key);
    const unrenderedLayerKeysRef = useRef<readonly string[]>(unrenderedLayerKeys);
    unrenderedLayerKeysRef.current = unrenderedLayerKeys;
    const unrenderedLayerKeysToken = unrenderedLayerKeys.join(" ");
    useEffect(() => {
        layerStack.setUnrenderedLayers(unrenderedLayerKeysRef.current);
    }, [layerStack, unrenderedLayerKeysToken]);

    const activeSurfaceKeyboardReady = Boolean(
        activeEntry &&
        prepaintReadyKeys.has(activeEntry.key) &&
        (!studioPageHiddenForGame || !gameHiddenNavKeys.has(activeEntry.key)) &&
        // The app-level keyDown/keyUp dispatch belongs to the page lane, so it stops the moment a
        // layer takes the keyboard - otherwise Escape would reach the page under an open modal.
        compositeInput.keyboardOwnerKey === activeEntry.key,
    );

    const nestedSurfaceRuntime = useMemo<NestedSurfaceRuntime | undefined>(() => {
        if (!core) {
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
                    document: bundle.ui.uidoc,
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
                    onPageBack: goBack,
                    onClearPages: clearPages,
                    onClearGameOverlay: clearGameOverlay,
                    onQuitApplication: host.quitApplication,
                    onGetFullscreen: host.getFullscreen,
                    onSetFullscreen: host.setFullscreen,
                    onShowLayer: showLayer,
                    onHideLayer: hideLayer,
                    onHideLayerGroup: hideLayerGroup,
                    onWaitLayer: waitLayer,
                    onCloseOwnLayer: closeOwnLayer,
                    onIsLayerMounted: isLayerMounted,
                    onStartStory: startStoryInGame,
                    onIsInGame: isInGame,
                    onIsGameOverlay: () =>
                        input.parentHostAdapter.blueprintRuntime?.hostApi?.game.isGameOverlay() === true,
                    onQuitGame: quitGame,
                    onWriteSave: writeSave,
                    onLoadSave: loadSaveForGraph,
                    onDeleteSave: deleteSave,
                    onListSaveIds: listSaveIds,
                    onGetSaveMetadata: getSaveMetadata,
                    onGetSaveTimes: getSaveTimes,
                    onGetSaveLine: getSaveLine,
                    onGetSavePlaytime: getSavePlaytime,
                    onGetPlaytime: playtime.getRunSeconds,
                    onGetTotalPlaytime: playtime.getTotalSeconds,
                    onGetSavePreview: getSavePreview,
                    onWriteAutoSave: autoSave.writeNow,
                    onListAutoSaves: listAutoSaves,
                    onGetHistory: getHistoryInGame,
                    onGetFuture: getFutureInGame,
                    onRestoreHistory: restoreHistoryInGame,
                    onRedoHistory: redoHistoryInGame,
                    onCanUndoHistory: canUndoHistoryInGame,
                    onCanRedoHistory: canRedoHistoryInGame,
                    onGetNametag: getCurrentNametag,
                    onGetNotifications: getNotificationsInGame,
                    onGetChoiceCount: getChoiceCountInGame,
                    onIsNvlMode: isNvlModeInGame,
                    onIsCurrentTextRead: isCurrentTextReadInGame,
                    onIsTextRead: hasReadTextInGame,
                    onClearTextRead: clearTextReadInGame,
                    onIsSceneVisited: isSceneVisitedInGame,
                    onIsOptionPicked: isOptionPickedInGame,
                    onClearVisited: clearVisitedInGame,
                    onSelectChoice: selectChoiceInGame,
                    onNext: nextInGame,
                    onSkip: skipInGame,
                    onShowDialog: showDialogInGame,
                    onHideDialog: hideDialogInGame,
                    onToggleDialogDisplay: toggleDialogDisplayInGame,
                    onSetSentenceSpeed: setSentenceSpeedInGame,
                    onGetGamePreference: getGamePreferenceInGame,
                    onSetGamePreference: setGamePreferenceInGame,
                    onPlaySound: soundTransport.play,
                    onStopSound: soundTransport.stop,
                    onPauseSound: soundTransport.pause,
                    onResumeSound: soundTransport.resume,
                    onSetSoundVolume: soundTransport.setVolume,
                    onSeekSound: soundTransport.seek,
                    onIsSoundPlaying: soundTransport.isPlaying,
                    onGetTrackVolume: soundTransport.getTrackVolume,
                    onSetTrackVolume: soundTransport.setTrackVolume,
                    onNetworkFetch: host.networkFetch,
                    onMovePointer: host.movePointer,
                    onOpenExternal: host.openExternal,
                    onExportProgress: exportProgressInGame,
                    onImportProgress: importProgressInGame,
                    audioTracks: bundle.audio?.tracks,
                    onSubscribeGamePreferences: subscribeGamePreferences,
                    onLocaleChanged: handleLocaleChanged,
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
                    localizationConfig: bundle.localization ?? null,
                    voiceConfig: bundle.voice ?? null,
                    onPlayVoice: playVoiceUnit,
                });
                nestedHostAdapter = createDevModeBlueprintHostAdapter({
                    bundle,
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
                blueprintDocument: bundle.ui.localBlueprints,
                persistentVariables: bundle.ui.persistentVariables,
                surfaceState: core.scopeBridge.getSurfaceStore(input.runtimeScopeId),
                debug: core.debug,
                coalescer: core.bindingDebugCoalescer,
                globalState,
                pageProps: input.params,
            }),
            mountSurface: input => {
                const surfaceStore = core.scopeBridge.getSurfaceStore(input.runtimeScopeId);
                const executor = {
                    openScope: (scopeId: string) => core.executionManager.openScope(scopeId),
                    closeScope: (scopeId: string, reason: string) => core.executionManager.closeScope(scopeId, reason),
                    dispatchSurfaceEvent: (command: { eventName: "surfaceInit" | "surfaceUnmount" | "beforeSurfaceExit" | "afterSurfaceEnter"; scopeId: string; surfaceId: string; allowClosedScopeExecution?: boolean }) => {
                        void dispatchSurfaceBlueprintEvent({
                            blueprintDocument: bundle.ui.localBlueprints,
                            persistentVariables: bundle.ui.persistentVariables,
                            surfaceId: command.surfaceId,
                            runtimeScopeId: command.scopeId,
                            eventName: command.eventName,
                            hostAdapter: input.hostAdapter,
                            debug: core.debug,
                            getSurfaceState: key => surfaceStore.get(key),
                            setSurfaceState: (key, value) => surfaceStore.set(key, value),
                            executionManager: core.executionManager,
                            ...(command.allowClosedScopeExecution ? { allowClosedScopeExecution: true } : {}),
                        });
                    },
                    setTransitionState: () => undefined,
                    bumpLifecycleSignal: () => undefined,
                    clearInteraction: () => undefined,
                };
                executeLifecycleCommands(
                    lifecycleRef.current.surfaceReady(input.runtimeScopeId, input.targetSurface.id),
                    executor,
                );
                return () => {
                    executeLifecycleCommands(
                        lifecycleRef.current.surfaceUnmounted(input.runtimeScopeId, input.targetSurface.id),
                        executor,
                    );
                };
            },
            getWidgetRuntimePatches: input => widgetPatchesByScopeRef.current[input.runtimeScopeId] ?? {},
        };
    }, [
        bundle,
        goBack,
        core,
        deleteSave,
        getChoiceCountInGame,
        getCurrentNametag,
        getGamePreferenceInGame,
        getFutureInGame,
        getHistoryInGame,
        getNotificationsInGame,
        getSaveMetadata,
        getSaveTimes,
        getSaveLine,
        getSavePlaytime,
        getSavePreview,
        handleLocaleChanged,
        autoSave.writeNow,
        listAutoSaves,
        hideDialogInGame,
        host.quitApplication,
        host.getFullscreen,
        host.setFullscreen,
        showLayer,
        hideLayer,
        hideLayerGroup,
        waitLayer,
        closeOwnLayer,
        isLayerMounted,
        isCurrentTextReadInGame,
        clearTextReadInGame,
        isInGame,
        isNvlModeInGame,
        listSaveIds,
        loadSaveAction,
        nextInGame,
        openSurface,
        quitGame,
        canRedoHistoryInGame,
        canUndoHistoryInGame,
        redoHistoryInGame,
        restoreHistoryInGame,
        selectChoiceInGame,
        setSentenceSpeedInGame,
        setGamePreferenceInGame,
        showDialogInGame,
        skipInGame,
        startStoryInGame,
        toggleDialogDisplayInGame,
        widgetRuntimeStore,
        exportProgressInGame,
        importProgressInGame,
        writeSave,
    ]);

    useEffect(() => {
        lifecycleRef.current.sessionReset();
        appBootFiredRef.current = null;
        gameReadyFiredRef.current = null;
    }, [bundle.bundleId, bundle.revision]);

    useEffect(() => {
        if (activeStoryRevisionRef.current === null) {
            return;
        }
        if (activeStoryRevisionRef.current === bundle.revision) {
            return;
        }
        // Hot reload (new bundle revision): re-mount the environment with the recompiled story,
        // preserving whether the game had already been entered.
        const request = activeStoryRequestRef.current;
        const wasEntered = gameEnteredRef.current;
        void (async () => {
            try {
                if (request) {
                    const compiled = await compileStoryRequest(request);
                    await mountNlrSession(compiled, { storyRequest: request });
                    if (wasEntered) {
                        await enterMountedGame();
                    }
                } else {
                    await startEmptyNlrEnvironment();
                }
            } catch (err) {
                if (err instanceof NlrSessionSupersededError) {
                    // Another revision landed while this restart was in flight and has taken the
                    // environment over. Expected when saves arrive in quick succession — and more
                    // often now that a mount also waits for the stage to warm — so it is not a
                    // failure to report.
                    host.log("info", `[${host.id}] NLR hot reload restart superseded by a newer bundle revision`);
                    return;
                }
                reportFailure(err, { prefix: `[${host.id}] NLR hot reload restart failed: ` });
            }
        })();
    }, [bundle.revision, compileStoryRequest, enterMountedGame, host, mountNlrSession, startEmptyNlrEnvironment]);

    useEffect(() => {
        const nextBundleId = bundle.bundleId;
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
        rejectPendingGameStarts(new NlrSessionSupersededError("Runtime session changed"));
        nlrCharacterPromptTokenRef.current?.cancel();
        nlrCharacterPromptTokenRef.current = null;
        nlrPreferenceTokenRef.current?.cancel();
        nlrPreferenceTokenRef.current = null;
        nlrCurrentActionTokenRef.current?.cancel();
        nlrCurrentActionTokenRef.current = null;
        currentActionIdRef.current = null;
        cancelSceneTracking();
        nlrCompiledRef.current = null;
        clearCharacterAvatarAssets();
        detachTextReadTracker();
        preferenceSnapshotRef.current = {};
        nlrDialogVirtualClickTargetRef.current = null;
        gameReadyFiredRef.current = null;
        nlrLiveGameRef.current = null;
        nlrLiveGameSessionIdRef.current = null;
        choiceRuntimeRef.current = null;
        clearCurrentDialogNametag();
        clearDevModeSavePreviewImages();
        nlrBootStartedRef.current = null;
        gameEnteredRef.current = false;
        setNlrPreloadDone(false);
        setNlrSession(null);
        setGameStageVisible(false);
        clearGameHiddenStudioPages();
    }, [
        bundle.bundleId,
        clearCurrentDialogNametag,
        clearGameHiddenStudioPages,
        detachTextReadTracker,
        rejectPendingGameStarts,
    ]);

    useEffect(() => {
        nlrCharacterPromptTokenRef.current?.cancel();
        nlrCharacterPromptTokenRef.current = null;
        nlrPreferenceTokenRef.current?.cancel();
        nlrPreferenceTokenRef.current = null;
        // Not nlrCompiledRef: mountNlrSession sets it for the new session before this fires.
        nlrCurrentActionTokenRef.current?.cancel();
        nlrCurrentActionTokenRef.current = null;
        currentActionIdRef.current = null;
        cancelSceneTracking();
        detachTextReadTracker();
        preferenceSnapshotRef.current = {};
        nlrDialogVirtualClickTargetRef.current = null;
        gameReadyFiredRef.current = null;
        nlrLiveGameRef.current = null;
        nlrLiveGameSessionIdRef.current = null;
        choiceRuntimeRef.current = null;
        clearCurrentDialogNametag();
        // The previous environment is gone; drop its engine subscriptions. The
        // next onLiveGameReady re-attaches, and plugin listeners never move.
        pluginHost?.detachSession();
    }, [clearCurrentDialogNametag, detachTextReadTracker, nlrSession?.id, pluginHost]);

    useEffect(() => {
        if (!host.ready || !core || !hostAdapterBundle) {
            return;
        }
        // Wait for the initial surface to prepaint, unless the game stage has already been
        // revealed (a direct story launch covers the surfaces, which then never prepaint).
        if (activeEntry && !prepaintReadyKeys.has(activeEntry.key) && !gameStageVisible) {
            return;
        }
        const sig = `${bundle.bundleId}:${bundle.revision}`;
        if (appBootFiredRef.current === sig) {
            return;
        }
        appBootFiredRef.current = sig;
        const surfaceStore = core.scopeBridge.getSurfaceStore(hostAdapterBundle.runtimeScopeId);
        void dispatchGlobalBlueprintEvent({
            blueprintDocument: bundle.ui.localBlueprints,
            persistentVariables: bundle.ui.persistentVariables,
            eventName: "appBoot",
            hostAdapter: hostAdapterBundle.hostAdapter,
            debug: core.debug,
            getSurfaceState: key => surfaceStore.get(key),
            setSurfaceState: (key, value) => surfaceStore.set(key, value),
            executionManager: core.executionManager,
        });
    }, [activeEntry, bundle, core, gameStageVisible, host.ready, hostAdapterBundle, prepaintReadyKeys]);

    useEffect(() => {
        if (!host.ready || !core || !hostAdapterBundle || !activeSurface || !activeSurfaceKeyboardReady) {
            return;
        }
        const dispatchKeyboardEvent = (eventName: "keyDown" | "keyUp", event: KeyboardEvent) => {
            // Typing into a text field must not also drive the game's global keys — otherwise
            // entering a name would advance dialogue on space and open the menu on Escape. The
            // widget's own keyboard event still fires: it arrives through DOM bubbling, not here.
            if (isTextEntryTarget(event.target)) {
                return;
            }
            const payload = keyboardBlueprintPayload(event);
            const eventControl = getOrCreateDomEventPropagationControl(event);
            // A widget-level keyboard handler may already have stopped propagation
            // (Stop Event Bubble); documented semantics skip the app-level dispatch then.
            if (eventControl.isPropagationStopped()) {
                return;
            }
            const surfaceStore = core.scopeBridge.getSurfaceStore(hostAdapterBundle.runtimeScopeId);
            void dispatchGlobalBlueprintEvent({
                blueprintDocument: bundle.ui.localBlueprints,
                persistentVariables: bundle.ui.persistentVariables,
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
                    blueprintDocument: bundle.ui.localBlueprints,
                    persistentVariables: bundle.ui.persistentVariables,
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
            }).catch(err => host.log("error", normalizeError(err)));
        };
        const onKeyDown = (event: KeyboardEvent) => dispatchKeyboardEvent("keyDown", event);
        const onKeyUp = (event: KeyboardEvent) => dispatchKeyboardEvent("keyUp", event);
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
        };
    }, [activeSurface, activeSurfaceKeyboardReady, bundle, core, host, hostAdapterBundle]);

    /**
     * Holding the skip key. Studio's loop, not the engine's - see `skipRunController` for why the
     * binding had to move, and `createNlrGameWithGameUi` for where it moved to.
     *
     * Everything the loop needs is read through refs at the moment it needs it, so the controller
     * survives a preference change, a story launch and a dialog beat without being rebuilt; it is
     * rebuilt only when the session or "is the story on screen" answer changes, and rebuilding it
     * ends any run in flight, which is the right thing when the stage goes away underneath one.
     */
    useEffect(() => {
        const game = nlrSession?.game;
        if (!game) {
            return;
        }
        // Loosened on purpose: `skipReadText` is Studio's own preference riding in the engine's
        // store (see `preferenceRuntime`), so it is not in `GamePreference` and the typed accessor
        // would refuse it.
        const preference = (game as { preference?: { getPreference?: (key: string) => unknown } }).preference;
        const readPreference = (key: string): unknown => preference?.getPreference?.(key);
        const readNumber = (key: string, fallback: number): number => {
            const value = readPreference(key);
            return typeof value === "number" && Number.isFinite(value) ? value : fallback;
        };
        const controller = createSkipRunController({
            matchesSkipKey: key => game.keyMap.match(STUDIO_SKIP_KEY_BINDING, key),
            // `skip` is the author's permission to skip at all, and `isInGame` is what keeps a held
            // key on a title screen from advancing the story behind it.
            canSkip: () => isInGame() && readPreference("skip") !== false,
            isBlocked: () => {
                // A session that went away mid-hold ends the run rather than ticking into nothing.
                if (!nlrLiveGameRef.current?.getGameState()) {
                    return true;
                }
                return readPreference("skipReadText") === true
                    && textReadTrackerRef.current?.isCurrentTextUnread() === true;
            },
            getSkipDelay: () => readNumber("skipDelay", 0),
            getSkipInterval: () => readNumber("skipInterval", 100),
            skipOnce: () => nlrLiveGameRef.current?.skipDialog(),
            isTextEntryTarget,
        });
        const onKeyDown = (event: KeyboardEvent) => controller.handleKeyDown(event);
        const onKeyUp = (event: KeyboardEvent) => controller.handleKeyUp(event);
        // A window that loses focus mid-hold never delivers the keyup, and the run would go on
        // skipping behind whatever the player switched to.
        const onBlur = () => controller.stop();
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        window.addEventListener("blur", onBlur);
        return () => {
            controller.stop();
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
            window.removeEventListener("blur", onBlur);
        };
    }, [isInGame, nlrSession]);

    // Route game preference changes through a ref-held closure so the subscription
    // created in onLiveGameReady always dispatches with the current surface context.
    useEffect(() => {
        if (!host.ready || !core || !hostAdapterBundle || !activeSurface) {
            dispatchPreferenceChangeRef.current = null;
            return;
        }
        dispatchPreferenceChangeRef.current = (key, value, previousValue) => {
            const eventPayload = { key, value: value ?? null, previousValue: previousValue ?? null };
            const surfaceStore = core.scopeBridge.getSurfaceStore(hostAdapterBundle.runtimeScopeId);
            void dispatchGlobalBlueprintEvent({
                blueprintDocument: bundle.ui.localBlueprints,
                persistentVariables: bundle.ui.persistentVariables,
                eventName: "gamePreferenceChanged",
                eventPayload,
                hostAdapter: hostAdapterBundle.hostAdapter,
                debug: core.debug,
                getSurfaceState: stateKey => surfaceStore.get(stateKey),
                setSurfaceState: (stateKey, stateValue) => surfaceStore.set(stateKey, stateValue),
                executionManager: core.executionManager,
            }).then(() => dispatchSurfaceBlueprintEvent({
                blueprintDocument: bundle.ui.localBlueprints,
                persistentVariables: bundle.ui.persistentVariables,
                surfaceId: activeSurface.id,
                runtimeScopeId: hostAdapterBundle.runtimeScopeId,
                eventName: "gamePreferenceChanged",
                eventPayload,
                hostAdapter: hostAdapterBundle.hostAdapter,
                debug: core.debug,
                getSurfaceState: stateKey => surfaceStore.get(stateKey),
                setSurfaceState: (stateKey, stateValue) => surfaceStore.set(stateKey, stateValue),
                executionManager: core.executionManager,
            })).catch(err => host.log("error", normalizeError(err)));
        };
        return () => {
            dispatchPreferenceChangeRef.current = null;
        };
    }, [activeSurface, bundle, core, host, hostAdapterBundle]);

    // Window fullscreen transitions come from the main process, so they also cover
    // fullscreen toggled outside the game. Unlike the preference subscription this
    // one is owned by the host, so the effect can subscribe directly.
    useEffect(() => {
        if (!host.ready || !core || !hostAdapterBundle || !activeSurface || !host.subscribeFullscreenChanged) {
            return;
        }
        return host.subscribeFullscreenChanged(isFullscreen => {
            const eventPayload = { isFullscreen };
            const surfaceStore = core.scopeBridge.getSurfaceStore(hostAdapterBundle.runtimeScopeId);
            void dispatchGlobalBlueprintEvent({
                blueprintDocument: bundle.ui.localBlueprints,
                persistentVariables: bundle.ui.persistentVariables,
                eventName: "windowFullscreenChanged",
                eventPayload,
                hostAdapter: hostAdapterBundle.hostAdapter,
                debug: core.debug,
                getSurfaceState: stateKey => surfaceStore.get(stateKey),
                setSurfaceState: (stateKey, stateValue) => surfaceStore.set(stateKey, stateValue),
                executionManager: core.executionManager,
            }).then(() => dispatchSurfaceBlueprintEvent({
                blueprintDocument: bundle.ui.localBlueprints,
                persistentVariables: bundle.ui.persistentVariables,
                surfaceId: activeSurface.id,
                runtimeScopeId: hostAdapterBundle.runtimeScopeId,
                eventName: "windowFullscreenChanged",
                eventPayload,
                hostAdapter: hostAdapterBundle.hostAdapter,
                debug: core.debug,
                getSurfaceState: stateKey => surfaceStore.get(stateKey),
                setSurfaceState: (stateKey, stateValue) => surfaceStore.set(stateKey, stateValue),
                executionManager: core.executionManager,
            })).then(() => dispatchWidgetsBlueprintEvent({
                document: bundle.ui.uidoc,
                blueprintDocument: bundle.ui.localBlueprints,
                persistentVariables: bundle.ui.persistentVariables,
                surfaceId: activeSurface.id,
                runtimeScopeId: hostAdapterBundle.runtimeScopeId,
                eventName: "windowFullscreenChanged",
                eventPayload,
                hostAdapter: hostAdapterBundle.hostAdapter,
                debug: core.debug,
                getSurfaceState: stateKey => surfaceStore.get(stateKey),
                setSurfaceState: (stateKey, stateValue) => surfaceStore.set(stateKey, stateValue),
                executionManager: core.executionManager,
            })).catch(err => host.log("error", normalizeError(err)));
        });
    }, [activeSurface, bundle, core, host, hostAdapterBundle]);

    // The user asked to close the window; the main process holds the close open until the blueprint
    // decides. A shared event control travels through the global then surface dispatch, so a Stop
    // Event Bubble node in either cancels the close. Absent that, the window closes. Scoped like the
    // keyboard heads (global + surface): the widget dispatch path does not thread the event control.
    // Owned by the host, so the effect subscribes directly (like fullscreen).
    useEffect(() => {
        if (!host.ready || !core || !hostAdapterBundle || !activeSurface || !host.subscribeCloseRequested) {
            return;
        }
        return host.subscribeCloseRequested(async () => {
            const eventControl = createEventPropagationControl();
            const surfaceStore = core.scopeBridge.getSurfaceStore(hostAdapterBundle.runtimeScopeId);
            try {
                await dispatchGlobalBlueprintEvent({
                    blueprintDocument: bundle.ui.localBlueprints,
                    persistentVariables: bundle.ui.persistentVariables,
                    eventName: "windowCloseRequested",
                    eventControl,
                    hostAdapter: hostAdapterBundle.hostAdapter,
                    debug: core.debug,
                    getSurfaceState: stateKey => surfaceStore.get(stateKey),
                    setSurfaceState: (stateKey, stateValue) => surfaceStore.set(stateKey, stateValue),
                    executionManager: core.executionManager,
                });
                if (!eventControl.isPropagationStopped()) {
                    await dispatchSurfaceBlueprintEvent({
                        blueprintDocument: bundle.ui.localBlueprints,
                        persistentVariables: bundle.ui.persistentVariables,
                        surfaceId: activeSurface.id,
                        runtimeScopeId: hostAdapterBundle.runtimeScopeId,
                        eventName: "windowCloseRequested",
                        eventControl,
                        hostAdapter: hostAdapterBundle.hostAdapter,
                        debug: core.debug,
                        getSurfaceState: stateKey => surfaceStore.get(stateKey),
                        setSurfaceState: (stateKey, stateValue) => surfaceStore.set(stateKey, stateValue),
                        executionManager: core.executionManager,
                    });
                }
            } catch (err) {
                host.log("error", normalizeError(err));
            }
            // Default is to close; a handler that ran Stop Event Bubble cancels it.
            return !eventControl.isPropagationStopped();
        });
    }, [activeSurface, bundle, core, host, hostAdapterBundle]);

    if (!activeSurface || !activeEntry) {
        return renderPlaceholder?.() ?? null;
    }

    const gameViewport = nlrSession ? { width: nlrSession.width, height: nlrSession.height } : null;

    /**
     * What a host overlay is handed, built only if there is one asking.
     *
     * A function rather than a value so the composite is described for a reader that exists: a
     * packaged game renders no overlays at all, and it should not pay a walk of the stack per frame
     * to tell nobody what is on it.
     */
    const overlayContext = (): GameAppOverlayContext => ({
        core,
        activeSurface,
        widgetRuntimeStore,
        fastForwardToNextChoice: fastForwardToNextChoiceInGame,
        storyRuntime,
        saves: savesBridge,
        composite: buildCompositeView({
            activePageEntry: activeEntry,
            layers,
            queued: layerState.queued,
            renderedLayerKeys,
            resolution: compositeInput,
            exitPending: layerState.exitPending,
            surfaceName: surfaceId => findSurface(bundle, surfaceId)?.name ?? null,
        }),
    });

    if (!host.ready || !core || !hostAdapterBundle) {
        // Keep the same root element shape as the ready branch below: switching the root type
        // (Fragment → Provider) when the host becomes ready would make React unmount and
        // remount the whole frame subtree (StageViewportFrame and everything inside it).
        return (
            <GameLocalizationContext.Provider value={gameLocalizationRuntime}>
                {renderFrame({ activeSurface, gameViewport, children: null })}
                {renderOverlays?.(overlayContext())}
            </GameLocalizationContext.Provider>
        );
    }

    // The NLR stage drives the boot preload (onLiveGameReady → gameReady) and stays mounted
    // across both the boot-loading frame and the surface system.
    const nlrStageLayer = (
        <NlrStageLayer
            session={nlrSession}
            interactive={gameStageVisible}
            // The stage mounts (hidden) as soon as a session exists so the Player can preload,
            // which is before the surface system starts; painting it that early would flash its
            // black backdrop over the first frame. It only becomes visible on reveal.
            visible={gameStageVisible}
            renderOnStage={gameStageVisible}
            onFirstSceneReady={sessionId => {
                const pending = pendingGameStartsRef.current.get(sessionId);
                if (!pending) {
                    return;
                }
                pendingGameStartsRef.current.delete(sessionId);
                pending.resolve();
            }}
            onEnd={() => handleStoryEnd()}
            onEnvironmentReady={sessionId => {
                host.log("info", `[${host.id}] NLR environment assets preheated: ${sessionId}`);
                const pending = pendingAssetsReadyRef.current.get(sessionId);
                if (pending) {
                    pendingAssetsReadyRef.current.delete(sessionId);
                    pending.resolve();
                }
            }}
            onLiveGameReady={async (sessionId, liveGame) => {
                if (nlrSession?.id !== sessionId) {
                    return;
                }
                nlrCharacterPromptTokenRef.current?.cancel();
                nlrCharacterPromptTokenRef.current = liveGame.onCharacterPrompt(({ character }) => {
                    const sourceName = readNlrCharacterName(character);
                    const nametag = translateCharacterName(sourceName);
                    currentDialogNametagRef.current = nametag;
                    core.scopeBridge.globalSet(BLUEPRINT_GAME_NAMETAG_STATE_KEY, nametag);
                    // Staged, not consumed here: `DialogStateBridge` joins this against the mirrored
                    // character table on the dialog beat. Publishing the id rather than the derived
                    // colour is what survives a narrator line in between.
                    core.scopeBridge.globalSet(
                        BLUEPRINT_GAME_SPEAKER_CHARACTER_ID_STATE_KEY,
                        resolveSpeakerCharacterId(sourceName),
                    );
                });
                nlrPreferenceTokenRef.current?.cancel();
                nlrPreferenceTokenRef.current = subscribeGamePreferenceChanges(
                    liveGame,
                    preferenceSnapshotRef,
                    (key, value, previousValue) => {
                        dispatchPreferenceChangeRef.current?.(key, value, previousValue);
                        preferenceListenersRef.current.forEach(listener => listener());
                    },
                );
                detachTextReadTracker();
                const dialogGameState = liveGame.getGameState();
                if (dialogGameState) {
                    textReadTrackerRef.current = createTextReadTracker({
                        ...createNlrDialogReadHooks(dialogGameState),
                        persistenceGetAsync: key => core.scopeBridge.persistenceGetAsync(key),
                        // The read set is only useful across sessions - within one the tracker
                        // answers from its own Set - so reaching the store is the entire point of
                        // persisting it. It once did not, and skip-read-text skipped nothing on
                        // every playthrough after the first.
                        persistenceSet: (key, value) => {
                            void core.scopeBridge.persistenceSet(key, value);
                        },
                        setMirror: value => core.scopeBridge.globalSet(BLUEPRINT_GAME_TEXT_READ_STATE_KEY, value),
                        resolveReadKey: createReadKeyResolver(nlrSession?.compiled.actionIdBindings ?? []),
                    });
                }
                nlrLiveGameRef.current = liveGame;
                nlrLiveGameSessionIdRef.current = sessionId;
                // Puppets have no authoring surface yet, so the only way to put one on a stage is
                // from a console. Published on the window rather than a panel because the audience
                // is whoever is bringing a backend up, and what they need is to poke at a live one.
                // Remove when a character's appearance can declare a puppet and the story compiler
                // emits it; nothing in Studio reads this.
                if (nlrSession?.game.listPuppetBackends().length) {
                    const gameState = liveGame.getGameState();
                    if (gameState) {
                        (window as typeof window & { __NLS_PUPPETS__?: unknown }).__NLS_PUPPETS__ =
                            createPuppetStageHandle(nlrSession.game, gameState);
                    }
                }
                // Hand the new environment to the runtime plugin host. Called
                // per session, so a relaunch or hot reload re-binds the engine
                // events under the plugins' existing listeners.
                if (nlrSession?.compiled) {
                    pluginHost?.attachSession({ liveGame, compiled: nlrSession.compiled });
                }
                // Which scene the player is in, for the Export Progress anchor. The engine's own
                // mount/unmount pair is the only live source - the launch request never moves - and
                // the Scene->Studio id map is the inverse of this compile's own table, so a story
                // compiled with two copies of one scene still resolves by identity. Re-bound per
                // session, exactly like the play-head stream below.
                cancelSceneTracking();
                const sceneGameState = liveGame.getGameState();
                if (sceneGameState && nlrSession?.compiled) {
                    const sceneIdByScene = new Map(
                        Object.entries(nlrSession.compiled.scenes).map(([id, scene]) => [scene, id] as const),
                    );
                    nlrSceneTokensRef.current.push(
                        sceneGameState.events.on("event:state.scene.mount", (scene: Scene) => {
                            currentSceneIdRef.current = sceneIdByScene.get(scene) ?? null;
                        }),
                        sceneGameState.events.on("event:state.scene.unmount", (scene: Scene) => {
                            if (currentSceneIdRef.current === (sceneIdByScene.get(scene) ?? null)) {
                                currentSceneIdRef.current = null;
                            }
                        }),
                    );
                }
                // Play-head stream for the Dev Mode story-runtime panel: mirror the current action id
                // and fan it out to panel subscribers. Re-bound per session; the fan-out set is stable.
                nlrCurrentActionTokenRef.current?.cancel();
                currentActionIdRef.current = liveGame.getCurrentActionId();
                nlrCurrentActionTokenRef.current = liveGame.onCurrentActionChange(({ actionId }) => {
                    currentActionIdRef.current = actionId;
                    currentActionListenersRef.current.forEach(listener => {
                        try {
                            listener(actionId);
                        } catch (error) {
                            host.log("warning", `[${host.id}] current-action listener failed: ${normalizeError(error)}`);
                        }
                    });
                });
                try {
                    // Environment ready: LiveGame exists. Dispatch gameReady so global blueprints can
                    // load game settings — BEFORE the game is ever entered (no newGame yet).
                    if (gameReadyFiredRef.current !== sessionId) {
                        gameReadyFiredRef.current = sessionId;
                        const surfaceStore = core.scopeBridge.getSurfaceStore(hostAdapterBundle.runtimeScopeId);
                        await dispatchGlobalBlueprintEvent({
                            blueprintDocument: bundle.ui.localBlueprints,
                            persistentVariables: bundle.ui.persistentVariables,
                            eventName: "gameReady",
                            hostAdapter: hostAdapterBundle.hostAdapter,
                            debug: core.debug,
                            getSurfaceState: key => surfaceStore.get(key),
                            setSurfaceState: (key, value) => surfaceStore.set(key, value),
                            executionManager: core.executionManager,
                        });
                    }
                } finally {
                    // Unblock the mount (and the surface system) once the environment is initialised
                    // and gameReady has run. The game has NOT entered any story.
                    const pending = pendingEnvReadyRef.current.get(sessionId);
                    if (pending) {
                        pendingEnvReadyRef.current.delete(sessionId);
                        pending.resolve();
                    }
                }
            }}
            onError={(err, errorSessionId) => {
                // Teardown noise from an already-replaced session must not reject the current boot.
                if (nlrSession?.id !== errorSessionId) {
                    host.log("warning", `stale NLR session error (${errorSessionId}): ${normalizeError(err)}`);
                    return;
                }
                rejectPendingGameStarts(err);
                // The engine throws from inside whatever row it was running, and that row is the
                // only part of this an author can fix. Read it before anything else touches the
                // play head.
                reportFailure(err);
            }}
        />
    );

    // `nl-motion-keep` + `reducedMotion="never"` hold the game's own motion outside the Studio
    // reduced-motion preference (styles.css and the MotionConfig in lib/renderApp): what plays
    // in here is the author's work, and it has to move the way it will move for a player. The
    // PLAYER's own OS preference still lands — `useReducedMotion` above reads the media query
    // directly and is unaffected by this config. The host frame around it stays Studio chrome.
    const content = (
        <MotionConfig reducedMotion="never">
            <div className="nl-motion-keep relative h-full w-full overflow-hidden">
                {nlrStageLayer}
                {/* Runtime plugin overlays: above the game stage, below the app surface
                    system (menus, save screens, every authored page). This is as low as a
                    HOST-rendered layer can go — NarraLeaf renders the dialogue inside the
                    Player and its only injection point (Player children) is itself stacked
                    above that dialogue, so there is no DOM position under it to occupy. */}
                {pluginHost ? (
                    <div className="pointer-events-none absolute inset-0" style={{ zIndex: 5 }}>
                        <RuntimePluginOverlayLayer store={pluginHost.overlays} log={host.log} />
                    </div>
                ) : null}
                {/* Surface system starts only after the NLR environment boot preload finishes. */}
                <div className="pointer-events-none absolute inset-0 z-10">
                    <AnimatePresence
                        custom={navState.direction}
                        initial={false}
                        mode={surfacePresenceMode}
                        onExitComplete={handleSurfaceExitComplete}
                    >
                        {nlrPreloadDone
                            ? visibleSurfaceEntries.map(({ entry, surface }, layerIndex) => (
                                <AppSurfaceLayerWithAdapter
                                    key={entry.key}
                                    uidoc={bundle.ui.uidoc}
                                    blueprintDocument={bundle.ui.localBlueprints}
                                    persistentVariables={bundle.ui.persistentVariables}
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
                                    active={compositeInput.interactiveKeys.has(entry.key)}
                                    keyboardOwner={compositeInput.keyboardOwnerKey === entry.key}
                                    onInteractionReadyChange={handleSurfaceInteractionReadyChange}
                                    onPrepaintReady={handleSurfaceLayerPrepaintReady}
                                    onEnterComplete={markActiveEnterComplete}
                                />
                            ))
                            : null}
                    </AnimatePresence>
                    {/* The layers get their own presence group. Both groups are children of the box
                        above, so they share its stacking context and z order runs straight through
                        both - and, equally, every z below is measured inside that box rather than
                        against the page. Two reasons it is not one group:
                        the page lane switches to `mode="wait"` for transitions that have to empty the
                        screen first, which is a rule about replacing a screen and not about a layer
                        that is merely present through it; and `onExitComplete` fires for the whole
                        group, so a layer closing would settle a page transition that is still
                        running. Both would only misfire once a layer exists — which is exactly the
                        kind of thing that has to be impossible rather than untested. */}
                    <AnimatePresence
                        custom="forward"
                        initial={false}
                        mode="sync"
                        onExitComplete={handleLayerExitComplete}
                    >
                        {nlrPreloadDone
                            ? visibleLayers.map(({ layer, surface }, index) => (
                                <AppSurfaceLayerWithAdapter
                                    key={layer.key}
                                    uidoc={bundle.ui.uidoc}
                                    blueprintDocument={bundle.ui.localBlueprints}
                                    persistentVariables={bundle.ui.persistentVariables}
                                    core={core}
                                    entry={layer}
                                    layerIndex={LAYER_STACK_INDEX_BASE + index}
                                    surface={surface}
                                    rendererRegistry={rendererRegistry}
                                    scale={scale}
                                    createHostAdapterBundle={createHostAdapterBundle}
                                    widgetPatchesByScope={widgetPatchesByScope}
                                    widgetPatchesByScopeRef={widgetPatchesByScopeRef}
                                    widgetRuntimeStore={widgetRuntimeStore}
                                    lifecycleRef={lifecycleRef}
                                    nestedSurfaceRuntime={nestedSurfaceRuntime}
                                    blueprintLifecycleReady={prepaintReadyKeys.has(layer.key)}
                                    reducedMotion={prefersReducedMotion === true}
                                    active={compositeInput.interactiveKeys.has(layer.key)}
                                    keyboardOwner={compositeInput.keyboardOwnerKey === layer.key}
                                    scrim={layer.scrim}
                                    onInteractionReadyChange={handleSurfaceInteractionReadyChange}
                                    onPrepaintReady={handleSurfaceLayerPrepaintReady}
                                    onEnterComplete={markActiveEnterComplete}
                                />
                            ))
                            : null}
                    </AnimatePresence>
                </div>
            </div>
        </MotionConfig>
    );

    return (
        <GameLocalizationContext.Provider value={gameLocalizationRuntime}>
            {renderFrame({ activeSurface, gameViewport, children: content })}
            {renderOverlays?.(overlayContext())}
        </GameLocalizationContext.Provider>
    );
}
