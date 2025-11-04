import React, { createContext, useContext, useState, useEffect } from "react";
import { Workspace } from "@/lib/workspace/workspace";
import { WorkspaceContext as WorkspaceCtx } from "@/lib/workspace/services/services";
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

