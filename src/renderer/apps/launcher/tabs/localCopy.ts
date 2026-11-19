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
 * **And only a copy still configured against this same server counts.** Making a team
 * project personal keeps its `.lore/id` and drops its server address, so the id alone
 * called that personal folder "on this machine" - and opening it opened a project that no
 * longer syncs with anyone. A copy pointed at another server, or at none, is somebody's
 * own project now; the server's project then offers to fetch a copy of its own.
 *
 * A project this machine cannot produce an id for - no repository, an unreadable
 * `.lore/id` - simply does not match. That is the safe direction: the project then offers
 * to fetch a copy, which asks where to put it and touches nothing that is already there,
 * where a wrong match would open the wrong project.
 */
export function localCopyOf(
    project: VcsServerProject,
    repositories: readonly VcsLocalRepository[],
): VcsLocalRepository | null {
    const wanted = project.id.trim().toLowerCase();
    if (wanted === "") return null;
    const origin = originOf(project.remote);
    return repositories.find(
        entry => (entry.repositoryId ?? "").toLowerCase() === wanted && entry.remoteOrigin === origin,
    ) ?? null;
}
