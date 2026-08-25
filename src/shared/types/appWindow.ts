/**
 * What the shipped game's window does, chosen per project (`.nlproj` `app.window`).
 *
 * The design size of the entry surface is what the game is drawn at, and until this existed it was
 * also what the window was opened at - as an *outer* size, borders and title bar included, so a
 * 1920x1080 project never actually got a 1920x1080 stage on a 1080p screen. These settings are the
 * other half of that answer: what sizes the player may pick, whether they may drag the window to
 * one of their own, and whether the game comes back where they left it.
 *
 * What is NOT here is a list of sizes. It was, and it was the wrong shape: a project cannot know
 * what will fit the screen a player turns out to have, and a list declared here became a limit on
 * what a running game could ask for. The sizes a configuration screen offers are answered by the
 * shell instead, against the display in front of the player (see the `Get Window Scale Options`
 * node), and a game may ask for any size at all.
 */

/**
 * The sizes a configuration screen may offer, as multiples of the design size.
 *
 * A ladder rather than a free number, because the whole value of a step is that the stage lands on
 * a whole multiple of the art it was drawn at. Which rungs a given player is offered is decided by
 * their screen, not by the project: see `windowGeometry.fittingWindowScales`.
 *
 * Nothing stops a game asking for a size that is not on it - `Set Window Scale` and
 * `Set Window Size` take what they are given. This is what a screen built with
 * `Get Window Scale Options` lists, not a rule.
 */
export const WINDOW_SCALE_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export type WindowScaleStep = typeof WINDOW_SCALE_STEPS[number];

/** The step every project offers, and the one a window falls back to. */
export const WINDOW_SCALE_DESIGN: WindowScaleStep = 1;

export type WindowConfiguration = {
    /**
     * Whether the player may drag the window to a size of their own.
     *
     * Independent of anything a configuration screen offers: this is what the window frame allows.
     * A window dragged off the design ratio letterboxes the stage inside it, the same way a screen
     * of another shape does.
     */
    resizable: boolean;
    /** Whether the game reopens at the size, position and screen mode it was last closed at. */
    rememberGeometry: boolean;
    /**
     * Whether the game starts full-screen.
     *
     * Here rather than in a graph because it decides the first window rather than something done to
     * it: `App Boot` runs after a window is already on screen, so a game made full-screen there is
     * one the player watches change size.
     */
    startFullscreen: boolean;
};

export const DEFAULT_WINDOW_CONFIGURATION: WindowConfiguration = {
    resizable: true,
    rememberGeometry: true,
    startFullscreen: false,
};

/**
 * Read a project's `app.window` blob into a complete configuration.
 *
 * Anything unrecognized falls back rather than throwing: this runs while compiling a pack, and a
 * hand-edited project should open a window, not fail to build.
 */
export function normalizeWindowConfiguration(value: unknown): WindowConfiguration {
    const record = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    return {
        resizable: record.resizable === undefined
            ? DEFAULT_WINDOW_CONFIGURATION.resizable
            : record.resizable !== false,
        rememberGeometry: record.rememberGeometry === undefined
            ? DEFAULT_WINDOW_CONFIGURATION.rememberGeometry
            : record.rememberGeometry !== false,
        startFullscreen: record.startFullscreen === true,
    };
}

/** The step nearest a value, for reading back what size a window is currently at. */
export function nearestWindowScaleStep(scale: number, steps: readonly WindowScaleStep[]): WindowScaleStep {
    const offered = steps.length > 0 ? steps : [WINDOW_SCALE_DESIGN];
    return offered.reduce((best, step) => (
        Math.abs(step - scale) < Math.abs(best - scale) ? step : best
    ), offered[0]!);
}
