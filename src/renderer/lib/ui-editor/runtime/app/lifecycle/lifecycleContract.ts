/**
 * Surface lifecycle event-order contract, encoded as data so tests can
 * assert against it instead of it only living in documentation.
 *
 * Full observed order for one surface layer generation:
 *
 *   mount (hidden prepaint pass)
 *     -> widget:init                      (BlueprintWidgetInitLifecycle, hidden pass)
 *     -> frame + blueprint subscriptions ready
 *     -> scope:open -> blueprint:surfaceInit          (first enter per scope only)
 *     -> prepaint:ready -> reveal + enter animation
 *     -> anim:enterComplete
 *         -> transitionState{ isEntering:false, isExiting:false }
 *         -> blueprint:afterSurfaceEnter -> signal:afterSurfaceEnter
 *     ...
 *     -> anim:beforeExit
 *         -> transitionState{ isEntering:false, isExiting:true }
 *         -> interaction:clear
 *         -> blueprint:beforeSurfaceExit -> signal:beforeSurfaceExit
 *     -> exit animation -> unmount
 *     -> scope:close -> blueprint:surfaceUnmount (allowClosedScopeExecution)
 *     -> widget:unmount
 *
 * The frame-wait + cancelled guard before scope:open and the
 * subscriptions-ready gate are React/DOM driver concerns (see
 * SurfaceLifecycleBoundary); the orchestrator only sees "surfaceReady".
 */

import type { LifecycleCommand } from "./surfaceLifecycleOrchestrator";

export type LifecycleCommandKindToken =
    | "openScope"
    | "closeScope"
    | "dispatch:surfaceInit"
    | "dispatch:surfaceUnmount"
    | "dispatch:beforeSurfaceExit"
    | "dispatch:afterSurfaceEnter"
    | "setTransitionState:entering"
    | "setTransitionState:exiting"
    | "setTransitionState:idle"
    | "bumpSignal:beforeSurfaceExit"
    | "bumpSignal:afterSurfaceEnter"
    | "clearInteraction";

export function tokenizeLifecycleCommand(command: LifecycleCommand): LifecycleCommandKindToken {
    switch (command.kind) {
        case "openScope":
            return "openScope";
        case "closeScope":
            return "closeScope";
        case "dispatchSurfaceEvent":
            return `dispatch:${command.eventName}` as LifecycleCommandKindToken;
        case "setTransitionState":
            if (command.state.isExiting) {
                return "setTransitionState:exiting";
            }
            return command.state.isEntering ? "setTransitionState:entering" : "setTransitionState:idle";
        case "bumpLifecycleSignal":
            return `bumpSignal:${command.signal}` as LifecycleCommandKindToken;
        case "clearInteraction":
            return "clearInteraction";
    }
}

/** Canonical command sequences per orchestrator signal. */
export const LIFECYCLE_CONTRACT = {
    surfaceReadyFirstEnter: ["openScope", "dispatch:surfaceInit"],
    surfaceReadyReEnter: ["openScope"],
    surfaceUnmounted: ["closeScope", "dispatch:surfaceUnmount"],
    beforeExit: [
        "setTransitionState:exiting",
        "clearInteraction",
        "dispatch:beforeSurfaceExit",
        "bumpSignal:beforeSurfaceExit",
    ],
    enterComplete: [
        "setTransitionState:idle",
        "dispatch:afterSurfaceEnter",
        "bumpSignal:afterSurfaceEnter",
    ],
} as const satisfies Record<string, readonly LifecycleCommandKindToken[]>;
