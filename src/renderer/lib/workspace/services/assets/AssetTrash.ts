import { appPrivilegedFacade } from "@/lib/app/privilegedFacade";
import { ProjectNameConvention } from "../../project/nameConvention";
import type { Porject } from "../../project/project";
import { isBundleAssetType } from "./assetTypes";
import type { AssetType } from "./assetTypes";

/**
 * Where a deleted asset's bytes wait, in case the author presses Ctrl+Z.
 *
 * Deleting an asset used to unlink the payload, which is why "make deletion recoverable" had to
 * come before "make deletion undoable" - an undo entry can put a record back, but it cannot invent
 * a 200 MB video. So the payload is *moved* rather than deleted, and the undo entry holds the
 * token that says where it went.
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
 *
 * # Why `.nlstudio/`
 *
 * Two properties, both required and both already true of that directory: version control excludes
 * it at any depth (`.nlstudio` is in the working set's excluded names), and the asset index is
 * built from the metadata shards rather than by walking directories, so nothing here can be
 * mistaken for a live asset. Under `assets/` it would also be counted by the project's size
 * report, which is a third reason.
 */
export class AssetTrash {
  constructor(private readonly project: Porject) {}

  private root(): string {
    return this.project.resolve(ProjectNameConvention.NLCache, "trash/");
  }

  private slotPath(token: string): string {
    return this.project.resolve(ProjectNameConvention.NLCache, "trash/", token);
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
    void remove.catch((error) => {
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

let trashSequence = 0;

function nextTrashSequence(): number {
  trashSequence += 1;
  return trashSequence;
}
