import type { TeamProjectMap } from "@/lib/app/teamProjects";
import type { MissingRecentProject } from "@shared/types/state/appStateTypes";
import { normalizeProjectPath } from "@shared/utils/recentProject";

/** Why a row of the switcher cannot be opened from here. */
export type SwitcherUnavailable =
    | { kind: "folder-missing" }
    | { kind: "not-a-project" }
    | { kind: "signed-out"; server: string };

/**
 * Which remembered projects the switcher shows as not openable, keyed by project identity.
 *
 * The same two cases the launcher stops at its gate: a folder that is gone (or no longer a project),
 * and a team project whose server this machine holds no sign-in for. Main refuses both from a
 * workspace anyway; marking the rows says so before the click rather than after it.
 */
export function switcherUnavailability(
    missing: readonly MissingRecentProject[],
    team: TeamProjectMap,
): ReadonlyMap<string, SwitcherUnavailable> {
    const map = new Map<string, SwitcherUnavailable>();
    for (const [identity, facts] of team) {
        if (!facts.connected) map.set(identity, { kind: "signed-out", server: facts.server });
    }
    // A missing folder wins: its repository was read from a config that is no longer there either.
    for (const project of missing) {
        map.set(normalizeProjectPath(project.path), { kind: project.reason });
    }
    return map;
}
