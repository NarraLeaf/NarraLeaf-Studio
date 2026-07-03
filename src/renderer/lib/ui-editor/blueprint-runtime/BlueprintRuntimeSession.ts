import type { SurfaceStateStore } from "./SurfaceStateStore";
import type { DebugBridge } from "./DebugBridge";
import type { BindingDebugCoalescer } from "./BindingDebugCoalescer";

/**
 * Logical aggregate for one Dev Mode surface runtime (Blueprint M3-min).
 * Instantiation: the session core is created by useBlueprintRuntimeCore inside the shared GameApp
 * (src/renderer/lib/ui-editor/runtime/app/GameApp.tsx), which also builds host adapters and navigation.
 */
export type BlueprintRuntimeSession = {
    surfaceId: string;
    surfaceState: SurfaceStateStore;
    debug: DebugBridge;
    bindingDebugCoalescer: BindingDebugCoalescer;
};
