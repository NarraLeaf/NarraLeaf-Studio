import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { AnimatePresence, MotionConfig, useReducedMotion } from "motion/react";
import { Sound, type LiveGame } from "narraleaf-react";
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
    normalizeAutoSaveConfiguration,
    parseAutoSaveSlotIndex,
    type AutoSaveEntry,
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
    STORY_VISITED_OPTIONS_KEY,
    STORY_VISITED_SCENES_KEY,
    type StoryVisitedKey,
} from "@/lib/ui-editor/runtime/game/storyVisited";
import {
    collectSavedVariableView,
    computeStoryStageSnapshot,
    savedVariableDefsFromView,
} from "@/lib/ui-editor/runtime/game/storyStageSnapshot";
import { createPuppetStageHandle, loadPuppetBackends } from "@/lib/ui-editor/runtime/game/puppetBackendHost";
import { sceneVariableDefs } from "@shared/types/story";
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
import type { AppNavEntry, HostAdapterBundle, OpenSurfaceOptions, PageProps, SurfaceStateAccessors } from "./types";
import type {
    GameAppFrameContext,
    GameAppHost,
    GameAppOverlayContext,
    GameAppSaveBridge,
    GameAppSaveRecord,
    GameAppStoryRuntimeBridge,
} from "./GameAppHost";
import { useAutoSave } from "./useAutoSave";

// Outer safety net: if the environment never comes up at all, start the surface system anyway
// rather than sit on the loading step forever. Generous on purpose — it has to sit *outside*
// STAGE_WARMUP_TIMEOUT_MS, because cutting a warm-up short is the one failure that shows up as
// in-game stutter, and boot latency is explicitly not what this trades against.
const NLR_BOOT_PRELOAD_TIMEOUT_MS = 45_000;
// How long a mount waits for the first scene to be fetched and decoded. Long enough that a real
// project's opening scene always finishes: a longer loading step is the cheaper cost, since the
// alternative is the player paying for it on a button they just pressed. Bounded only so a broken
// asset degrades to "start pays for it" instead of never starting.
const STAGE_WARMUP_TIMEOUT_MS = 30_000;

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
};

/**
 * Shared game application orchestrator: owns the blueprint runtime core, the
 * surface navigation stack and transitions, the NarraLeaf environment boot /
 * story lifecycle, saves, keyboard dispatch, and appBoot/gameReady events.
 * Studio Dev Mode and the standalone game runtime render this component and
 * differ only in the injected GameAppHost.
 */
export function GameApp(props: GameAppProps): ReactNode {
    const { host, rendererRegistry, getScale, renderFrame, renderPlaceholder, renderOverlays, pluginHost } = props;
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
                    core.scopeBridge.persistenceSet(LOCALE_STORAGE_KEY, matched);
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
    const activeStoryRequestRef = useRef<DevModeStartStoryRequest | null>(null);
    const activeStoryRevisionRef = useRef<number | null>(null);
    const pendingGameStartsRef = useRef(new Map<string, { resolve: () => void; reject: (error: Error) => void }>());
    const nlrLiveGameRef = useRef<LiveGame | null>(null);
    const nlrLiveGameSessionIdRef = useRef<string | null>(null);
    // Built once and never rebuilt, because a Game UI slot surface holds whichever copy it was given
    // when its session was mounted. Both members read the refs above at call time.
    const { isInGame, requireLiveGame: requireActiveLiveGame } = useMemo(() => createSessionGate<LiveGame>({
        sessionId: nlrSessionIdRef,
        liveGameSessionId: nlrLiveGameSessionIdRef,
        liveGame: nlrLiveGameRef,
        stageVisible: gameStageVisibleRef,
    }), []);
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
    }, [navigation, resetSurfaceInteractionReadiness]);

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
     * Close down to `targetIndex` in one transition. `closeLayer` is this with the default index;
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

    const closeLayer = useCallback((): Promise<void> => {
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
        await core.scopeBridge.persistenceSetAsync(BLUEPRINT_TEXT_READ_PERSISTENCE_KEY, []);
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
        getHistoryInGame,
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
        await host.saveStore.write(id, liveGame.serialize(), capture, metadata);
        // Host-side, after the write landed: every shell reports it the same way,
        // and a failed write never announces a save that does not exist.
        pluginHost?.emitSaveWritten(id);
    }, [host.saveStore, pluginHost, reportSaveCaptureFailure, requireActiveLiveGame]);

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
        const outcome = await loadSaveIntoGame({
            id,
            readRecord: () => host.saveStore.read(id),
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
        gameEnteredRef.current = true;
        await liveGame.waitForRouterExit().promise;
        setGameStageVisible(true);
        hideCurrentStudioPagesForGame();
        return outcome;
    }, [hideCurrentStudioPagesForGame, host.log, host.reportIssue, host.saveStore, requireActiveLiveGame]);

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

    const deleteSave = useCallback(async (id: string) => {
        await host.saveStore.remove(id);
    }, [host.saveStore]);

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
    // (The plugin `saves.listIds` surface is deliberately left raw - it is
    // documented as direct store access, not the authoring view.)
    const listSaveIds = useCallback(async (): Promise<string[]> => {
        const ids = await host.saveStore.listIds();
        return ids.filter(id => !isAutoSaveId(id));
    }, [host.saveStore]);

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
    }, [host.saveStore]);

    const autoSave = useAutoSave({
        config: autoSaveConfig,
        // The same gate `writeSave` itself enforces, so a true here always means
        // the write can actually serialize something.
        isPlaying: () => Boolean(
            gameEnteredRef.current
            && nlrSession?.id
            && nlrLiveGameSessionIdRef.current === nlrSession.id
            && nlrLiveGameRef.current,
        ),
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
                      // Both halves of the write: the in-memory map so the very next story read
                      // sees it, and the host store so it survives the session. Without the second
                      // half a story-written persistent variable was invisible to every blueprint,
                      // because `Get Persistent` reads through the adapter rather than the map.
                      set: (key, value) => {
                          core.scopeBridge.persistenceSet(key, value);
                          return core.scopeBridge.persistenceSetAsync(key, value);
                      },
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
            closeLayerWithTransition: closeLayer,
            quitApplication: host.quitApplication,
            getFullscreen: host.getFullscreen,
            setFullscreen: host.setFullscreen,
            startStoryInGame: request =>
                startStoryInGameRef.current?.(request) ??
                Promise.reject(new Error("Start Game: runtime is not ready")),
            writeSaveInGame: (id, metadata, screenshot) => writeSave(id, metadata, screenshot),
            loadSaveInGame: loadSaveAction,
            deleteSaveInGame: id => deleteSave(id),
            listSaveIds,
            getSaveMetadata,
            getSavePreview,
            writeAutoSaveInGame: autoSave.writeNow,
            listAutoSaves,
            getHistoryInGame,
            restoreHistoryInGame,
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
            write: (key, value) => core.scopeBridge.persistenceSetAsync(key, value),
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
            write: (key, value) => core.scopeBridge.persistenceSetAsync(key, value),
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
        currentActionIdRef.current = null;
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
        closeLayer,
        core,
        deleteSave,
        getChoiceCountInGame,
        getCurrentNametag,
        resolveAvatarAssetId,
        getGamePreferenceInGame,
        getHistoryInGame,
        getNotificationsInGame,
        getSaveMetadata,
        getSavePreview,
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
        gameEnteredRef.current = true;
        // `onFirstSceneReady` already ends on a painted frame (see waitForStageVisualReadyWithTimeout),
        // so there is nothing left to wait for here: an extra frame only delays the UI's exit.
        await sceneReady;
        setGameStageVisible(true);
        hideCurrentStudioPagesForGame();
    }, [hideCurrentStudioPagesForGame]);

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
            onCloseLayer: closeLayer,
            onClearPages: clearPages,
            onClearGameOverlay: clearGameOverlay,
            onQuitApplication: host.quitApplication,
            onGetFullscreen: host.getFullscreen,
            onSetFullscreen: host.setFullscreen,
            onStartStory: startStoryInGame,
            onIsInGame: isInGame,
            onIsGameOverlay: () => entry.presentation === "gameOverlay",
            onQuitGame: quitGame,
            onWriteSave: writeSave,
            onLoadSave: loadSaveAction,
            onDeleteSave: deleteSave,
            onListSaveIds: listSaveIds,
            onGetSaveMetadata: getSaveMetadata,
            onGetSavePreview: getSavePreview,
            onWriteAutoSave: autoSave.writeNow,
            onListAutoSaves: listAutoSaves,
            onGetHistory: getHistoryInGame,
            onRestoreHistory: restoreHistoryInGame,
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
            onOpenExternal: host.openExternal,
            audioTracks: bundle.audio?.tracks,
            onSubscribeGamePreferences: subscribeGamePreferences,
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
        };
        return {
            hostAdapter,
            bindingContext,
            runtimeScopeId,
        } satisfies HostAdapterBundle;
    }, [
        bundle,
        closeLayer,
        core,
        deleteSave,
        getChoiceCountInGame,
        getCurrentNametag,
        getGamePreferenceInGame,
        getHistoryInGame,
        getNotificationsInGame,
        getSaveMetadata,
        getSavePreview,
        autoSave.writeNow,
        listAutoSaves,
        hideDialogInGame,
        host.quitApplication,
        host.getFullscreen,
        host.setFullscreen,
        isCurrentTextReadInGame,
        clearTextReadInGame,
        isInGame,
        isNvlModeInGame,
        listSaveIds,
        loadSaveAction,
        nextInGame,
        openSurface,
        quitGame,
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

    const activeSurfaceKeyboardReady = Boolean(
        activeEntry &&
        prepaintReadyKeys.has(activeEntry.key) &&
        (!studioPageHiddenForGame || !gameHiddenNavKeys.has(activeEntry.key)),
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
                    onCloseLayer: closeLayer,
                    onClearPages: clearPages,
                    onClearGameOverlay: clearGameOverlay,
                    onQuitApplication: host.quitApplication,
                    onGetFullscreen: host.getFullscreen,
                    onSetFullscreen: host.setFullscreen,
                    onStartStory: startStoryInGame,
                    onIsInGame: isInGame,
                    onIsGameOverlay: () =>
                        input.parentHostAdapter.blueprintRuntime?.hostApi?.game.isGameOverlay() === true,
                    onQuitGame: quitGame,
                    onWriteSave: writeSave,
                    onLoadSave: loadSaveAction,
                    onDeleteSave: deleteSave,
                    onListSaveIds: listSaveIds,
                    onGetSaveMetadata: getSaveMetadata,
                    onGetSavePreview: getSavePreview,
                    onWriteAutoSave: autoSave.writeNow,
                    onListAutoSaves: listAutoSaves,
                    onGetHistory: getHistoryInGame,
                    onRestoreHistory: restoreHistoryInGame,
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
                    onOpenExternal: host.openExternal,
                    audioTracks: bundle.audio?.tracks,
                    onSubscribeGamePreferences: subscribeGamePreferences,
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
        closeLayer,
        core,
        deleteSave,
        getChoiceCountInGame,
        getCurrentNametag,
        getGamePreferenceInGame,
        getHistoryInGame,
        getNotificationsInGame,
        getSaveMetadata,
        getSavePreview,
        autoSave.writeNow,
        listAutoSaves,
        hideDialogInGame,
        host.quitApplication,
        host.getFullscreen,
        host.setFullscreen,
        isCurrentTextReadInGame,
        clearTextReadInGame,
        isInGame,
        isNvlModeInGame,
        listSaveIds,
        loadSaveAction,
        nextInGame,
        openSurface,
        quitGame,
        restoreHistoryInGame,
        selectChoiceInGame,
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

    if (!host.ready || !core || !hostAdapterBundle) {
        // Keep the same root element shape as the ready branch below: switching the root type
        // (Fragment → Provider) when the host becomes ready would make React unmount and
        // remount the whole frame subtree (StageViewportFrame and everything inside it).
        return (
            <GameLocalizationContext.Provider value={gameLocalizationRuntime}>
                {renderFrame({ activeSurface, gameViewport, children: null })}
                {renderOverlays?.({ core, activeSurface, widgetRuntimeStore, fastForwardToNextChoice: fastForwardToNextChoiceInGame, storyRuntime, saves: savesBridge })}
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
                        persistenceSet: (key, value) => core.scopeBridge.persistenceSet(key, value),
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
                                    active={entry.key === activeEntry.key}
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
            {renderOverlays?.({ core, activeSurface, widgetRuntimeStore, fastForwardToNextChoice: fastForwardToNextChoiceInGame, storyRuntime, saves: savesBridge })}
        </GameLocalizationContext.Provider>
    );
}
