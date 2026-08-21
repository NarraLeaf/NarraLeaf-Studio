import type { DocumentStorage } from "@shared/documents/documentIo";
import { createWorkingTreeDocumentSource, type DocumentSource } from "@shared/documents/documentSource";
import { normalizeDocumentPath } from "@shared/documents/documentPath";
import { getProjectDocumentSource } from "@/lib/app/documentSource";
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
 * Writes go through {@link FileSystemService.writeFileNoFollowOrCreate} and nothing else. That is
 * not indirection for its own sake: that path is the atomic temp-file-and-rename writer, and it is
 * the path `SaveStatusService` observes, so a document save that fails is reported to the author by
 * machinery that already exists. A second way to put bytes on disk would silently opt out of both.
 *
 * **Not `FileSystemService.write`**, which is what this used to call. That verb mints a write grant
 * over IPC and then `PUT`s the payload back through the app protocol, and the pair costs about the
 * same whatever the payload weighs - so the eleven services on this port each paid two round trips
 * per save for one file's worth of bytes. `writeFileNoFollowOrCreate` is the same atomic write core
 * reached in one structured-clone call. See `BaseFileSystemService.writeFileNoFollowOrCreate` for
 * the measurement and for what the stricter rejection contract gives up.
 */
export type DocumentFileSystem = Pick<FileSystemService, "read" | "writeFileNoFollowOrCreate" | "createDir" | "copyFile">;

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

    /**
     * The port declares this `Promise<void>`, so a *refused* write - a frozen workspace, a working
     * tree being re-read - is indistinguishable here from one that landed. That is unchanged by the
     * route swap and deliberately not fixed here: the shape is the port's, shared with the main
     * process and with a revision reader that has no disk, and a caller that needs the distinction
     * has to ask `FileSystemService` directly the way `StoryService` does. The author still learns:
     * the latch announces the refusal on `observeRefusedWrites`, which is what puts the *frozen*
     * notice on the save-status surface.
     */
    public async write(path: string, text: string): Promise<void> {
        await this.ensureParentDirectory(path);
        const result = await this.fs.writeFileNoFollowOrCreate(this.absolute(path), text, "utf-8");
        if (!result.ok) {
            throw new RendererError(`Failed to write ${path}: ${result.error.message}`);
        }
    }

    public async copy(fromPath: string, toPath: string): Promise<void> {
        // Quarantine is this port's only caller (see `documentIo`), and while the workspace
        // is showing a revision the unreadable bytes are the REVISION's, not the file on
        // disk. Copying then would set aside a working copy that is perfectly fine, under a
        // name that says it is broken - and `loadDocument` already has the right landing for
        // a copy it could not make: corrupt, not quarantined, service not loaded.
        const source = getProjectDocumentSource();
        if (source && source.origin.kind !== "working-tree") {
            throw new RendererError(
                `Not quarantining ${fromPath}: the unreadable document belongs to the revision being shown, not to the working tree.`,
            );
        }
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

/**
 * The working tree as a {@link DocumentSource} - what "reload" means when nobody says
 * otherwise.
 *
 * Deliberately built on the storage adapter above rather than on a second path resolver:
 * whatever a project-relative path means for a write, it means the same for a read.
 */
export function createProjectWorkingTreeSource(ctx: WorkspaceContext): DocumentSource {
    return createWorkingTreeDocumentSource(createProjectDocumentStorage(ctx));
}
