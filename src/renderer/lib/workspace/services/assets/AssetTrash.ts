import { appPrivilegedFacade } from "@/lib/app/privilegedFacade";
import type { RequestStatus } from "@shared/types/ipcEvents";
import type { FsRejectErrorCode, FsRequestResult } from "@shared/types/os";
import { UNDO_TRASH_DIRECTORY } from "@shared/project/undoTrash";
import type { Porject } from "../../project/project";
import { isBundleAssetType } from "./assetTypes";
import type { AssetType } from "./assetTypes";

/** What {@link AssetTrash.keep} answers: the slot the copy went to, or why there is none. */
export type KeptCopy =
    | { kept: true; token: string }
    /** Nothing on disk to copy: the asset's file is already missing. */
    | { kept: false; missing: true }
    /** The copy could not be made. `fsCode` says why, when the disk said. */
    | { kept: false; missing: false; fsCode?: FsRejectErrorCode };

/**
 * Where an asset's bytes wait, in case the author presses Ctrl+Z: the payload of a deleted asset,
 * and the bytes a replacement wrote over.
 *
 * Deleting an asset used to unlink the payload, which is why "make deletion recoverable" had to
 * come before "make deletion undoable" - an undo entry can put a record back, but it cannot invent
 * a 200 MB video. So the payload is *moved* rather than deleted, and the undo entry holds the
 * token that says where it went.
 *
 * Replacing an asset's bytes is the same problem the other way round: the file stays where it is and
 * its contents go. So the contents are *copied* here first ({@link keep}), and nothing is written over
 * them unless the copy was made. The copy is named with the asset's extension, which is what lets the
 * replace pipeline take it back in exactly the way it took the new file in.
 *
 * # Lifetime
 *
 * Exactly the undo entry's. When the entry leaves the stack for good - trimmed past the depth
 * limit, cleared by a reload, or dropped because a new edit invalidated the redo branch - its
 * disposer calls {@link purge} and the bytes go for real. That is the whole retention policy, and
 * it needs no timer and no size budget: an author can always undo as far back as the stack goes,
 * and never further.
 *
 * History never survives a restart, so neither should the trash. {@link sweep} empties it at
 * workspace startup; anything still there is from a session that ended, and nothing can reach it.
 * The main process empties it too when the project's last window closes (`emptyUndoTrash`), so a
 * project nobody reopens does not carry the bytes of its last session's undo.
 *
 * # Why `.nlstudio/`
 *
 * Nothing that leaves this machine reads it, and every route out has been checked against that:
 * version control excludes it at any depth (`.nlstudio` is in the working set's excluded names, so
 * no commit and no push to a Team server carries it), a project export excludes it whole
 * (`shouldExcludeProjectPackagePath`), a build reads each asset's bytes by id from its content shard
 * and never walks this directory, and a live session sends files over its own transfers - each
 * machine keeps its own trash. `undoTrash.test.ts` holds the path against the first two. The asset
 * index is built from the metadata shards rather than by walking directories, so nothing here can be
 * mistaken for a live asset either; under `assets/` it would also be counted by the project's size
 * report.
 */
export class AssetTrash {
    constructor(private readonly project: Porject) {}

    private root(): string {
        return this.project.resolve(`${UNDO_TRASH_DIRECTORY}/`);
    }

    private slotPath(token: string): string {
        return this.project.resolve(`${UNDO_TRASH_DIRECTORY}/`, token);
    }

    /** Where a slot is on disk, for the replace pipeline to read a kept copy back from. */
    public pathOf(token: string): string {
        return this.slotPath(token);
    }

    /**
     * Move an asset's payload aside. Returns the token to restore it with, or null when there was
     * nothing there - a record whose file is already missing is not an error, and callers must not
     * be forced to care.
     */
    public async put(assetId: string, type: AssetType, payloadPath: string): Promise<string | null> {
        const isBundle = isBundleAssetType(type);
        const exists = isBundle
            ? await appPrivilegedFacade.fs.isDirExists(payloadPath)
            : await appPrivilegedFacade.fs.isFileExists(payloadPath);
        if (!exists.success || !exists.data?.ok || !exists.data.data) {
            return null;
        }

        // The id alone is not unique enough: delete, undo, delete again inside one session produces
        // two live entries for the same asset, and the second `put` would land on the first's slot.
        const token = `${assetId}-${nextTrashSequence()}`;
        const created = await appPrivilegedFacade.fs.createDir(this.root());
        if (!created.success) {
            return null;
        }
        const moved = isBundle
            ? await appPrivilegedFacade.fs.moveDir(payloadPath, this.slotPath(token))
            : await appPrivilegedFacade.fs.moveFile(payloadPath, this.slotPath(token));
        if (!moved.success || !moved.data?.ok) {
            return null;
        }
        return token;
    }

    /**
     * Copy an asset's payload aside, leaving it where it is: what has to happen before anything is
     * written over it.
     *
     * The slot carries `ext` as its extension, so a file read back from it is taken for the type it
     * was. A bundle's slot is a folder and has none.
     */
    public async keep(assetId: string, type: AssetType, payloadPath: string, ext?: string): Promise<KeptCopy> {
        const isBundle = isBundleAssetType(type);
        const exists = isBundle
            ? await appPrivilegedFacade.fs.isDirExists(payloadPath)
            : await appPrivilegedFacade.fs.isFileExists(payloadPath);
        if (!exists.success || !exists.data?.ok) {
            return { kept: false, missing: false, fsCode: fsCodeOf(exists) };
        }
        if (!exists.data.data) {
            return { kept: false, missing: true };
        }

        const suffix = !isBundle && ext ? `.${ext}` : "";
        const token = `${assetId}-${nextTrashSequence()}${suffix}`;
        const created = await appPrivilegedFacade.fs.createDir(this.root());
        if (!created.success || !created.data?.ok) {
            return { kept: false, missing: false, fsCode: fsCodeOf(created) };
        }
        const copied = isBundle
            ? await appPrivilegedFacade.fs.copyDir(payloadPath, this.slotPath(token))
            : await appPrivilegedFacade.fs.copyFile(payloadPath, this.slotPath(token));
        // A frozen project answers a write with a no-op that says so. Nothing was copied.
        if (!copied.success || !copied.data?.ok || copied.data.refused) {
            // A copy that stopped partway can still have left a file behind.
            this.purge(token, type);
            return { kept: false, missing: false, fsCode: fsCodeOf(copied) };
        }
        return { kept: true, token };
    }

    /** Move a payload back where it came from. False when the slot is gone or the move failed. */
    public async restore(token: string, type: AssetType, payloadPath: string): Promise<boolean> {
        const isBundle = isBundleAssetType(type);
        const moved = isBundle
            ? await appPrivilegedFacade.fs.moveDir(this.slotPath(token), payloadPath)
            : await appPrivilegedFacade.fs.moveFile(this.slotPath(token), payloadPath);
        return moved.success && !!moved.data?.ok;
    }

    /** Let a slot go for real. Called from an undo entry's disposer, so it never throws. */
    public purge(token: string, type: AssetType): void {
        const path = this.slotPath(token);
        const remove = isBundleAssetType(type)
            ? appPrivilegedFacade.fs.deleteDir(path)
            : appPrivilegedFacade.fs.deleteFile(path);
        void remove.catch(error => {
            console.warn(`[AssetTrash] could not purge ${token}`, error);
        });
    }

    /**
     * Empty the trash. Called once at workspace startup: undo history does not survive a restart,
     * so every slot left from a previous session is unreachable by construction.
     */
    public async sweep(): Promise<void> {
        try {
            const exists = await appPrivilegedFacade.fs.isDirExists(this.root());
            if (exists.success && exists.data?.ok && exists.data.data) {
                await appPrivilegedFacade.fs.deleteDir(this.root());
            }
        } catch (error) {
            console.warn("[AssetTrash] could not sweep the trash", error);
        }
    }
}

/** The disk's reason a request failed, when it gave one. */
function fsCodeOf(status: RequestStatus<FsRequestResult<unknown>>): FsRejectErrorCode | undefined {
    if (!status.success || status.data.ok) {
        return undefined;
    }
    return (status.data as FsRequestResult<unknown, false>).error?.code;
}

let trashSequence = 0;

function nextTrashSequence(): number {
    trashSequence += 1;
    return trashSequence;
}
