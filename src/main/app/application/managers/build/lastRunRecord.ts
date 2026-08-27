/**
 * The last run of a project's build pipeline, written down where the next session can find it.
 *
 * A build report is worth reading after the window that produced it has gone: an author comes back
 * the next morning to check what shipped, and a record held only in a running workspace answers
 * "no finished build" to exactly the person who wants one. So the pipeline records the run itself,
 * once, as it finishes.
 *
 * It lives under `.nlstudio`, beside the staging directories the build already writes there: local
 * to the machine, out of version control, and disposable - deleting it costs a report, never a
 * build. One record, not a history; the dashboard's own build activity is where a run joins a list.
 */

import fs from "fs/promises";
import path from "path";
import type { LastGameBuildRun } from "@shared/types/gameBuild";

/** Where the record sits inside a project. */
export function lastRunRecordPath(projectPath: string): string {
    return path.join(projectPath, ".nlstudio", "build", "last-run.json");
}

/**
 * Record what this run came to.
 *
 * Best effort by construction: a run that produced artifacts has done its job, and a report that
 * could not be written is not a reason to fail it. The caller is told nothing.
 */
export async function writeLastGameBuildRun(projectPath: string, run: LastGameBuildRun): Promise<void> {
    const target = lastRunRecordPath(projectPath);
    try {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, JSON.stringify(run), "utf-8");
    } catch {
        // A project whose staging directory cannot be written has already failed the build itself.
    }
}

/**
 * The recorded run, or null when there is none to read.
 *
 * Anything unreadable reads as "no run": a truncated or hand-edited file describes no build, and a
 * report is not the place to raise it.
 */
export async function readLastGameBuildRun(projectPath: string): Promise<LastGameBuildRun | null> {
    let raw: string;
    try {
        raw = await fs.readFile(lastRunRecordPath(projectPath), "utf-8");
    } catch {
        return null;
    }
    try {
        const parsed = JSON.parse(raw) as Partial<LastGameBuildRun>;
        if (!parsed || typeof parsed !== "object" || !parsed.state || typeof parsed.state !== "object") {
            return null;
        }
        return {
            kind: parsed.kind === "patch" ? "patch" : "build",
            ...(typeof parsed.appTagId === "string" && parsed.appTagId.trim()
                ? { appTagId: parsed.appTagId.trim() }
                : {}),
            appTagName: typeof parsed.appTagName === "string" && parsed.appTagName.trim()
                ? parsed.appTagName.trim()
                : "",
            cancelled: parsed.cancelled === true,
            state: parsed.state,
        };
    } catch {
        return null;
    }
}
