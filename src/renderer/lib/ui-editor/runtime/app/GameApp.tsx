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
import { createChoiceVoicePlayer, type ChoiceVoicePlayer } from "./choiceVoicePlayback";
import { createDialogClickTargets } from "./dialogClickTargets";
import {
    readWrappedStorableNamespace,
    readWrappedStorableValue,
} from "@shared/utils/storableValue";
import {
    buildSaveBuildStamp,
    buildSaveCompatibilityStamp,
    type SaveCompatibilityStamp,
    normalizeSaveCompatibilityConfiguration,
    planSaveResume,
    readSaveCompatibilityStamp,
} from "@shared/types/saveCompatibility";
import type { DevModeStartStoryRequest } from "@shared/types/devMode";
import {
    LOCALE_RESTART_RESUME_KEY,
    LOCALE_STORAGE_KEY,
    characterTranslationUnitId,
    matchSystemLocale,
    normalizeLanguageChangeConfiguration,
    resolveLocalizedUnitText,
} from "@shared/types/localization";
import { VOICE_LOCALE_STORAGE_KEY } from "@shared/types/voice";
import { preloadGateFor } from "@shared/types/preload";
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
import { setRuntimeLocaleSource } from "@/lib/ui-editor/runtime/localization/runtimeLocale";
import { setActiveProjectLocale } from "@shared/typography/projectFonts";
import type { UISurface } from "@shared/types/ui-editor/document";
import { toBlueprintImageAsset, type BlueprintImageAsset } from "@shared/types/blueprint/valueTypes";
import {
    clearCharacterAvatarAssets,
    registerCharacterAvatarAssets,
} from "@/lib/ui-editor/runtime/characterAvatarAssets";
import {
    BLUEPRINT_GAME_CHARACTERS_STATE_KEY,
    BLUEPRINT_GAME_DIALOG_NARRATOR_STATE_KEY,
    BLUEPRINT_GAME_DIALOG_TEXT_STATE_KEY,
    BLUEPRINT_GAME_DIALOG_WAITING_STATE_KEY,
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
    type BlueprintStoryEnding,
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
    type StoryEndingReach,
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
import { listStoryEndings, savedVariableDefs, sceneVariableDefs, storyPersistentDefs } from "@shared/types/story";
import type { StoryLiteralValue } from "@shared/types/story";
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
import { createChoiceMenus } from "./choiceMenus";
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
import { translate } from "@/lib/i18n";
import { loadSaveIntoGame, SAVE_LOAD_NOTICE_DURATION_MS, type SaveLoadOutcome } from "./saveLoad";
import {
    applyLocaleChange,
    consumeFreshRestart,
    promotePendingLocale,
    resumeAfterLocaleRestart,
} from "./localeRestart";
import { createDisplayAwakeController, DISPLAY_AWAKE_RECHECK_MS } from "./displayAwake";
import { createSkipRunController } from "./skipRunController";
import { createSessionGate } from "./sessionGate";
import { createStoryStartGate, surfacesMayDraw } from "./storyBootGate";
import { normalizeError, reportRuntimeFailure, watchUncaughtFailures } from "./failureReporting";
import { createPlayHead, type PlayHead } from "./playHead";
import { applyWidgetRuntimePatch } from "./widgetRuntimePatches";
import { clonePageProps } from "./pageProps";
import { keyboardBlueprintPayload } from "./keyboardBlueprintPayload";
import type { BlueprintKeyboardEventLike } from "@shared/types/blueprint/graph";
import { UI_SURFACE_INPUT_ACTION_EVENT } from "@shared/types/ui-editor/inputActionEvent";
import { resolveSurfaceInputActionHits } from "@/lib/ui-editor/runtime/input/surfaceInputActions";
import { isTextEntryTarget } from "./isTextEntryTarget";
import { readNlrCharacterName } from "./nlrDialogReaders";
import {
    createNlrDialogReadHooks,
    createReadKeyResolver,
    createTextReadTracker,
    type TextReadTracker,
} from "./textReadTracker";
import {
    clearReachedEndings,
    forgetEndingReached,
    isEndingReached,
    markEndingReached,
    readReachedEndings,
} from "./endingsRecord";
import { withDeadline } from "./frameTiming";
import { NavigationController } from "./navigation/NavigationController";
import { useSurfaceNavigation } from "./navigation/useSurfaceNavigation";
import { LayerStackController, mountSurfaceLayer, type SurfaceLayerEntry } from "./layers/LayerStackController";
import { useLayerStack } from "./layers/useLayerStack";
import { resolveCompositeInput } from "./layers/compositeInput";
import { buildCompositeView } from "./layers/compositeView";
import { isPageEntryDrawn, isStageCovered } from "./layers/stageOcclusion";
import { createStageAdvanceHolder, holdStageAdvance, type StageAdvanceHolder } from "./stageAdvanceHold";
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
import type { WeatherSeedRef } from "@shared/weather/model";
import { weatherSpecForStage } from "@shared/weather/stage";

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
/** The longest the surfaces are held back for a resume. A cover that never lifts is its own bug. */
const LOCALE_RESUME_COVER_MAX_MS = 10_000;
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

function findSurface(bundle: GameAppHost["bundle"], surfaceId: string | null | undefined): UISurface | null {
    if (surfaceId) {
        const surface = bundle.ui.uidoc.surfaces.find(item => item.id === surfaceId);
        if (surface) {
            return surface;
        }
    }
    return bundle.ui.uidoc.surfaces.find(surface => surface.kind === "appSurface") ?? bundle.ui.uidoc.surfaces[0] ?? null;
}

/**
 * The three acts a game can be driven through from outside it.
 *
 * Every one of them is something a player does with a pointer, and each goes through the path that
 * pointer would take: `startStory` is the host call a title screen's Start button makes, `advance`
 * clicks the dialogue, and `choose` goes through the choice runtime the `Select Choice` blueprint
 * node uses. Nothing here reaches past the game to move it by hand, so a game that cannot be played
 * cannot be driven either - which is what makes driving one evidence about it.
 *
 * Published to the shell rather than exported as a module handle, because they only exist while a
 * game app is mounted and there may be more than one of those in a window.
 */
export type GameAppTestControls = {
    startStory(request: { storyId: string; sceneId: string }): Promise<void>;
    advance(): Promise<void>;
    choose(index: number): Promise<void>;
};

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
    /**
     * Called with {@link GameAppTestControls} once this app can be driven, and with `null` when it
     * cannot any more.
     *
     * Only the standalone game runtime passes it, and only so a test harness on the other side of
     * its control socket can play the game. Omitted by every other host, which is what keeps a
     * window nobody is testing free of a handle that could move it.
     */
    onTestControlsChanged?: (controls: GameAppTestControls | null) => void;
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
        onTestControlsChanged,
    } = props;
    const bundle = host.bundle;
    /**
     * The bundle as of the latest render, for work that began under an older one.
     *
     * A hot reload replaces the bundle without remounting this component, so anything already in
     * flight goes on holding the bundle it captured. Comparing the two is how such a job can tell
     * that what it is about to report describes a document nobody is looking at any more.
     */
    const currentBundleRef = useRef(bundle);
    currentBundleRef.current = bundle;
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
                // Before the stored language is read, and in this effect rather than its own so the
                // order is not a matter of which effect React runs first: a player who deferred a
                // change last session is owed it now, and everything below - and every line the
                // game is about to render - has to see the language they chose, not the one they
                // were in when they chose it.
                await promotePendingLocale({
                    persistenceGetAsync: key => core.scopeBridge.persistenceGetAsync(key),
                    persistenceSet: (key, value) => core.scopeBridge.persistenceSet(key, value),
                });
                if (cancelled) {
                    return;
                }
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
    /**
     * The same answer, for readers that are not components.
     *
     * The blueprint evaluator resolves an asset set on a node the moment a pin is read, which
     * happens inside synchronous graph execution - no React context to reach and no promise to
     * await. See `runtimeLocale.ts` for why that is a module-level holder rather than another field
     * threaded through the resolve runtime.
     */
    useEffect(() => {
        if (!gameLocalizationRuntime) {
            return;
        }
        return setRuntimeLocaleSource({
            getLocale: gameLocalizationRuntime.getLocale,
            sourceLocale: gameLocalizationRuntime.bundle.sourceLocale,
        });
    }, [gameLocalizationRuntime]);
    /**
     * The language the project's default font stack resolves in.
     *
     * A rung of that stack may be restricted to some languages (see `@shared/types/typography`), so
     * a game read in Japanese and the same game read in Simplified Chinese are set in different
     * faces - which is the point, Han unification meaning the two want different glyphs for the same
     * characters. Nothing below this line knows about languages: every text widget goes on asking
     * `resolveFontStackIds` the same question, and the answer changes because this published.
     *
     * Here rather than in each host's boot code because both hosts of this component - Dev Mode and
     * the shipped game - reach their language through exactly this runtime, and two publishes would
     * be two things to keep saying the same. The editor's own publish is `BrandService`'s, and this
     * component is never mounted in the workspace window, so the two can never fight.
     *
     * Subscribed, not read once. Choosing a language restarts the game, so the subscription is not
     * what carries an in-game switch - it is what carries the *first* one, the system-language match
     * a few lines above, which lands after this component has already mounted.
     */
    useEffect(() => {
        if (!gameLocalizationRuntime) {
            // A project with no localization set up has no language, and an empty one filters
            // nothing - the whole stack, which is what it held before restrictions existed.
            setActiveProjectLocale("");
            return;
        }
        const publish = (): void => setActiveProjectLocale(gameLocalizationRuntime.getLocale());
        publish();
        return gameLocalizationRuntime.subscribe(publish);
    }, [gameLocalizationRuntime]);
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
    /**
     * The boot in flight, for callers that need the story environment before they can do
     * anything - see {@link GameAppHost.surfacesBeforeStoryBoot}. With the surfaces drawn ahead
     * of the boot, Start Game can be pressed while the environment is still mounting, and the
     * press has to wait for it rather than start a second compile of the same story.
     */
    const nlrBootPromiseRef = useRef<Promise<void> | null>(null);
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
    /**
     * The last frame of a run that has ended, kept on screen until the page taking over is painted.
     *
     * Entering a game already waits for its destination: `enterMountedGame` holds until the first
     * scene is on a painted frame and only then hides the pages. Leaving one did the opposite - the
     * stage went first and the page then played its enter animation over an empty screen - so every
     * quit, and every `/ending` and `/quit` row, flashed the background between the two.
     *
     * Deliberately separate from {@link gameStageVisible} rather than a delay on it: that flag is
     * what `Is In Game`, the advance hold and stage interactivity all read, and the run really is
     * over the moment this begins. So the flag drops immediately and this keeps only the pixels.
     */
    const [stageRetainedForQuit, setStageRetainedForQuit] = useState(false);
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
    /** The player's way into a story, held open while a boot is still running. */
    const storyStartGate = useMemo(
        () => createStoryStartGate({ pendingBoot: nlrBootPromiseRef, start: startStoryInGameRef }),
        [],
    );
    const cleanupBundleIdRef = useRef<string | null>(null);
    /** The runtime core whose language-restart resume has already been attempted. */
    const localeResumeAttemptedRef = useRef<unknown>(null);
    /**
     * Whether this launch owes the player a run and has not put it back yet.
     *
     * It holds the surface stack back while that is true. The screen the player left is not the
     * screen they are coming back to, and painting the title for the second and a half a load takes
     * would be showing them a place they never went. What they get instead is what a boot already
     * looks like before its first surface - the shell's own background - and then their line.
     */
    const [localeResumePending, setLocaleResumePending] = useState(false);
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
     * The pages this bundle can put on the screen.
     *
     * The same question the surface stack asks before it draws an entry or a layer, so an overlay
     * naming a page the bundle does not contain is absent from the screen and absent from the
     * occlusion answer at once. Without it such a layer holds the story against a stage nothing is
     * covering - see `stageOcclusion`.
     */
    const drawableSurfaceIds = useMemo(
        () => new Set(bundle.ui.uidoc.surfaces.map(surface => surface.id)),
        [bundle.ui.uidoc.surfaces],
    );
    /**
     * Whether the story is the thing the player is looking at, rather than merely the thing behind
     * what they are looking at.
     *
     * `isInGame` answers "is a session mounted with its stage on screen", and stays true under a
     * settings screen the player opened mid-game - which is correct for it, and is what lets a quick
     * menu drawn over the stage know it has a game to act on. Anything that drives the story forward
     * on its own needs the narrower question, because the stage being on screen underneath a menu is
     * not the player watching it. MEASURED: skipping turned on from the quick menu and then Config
     * opened ran the story to its end behind the settings screen.
     *
     * Both stores are read at call time, never captured: they are external stores exactly so a
     * reader outside React gets the answer for this instant. See `sessionGate` for why anything a
     * Game UI slot surface can reach has to be built that way.
     */
    const isStoryOnScreen = useCallback((): boolean => {
        if (!isInGame()) {
            return false;
        }
        return !isStageCovered({
            pageEntries: navigation.getState().navStack,
            pagesHiddenForGame: studioPageHiddenForGameRef.current,
            gameHiddenKeys: gameHiddenNavKeysRef.current,
            layers: layerStack.getSnapshot().layers,
            drawableSurfaceIds,
        });
    }, [drawableSurfaceIds, isInGame, layerStack, navigation]);
    /**
     * The same question as `isStoryOnScreen`, asked of this render rather than of this instant.
     *
     * One predicate, two readers: the skip loop runs outside React and needs the answer for the
     * moment it steps, while a suspension on the engine has to be taken and handed back as the
     * answer changes, which is a dependency. Both read `isStageCovered` over the same four inputs -
     * the states here are the reactive view of the stores the callback above reads.
     */
    const stageCovered = isStageCovered({
        pageEntries: navStack,
        pagesHiddenForGame: studioPageHiddenForGame,
        gameHiddenKeys: gameHiddenNavKeys,
        layers,
        drawableSurfaceIds,
    });
    /**
     * The stopwatch behind `Get Playtime`, the reading written onto every save, and the title's
     * running total. Mounted here rather than beside the autosave scheduler because `writeSave`
     * below reads it, and a save has to record the time at the moment it is written.
     */
    const playtime = usePlaytime({
        isPlaying: isPlaythroughRunning,
        // The store the two functions below reach, so the hook can wait for it and read again when
        // it is replaced. Without it the stored total is read on the hook's first commit, when the
        // core is still null, and never again.
        persistenceSource: core?.scopeBridge ?? null,
        // Optional-chained because the runtime core is null until the bundle mounts.
        persistenceGetAsync: async key => core?.scopeBridge.persistenceGetAsync(key),
        // Not awaited: the value is readable the moment this returns, the clock has already
        // counted the seconds, and a failed disk write only means the next flush carries them.
        persistenceSet: (key, value) => {
            void core?.scopeBridge.persistenceSet(key, value);
        },
    });
    const nlrDialogClickTargets = useMemo(() => createDialogClickTargets(), []);
    const nlrCharacterPromptTokenRef = useRef<{ cancel(): void } | null>(null);
    const nlrPreferenceTokenRef = useRef<{ cancel(): void } | null>(null);
    // Play head + call-stack introspection (Dev Mode story-runtime panel). The current-action token
    // is re-bound to whichever LiveGame is live; `currentActionListenersRef` is a stable fan-out so
    // panel subscriptions survive relaunches. `nlrCompiledRef` mirrors the mounted session's compiled
    // story (action bindings + variable namespace names) for the bridge to read at call time.
    const nlrCurrentActionTokenRef = useRef<{ cancel(): void } | null>(null);
    const currentActionListenersRef = useRef<Set<(actionId: string | null) => void>>(new Set());
    const nlrCompiledRef = useRef<CompiledNlrStory | null>(null);
    /**
     * The play head, holding both the engine's raw action id and the last row it could name.
     *
     * Built once and never rebuilt: it reads the binding table through a callback, so a hot reload
     * that recompiles the story is picked up without the play head being replaced under the
     * subscriptions that feed it. See `playHead` for why the last NAMED row is the answer rather
     * than the current action.
     */
    const playHead = useMemo<PlayHead>(
        () => createPlayHead(() => nlrCompiledRef.current?.actionIdBindings ?? []),
        [],
    );
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
    const playHeadBlockId = useCallback((): string | undefined => playHead.blockId(), [playHead]);
    /**
     * Log a failure AND, for hosts that can point into the story, say where it came from.
     *
     * Both, always: the console line is what a packaged build has, and dropping it here would trade
     * one blind spot for another. The shape of the report lives in `failureReporting`; what this
     * adds is the one thing only `GameApp` knows, which is where the play head was standing.
     */
    const reportFailure = useCallback((error: unknown, options?: { prefix?: string }) => {
        // Compile diagnostics report their own block and do not come through here; everything that
        // does is a thrown failure, so the play head is the only attribution available.
        const blockId = playHeadBlockId();
        reportRuntimeFailure(host, error, {
            ...(options?.prefix ? { prefix: options.prefix } : {}),
            ...(blockId ? { blockId } : {}),
        });
    }, [host, playHeadBlockId]);
    /**
     * The failures that never reach a call site this file wraps.
     *
     * Every `reportFailure` above sits at the bottom of something Studio called and can therefore
     * catch. A story row is not one of those: the engine advances it from inside its own `Player`,
     * driven by a plain DOM click listener, and a throw out of a DOM listener is not a React render
     * error — so the `Player`'s own error boundary never sees it, `NlrStageLayer`'s `onError` never
     * fires, and the failure lands in the console as `Uncaught` with nothing else to show for it.
     * That is a stage frozen mid-line while the Problems panel says nothing went wrong. A session's
     * first advance escapes the same way with a different label, as an unhandled rejection: the
     * engine schedules it on a bare microtask.
     *
     * Watching the window catches both, and watching is all it does. Nothing is consumed (see
     * `watchUncaughtFailures`), so the console keeps the throw and its stack exactly as before, and
     * nothing here touches the stage: it stays frozen on the row that failed, which is both honest
     * and where the author needs to look. The row itself comes from the play head, as it does for
     * every other thrown failure.
     *
     * Only for a host that can show issues. That is Dev Mode's authoring surface and nothing else:
     * a packaged game installs its own hooks at the renderer entry (`runtimeErrorHooks`) and shows
     * its own crash screen, and must not grow a second reporter behind them.
     */
    useEffect(() => {
        if (!host.reportIssue) {
            return;
        }
        return watchUncaughtFailures(window, reportFailure);
    }, [host.reportIssue, reportFailure]);
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
    /**
     * Depth of a preference write Studio made to move the engine rather than to record a choice.
     *
     * There is one: re-arming auto-forward after a settings screen closes writes `autoForward` the
     * value it already holds, because that write is the only way to schedule the line on screen
     * again (see `stageAdvanceHold`). The engine's store emits on every write, changed or not, so
     * without this the author's `On Preference Changed` would report a setting the player did not
     * touch. Synchronous, like the emit it brackets.
     */
    const engineNudgeDepthRef = useRef(0);
    const subscribeGamePreferences = useCallback((listener: () => void) => {
        preferenceListenersRef.current.add(listener);
        return () => {
            preferenceListenersRef.current.delete(listener);
        };
    }, []);
    const currentDialogNametagRef = useRef<string | null>(null);
    const choiceMenus = useMemo(() => createChoiceMenus(), []);
    const prefersReducedMotion = useReducedMotion();

    // The choice voice player is built once and outlives any one render, so the host it logs through
    // is read here rather than captured.
    const hostRef = useRef(host);
    useEffect(() => {
        hostRef.current = host;
    }, [host]);

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
        playHead.reset();
        cancelSceneTracking();
        nlrCompiledRef.current = null;
        gameEnteredRef.current = false;
        setNlrPreloadDone(false);
        setNlrSession(null);
    }, [bundle.bundleId, host.entrySurfaceId, playHead]);

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

    const clearCurrentDialogState = useCallback(() => {
        currentDialogNametagRef.current = null;
        core?.scopeBridge.globalSet(BLUEPRINT_GAME_NAMETAG_STATE_KEY, null);
        // Who was speaking and what colour that made the nametag are part of the same fact; leaving
        // either behind would tint a screen after the game they belonged to is gone.
        core?.scopeBridge.globalSet(BLUEPRINT_GAME_SPEAKER_CHARACTER_ID_STATE_KEY, null);
        core?.scopeBridge.globalSet(BLUEPRINT_GAME_SPEAKER_COLOR_STATE_KEY, null);
        // The line the dialog was on, for the same reason. `DialogStateBridge` blanks these when it
        // unmounts, but a session can end without the dialog ever having been mounted, and a title
        // screen must not read the last playthrough's line back as one still waiting to be advanced.
        core?.scopeBridge.globalSet(BLUEPRINT_GAME_DIALOG_WAITING_STATE_KEY, false);
        core?.scopeBridge.globalSet(BLUEPRINT_GAME_DIALOG_TEXT_STATE_KEY, "");
        core?.scopeBridge.globalSet(BLUEPRINT_GAME_DIALOG_NARRATOR_STATE_KEY, false);
    }, [core]);

    // A menu has registered what it is showing: the one moment its options and the index each of
    // them answers to are both in hand. Every menu on the stage reports, so a concurrent pair is two
    // choices shown rather than one.
    useEffect(() => choiceMenus.onShown(runtime => {
        pluginHost?.emitChoiceShown(runtime.items.map(item => ({
            index: item.index,
            text: item.text,
            disabled: item.disabled,
        })));
    }), [choiceMenus, pluginHost]);

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

    /**
     * One saved variable of the running playthrough, for a Game UI screen.
     *
     * Read off the live `Storable` for the same reason the visited record is: the values change
     * while the story runs and a mirror would need a write beat on every `/set`. The id is resolved
     * through the CURRENT compile's own table rather than through the bundle's registry, because
     * that table is the merge the story itself writes against - registry entries plus whatever
     * `/save` rows a legacy document still carries - so a screen and a row always mean the same
     * variable by the same id.
     *
     * `found` distinguishes the three ways this can come back empty (no game, an id this story does
     * not declare, a namespace the compile never built) from a variable that genuinely holds null.
     * A variable that exists but has never been written reads as `found` with its declared default,
     * which is what the story would see too.
     */
    const getSavedVariableInGame = useCallback((variableId: string): { value: unknown; found: boolean } => {
        const id = String(variableId ?? "").trim();
        const compiled = nlrCompiledRef.current;
        const liveGame = nlrLiveGameRef.current;
        const definition = id ? compiled?.savedVariables?.[id] : undefined;
        if (!liveGame || !compiled?.savedNamespaceName || !definition) {
            return { value: null, found: false };
        }
        try {
            const storable = liveGame.getStorable();
            if (!storable.hasNamespace(compiled.savedNamespaceName)) {
                return { value: null, found: false };
            }
            const namespace = storable.getNamespace(compiled.savedNamespaceName);
            // `has` rather than a nullish check on the read: a variable holding null, false or 0 is
            // set, and falling back to the default for those would report the opposite of the truth.
            const stored = namespace.has(definition.storageKey)
                ? namespace.get(definition.storageKey)
                : definition.defaultValue ?? null;
            return { value: stored ?? null, found: true };
        } catch {
            return { value: null, found: false };
        }
    }, []);

    /**
     * Write one saved variable of the running playthrough, for a Game UI screen.
     *
     * The mirror of {@link getSavedVariableInGame}, resolved through the same table for the same
     * reason - the screen and the row have to mean one variable by one id - and refusing where that
     * one reports. A read has to answer while a screen lays out; a write is a button doing what the
     * player asked, so every way it can fail is said out loud rather than dropped:
     *
     * - no playthrough to write into,
     * - an id this build's story does not declare (a variable deleted since the screen was drawn),
     * - a value that cannot go into a save file.
     *
     * The value goes straight into the live `Storable`, which is what the save serializes, so it is
     * in the next save and gone on the next `newGame()`. Nothing is told about it: the story does
     * not re-run on the strength of it, and the undo stack does not know it happened.
     */
    const setSavedVariableInGame = useCallback((variableId: string, value: unknown): void => {
        const id = String(variableId ?? "").trim();
        const compiled = nlrCompiledRef.current;
        const liveGame = nlrLiveGameRef.current;
        if (!liveGame || !compiled?.savedNamespaceName) {
            throw new Error("Set Saved Var: game runtime is not available");
        }
        const definition = id ? compiled.savedVariables?.[id] : undefined;
        if (!definition) {
            throw new Error("Set Saved Var: this story declares no such saved variable");
        }
        // The same guard the story's own writes take (`assertSerializable`). A function or a symbol
        // in a namespace does not fail here - it fails when the save is written, on a screen the
        // player is looking at, with nothing to say which write put it there.
        if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
            throw new Error("Set Saved Var: saved variables must hold serializable values");
        }
        const storable = liveGame.getStorable();
        if (!storable.hasNamespace(compiled.savedNamespaceName)) {
            throw new Error("Set Saved Var: game runtime is not available");
        }
        storable.getNamespace(compiled.savedNamespaceName).set(definition.storageKey, value);
    }, []);

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
     * The endings record, in project persistence rather than in the running game.
     *
     * Nothing here touches a live story, and that is the requirement rather than an accident: an
     * endings gallery is opened from the title screen, before any game exists. The record is read
     * off the persistence session map, which the runtime hydrates from the store when the adapter is
     * installed, so a synchronous pure reader still sees what earlier playthroughs recorded.
     *
     * No runtime core at all - a Page previewed inside the editor - reads as "not reached" and makes
     * both wipes no-ops, which lets the screen lay out rather than fault.
     */
    const endingsPersistence = useCallback(() => {
        const bridge = core?.scopeBridge;
        if (!bridge) {
            return null;
        }
        return {
            getAsync: (key: string) => bridge.persistenceGetAsync(key),
            get: (key: string) => bridge.persistenceGet(key),
            set: (key: string, value: unknown) => bridge.persistenceSet(key, value),
        };
    }, [core]);

    const isEndingReachedInGame = useCallback((endingId: string): boolean => {
        const persistence = endingsPersistence();
        return persistence ? isEndingReached(persistence, endingId) : false;
    }, [endingsPersistence]);

    /**
     * Which DLC are installed, as a set, so a menu that asks about several draws in one pass.
     *
     * Read off the host rather than looked up anywhere: a DLC is a file beside the game, and the
     * host is the only half of this that can see the filesystem. Nothing supplied is "none", which
     * is what a build with nothing beside it and an editor preview both mean.
     */
    const installedDlcIds = useMemo(
        () => new Set(host.installedDlcIds ?? []),
        [host.installedDlcIds],
    );

    const isDlcInstalledInGame = useCallback(
        (dlcId: string): boolean => installedDlcIds.has(dlcId.trim()),
        [installedDlcIds],
    );

    /**
     * One story's endings, joined against the record.
     *
     * The list comes from the story document this build ships (`bundle.storyLibrary.documents`),
     * scanned with the same `listStoryEndings` the compiler emits from - so a row an author disabled
     * is absent here exactly as it is absent from the build, and the screen can never offer an
     * ending the player could not reach.
     *
     * The story id is tried as a key first and then searched for, the way every other library lookup
     * here does it: the key is the id the project filed the document under, which a build that moved
     * a story between documents may have changed.
     */
    const listEndingsInGame = useCallback((storyId: string): BlueprintStoryEnding[] => {
        const documents = bundle.storyLibrary?.documents;
        if (!documents || !storyId) {
            return [];
        }
        const document = documents[storyId]
            ?? Object.values(documents).find(candidate => candidate.id === storyId);
        if (!document) {
            return [];
        }
        const persistence = endingsPersistence();
        const reached = persistence ? readReachedEndings(persistence) : [];
        return listStoryEndings(document).map(ending => ({
            endingId: ending.endingId,
            name: ending.name,
            sceneId: ending.sceneId,
            sceneName: ending.sceneName,
            isReached: reached.includes(ending.endingId),
        }));
    }, [bundle.storyLibrary, endingsPersistence]);

    const clearEndingStateInGame = useCallback(async (endingId: string): Promise<void> => {
        const persistence = endingsPersistence();
        if (persistence) {
            await forgetEndingReached(persistence, endingId);
        }
    }, [endingsPersistence]);

    const clearEndingsInGame = useCallback(async (): Promise<void> => {
        const persistence = endingsPersistence();
        if (persistence) {
            await clearReachedEndings(persistence);
        }
    }, [endingsPersistence]);

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
        nlrDialogClickTargets.set(target);
    }, [nlrDialogClickTargets]);

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
        choiceMenus,
        currentDialogNametagRef,
        dialogClickTargets: nlrDialogClickTargets,
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

    /**
     * Speak one choice option, at most one instance of that option at a time.
     *
     * The bookkeeping - which option is already speaking, and what `Interrupt Others` stops - lives
     * in {@link createChoiceVoicePlayer}. This supplies only the start: a fresh `Sound` per play,
     * for the reason `playVoiceUnit` gives, on the bus the compile assigned, so a per-character
     * voice bus and the player's fader for it apply here exactly as they do to a spoken line.
     *
     * Built once per mount and held in a ref: the map of speaking options must survive a render, and
     * every read it needs is through a ref already.
     */
    const choiceVoicePlayerRef = useRef<ChoiceVoicePlayer | null>(null);
    if (!choiceVoicePlayerRef.current) {
        choiceVoicePlayerRef.current = createChoiceVoicePlayer({
            start: async unitId => {
                const liveGame = nlrLiveGameRef.current;
                const playback = nlrCompiledRef.current?.getVoicePlayback?.(unitId);
                if (!liveGame || !playback) {
                    return null;
                }
                return await liveGame.playSound(new Sound({ src: playback.src, type: playback.busId }));
            },
            onError: error => hostRef.current?.log(
                "warning",
                `Play Choice Voice: ${error instanceof Error ? error.message : String(error)}`,
            ),
        });
    }

    const playChoiceVoiceUnit = useCallback(
        (unitId: string, options: { interruptOthers: boolean }): Promise<boolean> =>
            choiceVoicePlayerRef.current?.play(unitId, options) ?? Promise.resolve(false),
        [],
    );

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
        await fastForwardToNextChoice(liveGame, choiceMenus);
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
        getCurrentActionId: () => playHead.actionId(),
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
    }), [playHead]);

    const quitGame = useCallback(async (surfaceId: string): Promise<void> => {
        const targetSurfaceId = String(surfaceId ?? "").trim();
        if (!targetSurfaceId) {
            throw new Error("Quit Game: surfaceId is required");
        }
        rejectPendingGameStarts(new NlrSessionSupersededError("Quit Game"));
        // The run ends here, and the screen changes hands in two steps.
        //
        // First everything that answers "is a game being played" says no: the stage stops taking
        // clicks, `Is In Game` reports false, and the advance hold lets go of a line nobody will
        // read. Only the pixels are kept (`stageRetainedForQuit`), so the page opening over them
        // has something to arrive on instead of the background.
        //
        // The session itself, and every piece of state the run left behind, is torn down *after*
        // the page is up. Doing it before would empty the dialogue box and drop the on-stage
        // widgets while the frame they belong to is still on screen - a worse artefact than the
        // blank one this replaces.
        setGameStageVisible(false);
        setStageRetainedForQuit(true);
        activeStoryRequestRef.current = null;
        activeStoryRevisionRef.current = null;
        gameEnteredRef.current = false;
        nlrCharacterPromptTokenRef.current?.cancel();
        nlrCharacterPromptTokenRef.current = null;
        nlrPreferenceTokenRef.current?.cancel();
        nlrPreferenceTokenRef.current = null;
        nlrCurrentActionTokenRef.current?.cancel();
        nlrCurrentActionTokenRef.current = null;
        playHead.reset();
        cancelSceneTracking();
        nlrCompiledRef.current = null;
        detachTextReadTracker();
        preferenceSnapshotRef.current = {};
        nlrDialogClickTargets.clear();
        gameReadyFiredRef.current = null;
        nlrLiveGameRef.current = null;
        nlrLiveGameSessionIdRef.current = null;
        stageWarmupRef.current = null;
        try {
            await openSurface(targetSurfaceId, undefined, { presentation: "appPage" });
        } finally {
            // Held back until the page is up because each of these three changes what the retained
            // frame looks like: the dialogue box would empty, the menu would vanish and the speaker
            // would lose their portrait, all while that frame is still the thing on screen.
            clearCharacterAvatarAssets();
            choiceMenus.clear();
            clearCurrentDialogState();
            // Everything under the page just opened belonged to the run that has ended: the screens
            // the player had open over the stage, and the title screen the playthrough started
            // from. They were hidden while the game held the screen and `clearGameHiddenStudioPages`
            // below is about to un-hide them, so leaving them there means Back from a fresh title
            // screen walks into a playthrough that is gone - and each quit stacks another set.
            navigation.collapseToActive();
            // A layer belongs to the surface that showed it, and every surface that could still own
            // one has just been dropped. A confirm left standing over the title screen would be
            // asking about a game that no longer exists.
            layerStack.clear();
            setNlrSession(null);
            clearGameHiddenStudioPages();
            // Last, and in the same commit as the unmount above: the frame is only worth keeping
            // while something is still arriving over it. In `finally` because a page that failed to
            // open must not leave a dead stage painted over whatever the player is looking at.
            setStageRetainedForQuit(false);
        }
    }, [
        clearCurrentDialogState,
        clearGameHiddenStudioPages,
        detachTextReadTracker,
        layerStack,
        navigation,
        nlrDialogClickTargets,
        openSurface,
        playHead,
        rejectPendingGameStarts,
        setGameStageVisible,
        setNlrSession,
    ]);

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
     * An `/ending` row ran: record it, tell the plugins, and land the player.
     *
     * All three belong here rather than in the compiled statement, because all three are the host's:
     * the record outlives every save and lives in project persistence, the event hub is the host's,
     * and the session about to be torn down is the host's. The compiled row's whole contribution is
     * saying which ending it was.
     *
     * The record is written first and not awaited by the rest. An ending that opened its page before
     * the write landed would be one a player could see and then find locked, and the navigation must
     * not wait on a store write either - the page is what the player is owed immediately.
     *
     * With no page (`{kind:"none"}`, or nothing declared anywhere) the playthrough is left exactly
     * where it is, which is what every build did before endings existed: the last frame stays. Rows
     * written after the ending in the same list were dropped at compile time, so in the ordinary
     * shape - an ending as the last row of a branch - there is nothing left to play either way.
     */
    const handleEndingReached = useCallback((ending: StoryEndingReach) => {
        const persistence = endingsPersistence();
        if (persistence) {
            void markEndingReached(persistence, ending.endingId).catch(error => {
                // Reported, never thrown: the player has reached the ending whatever the store did,
                // and a failed write must not take the window down on the last screen of the game.
                host.log("error", `[${host.id}] the ending could not be recorded: ${normalizeError(error)}`);
            });
        }
        pluginHost?.emitEndingReached({ endingId: ending.endingId, name: ending.name });

        // The row decides, then the build. `none` is a decision and stops here; absent means the row
        // did not decide, so the build's own ending page answers.
        const page = ending.page?.kind === "none"
            ? ""
            : ending.page?.kind === "surface"
                ? ending.page.surfaceId.trim()
                : endingSurfaceId;
        if (!page) {
            return;
        }
        void quitGame(page).catch(error => {
            host.log("error", `[${host.id}] the ending page could not be opened: ${normalizeError(error)}`);
        });
    }, [endingSurfaceId, endingsPersistence, host, pluginHost, quitGame]);

    /**
     * A `/quit` row ran: the playthrough is over and this page takes the screen.
     *
     * Routed through `quitGame` for the reason the ending page is, and it is the whole of what this
     * row does. Nothing is recorded: a quit is not an ending, no plugin is told one was reached, and
     * the endings record is left exactly as the run found it - which is the entire difference
     * between the two rows and the reason this one exists.
     *
     * A page that will not open is reported rather than thrown, like the ending page next door: the
     * run is over either way, and taking the window down with it helps nobody.
     */
    const handleQuitToPage = useCallback((surfaceId: string) => {
        void quitGame(surfaceId).catch(error => {
            host.log("error", `[${host.id}] the quit page could not be opened: ${normalizeError(error)}`);
        });
    }, [host, quitGame]);

    /**
     * What this build is, for comparing every save it is asked to list or load against.
     *
     * The whole hash table rather than one number, because the save side names one story and this
     * side has to answer for all of them: a save screen lists slots from every route the player has
     * been on, with no story mounted.
     *
     * Null when the bundle carries no hashes at all - one assembled before they existed - which
     * turns every comparison into "cannot be compared" and leaves loading exactly as it was.
     */
    const saveBuild = useMemo(
        () => (bundle.storyHashes && Object.keys(bundle.storyHashes).length > 0
            ? buildSaveBuildStamp({ storyHashes: bundle.storyHashes, gameVersion: bundle.gameVersion })
            : null),
        [bundle.gameVersion, bundle.storyHashes],
    );
    /**
     * The stamp for a save taken right now, which is a fact about the story on the stage.
     *
     * A ref read rather than a memo: the mounted story changes without the bundle changing, and a
     * stamp captured when the bundle last did would name whichever route the player started on for
     * every save they take afterwards.
     */
    const currentSaveStamp = useCallback((): SaveCompatibilityStamp | null => {
        const storyId = activeStoryRequestRef.current?.storyId ?? "";
        const hash = storyId ? bundle.storyHashes?.[storyId] : undefined;
        if (!hash) {
            return null;
        }
        return buildSaveCompatibilityStamp({ storyId, storyHash: hash, gameVersion: bundle.gameVersion });
    }, [bundle.gameVersion, bundle.storyHashes]);
    const saveCompatibilityConfig = useMemo(
        () => normalizeSaveCompatibilityConfiguration(bundle.saveCompatibility),
        [bundle.saveCompatibility],
    );
    /**
     * What this project asked for when the player changes language mid-playthrough. Read from the
     * bundle like every other policy the shipped game obeys, so a build behaves the same in Dev
     * Mode, in a preview and in the packaged game.
     */
    const languageChange = useMemo(
        () => normalizeLanguageChangeConfiguration(bundle.languageChange),
        [bundle.languageChange],
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
            currentSaveStamp() ?? undefined,
            playtime.getRunSeconds(),
        );
        // Host-side, after the write landed: every shell reports it the same way,
        // and a failed write never announces a save that does not exist.
        pluginHost?.emitSaveWritten(id);
    }, [
        currentSaveStamp,
        host.saveStore,
        playtime,
        pluginHost,
        reportSaveCaptureFailure,
        requireActiveLiveGame,
    ]);

    /**
     * The running playthrough as bytes, for a slot that names it.
     *
     * Null rather than a throw when nothing is running: `Current Game` is the node that decides
     * what an empty answer means, and it has a clearer sentence for the author than anything this
     * could raise. Guarded on the game having been entered, not merely mounted - a warmed
     * environment nobody has started has no playthrough to capture, and serializing one would hand
     * back a game at row zero as though the player had been there.
     */
    const captureRun = useCallback((): unknown | null => {
        const liveGame = nlrLiveGameRef.current;
        if (!liveGame || !gameEnteredRef.current) {
            return null;
        }
        try {
            return liveGame.serialize();
        } catch {
            return null;
        }
    }, []);

    /** The serialized game in a slot, for a launch that inherits from it. */
    const readSaveGame = useCallback(async (id: string): Promise<unknown | null> => {
        const record = await host.saveStore.read(id);
        return record?.savedGame ?? null;
    }, [host.saveStore]);

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

        /**
         * The live game every step below talks to, read fresh rather than captured.
         *
         * `prepareStory` can replace the session mid-load - that is what putting the save's own
         * story on the stage means - and a closure holding the game from before it would check its
         * ids against a story nobody is running any more, then deserialize into it. The assertion
         * above still runs once, because "there is no game runtime at all" is a caller mistake.
         */
        const activeLiveGame = (): LiveGame => nlrLiveGameRef.current ?? liveGame;

        /**
         * The story that was mounted when the load began, so a failed switch can put it back.
         *
         * Null when nothing had been launched yet, which is the ordinary state of a title screen:
         * there is nothing to go back to and nothing that needs restoring.
         */
        const storyBeforeLoad = activeStoryRequestRef.current;
        let switchedStory = false;

        /**
         * The engine's page router, told to report the next time it has finished emptying itself -
         * registered BEFORE the load rather than after it.
         *
         * `apply` below calls `router.clear()`, and the router emits its exit-complete from a
         * microtask. Every `await` between that call and this listener therefore ran the emission
         * past an empty room: the wait further down never settled, ran its whole deadline, and the
         * three seconds it spent doing so were three seconds with the stage still hidden and the
         * screen the player loaded from still on top of it - on every single load. MEASURED against
         * a load from an in-game save screen.
         *
         * Cancelled on every path that does not reach the wait, so a refused load leaves no
         * listener behind.
         */
        const routerExit = liveGame.waitForRouterExit();

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
            build: saveBuild,
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
                    const game = activeLiveGame();
                    const construct = (game as unknown as {
                        constructMaps?: () => unknown;
                    }).constructMaps;
                    if (typeof construct !== "function") {
                        return null;
                    }
                    const tables = construct.call(game);
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
                readStoryHash: () => activeLiveGame().story?.hash() ?? null,
                snapshot: () => activeLiveGame().serialize(),
                apply: savedGame => {
                    const game = activeLiveGame();
                    game.game.router.clear().cleanHistory();
                    game.newGame().deserialize(savedGame);
                },
                /**
                 * Put the run back - and, when this load switched stories, put the story back too.
                 *
                 * The snapshot names ids that belong to the story that was mounted when the load
                 * began. Handing it to the story the switch mounted instead would refuse every one
                 * of them, so the mount is undone first and only then is the snapshot applied.
                 * `forceReinit` for the same reason the relaunch below passes it: the fast path
                 * would see a matching request and skip the recompile the put-back depends on.
                 */
                restore: async snapshot => {
                    if (switchedStory && storyBeforeLoad) {
                        const start = startStoryInGameRef.current;
                        if (!start) {
                            throw new Error("the story that was running cannot be started again");
                        }
                        await start({
                            storyId: storyBeforeLoad.storyId,
                            sceneId: storyBeforeLoad.sceneId,
                        }, { forceReinit: true });
                        switchedStory = false;
                    }
                    activeLiveGame().deserialize(snapshot);
                },
                // `deserialize` takes this lock on the way in and gives it back from a render it
                // schedules on the way out, so a throw in between keeps it. It is a flag, not a
                // count, which is why one balanced load afterwards cannot clear it and every later
                // load in the session would sit there locked.
                releaseLoadLock: () => activeLiveGame().getGameState()?.rollLock.unlock(),
                /**
                 * Which of the project's stories this save belongs to.
                 *
                 * The scene is resolved against the whole library - by the id the anchor carries,
                 * then by search, exactly as `relaunch` does - so a save survives its scene being
                 * moved to another document between builds.
                 *
                 * Whether the mounted story has been *entered* is deliberately not part of this. A
                 * title screen warms its story without entering it and a load from there has always
                 * applied straight into that session; remounting it would put a recompile and a
                 * remount on the most common load there is.
                 */
                resolveStoryMount: target => {
                    const found = resolveSavedScene(target.storyId, target.sceneId);
                    if (!found) {
                        return "nowhere";
                    }
                    const mounted = activeStoryRequestRef.current;
                    return mounted && mounted.storyId === found.storyId ? "same" : "switch";
                },
                /**
                 * Put that story on the stage, so `apply` has somewhere to deserialize into.
                 *
                 * A story launch rather than a bare mount, because a launch is what reveals the
                 * stage - the save is applied over what it puts up, and `apply` opens with
                 * `newGame()` anyway, so nothing it plays survives into the loaded state. The
                 * launch is aimed at the save's own scene so the assets it warms are the ones the
                 * save is about to need.
                 *
                 * The flag goes up BEFORE the launch, not after: a launch that throws halfway has
                 * already replaced the session, and `restore` has to know to bring the previous
                 * story back before it can put the run back.
                 */
                switchStory: async target => {
                    const found = resolveSavedScene(target.storyId, target.sceneId);
                    if (!found) {
                        throw new Error(`the story holding scene ${target.sceneId} is not in this build`);
                    }
                    const start = startStoryInGameRef.current;
                    if (!start) {
                        throw new Error("the story cannot be started here");
                    }
                    switchedStory = true;
                    await start({ storyId: found.storyId, sceneId: target.sceneId }, { forceReinit: true });
                },
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
            notifyPlayer: message => activeLiveGame().notify(message, SAVE_LOAD_NOTICE_DURATION_MS),
            report: (level, message) => {
                host.log(level, message);
                host.reportIssue?.({ level, message, origin: "session" });
            },
        }).catch((error: unknown) => {
            routerExit.cancel();
            throw error;
        });
        if (outcome.status !== "loaded") {
            routerExit.cancel();
            return outcome;
        }
        // A relaunch has already entered and revealed its own session (that is what `Start Game`
        // does); the live game this closure captured is the one it replaced. Waiting on it here
        // would wait on a session nobody is driving any more. A load that switched stories is in
        // exactly the same position - it launched the save's own story to receive the save - except
        // that it IS a load, so it still inherits the save's stopwatch reading below.
        if (outcome.applied !== "save") {
            routerExit.cancel();
            return outcome;
        }
        // Only here: a load that was refused or rolled back leaves the player on the run they were
        // already having, and that run's stopwatch has to keep its own reading. A record with no
        // reading (written before playtime was tracked) starts the inherited run from zero, which
        // is the only honest answer when nobody was counting. One seeding point for both endings
        // below, because both of them are the save being applied.
        playtime.seedRun(storedPlaytimeSeconds ?? 0);
        gameEnteredRef.current = true;
        if (outcome.storyChanged) {
            // The launch that put the save's own story up has already entered and revealed its
            // session, so there is no reveal left to wait for - and the router being waited on
            // belongs to the session that launch replaced.
            routerExit.cancel();
            host.log("info", translate("game.saveLoad.storyStarted", { id }));
            return outcome;
        }
        /**
         * Let the engine's router finish emptying before the stage is revealed.
         *
         * The deadline stays, and stays for the reason it was added: an exit that does not arrive
         * must not strand the caller. An unbounded wait here means the save IS applied and the
         * player is back where they were, while everything after this line - the reveal, and
         * whatever the caller meant to do next - simply never happens. MEASURED: resuming after a
         * language restart left the parked save on disk for exactly this reason, on a run that had
         * otherwise gone perfectly.
         *
         * What changed is where the listener is registered (see `routerExit` above). It used to be
         * attached here, after the emission had already gone past, so the deadline was not a
         * fallback - it was the only way out, and every load paid it in full.
         */
        await withDeadline(routerExit.promise, SAVE_LOAD_ROUTER_EXIT_TIMEOUT_MS);
        routerExit.cancel();
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
        saveBuild,
        saveCompatibilityConfig,
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
    const handleLocaleChanged = useCallback(async (code: string): Promise<void> => {
        await applyLocaleChange({
            isPlaythroughRunning,
            inGame: languageChange.inGame,
            writeSave: id => writeSave(id),
            persistenceSet: async (key, value) => {
                await core?.scopeBridge.persistenceSet(key, value);
            },
            restartApplication: host.restartApplication,
            report: reportLocaleRestart,
        }, code);
    }, [core, host.restartApplication, isPlaythroughRunning, languageChange, reportLocaleRestart, writeSave]);

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
        /**
         * Is anything owed? Asked before anything is waited for, and only to decide what the player
         * looks at while the answer is acted on.
         *
         * A boot that owes a resume is going to put the stage up in a moment, so the surfaces that
         * would otherwise paint first - the title screen the player just left - are held back until
         * it does. Peeking costs one store read on every launch and saves every resumed launch a
         * flash of a screen the player did not ask to see. The marker is read again, and cleared,
         * by the resume itself; this read decides nothing but the cover.
         */
        const pendingSeam = {
            persistenceGetAsync: (key: string) => scope.persistenceGetAsync(key),
            persistenceSet: (key: string, value: unknown) => scope.persistenceSet(key, value),
        };
        const deadline = Date.now() + LOCALE_RESUME_SESSION_WAIT_MS;
        const settle = (ms = LOCALE_RESUME_POLL_MS) => new Promise(resolve => { window.setTimeout(resolve, ms); });
        /**
         * The environment this launch is meant to act on, ready and standing still.
         *
         * Two conditions, both learned from a real run. The session has to belong to THIS bundle
         * revision: the refs still describe the previous one until a reload's mount replaces them,
         * and a load into the session being torn down is thrown away by the mount that follows -
         * the player lands at the top of the scene with their parked run already deleted. And the
         * environment has to have stopped moving: a mount publishes its live game a moment before
         * whatever started it enters the game, and entering calls `newGame()`, which wipes exactly
         * what the load just put back.
         *
         * Answers false when neither happens in time. A launch that never produces a game must
         * leave what it was owed for the next one rather than consume it into nothing.
         */
        const sessionPrefix = `${bundle.bundleId}:${bundle.revision}:`;
        const environmentIsMine = () => Boolean(hasLiveGame() && nlrSessionIdRef.current?.startsWith(sessionPrefix));
        const waitForOwnEnvironment = async (): Promise<boolean> => {
            while (!environmentIsMine()) {
                if (Date.now() > deadline) {
                    return false;
                }
                await settle();
            }
            await settle(LOCALE_RESUME_SETTLE_MS);
            return environmentIsMine();
        };
        /**
         * A restart the player is not meant to come back from, which only this host has to act on.
         *
         * A packaged game ends and starts again on its title screen, so by the time this runs there
         * is nothing to leave. Dev Mode restarts by reloading its session, and a reload deliberately
         * puts the author back into the story they were testing - so without this the same setting
         * would end a playthrough in the shipped game and quietly keep it in the editor. Waited for
         * the same way the resume is, because the run this has to end is still coming up.
         */
        if (await consumeFreshRestart(pendingSeam)) {
            setLocaleResumePending(true);
            try {
                // The surface this launch starts on, which is where a player who restarted with
                // nothing kept belongs. A host that names none has no page to leave to, and the
                // run simply stays - the same degradation the ending page takes.
                const entrySurfaceId = host.entrySurfaceId?.trim();
                if (entrySurfaceId && await waitForOwnEnvironment() && isPlaythroughRunning()) {
                    await quitGame(entrySurfaceId);
                }
            } catch (error) {
                reportLocaleRestart("error", `The game could not be returned to its start after the language change: ${normalizeError(error)}`);
            } finally {
                setLocaleResumePending(false);
            }
            return;
        }
        let owed = false;
        try {
            owed = typeof await scope.persistenceGetAsync(LOCALE_RESTART_RESUME_KEY) === "string";
        } catch {
            owed = false;
        }
        if (!owed) {
            return;
        }
        setLocaleResumePending(true);
        // The cover is capped for the reason every cover is: a screen that never lifts is worse
        // than the one it was hiding. If the resume is still going by then the player gets the
        // title screen and the load lands under it, which is the behaviour without a cover at all.
        const coverCap = window.setTimeout(() => setLocaleResumePending(false), LOCALE_RESUME_COVER_MAX_MS);
        const uncover = () => {
            window.clearTimeout(coverCap);
            setLocaleResumePending(false);
        };
        if (!await waitForOwnEnvironment()) {
            uncover();
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
            // Contained here rather than raised: the caller is a boot, and a boot that reports
            // itself as failed takes the whole stage down with it. Nothing that can go wrong in a
            // resume is worse than the title screen the player gets by falling through it.
            reportLocaleRestart("error", `The playthrough could not be resumed after the language change: ${normalizeError(error)}`);
        } finally {
            uncover();
        }
    }, [
        bundle.bundleId,
        bundle.revision,
        core,
        deleteSave,
        hasLiveGame,
        host.entrySurfaceId,
        isPlaythroughRunning,
        loadSaveForGraph,
        quitGame,
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
                saveBuild,
                saveCompatibilityConfig,
            ).plan.action !== "discard")
            .map(header => header.id);
    }, [host.saveStore, saveBuild, saveCompatibilityConfig]);

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
                saveBuild,
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
    }, [host.saveStore, saveBuild, saveCompatibilityConfig]);

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
        const snapshotId = request.snapshotId?.trim() || undefined;
        const scene = storyDocument.scenes[sceneId];
        // The selected Scene Snapshot's persistent overrides go in FIRST, because the stage walk
        // below reads the same store to decide which arm of a persistent condition the scene took.
        // Written after it, they would settle the story the author is about to play while the stage
        // in front of them was posed down the branch they did not choose.
        const overrides = snapshotId
            ? scene?.sceneSnapshots?.find(entry => entry.id === snapshotId)?.values
            : undefined;
        if (startBlockId && overrides) {
            for (const [refKey, value] of Object.entries(overrides)) {
                if (refKey.startsWith("persistent:")) {
                    core?.scopeBridge.persistenceSet(refKey.slice("persistent:".length), value);
                }
            }
        }
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
                    // The persistent half of the same argument, plus the store to read it from. A
                    // persistent variable is the one scope the walk cannot reconstruct - it outlives
                    // the run - and Dev Mode has the profile that holds it, so the pre-pose and the
                    // tail decide every persistent condition from one value instead of two.
                    persistentVariables: bundle.ui.persistentVariables,
                    ...(core
                        ? { readPersistent: (key: string) => core.scopeBridge.persistenceGet(key) as StoryLiteralValue | null | undefined }
                        : {}),
                }),
            }
            : undefined;
        // The rest of the overlay: scene/saved values feed the pre-pose seeds (the persistent ones
        // are already in the store above, and the compiled story reads them live).
        if (launch && overrides) {
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
            // Forwarded, and the size and frame rate decided here: a weather clip is baked to the
            // project's own stage at the project's own rate, both of which this component knows and
            // the compiler deliberately does not. A host with no baker passes nothing and its
            // weather rows compile to a diagnostic.
            ...(host.resolveWeatherClip
                ? {
                      resolveWeatherClip: (ref: WeatherSeedRef) =>
                          host.resolveWeatherClip!(weatherSpecForStage(ref, bundle.ui.uidoc, bundle.vfx)),
                  }
                : {}),
            blueprintDocument: bundle.ui.localBlueprints,
            persistentVariables: bundle.ui.persistentVariables,
            // The saved half of the same registry. This is the call both shipping runtimes go through
            // — Dev Mode and the packaged game — so leaving it out meant a project-level saved variable
            // existed in the editor and nowhere else.
            savedVariables: bundle.ui.savedVariables,
            onEndingReached: handleEndingReached,
            onQuitToPage: handleQuitToPage,
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
        };
        // Before the walk, not during it: the compiler resolves an asset the moment it reaches one,
        // and a host that has to ask another window for each answer spends the whole compile waiting
        // one round trip at a time. Failures inside it are the host's to swallow - it answers by
        // asset again, which is what every compile did before this existed.
        await host.prewarmStoryAssetUrls?.();
        const compiled = await compileStudioStoryToNlr(compileInput);
        // Only the compile that is still the current one gets to complain. A hot reload can land
        // while this one is waiting on something slow, and what it found then is about a document
        // the author has already replaced.
        //
        // Which stopped being merely untidy once a bake could be interrupted: a weather clip dropped
        // because the caller that wanted it moved on comes back here as "could not be produced", so
        // every digit typed into a density would leave a warning about a number the author has
        // already typed over, on a stage that is showing the new one perfectly.
        const superseded = currentBundleRef.current.bundleId !== bundle.bundleId
            || currentBundleRef.current.revision !== bundle.revision;
        if (!superseded && compiled.diagnostics.length > 0) {
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
            getWindowScaleOptions: host.getWindowScaleOptions,
            getWindowScale: host.getWindowScale,
            setWindowScale: host.setWindowScale,
            getWindowSize: host.getWindowSize,
            setWindowSize: host.setWindowSize,
            startStoryInGame: storyStartGate,
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
            choiceMenus,
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
            // The author's pause length, from the bundle. A bundle written before the setting
            // carries nothing and gets the engine's own value, which is what those builds shipped.
            ...(bundle.dialogue ? { autoForwardDefaultPause: bundle.dialogue.autoForwardDefaultPause } : {}),
            ...(bundle.preload ? { preloadGate: preloadGateFor(bundle.preload.behavior) } : {}),
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
            // `autoForwardDelay` is the engine's config rather than one of its preferences, and it
            // is read again for every line, so writing it here is enough for a change made in a
            // settings screen to take effect on the next one.
            configureEngine: config => game.configure(config),
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
        playHead.reset();
        cancelSceneTracking();
        nlrCompiledRef.current = compiled;
        registerCharacterAvatarAssets(compiled.avatarAssetIdByUrl);
        choiceMenus.clear();
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
        host.getWindowScaleOptions,
        host.getWindowScale,
        host.setWindowScale,
        host.getWindowSize,
        host.setWindowSize,
        isCurrentTextReadInGame,
        clearTextReadInGame,
        isEndingReachedInGame,
        isDlcInstalledInGame,
        listEndingsInGame,
        clearEndingStateInGame,
        clearEndingsInGame,
        isInGame,
        isNvlModeInGame,
        listSaveIds,
        loadSaveAction,
        makeStateAccessors,
        nextInGame,
        openSurface,
        playHead,
        quitGame,
        rejectPendingGameStarts,
        rendererRegistry,
        canRedoHistoryInGame,
        canUndoHistoryInGame,
        redoHistoryInGame,
        restoreHistoryInGame,
        selectChoiceInGame,
        choiceMenus,
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
        options?: { forceReinit?: boolean; inheritSavedGame?: unknown },
    ): Promise<void> => {
        if (!activeSurface || !core) {
            throw new Error("Start Game: active surface is not available");
        }
        const storyId = String(request.storyId ?? "").trim();
        const sceneId = String(request.sceneId ?? "").trim();
        const startBlockId = request.startBlockId?.trim() || undefined;
        const snapshotId = request.snapshotId?.trim() || undefined;

        // Queued rather than written, for the reason the ref exists: entering calls `newGame()`,
        // which clears every namespace, so values written now would be the ones it wipes. Set here
        // rather than beside the mount because the fast path below enters without mounting at all.
        //
        // Only when this launch was given one. A relaunch fills the same ref before it calls in,
        // and overwriting it with nothing would drop what that load was carrying.
        if (options?.inheritSavedGame !== undefined && options.inheritSavedGame !== null) {
            pendingCarriedSaveRef.current = options.inheritSavedGame as SavedGame;
        }

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

    /**
     * Publish the drive handle to a shell that asked for one, and take it back on unmount.
     *
     * Nothing is built when the prop is absent, so the handle does not exist in a window nobody is
     * driving. Every method reaches the live game through the same callbacks the blueprint host API
     * does, and each of them already refuses - loudly, with a sentence - when there is no game to
     * act on, so the caller hears about a command that arrived too early rather than watching it
     * disappear.
     */
    useEffect(() => {
        // Published only once a story could actually be started, which is what the handle claims:
        // `startStoryInGame` refuses outright until there is an active surface to start one on, and
        // a shell holding a handle that throws has no way to tell "not yet" from "not ever". The
        // window between the two is real - the control socket opens while this component is still
        // mounting - and it is exactly where a driven run used to lose its start.
        //
        // `nlrSession` is in the condition for the second half of the same window: the boot preload
        // mounts an environment of its own, and a start that lands mid-mount is cancelled by it
        // (`NlrSessionSupersededError`). A mounted session is the game saying that pass is over.
        if (!onTestControlsChanged || !activeSurface || !core || !nlrSession) {
            return;
        }
        onTestControlsChanged({
            startStory: request => startStoryInGame({ storyId: request.storyId, sceneId: request.sceneId }),
            advance: () => nextInGame(),
            choose: (index: number) => selectChoiceInGame(index),
        });
        return () => onTestControlsChanged(null);
    }, [activeSurface, core, nextInGame, nlrSession, onTestControlsChanged, selectChoiceInGame, startStoryInGame]);

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
            onGetWindowScaleOptions: host.getWindowScaleOptions,
            onGetWindowScale: host.getWindowScale,
            onSetWindowScale: host.setWindowScale,
            onGetWindowSize: host.getWindowSize,
            onSetWindowSize: host.setWindowSize,
            onShowLayer: showLayer,
            onHideLayer: hideLayer,
            onHideLayerGroup: hideLayerGroup,
            onWaitLayer: waitLayer,
            onCloseOwnLayer: closeOwnLayer,
            onIsLayerMounted: isLayerMounted,
            onStartStory: startStoryInGame,
            onCaptureRun: captureRun,
            onReadSaveGame: readSaveGame,
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
            onGetSavedVariable: getSavedVariableInGame,
            onSetSavedVariable: setSavedVariableInGame,
            onIsOptionPicked: isOptionPickedInGame,
            onClearVisited: clearVisitedInGame,
            onIsEndingReached: isEndingReachedInGame,
            onIsDlcInstalled: isDlcInstalledInGame,
            onListEndings: listEndingsInGame,
            onClearEndingState: clearEndingStateInGame,
            onClearEndings: clearEndingsInGame,
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
            onStorageDurability: host.storageDurability,
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
            // Same reason the slot surfaces seed theirs: a host API rebuilt for a scope that is
            // already drawn has to start from what is on screen, or every write back to an
            // authored value is dropped as a no-op. See `initialWidgetPatches`.
            initialWidgetPatches: widgetPatchesByScopeRef.current[runtimeScopeId],
            widgetRuntimeStore,
            localizationConfig: bundle.localization ?? null,
            voiceConfig: bundle.voice ?? null,
            onPlayVoice: playVoiceUnit,
            onPlayChoiceVoice: playChoiceVoiceUnit,
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
        host.getWindowScaleOptions,
        host.getWindowScale,
        host.setWindowScale,
        host.getWindowSize,
        host.setWindowSize,
        showLayer,
        hideLayer,
        hideLayerGroup,
        waitLayer,
        closeOwnLayer,
        isLayerMounted,
        isCurrentTextReadInGame,
        clearTextReadInGame,
        isEndingReachedInGame,
        isDlcInstalledInGame,
        listEndingsInGame,
        clearEndingStateInGame,
        clearEndingsInGame,
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

        nlrBootPromiseRef.current = (async () => {
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
        if (!host.ready || !core) {
            return;
        }
        if (localeResumeAttemptedRef.current === core) {
            return;
        }
        localeResumeAttemptedRef.current = core;
        // Deliberately not waiting for the boot preload to finish: it takes seconds, and the answer
        // to "is a run owed" has to be in hand before the first surface paints or the player sees
        // the title screen they are about to be taken off. The resume itself waits for the
        // environment; only the question is asked early.
        void resumeLocaleRestart();
    }, [core, host.ready, resumeLocaleRestart]);

    const visibleSurfaceEntries = bundle.ui.uidoc.surfaces.length > 0
        ? visibleEntries
            .filter(entry => entry.sessionKey === host.sessionKey)
            .filter(entry => isPageEntryDrawn({
                entryKey: entry.key,
                pagesHiddenForGame: studioPageHiddenForGame,
                gameHiddenKeys: gameHiddenNavKeys,
            }))
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
    /**
     * Whether the surface stack may draw. Everything the boot preload gates, plus the moment a
     * language restart is putting a playthrough back: see `localeResumePending`.
     *
     * A host may say it does not want to wait for the boot at all (Dev Mode does); the language
     * restart still holds, because that one is putting a playthrough back on screen and drawing
     * over it would show the player the wrong one.
     */
    const surfacesReady = surfacesMayDraw({
        storyBootFinished: nlrPreloadDone,
        hostDrawsBeforeStoryBoot: host.surfacesBeforeStoryBoot === true,
        localeResumePending,
    });
    const renderedLayerKeys = new Set(surfacesReady ? visibleLayers.map(item => item.layer.key) : []);
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
        isPageEntryDrawn({
            entryKey: activeEntry.key,
            pagesHiddenForGame: studioPageHiddenForGame,
            gameHiddenKeys: gameHiddenNavKeys,
        }) &&
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
                    onGetWindowScaleOptions: host.getWindowScaleOptions,
                    onGetWindowScale: host.getWindowScale,
                    onSetWindowScale: host.setWindowScale,
                    onGetWindowSize: host.getWindowSize,
                    onSetWindowSize: host.setWindowSize,
                    onShowLayer: showLayer,
                    onHideLayer: hideLayer,
                    onHideLayerGroup: hideLayerGroup,
                    onWaitLayer: waitLayer,
                    onCloseOwnLayer: closeOwnLayer,
                    onIsLayerMounted: isLayerMounted,
                    onStartStory: startStoryInGame,
                    onCaptureRun: captureRun,
                    onReadSaveGame: readSaveGame,
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
                    onGetSavedVariable: getSavedVariableInGame,
                    onSetSavedVariable: setSavedVariableInGame,
                    onIsOptionPicked: isOptionPickedInGame,
                    onClearVisited: clearVisitedInGame,
                    onIsEndingReached: isEndingReachedInGame,
                    onIsDlcInstalled: isDlcInstalledInGame,
                    onListEndings: listEndingsInGame,
                    onClearEndingState: clearEndingStateInGame,
                    onClearEndings: clearEndingsInGame,
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
                    onStorageDurability: host.storageDurability,
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
                    // As above: a frame's page keeps its drawing when its host API is rebuilt.
                    initialWidgetPatches: widgetPatchesByScopeRef.current[runtimeScopeId],
                    widgetRuntimeStore,
                    localizationConfig: bundle.localization ?? null,
                    voiceConfig: bundle.voice ?? null,
                    onPlayVoice: playVoiceUnit,
                    onPlayChoiceVoice: playChoiceVoiceUnit,
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
        host.getWindowScaleOptions,
        host.getWindowScale,
        host.setWindowScale,
        host.getWindowSize,
        host.setWindowSize,
        showLayer,
        hideLayer,
        hideLayerGroup,
        waitLayer,
        closeOwnLayer,
        isLayerMounted,
        isCurrentTextReadInGame,
        clearTextReadInGame,
        isEndingReachedInGame,
        isDlcInstalledInGame,
        listEndingsInGame,
        clearEndingStateInGame,
        clearEndingsInGame,
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
        playHead.reset();
        cancelSceneTracking();
        nlrCompiledRef.current = null;
        clearCharacterAvatarAssets();
        detachTextReadTracker();
        preferenceSnapshotRef.current = {};
        nlrDialogClickTargets.clear();
        gameReadyFiredRef.current = null;
        nlrLiveGameRef.current = null;
        nlrLiveGameSessionIdRef.current = null;
        choiceMenus.clear();
        clearCurrentDialogState();
        clearDevModeSavePreviewImages();
        nlrBootStartedRef.current = null;
        gameEnteredRef.current = false;
        setNlrPreloadDone(false);
        setNlrSession(null);
        setGameStageVisible(false);
        clearGameHiddenStudioPages();
    }, [
        bundle.bundleId,
        clearCurrentDialogState,
        clearGameHiddenStudioPages,
        detachTextReadTracker,
        nlrDialogClickTargets,
        playHead,
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
        playHead.reset();
        cancelSceneTracking();
        detachTextReadTracker();
        preferenceSnapshotRef.current = {};
        nlrDialogClickTargets.clear();
        gameReadyFiredRef.current = null;
        nlrLiveGameRef.current = null;
        nlrLiveGameSessionIdRef.current = null;
        choiceMenus.clear();
        clearCurrentDialogState();
        // The previous environment is gone; drop its engine subscriptions. The
        // next onLiveGameReady re-attaches, and plugin listeners never move.
        pluginHost?.detachSession();
    }, [clearCurrentDialogState, detachTextReadTracker, nlrDialogClickTargets, nlrSession?.id, playHead, pluginHost]);

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
            // Inert for a key today, and kept anyway. An element head is a subscription rather than
            // a claim, so nothing a widget runs can silence the surface any more - the one case that
            // ever mattered, typing into a text field, is answered unconditionally above. What still
            // reaches here is `Keep Window Open`, which stops propagation while a close request is
            // being answered; a key arriving inside that window has no business starting anything.
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
            }).then(() => {
                // The keyboard half of the surface's declared actions.
                //
                // Here rather than beside the pointer half in `GameSurfaceRenderer`, because a key
                // press is not aimed at anything: it belongs to whichever surface currently owns the
                // keys, and that is a fact about the whole composite that only this level knows. For
                // the same reason nothing consumes here - `consume` decides how far down the lanes
                // under a pointer an input travels, and a key has no lanes under it.
                if (eventName !== "keyDown" || eventControl.isPropagationStopped()) {
                    return undefined;
                }
                const actionHits = resolveSurfaceInputActionHits({
                    vocabulary: bundle.ui.uidoc.actions,
                    enablements: activeSurface.actions,
                    signal: { kind: "key", event: payload as BlueprintKeyboardEventLike },
                });
                return Promise.all(actionHits.map(hit => dispatchSurfaceBlueprintEvent({
                    blueprintDocument: bundle.ui.localBlueprints,
                    persistentVariables: bundle.ui.persistentVariables,
                    surfaceId: activeSurface.id,
                    runtimeScopeId: hostAdapterBundle.runtimeScopeId,
                    eventName: UI_SURFACE_INPUT_ACTION_EVENT,
                    eventPayload: { ...hit.payload },
                    hostAdapter: hostAdapterBundle.hostAdapter,
                    debug: core.debug,
                    getSurfaceState: key => surfaceStore.get(key),
                    setSurfaceState: (key, value) => surfaceStore.set(key, value),
                    executionManager: core.executionManager,
                }))).then(() => undefined);
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
     * Skipping. Studio's loop, not the engine's - see `skipRunController` for why the binding had to
     * move, and `createNlrGameWithGameUi` for where it moved to.
     *
     * Two ways in, one run: the skip key, and the `skipping` preference a graph writes. The
     * preference is what a quick menu button and a touch screen bind to, so the controller is
     * driven from the same change stream everything else reads, and it writes the value back
     * whenever a run ends on its own - the guard stopping it, the window losing focus, the session
     * going away. The value and the run therefore cannot disagree, which is the whole point of
     * having a value at all.
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
        const preference = (game as {
            preference?: {
                getPreference?: (key: string) => unknown;
                setPreference?: (key: string, value: unknown) => void;
            };
        }).preference;
        const readPreference = (key: string): unknown => preference?.getPreference?.(key);
        const readNumber = (key: string, fallback: number): number => {
            const value = readPreference(key);
            return typeof value === "number" && Number.isFinite(value) ? value : fallback;
        };
        const controller = createSkipRunController({
            matchesSkipKey: key => game.keyMap.match(STUDIO_SKIP_KEY_BINDING, key),
            // `skip` is the author's permission to skip at all, and `isStoryOnScreen` is what keeps
            // a held key on a title screen - or a mode left on under a settings screen - from
            // advancing the story behind it.
            canSkip: () => isStoryOnScreen() && readPreference("skip") !== false,
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
            // Letting go, for a run nobody is holding a key for. Writing the preference is what a
            // Skip button reads back, so the button un-lights itself the moment the run stops.
            onSkippingEnded: () => {
                try {
                    preference?.setPreference?.("skipping", false);
                } catch {
                    // The session this controller belongs to is already gone; there is nothing left
                    // for the value to describe.
                }
            },
        });
        const onKeyDown = (event: KeyboardEvent) => controller.handleKeyDown(event);
        const onKeyUp = (event: KeyboardEvent) => controller.handleKeyUp(event);
        // A window that loses focus mid-hold never delivers the keyup, and the run would go on
        // skipping behind whatever the player switched to. The mode ends here too: a game skipping
        // itself behind another window is the same problem whichever started it.
        const onBlur = () => controller.stop();
        // The value side. Read rather than taken from the event, so the audio mixer's own fan-out
        // through this same listener set costs nothing but a re-read.
        const unsubscribePreferences = subscribeGamePreferences(() => {
            controller.setSkipping(readPreference("skipping") === true);
        });
        controller.setSkipping(readPreference("skipping") === true);
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        window.addEventListener("blur", onBlur);
        return () => {
            controller.stop();
            unsubscribePreferences();
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
            window.removeEventListener("blur", onBlur);
        };
    }, [isStoryOnScreen, nlrSession, subscribeGamePreferences]);

    /**
     * Keep the display awake while the story advances on its own.
     *
     * Auto mode is an hour of playback with no input, which the system reads as an idle machine and
     * answers by blanking the screen mid-scene; the shell holds a display block for as long as this
     * says to. What decides it is in `displayAwake`, including why auto-forward alone is not the
     * answer and why the second question has to be re-asked on a timer.
     *
     * The shell is read through the ref rather than the host object so a re-rendered host does not
     * rebuild the controller - which would release the display and take it again for nothing.
     */
    useEffect(() => {
        const game = nlrSession?.game;
        if (!game) {
            return;
        }
        const preference = (game as {
            preference?: { getPreference?: (key: string) => unknown };
        }).preference;
        const controller = createDisplayAwakeController({
            isAutoForwardOn: () => preference?.getPreference?.("autoForward") === true,
            isStoryOnScreen,
            setAwake: awake => hostRef.current.setDisplayAwake?.(awake),
        });
        const unsubscribePreferences = subscribeGamePreferences(() => controller.sync());
        const recheck = setInterval(() => controller.sync(), DISPLAY_AWAKE_RECHECK_MS);
        controller.sync();
        return () => {
            clearInterval(recheck);
            unsubscribePreferences();
            controller.stop();
        };
    }, [isStoryOnScreen, nlrSession, subscribeGamePreferences]);

    /**
     * Hold the story still while a page or a modal layer is drawn over the stage.
     *
     * The skip loop above stops itself, because Studio runs it. Auto-forward is the engine's own
     * timer and reaches the dialog through a click the host never sees, so nothing a predicate can
     * say will stop it - the engine's `suspendAdvance` is what does, and this is the one place
     * Studio takes one. It covers the stage click and the advance key with it, which is the same
     * answer for the same reason: the player is looking at the screen on top.
     *
     * One holder per playthrough, and it is asked the question on every commit rather than only when
     * the answer changes. A suspension lives on a `Set` inside the engine's `GameState` and nothing
     * else ever looks at it, so tying the release to one effect cleanup made an event that fails to
     * arrive permanent - the stage click, the advance key and auto-forward all dead for the rest of
     * the run. See `stageAdvanceHold` for why re-asking cannot let go early, and for what releasing
     * has to do besides releasing.
     */
    const stageAdvanceHolderRef = useRef<StageAdvanceHolder | null>(null);
    useEffect(() => {
        const preference = (nlrSession?.game as {
            preference?: {
                getPreference?: (key: string) => unknown;
                setPreference?: (key: string, value: unknown) => void;
            };
        } | undefined)?.preference;
        const holder = createStageAdvanceHolder(() => {
            // Read at the moment the hold is taken, not when the holder was built: a cover that
            // went up while the session was still mounting is held on the game that arrives, and a
            // hold on a game that has been replaced knows it has nothing left to wake.
            const heldLiveGame = nlrLiveGameRef.current;
            return holdStageAdvance({
                suspendAdvance: () => heldLiveGame?.getGameState()?.suspendAdvance() ?? null,
                isSessionCurrent: () => nlrLiveGameRef.current === heldLiveGame,
                isAutoForwardOn: () => preference?.getPreference?.("autoForward") === true,
                rearmAutoForward: () => {
                    engineNudgeDepthRef.current += 1;
                    try {
                        preference?.setPreference?.("autoForward", true);
                    } catch {
                        // A session torn down between the check and the write; the line it would
                        // have woken is gone with it.
                    } finally {
                        engineNudgeDepthRef.current -= 1;
                    }
                },
            });
        });
        stageAdvanceHolderRef.current = holder;
        return () => {
            stageAdvanceHolderRef.current = null;
            holder.dispose();
        };
    }, [nlrSession]);

    // Deliberately no dependency list: this is the reconciliation, and it has to run on the commit
    // that changed the answer whether or not the answer is one of this effect's inputs. Declared
    // after the holder so the holder of this commit is the one it syncs.
    useEffect(() => {
        stageAdvanceHolderRef.current?.sync(stageCovered);
    });

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
            // Default is to close; a handler that ran `Keep Window Open` cancels it.
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
            // Never during the quit hand-off: the run is over, and a last frame that answers
            // clicks would advance a story nobody is playing any more.
            interactive={gameStageVisible}
            // The stage mounts (hidden) as soon as a session exists so the Player can preload,
            // which is before the surface system starts; painting it that early would flash its
            // black backdrop over the first frame. It only becomes visible on reveal - and stays
            // painted through a quit until the page taking over is up (see stageRetainedForQuit).
            visible={gameStageVisible || stageRetainedForQuit}
            renderOnStage={gameStageVisible || stageRetainedForQuit}
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
                        // A write Studio made to nudge the engine is not a change to report: the
                        // value on both sides of it is the player's own, untouched.
                        if (engineNudgeDepthRef.current > 0) {
                            return;
                        }
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
                playHead.observe(liveGame.getCurrentActionId());
                nlrCurrentActionTokenRef.current = liveGame.onCurrentActionChange(({ actionId }) => {
                    playHead.observe(actionId);
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
                        {surfacesReady
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
                        {surfacesReady
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
