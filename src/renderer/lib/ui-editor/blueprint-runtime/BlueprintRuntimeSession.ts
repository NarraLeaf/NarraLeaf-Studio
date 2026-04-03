import type { SurfaceStateStore } from "./SurfaceStateStore";
import type { DebugBridge } from "./DebugBridge";
import type { BindingDebugCoalescer } from "./BindingDebugCoalescer";

/**
 * Logical aggregate for one Dev Mode surface runtime (Blueprint M3-min).
 * Instantiation: {@link useDevModeBlueprintRuntime} in the Dev Mode app.
 */
export type BlueprintRuntimeSession = {
    surfaceId: string;
    surfaceState: SurfaceStateStore;
    debug: DebugBridge;
    bindingDebugCoalescer: BindingDebugCoalescer;
};
