import { useEffect, useRef, type MutableRefObject, type ReactNode } from "react";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { UISurface } from "@shared/types/ui-editor/document";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import type { BlueprintRuntimeCore } from "@/lib/ui-editor/runtime/game/useBlueprintRuntimeCore";
import { dispatchSurfaceBlueprintEvent } from "@/lib/ui-editor/blueprint-runtime/BlueprintDispatcher";
import type { SurfaceLifecycleManager } from "@/lib/ui-editor/blueprint-runtime/SurfaceLifecycleManager";
import { waitForAnimationFrame } from "./frameTiming";
import type { SurfaceStateAccessors } from "./types";

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
    lifecycleRef: MutableRefObject<SurfaceLifecycleManager>;
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
            core.executionManager.openScope(runtimeScopeId);
            if (!lifecycleRef.current.onSurfaceEnter(runtimeScopeId)) {
                return;
            }
            const acc = makeStateAccessors(runtimeScopeId);
            if (!acc) {
                return;
            }
            void dispatchSurfaceBlueprintEvent({
                blueprintDocument,
                surfaceId: surface.id,
                runtimeScopeId,
                eventName: "surfaceInit",
                hostAdapter: currentHostAdapter,
                debug: core.debug,
                getSurfaceState: acc.get,
                setSurfaceState: acc.set,
                executionManager: core.executionManager,
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
            const currentHostAdapter = latestRuntimeHostAdapterRef.current;
            lifecycleRef.current.onSurfaceExit(scopeToUnmount);
            core.executionManager.closeScope(scopeToUnmount, "Surface unmounted");
            const acc = makeStateAccessors(scopeToUnmount);
            if (!acc || !currentHostAdapter?.blueprintRuntime) {
                return;
            }
            void dispatchSurfaceBlueprintEvent({
                blueprintDocument,
                surfaceId: surfaceToUnmount,
                runtimeScopeId: scopeToUnmount,
                eventName: "surfaceUnmount",
                hostAdapter: currentHostAdapter,
                debug: core.debug,
                getSurfaceState: acc.get,
                setSurfaceState: acc.set,
                executionManager: core.executionManager,
                allowClosedScopeExecution: true,
            });
        };
    }, [blueprintDocument, core, hasBlueprintRuntime, lifecycleRef, makeStateAccessors, runtimeScopeId, surface.id]);

    return <>{children}</>;
}
