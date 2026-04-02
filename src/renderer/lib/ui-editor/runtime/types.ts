import type { CSSProperties, ReactNode } from "react";
import type { BlueprintHostApiContractVersion } from "@shared/types/blueprint/hostApi";
import type { UISurfaceId } from "@shared/types/ui-editor/document";

export type UIHost = "app" | "player";

/**
 * Runtime substrate for UI rendering and side effects.
 * M3+ implementations extend behavior toward @shared/types/blueprint host capabilities.
 */
export type UIHostAdapter = {
    host: UIHost;
    navigate?: (target: unknown) => Promise<void> | void;
    resolveSlot?: (slotId: string) => { mount: (node: ReactNode) => void } | null;
    effects: {
        runEffect: (effectId: string, payload: unknown) => Promise<void> | void;
    };
    /**
     * M1 latch: which frozen BlueprintHostApiContract generation this adapter targets.
     * Does not imply all capabilities are implemented yet.
     */
    blueprintHostApiVersion?: BlueprintHostApiContractVersion;
};

export type RenderSurfaceOptions = {
    surfaceId: UISurfaceId;
    hostAdapter: UIHostAdapter;
    className?: string;
    style?: CSSProperties;
};
