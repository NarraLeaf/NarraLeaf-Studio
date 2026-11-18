import type { FileSystemService } from "../core/FileSystem";
import { storeWrite } from "../autosave/writeReport";

/** Write the local Team state and require the filesystem to accept the write. */
export async function writeTeamDocStore(
    fs: Pick<FileSystemService, "createDir" | "write">,
    directory: string,
    path: string,
    store: object,
): Promise<void> {
    const created = await fs.createDir(directory);
    if (!created.ok || created.refused) throw new Error("Could not create the Team state directory");
    const written = await fs.write(path, JSON.stringify(store), "utf-8", storeWrite("workspace.shell.save.stores.teamDocs", "notRetried"));
    if (!written.ok || written.refused) throw new Error("Could not save the Team state");
}
