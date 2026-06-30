import type { CSSProperties, ReactNode } from "react";
import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";
import type { BlueprintHostApiContractVersion } from "@shared/types/blueprint/hostApi";
import type { UIDocument, UIComponentId, UISurfaceId, UIStageSlotId } from "@shared/types/ui-editor/document";
import type { UIListItemScope } from "@shared/types/ui-editor/list";
import type { BlueprintHostApiRuntime } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";

export type UIHost = "app" | "player";

/**
 * Dev Mode / runtime hooks for Blueprint M3-min (surface state + event dispatch).
 * Editor preview typically omits this field (no-op behavior in widgets).
 */
export type UIHostAdapterBlueprintRuntime = {
    surfaceId: string;
    /** Instance-specific scope id. Defaults to `surfaceId` for top-level surfaces. */
    runtimeScopeId?: string;
    setSurfaceState: (key: string, value: unknown) => void;
    getSurfaceState: (key: string) => unknown;
    emitDebug: (event: BlueprintDebugEvent) => void;
    /** Dispatch a widget private event slot (for example `init` or `mouseClick`) on the owner-local blueprint. */
    dispatchElementBlueprintEvent: (
        elementId: string,
        eventName: string,
        payload?: Record<string, unknown>,
        options?: {
            listItemScope?: UIListItemScope | null;
            instanceKey?: string;
        },
    ) => Promise<void>;
    dispatchBroadcastEvent?: (eventName: string, data: unknown, sender?: string) => Promise<void>;
    getBroadcastListenerCount?: (eventName: string) => number;
    frame?: {
        getParam: (key: string) => unknown;
        emit: (eventName: string, data: unknown) => Promise<void> | void;
    };
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
    gameUiRuntime?: {
        slotId: UIStageSlotId;
    };
    /**
     * M1 latch: which frozen BlueprintHostApiContract generation this adapter targets.
     * Does not imply all capabilities are implemented yet.
     */
    blueprintHostApiVersion?: BlueprintHostApiContractVersion;
    /** M3-min: optional Blueprint runtime surface (Dev Mode). */
    blueprintRuntime?: UIHostAdapterBlueprintRuntime;
    /** Editor preview: use the active workspace service instance for canvas-local interaction overrides. */
    editorStateService?: UIEditorStateService;
};

export type RenderSurfaceOptions = {
    surfaceId: UISurfaceId;
    hostAdapter: UIHostAdapter;
    className?: string;
    style?: CSSProperties;
    editorChrome?: boolean;
};

export type RenderDocumentSurfaceOptions = RenderSurfaceOptions & {
    document: UIDocument;
};

export type RenderComponentOptions = {
    componentId: UIComponentId;
    hostAdapter: UIHostAdapter;
    className?: string;
    style?: CSSProperties;
    editorChrome?: boolean;
};
