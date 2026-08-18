import { getAppInfo } from "@/lib/renderApp";
import {
    EXPERIMENTAL_OFF,
    experimentalCondition,
    type ExperimentalConditionDescriptor,
    type ExperimentalState,
} from "@shared/types/experimental";

/**
 * Experimental mode, as this window sees it.
 *
 * Read from the app info every window already fetches at startup, so it is synchronous everywhere
 * and cannot change while the window lives - the mode is decided by the command line and nothing
 * turns it on or off afterwards.
 *
 * Nothing in this area is translated; see `@shared/types/experimental`.
 */
export function experimentalState(): ExperimentalState {
    // Reachable before `renderApp` has the app info only from a surface that renders outside it,
    // which is the crash screen - and the mode is not what that screen is there to say.
    try {
        return getAppInfo().experimental ?? EXPERIMENTAL_OFF;
    } catch {
        return EXPERIMENTAL_OFF;
    }
}

export function isExperimentalMode(): boolean {
    return experimentalState().enabled;
}

/** The active conditions, described. Empty whenever the mode is off. */
export function activeExperimentalConditions(): ExperimentalConditionDescriptor[] {
    return experimentalState().conditions.map(experimentalCondition);
}
