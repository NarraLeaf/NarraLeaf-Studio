import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { AnimatePresence, MotionConfig, useReducedMotion } from "motion/react";
import { type LiveGame, type SavedGame } from "narraleaf-react";
import type { DevModeStartStoryRequest } from "@shared/types/devMode";
import {
    LOCALE_STORAGE_KEY,
    characterTranslationUnitId,
    matchSystemLocale,
    resolveLocalizedUnitText,
} from "@shared/types/localization";
import { VOICE_LOCALE_STORAGE_KEY } from "@shared/types/voice";
import {
    GameLocalizationContext,
    type GameLocalizationRuntime,
} from "@/lib/ui-editor/runtime/localization/GameLocalizationContext";
import type { UISurface } from "@shared/types/ui-editor/document";
import { toBlueprintImageAsset, type BlueprintImageAsset } from "@shared/types/blueprint/valueTypes";
import {
    BLUEPRINT_GAME_NAMETAG_STATE_KEY,
    BLUEPRINT_GAME_TEXT_READ_STATE_KEY,
    BLUEPRINT_TEXT_READ_PERSISTENCE_KEY,
} from "@shared/types/blueprint/hostApi";
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
import { computeStoryStageSnapshot } from "@/lib/ui-editor/runtime/game/storyStageSnapshot";
import { sceneVariableDefs, savedVariableDefs } from "@shared/types/story";
import { resolveDefaultLaunchScene } from "@/lib/ui-editor/runtime/game/resolveDefaultLaunchScene";
import { NlrStageLayer, type NlrStageSession } from "@/lib/ui-editor/runtime/game/NlrStageLayer";
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
import { createGameUiSlotComponents, createLiveGameUiCallbacks, createNlrGameWithGameUi, fastForwardToNextChoice } from "./gameUiSlots";
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
import { waitForAnimationFrame } from "./frameTiming";
import { NavigationController } from "./navigation/NavigationController";
import { useSurfaceNavigation } from "./navigation/useSurfaceNavigation";
import type { AppNavEntry, HostAdapterBundle, OpenSurfaceOptions, PageProps, SurfaceStateAccessors } from "./types";
import type { GameAppFrameContext, GameAppHost, GameAppOverlayContext } from "./GameAppHost";

const NLR_BOOT_PRELOAD_TIMEOUT_MS = 15_000;

export type GameAppNavEntry = AppNavEntry;

function normalizeError(error: unknown): string {
    if (error instanceof Error) {
        return error.stack ?? error.message;
    }
    return String(error);
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
};

/**
 * Shared game application orchestrator: owns the blueprint runtime core, the
 * surface navigation stack and transitions, the NarraLeaf environment boot /
 * story lifecycle, saves, keyboard dispatch, and appBoot/gameReady events.
 * Studio Dev Mode and the standalone game runtime render this component and
 * differ only in the injected GameAppHost.
 */
export function GameApp(props: GameAppProps): ReactNode {
    const { host, rendererRegistry, getScale, renderFrame, renderPlaceholder, renderOverlays } = props;
    const bundle = host.bundle;
    const core = useBlueprintRuntimeCore(bundle, {
        persistenceAdapter: host.persistenceAdapter,
        onDebugEvent: host.onDebugEvent,
        disposeMessage: host.disposeMessage,
    });
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
    const [widgetPatchesByScope, setWidgetPatchesByScope] = useState<Record<string, Record<string, DevModeWidgetRuntimePatch>>>({});
    const widgetPatchesByScopeRef = useRef(widgetPatchesByScope);
    const navigation = useMemo(() => new NavigationController(), []);
    const navState = useSurfaceNavigation(navigation);
    const { navStack, visibleEntries, presenceMode: surfacePresenceMode } = navState;
    const [prepaintReadyKeys, setPrepaintReadyKeys] = useState<Set<string>>(() => new Set());
    const [interactionReadyKeys, setInteractionReadyKeys] = useState<Set<string>>(() => new Set());
    const [nlrSession, setNlrSession] = useState<NlrStageSession | null>(null);
    const [nlrPreloadDone, setNlrPreloadDone] = useState(false);
    const [gameStageVisible, setGameStageVisible] = useState(false);
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
    const startStoryInGameRef = useRef<
        ((request: DevModeStartStoryRequest, options?: { forceReinit?: boolean }) => Promise<void>) | null
    >(null);
    const cleanupBundleIdRef = useRef<string | null>(null);
    const activeStoryRequestRef = useRef<DevModeStartStoryRequest | null>(null);
    const activeStoryRevisionRef = useRef<number | null>(null);
    const pendingGameStartsRef = useRef(new Map<string, { resolve: () => void; reject: (error: Error) => void }>());
    const nlrLiveGameRef = useRef<LiveGame | null>(null);
    const nlrLiveGameSessionIdRef = useRef<string | null>(null);
    const nlrDialogVirtualClickTargetRef = useRef<HTMLElement | null>(null);
    const nlrCharacterPromptTokenRef = useRef<{ cancel(): void } | null>(null);
    const nlrPreferenceTokenRef = useRef<{ cancel(): void } | null>(null);
    const textReadTrackerRef = useRef<TextReadTracker | null>(null);
    const preferenceSnapshotRef = useRef<Record<string, unknown>>({});
    const dispatchPreferenceChangeRef = useRef<
        ((key: string, value: unknown, previousValue: unknown) => void) | null
    >(null);
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
        // Reset the NLR boot preload for this session. This runs on mount and on every
        // bundle/entry-surface change, and its deps are stable per session, so it does NOT
        // thrash on ordinary re-renders. Crucially it re-runs on the React.StrictMode
        // mount/unmount/mount cycle (the dev host mounts under StrictMode): the first boot is
        // cancelled by the unmount, this reset clears nlrBootStartedRef, and the second mount's
        // boot effect re-runs to completion. Without it the boot guard would stick and
        // nlrPreloadDone would never flip true, leaving the surface stack blank.
        nlrBootStartedRef.current = null;
        gameReadyFiredRef.current = null;
        nlrLiveGameRef.current = null;
        nlrLiveGameSessionIdRef.current = null;
        gameEnteredRef.current = false;
        setNlrPreloadDone(false);
        setNlrSession(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bundle, createNavEntry, host.entrySurfaceId, navigation]);

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
    }, []);

    const clearCurrentDialogNametag = useCallback(() => {
        currentDialogNametagRef.current = null;
        core?.scopeBridge.globalSet(BLUEPRINT_GAME_NAMETAG_STATE_KEY, null);
    }, [core]);

    const setChoiceRuntime = useCallback((runtime: ChoiceSlotRuntime | null): void => {
        choiceRuntimeRef.current = runtime;
    }, []);

    const isInGame = useCallback((): boolean => {
        return Boolean(gameStageVisible && nlrSession?.id);
    }, [gameStageVisible, nlrSession?.id]);

    const detachTextReadTracker = useCallback(() => {
        textReadTrackerRef.current?.detach();
        textReadTrackerRef.current = null;
    }, []);

    const isCurrentTextReadInGame = useCallback((): boolean => {
        return textReadTrackerRef.current?.isCurrentTextRead() === true;
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

    const requireActiveLiveGame = useCallback((operation: string): LiveGame => {
        if (!nlrSession?.id || nlrLiveGameSessionIdRef.current !== nlrSession.id || !nlrLiveGameRef.current) {
            throw new Error(`${operation}: game runtime is not available`);
        }
        return nlrLiveGameRef.current;
    }, [nlrSession?.id]);

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

    const fastForwardToNextChoiceInGame = useCallback(async (): Promise<void> => {
        const liveGame = requireActiveLiveGame("Skip To Next Choice");
        await fastForwardToNextChoice(liveGame, choiceRuntimeRef);
    }, [requireActiveLiveGame]);

    const quitGame = useCallback(async (surfaceId: string): Promise<void> => {
        const targetSurfaceId = String(surfaceId ?? "").trim();
        if (!targetSurfaceId) {
            throw new Error("Quit Game: surfaceId is required");
        }
        rejectPendingGameStarts(new Error("Quit Game"));
        activeStoryRequestRef.current = null;
        activeStoryRevisionRef.current = null;
        gameEnteredRef.current = false;
        nlrCharacterPromptTokenRef.current?.cancel();
        nlrCharacterPromptTokenRef.current = null;
        nlrPreferenceTokenRef.current?.cancel();
        nlrPreferenceTokenRef.current = null;
        detachTextReadTracker();
        preferenceSnapshotRef.current = {};
        nlrDialogVirtualClickTargetRef.current = null;
        gameReadyFiredRef.current = null;
        nlrLiveGameRef.current = null;
        nlrLiveGameSessionIdRef.current = null;
        choiceRuntimeRef.current = null;
        clearCurrentDialogNametag();
        setGameStageVisible(false);
        await openSurface(targetSurfaceId, undefined, { presentation: "appPage" });
        setNlrSession(null);
        clearGameHiddenStudioPages();
    }, [clearCurrentDialogNametag, clearGameHiddenStudioPages, detachTextReadTracker, openSurface, rejectPendingGameStarts]);

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
    }, [host.saveStore, reportSaveCaptureFailure, requireActiveLiveGame]);

    const loadSave = useCallback(async (id: string) => {
        const liveGame = requireActiveLiveGame("Load Save");
        const record = await host.saveStore.read(id);
        if (!record?.savedGame) {
            throw new Error(`Load Save: save not found: ${id}`);
        }
        liveGame.game.router.clear().cleanHistory();
        liveGame.newGame().deserialize(record.savedGame as SavedGame);
        gameEnteredRef.current = true;
        await liveGame.waitForRouterExit().promise;
        setGameStageVisible(true);
        hideCurrentStudioPagesForGame();
    }, [hideCurrentStudioPagesForGame, host.saveStore, requireActiveLiveGame]);

    const deleteSave = useCallback(async (id: string) => {
        await host.saveStore.remove(id);
    }, [host.saveStore]);

    const listSaveIds = useCallback(async (): Promise<string[]> => {
        return host.saveStore.listIds();
    }, [host.saveStore]);

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
                const savedDefs = savedVariableDefs(storyDocument);
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
        const compiled = await compileStudioStoryToNlr({
            document: storyDocument,
            sceneId,
            launch,
            characters: bundle.storyLibrary?.characters,
            animations: bundle.storyLibrary?.animations,
            resolveAssetUrl: host.resolveStoryAssetUrl,
            blueprintDocument: bundle.ui.localBlueprints,
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
                ? {
                      ...bundle.voice,
                      getVoiceLocale: () => {
                          const stored = core.scopeBridge.persistenceGet(VOICE_LOCALE_STORAGE_KEY);
                          if (typeof stored === "string" && stored
                              && bundle.voice!.voicedLocales.some(locale => locale.code === stored)) {
                              return stored;
                          }
                          return bundle.voice!.voicedLocales[0]?.code ?? "";
                      },
                  }
                : undefined,
        });
        if (compiled.diagnostics.length > 0) {
            for (const diagnostic of compiled.diagnostics) {
                host.log(diagnostic.level === "error" ? "error" : "warning", diagnostic.message);
            }
        }
        return compiled;
    }, [bundle, core, host]);

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
        rejectPendingGameStarts(new Error("NLR environment superseded by a newer session"));
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
            loadSaveInGame: id => loadSave(id),
            deleteSaveInGame: id => deleteSave(id),
            listSaveIds,
            getSaveMetadata,
            getSavePreview,
            getHistoryInGame,
            restoreHistoryInGame,
            getCurrentNametag,
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
            setWidgetPatchesByScope,
            widgetPatchesByScopeRef,
            widgetRuntimeStore,
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
        });
        const environmentReady = new Promise<void>((resolve, reject) => {
            pendingEnvReadyRef.current.set(sessionId, { resolve, reject });
        });
        setGameStageVisible(false);
        clearGameHiddenStudioPages();
        gameReadyFiredRef.current = null;
        nlrLiveGameRef.current = null;
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
        getGamePreferenceInGame,
        getHistoryInGame,
        getNotificationsInGame,
        getSaveMetadata,
        getSavePreview,
        hideDialogInGame,
        host.id,
        host.quitApplication,
        host.getFullscreen,
        host.setFullscreen,
        isCurrentTextReadInGame,
        clearTextReadInGame,
        isInGame,
        isNvlModeInGame,
        listSaveIds,
        loadSave,
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
        const sceneReady = new Promise<void>((resolve, reject) => {
            pendingGameStartsRef.current.set(sessionId, { resolve, reject });
        });
        liveGame.newGame();
        gameEnteredRef.current = true;
        await sceneReady;
        await waitForAnimationFrame();
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
            onQuitApplication: host.quitApplication,
            onGetFullscreen: host.getFullscreen,
            onSetFullscreen: host.setFullscreen,
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
            onGetHistory: getHistoryInGame,
            onRestoreHistory: restoreHistoryInGame,
            onGetNametag: getCurrentNametag,
            onGetNotifications: getNotificationsInGame,
            onGetChoiceCount: getChoiceCountInGame,
            onIsNvlMode: isNvlModeInGame,
            onIsCurrentTextRead: isCurrentTextReadInGame,
            onClearTextRead: clearTextReadInGame,
            onSelectChoice: selectChoiceInGame,
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
            localizationConfig: bundle.localization ?? null,
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
        hideDialogInGame,
        host.quitApplication,
        host.getFullscreen,
        host.setFullscreen,
        isCurrentTextReadInGame,
        clearTextReadInGame,
        isInGame,
        isNvlModeInGame,
        listSaveIds,
        loadSave,
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
            // Menu launch: initialise the environment (gameReady) and preheat the default
            // scene, but do NOT enter the game — the player stays on the menu.
            const defaultScene = resolveDefaultLaunchScene(bundle);
            if (defaultScene) {
                await initDefaultSceneEnvironment(defaultScene);
            } else {
                await startEmptyNlrEnvironment();
            }
        }
    };

    // Requires hostAdapterBundle so NlrStageLayer mounts and can drive onLiveGameReady. The deps
    // are intentionally only the readiness signal and the bundle id: the boot mutates nlrSession
    // (and therefore hostAdapterBundle), and re-running on that churn would cancel the in-flight
    // boot before nlrPreloadDone is set. StrictMode re-boot safety comes from the per-session
    // nav-reset effect clearing nlrBootStartedRef, not from this effect's deps.
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
                if (!cancelled) {
                    nlrBootStartedRef.current = null;
                    host.log("error", normalizeError(err));
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
                    onQuitApplication: host.quitApplication,
                    onGetFullscreen: host.getFullscreen,
                    onSetFullscreen: host.setFullscreen,
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
                    onGetHistory: getHistoryInGame,
                    onRestoreHistory: restoreHistoryInGame,
                    onGetNametag: getCurrentNametag,
                    onGetNotifications: getNotificationsInGame,
                    onGetChoiceCount: getChoiceCountInGame,
                    onIsNvlMode: isNvlModeInGame,
                    onIsCurrentTextRead: isCurrentTextReadInGame,
                    onClearTextRead: clearTextReadInGame,
                    onSelectChoice: selectChoiceInGame,
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
                    localizationConfig: bundle.localization ?? null,
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
        hideDialogInGame,
        host.quitApplication,
        host.getFullscreen,
        host.setFullscreen,
        isCurrentTextReadInGame,
        clearTextReadInGame,
        isInGame,
        isNvlModeInGame,
        listSaveIds,
        loadSave,
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
                host.log("error", `[${host.id}] NLR hot reload restart failed: ${normalizeError(err)}`);
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
        rejectPendingGameStarts(new Error("Runtime session changed"));
        nlrCharacterPromptTokenRef.current?.cancel();
        nlrCharacterPromptTokenRef.current = null;
        nlrPreferenceTokenRef.current?.cancel();
        nlrPreferenceTokenRef.current = null;
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
        detachTextReadTracker();
        preferenceSnapshotRef.current = {};
        nlrDialogVirtualClickTargetRef.current = null;
        gameReadyFiredRef.current = null;
        nlrLiveGameRef.current = null;
        nlrLiveGameSessionIdRef.current = null;
        choiceRuntimeRef.current = null;
        clearCurrentDialogNametag();
    }, [clearCurrentDialogNametag, detachTextReadTracker, nlrSession?.id]);

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
                eventName: "gamePreferenceChanged",
                eventPayload,
                hostAdapter: hostAdapterBundle.hostAdapter,
                debug: core.debug,
                getSurfaceState: stateKey => surfaceStore.get(stateKey),
                setSurfaceState: (stateKey, stateValue) => surfaceStore.set(stateKey, stateValue),
                executionManager: core.executionManager,
            }).then(() => dispatchSurfaceBlueprintEvent({
                blueprintDocument: bundle.ui.localBlueprints,
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
                eventName: "windowFullscreenChanged",
                eventPayload,
                hostAdapter: hostAdapterBundle.hostAdapter,
                debug: core.debug,
                getSurfaceState: stateKey => surfaceStore.get(stateKey),
                setSurfaceState: (stateKey, stateValue) => surfaceStore.set(stateKey, stateValue),
                executionManager: core.executionManager,
            }).then(() => dispatchSurfaceBlueprintEvent({
                blueprintDocument: bundle.ui.localBlueprints,
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
                {renderOverlays?.({ core, activeSurface, widgetRuntimeStore, fastForwardToNextChoice: fastForwardToNextChoiceInGame })}
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
            onEnvironmentReady={sessionId => {
                host.log("info", `[${host.id}] NLR environment assets preheated: ${sessionId}`);
            }}
            onLiveGameReady={async (sessionId, liveGame) => {
                if (nlrSession?.id !== sessionId) {
                    return;
                }
                nlrCharacterPromptTokenRef.current?.cancel();
                nlrCharacterPromptTokenRef.current = liveGame.onCharacterPrompt(({ character }) => {
                    const nametag = translateCharacterName(readNlrCharacterName(character));
                    currentDialogNametagRef.current = nametag;
                    core.scopeBridge.globalSet(BLUEPRINT_GAME_NAMETAG_STATE_KEY, nametag);
                });
                nlrPreferenceTokenRef.current?.cancel();
                nlrPreferenceTokenRef.current = subscribeGamePreferenceChanges(
                    liveGame,
                    preferenceSnapshotRef,
                    (key, value, previousValue) => dispatchPreferenceChangeRef.current?.(key, value, previousValue),
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
                try {
                    // Environment ready: LiveGame exists. Dispatch gameReady so global blueprints can
                    // load game settings — BEFORE the game is ever entered (no newGame yet).
                    if (gameReadyFiredRef.current !== sessionId) {
                        gameReadyFiredRef.current = sessionId;
                        const surfaceStore = core.scopeBridge.getSurfaceStore(hostAdapterBundle.runtimeScopeId);
                        await dispatchGlobalBlueprintEvent({
                            blueprintDocument: bundle.ui.localBlueprints,
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
                host.log("error", normalizeError(err));
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
            {renderOverlays?.({ core, activeSurface, widgetRuntimeStore, fastForwardToNextChoice: fastForwardToNextChoiceInGame })}
        </GameLocalizationContext.Provider>
    );
}
