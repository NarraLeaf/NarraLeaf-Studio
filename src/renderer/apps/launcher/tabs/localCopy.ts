import { parseVcsRemoteUrl } from "@shared/types/vcs";
import type { VcsLocalRepository, VcsServerProject } from "@shared/types/vcs";

/**
 * Which project on a server this machine already has, if it has it.
 *
 * Its own module rather than a member of the Servers tab. A passcode field above the project
 * list used to ask it too; that field is gone, and the module stays so the question can be
 * tested without drawing the tab.
 */

/** Where a project's remote lives, without the repository name on the end. */
function originOf(remote: string): string {
    return parseVcsRemoteUrl(remote)?.origin ?? remote.trim();
}

/**
 * The copy of a server's project this machine already holds, if it holds one.
 *
 * **Matched on the repository id and never on the name.** Two projects are called
 * "Demo" as often as not, and the first thing an author does with a clone is rename the
 * folder it landed in; either would make a name match hand back somebody else's work to
 * open. The id is written once when the repository is made and survives both.
 *
 * A project this machine cannot produce an id for - no repository, an unreadable
 * `.lore/id` - simply does not match. That is the safe direction: the project then offers
 * to fetch a copy, which asks where to put it and touches nothing that is already there,
 * where a wrong match would open the wrong project.
 *
 * More than one local copy of one repository is possible (a second clone in another
 * folder), and then the one configured against this same server is preferred - it is the
 * copy whose pushes reach the projects being listed.
 */
export function localCopyOf(
    project: VcsServerProject,
    repositories: readonly VcsLocalRepository[],
): VcsLocalRepository | null {
    const wanted = project.id.trim().toLowerCase();
    if (wanted === "") return null;
    const matches = repositories.filter(
        entry => (entry.repositoryId ?? "").toLowerCase() === wanted,
    );
    if (matches.length === 0) return null;
    const origin = originOf(project.remote);
    return matches.find(entry => entry.remoteOrigin === origin) ?? matches[0];
}
