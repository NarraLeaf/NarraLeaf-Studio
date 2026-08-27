export interface ReopenFacts {
    /**
     * Electron's own answer to "was anything already on screen", as it reaches the `activate`
     * listener. True means AppKit has brought those windows forward by itself.
     */
    hasVisibleWindows: boolean;
    /**
     * How many live windows are on screen in any form - shown, or minimized to the Dock. A window
     * that exists but has never been shown (a launcher held back behind a starting project) is not
     * one of them: to the author it is indistinguishable from no window at all.
     */
    windowsOnScreen: number;
}

/** Nothing to do; raise the window the reopen could not; or open the home screen. */
export type ReopenAction = "none" | "raise" | "launcher";

/**
 * What clicking the Dock icon - or any other reopen of an already-running Studio - should do.
 *
 * The Dock is not a "get me the home screen" button, it is the app itself, and reopening an app
 * that still has windows means "bring back what I had". Answering it with a launcher put the home
 * screen on top of the project the author was working in every time they came back to Studio from
 * another application; the launcher is only the right answer when there is nothing to come back to.
 *
 * The middle case is the one `hasVisibleWindows` cannot be used for on its own: with every window
 * minimized nothing came forward, and Electron does not deminiaturize on our behalf, so a reopen
 * that did nothing here would leave the click with no effect at all.
 */
export function decideReopenAction(facts: ReopenFacts): ReopenAction {
    if (facts.hasVisibleWindows) {
        return "none";
    }
    return facts.windowsOnScreen === 0 ? "launcher" : "raise";
}
