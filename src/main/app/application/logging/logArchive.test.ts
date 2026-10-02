import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseZipIndex, readEntryBytes } from "../../../buildWorker/mobile/zipModel";
import type { DiagnosticsEnvironment } from "./diagnosticsBundle";
import {
    collectLogArchiveFiles,
    encodeLogArchive,
    sanitizeRendererFileName,
    type LogArchiveSources,
} from "./logArchive";

const ENVIRONMENT: DiagnosticsEnvironment = {
    appVersion: "1.2.3",
    electronVersion: "38.0.0",
    chromeVersion: "140.0.0.0",
    nodeVersion: "22.0.0",
    platform: "win32",
    osRelease: "10.0.26200",
    arch: "x64",
    packaged: true,
    locale: "zh",
    userDataDir: "C:\\Users\\author\\AppData\\Roaming\\NarraLeaf Studio",
    logsDir: "C:\\Users\\author\\AppData\\Roaming\\NarraLeaf Studio\\logs",
    generatedAt: "2026-10-02T09:00:00.000Z",
};

let root: string;

beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nls-log-archive-"));
});

afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
});

function sources(overrides: Partial<LogArchiveSources> = {}): LogArchiveSources {
    return {
        logsDir: path.join(root, "logs"),
        projectPath: null,
        environment: ENVIRONMENT,
        rendererFiles: [],
        ...overrides,
    };
}

async function write(relative: string, content: string): Promise<void> {
    const target = path.join(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
}

describe("sanitizeRendererFileName", () => {
    it("keeps a plain log name", () => {
        expect(sanitizeRendererFileName("console-build.log")).toBe("console-build.log");
    });

    it("drops any directory and any traversal", () => {
        expect(sanitizeRendererFileName("../../studio/main.log")).toBe("main.log");
        expect(sanitizeRendererFileName("C:\\Windows\\evil.txt")).toBe("evil.txt");
        expect(sanitizeRendererFileName("..")).toBeNull();
    });

    it("replaces characters outside the safe set and adds an extension", () => {
        expect(sanitizeRendererFileName("console:plugin.example/x")).toBe("x.log");
        expect(sanitizeRendererFileName("console plugin:example")).toBe("console-plugin-example.log");
    });
});

describe("collectLogArchiveFiles", () => {
    it("takes every file in the log folder, the renderer's files, and the project's run logs", async () => {
        await write("logs/main.log", "now\n");
        await write("logs/main.1.log", "before\n");
        await write("project/.nlstudio/preview/userData/logs/game.log", "preview run\n");
        await write("project/.nlstudio/build/last-run.json", "{\"ok\":true}");

        const files = await collectLogArchiveFiles(sources({
            projectPath: path.join(root, "project"),
            rendererFiles: [{ name: "console-build.log", content: "built\n" }],
        }));
        const names = files.map(file => file.name);

        expect(names[0]).toBe("environment.txt");
        expect(names).toEqual(expect.arrayContaining([
            "studio/main.log",
            "studio/main.1.log",
            "workspace/console-build.log",
            "project/preview/game.log",
            "project/build/last-run.json",
        ]));
        expect(files.find(file => file.name === "studio/main.log")?.data.toString("utf8")).toBe("now\n");

        const environment = files[0].data.toString("utf8");
        expect(environment).toContain("Studio: 1.2.3");
        expect(environment).toContain("studio/main.log");
        // The test run never happened, so its folder is reported rather than silently skipped.
        expect(environment).toContain(path.join(root, "project", ".nlstudio", "test", "userData", "logs"));
    });

    it("reads no project files for a window without a project", async () => {
        await write("project/.nlstudio/preview/userData/logs/game.log", "preview run\n");

        const files = await collectLogArchiveFiles(sources());

        expect(files.some(file => file.name.startsWith("project/"))).toBe(false);
    });

    it("still produces an archive when the log folder does not exist", async () => {
        const files = await collectLogArchiveFiles(sources({ logsDir: path.join(root, "missing") }));

        expect(files.map(file => file.name)).toEqual(["environment.txt"]);
        expect(files[0].data.toString("utf8")).toContain("not present");
    });

    it("gives colliding renderer names distinct entries", async () => {
        const files = await collectLogArchiveFiles(sources({
            rendererFiles: [
                { name: "a/console.log", content: "one" },
                { name: "b/console.log", content: "two" },
            ],
        }));

        expect(files.map(file => file.name)).toEqual([
            "environment.txt",
            "workspace/console.log",
            "workspace/console-2.log",
        ]);
    });
});

describe("encodeLogArchive", () => {
    it("writes a zip whose entries read back unchanged", async () => {
        const archive = await encodeLogArchive([
            { name: "environment.txt", data: Buffer.from("header\n") },
            { name: "studio/main.log", data: Buffer.from("line\n".repeat(1000)) },
        ], new Date("2026-10-02T09:00:00Z"));

        const index = parseZipIndex(archive);
        expect(index.entries.map(entry => entry.name)).toEqual(["environment.txt", "studio/main.log"]);
        const log = index.entries.find(entry => entry.name === "studio/main.log")!;
        expect(readEntryBytes(archive, log).toString("utf8")).toBe("line\n".repeat(1000));
    });
});
