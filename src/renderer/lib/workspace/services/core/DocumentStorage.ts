import type { DocumentStorage } from "@shared/documents/documentIo";
import { normalizeDocumentPath } from "@shared/documents/documentPath";
import { FsRejectErrorCode } from "@shared/types/os";
import { RendererError } from "@shared/utils/error";
import { join } from "@shared/utils/path";
import { Services, type WorkspaceContext } from "../services";
import type { FileSystemService } from "./FileSystem";

/**
 * The renderer's half of the {@link DocumentStorage} port: project-relative paths in, the existing
 * privileged filesystem bridge out.
 *
 * The port is declared in `@shared/documents` without a filesystem in sight, so that the same
 * parse/quarantine behaviour serves the renderer (which edits documents), the main process (which
 * has to read them for a diff), and a revision reader (which has no disk at all). This adapter is
 * one of the two ends; `src/main/app/application/utils/documentStorage.ts` is the other.
 *
 * Writes go through {@link FileSystemService.write} and nothing else. That is not indirection for
 * its own sake: that path is the atomic temp-file-and-rename writer, and it is the path
 * `SaveStatusService` observes, so a document save that fails is reported to the author by
 * machinery that already exists. A second way to put bytes on disk would silently opt out of both.
 */
export type DocumentFileSystem = Pick<FileSystemService, "read" | "write" | "createDir" | "copyFile">;

export class RendererDocumentStorage implements DocumentStorage {
    public constructor(
        private readonly fs: DocumentFileSystem,
        private readonly projectRoot: string,
    ) {}

    public async read(path: string): Promise<string | null> {
        const result = await this.fs.read(this.absolute(path), "utf-8");
        if (result.ok) {
            return result.data;
        }
        // "Not there" is an answer, not a failure - it is how every one of these services learns
        // that a document has never been created. Anything else has to propagate: reporting a
        // permission error as a missing file would hand the caller an empty document to write back
        // over a file it simply was not allowed to read.
        if (result.error.code === FsRejectErrorCode.NOT_FOUND) {
            return null;
        }
        throw new RendererError(`Failed to read ${path}: ${result.error.message}`);
    }

    public async write(path: string, text: string): Promise<void> {
        await this.ensureParentDirectory(path);
        const result = await this.fs.write(this.absolute(path), text, "utf-8");
        if (!result.ok) {
            throw new RendererError(`Failed to write ${path}: ${result.error.message}`);
        }
    }

    public async copy(fromPath: string, toPath: string): Promise<void> {
        await this.ensureParentDirectory(toPath);
        const result = await this.fs.copyFile(this.absolute(fromPath), this.absolute(toPath));
        if (!result.ok) {
            throw new RendererError(`Failed to copy ${fromPath} to ${toPath}: ${result.error.message}`);
        }
    }

    /**
     * The directories a document lives in are created on demand, so no caller has to remember to.
     *
     * Quarantine is the case that forces it: `.nlstudio/quarantine/<timestamp>/...` has never
     * existed before the moment it is needed, and a copy that failed for want of a directory would
     * lose the one artefact the author could have recovered from.
     */
    private async ensureParentDirectory(path: string): Promise<void> {
        const segments = normalizeDocumentPath(path).split("/");
        if (segments.length < 2) {
            return;
        }
        const parent = this.absolute(segments.slice(0, -1).join("/"));
        const created = await this.fs.createDir(parent);
        if (!created.ok) {
            throw new RendererError(`Failed to create ${segments.slice(0, -1).join("/")}: ${created.error.message}`);
        }
    }

    /**
     * Normalising here rather than trusting the caller is what confines every write to the project.
     * `documentIo` already refuses `..` and absolute paths, but this is the last place that could,
     * and it is the place where a mistake would become a write to somebody's home directory.
     */
    private absolute(path: string): string {
        return join(this.projectRoot, ...normalizeDocumentPath(path).split("/"));
    }
}

/** The one line a document service needs to reach its project's documents. */
export function createProjectDocumentStorage(ctx: WorkspaceContext): DocumentStorage {
    return new RendererDocumentStorage(
        ctx.services.get<FileSystemService>(Services.FileSystem),
        ctx.project.getConfig().projectPath,
    );
}
