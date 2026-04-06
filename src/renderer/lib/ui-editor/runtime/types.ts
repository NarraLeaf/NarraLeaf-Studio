import type { CSSProperties, ReactNode } from "react";
import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";
import type { BlueprintHostApiContractVersion } from "@shared/types/blueprint/hostApi";
import type { UISurfaceId } from "@shared/types/ui-editor/document";
import type { BlueprintHostApiRuntime } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";

export type UIHost = "app" | "player";

/**
 * Dev Mode / runtime hooks for Blueprint M3-min (surface state + event dispatch).
 * Editor preview typically omits this field (no-op behavior in widgets).
 */
export type UIHostAdapterBlueprintRuntime = {
    surfaceId: string;
    setSurfaceState: (key: string, value: unknown) => void;
    getSurfaceState: (key: string) => unknown;
    emitDebug: (event: BlueprintDebugEvent) => void;
    dispatchElementBlueprintEvent: (elementId: string, eventName: string) => Promise<void>;
    /** M3-full: Dev Mode host API (graphs + TS ctx); absent in editor preview. */
    hostApi?: BlueprintHostApiRuntime;
};

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
    /** M3-min: optional Blueprint runtime surface (Dev Mode). */
    blueprintRuntime?: UIHostAdapterBlueprintRuntime;
};

export type RenderSurfaceOptions = {
    surfaceId: UISurfaceId;
    hostAdapter: UIHostAdapter;
    className?: string;
    style?: CSSProperties;
};
