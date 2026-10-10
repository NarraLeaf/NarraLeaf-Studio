/**
 * Which files an agent may hand to `assets_import`.
 *
 * The project directory, and the directories the author listed in Studio's agent settings - nothing
 * else, after normalisation. Normalisation is the part that matters: `<allowed>/../secrets` is a
 * path that *starts with* an allowed root and is not inside it, and a check by prefix would let it
 * through.
 *
 * Comments in English per project convention.
 */

import { isAbsolute, isWindowsPlatform, relative, resolve } from "@shared/utils/path";

/**
 * Whether `child` names `root` itself or something underneath it.
 *
 * `caseInsensitive` defaults to the platform's own answer for Windows, the one platform whose file
 * system never distinguishes the two spellings. A case-sensitive comparison elsewhere can only
 * refuse a path the author would call allowed, never admit one they would not.
 */
export function isPathInside(child: string, root: string, caseInsensitive: boolean = isWindowsPlatform): boolean {
    if (!isAbsolute(child) || !isAbsolute(root)) {
        return false;
    }
    const fold = (value: string) => (caseInsensitive ? value.toLowerCase() : value);
    const rel = relative(fold(resolve(root)), fold(resolve(child)));
    if (rel === "") {
        return true;
    }
    // `..` as a whole segment only: a directory called `..assets` is inside.
    const escapes = rel === ".." || rel.startsWith("../") || rel.startsWith("..\\");
    return !escapes && !isAbsolute(rel);
}

/** The first allowed root `path` is inside, or null. The project directory is always allowed. */
export function findAllowedImportRoot(
    path: string,
    projectPath: string,
    allowedRoots: readonly string[],
    caseInsensitive?: boolean,
): string | null {
    for (const root of [projectPath, ...allowedRoots]) {
        if (root && isPathInside(path, root, caseInsensitive)) {
            return root;
        }
    }
    return null;
}
