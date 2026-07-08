import React, { createContext, useContext, useState, useEffect } from "react";
import { RequestStatus } from "@shared/types/ipcEvents";
import { getInterface } from "@/lib/app/bridge";
import { Workspace } from "@/lib/workspace/workspace";
import { createWorkspaceAssetUrlResolver } from "@/lib/workspace/assets/resolveWorkspaceAssetUrl";
import { Services, WorkspaceContext as WorkspaceCtx } from "@/lib/workspace/services/services";
import { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import { Service } from "@/lib/workspace/services/Service";
import { ensureWorkspaceProjectCanStart } from "@/lib/workspace/startup/workspaceProjectPreflight";

interface WorkspaceProviderProps {
    children: React.ReactNode;
}

interface WorkspaceContextValue {
    workspace: Workspace | null;
    context: WorkspaceCtx | null;
    isInitialized: boolean;
    error: Error | null;
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
 * Provider for workspace context
 * Initializes workspace and all services
 */
export function WorkspaceProvider({ children }: WorkspaceProviderProps) {
    const [workspace, setWorkspace] = useState<Workspace | null>(null);
    const [context, setContext] = useState<WorkspaceCtx | null>(null);
    const [isInitialized, setIsInitialized] = useState(false);
    const [error, setError] = useState<Error | null>(null);

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
                    const ctx = await Workspace.createContext();
                    cleanupContext = ctx;

                    // Validate the selected folder before booting workspace services.
                    await ensureWorkspaceProjectCanStart(ctx.project.getConfig().projectPath);

                    // Initialize all services
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

                    setContext(ctx);
                    setWorkspace(ws);
                    setIsInitialized(true);

                    // Add to recent projects only when successfully loaded
                    const projectService = ctx.services.get<ProjectService>(Services.Project);
                    const projectConfig = projectService.getProjectConfig();
                    const projectPath = ctx.project.getConfig().projectPath;
                    getInterface().app.addRecentProject(projectConfig.name, projectPath);
                });
            } catch (err) {
                console.error("Failed to initialize workspace:", err);
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
    }, []);

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

    return (
        <WorkspaceContext.Provider value={{ workspace, context, isInitialized, error }}>
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
