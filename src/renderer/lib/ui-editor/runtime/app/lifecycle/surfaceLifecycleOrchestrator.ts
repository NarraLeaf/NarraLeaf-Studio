import { SurfaceLifecycleManager, type SurfaceResetPolicy } from "@/lib/ui-editor/blueprint-runtime/SurfaceLifecycleManager";

/**
 * Pure surface lifecycle orchestrator: receives lifecycle *signals* from the
 * React drivers (SurfaceLifecycleBoundary, AppSurfaceLayer, nested surface
 * mounts) and returns the ordered *commands* the driver must execute. The
 * event-order contract lives in lifecycleContract.ts and is asserted by
 * surfaceLifecycleOrchestrator.test.ts.
 *
 * Owns the mounted-scope bookkeeping (SurfaceLifecycleManager) that decides
 * whether a surfaceReady is a first enter (dispatch surfaceInit) or a
 * re-enter (open the scope only).
 */

export type SurfaceTransitionState = { isEntering: boolean; isExiting: boolean };

export type LifecycleCommand =
    | { kind: "openScope"; scopeId: string }
    | { kind: "closeScope"; scopeId: string; reason: string }
    | {
          kind: "dispatchSurfaceEvent";
          eventName: "surfaceInit" | "surfaceUnmount" | "beforeSurfaceExit" | "afterSurfaceEnter";
          scopeId: string;
          surfaceId: string;
          allowClosedScopeExecution?: boolean;
      }
    | { kind: "setTransitionState"; scopeId: string; state: SurfaceTransitionState }
    | { kind: "bumpLifecycleSignal"; scopeId: string; signal: "beforeSurfaceExit" | "afterSurfaceEnter" }
    | { kind: "clearInteraction"; scopeId: string };

export type LifecycleCommandExecutor = {
    openScope(scopeId: string): void;
    closeScope(scopeId: string, reason: string): void;
    dispatchSurfaceEvent(command: Extract<LifecycleCommand, { kind: "dispatchSurfaceEvent" }>): void;
    setTransitionState(state: SurfaceTransitionState): void;
    bumpLifecycleSignal(signal: "beforeSurfaceExit" | "afterSurfaceEnter"): void;
    clearInteraction(scopeId: string): void;
};

export function executeLifecycleCommands(
    commands: readonly LifecycleCommand[],
    executor: LifecycleCommandExecutor,
): void {
    for (const command of commands) {
        switch (command.kind) {
            case "openScope":
                executor.openScope(command.scopeId);
                break;
            case "closeScope":
                executor.closeScope(command.scopeId, command.reason);
                break;
            case "dispatchSurfaceEvent":
                executor.dispatchSurfaceEvent(command);
                break;
            case "setTransitionState":
                executor.setTransitionState(command.state);
                break;
            case "bumpLifecycleSignal":
                executor.bumpLifecycleSignal(command.signal);
                break;
            case "clearInteraction":
                executor.clearInteraction(command.scopeId);
                break;
        }
    }
}

export class SurfaceLifecycleOrchestrator {
    private readonly manager: SurfaceLifecycleManager;
    private readonly unmountReason: string;
    /** Scopes whose enter animation has completed (afterSurfaceEnter fired) this generation. */
    private readonly enteredScopes = new Set<string>();

    constructor(options?: { resetPolicy?: SurfaceResetPolicy; unmountReason?: string }) {
        this.manager = new SurfaceLifecycleManager(options?.resetPolicy);
        this.unmountReason = options?.unmountReason ?? "Surface unmounted";
    }

    /**
     * The surface layer finished its hidden prepaint frame and blueprint
     * subscriptions are registered. Opens the scope; dispatches surfaceInit
     * only on the first enter of this runtime scope.
     */
    public surfaceReady(scopeId: string, surfaceId: string): LifecycleCommand[] {
        const commands: LifecycleCommand[] = [{ kind: "openScope", scopeId }];
        if (this.manager.onSurfaceEnter(scopeId)) {
            commands.push({
                kind: "dispatchSurfaceEvent",
                eventName: "surfaceInit",
                scopeId,
                surfaceId,
            });
        }
        return commands;
    }

    /** The surface layer unmounted from the tree. */
    public surfaceUnmounted(scopeId: string, surfaceId: string): LifecycleCommand[] {
        this.manager.onSurfaceExit(scopeId);
        this.enteredScopes.delete(scopeId);
        return [
            { kind: "closeScope", scopeId, reason: this.unmountReason },
            {
                kind: "dispatchSurfaceEvent",
                eventName: "surfaceUnmount",
                scopeId,
                surfaceId,
                allowClosedScopeExecution: true,
            },
        ];
    }

    /** The exit animation is about to start for this layer. */
    public beforeExit(scopeId: string, surfaceId: string): LifecycleCommand[] {
        this.enteredScopes.delete(scopeId);
        return [
            { kind: "setTransitionState", scopeId, state: { isEntering: false, isExiting: true } },
            { kind: "clearInteraction", scopeId },
            { kind: "dispatchSurfaceEvent", eventName: "beforeSurfaceExit", scopeId, surfaceId },
            { kind: "bumpLifecycleSignal", scopeId, signal: "beforeSurfaceExit" },
        ];
    }

    /**
     * The enter animation completed. Idempotent per enter generation: the
     * redundant enter-complete paths in SurfaceAnimationLayer (animation
     * callback, zero-duration effect, timeout fallback) yield exactly one
     * afterSurfaceEnter.
     */
    public enterComplete(scopeId: string, surfaceId: string): LifecycleCommand[] {
        if (this.enteredScopes.has(scopeId)) {
            return [];
        }
        this.enteredScopes.add(scopeId);
        return [
            { kind: "setTransitionState", scopeId, state: { isEntering: false, isExiting: false } },
            { kind: "dispatchSurfaceEvent", eventName: "afterSurfaceEnter", scopeId, surfaceId },
            { kind: "bumpLifecycleSignal", scopeId, signal: "afterSurfaceEnter" },
        ];
    }

    /** Bundle reload / session change: forget all mounted-scope tracking. */
    public sessionReset(): void {
        this.manager.reset();
        this.enteredScopes.clear();
    }
}
