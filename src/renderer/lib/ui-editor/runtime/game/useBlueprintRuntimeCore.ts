import { useEffect, useState } from "react";
import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";
import type { DevModeBundle } from "@shared/types/devMode";
import { BindingDebugCoalescer } from "@/lib/ui-editor/blueprint-runtime/BindingDebugCoalescer";
import { BlueprintExecutionManager } from "@/lib/ui-editor/blueprint-runtime/BlueprintExecutionManager";
import { DebugBridge } from "@/lib/ui-editor/blueprint-runtime/DebugBridge";
import { mountBlueprintCompiledScripts } from "@/lib/ui-editor/blueprint-runtime/mountBlueprintScripts";
import {
    ScopeStoreBridge,
    type BlueprintPersistentStoreAdapter,
} from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";

export type BlueprintRuntimeCore = {
    scopeBridge: ScopeStoreBridge;
    debug: DebugBridge;
    bindingDebugCoalescer: BindingDebugCoalescer;
    executionManager: BlueprintExecutionManager;
};

export type BlueprintRuntimeCoreOptions = {
    persistenceAdapter?: BlueprintPersistentStoreAdapter | null;
    onDebugEvent?: (event: BlueprintDebugEvent) => void;
    disposeMessage?: string;
};

/**
 * Shared renderer runtime core used by Dev Mode and packaged/preview runtime.
 * Host adapters stay outside this hook so each host can provide its own IO glue.
 */
export function useBlueprintRuntimeCore(
    bundle: DevModeBundle | null,
    options: BlueprintRuntimeCoreOptions = {},
): BlueprintRuntimeCore | null {
    const [session, setSession] = useState<BlueprintRuntimeCore | null>(null);
    const persistenceAdapter = options.persistenceAdapter ?? null;
    const onDebugEvent = options.onDebugEvent;
    const disposeMessage = options.disposeMessage ?? "Blueprint runtime disposed";

    useEffect(() => {
        if (!bundle) {
            setSession(null);
            return;
        }
        mountBlueprintCompiledScripts(bundle);
        const nextSession: BlueprintRuntimeCore = {
            scopeBridge: new ScopeStoreBridge(),
            debug: new DebugBridge(),
            bindingDebugCoalescer: new BindingDebugCoalescer(),
            executionManager: new BlueprintExecutionManager(),
        };
        if (persistenceAdapter) {
            nextSession.scopeBridge.setPersistenceAdapter(persistenceAdapter);
        }
        const unsubscribeDebug = onDebugEvent
            ? nextSession.debug.subscribeEvents(onDebugEvent)
            : () => undefined;
        setSession(nextSession);
        return () => {
            unsubscribeDebug();
            nextSession.executionManager.cancelAll(disposeMessage);
            nextSession.scopeBridge.setPersistenceAdapter(null);
        };
    }, [
        bundle?.revision,
        bundle?.bundleId,
        disposeMessage,
        onDebugEvent,
        persistenceAdapter,
    ]);

    return session;
}
