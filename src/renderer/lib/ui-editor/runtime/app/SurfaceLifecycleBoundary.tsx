import { useEffect, useRef, type MutableRefObject, type ReactNode } from "react";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { UISurface } from "@shared/types/ui-editor/document";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import type { BlueprintRuntimeCore } from "@/lib/ui-editor/runtime/game/useBlueprintRuntimeCore";
import { dispatchSurfaceBlueprintEvent } from "@/lib/ui-editor/blueprint-runtime/BlueprintDispatcher";
import {
    executeLifecycleCommands,
    type LifecycleCommand,
    type SurfaceLifecycleOrchestrator,
} from "./lifecycle/surfaceLifecycleOrchestrator";
import { waitForAnimationFrame } from "./frameTiming";
import type { SurfaceStateAccessors } from "./types";


/** Maps scope-lifecycle commands onto the blueprint execution manager and dispatcher. */
function executeScopeCommands(input: {
    commands: readonly LifecycleCommand[];
    core: BlueprintRuntimeCore;
    blueprintDocument: BlueprintDocument;
    hostAdapter: UIHostAdapter | null;
    makeStateAccessors: (runtimeScopeId: string) => SurfaceStateAccessors | null;
}): void {
    const { commands, core, blueprintDocument, hostAdapter, makeStateAccessors } = input;
    executeLifecycleCommands(commands, {
        openScope: scopeId => core.executionManager.openScope(scopeId),
        closeScope: (scopeId, reason) => core.executionManager.closeScope(scopeId, reason),
        dispatchSurfaceEvent: command => {
            const acc = makeStateAccessors(command.scopeId);
            if (!acc || !hostAdapter?.blueprintRuntime) {
                return;
            }
            void dispatchSurfaceBlueprintEvent({
                blueprintDocument,
                surfaceId: command.surfaceId,
                runtimeScopeId: command.scopeId,
                eventName: command.eventName,
                hostAdapter,
                debug: core.debug,
                getSurfaceState: acc.get,
                setSurfaceState: acc.set,
                executionManager: core.executionManager,
                ...(command.allowClosedScopeExecution ? { allowClosedScopeExecution: true } : {}),
            });
        },
        setTransitionState: () => undefined,
        bumpLifecycleSignal: () => undefined,
        clearInteraction: () => undefined,
    });
}

/**
 * Owns the blueprint surface scope lifecycle for one mounted surface layer:
 * opens the execution scope and dispatches surfaceInit one animation frame
 * after mount (cancelled guard makes StrictMode double-effects safe), and
 * closes the scope + dispatches surfaceUnmount on unmount.
 *
 * The host withholds `core` (passes null) until the surface renderer has
 * registered its blueprint runtime subscriptions, so surfaceInit cannot
 * execute before init-time state writes are observable.
 */
export function SurfaceLifecycleBoundary(props: {
    core: BlueprintRuntimeCore | null;
    blueprintDocument: BlueprintDocument;
    surface: UISurface;
    runtimeScopeId: string;
    hostAdapter: UIHostAdapter;
    lifecycleRef: MutableRefObject<SurfaceLifecycleOrchestrator>;
    makeStateAccessors: (runtimeScopeId: string) => SurfaceStateAccessors | null;
    children: ReactNode;
}) {
    const { core, blueprintDocument, surface, runtimeScopeId, hostAdapter, lifecycleRef, makeStateAccessors, children } = props;
    const latestRuntimeHostAdapterRef = useRef<UIHostAdapter | null>(
        hostAdapter.blueprintRuntime ? hostAdapter : null,
    );
    const hasBlueprintRuntime = Boolean(hostAdapter.blueprintRuntime);

    useEffect(() => {
        if (hostAdapter.blueprintRuntime) {
            latestRuntimeHostAdapterRef.current = hostAdapter;
        }
    }, [hostAdapter]);

    useEffect(() => {
        const currentHostAdapter = latestRuntimeHostAdapterRef.current;
        if (!core || !hasBlueprintRuntime || !currentHostAdapter?.blueprintRuntime) {
            return;
        }
        let cancelled = false;
        void (async () => {
            await waitForAnimationFrame();
            if (cancelled) {
                return;
            }
            executeScopeCommands({
                commands: lifecycleRef.current.surfaceReady(runtimeScopeId, surface.id),
                core,
                blueprintDocument,
                hostAdapter: currentHostAdapter,
                makeStateAccessors,
            });
        })();
        return () => {
            cancelled = true;
        };
    }, [blueprintDocument, core, hasBlueprintRuntime, lifecycleRef, makeStateAccessors, runtimeScopeId, surface.id]);

    useEffect(() => {
        if (!core || !hasBlueprintRuntime) {
            return undefined;
        }
        const surfaceToUnmount = surface.id;
        const scopeToUnmount = runtimeScopeId;
        return () => {
            executeScopeCommands({
                commands: lifecycleRef.current.surfaceUnmounted(scopeToUnmount, surfaceToUnmount),
                core,
                blueprintDocument,
                hostAdapter: latestRuntimeHostAdapterRef.current,
                makeStateAccessors,
            });
        };
    }, [blueprintDocument, core, hasBlueprintRuntime, lifecycleRef, makeStateAccessors, runtimeScopeId, surface.id]);

    return <>{children}</>;
}
