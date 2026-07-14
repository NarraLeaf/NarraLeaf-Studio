import { useSyncExternalStore } from "react";
import type { NavigationController } from "./NavigationController";
import type { NavigationState } from "./navigationMachine";

/** Subscribe a React tree to a NavigationController's state. */
export function useSurfaceNavigation(controller: NavigationController): NavigationState {
    return useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
}
