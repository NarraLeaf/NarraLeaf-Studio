import fs from "fs/promises";
import path from "path";
import { DLC_DOCUMENT_PATH } from "@shared/documents/specs";
import { refuseNewerProjectDocument } from "@shared/documents/newerSchema";
import {
    createEmptyDlcDocument,
    DLC_SCHEMA_VERSION,
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
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        throw new Error(
            `Invalid JSON in ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
    // Between the parse and the migrator, which stamps the current version over whatever it read:
    // a document a newer Studio wrote would come back looking like this build's own, and the DLC
    // fields this build has never heard of would be gone from every package made from it.
    refuseNewerProjectDocument(parsed, {
        kind: "dlc",
        subject: DLC_DOCUMENT_PATH,
        supportedVersion: DLC_SCHEMA_VERSION,
    });
    return migrateProjectDlcDocument(parsed);
}
