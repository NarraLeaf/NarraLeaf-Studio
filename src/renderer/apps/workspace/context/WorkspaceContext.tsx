import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { RequestStatus } from "@shared/types/ipcEvents";
import { getInterface } from "@/lib/app/bridge";
import { Workspace } from "@/lib/workspace/workspace";
import { createWorkspaceAssetUrlResolver } from "@/lib/workspace/assets/resolveWorkspaceAssetUrl";
import { Services, WorkspaceContext as WorkspaceCtx } from "@/lib/workspace/services/services";
import { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { translate } from "@/lib/i18n";
import { Service } from "@/lib/workspace/services/Service";
import { ensureWorkspaceProjectCanStart } from "@/lib/workspace/startup/workspaceProjectPreflight";
import { flushPendingSaves } from "@/lib/workspace/services/autosave/flushPendingSaves";
import type { WorkspaceStartupStage } from "../components/WorkspaceOpeningOverlay";

interface WorkspaceProviderProps {
    children: React.ReactNode;
}

interface WorkspaceContextValue {
    workspace: Workspace | null;
    context: WorkspaceCtx | null;
    isInitialized: boolean;
    error: Error | null;
    /**
     * Which part of the startup is running, for as long as one is.
     *
     * Only the overlay reads it, but it belongs to the provider: the provider is what performs the
     * steps, and a window that stays blank through all of them is the thing being fixed.
     */
    startupStage: WorkspaceStartupStage;
    /**
     * Start the whole initialization over.
     *
     * Worth having because most of what makes this fail is not the project: a file still being
     * written by another tool, a network volume that had not woken up, a plugin that threw once.
     * Before this existed the only way to try again was to kill the window.
     */
    retry: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

let workspaceInitQueue: Promise<void> = Promise.resolve();

function enqueueWorkspaceInit<T>(task: () => Promise<T>): Promise<T> {
    const run = workspaceInitQueue.then(task, task);
    workspaceInitQueue = run.then(
        () => undefined,
        () => undefined,
    );
    return run;
}

/**
 * Wait until the browser has painted whatever was just put on screen.
 *
 * Used for exactly one thing: the last startup stage. Mounting the editor is synchronous work, so
 * announcing it and rendering it in the same task would show the author the *previous* stage's
 * message for the whole of it - the one moment where the window is least responsive would be
 * narrated wrong. A frame in hand costs the open ~16ms and buys an honest message.
 *
 * Two frames rather than one because a rAF callback runs *before* its own paint: the second one
 * only fires once the first has been committed. The timeout is not a nicety - a window that is
 * hidden or fully occluded gets no frames at all, and the open must not hang on one.
 */
function yieldToPaint(): Promise<void> {
    return new Promise<void>(resolve => {
        let settled = false;
        const finish = () => {
            if (settled) {
                return;
            }
            settled = true;
            window.clearTimeout(fallback);
            resolve();
        };
        const fallback = window.setTimeout(finish, 120);
        requestAnimationFrame(() => requestAnimationFrame(finish));
    });
}

/**
 * Provider for workspace context
 * Initializes workspace and all services
 */
export function WorkspaceProvider({ children }: WorkspaceProviderProps) {
    const [workspace, setWorkspace] = useState<Workspace | null>(null);
    const [context, setContext] = useState<WorkspaceCtx | null>(null);
    const [isInitialized, setIsInitialized] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [startupStage, setStartupStage] = useState<WorkspaceStartupStage>("preparing");
    const [attempt, setAttempt] = useState(0);
    const contextRef = useRef<WorkspaceCtx | null>(null);
    contextRef.current = context;

    const retry = React.useCallback(() => {
        setError(null);
        setIsInitialized(false);
        setWorkspace(null);
        setContext(null);
        setStartupStage("preparing");
        setAttempt(previous => previous + 1);
    }, []);

    useEffect(() => {
        let mounted = true;
        let cleanupContext: WorkspaceCtx | null = null;
        let canDispose = false;
        let disposed = false;

        const disposeWorkspace = async () => {
            if (!cleanupContext || disposed) {
                return;
            }
            disposed = true;
            await Service.disposeAll(cleanupContext);
        };

        const initWorkspace = async () => {
            try {
                await enqueueWorkspaceInit(async () => {
                    // Create workspace context
                    setStartupStage("preparing");
                    const ctx = await Workspace.createContext();
                    cleanupContext = ctx;

                    // Validate the selected folder before booting workspace services.
                    await ensureWorkspaceProjectCanStart(ctx.project.getConfig().projectPath);

                    // Initialize all services
                    setStartupStage("services");
                    await Service.initializeAll(ctx);

                    // Activate all services
                    for (const service of ctx.services.getAll()) {
                        await service.activate(ctx);
                    }
                    canDispose = true;

                    if (!mounted) {
                        await disposeWorkspace();
                        return;
                    }

                    // Create workspace instance
                    const ws = Workspace.create(ctx);

                    // Say what the next stage is and let it reach the screen *before* handing over:
                    // everything after this line renders the editor synchronously, so this is the
                    // last chance to describe the wait the author is about to sit through.
                    setStartupStage("interface");
                    await yieldToPaint();
                    if (!mounted) {
                        await disposeWorkspace();
                        return;
                    }

                    setContext(ctx);
                    setWorkspace(ws);
                    setIsInitialized(true);

                    // Add to recent projects only when successfully loaded
                    const projectService = ctx.services.get<ProjectService>(Services.Project);
                    const projectConfig = projectService.getProjectConfig();
                    const projectPath = ctx.project.getConfig().projectPath;
                    getInterface().app.addRecentProject(projectConfig.name, projectPath);

                    // Replace-style launches wait on this before retiring the opener window.
                    getInterface().workspace.reportLoadResult(true);
                });
            } catch (err) {
                console.error("Failed to initialize workspace:", err);
                // Tells a pending replace-launch to keep its opener: this window failed to
                // become a workspace (e.g. the folder is not a project).
                getInterface().workspace.reportLoadResult(false);
                await disposeWorkspace();
                if (mounted) {
                    setError(err instanceof Error ? err : new Error(String(err)));
                }
            }
        };

        initWorkspace();

        return () => {
            mounted = false;
            if (canDispose) {
                void enqueueWorkspaceInit(disposeWorkspace);
            }
        };
    }, [attempt]);

    useEffect(() => {
        if (!context) {
            return;
        }

        const resolveAssetUrl = createWorkspaceAssetUrlResolver(context);
        const handler = async ({ assetId, assetType }: { assetId: string; assetType?: string }): Promise<RequestStatus<{ url: string }>> => {
            const result = await resolveAssetUrl(assetId, assetType);
            if (!result.success) {
                return {
                    success: false,
                    error: result.error,
                };
            }
            return {
                success: true,
                data: { url: result.url },
            };
        };

        const assetToken = getInterface().workspace.onResolveAssetUrl(handler);
        const imageToken = getInterface().workspace.onResolveImageAssetUrl(handler);
        return () => {
            assetToken.cancel();
            imageToken.cancel();
        };
    }, [context]);

    // The window's close guard lives in the main process, but the prompt has to look like every
    // other Studio dialog, so main asks us to render it and waits for the answer.
    //
    // Registered on mount rather than with the context, because main blocks the close until this
    // replies: closing while the workspace is still starting up must not hang on a handler that
    // does not exist yet. Until there is a context there is also nothing to lose, so it just
    // agrees to close.
    useEffect(() => {
        const token = getInterface().workspace.onConfirmClose(async () => {
            const currentContext = contextRef.current;
            if (!currentContext) {
                return { success: true, data: { confirmed: true } };
            }

            const uiService = currentContext.services.get<UIService>(Services.UI);
            const confirmed = await uiService.showConfirm(
                translate("workspace.shell.closeConfirm.message"),
                translate("workspace.shell.closeConfirm.detail"),
            );
            return { success: true, data: { confirmed } };
        });

        // Registered in the same mount effect as the close guard, and for the same reason: main
        // blocks the close (and the quit) waiting for this reply. A handler that only exists once
        // the workspace has finished starting up would leave main sitting out its full timeout
        // every time someone closes a window during startup - when there is nothing to save at all.
        const flushToken = getInterface().workspace.onFlushPendingSaves(async () => {
            const currentContext = contextRef.current;
            if (!currentContext) {
                return { success: true, data: { flushed: true } };
            }
            const result = await flushPendingSaves(currentContext);
            return { success: true, data: { flushed: result.flushed } };
        });

        return () => {
            token.cancel();
            flushToken.cancel();
        };
    }, []);

    return (
        <WorkspaceContext.Provider value={{ workspace, context, isInitialized, error, startupStage, retry }}>
            {children}
        </WorkspaceContext.Provider>
    );
}

/**
 * Hook to access workspace context
 */
export function useWorkspace() {
    const ctx = useContext(WorkspaceContext);
    if (!ctx) {
        throw new Error("useWorkspace must be used within WorkspaceProvider");
    }
    return ctx;
}
