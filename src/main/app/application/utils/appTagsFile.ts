import fs from "fs/promises";
import path from "path";
import { APP_TAGS_DOCUMENT_PATH } from "@shared/documents/specs";
import { migrateProjectAppTagDocument, type ProjectAppTag } from "@shared/types/appTag";

/**
 * Read a project's build variants (`editor/app-tags.json`) from its root directory.
 *
 * The build pipeline reads this from disk for the reason it reads the `.nlproj` from disk: it runs
 * against the files, not against whatever a renderer happens to be holding.
 *
 * **Absent is empty; present-but-unreadable throws.** A project that has never had a second variant
 * has no file, and answering "no variants" is exactly right - everything then resolves to the
 * release tag. A file that is there and will not parse is a different fact: answering "no variants"
 * for it would build the release identity under a variant's name and say nothing, which is the one
 * outcome a build must never produce quietly.
 *
 * The release tag is not among the results; it is synthesized by `resolveAppTag`, so a caller works
 * with this list and never has to add it.
 */
export async function readProjectAppTagsFromDir(projectPath: string): Promise<ProjectAppTag[]> {
    const filePath = path.join(projectPath, ...APP_TAGS_DOCUMENT_PATH.split("/"));
    let raw: string;
    try {
        raw = await fs.readFile(filePath, "utf-8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
            return [];
        }
        throw error;
    }
    try {
        return migrateProjectAppTagDocument(JSON.parse(raw)).tags;
    } catch (error) {
        throw new Error(
            `Invalid JSON in ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}
