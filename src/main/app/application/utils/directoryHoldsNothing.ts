import { unpatchedFsPromises as fs } from "../../../utils/unpatchedFs";

/**
 * Whether a directory is absent or has no entries.
 *
 * The state an import or a clone is allowed to start from, and the state a failed one leaves when it
 * wrote nothing - which is what decides whether the trust row written ahead of the copy stays. Read
 * through the unpatched `fs` because the path is the author's, and Electron's patched `fs` treats a
 * directory whose name ends in `.asar` as an archive.
 *
 * Anything that is not "readable and empty" answers false: a file at that path, a directory that
 * cannot be read, a permission the process lacks. Each of those is something at the path, or
 * something this cannot vouch for, and the callers treat false as "do not touch the ledger".
 */
export async function directoryHoldsNothing(dir: string): Promise<boolean> {
    try {
        return (await fs.readdir(dir)).length === 0;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === "ENOENT";
    }
}
