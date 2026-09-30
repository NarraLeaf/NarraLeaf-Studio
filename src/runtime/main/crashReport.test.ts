import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    CRASH_REPORT_FILE_NAME,
    crashReportPath,
    formatCrashReport,
    readLogTail,
    redactHomeDirectory,
    writeCrashReport,
    type CrashReportBuild,
    type CrashReportInput,
} from "./crashReport";
import { runtimeLogPath } from "./runtimeLog";

const build: CrashReportBuild = {
    gameName: "Tiny Shadows",
    gameVersion: "1.2.0",
    studioVersion: "0.9.4",
    engineVersion: "0.6.1",
    mode: "production",
    builtAt: "2026-09-01T08:00:00.000Z",
    projectRevision: { id: "4f2a91c", number: 12 },
};

function input(overrides: Partial<CrashReportInput> = {}): CrashReportInput {
    return {
        at: new Date(Date.UTC(2026, 8, 4, 10, 0, 0)),
        request: { details: "TypeError: boom\n    at play", language: "ja", story: null },
        build,
        machine: {
            platform: "win32",
            arch: "x64",
            osRelease: "10.0.26200",
            electron: "38.8.6",
            chrome: "140.0.0.0",
        },
        log: null,
        homeDirectory: "C:\\Users\\player",
        ...overrides,
    };
}

describe("formatCrashReport", () => {
    it("states the build the player is holding, which is what makes the log readable", () => {
        const report = formatCrashReport(input());

        expect(report).toContain("Tiny Shadows 1.2.0");
        expect(report).toContain("0.9.4");
        expect(report).toContain("0.6.1");
        expect(report).toContain("production");
        expect(report).toContain("4f2a91c (#12)");
        expect(report).toContain("win32 x64, 10.0.26200");
        expect(report).toContain("Electron 38.8.6, Chromium 140.0.0.0");
        expect(report).toContain("TypeError: boom");
    });

    it("says the build does not state a thing rather than inventing one", () => {
        // Every field of the pack is absent before anything has read it - which is exactly the
        // failure most likely to be reported.
        const report = formatCrashReport(input({ build: null }));

        expect(report).toMatch(/^Game +not stated$/m);
        expect(report).toMatch(/^Studio +not stated$/m);
        expect(report).not.toContain("undefined");
    });

    it("names where the story had got to, by the names an author wrote", () => {
        const report = formatCrashReport(input({
            request: {
                details: "boom",
                language: "en",
                story: { storyName: "Chapter One", sceneName: "The corridor", rowId: "block-7" },
            },
        }));

        expect(report).toContain("Chapter One");
        expect(report).toContain("The corridor");
        expect(report).toContain("block-7");
    });

    it("says nothing was running rather than leaving the reader to guess", () => {
        const report = formatCrashReport(input());

        expect(report).toContain("nothing was running");
        expect(report).not.toContain("Scene ");
    });

    it("carries the log and says how much of it was left behind", () => {
        const report = formatCrashReport(input({
            log: { path: "C:\\Users\\player\\logs\\game.log", text: "a line", bytes: 6, totalBytes: 4000 },
        }));

        expect(report).toContain("last 6 of 4000 bytes");
        expect(report).toContain("a line");
    });

    it("replaces the player's home directory everywhere it appears", () => {
        // The account name is in the log path, in a per-user install's stack frames, and in
        // whatever the engine happened to print. None of it is about the crash.
        const report = formatCrashReport(input({
            request: {
                details: "Error: ENOENT c:/users/PLAYER/AppData/game/pack.json",
                language: "en",
                story: null,
            },
            log: {
                path: "C:\\Users\\player\\AppData\\logs\\game.log",
                text: "read C:\\Users\\Player\\AppData\\saves\\1.json",
                bytes: 1,
                totalBytes: 1,
            },
        }));

        expect(report).not.toMatch(/player/i);
        expect(report).toContain("~/AppData/game/pack.json");
        expect(report).toContain("~\\AppData\\logs\\game.log");
    });

    it("says so plainly when there was no log to read", () => {
        expect(formatCrashReport(input())).toContain("The log could not be read.");
    });
});

describe("redactHomeDirectory", () => {
    it("leaves text alone when the platform reports no home directory", () => {
        expect(redactHomeDirectory("C:\\Users\\player", "")).toBe("C:\\Users\\player");
    });

    it("matches a trailing separator, either slash, and either case", () => {
        expect(redactHomeDirectory("/home/Ana/x /home/ana/y", "/home/ana/")).toBe("~/x ~/y");
    });
});

describe("readLogTail", () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "nls-crash-report-"));
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("takes the end of the file, which is where the crash is", () => {
        const filePath = path.join(dir, "game.log");
        fs.writeFileSync(filePath, "0123456789", "utf-8");

        const tail = readLogTail(filePath, 4);

        expect(tail).toEqual({ path: filePath, text: "6789", bytes: 4, totalBytes: 10 });
    });

    it("never opens the tail with half a character", () => {
        // A byte offset lands anywhere, and a Japanese log cut mid-sequence would begin with
        // replacement characters an author would read as corruption.
        const filePath = path.join(dir, "game.log");
        fs.writeFileSync(filePath, "あいう", "utf-8");

        const tail = readLogTail(filePath, 4);

        expect(tail?.text).toBe("う");
    });

    it("answers null rather than throwing when there is no log yet", () => {
        expect(readLogTail(path.join(dir, "missing.log"), 100)).toBeNull();
    });
});

describe("writeCrashReport", () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "nls-crash-write-"));
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const request = { details: "boom", language: "en", story: null };
    const machine = {
        platform: "win32",
        arch: "x64",
        osRelease: "10.0.26200",
        electron: "38.8.6",
        chrome: "140.0.0.0",
    };

    it("writes one file beside the log and shows it to the player", () => {
        const logFile = runtimeLogPath(dir);
        fs.mkdirSync(path.dirname(logFile), { recursive: true });
        fs.writeFileSync(logFile, "[INFO ] the game started\n", "utf-8");
        const revealed: string[] = [];

        const result = writeCrashReport({
            userDataDir: dir,
            request,
            build,
            machine,
            homeDirectory: "C:\\Users\\player",
            reveal: filePath => revealed.push(filePath),
        });

        expect(result).toEqual({ outcome: "written", path: crashReportPath(dir) });
        expect(revealed).toEqual([crashReportPath(dir)]);
        expect(path.basename(crashReportPath(dir))).toBe(CRASH_REPORT_FILE_NAME);
        expect(path.dirname(crashReportPath(dir))).toBe(path.dirname(logFile));
        const written = fs.readFileSync(crashReportPath(dir), "utf-8");
        expect(written).toContain("the game started");
        expect(written).toContain("Tiny Shadows 1.2.0");
    });

    it("overwrites rather than accumulating, so there is never a file to choose between", () => {
        writeCrashReport({ userDataDir: dir, request, build, machine, homeDirectory: "" });
        writeCrashReport({
            userDataDir: dir,
            request: { ...request, details: "the second one" },
            build,
            machine,
            homeDirectory: "",
        });

        expect(fs.readdirSync(path.dirname(crashReportPath(dir)))).toEqual([CRASH_REPORT_FILE_NAME]);
        expect(fs.readFileSync(crashReportPath(dir), "utf-8")).toContain("the second one");
    });

    it("reports a write it could not make instead of throwing at the crash screen", () => {
        // Something already occupies the name. The screen has to keep its copy button and its log
        // path whatever this answers, so the failure comes back as a value.
        fs.mkdirSync(crashReportPath(dir), { recursive: true });

        const result = writeCrashReport({ userDataDir: dir, request, build, machine, homeDirectory: "" });

        expect(result.outcome).toBe("failed");
        expect(result.outcome === "failed" && result.error.length > 0).toBe(true);
    });

    it("still writes when the file manager refuses to open", () => {
        const result = writeCrashReport({
            userDataDir: dir,
            request,
            build,
            machine,
            homeDirectory: "",
            reveal: () => { throw new Error("no file manager here"); },
        });

        expect(result.outcome).toBe("written");
        expect(fs.existsSync(crashReportPath(dir))).toBe(true);
    });

    it("writes a report about a crash that happened before the pack was read", () => {
        const result = writeCrashReport({ userDataDir: dir, request, build: null, machine, homeDirectory: "" });

        expect(result.outcome).toBe("written");
        expect(fs.readFileSync(crashReportPath(dir), "utf-8")).toContain("not stated");
    });
});
