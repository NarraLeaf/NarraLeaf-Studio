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
 * Final, because a draft is never the last word and so is never the only bake.
 *
 * This was `draft`, on a measurement that counted the right numbers and the wrong total. A draft
 * IS about three times cheaper — at the shipped sakura, 24 seconds at 1080p30, the frames take 3.2s
 * to draw across four threads and the encoder 2.4s at `draft` against 8.7s at `final`, so a bake
 * is 3.2s or 8.7s depending on the tier. What that arithmetic left out is that the compile path —
 * preview, test run and build alike — only ever accepts `final`. So the draft is not a cheaper
 * answer to the question, it is a cheaper answer to a DIFFERENT question, discarded the first time
 * the author runs anything:
 *
 *  - at `draft`: 3.2s now, then 8.7s the first time they press Run. **11.9s and two files.**
 *  - at `final`: 8.7s now, and nothing ever again. **8.7s and one file.**
 *
 * The 5.5s the tier saves is real and it is paid back with interest by everyone who runs their game,
 * which is everyone. It matters more now than it did: clips were twelve seconds when this was
 * decided and are twenty-four to ninety now, because the length is derived from how slowly the
 * weather falls.
 *
 * The setting stays. An author hammering sliders with Dev Mode open genuinely wants the 3.2s, and
 * the picture is indistinguishable either way — 94% of the tint survives `draft` against 95% at
 * `final`. What changed is which of the two is the answer for somebody who has not thought about
 * it, and the second bake is now named where the setting is chosen rather than left to be noticed.
 */
export const SCREEN_EFFECT_QUALITY_DEFAULT: WeatherBakeQuality = "final";

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
