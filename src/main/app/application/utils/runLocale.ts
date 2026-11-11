import { normalizeProjectPath } from "@shared/utils/recentProject";
import type { GameLocalizationBundle } from "@shared/types/localization";

/**
 * Which language a Dev Mode run of this project is shown in.
 *
 * The fourth of the per-project run habits, after `runVariant.ts`, `runDlc.ts` and
 * `previewAsShipped.ts`, and it follows them in every structural decision: a machine-level choice
 * bucketed by project, read here rather than carried on a launch request, never written into
 * `.nlproj`. An author checking the English translation this afternoon has said something about
 * their session, not about the project - stored in the project it would ride version control into a
 * collaborator's checkout and quietly put *their* Dev Mode in English.
 *
 * Dev Mode only. A preview is the game as a player receives it, and a player's language is decided
 * by the player; a build has no run to decide for.
 *
 * Comments in English per project convention.
 */
export const RUN_LOCALE_SETTINGS_KEY = "ui.runLocaleByProject";

/** Reader for the global settings store, so this stays testable without an app. */
export type RunLocaleSettingsReader = { get(key: string): unknown };

/** The language code this machine picked for `projectPath`, or null when it picked none. */
export function readRunLocaleChoice(settings: RunLocaleSettingsReader, projectPath: string): string | null {
    const stored = settings.get(RUN_LOCALE_SETTINGS_KEY);
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
        return null;
    }
    const code = (stored as Record<string, unknown>)[normalizeProjectPath(projectPath)];
    return typeof code === "string" && code.trim() ? code.trim() : null;
}

/**
 * What a run does with that choice, given the languages the project has right now.
 *
 * - `none`: no choice, the game decides as it would for a player.
 * - `pinned`: the run is shown in `code`.
 * - `missing`: the author chose a language the project no longer has. **Refused, not ignored**: the
 *   author asked for this language, and a run that quietly showed another one would look like the
 *   translation they came to check is broken. The workspace clears a choice whose language it sees
 *   removed, so this is the case of a project changed while no workspace was watching.
 */
export type RunLocaleResolution =
    | { kind: "none" }
    | { kind: "pinned"; code: string }
    | { kind: "missing"; code: string };

export function resolveRunLocale(
    choice: string | null,
    localization: Pick<GameLocalizationBundle, "locales"> | undefined,
): RunLocaleResolution {
    if (!choice) {
        return { kind: "none" };
    }
    const known = (localization?.locales ?? []).some(locale => locale.code === choice);
    return known ? { kind: "pinned", code: choice } : { kind: "missing", code: choice };
}
