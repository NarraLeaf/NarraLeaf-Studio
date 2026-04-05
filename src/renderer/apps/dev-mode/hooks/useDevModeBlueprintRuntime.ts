import { useEffect, useState } from "react";
import type { UISurface } from "@shared/types/ui-editor/document";
import type { DevModeBundle } from "@shared/types/devMode";
import { SurfaceStateStore } from "@/lib/ui-editor/blueprint-runtime/SurfaceStateStore";
import { DebugBridge } from "@/lib/ui-editor/blueprint-runtime/DebugBridge";
import { BindingDebugCoalescer } from "@/lib/ui-editor/blueprint-runtime/BindingDebugCoalescer";
import { createDevModeBlueprintHostAdapter } from "@/lib/ui-editor/runtime/hostAdapters/devModeBlueprintHostAdapter";
import { mountBlueprintCompiledScripts } from "@/lib/ui-editor/blueprint-runtime/mountBlueprintScripts";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";

export type DevModeBlueprintRuntimeBundle = {
    hostAdapter: UIHostAdapter;
    surfaceState: SurfaceStateStore;
    debug: DebugBridge;
    bindingDebugCoalescer: BindingDebugCoalescer;
};

/**
 * Per-bundle Dev Mode Blueprint runtime (surface state + dispatch + debug bus).
 */
export function useDevModeBlueprintRuntime(
    bundle: DevModeBundle | null,
    surface: UISurface | null,
): DevModeBlueprintRuntimeBundle | null {
    const [runtime, setRuntime] = useState<{
        store: SurfaceStateStore;
        debug: DebugBridge;
        coalescer: BindingDebugCoalescer;
    } | null>(null);
    const [, bumpRender] = useState(0);

    useEffect(() => {
        if (!bundle) {
            return;
        }
        mountBlueprintCompiledScripts(bundle);
    }, [bundle?.revision, bundle?.bundleId]);

    useEffect(() => {
        if (!bundle || !surface) {
            setRuntime(null);
            return;
        }
        const store = new SurfaceStateStore(surface.id);
        const debug = new DebugBridge();
        const coalescer = new BindingDebugCoalescer();
        const unsub = store.subscribe(() => bumpRender(x => x + 1));
        setRuntime({ store, debug, coalescer });
        return () => {
            unsub();
            setRuntime(null);
        };
    }, [bundle?.revision, bundle?.bundleId, surface?.id]);

    if (!bundle || !surface || !runtime) {
        return null;
    }

    const hostAdapter = createDevModeBlueprintHostAdapter({
        bundle,
        surface,
        surfaceState: runtime.store,
        debug: runtime.debug,
    });

    return {
        hostAdapter,
        surfaceState: runtime.store,
        debug: runtime.debug,
        bindingDebugCoalescer: runtime.coalescer,
    };
}
