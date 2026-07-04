import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { AnimatePresence, useReducedMotion } from "motion/react";
import { Game, KeyBindingType, type LiveGame, type SavedGame } from "narraleaf-react";
import type { DevModeStartStoryRequest } from "@shared/types/devMode";
import type { UISurface } from "@shared/types/ui-editor/document";
import { toBlueprintImageAsset, type BlueprintImageAsset } from "@shared/types/blueprint/valueTypes";
import { BLUEPRINT_GAME_NAMETAG_STATE_KEY } from "@shared/types/blueprint/hostApi";
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
    type BlueprintGamePreferenceKey,
    type BlueprintGamePreferenceValue,
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
} from "@/lib/ui-editor/blueprint-runtime/BlueprintDispatcher";
import { subscribeGamePreferenceChanges } from "@/lib/ui-editor/blueprint-runtime/gamePreferenceSubscription";
import { getOrCreateDomEventPropagationControl } from "@/lib/ui-editor/runtime/eventPropagationControl";
import {
    compileStudioStoryToNlr,
    createEmptyCompiledNlrStory,
    type CompiledNlrStory,
} from "@/lib/ui-editor/runtime/game/storyCompiler";
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
import { createDialogSlotComponent } from "./DialogSlotSurface";
import { applyWidgetRuntimePatch } from "./widgetRuntimePatches";
import { clonePageProps } from "./pageProps";
import { keyboardBlueprintPayload } from "./keyboardBlueprintPayload";
import { readNlrCharacterName, readNlrLastDialogSpeaker } from "./nlrDialogReaders";
import { waitForAnimationFrame } from "./frameTiming";
import { findStageSurfaceForSlot } from "./stageSlots";
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
    const widgetRuntimeStore = useMemo(() => new WidgetRuntimeStateStore(), []);
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
    const preferenceSnapshotRef = useRef<Record<string, unknown>>({});
    const dispatchPreferenceChangeRef = useRef<
        ((key: string, value: unknown, previousValue: unknown) => void) | null
    >(null);
    const currentDialogNametagRef = useRef<string | null>(null);
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
        gameEnteredRef.current = false;
        nlrCharacterPromptTokenRef.current?.cancel();
        nlrCharacterPromptTokenRef.current = null;
        nlrPreferenceTokenRef.current?.cancel();
        nlrPreferenceTokenRef.current = null;
        preferenceSnapshotRef.current = {};
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

    const writeSave = useCallback(async (id: string, metadata?: unknown, screenshot?: boolean) => {
        const liveGame = requireActiveLiveGame("Save Game");
        let capture: string | undefined;
        if (screenshot === true && typeof liveGame.capturePng === "function") {
            capture = await liveGame.capturePng().catch(() => undefined);
        }
        await host.saveStore.write(id, liveGame.serialize(), capture, metadata);
    }, [host.saveStore, requireActiveLiveGame]);

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
        const compiled = await compileStudioStoryToNlr({
            document: storyDocument,
            sceneId,
            characters: bundle.storyLibrary?.characters,
            animations: bundle.storyLibrary?.animations,
            resolveAssetUrl: host.resolveStoryAssetUrl,
        });
        if (compiled.diagnostics.length > 0) {
            for (const diagnostic of compiled.diagnostics) {
                host.log(diagnostic.level === "error" ? "error" : "warning", diagnostic.message);
            }
        }
        return compiled;
    }, [bundle, host]);

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
        const dialogSurface = findStageSurfaceForSlot(bundle.ui.uidoc, "dialog", host.id);
        const dialogComponent = dialogSurface
            ? createDialogSlotComponent({
                  sessionId,
                  core,
                  bundle,
                  surface: dialogSurface,
                  rendererRegistry,
                  lifecycleRef,
                  makeStateAccessors,
                  openSurfaceWithTransition: openSurface,
                  closeLayerWithTransition: closeLayer,
                  quitApplication: host.quitApplication,
                  startStoryInGame: request =>
                      startStoryInGameRef.current?.(request) ??
                      Promise.reject(new Error("Start Game: runtime is not ready")),
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
        const environmentReady = new Promise<void>((resolve, reject) => {
            pendingEnvReadyRef.current.set(sessionId, { resolve, reject });
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
        await environmentReady;
        return sessionId;
    }, [
        activeSurface,
        bundle,
        clearGameHiddenStudioPages,
        closeLayer,
        core,
        deleteSave,
        getCurrentNametag,
        getGamePreferenceInGame,
        getSaveMetadata,
        getSavePreview,
        hideDialogInGame,
        host.id,
        host.quitApplication,
        isInGame,
        listSaveIds,
        loadSave,
        makeStateAccessors,
        nextInGame,
        openSurface,
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

        // Fast path: the environment is already mounted with this story from the boot preload and
        // has not entered a game yet. Just enter it (newGame + reveal) — no recompile, no re-mount,
        // and gameReady does not fire again.
        if (
            !options?.forceReinit &&
            nlrLiveGameRef.current &&
            !gameEnteredRef.current &&
            activeStoryRequestRef.current?.storyId === storyId &&
            activeStoryRequestRef.current?.sceneId === sceneId
        ) {
            await enterMountedGame();
            return;
        }

        const compiled = await compileStoryRequest({ storyId, sceneId });
        await mountNlrSession(compiled, { storyRequest: { storyId, sceneId } });
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
        getCurrentNametag,
        getGamePreferenceInGame,
        getSaveMetadata,
        getSavePreview,
        hideDialogInGame,
        host.quitApplication,
        isInGame,
        listSaveIds,
        loadSave,
        nextInGame,
        openSurface,
        quitGame,
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
    // boot an empty NLR environment. gameReady fires here, once, at boot. Requires
    // hostAdapterBundle so NlrStageLayer mounts and can drive onLiveGameReady.
    useEffect(() => {
        if (!host.ready || !core || !activeSurface || !hostAdapterBundle) {
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
                if (host.bootAction.kind === "story") {
                    // A direct story launch enters the game immediately after the environment mounts.
                    await startStoryInGame({ storyId: host.bootAction.storyId, sceneId: host.bootAction.sceneId });
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
    }, [
        activeSurface,
        bundle,
        core,
        host,
        hostAdapterBundle,
        initDefaultSceneEnvironment,
        startEmptyNlrEnvironment,
        startStoryInGame,
    ]);

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
        getCurrentNametag,
        getGamePreferenceInGame,
        getSaveMetadata,
        getSavePreview,
        hideDialogInGame,
        host.quitApplication,
        isInGame,
        listSaveIds,
        loadSave,
        nextInGame,
        openSurface,
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
        preferenceSnapshotRef.current = {};
        nlrDialogVirtualClickTargetRef.current = null;
        gameReadyFiredRef.current = null;
        nlrLiveGameRef.current = null;
        nlrLiveGameSessionIdRef.current = null;
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
        rejectPendingGameStarts,
    ]);

    useEffect(() => {
        nlrCharacterPromptTokenRef.current?.cancel();
        nlrCharacterPromptTokenRef.current = null;
        nlrPreferenceTokenRef.current?.cancel();
        nlrPreferenceTokenRef.current = null;
        preferenceSnapshotRef.current = {};
        nlrDialogVirtualClickTargetRef.current = null;
        gameReadyFiredRef.current = null;
        nlrLiveGameRef.current = null;
        nlrLiveGameSessionIdRef.current = null;
        clearCurrentDialogNametag();
    }, [clearCurrentDialogNametag, nlrSession?.id]);

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

    if (!activeSurface || !activeEntry) {
        return renderPlaceholder?.() ?? null;
    }

    const gameViewport = nlrSession ? { width: nlrSession.width, height: nlrSession.height } : null;

    if (!host.ready || !core || !hostAdapterBundle) {
        return (
            <>
                {renderFrame({ activeSurface, gameViewport, children: null })}
                {renderOverlays?.({ core, activeSurface, widgetRuntimeStore })}
            </>
        );
    }

    // The NLR stage drives the boot preload (onLiveGameReady → gameReady) and stays mounted
    // across both the boot-loading frame and the surface system.
    const nlrStageLayer = (
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
            onEnvironmentReady={sessionId => {
                host.log("info", `[${host.id}] NLR environment assets preheated: ${sessionId}`);
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
                nlrPreferenceTokenRef.current?.cancel();
                nlrPreferenceTokenRef.current = subscribeGamePreferenceChanges(
                    liveGame,
                    preferenceSnapshotRef,
                    (key, value, previousValue) => dispatchPreferenceChangeRef.current?.(key, value, previousValue),
                );
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
            onError={err => {
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

    const content = (
        <div className="relative h-full w-full overflow-hidden">
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
    );

    return (
        <>
            {renderFrame({ activeSurface, gameViewport, children: content })}
            {renderOverlays?.({ core, activeSurface, widgetRuntimeStore })}
        </>
    );
}
