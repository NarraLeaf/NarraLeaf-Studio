import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LastGameBuildRun } from "@shared/types/gameBuild";
import { lastRunRecordPath, readLastGameBuildRun, writeLastGameBuildRun } from "./lastRunRecord";

let projectPath: string;

beforeEach(async () => {
    projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "nls-lastrun-"));
});

afterEach(async () => {
    await fs.rm(projectPath, { recursive: true, force: true });
});

const RUN: LastGameBuildRun = {
    kind: "build",
    appTagId: "demo",
    appTagName: "Demo",
    cancelled: false,
    state: {
        status: "done",
        startedAt: 1,
        finishedAt: 2,
        platforms: ["windows"],
        artifacts: ["D:/out/game.exe"],
        outputDir: "D:/out",
    },
};

describe("the last build run record", () => {
    it("has nothing to answer for a project that was never built", async () => {
        expect(await readLastGameBuildRun(projectPath)).toBeNull();
    });

    it("reads back what was written", async () => {
        await writeLastGameBuildRun(projectPath, RUN);

        expect(await readLastGameBuildRun(projectPath)).toEqual(RUN);
    });

    it("keeps one record, not a history", async () => {
        await writeLastGameBuildRun(projectPath, RUN);
        await writeLastGameBuildRun(projectPath, { ...RUN, kind: "patch", appTagName: "main", appTagId: undefined });

        const read = await readLastGameBuildRun(projectPath);
        expect(read?.kind).toBe("patch");
        expect(read).not.toHaveProperty("appTagId");
    });

    it("reads a file it cannot make sense of as no run at all", async () => {
        // A truncated or hand-edited record describes no build, and the report is not the place to
        // raise it - the alternative is a dashboard that reports a parse error where a build goes.
        const target = lastRunRecordPath(projectPath);
        await fs.mkdir(path.dirname(target), { recursive: true });
        for (const content of ["", "{", "null", "[]", JSON.stringify({ kind: "build" })]) {
            await fs.writeFile(target, content, "utf-8");
            expect(await readLastGameBuildRun(projectPath)).toBeNull();
        }
    });

    it("does not throw when the project cannot be written to", async () => {
        // Writing the record is the last thing a finished run does, and a run that produced
        // artifacts has done its job: a report that could not be saved must not fail it.
        await expect(writeLastGameBuildRun(path.join(projectPath, "nul\0"), RUN)).resolves.toBeUndefined();
    });
});
