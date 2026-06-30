import { useEffect, useState } from "react";
import type { DevModeBundle } from "@shared/types/devMode";
import { ScopeStoreBridge } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import { DebugBridge } from "@/lib/ui-editor/blueprint-runtime/DebugBridge";
import { BindingDebugCoalescer } from "@/lib/ui-editor/blueprint-runtime/BindingDebugCoalescer";
import { mountBlueprintCompiledScripts } from "@/lib/ui-editor/blueprint-runtime/mountBlueprintScripts";
import { BlueprintExecutionManager } from "@/lib/ui-editor/blueprint-runtime/BlueprintExecutionManager";

export type DevModeBlueprintRuntimeCore = {
    scopeBridge: ScopeStoreBridge;
    debug: DebugBridge;
    bindingDebugCoalescer: BindingDebugCoalescer;
    executionManager: BlueprintExecutionManager;
};

/**
 * Per-bundle Dev Mode Blueprint runtime core (scopes + debug bus). Host adapter is built in DevModeContent
 * so navigation / widget patches can update React state.
 */
export function useDevModeBlueprintRuntime(bundle: DevModeBundle | null): DevModeBlueprintRuntimeCore | null {
    const [session, setSession] = useState<DevModeBlueprintRuntimeCore | null>(null);

    useEffect(() => {
        if (!bundle) {
            setSession(null);
            return;
        }
        mountBlueprintCompiledScripts(bundle);
        const nextSession: DevModeBlueprintRuntimeCore = {
            scopeBridge: new ScopeStoreBridge(),
            debug: new DebugBridge(),
            bindingDebugCoalescer: new BindingDebugCoalescer(),
            executionManager: new BlueprintExecutionManager(),
        };
        setSession(nextSession);
        return () => {
            nextSession.executionManager.cancelAll("Dev Mode runtime disposed");
        };
    }, [bundle?.revision, bundle?.bundleId]);

    return session;
}
