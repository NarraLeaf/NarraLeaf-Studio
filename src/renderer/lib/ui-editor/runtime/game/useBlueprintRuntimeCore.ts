import { useEffect, useState } from "react";
import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";
import type { DevModeBundle } from "@shared/types/devMode";
import { setBlueprintDebugController } from "@/lib/ui-editor/behavior-graph/debugControl";
import { BindingDebugCoalescer } from "@/lib/ui-editor/blueprint-runtime/BindingDebugCoalescer";
import { BlueprintDebugSession } from "@/lib/ui-editor/blueprint-runtime/BlueprintDebugSession";
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
    /** Present only when the host asked for a debugger; see `debuggerEnabled`. */
    debugSession: BlueprintDebugSession | null;
};

export type BlueprintRuntimeCoreOptions = {
    persistenceAdapter?: BlueprintPersistentStoreAdapter | null;
    onDebugEvent?: (event: BlueprintDebugEvent) => void;
    disposeMessage?: string;
    /**
     * Install the breakpoint debugger for this session.
     *
     * Off by default and passed only by Dev Mode. A shipped game must never be able to stop at a
     * node: the controller is a module-level singleton the executor consults on every node, so
     * "not installed" is what keeps that cost - and that capability - out of the packaged runtime
     * entirely rather than behind a flag the game could flip.
     */
    debuggerEnabled?: boolean;
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
    const debuggerEnabled = options.debuggerEnabled ?? false;

    useEffect(() => {
        if (!bundle) {
            setSession(null);
            return;
        }
        mountBlueprintCompiledScripts(bundle);
        const debugSession = debuggerEnabled ? new BlueprintDebugSession() : null;
        if (debugSession) {
            setBlueprintDebugController(debugSession);
        }
        const nextSession: BlueprintRuntimeCore = {
            scopeBridge: new ScopeStoreBridge(),
            debug: new DebugBridge(),
            bindingDebugCoalescer: new BindingDebugCoalescer(),
            executionManager: new BlueprintExecutionManager(),
            debugSession,
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
            // Uninstall before cancelling: a suspended execution must not be able to re-enter a
            // session that is going away, and disposing releases every gate it is holding.
            if (debugSession) {
                setBlueprintDebugController(null);
                debugSession.dispose();
            }
            nextSession.executionManager.cancelAll(disposeMessage);
            nextSession.scopeBridge.setPersistenceAdapter(null);
        };
    }, [
        bundle?.revision,
        bundle?.bundleId,
        debuggerEnabled,
        disposeMessage,
        onDebugEvent,
        persistenceAdapter,
    ]);

    return session;
}
