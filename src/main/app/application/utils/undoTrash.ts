import path from "path";
import { unpatchedFsPromises as fs } from "../../../utils/unpatchedFs";
import { UNDO_TRASH_DIRECTORY } from "@shared/project/undoTrash";

/**
 * Empty a project's undo trash: the asset bytes its undo steps could still have brought back.
 *
 * Called when this Studio gives the project up, which is when the last of its windows has closed and
 * every undo stack that could reach those bytes has gone with them. The workspace also sweeps the
 * trash when it opens, so a crash or a forced exit that never gets here costs disk until the next
 * open and nothing else.
 *
 * Never throws: giving a project up must not fail over a directory that could not be removed.
 */
export async function emptyUndoTrash(
    projectPath: string,
    logger: Pick<Console, "warn">,
): Promise<void> {
    try {
        await fs.rm(path.join(projectPath, ...UNDO_TRASH_DIRECTORY.split("/")), { recursive: true, force: true });
    } catch (error) {
        logger.warn("[Project] Could not empty the undo trash of", projectPath, error);
    }
}
