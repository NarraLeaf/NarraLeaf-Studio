import { normalizeProjectPath } from "@shared/utils/recentProject";
import type { ProjectDlc } from "@shared/types/dlc";
import { readProjectDlcFromDir } from "./dlcFile";

/**
 * Which of this project's DLC a run is meant to have installed.
 *
 * The DLC half of `runVariant.ts`, and it follows that module in every structural decision: the
 * choice is a machine-level habit bucketed by project, read here rather than carried on the launch
 * request, and no IPC surface changes. See that file for why the choice does not belong in
 * `.nlproj` - a collaborator's Dev Mode must not quietly lose content they never switched off.
 *
 * # Why the setting stores what is OFF
 *
 * The default has to be "all of them": Dev Mode is the preview an author trusts, and it has always
 * carried every story the project has. Storing the *active* set would break that the moment an
 * author creates a DLC after saving a selection - the new one is absent from the stored list, so it
 * would arrive switched off, and the only sign would be content missing from a run nobody
 * configured. Storing what is off inverts that: a new DLC is on, an unknown id is nothing, and
 * emptying the set is the same state as never having chosen.
 *
 * Comments in English per project convention.
 */
export const RUN_DLC_OFF_SETTINGS_KEY = "ui.runDlcOffByProject";

/** Reader for the global settings store, so this stays testable without an app. */
export type RunDlcSettingsReader = { get(key: string): unknown };

/**
 * The DLC ids a run of `projectPath` should carry, or null for "every one it has".
 *
 * Null is the answer to every kind of absence - no setting, an empty off-set, an unreadable DLC
 * document - because null is what the assembly reads as "carry everything", and a run that cannot
 * resolve the author's choice must show them the whole game rather than a guess.
 *
 * A non-null answer is the project's DLC minus the ones switched off, computed here rather than
 * stored, so a DLC created since the choice was made is included and a deleted one leaves nothing
 * behind.
 */
export async function resolveRunDlc(
    settings: RunDlcSettingsReader,
    projectPath: string,
): Promise<string[] | null> {
    const stored = settings.get(RUN_DLC_OFF_SETTINGS_KEY);
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
        return null;
    }
    const raw = (stored as Record<string, unknown>)[normalizeProjectPath(projectPath)];
    const off = new Set(
        (Array.isArray(raw) ? raw : [])
            .filter((id): id is string => typeof id === "string" && Boolean(id.trim()))
            .map(id => id.trim()),
    );
    if (off.size === 0) {
        return null;
    }
    const dlcs = await readProjectDlcFromDir(projectPath).catch(() => [] as ProjectDlc[]);
    const active = dlcs.filter(dlc => !off.has(dlc.id)).map(dlc => dlc.id);
    // Every one of them switched off is a real answer - "run as a player who bought none" - and it
    // has to survive as an empty list rather than collapsing into "carry everything".
    return active.length === dlcs.length ? null : active;
}
