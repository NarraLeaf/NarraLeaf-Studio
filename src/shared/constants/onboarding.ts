/**
 * First-run setup: which revision of it this installation has been through.
 *
 * Read by the main process before the launcher window exists (so the window opens in the right
 * mode with nothing to correct afterwards) and written by the renderer when the flow ends.
 */

/**
 * Global-state key the completed revision is stored under.
 *
 * Deliberately absent from `GLOBAL_STATE_DEFAULTS`: absent is the meaningful state, and a default
 * would make every profile that predates this feature look as though it had already been asked.
 *
 * Also deliberately not a preference. It describes this installation rather than the author's
 * taste, so it has no row in the settings registry - and the reset, export and import scopes are
 * all computed from that registry (`lib/settings/settingsScope.ts`), which puts a key with no row
 * outside all three without having to be named in any list.
 */
export const ONBOARDING_STATE_KEY = "app.onboardingVersion" as const;

/**
 * The revision of setup the current build asks for.
 *
 * A number rather than a boolean because a boolean cannot say "went through an older setup".
 * Raising it replays the whole flow, on the next launch, for everyone who has already finished it,
 * so it is a deliberate product decision - adding a screen is not on its own a reason to.
 */
export const ONBOARDING_VERSION = 1;

/** Whether an installation carrying this stored value still has setup to go through. */
export function needsOnboarding(stored: unknown): boolean {
  return typeof stored !== "number" || !Number.isFinite(stored) || stored < ONBOARDING_VERSION;
}
