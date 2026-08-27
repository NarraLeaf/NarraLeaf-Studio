import fs from "fs/promises";
import path from "path";
import { DLC_DOCUMENT_PATH } from "@shared/documents/specs";
import {
    createEmptyDlcDocument,
    migrateProjectDlcDocument,
    type ProjectDlc,
    type ProjectDlcDocument,
} from "@shared/types/dlc";

/**
 * Read a project's DLC (`editor/dlc.json`) from its root directory.
 *
 * The build pipeline reads this from disk for the reason it reads the `.nlproj` and the app tags
 * from disk: it runs against the files, not against whatever a renderer happens to be holding.
 *
 * **Absent is empty; present-but-unreadable throws.** A project that ships no DLC has no file, and
 * answering "no DLC" is exactly right - every story then belongs to the game itself. A file that is
 * there and will not parse is a different fact: answering "no DLC" for it would put the DLC's
 * content into the base build and say nothing, which is the one outcome this must never produce
 * quietly.
 */
export async function readProjectDlcFromDir(projectPath: string): Promise<ProjectDlc[]> {
    return (await readProjectDlcDocumentFromDir(projectPath)).dlcs;
}

/** The whole document, for callers that need more than the list. Same rules as above. */
export async function readProjectDlcDocumentFromDir(
    projectPath: string,
): Promise<ProjectDlcDocument> {
    const filePath = path.join(projectPath, ...DLC_DOCUMENT_PATH.split("/"));
    let raw: string;
    try {
        raw = await fs.readFile(filePath, "utf-8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
            return createEmptyDlcDocument();
        }
        throw error;
    }
    try {
        return migrateProjectDlcDocument(JSON.parse(raw));
    } catch (error) {
        throw new Error(
            `Invalid JSON in ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}
