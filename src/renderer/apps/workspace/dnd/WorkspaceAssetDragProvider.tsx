import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { WorkspaceAssetDragSession } from "./types";
import type { Asset } from "@/lib/workspace/services/assets/types";

export interface WorkspaceAssetDragContextValue {
    session: WorkspaceAssetDragSession | null;
    beginSession: (assets: Asset[], primaryId: string, sourcePanelId?: string) => void;
    endSession: () => void;
}

const WorkspaceAssetDragContext = createContext<WorkspaceAssetDragContextValue | null>(null);

export function WorkspaceAssetDragProvider({ children }: { children: ReactNode }) {
    const [session, setSession] = useState<WorkspaceAssetDragSession | null>(null);

    const beginSession = useCallback((assets: Asset[], primaryId: string, sourcePanelId?: string) => {
        setSession({ assets, primaryId, sourcePanelId });
    }, []);

    const endSession = useCallback(() => {
        setSession(null);
    }, []);

    const value = useMemo<WorkspaceAssetDragContextValue>(
        () => ({ session, beginSession, endSession }),
        [session, beginSession, endSession]
    );

    return <WorkspaceAssetDragContext.Provider value={value}>{children}</WorkspaceAssetDragContext.Provider>;
}

export function useWorkspaceAssetDrag(): WorkspaceAssetDragContextValue {
    const ctx = useContext(WorkspaceAssetDragContext);
    if (!ctx) {
        throw new Error("useWorkspaceAssetDrag must be used within WorkspaceAssetDragProvider");
    }
    return ctx;
}

/** Safe for optional integration (e.g. tests); returns null outside provider. */
export function useWorkspaceAssetDragOptional(): WorkspaceAssetDragContextValue | null {
    return useContext(WorkspaceAssetDragContext);
}
