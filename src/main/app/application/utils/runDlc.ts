import { normalizeProjectPath } from "@shared/utils/recentProject";
import type { ProjectDlc } from "@shared/types/dlc";
import { readProjectDlcFromDir } from "./dlcFile";

/**
 * Which of this project's DLC a run is meant to have installed.
 *
 * The DLC half of `runVariant.ts`, and it follows that module in every structural decision: the
 * choice is a machine-level habit bucketed by project, read here rather than carried on the launch
 * request, and no IPC surface changes. See that file for why the choice does not belong in
 * `.nlproj` - a collaborator's Dev Mode must not quietly become a run they never configured.
 *
 * # None of them, until the author says otherwise
 *
 * The setting stores what is ON, and the default is therefore an empty run: the base game, with no
 * DLC beside it. That is what a player has when they buy the game, so it is the state an author is
 * shipping and the one they most need to be looking at - and it is the only one in which a forgotten
 * `Is DLC Installed` guard is visible, because the entrance is there and the story behind it is not.
 *
 * The cost is the mirror of the other direction's: a DLC created after the choice arrives switched
 * off. Which is the default anyway, so nothing is withheld that the author was not already running
 * without.
 *
 * Comments in English per project convention.
 */
export const RUN_DLC_ON_SETTINGS_KEY = "ui.runDlcOnByProject";

/** Reader for the global settings store, so this stays testable without an app. */
export type RunDlcSettingsReader = { get(key: string): unknown };

/**
 * The DLC ids a run of `projectPath` should carry.
 *
 * Always a list, never null: a run always has an answer, and stating it - even empty - is what keeps
 * the assembly from falling back to "every DLC the project has", which no run of a game a player
 * would recognise ever is.
 *
 * Every kind of absence answers the empty list: no setting, an unreadable DLC document, a stored id
 * that names nothing any more. Absence and "none picked" are one state here, unlike the variant next
 * door, because the default IS none.
 *
 * Intersected with what the project actually has rather than returned as stored, so a deleted DLC
 * leaves nothing behind for the assembly to look for.
 */
export async function resolveRunDlc(
    settings: RunDlcSettingsReader,
    projectPath: string,
): Promise<string[]> {
    const stored = settings.get(RUN_DLC_ON_SETTINGS_KEY);
    const record = stored && typeof stored === "object" && !Array.isArray(stored)
        ? stored as Record<string, unknown>
        : {};
    const raw = record[normalizeProjectPath(projectPath)];
    const on = new Set(
        (Array.isArray(raw) ? raw : [])
            .filter((id): id is string => typeof id === "string" && Boolean(id.trim()))
            .map(id => id.trim()),
    );
    if (on.size === 0) {
        return [];
    }
    const dlcs = await readProjectDlcFromDir(projectPath).catch(() => [] as ProjectDlc[]);
    return dlcs.filter(dlc => on.has(dlc.id)).map(dlc => dlc.id);
}
