import fs from "fs";
import path from "path";

import { isVcsRemoteConfigured, parseVcsRemoteUrl } from "@shared/types/vcs";
import type { VcsLocalRepository } from "@shared/types/vcs";

/**
 * Which repository a project on this disk is a copy of, read without opening it.
 *
 * A server lists projects by repository id; the launcher has to say, for each of them,
 * whether this machine already holds it. Names cannot answer that - two projects share a
 * name as often as not, and a folder gets renamed the week after it is cloned - so the id
 * is the only thing worth comparing, and the id lives in `.lore/id`.
 *
 * **Nothing here opens a repository, and that is not a preference.** Lore's lock is
 * exclusive and BLOCKING: opening a store another process already holds does not fail, it
 * never returns - no error, no CPU - and every later call against that project queues
 * behind it for the life of the process. A sweep over the whole recent list is exactly the
 * shape of call that would take out every project an author has open. So this reads two
 * plain files and closes them.
 *
 * A project that cannot be read this way - no repository, an unreadable file, a half
 * written one - is reported with no id rather than left out. It is still a project the
 * author has, and saying so with nothing to match on is what keeps the caller from
 * guessing at a name instead.
 */

/** Lore's own marker directory, and the two files inside it worth reading. */
const REPOSITORY_DIRECTORY = ".lore";
const ID_FILE = "id";
const CONFIG_FILE = "config.toml";

/**
 * The id is a fixed-width binary value, not text.
 *
 * Measured against a repository Lore created: sixteen bytes, which is the same value the
 * backend hands back as thirty-two hex characters and the same spelling a server lists a
 * project under. Anything of another length is not this file, so it is read as nothing
 * rather than hexed into an id that would never match.
 */
const ID_BYTES = 16;

/** The `remote_url` line of a config, anchored the way `remote.ts` anchors it. */
const REMOTE_URL_LINE = /^[ \t]*remote_url[ \t]*=[ \t]*"([^"]*)"/m;

/** How much of a config is read before giving up on it being one. */
const MAX_CONFIG_BYTES = 64 * 1024;

/** The repository id in a project directory, or undefined because there is nothing to read. */
export function readRepositoryId(root: string): string | undefined {
    try {
        const bytes = fs.readFileSync(path.join(root, REPOSITORY_DIRECTORY, ID_FILE));
        if (bytes.length !== ID_BYTES) return undefined;
        return bytes.toString("hex");
    } catch {
        return undefined;
    }
}

/**
 * The server a project is configured against, as an origin.
 *
 * Read off the file rather than through the backend, for the reason this whole module
 * exists. `isVcsRemoteConfigured` is what decides whether the line names a server at all,
 * so both historical placeholders read as nothing here exactly as they do everywhere else.
 *
 * **The line holds either form.** Creating a repository stores only the origin (the
 * backend drops the path segment on the way in), while Studio's own `setRemote` writes the
 * whole `lore://host:port/name`. So the name is taken off when there is one and the rest
 * is the answer - which is the same origin either way, and the only part a session is
 * keyed on.
 */
export function readRemoteOrigin(root: string): string | undefined {
    let contents: string;
    try {
        const file = path.join(root, REPOSITORY_DIRECTORY, CONFIG_FILE);
        const handle = fs.openSync(file, "r");
        try {
            const buffer = Buffer.alloc(MAX_CONFIG_BYTES);
            const read = fs.readSync(handle, buffer, 0, MAX_CONFIG_BYTES, 0);
            contents = buffer.subarray(0, read).toString("utf-8");
        } finally {
            fs.closeSync(handle);
        }
    } catch {
        return undefined;
    }

    const line = REMOTE_URL_LINE.exec(contents);
    if (line === null || !isVcsRemoteConfigured(line[1])) return undefined;
    const url = line[1].trim();
    const named = parseVcsRemoteUrl(url);
    if (named !== null) return named.origin;
    return /^lore:\/\/[^/?#\s]+\/*$/i.test(url) ? url.replace(/\/+$/, "") : undefined;
}

/** One project, by the identity that survives being renamed and moved. */
export function readLocalRepository(project: { path: string; name: string }): VcsLocalRepository {
    const repositoryId = readRepositoryId(project.path);
    const remoteOrigin = readRemoteOrigin(project.path);
    return {
        path: project.path,
        name: project.name,
        ...(repositoryId === undefined ? {} : { repositoryId }),
        ...(remoteOrigin === undefined ? {} : { remoteOrigin }),
    };
}
