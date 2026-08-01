import { getInterface } from "@/lib/app/bridge";
import { findProjectConfigFileName } from "@shared/utils/nlproj";

/**
 * Whether a folder Studio just filled holds something Studio can open.
 *
 * **Both "bring one in" flows need this and neither can assume it.** A Lore server holds
 * repositories, not Studio projects; a `.nlspkg` is a zip somebody could have assembled by hand.
 * The wrong name on the right server, a repository made with the `lore` CLI, an archive of the
 * wrong directory - every one of those transfers and unpacks perfectly. Without this the wizard
 * would report success, close, and hand the launcher a folder that fails to open somewhere that
 * knows nothing about where it came from.
 *
 * Decided the same way `relocateRecentProject` decides what the author pointed at, and the same
 * way the workspace decides what it is opening: a `.nlproj` (or the legacy `project.json`) in the
 * root. Anything that passes here passes what opens it next.
 *
 * A listing that cannot be read answers false rather than throwing. The caller's job at that
 * point is to stop, and "we could not confirm this is a project" and "it is not a project" lead
 * the author to the same next step.
 */
export async function isStudioProject(root: string): Promise<boolean> {
    const listed = await getInterface().fs.list(root);
    if (!listed.success || !listed.data.ok) {
        return false;
    }
    return findProjectConfigFileName(listed.data.data) !== null;
}
