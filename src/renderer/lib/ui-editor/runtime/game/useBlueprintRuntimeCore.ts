import { useEffect, useState } from "react";
import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";
import type { DevModeBundle } from "@shared/types/devMode";
import { declaredPersistentDefaults } from "@shared/variables/mergedPersistentView";
import { setBlueprintDebugController } from "@/lib/ui-editor/behavior-graph/debugControl";
import { BindingDebugCoalescer } from "@/lib/ui-editor/blueprint-runtime/BindingDebugCoalescer";
import { BlueprintDebugSession } from "@/lib/ui-editor/blueprint-runtime/BlueprintDebugSession";
import { BlueprintExecutionManager } from "@/lib/ui-editor/blueprint-runtime/BlueprintExecutionManager";
import { DebugBridge } from "@/lib/ui-editor/blueprint-runtime/DebugBridge";
import {
    mountBlueprintCompiledScripts,
    type BlueprintScriptIssue,
} from "@/lib/ui-editor/blueprint-runtime/mountBlueprintScripts";
import {
    ScopeStoreBridge,
    type BlueprintPersistentStoreAdapter,
} from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";

export type BlueprintRuntimeCore = {
    /**
     * The bundle this core was built for. Every new revision gets a new core, published only once
     * the bundle's scripts have mounted, and the previous core is torn down in the commit the
     * revision arrives in - so for a moment the core a host holds belongs to a bundle it no longer
     * has. These say which one it is.
     */
    bundleId: string;
    bundleRevision: number;
    scopeBridge: ScopeStoreBridge;
    debug: DebugBridge;
    bindingDebugCoalescer: BindingDebugCoalescer;
    executionManager: BlueprintExecutionManager;
    /** Present only when the host asked for a debugger; see `debuggerEnabled`. */
    debugSession: BlueprintDebugSession | null;
};

/**
 * Whether a core is the one built for this bundle - not the previous revision's, which a host still
 * holds for a moment after every new revision, torn down: its persistent store detached, so every
 * read answers a declared default and every write is lost.
 */
export function runtimeCoreIsFor(
    core: BlueprintRuntimeCore | null,
    bundle: Pick<DevModeBundle, "bundleId" | "revision">,
): core is BlueprintRuntimeCore {
    return core !== null && core.bundleId === bundle.bundleId && core.bundleRevision === bundle.revision;
}

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
    /**
     * Where a script blueprint that will not run is reported.
     *
     * Passed by the hosts that have somewhere to put it - Dev Mode draws an issues list - and
     * omitted by the ones that do not. Must be stable across renders: it is in this effect's
     * dependency list, so a fresh function every render would remount every script.
     */
    onScriptIssue?: (issue: BlueprintScriptIssue) => void;
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
    const onScriptIssue = options.onScriptIssue;

    useEffect(() => {
        if (!bundle) {
            setSession(null);
            return;
        }
        const debugSession = debuggerEnabled ? new BlueprintDebugSession() : null;
        if (debugSession) {
            setBlueprintDebugController(debugSession);
        }
        const nextSession: BlueprintRuntimeCore = {
            bundleId: bundle.bundleId,
            bundleRevision: bundle.revision,
            // The bundle's declared defaults go in with the scope rather than after it: the first
            // reader - a title screen's Init, a value binding drawing - may run in the same commit.
            scopeBridge: new ScopeStoreBridge({ persistentDefaults: declaredPersistentDefaults(bundle) }),
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

        // The session is published only once the author's scripts are loaded, because publishing it
        // is what lets the surfaces mount and start dispatching. Loading a module is asynchronous,
        // so a session published first would run every `Init` against a registry that is still
        // empty - the handler would simply not be found, with nothing anywhere reporting why. That
        // is what happened the first time this was driven for real.
        let cancelled = false;
        void mountBlueprintCompiledScripts(bundle, onScriptIssue).then(() => {
            if (!cancelled) {
                setSession(nextSession);
            }
        });

        return () => {
            cancelled = true;
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
        onScriptIssue,
        persistenceAdapter,
    ]);

    return session;
}
