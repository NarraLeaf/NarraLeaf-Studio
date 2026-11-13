import path from "path";
import { unpatchedFsPromises as fs } from "./unpatchedFs";

/**
 * The real path the operating system will reach for `fsPath`, for an authorization decision.
 *
 * **Not `path.resolve` first.** That folds `..` by spelling, while the I/O that follows hands the
 * original string to the operating system, which follows a symbolic link *before* it applies the
 * `..` after it. `<grant>/link/../secret` used to be judged as `<grant>/secret` and then read as the
 * parent of wherever `link` points. `realpath` on the unfolded string resolves it the way the I/O
 * will. A tail that does not exist yet (a file about to be written) is peeled off and put back on
 * the real path of what does exist.
 */
export async function resolvePhysicalPath(
    fsPath: string,
    realpath: (target: string) => Promise<string> = target => fs.realpath(target),
): Promise<string> {
    // Joined by hand: `path.join` and `path.resolve` would fold the `..` this exists to keep.
    const absolute = path.isAbsolute(fsPath) ? fsPath : `${process.cwd()}${path.sep}${fsPath}`;
    const pendingSegments: string[] = [];
    let current = absolute;

    while (true) {
        try {
            const realCurrent = await realpath(current);
            // What is left never existed, so it holds no link to follow; joining it by spelling is
            // what the operating system does with it too.
            return pendingSegments.length > 0
                ? path.join(realCurrent, ...pendingSegments)
                : realCurrent;
        } catch {
            const parent = path.dirname(current);
            if (parent === current) {
                return path.resolve(fsPath);
            }
            pendingSegments.unshift(path.basename(current));
            current = parent;
        }
    }
}
