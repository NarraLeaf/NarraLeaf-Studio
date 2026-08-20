import { WindowAppType } from "@shared/types/window";

export interface WindowClosedFacts {
    /** What kind of window just closed. */
    windowType: WindowAppType;
    /** The project it named, if it named one. Only some window types carry a project. */
    projectPath: string | null;
    /** Whether the app is on its way out. */
    quitting: boolean;
    /** Whether any live window still holds this project - see `App.hasLiveWindowForProject`. */
    projectStillOpen: boolean;
}

export interface WindowClosedTeardown {
    /** End the project's Dev Mode, preview and test runtimes. */
    stopRuntimes: boolean;
    /** Release the project's version-control store handle. */
    releaseVersionControl: boolean;
}

/**
 * What a closed window means for the project it was working on.
 *
 * Extracted from the listener that acts on it because the three rules below are each a real
 * decision, none of them is obvious from the call site, and every one of them was wrong at some
 * point:
 *
 *   - **Runtimes end with the WORKSPACE, not with any window naming the project.** The Dev Mode
 *     window carries the same `projectPath`, and it closing is that runtime ending rather than the
 *     project's - treating it the same way would take the preview down with the Dev Mode window.
 *   - **Version control is released only once the project has no window left.** Closing a Dev Mode
 *     window is not the author leaving the project; its workspace is still open and still editing,
 *     and dropping the store there costs the next call a reopen. This one used to fire for any
 *     window that named a project.
 *   - **Neither happens during a quit.** The quit has its own teardown, which is bounded, awaited,
 *     and runs once for everything; doing the same work per window as the windows close would
 *     duplicate it in the good case and, for version control, start calls that nothing waits for
 *     moments before the environment they report into is destroyed.
 *
 * A window with no project (the launcher, Settings, a prompt) means neither.
 */
export function decideWindowClosedTeardown(facts: WindowClosedFacts): WindowClosedTeardown {
    const namesProject = typeof facts.projectPath === "string" && facts.projectPath.length > 0;
    if (!namesProject || facts.quitting) {
        return { stopRuntimes: false, releaseVersionControl: false };
    }

    return {
        stopRuntimes: facts.windowType === WindowAppType.Workspace,
        releaseVersionControl: !facts.projectStillOpen,
    };
}
