import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LiveGame } from "narraleaf-react";
import type { StoryAnimationAsset, StoryDocument, StoryScene } from "@shared/types/story";
import {
    compileStagePreviewToNlr,
    type NlrStoryCompileDiagnostic,
} from "@/lib/ui-editor/runtime/game/storyCompiler";
import { computeStoryStageSnapshot } from "@/lib/ui-editor/runtime/game/storyStageSnapshot";
import type { StoryPlaybackStop } from "@/lib/ui-editor/runtime/game/storyPlaybackWalk";
import {
    waitForPaintFrames,
    waitForStageVisualReadyWithTimeout,
    type NlrStageSession,
} from "@/lib/ui-editor/runtime/game/NlrStageLayer";
import { createWorkspaceBlobUrlResolver, type WorkspaceBlobUrlResolver } from "@/lib/workspace/assets/resolveWorkspaceAssetUrl";
import { Services, WorkspaceContext } from "@/lib/workspace/services/services";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { ConsoleService } from "@/lib/workspace/services/core/ConsoleService";
import { useStoryPreviewGameUi, type StoryPreviewIssue } from "./useStoryPreviewGameUi";
import { resolvePlaybackStartBlockId, resolvePreviewTargetBlockId } from "./storyScenePreviewTarget";
import { STORY_CONSOLE_CHANNEL_ID } from "./storyPreviewConsole";

const RECOMPILE_DEBOUNCE_MS = 300;
/** Pure row switches (same document, new target) rebuild sooner - they are the hot path. */
const ROW_SWITCH_DEBOUNCE_MS = 150;
/** Pre-posed state mounts within a few frames; anything longer means the marker never fired. */
const STATE_SETTLE_TIMEOUT_MS = 5_000;
const MAX_ISSUES = 20;

export type StoryScenePreviewPhase =
    | "idle"
    | "compiling"
    | "mounting"
    | "starting"
    /** Snapshot mode: the target row's action has played and the frame holds. */
    | "settled"
    /** Playback mode: the scene is running forward from the start row, driven by the author. */
    | "playing"
    /** Playback mode: the compiled tail ran out (scene end, or a jump the preview can't follow). */
    | "ended"
    | "error";

/**
 * What the preview is doing:
 * - `follow` — the original state player: it tracks the selected row and shows that one frame.
 * - `play` — continuous playback pinned to a start row, advancing on the author's clicks. Selection
 *   changes and document edits deliberately do *not* rebuild it; a run in flight is not restarted
 *   out from under the person watching it.
 */
export type StoryScenePreviewMode = "follow" | "play";

export type StoryScenePreviewStageContext = {
    liveGame: LiveGame;
    compiled: NlrStageSession["compiled"];
    targetBlockId: string | null;
    phase: StoryScenePreviewPhase;
};

/**
 * One stage buffer for the pane to render. The pane stacks the array in order (later entries on
 * top) and wires `setRootElement` on each wrapper so the controller can await paint-readiness of
 * the hidden buffer before revealing it.
 */
export type StoryScenePreviewStageLayer = {
    session: NlrStageSession;
    setRootElement: (element: HTMLDivElement | null) => void;
};

export type StoryScenePreviewController = {
    phase: StoryScenePreviewPhase;
    errorMessage: string | null;
    diagnostics: NlrStoryCompileDiagnostic[];
    issues: StoryPreviewIssue[];
    /** Stage buffers, bottom-to-top: at most [incoming (hidden beneath), current frame (on top)]. */
    stageLayers: StoryScenePreviewStageLayer[];
    designSize: { width: number; height: number };
    targetBlockId: string | null;
    mode: StoryScenePreviewMode;
    /** The row playback is pinned to, in `play` mode. */
    playFromBlockId: string | null;
    /** Why the running playback's compiled tail ends; null until a playback run is on screen. */
    playbackStop: StoryPlaybackStop | null;
    /** The stage takes pointer input (advance the story, pick menu options) — playback mode only. */
    interactive: boolean;
    /** Author-controlled audio for playback; `follow` mode is always silent regardless. */
    muted: boolean;
    setMuted: (muted: boolean) => void;
    /** Enter playback at `blockId` (null = the scene start). Re-entering restarts from that row. */
    startPlayback: (blockId: string | null) => void;
    /** Enter playback at the row the editor has selected — the pane's own play button. */
    startPlaybackFromSelection: () => void;
    /** Replay the current playback run from its start row. */
    restartPlayback: () => void;
    /** Leave playback and go back to following the selected row. */
    stopPlayback: () => void;
    /** Phase-2 seam: the live stage at the previewed row (motion editor prefill). */
    getStageContext: () => StoryScenePreviewStageContext | null;
    /** Wire into NlrStageLayer's onLiveGameReady. */
    onLiveGameReady: (sessionId: string, liveGame: LiveGame) => void;
    /** Wire into NlrStageLayer's onError. */
    onStageError: (error: Error, sessionId: string) => void;
};

/** Everything one compile run owns; the display run keeps the visible frame, the pending run builds hidden. */
type PreviewRun = {
    runId: number;
    session: NlrStageSession;
    /** Stable per-run object the pane keys its stage wrapper on. */
    layer: StoryScenePreviewStageLayer;
    liveGame: LiveGame | null;
    wireLiveGame: (liveGame: LiveGame) => () => void;
    wireDispose: (() => void) | null;
    /**
     * Releases the compiled story's reveal gate (a `Control.sleep` between the posed stage and the
     * target's own action). Only ever resolved at promotion - superseded runs are disposed instead,
     * which aborts the sleeping timeline.
     */
    resolveReveal: () => void;
    /** The pane's wrapper element for this buffer; promotion awaits its visual readiness. */
    rootElement: HTMLDivElement | null;
    posed: boolean;
    arrived: boolean;
    targetBlockId: string | null;
    /** This run plays the scene forward from its target rather than holding on one row. */
    continuous: boolean;
    /** Where a continuous run's compiled tail ends (compile-time knowledge). */
    playbackStop: StoryPlaybackStop | null;
};

/**
 * Drives the story preview stage. The Studio computes the settled stage state at the selected row
 * (computeStoryStageSnapshot) and compiles it into a "state player" story whose elements mount
 * pre-posed; the target row's own action then plays once on that stage and the preview holds the
 * resulting frame. The shell never fast-forwards - mounting IS the state.
 *
 * Rebuilds are double-buffered: the new session mounts *beneath* the currently visible frame,
 * poses itself, and is only revealed (old buffer unmounted, reveal gate released) once its images
 * have decoded and painted. Row switches therefore never flash black or show half-loaded content -
 * the previous frame simply holds until the next one is pixel-ready, and the target row's own
 * action plays entirely on the visible stage.
 */
export function useStoryScenePreviewController(input: {
    context: WorkspaceContext | null;
    document: StoryDocument | null;
    scene: StoryScene | null;
    sceneId: string | null;
    activeBlockId: string | null;
    /** Editor tab visibility (keep-alive aware); the preview fully idles when false. */
    active: boolean;
    /** Preview pane visibility. */
    open: boolean;
}): StoryScenePreviewController {
    const { context, document, scene, sceneId, activeBlockId, active, open } = input;

    const [phase, setPhaseState] = useState<StoryScenePreviewPhase>("idle");
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [diagnostics, setDiagnostics] = useState<NlrStoryCompileDiagnostic[]>([]);
    const [issues, setIssues] = useState<StoryPreviewIssue[]>([]);
    const [stageLayers, setStageLayers] = useState<StoryScenePreviewStageLayer[]>([]);
    /** Non-null while in playback mode. `token` bumps on every explicit (re)start. */
    const [playback, setPlayback] = useState<{ blockId: string | null; token: number } | null>(null);
    const [playbackStop, setPlaybackStop] = useState<StoryPlaybackStop | null>(null);
    const [muted, setMuted] = useState(false);

    const runIdRef = useRef(0);
    const phaseRef = useRef<StoryScenePreviewPhase>("idle");
    /** Signatures (`level|message`) of the diagnostics logged to the console on the previous compile,
     *  so identical recompiles (row switches, edits) don't re-append the same lines every time. */
    const loggedDiagnosticKeysRef = useRef<Set<string>>(new Set());
    /** The promoted run currently holding the visible frame. */
    const displayRunRef = useRef<PreviewRun | null>(null);
    /** The in-flight run building hidden beneath the display frame. */
    const pendingRunRef = useRef<PreviewRun | null>(null);
    const settleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const blobResolverRef = useRef<WorkspaceBlobUrlResolver | null>(null);
    /** Last rebuild input; a change in target alone is a row switch and debounces shorter. */
    const lastRunInputRef = useRef<{ document: StoryDocument; sceneId: string; targetId: string | null } | null>(null);
    /** Playback token the current run was built for; guards against rebuilding a live playback. */
    const builtPlaybackTokenRef = useRef<number | null>(null);
    /** Read by callbacks that must not close over a stale `muted`. */
    const mutedRef = useRef(muted);
    mutedRef.current = muted;

    const consoleService = useMemo(
        () => context?.services.get<ConsoleService>(Services.Console) ?? null,
        [context],
    );

    const setPhase = useCallback((next: StoryScenePreviewPhase) => {
        phaseRef.current = next;
        setPhaseState(next);
    }, []);

    // Mirror a preview problem to the shared bottom console's "Story" tab. The channel is registered
    // by the scene editor; appending before it registers is harmless (the entry buffers regardless).
    const logStoryConsole = useCallback((level: "warning" | "error", message: string, source: string) => {
        consoleService?.append(STORY_CONSOLE_CHANNEL_ID, { level, message, source });
    }, [consoleService]);

    const pushIssue = useCallback((issue: StoryPreviewIssue) => {
        setIssues(current => [...current.slice(-(MAX_ISSUES - 1)), issue]);
        logStoryConsole(issue.level, issue.message, "Preview");
    }, [logStoryConsole]);

    const host = useStoryPreviewGameUi({ context, enabled: open && active, onIssue: pushIssue });

    // Local assets resolve to session-lived blob URLs: `app://fs/{hash}` grants are single-use,
    // and the engine loads the same image URL repeatedly (preloader + render + session remounts).
    // The resolver caches per pane-open; closing the pane revokes every object URL.
    useEffect(() => {
        if (!context || !open) {
            return;
        }
        const resolver = createWorkspaceBlobUrlResolver(context);
        blobResolverRef.current = resolver;
        return () => {
            blobResolverRef.current = null;
            resolver.dispose();
        };
    }, [context, open]);

    const resolveAssetUrl = useMemo(() => {
        if (!context) {
            return undefined;
        }
        return async (assetId: string, assetType?: string): Promise<string | null> => {
            const resolver = blobResolverRef.current;
            return resolver ? resolver.resolve(assetId, assetType) : null;
        };
    }, [context]);

    const resolvedTargetId = useMemo(
        () => (scene ? resolvePreviewTargetBlockId(scene, activeBlockId) : null),
        [scene, activeBlockId],
    );
    // Playback pins its own start row; only `follow` mode tracks the selection.
    const effectiveTargetId = playback ? playback.blockId : resolvedTargetId;

    const clearDriveTimers = useCallback(() => {
        if (settleTimeoutRef.current !== null) {
            clearTimeout(settleTimeoutRef.current);
            settleTimeoutRef.current = null;
        }
    }, []);

    // Dispose a retired LiveGame: aborts its timelines/audio/async stacks so a replaced session
    // can't keep ticking after its Player unmounts (zombie animations throw "No game state found"
    // and their errors would otherwise bleed into the current run).
    const disposeLiveGame = useCallback((liveGame: LiveGame | null) => {
        if (!liveGame) {
            return;
        }
        try {
            const disposable = liveGame as LiveGame & { dispose?: () => void };
            if (typeof disposable.dispose === "function") {
                disposable.dispose();
            } else {
                liveGame.reset();
            }
        } catch {
            // The game may never have fully initialised (no game state yet) - nothing to abort.
        }
    }, []);

    // Dispose a run's session-scoped wiring and game. The reveal gate is deliberately left
    // unresolved: disposal aborts the sleeping timeline, whereas resolving it would let the
    // compiled story race the teardown.
    const disposeRunObject = useCallback((run: PreviewRun | null) => {
        if (!run) {
            return;
        }
        run.wireDispose?.();
        run.wireDispose = null;
        disposeLiveGame(run.liveGame);
        run.liveGame = null;
    }, [disposeLiveGame]);

    /** Rebuild the pane's stage stack from the run refs: pending beneath, display on top. */
    const refreshStageLayers = useCallback(() => {
        const layers: StoryScenePreviewStageLayer[] = [];
        if (pendingRunRef.current) {
            layers.push(pendingRunRef.current.layer);
        }
        if (displayRunRef.current) {
            layers.push(displayRunRef.current.layer);
        }
        setStageLayers(layers);
    }, []);

    const findRunBySessionId = useCallback((sessionId: string): PreviewRun | null => {
        if (pendingRunRef.current?.session.id === sessionId) {
            return pendingRunRef.current;
        }
        if (displayRunRef.current?.session.id === sessionId) {
            return displayRunRef.current;
        }
        return null;
    }, []);

    const failRun = useCallback((runId: number, message: string) => {
        if (runId !== runIdRef.current) {
            return;
        }
        clearDriveTimers();
        // Only the hidden buffer is torn down; a failed rebuild keeps the last good frame visible
        // beneath the error overlay.
        const pending = pendingRunRef.current;
        if (pending && pending.runId === runId) {
            pendingRunRef.current = null;
            disposeRunObject(pending);
            refreshStageLayers();
        }
        setErrorMessage(message);
        setPhase("error");
    }, [clearDriveTimers, disposeRunObject, refreshStageLayers, setPhase]);

    // Promote the posed pending run: wait until its hidden buffer is pixel-ready (images decoded
    // and painted beneath the display frame), then swap the buffers in one commit and release the
    // reveal gate so the target's own action plays on the now-visible stage.
    const promoteRun = useCallback(async (run: PreviewRun) => {
        const root = run.rootElement;
        if (root) {
            await waitForStageVisualReadyWithTimeout(root);
        } else {
            await waitForPaintFrames(2);
        }
        if (run.runId !== runIdRef.current || pendingRunRef.current !== run) {
            // Superseded while waiting; the supersede path owns the cleanup.
            return;
        }
        const retiring = displayRunRef.current;
        displayRunRef.current = run;
        pendingRunRef.current = null;
        setPlaybackStop(run.playbackStop);
        // Dispose the retiring run in the same task as the swap: its Player is still mounted, so
        // the reset aborts cleanly, and React commits the removal and the reveal in one paint.
        disposeRunObject(retiring);
        refreshStageLayers();
        run.resolveReveal();
    }, [disposeRunObject, refreshStageLayers]);

    const handleStagePosed = useCallback((runId: number) => {
        if (runId !== runIdRef.current) {
            return;
        }
        const run = pendingRunRef.current;
        if (!run || run.runId !== runId || run.posed) {
            return;
        }
        run.posed = true;
        void promoteRun(run);
    }, [promoteRun]);

    const handleBeforeTarget = useCallback((runId: number) => {
        if (runId !== runIdRef.current) {
            return;
        }
        const run = displayRunRef.current?.runId === runId
            ? displayRunRef.current
            : pendingRunRef.current?.runId === runId ? pendingRunRef.current : null;
        if (!run || run.arrived) {
            return;
        }
        run.arrived = true;
        clearDriveTimers();
        // Snapshot: the target action (if any) plays once after this marker and the frame holds.
        // Playback: everything from here on is the author's to drive, click by click.
        setPhase(run.continuous ? "playing" : "settled");
    }, [clearDriveTimers, setPhase]);

    // End of a continuous run's compiled tail: the scene ran out, or it reached a jump the
    // single-scene preview cannot follow. The last frame holds; the pane offers a replay.
    const handleAfterTarget = useCallback((runId: number) => {
        if (runId !== runIdRef.current) {
            return;
        }
        const run = displayRunRef.current?.runId === runId ? displayRunRef.current : null;
        if (run?.continuous) {
            setPhase("ended");
        }
    }, [setPhase]);

    /** Kick a mounted run's compiled story into motion. Distinct from `startPlayback`, which is
     *  the author entering playback mode; every run — snapshot or playback — starts through here. */
    const beginRun = useCallback((run: PreviewRun) => {
        if (run.runId !== runIdRef.current || !run.liveGame) {
            return;
        }
        clearDriveTimers();
        run.posed = false;
        run.arrived = false;
        setPhase("starting");
        try {
            run.liveGame.newGame();
        } catch (error) {
            failRun(run.runId, error instanceof Error ? error.message : String(error));
            return;
        }
        // The compiled story is pure state (instant seeds + injection script + gate + target); the
        // before-marker fires within the reveal wait. A miss means a compile/mount defect.
        settleTimeoutRef.current = setTimeout(() => {
            if (!run.arrived) {
                failRun(run.runId, "Preview stage did not settle in time.");
            }
        }, STATE_SETTLE_TIMEOUT_MS);
    }, [clearDriveTimers, failRun, setPhase]);

    const startRun = useCallback(async () => {
        const runId = ++runIdRef.current;
        clearDriveTimers();
        // Supersede any in-flight hidden rebuild; the visible frame is untouched.
        const superseded = pendingRunRef.current;
        pendingRunRef.current = null;
        disposeRunObject(superseded);
        if (!open || !active || !host.ready || !context || !document || !scene || !sceneId) {
            const display = displayRunRef.current;
            displayRunRef.current = null;
            disposeRunObject(display);
            refreshStageLayers();
            setPhase("idle");
            setErrorMessage(null);
            return;
        }
        setPhase("compiling");
        setErrorMessage(null);
        setIssues([]);
        try {
            const storyService = context.services.get<StoryService>(Services.Story);
            const animations = await loadReferencedAnimations(storyService, scene);
            if (runId !== runIdRef.current) {
                return;
            }
            const continuous = playback !== null;
            const targetBlockId = continuous ? playback.blockId : resolvedTargetId;
            const snapshot = computeStoryStageSnapshot({
                document,
                sceneId,
                targetBlockId,
                animations,
            });
            if (runId !== runIdRef.current) {
                return;
            }
            let resolveReveal: () => void = () => undefined;
            const revealGate = new Promise<void>(resolve => {
                resolveReveal = resolve;
            });
            const compiled = await compileStagePreviewToNlr({
                document,
                sceneId,
                snapshot,
                targetBlockId,
                characters: host.characters,
                animations,
                resolveAssetUrl,
                blueprintDocument: host.blueprintDocument,
                persistence: host.persistence,
                onStagePosed: () => handleStagePosed(runId),
                revealGate,
                onBeforeTarget: () => handleBeforeTarget(runId),
                onAfterTarget: () => handleAfterTarget(runId),
                continuous,
            });
            if (runId !== runIdRef.current) {
                return;
            }
            setDiagnostics(compiled.diagnostics);
            // Forward compile diagnostics to the Story console tab, but only the ones that are new
            // versus the previous compile - the preview recompiles on every row switch/edit, so
            // re-appending the whole (usually unchanged) set each time would flood the console.
            const diagnosticKeys = new Set<string>();
            for (const diag of compiled.diagnostics) {
                const key = `${diag.level}|${diag.message}`;
                diagnosticKeys.add(key);
                if (!loggedDiagnosticKeysRef.current.has(key)) {
                    logStoryConsole(diag.level, diag.message, "Compile");
                }
            }
            loggedDiagnosticKeysRef.current = diagnosticKeys;
            const sessionId = `story-preview-${runId}`;
            const previewGame = host.createPreviewGame({
                sessionId,
                requireLiveGame: operation => {
                    const liveGame = findRunBySessionId(sessionId)?.liveGame ?? null;
                    if (!liveGame) {
                        throw new Error(`${operation}: game runtime is not available`);
                    }
                    return liveGame;
                },
                getLiveGame: () => findRunBySessionId(sessionId)?.liveGame ?? null,
            });
            const session: NlrStageSession = {
                id: sessionId,
                game: previewGame.game,
                compiled,
                width: host.designSize.width,
                height: host.designSize.height,
                onStageNode: previewGame.onStageNode,
            };
            const run: PreviewRun = {
                runId,
                session,
                layer: {
                    session,
                    setRootElement: element => {
                        run.rootElement = element;
                    },
                },
                liveGame: null,
                wireLiveGame: previewGame.wireLiveGame,
                wireDispose: null,
                resolveReveal,
                rootElement: null,
                posed: false,
                arrived: false,
                targetBlockId,
                continuous,
                playbackStop: compiled.playbackStop ?? null,
            };
            pendingRunRef.current = run;
            setPhase("mounting");
            refreshStageLayers();
        } catch (error) {
            failRun(runId, error instanceof Error ? error.message : String(error));
        }
    }, [
        active,
        clearDriveTimers,
        context,
        disposeRunObject,
        document,
        failRun,
        findRunBySessionId,
        handleAfterTarget,
        handleBeforeTarget,
        handleStagePosed,
        host,
        logStoryConsole,
        open,
        playback,
        refreshStageLayers,
        resolveAssetUrl,
        resolvedTargetId,
        scene,
        sceneId,
        setPhase,
    ]);

    const startRunRef = useRef(startRun);
    startRunRef.current = startRun;

    const disposeAllRuns = useCallback(() => {
        clearDriveTimers();
        const pending = pendingRunRef.current;
        const display = displayRunRef.current;
        pendingRunRef.current = null;
        displayRunRef.current = null;
        disposeRunObject(pending);
        disposeRunObject(display);
    }, [clearDriveTimers, disposeRunObject]);

    // Debounced (re)build on any relevant change; immediate teardown when hidden/closed.
    useEffect(() => {
        if (debounceTimerRef.current !== null) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
        }
        if (!open || !active) {
            runIdRef.current += 1;
            lastRunInputRef.current = null;
            builtPlaybackTokenRef.current = null;
            disposeAllRuns();
            refreshStageLayers();
            setPhase("idle");
            return;
        }
        if (playback) {
            // A playback run is pinned: only an explicit (re)start rebuilds it. Selecting rows or
            // typing while it runs must not yank the stage out from under the author — those edits
            // land on the next start.
            if (builtPlaybackTokenRef.current === playback.token) {
                return;
            }
            if (!host.ready) {
                // Leave the token unbuilt so the rebuild lands once the game host comes up —
                // marking it here would swallow the only chance to start this run.
                return;
            }
            builtPlaybackTokenRef.current = playback.token;
            lastRunInputRef.current = null;
            void startRunRef.current();
            return;
        }
        builtPlaybackTokenRef.current = null;
        const previousInput = lastRunInputRef.current;
        const rowSwitchOnly = previousInput !== null
            && document !== null && sceneId !== null
            && previousInput.document === document
            && previousInput.sceneId === sceneId
            && previousInput.targetId !== resolvedTargetId;
        if (document && sceneId) {
            lastRunInputRef.current = { document, sceneId, targetId: resolvedTargetId };
        }
        debounceTimerRef.current = setTimeout(() => {
            debounceTimerRef.current = null;
            void startRunRef.current();
        }, rowSwitchOnly ? ROW_SWITCH_DEBOUNCE_MS : RECOMPILE_DEBOUNCE_MS);
        return () => {
            if (debounceTimerRef.current !== null) {
                clearTimeout(debounceTimerRef.current);
                debounceTimerRef.current = null;
            }
        };
    }, [open, active, host.ready, document, sceneId, resolvedTargetId, playback, disposeAllRuns, refreshStageLayers, setPhase]);

    // Full teardown on unmount.
    useEffect(() => () => {
        runIdRef.current += 1;
        disposeAllRuns();
    }, [disposeAllRuns]);

    const handleLiveGameReady = useCallback((sessionId: string, liveGame: LiveGame) => {
        const run = findRunBySessionId(sessionId);
        if (!run) {
            // A session that was replaced before it became ready: retire its game immediately.
            disposeLiveGame(liveGame);
            return;
        }
        // Idempotent against StrictMode double-mount: rewire and restart the drive.
        run.wireDispose?.();
        run.liveGame = liveGame;
        run.wireDispose = run.wireLiveGame(liveGame);
        try {
            const preference = liveGame.game.preference;
            // Scrubbing rows must stay silent — a frame per keystroke would machine-gun the audio.
            // Playback is the one mode where sound is the point, so it follows the author's toggle.
            preference.setPreference("globalVolume", run.continuous && !mutedRef.current ? 1 : 0);
            preference.setPreference("autoForward", false);
            preference.setPreference("skip", false);
        } catch {
            // Preference names are stable across NLR versions; a failure here is non-fatal.
        }
        if (run === pendingRunRef.current) {
            beginRun(run);
        } else {
            // The display run remounted (StrictMode): replay the compiled state to restore the
            // frame. Its markers are idempotent and its reveal gate is already resolved.
            try {
                liveGame.newGame();
            } catch (error) {
                failRun(run.runId, error instanceof Error ? error.message : String(error));
            }
        }
    }, [beginRun, disposeLiveGame, failRun, findRunBySessionId]);

    const handleStageError = useCallback((error: Error, sessionId: string) => {
        const run = findRunBySessionId(sessionId);
        if (!run || (run === displayRunRef.current && pendingRunRef.current !== null)) {
            // Teardown noise from a replaced session, or a stale frame kept only as the backdrop
            // while the next state builds - neither may fail the current run.
            pushIssue({ level: "warning", message: `Previous preview session: ${error.message}` });
            return;
        }
        failRun(runIdRef.current, error.message);
    }, [failRun, findRunBySessionId, pushIssue]);

    // Live audio toggle: applies to the frame already on screen, not just the next run.
    useEffect(() => {
        const run = displayRunRef.current;
        if (!run?.liveGame || !run.continuous) {
            return;
        }
        try {
            run.liveGame.game.preference.setPreference("globalVolume", muted ? 0 : 1);
        } catch {
            // Non-fatal; the next run applies the preference at start.
        }
    }, [muted, stageLayers]);

    const startPlayback = useCallback((blockId: string | null) => {
        const startId = scene ? resolvePlaybackStartBlockId(scene, blockId) : null;
        setPlaybackStop(null);
        setPlayback(current => ({ blockId: startId, token: (current?.token ?? 0) + 1 }));
    }, [scene]);

    const startPlaybackFromSelection = useCallback(() => {
        startPlayback(activeBlockId);
    }, [activeBlockId, startPlayback]);

    const restartPlayback = useCallback(() => {
        setPlaybackStop(null);
        setPlayback(current => (current ? { ...current, token: current.token + 1 } : current));
    }, []);

    const stopPlayback = useCallback(() => {
        setPlaybackStop(null);
        setPlayback(null);
    }, []);

    // Leaving the scene (or closing the pane) drops playback: its pinned row belongs to a scene
    // that is no longer on screen, and resuming it silently would preview the wrong thing.
    useEffect(() => {
        setPlayback(null);
        setPlaybackStop(null);
    }, [sceneId]);
    useEffect(() => {
        if (!open || !active) {
            setPlayback(null);
            setPlaybackStop(null);
        }
    }, [open, active]);

    const getStageContext = useCallback((): StoryScenePreviewStageContext | null => {
        const run = displayRunRef.current;
        if (!run || !run.liveGame) {
            return null;
        }
        return {
            liveGame: run.liveGame,
            compiled: run.session.compiled,
            targetBlockId: run.targetBlockId,
            // While a newer run builds hidden, the visible stage is still the old frame — report
            // what *it* is doing, not the pending run's phase.
            phase: run.arrived && !run.continuous ? "settled" : phaseRef.current,
        };
    }, []);

    return {
        phase,
        errorMessage,
        diagnostics,
        issues,
        stageLayers,
        designSize: host.designSize,
        targetBlockId: effectiveTargetId,
        mode: playback ? "play" : "follow",
        playFromBlockId: playback?.blockId ?? null,
        playbackStop,
        interactive: playback !== null,
        muted,
        setMuted,
        startPlayback,
        startPlaybackFromSelection,
        restartPlayback,
        stopPlayback,
        getStageContext,
        onLiveGameReady: handleLiveGameReady,
        onStageError: handleStageError,
    };
}

/** Load every animation asset the scene references (`animationId` refs), skipping unresolvable ones. */
async function loadReferencedAnimations(storyService: StoryService, scene: StoryScene): Promise<Record<string, StoryAnimationAsset>> {
    const ids = new Set<string>();
    const visit = (value: unknown): void => {
        if (!value || typeof value !== "object") {
            return;
        }
        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }
        const record = value as Record<string, unknown>;
        if (typeof record.animationId === "string" && record.animationId) {
            ids.add(record.animationId);
        }
        Object.values(record).forEach(visit);
    };
    for (const block of Object.values(scene.blocks)) {
        visit(block.payload);
    }
    const animations: Record<string, StoryAnimationAsset> = {};
    await Promise.all([...ids].map(async id => {
        try {
            animations[id] = await storyService.loadAnimationAsset(id);
        } catch {
            // Missing animation: the compiler emits its own diagnostic for the dangling ref.
        }
    }));
    return animations;
}
