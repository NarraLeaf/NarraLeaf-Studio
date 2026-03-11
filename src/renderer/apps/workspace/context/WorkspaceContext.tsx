import React, { createContext, useContext, useState, useEffect } from "react";
import { AppHost, AppProtocol } from "@shared/types/constants";
import { RequestStatus } from "@shared/types/ipcEvents";
import { AssetSource } from "@/lib/workspace/services/assets/types";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { getInterface } from "@/lib/app/bridge";
import { Workspace } from "@/lib/workspace/workspace";
import { ProjectNameConvention } from "@/lib/workspace/project/nameConvention";
import { Services, WorkspaceContext as WorkspaceCtx } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import { Service } from "@/lib/workspace/services/Service";

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

        const initWorkspace = async () => {
            try {
                // Create workspace context
                const ctx = await Workspace.createContext();
                
                // Initialize all services
                await Service.initializeAll(ctx);
                
                // Activate all services
                for (const service of ctx.services.getAll()) {
                    await service.activate(ctx);
                }

                // Create workspace instance
                const ws = Workspace.create(ctx);

                if (mounted) {
                    setContext(ctx);
                    setWorkspace(ws);
                    setIsInitialized(true);

                    // Add to recent projects only when successfully loaded
                    const projectService = ctx.services.get<ProjectService>(Services.Project);
                    const projectConfig = projectService.getProjectConfig();
                    const projectPath = ctx.project.getConfig().projectPath;
                    getInterface().app.addRecentProject(projectConfig.name, projectPath);
                }
            } catch (err) {
                console.error("Failed to initialize workspace:", err);
                if (mounted) {
                    setError(err instanceof Error ? err : new Error(String(err)));
                }
            }
        };

        initWorkspace();

        return () => {
            mounted = false;
            // Cleanup services when unmounting
            if (context) {
                for (const service of context.services.getAll()) {
                    service.dispose(context);
                }
            }
        };
    }, []);

    useEffect(() => {
        if (!context) {
            return;
        }

        const assetsService = context.services.get<AssetsService>(Services.Assets);
        const iface = getInterface();

        const handler = async ({ assetId }: { assetId: string }): Promise<RequestStatus<{ url: string }>> => {
            const asset = assetsService.getAssets()[AssetType.Image][assetId];
            if (!asset) {
                return {
                    success: false,
                    error: "Image asset not found",
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
            const request = await iface.fs.requestReadRaw(assetPath);

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

        const token = iface.workspace.onResolveImageAssetUrl(handler);
        return () => {
            token.cancel();
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

