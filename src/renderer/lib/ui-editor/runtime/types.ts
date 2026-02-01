import type { CSSProperties, ReactNode } from "react";
import type { UISurfaceId } from "@shared/types/ui-editor/document";

export type UIHost = "app" | "player";

export type UIHostAdapter = {
    host: UIHost;
    navigate?: (target: unknown) => Promise<void> | void;
    resolveSlot?: (slotId: string) => { mount: (node: ReactNode) => void } | null;
    effects: {
        runEffect: (effectId: string, payload: unknown) => Promise<void> | void;
    };
};

export type RenderSurfaceOptions = {
    surfaceId: UISurfaceId;
    hostAdapter: UIHostAdapter;
    className?: string;
    style?: CSSProperties;
};
