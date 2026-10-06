import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LiveGame } from "narraleaf-react";
import type { StoryAnimationAsset, StoryBlockId, StoryDocument, StoryScene } from "@shared/types/story";
import {
    compileStagePreviewToNlr,
    type NlrStoryCompileDiagnostic,
} from "@/lib/ui-editor/runtime/game/storyCompiler";
import { computeStoryStageSnapshot, resolveTakenConditionBranch } from "@/lib/ui-editor/runtime/game/storyStageSnapshot";
import {
    waitForPaintFrames,
    waitForStageVisualReadyWithTimeout,
    type NlrStageSession,
} from "@/lib/ui-editor/runtime/game/NlrStageLayer";
import { createWorkspaceBlobUrlResolver, type WorkspaceBlobUrlResolver } from "@/lib/workspace/assets/resolveWorkspaceAssetUrl";
import { collectAudioClipRegions } from "@/lib/workspace/assets/audioClipRegions";
import { Services, WorkspaceContext } from "@/lib/workspace/services/services";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { VariableRegistryService } from "@/lib/workspace/services/variables/VariableRegistryService";
import { buildPersistentRuntimeTable, buildSavedRuntimeTable } from "@shared/variables/variableRegistryModel";
import type { ConsoleService } from "@/lib/workspace/services/core/ConsoleService";
import type { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import type { AudioTrackService } from "@/lib/workspace/services/audio/AudioTrackService";
import { registerCharacterAvatarAssets } from "@/lib/ui-editor/runtime/characterAvatarAssets";
import { useStoryPreviewGameUi, type StoryPreviewGame, type StoryPreviewIssue } from "./useStoryPreviewGameUi";
import { resolvePreviewTargetBlockId } from "./storyScenePreviewTarget";
import { resolveChosenOptionStop, resolveNextPreviewStop, type StoryPreviewStepOptions } from "./storyPreviewStep";
import { STORY_CONSOLE_CHANNEL_ID } from "./storyPreviewConsole";
import { needsRunningGame } from "@/lib/ui-editor/runtime/app/runtimeRefusals";
import { RECOMPILE_DEBOUNCE_MS, storyPreviewRebuildDelay, type StoryPreviewRebuildInput } from "./storyPreviewRebuildSchedule";

/** Pre-posed state mounts within a few frames; anything longer means the marker never fired. */
const STATE_SETTLE_TIMEOUT_MS = 5_000;
const MAX_ISSUES = 20;

export type StoryScenePreviewPhase =
    | "idle"
    | "compiling"
    | "mounting"
    | "starting"
    /** The target row's action has played and the frame holds. */
    | "settled"
    | "error";

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
    /** Phase-2 seam: the live stage at the previewed row (motion editor prefill). */
    getStageContext: () => StoryScenePreviewStageContext | null;
    /** Wire into NlrStageLayer's onLiveGameReady. */
    onLiveGameReady: (sessionId: string, liveGame: LiveGame) => void;
    /** Wire into NlrStageLayer's onError. */
    onStageError: (error: Error, sessionId: string) => void;
    /**
     * A press on the stage: the reader's "next". A line still revealing is shown in full, as in the
     * game; otherwise the cursor moves to the next row the game stops on (see `storyPreviewStep`).
     * A menu answers only a pick from its options, made on the stage itself.
     */
    advanceFromStage: () => void;
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
    /** The game's own advance on this session's line (see `StoryPreviewGame.advance`). */
    advance: () => Promise<void>;
    /** See `StoryPreviewGame.afterNewGame`; called after every `newGame()` on this session. */
    afterNewGame: () => void;
    /**
     * A press was handed to the line to finish it. If the line had finished by the time it landed,
     * the press settled it instead and the story ran past the target - which is the press moving on.
     */
    advanceRequested: boolean;
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
    /**
     * Move the editor's cursor to a row, as a step: a press on the stage asks for the next row the
     * game stops on, and the preview follows the cursor there.
     */
    onStepTo?: (blockId: StoryBlockId) => void;
    /** Whether the editor is showing a row; a stop it is not showing is passed over. */
    isRowShown?: (blockId: StoryBlockId) => boolean;
}): StoryScenePreviewController {
    const { context, document, scene, sceneId, activeBlockId, active, open } = input;

    const [phase, setPhaseState] = useState<StoryScenePreviewPhase>("idle");
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [diagnostics, setDiagnostics] = useState<NlrStoryCompileDiagnostic[]>([]);
    const [issues, setIssues] = useState<StoryPreviewIssue[]>([]);
    const [stageLayers, setStageLayers] = useState<StoryScenePreviewStageLayer[]>([]);

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
    /** Last rebuild input; what changed since decides how long the rebuild waits. */
    const lastRunInputRef = useRef<StoryPreviewRebuildInput | null>(null);

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
    const hostRef = useRef(host);
    hostRef.current = host;

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

    // Recomputed per open rather than per render: the preview recompiles on a debounce anyway, and a
    // marker edited while the pane is open lands on the next rebuild.
    const audioClips = useMemo(
        () => (context && open ? collectAudioClipRegions(context.services.get<AssetsService>(Services.Assets)) : undefined),
        [context, open],
    );

    // Read on the same schedule as the clip regions, and for the same reason: a track edited while
    // the pane is open lands on the next rebuild. Without this the preview would resolve every row
    // against the three built-ins while the game resolves it against the project's own tracks - the
    // one difference an author would never think to look for.
    const audioTracks = useMemo(
        () => (context && open ? context.services.get<AudioTrackService>(Services.AudioTracks).listTracks() : undefined),
        [context, open],
    );

    /**
     * The project variable registry, as the two tables the snapshot walk and the compiler take.
     *
     * Neither was being passed here at all, so the preview stage resolved only the story's own
     * `/save` and `/global` declaration rows: a registry-backed variable had no default, and every
     * row that read or wrote one previewed differently from the way it plays. Read on the same
     * schedule as the clip regions and tracks above, and in ONE `getRegistry()` call for both
     * projections - two reads could observe a write landing between them and hand one compile two
     * mismatched halves of the same file.
     */
    const variableTables = useMemo(() => {
        if (!context || !open) {
            return null;
        }
        const registry = context.services.get<VariableRegistryService>(Services.VariableRegistry).getRegistry();
        return {
            saved: buildSavedRuntimeTable(registry),
            persistent: buildPersistentRuntimeTable(registry),
        };
    }, [context, open]);

    const resolvedTargetId = useMemo(
        () => (scene ? resolvePreviewTargetBlockId(scene, activeBlockId) : null),
        [scene, activeBlockId],
    );

    /**
     * What a press on the stage reads, as of the latest render. The press and the engine's markers
     * arrive between renders, and a press made while the previous one's row is still building has to
     * step on from the row the cursor is on now, not from the one the stage last showed.
     */
    const latestRef = useRef({ document, scene, sceneId, activeBlockId, resolvedTargetId, variableTables, onStepTo: input.onStepTo, isRowShown: input.isRowShown });
    latestRef.current = { document, scene, sceneId, activeBlockId, resolvedTargetId, variableTables, onStepTo: input.onStepTo, isRowShown: input.isRowShown };

    /**
     * How a step reads the scene. A condition is decided the way the stage snapshot decides one, from
     * the variables play reaches it with - walked through `via`, the row the step leaves, so the
     * option the author is reading counts.
     */
    const stepOptions = useCallback((via: StoryBlockId | null): StoryPreviewStepOptions => {
        const latest = latestRef.current;
        return {
            chooseBranch: condition => (latest.document && latest.sceneId
                ? resolveTakenConditionBranch({
                    document: latest.document,
                    sceneId: latest.sceneId,
                    conditionBlockId: condition.id,
                    via,
                    savedVariables: latest.variableTables?.saved,
                })
                : null),
            isShown: latest.isRowShown,
        };
    }, []);

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
        // Dispose the retiring run in the same task as the swap: its Player is still mounted, so
        // the reset aborts cleanly, and React commits the removal and the reveal in one paint.
        disposeRunObject(retiring);
        refreshStageLayers();
        // The retired row's persistent writes go with it, here rather than when the rebuild began so
        // the frame still on screen kept reading its own values until it was swapped out. The target's
        // own action, which may write one, runs after the reveal below.
        hostRef.current.resetPersistence();
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
        // The target action (if any) plays once after this marker and the frame holds.
        setPhase("settled");
    }, [clearDriveTimers, setPhase]);

    /** Answers a pick on a menu target's stage; assigned once `startRun` exists (see below). */
    const choiceTakenRef = useRef<(runId: number, optionBlockId: StoryBlockId) => void>(() => undefined);

    /** Move the cursor to the next row play stops on after the one it is on. */
    const stepOn = useCallback(() => {
        const { scene: currentScene, activeBlockId: fromBlockId, onStepTo } = latestRef.current;
        if (!currentScene || !onStepTo) {
            return;
        }
        const next = resolveNextPreviewStop(currentScene, fromBlockId, stepOptions(fromBlockId));
        if (next) {
            onStepTo(next);
        }
    }, [stepOptions]);

    const handleAfterTarget = useCallback((runId: number) => {
        const run = displayRunRef.current;
        if (!run || run.runId !== runId || !run.advanceRequested || pendingRunRef.current) {
            return;
        }
        run.advanceRequested = false;
        stepOn();
    }, [stepOn]);

    /** Kick a mounted run's compiled story into motion. */
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
            run.afterNewGame();
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
            const targetBlockId = resolvedTargetId;
            const snapshot = computeStoryStageSnapshot({
                document,
                sceneId,
                targetBlockId,
                animations,
                savedVariables: variableTables?.saved,
                // The same cast the compile below is handed: the frozen preview poses a character
                // from this snapshot, so it has to fold her entrance defaults the same way.
                characters: host.characters,
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
                audioClips,
                audioTracks,
                blueprintDocument: host.blueprintDocument,
                savedVariables: variableTables?.saved,
                persistentVariables: variableTables?.persistent,
                persistence: host.persistence,
                onStagePosed: () => handleStagePosed(runId),
                revealGate,
                onBeforeTarget: () => handleBeforeTarget(runId),
                // The frame holds on the target. The story runs past it only when a press handed to
                // a line settled it, and that press is then the step on.
                onAfterTarget: () => handleAfterTarget(runId),
                // A pick on a menu target is a request to look at its branch.
                onChoiceTaken: optionBlockId => choiceTakenRef.current(runId, optionBlockId),
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
            const previewGame: StoryPreviewGame = host.createPreviewGame({
                sessionId,
                requireLiveGame: asker => {
                    const liveGame = findRunBySessionId(sessionId)?.liveGame ?? null;
                    if (!liveGame) {
                        throw needsRunningGame(asker);
                    }
                    return liveGame;
                },
                getLiveGame: () => findRunBySessionId(sessionId)?.liveGame ?? null,
                resolveAvatarAssetId: url => compiled.avatarAssetIdByUrl.get(url) ?? null,
                compiled,
            });
            // The preview's Image widgets resolve avatar ids through the same synchronous table the
            // packaged runtime uses, so a swap here costs a map read rather than an asset fetch.
            registerCharacterAvatarAssets(compiled.avatarAssetIdByUrl);
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
                advance: previewGame.advance,
                afterNewGame: previewGame.afterNewGame,
                advanceRequested: false,
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
        refreshStageLayers,
        resolveAssetUrl,
        resolvedTargetId,
        scene,
        sceneId,
        setPhase,
        variableTables,
    ]);

    const startRunRef = useRef(startRun);
    startRunRef.current = startRun;

    /**
     * An option was picked on the stage. The cursor moves to the first row the pick stops on; when
     * there is none - an empty branch at the end of the scene - the menu row is rebuilt, so the stage
     * goes back to showing the menu the cursor is still on.
     */
    choiceTakenRef.current = (runId, optionBlockId) => {
        const { scene: currentScene, onStepTo } = latestRef.current;
        if (runId !== displayRunRef.current?.runId || !currentScene || !onStepTo) {
            return;
        }
        const next = resolveChosenOptionStop(currentScene, optionBlockId, stepOptions(optionBlockId));
        if (next) {
            onStepTo(next);
        } else {
            void startRunRef.current();
        }
    };

    const advanceFromStage = useCallback(() => {
        const { scene: currentScene, resolvedTargetId: targetId } = latestRef.current;
        if (!currentScene || !open || !active) {
            return;
        }
        const target = targetId ? currentScene.blocks[targetId] : undefined;
        // A menu waits for a pick, made on one of its options (see `choiceTakenRef`). A press
        // anywhere else moves nothing, as in the game.
        if (target?.kind === "nodeAction" && target.payload.action === "choice") {
            return;
        }
        // A line still revealing is shown in full first, as a press does in the game - but only on
        // the row's own frame. While a newer row builds beneath it, the press is about that row.
        const display = displayRunRef.current;
        if (display?.liveGame && !pendingRunRef.current && display.targetBlockId === targetId && isLineRevealing(display.liveGame)) {
            display.advanceRequested = true;
            void display.advance().catch(() => undefined);
            return;
        }
        stepOn();
    }, [active, open, stepOn]);

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
            disposeAllRuns();
            refreshStageLayers();
            setPhase("idle");
            return;
        }
        const previousInput = lastRunInputRef.current;
        const nextInput: StoryPreviewRebuildInput | null = document && sceneId
            ? { document, sceneId, targetId: resolvedTargetId, gameUi: host.gameUi }
            : null;
        if (nextInput) {
            lastRunInputRef.current = nextInput;
        }
        debounceTimerRef.current = setTimeout(() => {
            debounceTimerRef.current = null;
            void startRunRef.current();
        }, nextInput ? storyPreviewRebuildDelay(previousInput, nextInput) : RECOMPILE_DEBOUNCE_MS);
        return () => {
            if (debounceTimerRef.current !== null) {
                clearTimeout(debounceTimerRef.current);
                debounceTimerRef.current = null;
            }
        };
    }, [open, active, host.ready, host.gameUi, document, sceneId, resolvedTargetId, disposeAllRuns, refreshStageLayers, setPhase]);

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
            // The frozen state preview is always silent — a frame per keystroke would machine-gun the audio.
            preference.setPreference("globalVolume", 0);
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
                run.afterNewGame();
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
            phase: run.arrived ? "settled" : phaseRef.current,
        };
    }, []);

    return {
        phase,
        errorMessage,
        diagnostics,
        issues,
        stageLayers,
        designSize: host.designSize,
        targetBlockId: resolvedTargetId,
        getStageContext,
        onLiveGameReady: handleLiveGameReady,
        onStageError: handleStageError,
        advanceFromStage,
    };
}

/**
 * True while the line on the stage is still revealing, so the press that shows the rest of it comes
 * before the press that moves on. The engine's own record of the line: an ADV box that has not run
 * out of characters, or an NVL page still typing.
 */
function isLineRevealing(liveGame: LiveGame): boolean {
    try {
        const state = liveGame.getGameState();
        const adv = state?.getAdvDialogState();
        if (adv) {
            return !adv.ended;
        }
        const nvl = state?.getNvlState();
        return nvl?.active === true && nvl.phase === "typing";
    } catch {
        return false;
    }
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
