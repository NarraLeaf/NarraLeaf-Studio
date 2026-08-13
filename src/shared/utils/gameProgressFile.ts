/**
 * Reading and writing the progress document on disk.
 *
 * Split from `@shared/types/gameProgress` because that half is the shape and travels everywhere,
 * renderer included, while this half imports Node. Only processes that own a filesystem reach for
 * it: Studio's main process (Dev Mode) and the packaged game's main process. The web export
 * imports neither and refuses instead - see `runtime/web/webProgress.ts`.
 *
 * Everything environmental arrives in {@link GameProgressEnvironment} rather than being read from
 * `process` or from Electron, for the reason `runtime/main/userDataDir.ts` does the same: the
 * decision for all three platforms can then be exercised from any one of them.
 *
 * Comments in English per project convention.
 */

import fs from "fs/promises";
import path from "path";
import {
    GAME_PROGRESS_DIRECTORY_SEGMENTS,
    buildGameProgressDocument,
    gameProgressFileName,
    normalizeGameProgressDocument,
    type GameProgressExportRequest,
    type GameProgressExportResult,
    type GameProgressImportResult,
} from "../types/gameProgress";

export type GameProgressEnvironment = {
    platform: NodeJS.Platform;
    /** `app.getPath("appData")`: roaming app data on Windows, Application Support on macOS. */
    appDataDir: string;
    homeDir: string;
    /** `process.env.XDG_DATA_HOME`, unresolved. */
    xdgDataHome?: string;
};

/**
 * The directory both editions of a title write into.
 *
 * The same platform rules `shared/utils/userDataLocation.ts` describes and `runtime/main/
 * userDataDir.ts` implements, including the XDG one: a relative `XDG_DATA_HOME` is to be ignored
 * per the specification rather than resolved against the working directory, which for a game
 * launched from a shortcut would be somewhere nobody could name.
 */
export function resolveGameProgressDirectory(env: GameProgressEnvironment): string {
    const root = env.platform === "linux"
        ? linuxDataRoot(env)
        : env.appDataDir;
    return path.join(root, ...GAME_PROGRESS_DIRECTORY_SEGMENTS);
}

function linuxDataRoot(env: GameProgressEnvironment): string {
    const configured = env.xdgDataHome?.trim();
    return configured && path.isAbsolute(configured)
        ? configured
        : path.join(env.homeDir, ".local", "share");
}

/** The one path a title's two editions agree on. */
export function resolveGameProgressFilePath(env: GameProgressEnvironment, progressKey: string): string {
    return path.join(resolveGameProgressDirectory(env), gameProgressFileName(progressKey));
}

/**
 * Write the document for `progressKey`, replacing whatever was there.
 *
 * Replacing rather than merging: the running game states the whole of what it has, and a merge
 * would leave a variable the player has since cleared standing in the file forever.
 *
 * Never throws. Every failure comes back as `failed` with the reason, because the caller is a
 * blueprint node whose author wired an exec pin for exactly this and cannot catch an exception.
 */
export async function writeGameProgressFile(
    env: GameProgressEnvironment,
    progressKey: string,
    request: GameProgressExportRequest,
    now: string = new Date().toISOString(),
): Promise<GameProgressExportResult> {
    const key = progressKey.trim();
    if (!key) {
        return { outcome: "failed", error: "This build carries no progress key." };
    }
    const filePath = resolveGameProgressFilePath(env, key);
    try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        const document = buildGameProgressDocument(key, request, now);
        // Two spaces: the file is an interchange document that a player or a support desk may open,
        // and it is small enough that legibility costs nothing worth counting.
        await fs.writeFile(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf-8");
        return { outcome: "written", error: null };
    } catch (error) {
        return { outcome: "failed", error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * Read the document for `progressKey`.
 *
 * Three answers, and the difference between the first two is the whole point: a file that is not
 * there is `missing`, which is the ordinary state of a player who never exported, while a file that
 * will not parse is `failed`. An author's graph answers those differently - one starts a new game,
 * the other says something went wrong - so folding them together would make the honest case look
 * like a fault.
 *
 * A document naming another title is `failed` rather than `found`: it is a real file with a real
 * problem, and silently applying another game's variables is the one outcome this must not produce.
 * A blank key in the file is tolerated - only a key that disagrees is refused - so a document
 * written by a build that could not name itself is still readable.
 */
export async function readGameProgressFile(
    env: GameProgressEnvironment,
    progressKey: string,
): Promise<GameProgressImportResult> {
    const key = progressKey.trim();
    if (!key) {
        return { outcome: "failed", document: null, error: "This build carries no progress key." };
    }
    const filePath = resolveGameProgressFilePath(env, key);
    let raw: string;
    try {
        raw = await fs.readFile(filePath, "utf-8");
    } catch (error) {
        if (error && typeof error === "object" && (error as { code?: string }).code === "ENOENT") {
            return { outcome: "missing", document: null, error: null };
        }
        return {
            outcome: "failed",
            document: null,
            error: error instanceof Error ? error.message : String(error),
        };
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        return {
            outcome: "failed",
            document: null,
            error: `The progress file could not be read: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
    const document = normalizeGameProgressDocument(parsed);
    if (!document) {
        return {
            outcome: "failed",
            document: null,
            error: "The progress file was written by a newer version of this game.",
        };
    }
    if (document.progressKey && document.progressKey !== key) {
        return {
            outcome: "failed",
            document: null,
            error: "The progress file belongs to a different game.",
        };
    }
    return { outcome: "found", document, error: null };
}
