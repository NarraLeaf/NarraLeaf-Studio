/**
 * What the shipped game's window does, chosen per project (`.nlproj` `app.window`).
 *
 * The design size of the entry surface is what the game is drawn at, and until this existed it was
 * also what the window was opened at - as an *outer* size, borders and title bar included, so a
 * 1920x1080 project never actually got a 1920x1080 stage on a 1080p screen. These settings are the
 * other half of that answer: what sizes the player may pick, whether they may drag the window to
 * one of their own, and whether the game comes back where they left it.
 *
 * Read by two very different places from one field: the shell decides the window it opens, and the
 * game's own configuration screen offers {@link WindowConfiguration.scaleSteps} as the list a
 * player chooses from (see the `Get Window Scale Options` node). One source, so the screen can
 * never offer a size the shell refuses.
 */

/**
 * The sizes an author may offer, as multiples of the design size.
 *
 * A ladder rather than a free number: the whole value of a step is that the stage lands on a whole
 * multiple of the art it was drawn at, and an author typing 0.63 would get a blurred stage and no
 * warning. Steps above 1 upscale, which is the right answer on a screen larger than the project -
 * a 1080p game on a 1440p display - and the wrong one on a small laptop, which is why each is the
 * author's to offer rather than a rule.
 */
export const WINDOW_SCALE_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export type WindowScaleStep = typeof WINDOW_SCALE_STEPS[number];

/** The step every project offers, and the one a window falls back to. */
export const WINDOW_SCALE_DESIGN: WindowScaleStep = 1;

export type WindowConfiguration = {
    /**
     * Sizes the player may choose, as multiples of the design size, ascending.
     *
     * Always contains {@link WINDOW_SCALE_DESIGN}: the game is drawn at that size, and a project
     * that offered no way back to it would be one where the art can never be seen as it was made.
     */
    scaleSteps: WindowScaleStep[];
    /**
     * Whether the player may drag the window to a size of their own.
     *
     * Independent of the steps: the steps are what a configuration screen offers, this is what the
     * window frame allows. A window dragged off the design ratio letterboxes the stage inside it,
     * the same way a screen of another shape does.
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
    // Nothing above the design size: those upscale, and whether that is right depends on a screen
    // this file cannot see. The two below it are what makes a 1080p project openable on a laptop.
    scaleSteps: [0.5, 0.75, 1],
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
        scaleSteps: normalizeWindowScaleSteps(record.scaleSteps),
        resizable: record.resizable === undefined
            ? DEFAULT_WINDOW_CONFIGURATION.resizable
            : record.resizable !== false,
        rememberGeometry: record.rememberGeometry === undefined
            ? DEFAULT_WINDOW_CONFIGURATION.rememberGeometry
            : record.rememberGeometry !== false,
        startFullscreen: record.startFullscreen === true,
    };
}

/** The offered steps, deduplicated, ascending, and always including the design size. */
export function normalizeWindowScaleSteps(value: unknown): WindowScaleStep[] {
    const offered = Array.isArray(value) ? value : DEFAULT_WINDOW_CONFIGURATION.scaleSteps;
    const kept = new Set<WindowScaleStep>([WINDOW_SCALE_DESIGN]);
    for (const candidate of offered) {
        const step = WINDOW_SCALE_STEPS.find(known => known === candidate);
        if (step !== undefined) {
            kept.add(step);
        }
    }
    return WINDOW_SCALE_STEPS.filter(step => kept.has(step));
}

/** The offered step nearest a value, for a request that names a size this project does not offer. */
export function nearestWindowScaleStep(scale: number, steps: readonly WindowScaleStep[]): WindowScaleStep {
    const offered = steps.length > 0 ? steps : [WINDOW_SCALE_DESIGN];
    return offered.reduce((best, step) => (
        Math.abs(step - scale) < Math.abs(best - scale) ? step : best
    ), offered[0]!);
}
