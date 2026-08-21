import type { WeatherBakeQuality } from "@shared/weather/model";

/**
 * How Studio spends this machine on the screen effects it bakes.
 *
 * Both keys here are **Performance** settings in the sense the category means: they change nothing
 * about what a project contains or what a player receives, only how long the person at this keyboard
 * waits and how much of their machine is taken while they do. The frame rate a project bakes at is
 * the opposite kind of answer and lives in project data (`app.vfx.frameRate`, Project ▸ App ▸ Screen
 * effects), because it changes the package.
 */

/**
 * How good the screen effects baked for **Dev Mode** have to be.
 *
 * Only Dev Mode. A preview and a build always bake at `final`, and that is not configurable: what
 * they produce is what a player gets, and a setting that could quietly ship a draft to a player is a
 * setting that eventually does.
 *
 * See {@link WeatherBakeQuality} for what the two tiers are and what was measured.
 */
export const SCREEN_EFFECT_QUALITY_KEY = "screenEffects.devModeQuality";

/**
 * Draft, because the wait is the thing an author notices.
 *
 * Measured at 1080p60: a twelve-second clip is roughly three seconds at `draft` against nine at
 * `final`, and there are usually two or three of them. The picture is indistinguishable on the
 * content the seeds produce, so the default costs nothing anyone can see and saves the wait every
 * time a compile touches a weather row.
 */
export const SCREEN_EFFECT_QUALITY_DEFAULT: WeatherBakeQuality = "draft";

/**
 * How many threads draw frames while the encoder runs, or `auto`.
 *
 * Unlike the quality above this applies to **every** bake — Dev Mode, preview and build alike —
 * because it is a statement about the machine rather than about the file. Drawing more frames at
 * once cannot change a frame: each one is a pure function of its phase, which is the property the
 * whole pool rests on.
 *
 * The stops are small on purpose. Past four the curve flattens and then reverses (see
 * `weatherRenderPool.ts` for the measurements), so the choices past the knee would be choices to
 * make it worse, and an author cannot tell which side of the knee their machine is on.
 *
 * `1` is offered even though it is the slowest answer on every machine measured, and offered for a
 * reason the timings cannot show: it is the only setting that leaves the rest of the machine alone.
 * An author on a laptop, on battery, or with something else running wants a bake that takes twice as
 * long over one that takes the machine, and one thread is also the shape a bug report needs when a
 * clip comes out wrong and the pool has to be taken out of the question.
 */
export const SCREEN_EFFECT_THREADS_KEY = "screenEffects.bakeThreads";

export const SCREEN_EFFECT_THREAD_CHOICES = ["auto", "1", "2", "3", "4"] as const;

export type ScreenEffectThreadChoice = typeof SCREEN_EFFECT_THREAD_CHOICES[number];

/**
 * Auto, which is a function of the machine rather than a fixed number.
 *
 * The right count depends on how many cores the encoder is not using, and that is not something an
 * author knows about their own machine. The fixed stops exist for the cases auto cannot see: a
 * laptop on battery, a machine already running something else, a bug report that needs the variable
 * pinned.
 */
export const SCREEN_EFFECT_THREADS_DEFAULT: ScreenEffectThreadChoice = "auto";

/** The stored choice as the pool wants it: a count, or `null` for "work it out from the machine". */
export function screenEffectThreadsOf(stored: unknown): number | null {
    const choice = SCREEN_EFFECT_THREAD_CHOICES.includes(stored as ScreenEffectThreadChoice)
        ? stored as ScreenEffectThreadChoice
        : SCREEN_EFFECT_THREADS_DEFAULT;
    return choice === "auto" ? null : Number.parseInt(choice, 10);
}
