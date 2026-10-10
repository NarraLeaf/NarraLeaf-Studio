/**
 * Which files an agent may hand to `assets_import` (or any tool that reads the author's files).
 *
 * The project directory, and the directories the author listed in Studio's agent settings - nothing
 * else, after normalisation. A path outside them is not refused at once: {@link ensureAgentMayRead}
 * asks main, which asks the author. Normalisation is the part that matters: `<allowed>/../secrets` is a
 * path that *starts with* an allowed root and is not inside it, and a check by prefix would let it
 * through.
 *
 * Comments in English per project convention.
 */

import { isAbsolute, isWindowsPlatform, relative, resolve } from "@shared/utils/path";
import type { AgentFolderAccessAnswer, AgentFolderAccessRequest, AgentSessionPolicy } from "@shared/agent/protocol";
import { agentFolderAccessGaps, agentFolderAccessHint } from "@shared/agent/folderAccess";
import { refuse } from "./agentCall";

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

/** Asks main for folder access during a call; null when main could not be asked. Injected so the check is testable. */
export type AgentFolderAccessAsker = (request: AgentFolderAccessRequest) => Promise<AgentFolderAccessAnswer | null>;

export type AgentReadCheck = {
    projectPath: string;
    policy: AgentSessionPolicy;
    callId: string;
    ask: AgentFolderAccessAsker;
    caseInsensitive?: boolean;
};

/**
 * Make sure every path may be read for the agent, or refuse with `path_not_allowed`.
 *
 * Paths inside the project or an allowed folder pass at once. For the rest, main is asked: it puts
 * the folders to the author in the agent access window (or grants them at once under full access) and
 * answers which ones this window may now read. Anything still outside after that - declined, not
 * answered yet, or a folder Studio never opens - refuses the whole call, before a single file is
 * read, with a hint saying what the agent can do about it.
 */
export async function ensureAgentMayRead(paths: readonly string[], check: AgentReadCheck): Promise<void> {
    const relative = paths.filter(path => !isAbsolute(path));
    if (relative.length > 0) {
        throw refuse("path_not_allowed", `Paths must be absolute: ${relative.slice(0, 5).join(", ")}.`);
    }
    const outside = paths.filter(path => !findAllowedImportRoot(path, check.projectPath, check.policy.allowedImportRoots, check.caseInsensitive));
    if (outside.length === 0) {
        return;
    }
    const answer = await check.ask({ callId: check.callId, paths: outside }).catch(() => null);
    if (!answer) {
        throw refuse(
            "path_not_allowed",
            `${countPaths(outside.length)} outside the project and the folders the author allowed: ${outside.slice(0, 5).join(", ")}.`,
            "Studio could not ask the author for access. Ask them to add the folder under Agent access in Studio's settings, or copy the files into the project directory.",
        );
    }
    const blocked = outside.filter(path => !answer.granted.some(root => isPathInside(path, root, check.caseInsensitive)));
    if (blocked.length === 0) {
        return;
    }
    throw refuse(
        "path_not_allowed",
        [`${countPaths(blocked.length)} outside the project and the folders the author allowed: ${blocked.slice(0, 5).join(", ")}.`, ...agentFolderAccessGaps(answer)].join(" "),
        agentFolderAccessHint(answer) ?? "Copy the files into the project directory, or ask the author to allow their folder in Studio's settings.",
    );
}

function countPaths(count: number): string {
    return count === 1 ? "1 path is" : `${count} paths are`;
}
