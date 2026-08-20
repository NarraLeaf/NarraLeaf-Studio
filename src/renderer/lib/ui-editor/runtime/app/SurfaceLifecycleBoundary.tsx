import { useEffect, useLayoutEffect, useRef, type MutableRefObject, type ReactNode } from "react";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { PersistentVariableRuntimeTable } from "@shared/types/variables/registry";
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
    persistentVariables: PersistentVariableRuntimeTable;
    hostAdapter: UIHostAdapter | null;
    makeStateAccessors: (runtimeScopeId: string) => SurfaceStateAccessors | null;
}): void {
    const { commands, core, blueprintDocument, persistentVariables, hostAdapter, makeStateAccessors } = input;
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
                persistentVariables,
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
 * `ready` is false until the surface renderer has registered its blueprint runtime
 * subscriptions, so surfaceInit cannot execute before init-time state writes are observable.
 *
 * **The scope itself does not wait for that.** A scope id outlives the generation that closed
 * it, and every dispatch made while it is closed is aborted where nobody can see it - so a
 * surface entered a second time used to lose every `init` its widgets dispatch during the hidden
 * prepaint pass, and any flush that arrived in the same window. The scene jump in a Game UI
 * dialog slot showed it plainly: the dialogue box came back carrying the previous speaker's
 * avatar, and nothing corrected it until the line finished typing and produced a second flush.
 * Opening from a layout effect puts the scope back before any child of this boundary can
 * dispatch into it; `surfaceReady` opens it again, which costs nothing.
 */
export function SurfaceLifecycleBoundary(props: {
    core: BlueprintRuntimeCore | null;
    /** Whether the surface renderer has registered its blueprint runtime subscriptions. */
    ready: boolean;
    blueprintDocument: BlueprintDocument;
    persistentVariables: PersistentVariableRuntimeTable;
    surface: UISurface;
    runtimeScopeId: string;
    hostAdapter: UIHostAdapter;
    lifecycleRef: MutableRefObject<SurfaceLifecycleOrchestrator>;
    makeStateAccessors: (runtimeScopeId: string) => SurfaceStateAccessors | null;
    children: ReactNode;
}) {
    const { core, ready, blueprintDocument, persistentVariables, surface, runtimeScopeId, hostAdapter, lifecycleRef, makeStateAccessors, children } = props;
    const latestRuntimeHostAdapterRef = useRef<UIHostAdapter | null>(
        hostAdapter.blueprintRuntime ? hostAdapter : null,
    );
    const hasBlueprintRuntime = Boolean(hostAdapter.blueprintRuntime);
    // Everything below this line waits for `ready`; the scope does not - see the note above.
    const readyCore = ready ? core : null;

    useLayoutEffect(() => {
        core?.executionManager.openScope(runtimeScopeId);
    }, [core, runtimeScopeId]);

    useEffect(() => {
        if (hostAdapter.blueprintRuntime) {
            latestRuntimeHostAdapterRef.current = hostAdapter;
        }
    }, [hostAdapter]);

    useEffect(() => {
        const currentHostAdapter = latestRuntimeHostAdapterRef.current;
        if (!readyCore || !hasBlueprintRuntime || !currentHostAdapter?.blueprintRuntime) {
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
                core: readyCore,
                blueprintDocument,
                persistentVariables,
                hostAdapter: currentHostAdapter,
                makeStateAccessors,
            });
        })();
        return () => {
            cancelled = true;
        };
    }, [blueprintDocument, readyCore, hasBlueprintRuntime, lifecycleRef, makeStateAccessors, runtimeScopeId, surface.id]);

    useEffect(() => {
        if (!readyCore || !hasBlueprintRuntime) {
            return undefined;
        }
        const surfaceToUnmount = surface.id;
        const scopeToUnmount = runtimeScopeId;
        return () => {
            executeScopeCommands({
                commands: lifecycleRef.current.surfaceUnmounted(scopeToUnmount, surfaceToUnmount),
                core: readyCore,
                blueprintDocument,
                persistentVariables,
                hostAdapter: latestRuntimeHostAdapterRef.current,
                makeStateAccessors,
            });
        };
    }, [blueprintDocument, readyCore, hasBlueprintRuntime, lifecycleRef, makeStateAccessors, runtimeScopeId, surface.id]);

    return <>{children}</>;
}
