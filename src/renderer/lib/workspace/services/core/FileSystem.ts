import { FsRejectError, FsRejectErrorCode, FsRequestResult } from "@shared/types/os";
import type { FsTextEncoding } from "@shared/types/textEncoding";
import { FileDetails, FileStat, FileEntry, DirectorySizeResult } from "@shared/utils/fs";
import { IFileSystemService, WorkspaceContext } from "../services";
import { Service } from "../Service";
import { RequestStatus } from "@shared/types/ipcEvents";
import { AppHost, AppProtocol } from "@shared/types/constants";
import { appPrivilegedFacade } from "@/lib/app/privilegedFacade";
import { refuseFrozenWrite, refuseReloadingWrite } from "@/lib/app/writeFreeze";
import { readProjectDataFromSource } from "@/lib/app/documentSource";
import { mergeConflictReadPath } from "@/lib/app/mergeConflictReads";
import { getInterface } from "@/lib/app/bridge";

/**
 * The result of one attempt to put bytes on disk, reported for every write that goes through this
 * module.
 *
 * This is the only place in the renderer that knows both *which file* a save was aiming at and
 * whether it landed - each document service only sees its own `FsRequestResult` and, before
 * SaveStatusService, most of them dropped it. Observing here means one subscriber can report every
 * failing path without each service having to remember to say so.
 */
export type FsWriteOutcome = {
  path: string;
  ok: boolean;
  error?: FsRejectError;
};

const writeObservers = new Set<(outcome: FsWriteOutcome) => void>();

/**
 * A write that the freeze latch refused, answered as a no-op success.
 *
 * The four verbs below report to {@link writeObservers}, and a refusal must not reach them: the
 * subscriber is `SaveStatusService`, whose whole vocabulary there is "this path failed" / "this path
 * recovered". A refusal is neither. It is announced on its own channel
 * (`observeRefusedWrites`) instead, which is what lets the notice say *frozen* rather than *failed*.
 *
 * See `frozenNoOp` in the privileged facade for why a refusal is not an error.
 *
 * The same answer covers a write refused because the working tree is being re-read
 * (`refuseReloadingWrite`). That hold is enforced here and not in the privileged facade because the
 * only writes a reload can produce come from a document service's load path, and every one of those
 * goes through this class - `RendererDocumentStorage`, the asset shards, the service stores. The
 * facade's direct writers (asset import, project settings) are author actions, and a reload does not
 * perform them.
 */
const FROZEN_NO_OP: FsRequestResult<void> = { ok: true, data: undefined };

function reportWriteOutcome(path: string, result: FsRequestResult<void>): FsRequestResult<void> {
  if (writeObservers.size > 0) {
    const outcome: FsWriteOutcome = result.ok
      ? { path, ok: true }
      : { path, ok: false, error: result.error };
    for (const observer of writeObservers) {
      try {
        observer(outcome);
      } catch (error) {
        // An observer must never be able to turn a successful write into a failed one.
        console.warn("[FileSystem] write observer threw", error);
      }
    }
  }
  return result;
}

export class BaseFileSystemService {
  /**
   * Watch every write this module performs. Returns an unsubscribe.
   *
   * Deliberately module-level rather than per-workspace: the writes themselves are static, and a
   * subscriber that outlives a project switch is a subscriber that still reports the writes made
   * while the next project loads.
   */
  public static observeWrites(observer: (outcome: FsWriteOutcome) => void): () => void {
    writeObservers.add(observer);
    return () => {
      writeObservers.delete(observer);
    };
  }

  public static async stat(path: string): Promise<FsRequestResult<FileStat>> {
    return this.wrapIPCError(await appPrivilegedFacade.fs.stat(path));
  }

  public static async list(path: string): Promise<FsRequestResult<FileEntry[]>> {
    return this.wrapIPCError(await appPrivilegedFacade.fs.list(path));
  }

  public static async details(path: string): Promise<FsRequestResult<FileDetails>> {
    return this.wrapIPCError(await appPrivilegedFacade.fs.details(path));
  }

  /**
   * Total the bytes of a directory tree in one round trip, sharing the game build's own
   * measurement (`Fs.directorySize`). Goes through the base app bridge rather than the privileged
   * facade: this is a Studio-internal capability, not part of the plugin-facing fs surface.
   */
  public static async directorySize(path: string): Promise<FsRequestResult<DirectorySizeResult>> {
    return this.wrapIPCError(await getInterface().fs.directorySize(path));
  }

  public static async read(
    path: string,
    encoding: FsTextEncoding
  ): Promise<FsRequestResult<string>> {
    const substituted = await this.readFromDocumentSource(path, encoding);
    if (substituted) {
      return substituted;
    }
    // After the source and never before it: a revision view answers for the whole project, and
    // a merge's leftovers on disk are not part of any revision. Below it, one more redirection
    // for the handful of paths an open merge has made unparseable - see `mergeConflictReads`,
    // which is what lets a project mid-merge be opened at all.
    return this.fetch(mergeConflictReadPath(path) ?? path, encoding);
  }

  public static async readRaw(path: string): Promise<FsRequestResult<Uint8Array>> {
    return this.fetchRaw(path);
  }

  /**
   * The version-view half of the boundary: while the workspace is showing a revision,
   * project data is read out of that revision rather than off the disk.
   *
   * Answers null when the caller should read the disk - no source installed, a path
   * outside the repository (`.nlstudio/`, `editor/cache/`, `dist/`), or an encoding a
   * source cannot answer. `@/lib/app/documentSource` owns the reasoning; the only thing
   * decided here is the shape of the answer, and "not present at that version" has to
   * be the SAME `NOT_FOUND` every load path already handles - the branch that puts a
   * service into its "missing, use defaults" state at project open.
   */
  private static async readFromDocumentSource(
    path: string,
    encoding: FsTextEncoding
  ): Promise<FsRequestResult<string> | null> {
    // A source hands back a string; anything read under another encoding is being read
    // for its bytes, and decoding a blob as UTF-8 to re-encode it would corrupt it.
    if (encoding !== "utf-8" && encoding !== "utf8") {
      return null;
    }
    const answered = await readProjectDataFromSource(path);
    if (!answered) {
      return null;
    }
    if (answered.text === null) {
      return {
        ok: false,
        error: {
          code: FsRejectErrorCode.NOT_FOUND,
          message: `${path} does not exist at the version being shown`
        }
      };
    }
    return { ok: true, data: answered.text };
  }

  public static async write(
    path: string,
    data: string,
    encoding: FsTextEncoding
  ): Promise<FsRequestResult<void>> {
    if (refuseFrozenWrite(path) || refuseReloadingWrite(path)) {
      return FROZEN_NO_OP;
    }
    return reportWriteOutcome(path, await this.put(path, data, encoding));
  }

  public static async writeRaw(path: string, data: Uint8Array): Promise<FsRequestResult<void>> {
    if (refuseFrozenWrite(path) || refuseReloadingWrite(path)) {
      return FROZEN_NO_OP;
    }
    return reportWriteOutcome(path, await this.putRaw(path, data));
  }

  public static async ensureRegularFile(
    path: string,
    data: string,
    encoding: BufferEncoding
  ): Promise<FsRequestResult<void>> {
    if (refuseFrozenWrite(path) || refuseReloadingWrite(path)) {
      return FROZEN_NO_OP;
    }
    return reportWriteOutcome(
      path,
      this.wrapIPCError(await appPrivilegedFacade.fs.ensureRegularFile(path, data, encoding))
    );
  }

  public static async writeFileNoFollow(
    path: string,
    data: string,
    encoding: BufferEncoding
  ): Promise<FsRequestResult<void>> {
    if (refuseFrozenWrite(path) || refuseReloadingWrite(path)) {
      return FROZEN_NO_OP;
    }
    return reportWriteOutcome(
      path,
      this.wrapIPCError(await appPrivilegedFacade.fs.writeFileNoFollow(path, data, encoding))
    );
  }

  /**
   * Set a damaged JSON file aside and put a usable one in its place.
   *
   * Gated like every other writer, which it was not before. It moves the author's file and writes
   * a replacement over the path, so a frozen workspace that let it through would rewrite the
   * working tree from a *load* path - and a load runs on every project open, including the ones
   * where the freeze exists precisely because the tree must not be touched (a revision view, an
   * open merge, a recovery shell). Recovery mode is the case that makes it plain: without this the
   * act of opening a project to diagnose a corrupt asset shard is the act that resets it.
   */
  public static async recoverCorruptedJsonFile(
    path: string,
    replacement: string,
    encoding: BufferEncoding
  ): Promise<FsRequestResult<void>> {
    if (refuseFrozenWrite(path) || refuseReloadingWrite(path)) {
      return FROZEN_NO_OP;
    }
    return this.wrapIPCError(
      await appPrivilegedFacade.fs.recoverCorruptedJsonFile(path, replacement, encoding)
    );
  }

  public static async createDir(path: string): Promise<FsRequestResult<void>> {
    return this.wrapIPCError(await appPrivilegedFacade.fs.createDir(path));
  }

  public static async deleteFile(path: string): Promise<FsRequestResult<void>> {
    return this.wrapIPCError(await appPrivilegedFacade.fs.deleteFile(path));
  }

  public static async deleteDir(path: string): Promise<FsRequestResult<void>> {
    return this.wrapIPCError(await appPrivilegedFacade.fs.deleteDir(path));
  }

  public static async rename(
    oldPath: string,
    newPath: string,
    isDir: boolean
  ): Promise<FsRequestResult<void>> {
    return this.wrapIPCError(await appPrivilegedFacade.fs.rename(oldPath, newPath, isDir));
  }

  public static async copyFile(src: string, dest: string): Promise<FsRequestResult<void>> {
    return this.wrapIPCError(await appPrivilegedFacade.fs.copyFile(src, dest));
  }

  public static async copyDir(src: string, dest: string): Promise<FsRequestResult<void>> {
    return this.wrapIPCError(await appPrivilegedFacade.fs.copyDir(src, dest));
  }

  public static async moveFile(src: string, dest: string): Promise<FsRequestResult<void>> {
    return this.wrapIPCError(await appPrivilegedFacade.fs.moveFile(src, dest));
  }

  public static async moveDir(src: string, dest: string): Promise<FsRequestResult<void>> {
    return this.wrapIPCError(await appPrivilegedFacade.fs.moveDir(src, dest));
  }

  /**
   * Redirected to the active document source along with {@link read}, because several
   * load paths ask this first and treat `false` as "create the default" -
   * `StoryService.loadLibrary` is one. Left on the disk, a document absent from the
   * revision would be reported as present and then fail to read, which is a louder and
   * less honest version of the same answer.
   */
  public static async isFileExists(path: string): Promise<FsRequestResult<boolean>> {
    const substituted = await this.readFromDocumentSource(path, "utf-8");
    if (substituted) {
      return { ok: true, data: substituted.ok };
    }
    return this.wrapIPCError(await appPrivilegedFacade.fs.isFileExists(path));
  }

  public static async isDirExists(path: string): Promise<FsRequestResult<boolean>> {
    return this.wrapIPCError(await appPrivilegedFacade.fs.isDirExists(path));
  }

  public static async isFile(path: string): Promise<FsRequestResult<boolean>> {
    return this.wrapIPCError(await appPrivilegedFacade.fs.isFile(path));
  }

  public static async isDir(path: string): Promise<FsRequestResult<boolean>> {
    return this.wrapIPCError(await appPrivilegedFacade.fs.isDir(path));
  }

  public static async readJSON<T>(
    path: string,
    encoding: FsTextEncoding = "utf-8"
  ): Promise<FsRequestResult<T>> {
    const fileResult = await this.read(path, encoding);
    if (!fileResult.ok) {
      return fileResult;
    }
    try {
      return {
        ok: true,
        data: JSON.parse(fileResult.data) as T
      };
    } catch {
      return {
        ok: false,
        error: {
          code: FsRejectErrorCode.INVALID_JSON,
          message: `Failed to parse JSON from ${path}`
        }
      };
    }
  }

  private static async fetch(
    path: string,
    encoding: FsTextEncoding
  ): Promise<FsRequestResult<string>> {
    const requestResult = this.wrapIPCError(
      await appPrivilegedFacade.fs.requestRead(path, encoding)
    );
    if (!requestResult.ok) {
      return requestResult;
    }

    const url = this.constructUrl(requestResult.data);
    const response = await fetch(url);

    if (!response.ok) {
      return {
        ok: false,
        error: {
          code: FsRejectErrorCode.IPC_ERROR,
          message: `Failed to fetch file from ${url}: ${response.statusText}`
        }
      };
    }
    return {
      ok: true,
      data: await response.text()
    };
  }

  private static async fetchRaw(path: string): Promise<FsRequestResult<Uint8Array>> {
    const requestResult = this.wrapIPCError(await appPrivilegedFacade.fs.requestReadRaw(path));
    if (!requestResult.ok) {
      return requestResult;
    }

    const url = this.constructUrl(requestResult.data);
    const response = await fetch(url);

    if (!response.ok) {
      return {
        ok: false,
        error: {
          code: FsRejectErrorCode.IPC_ERROR,
          message: `Failed to fetch file from ${url}: ${response.statusText}`
        }
      };
    }
    return {
      ok: true,
      data: new Uint8Array(await response.arrayBuffer())
    };
  }

  private static async put(
    path: string,
    data: string,
    encoding: FsTextEncoding
  ): Promise<FsRequestResult<void>> {
    const requestResult = this.wrapIPCError(
      await appPrivilegedFacade.fs.requestWrite(path, encoding)
    );
    if (!requestResult.ok) {
      return requestResult;
    }

    const url = this.constructUrl(requestResult.data);
    const response = await fetch(url, {
      method: "PUT",
      body: data
    });
    if (!response.ok) {
      return {
        ok: false,
        error: {
          code: FsRejectErrorCode.IPC_ERROR,
          message: `Failed to write file to ${url}: ${response.statusText}`
        }
      };
    }

    return {
      ok: true,
      data: undefined
    };
  }

  private static async putRaw(path: string, data: Uint8Array): Promise<FsRequestResult<void>> {
    const requestResult = this.wrapIPCError(await appPrivilegedFacade.fs.requestWriteRaw(path));
    if (!requestResult.ok) {
      return requestResult;
    }

    const url = this.constructUrl(requestResult.data);
    const response = await fetch(url, {
      method: "PUT",
      body: new Uint8Array(data),
      headers: {
        "Content-Type": "application/octet-stream"
      }
    });
    if (!response.ok) {
      return {
        ok: false,
        error: {
          code: FsRejectErrorCode.IPC_ERROR,
          message: `Failed to write file to ${url}: ${response.statusText}`
        }
      };
    }

    return {
      ok: true,
      data: undefined
    };
  }

  private static constructUrl(hash: string): string {
    return `${AppProtocol}://${AppHost.Fs}/${hash}`;
  }

  private static wrapIPCError<T>(result: RequestStatus<FsRequestResult<T>>): FsRequestResult<T> {
    if (!result.success) {
      return {
        ok: false,
        error: {
          code: FsRejectErrorCode.IPC_ERROR,
          message: result.error ?? ""
        }
      };
    }
    return result.data;
  }
}

export class FileSystemService extends Service<FileSystemService> implements IFileSystemService {
  protected init(_ctx: WorkspaceContext): Promise<void> | void {}

  /** See {@link BaseFileSystemService.observeWrites}. */
  public observeWrites(observer: (outcome: FsWriteOutcome) => void): () => void {
    return BaseFileSystemService.observeWrites(observer);
  }

  public async stat(path: string): Promise<FsRequestResult<FileStat>> {
    return BaseFileSystemService.stat(path);
  }

  public async list(path: string): Promise<FsRequestResult<FileEntry[]>> {
    return BaseFileSystemService.list(path);
  }

  public async details(path: string): Promise<FsRequestResult<FileDetails>> {
    return BaseFileSystemService.details(path);
  }

  public async directorySize(path: string): Promise<FsRequestResult<DirectorySizeResult>> {
    return BaseFileSystemService.directorySize(path);
  }

  public async read(path: string, encoding: FsTextEncoding): Promise<FsRequestResult<string>> {
    return BaseFileSystemService.read(path, encoding);
  }

  public async readRaw(path: string): Promise<FsRequestResult<Uint8Array>> {
    return BaseFileSystemService.readRaw(path);
  }

  public async write(
    path: string,
    data: string,
    encoding: FsTextEncoding
  ): Promise<FsRequestResult<void>> {
    return BaseFileSystemService.write(path, data, encoding);
  }

  public async writeRaw(path: string, data: Uint8Array): Promise<FsRequestResult<void>> {
    return BaseFileSystemService.writeRaw(path, data);
  }

  public async ensureRegularFile(
    path: string,
    data: string,
    encoding: BufferEncoding
  ): Promise<FsRequestResult<void>> {
    return BaseFileSystemService.ensureRegularFile(path, data, encoding);
  }

  public async writeFileNoFollow(
    path: string,
    data: string,
    encoding: BufferEncoding
  ): Promise<FsRequestResult<void>> {
    return BaseFileSystemService.writeFileNoFollow(path, data, encoding);
  }

  public async recoverCorruptedJsonFile(
    path: string,
    replacement: string,
    encoding: BufferEncoding
  ): Promise<FsRequestResult<void>> {
    return BaseFileSystemService.recoverCorruptedJsonFile(path, replacement, encoding);
  }

  public async createDir(path: string): Promise<FsRequestResult<void>> {
    return BaseFileSystemService.createDir(path);
  }

  public async deleteFile(path: string): Promise<FsRequestResult<void>> {
    return BaseFileSystemService.deleteFile(path);
  }

  public async deleteDir(path: string): Promise<FsRequestResult<void>> {
    return BaseFileSystemService.deleteDir(path);
  }

  public async rename(
    oldPath: string,
    newPath: string,
    isDir: boolean
  ): Promise<FsRequestResult<void>> {
    return BaseFileSystemService.rename(oldPath, newPath, isDir);
  }

  public async copyFile(src: string, dest: string): Promise<FsRequestResult<void>> {
    return BaseFileSystemService.copyFile(src, dest);
  }

  public async copyDir(src: string, dest: string): Promise<FsRequestResult<void>> {
    return BaseFileSystemService.copyDir(src, dest);
  }

  public async moveFile(src: string, dest: string): Promise<FsRequestResult<void>> {
    return BaseFileSystemService.moveFile(src, dest);
  }

  public async moveDir(src: string, dest: string): Promise<FsRequestResult<void>> {
    return BaseFileSystemService.moveDir(src, dest);
  }

  public async isFileExists(path: string): Promise<FsRequestResult<boolean>> {
    return BaseFileSystemService.isFileExists(path);
  }

  public async isDirExists(path: string): Promise<FsRequestResult<boolean>> {
    return BaseFileSystemService.isDirExists(path);
  }

  public async isFile(path: string): Promise<FsRequestResult<boolean>> {
    return BaseFileSystemService.isFile(path);
  }

  public async isDir(path: string): Promise<FsRequestResult<boolean>> {
    return BaseFileSystemService.isDir(path);
  }

  public async readJSON<T>(
    path: string,
    encoding: FsTextEncoding = "utf-8"
  ): Promise<FsRequestResult<T>> {
    return BaseFileSystemService.readJSON<T>(path, encoding);
  }
}
