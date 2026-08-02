import path from "path";
import type { DocumentStorage } from "@shared/documents/documentIo";
import { normalizeDocumentPath } from "@shared/documents/documentPath";
import { FsRejectErrorCode } from "@shared/types/os";
import { Fs } from "@shared/utils/fs";

/**
 * The main process's half of the {@link DocumentStorage} port, over `Fs`.
 *
 * Version control lives here: a commit has to read documents the renderer never opened, and a diff
 * has to parse them with no workspace in the picture. That is the whole reason the port is declared
 * in `@shared/documents` free of Electron - see the renderer's
 * `lib/workspace/services/core/DocumentStorage.ts` for the other end. The two must behave
 * identically, because the same spec runs against both and a difference would show up as a document
 * that reads one way in the editor and another way in history.
 */
export class MainDocumentStorage implements DocumentStorage {
    public constructor(private readonly projectRoot: string) {}

    public async read(relativePath: string): Promise<string | null> {
        const result = await Fs.read(this.absolute(relativePath), "utf-8");
        if (result.ok) {
            return result.data;
        }
        // A missing document is an answer; anything else is a failure that has to propagate, or a
        // file we merely could not open would be indistinguishable from one that is not there.
        if (result.error.code === FsRejectErrorCode.NOT_FOUND) {
            return null;
        }
        throw new Error(`Failed to read ${relativePath}: ${result.error.message}`);
    }

    public async write(relativePath: string, text: string): Promise<void> {
        await this.ensureParentDirectory(relativePath);
        const result = await Fs.write(this.absolute(relativePath), text, "utf-8");
        if (!result.ok) {
            throw new Error(`Failed to write ${relativePath}: ${result.error.message}`);
        }
    }

    public async copy(fromPath: string, toPath: string): Promise<void> {
        await this.ensureParentDirectory(toPath);
        const result = await Fs.cpFile(this.absolute(fromPath), this.absolute(toPath));
        if (!result.ok) {
            throw new Error(`Failed to copy ${fromPath} to ${toPath}: ${result.error.message}`);
        }
    }

    /**
     * Created on demand because quarantine writes into `.nlstudio/quarantine/<timestamp>/...`,
     * a directory that by construction has never existed before it is needed.
     */
    private async ensureParentDirectory(relativePath: string): Promise<void> {
        const segments = normalizeDocumentPath(relativePath).split("/");
        if (segments.length < 2) {
            return;
        }
        const created = await Fs.createDir(this.absolute(segments.slice(0, -1).join("/")));
        if (!created.ok) {
            throw new Error(`Failed to create ${segments.slice(0, -1).join("/")}: ${created.error.message}`);
        }
    }

    /** Normalising here is what keeps a document path - quarantine's especially - inside the project. */
    private absolute(relativePath: string): string {
        return path.join(this.projectRoot, ...normalizeDocumentPath(relativePath).split("/"));
    }
}
