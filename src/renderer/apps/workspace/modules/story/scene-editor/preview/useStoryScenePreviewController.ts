import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LiveGame } from "narraleaf-react";
import type { StoryAnimationAsset, StoryDocument, StoryScene } from "@shared/types/story";
import {
    compileStagePreviewToNlr,
    type NlrStoryCompileDiagnostic,
} from "@/lib/ui-editor/runtime/game/storyCompiler";
import { computeStoryStageSnapshot } from "@/lib/ui-editor/runtime/game/storyStageSnapshot";
import type { NlrStageSession } from "@/lib/ui-editor/runtime/game/NlrStageLayer";
import { createWorkspaceBlobUrlResolver, type WorkspaceBlobUrlResolver } from "@/lib/workspace/assets/resolveWorkspaceAssetUrl";
import { Services, WorkspaceContext } from "@/lib/workspace/services/services";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { useStoryPreviewGameUi, type StoryPreviewIssue } from "./useStoryPreviewGameUi";
import { resolvePreviewTargetBlockId } from "./storyScenePreviewTarget";

const RECOMPILE_DEBOUNCE_MS = 300;
/** Pre-posed state mounts within a few frames; anything longer means the marker never fired. */
const STATE_SETTLE_TIMEOUT_MS = 5_000;
const MAX_ISSUES = 20;

export type StoryScenePreviewPhase =
    | "idle"
    | "compiling"
    | "mounting"
    | "starting"
    | "settled"
    | "error";

export type StoryScenePreviewStageContext = {
    liveGame: LiveGame;
    compiled: NlrStageSession["compiled"];
    targetBlockId: string | null;
    phase: StoryScenePreviewPhase;
};

export type StoryScenePreviewController = {
    phase: StoryScenePreviewPhase;
    errorMessage: string | null;
    diagnostics: NlrStoryCompileDiagnostic[];
    issues: StoryPreviewIssue[];
    session: NlrStageSession | null;
    designSize: { width: number; height: number };
    targetBlockId: string | null;
    /** Phase-2 seam: the live stage at the previewed row (motion editor prefill). */
    getStageContext: () => StoryScenePreviewStageContext | null;
    /** Wire into NlrStageLayer's onLiveGameReady. */
    onLiveGameReady: (sessionId: string, liveGame: LiveGame) => void;
    /** Wire into NlrStageLayer's onError. */
    onStageError: (error: Error) => void;
};

/**
 * Drives the story preview stage. The Studio computes the settled stage state at the selected row
 * (computeStoryStageSnapshot) and compiles it into a "state player" story whose elements mount
 * pre-posed; the target row's own action then plays once on that stage and the preview holds the
 * resulting frame. The shell never fast-forwards — mounting IS the state.
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
    const [session, setSession] = useState<NlrStageSession | null>(null);

    const runIdRef = useRef(0);
    const phaseRef = useRef<StoryScenePreviewPhase>("idle");
    const sessionRef = useRef<NlrStageSession | null>(null);
    const liveGameRef = useRef<LiveGame | null>(null);
    const liveGameSessionIdRef = useRef<string | null>(null);
    const wireLiveGameRef = useRef<((liveGame: LiveGame) => () => void) | null>(null);
    const wireDisposeRef = useRef<(() => void) | null>(null);
    const arrivedRef = useRef(false);
    const targetBlockIdRef = useRef<string | null>(null);
    const settleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const blobResolverRef = useRef<WorkspaceBlobUrlResolver | null>(null);

    const setPhase = useCallback((next: StoryScenePreviewPhase) => {
        phaseRef.current = next;
        setPhaseState(next);
    }, []);

    const pushIssue = useCallback((issue: StoryPreviewIssue) => {
        setIssues(current => [...current.slice(-(MAX_ISSUES - 1)), issue]);
    }, []);

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

    const clearDriveTimers = useCallback(() => {
        if (settleTimeoutRef.current !== null) {
            clearTimeout(settleTimeoutRef.current);
            settleTimeoutRef.current = null;
        }
    }, []);

    const disposeRun = useCallback(() => {
        clearDriveTimers();
        wireDisposeRef.current?.();
        wireDisposeRef.current = null;
        liveGameRef.current = null;
        liveGameSessionIdRef.current = null;
        arrivedRef.current = false;
    }, [clearDriveTimers]);

    const failRun = useCallback((runId: number, message: string) => {
        if (runId !== runIdRef.current) {
            return;
        }
        clearDriveTimers();
        setErrorMessage(message);
        setPhase("error");
    }, [clearDriveTimers, setPhase]);

    const beginPlayback = useCallback((runId: number, liveGame: LiveGame) => {
        if (runId !== runIdRef.current) {
            return;
        }
        clearDriveTimers();
        arrivedRef.current = false;
        setPhase("starting");
        try {
            liveGame.newGame();
        } catch (error) {
            failRun(runId, error instanceof Error ? error.message : String(error));
            return;
        }
        // The compiled story is pure state (instant seeds + injection script + target); the
        // before-marker fires within a few frames. A miss means a compile/mount defect.
        settleTimeoutRef.current = setTimeout(() => {
            if (!arrivedRef.current) {
                failRun(runId, "Preview stage did not settle in time.");
            }
        }, STATE_SETTLE_TIMEOUT_MS);
    }, [clearDriveTimers, failRun, setPhase]);

    const handleBeforeTarget = useCallback((runId: number) => {
        if (runId !== runIdRef.current || arrivedRef.current) {
            return;
        }
        arrivedRef.current = true;
        if (settleTimeoutRef.current !== null) {
            clearTimeout(settleTimeoutRef.current);
            settleTimeoutRef.current = null;
        }
        // The target action (if any) plays once after this marker and the frame holds there.
        setPhase("settled");
    }, [setPhase]);

    const startRun = useCallback(async () => {
        const runId = ++runIdRef.current;
        disposeRun();
        if (!open || !active || !host.ready || !context || !document || !scene || !sceneId) {
            sessionRef.current = null;
            setSession(null);
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
            targetBlockIdRef.current = targetBlockId;
            const snapshot = computeStoryStageSnapshot({
                document,
                sceneId,
                targetBlockId,
                animations,
            });
            if (runId !== runIdRef.current) {
                return;
            }
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
                onBeforeTarget: () => handleBeforeTarget(runId),
                onAfterTarget: () => undefined,
            });
            if (runId !== runIdRef.current) {
                return;
            }
            setDiagnostics(compiled.diagnostics);
            const sessionId = `story-preview-${runId}`;
            const previewGame = host.createPreviewGame({
                sessionId,
                requireLiveGame: operation => {
                    const liveGame = liveGameRef.current;
                    if (!liveGame || liveGameSessionIdRef.current !== sessionId) {
                        throw new Error(`${operation}: game runtime is not available`);
                    }
                    return liveGame;
                },
                getLiveGame: () => liveGameRef.current,
            });
            const nextSession: NlrStageSession = {
                id: sessionId,
                game: previewGame.game,
                compiled,
                width: host.designSize.width,
                height: host.designSize.height,
                onStageNode: previewGame.onStageNode,
            };
            wireDisposeRef.current = null;
            wireLiveGameRef.current = previewGame.wireLiveGame;
            sessionRef.current = nextSession;
            setPhase("mounting");
            setSession(nextSession);
        } catch (error) {
            failRun(runId, error instanceof Error ? error.message : String(error));
        }
    }, [
        active,
        context,
        disposeRun,
        document,
        failRun,
        handleBeforeTarget,
        host,
        open,
        resolveAssetUrl,
        resolvedTargetId,
        scene,
        sceneId,
        setPhase,
    ]);

    const startRunRef = useRef(startRun);
    startRunRef.current = startRun;

    // Debounced (re)build on any relevant change; immediate teardown when hidden/closed.
    useEffect(() => {
        if (debounceTimerRef.current !== null) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
        }
        if (!open || !active) {
            runIdRef.current += 1;
            disposeRun();
            sessionRef.current = null;
            setSession(null);
            setPhase("idle");
            return;
        }
        debounceTimerRef.current = setTimeout(() => {
            debounceTimerRef.current = null;
            void startRunRef.current();
        }, RECOMPILE_DEBOUNCE_MS);
        return () => {
            if (debounceTimerRef.current !== null) {
                clearTimeout(debounceTimerRef.current);
                debounceTimerRef.current = null;
            }
        };
    }, [open, active, host.ready, document, sceneId, resolvedTargetId, disposeRun, setPhase]);

    // Full teardown on unmount.
    useEffect(() => () => {
        runIdRef.current += 1;
        disposeRun();
    }, [disposeRun]);

    const handleLiveGameReady = useCallback((sessionId: string, liveGame: LiveGame) => {
        const currentSession = sessionRef.current;
        if (!currentSession || currentSession.id !== sessionId) {
            return;
        }
        const runId = runIdRef.current;
        // Idempotent against StrictMode double-mount: rewire and restart the drive.
        clearDriveTimers();
        wireDisposeRef.current?.();
        liveGameRef.current = liveGame;
        liveGameSessionIdRef.current = sessionId;
        wireDisposeRef.current = wireLiveGameRef.current ? wireLiveGameRef.current(liveGame) : null;
        try {
            const preference = liveGame.game.preference;
            preference.setPreference("globalVolume", 0);
            preference.setPreference("autoForward", false);
            preference.setPreference("skip", false);
        } catch {
            // Preference names are stable across NLR versions; a failure here is non-fatal.
        }
        beginPlayback(runId, liveGame);
    }, [beginPlayback, clearDriveTimers]);

    const handleStageError = useCallback((error: Error) => {
        failRun(runIdRef.current, error.message);
    }, [failRun]);

    const getStageContext = useCallback((): StoryScenePreviewStageContext | null => {
        const currentSession = sessionRef.current;
        const liveGame = liveGameRef.current;
        if (!currentSession || !liveGame) {
            return null;
        }
        return {
            liveGame,
            compiled: currentSession.compiled,
            targetBlockId: targetBlockIdRef.current,
            phase: phaseRef.current,
        };
    }, []);

    return {
        phase,
        errorMessage,
        diagnostics,
        issues,
        session,
        designSize: host.designSize,
        targetBlockId: resolvedTargetId,
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
