import type { SurfaceStateStore } from "./SurfaceStateStore";
import type { DebugBridge } from "./DebugBridge";
import type { BindingDebugCoalescer } from "./BindingDebugCoalescer";

/**
 * Logical aggregate for one Dev Mode surface runtime (Blueprint M3-min).
 * Instantiation: Dev Mode session core is created in {@link useDevModeBlueprintRuntime}; the host adapter is built in
 * {@link DevModeContent} together with navigation and widget runtime patches (M3-full).
 */
export type BlueprintRuntimeSession = {
    surfaceId: string;
    surfaceState: SurfaceStateStore;
    debug: DebugBridge;
    bindingDebugCoalescer: BindingDebugCoalescer;
};
