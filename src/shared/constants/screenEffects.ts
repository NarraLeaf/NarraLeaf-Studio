import type { WeatherBakeQuality } from "@shared/weather/model";

/**
 * How good the screen effects Studio bakes for **Dev Mode** have to be.
 *
 * Only Dev Mode. A preview and a build always bake at `final`, and that is not configurable: what
 * they produce is what a player gets, and a setting that could quietly ship a draft to a player is a
 * setting that eventually does. What this key governs is the copy made while an author is still
 * working, which is thrown away and made again the moment anything about it changes.
 *
 * ## Why it is a Studio setting rather than a project one
 *
 * The frame rate a project bakes at IS project data (`app.vfx.frameRate`, shown in Project ▸ App ▸
 * Screen effects) because it changes what the package contains. This does not: the same project on
 * a fast machine and a slow one ships identical clips either way. It is a statement about the wait
 * the person at this keyboard is willing to sit through, which is exactly what a Studio setting is.
 *
 * See {@link WeatherBakeQuality} for what the two tiers actually are and what was measured.
 */
export const SCREEN_EFFECT_QUALITY_KEY = "devMode.screenEffectQuality";

/**
 * Draft, because the wait is the thing an author notices.
 *
 * Measured at 1080p60: a twelve-second clip is roughly three seconds at `draft` against nine at
 * `final`, and there are usually two or three of them. The picture is indistinguishable on the
 * content the seeds produce, so the default costs nothing anyone can see and saves the wait every
 * time a compile touches a weather row.
 */
export const SCREEN_EFFECT_QUALITY_DEFAULT: WeatherBakeQuality = "draft";
