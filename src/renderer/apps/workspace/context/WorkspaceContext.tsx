import React, { createContext, useContext, useState, useEffect } from "react";
import { AppHost, AppProtocol } from "@shared/types/constants";
import { RequestStatus } from "@shared/types/ipcEvents";
import { AssetSource } from "@/lib/workspace/services/assets/types";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { getInterface } from "@/lib/app/bridge";
import { appPrivilegedFacade } from "@/lib/app/privilegedFacade";
import { Workspace } from "@/lib/workspace/workspace";
import { ProjectNameConvention } from "@/lib/workspace/project/nameConvention";
import { Services, WorkspaceContext as WorkspaceCtx } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
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

        const assetsService = context.services.get<AssetsService>(Services.Assets);
        const handler = async ({ assetId, assetType }: { assetId: string; assetType?: string }): Promise<RequestStatus<{ url: string }>> => {
            const assets = assetsService.getAssets();
            const typedAsset = Object.values(AssetType).includes(assetType as AssetType)
                ? assets[assetType as AssetType]?.[assetId]
                : undefined;
            const asset = typedAsset ?? Object.values(AssetType)
                .map(type => assets[type]?.[assetId])
                .find(Boolean);
            if (!asset) {
                return {
                    success: false,
                    error: "Asset not found",
                };
            }

            if (asset.source === AssetSource.Remote) {
                const url = (asset.meta as any)?.url;
                if (typeof url !== "string" || !url.trim()) {
                    return {
                        success: false,
                        error: "Remote asset URL missing",
                    };
                }
                return {
                    success: true,
                    data: { url },
                };
            }

            const assetPath = context.project.resolve(ProjectNameConvention.AssetsDataShard(assetId));
            const request = await appPrivilegedFacade.fs.requestReadRaw(assetPath);

            if (!request.success || !request.data?.ok) {
                return {
                    success: false,
                    error: request.error ?? "Failed to resolve asset file",
                };
            }

            const url = `${AppProtocol}://${AppHost.Fs}/${request.data.data}`;
            return {
                success: true,
                data: { url },
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
