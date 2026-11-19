/**
 * Where the launcher lists the projects on a Team server (`team.projectsPlacement`).
 *
 * Shared by the settings registry and the two launcher tabs it moves the list between, so the key,
 * its values and its default cannot drift apart.
 *
 *  - `"projects"` - in the Projects tab, under the projects on this disk: a team project already
 *    cloned is an ordinary row there, and one that is not yet cloned is listed below them and asks
 *    to be cloned when picked. The Team tab then keeps what is about people rather than projects:
 *    the roster, this account's own to-dos, and the projects somebody is working on now.
 *  - `"team"` - in the Team tab, as its own list, the way it was before the home list took them.
 */
export type TeamProjectsPlacement = "projects" | "team";

export const TEAM_PROJECTS_PLACEMENT_KEY = "team.projectsPlacement" as const;

/** The two values, in the order the settings page offers them. */
export const TEAM_PROJECTS_PLACEMENT_OPTIONS: readonly TeamProjectsPlacement[] = ["projects", "team"];

/** One list of projects to look through rather than two. */
export const TEAM_PROJECTS_PLACEMENT_DEFAULT: TeamProjectsPlacement = "projects";

/** Narrow an unknown stored value to a placement, falling back to the default. */
export function resolveTeamProjectsPlacement(stored: unknown): TeamProjectsPlacement {
    return TEAM_PROJECTS_PLACEMENT_OPTIONS.includes(stored as TeamProjectsPlacement)
        ? stored as TeamProjectsPlacement
        : TEAM_PROJECTS_PLACEMENT_DEFAULT;
}
