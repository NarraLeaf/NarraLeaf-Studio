/**
 * Writing a screenshot, in the one place both main processes write one.
 *
 * Comments in English per project convention.
 */
import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { blueprintScreenshotFileName } from "../types/blueprint/screenshot";
import { openScreenshotsFolder, writeScreenshotFile } from "./screenshotFile";

const created: string[] = [];

async function tempRoot(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-screenshot-"));
    created.push(dir);
    return dir;
}

afterEach(async () => {
    while (created.length > 0) {
        await fs.rm(created.pop()!, { recursive: true, force: true });
    }
});

describe("writeScreenshotFile", () => {
    it("creates the folder and writes the captured bytes, and says where", async () => {
        const root = await tempRoot();
        const directory = path.join(root, "screenshots");
        const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);

        const result = await writeScreenshotFile({
            directory,
            capture: async () => bytes,
            now: () => new Date(2026, 8, 2, 13, 45, 1, 7),
        });

        expect(result.outcome).toBe("saved");
        expect(result.error).toBeNull();
        expect(result.path).toBe(path.join(directory, "screenshot-20260902-134501-007.png"));
        expect(new Uint8Array(await fs.readFile(result.path!))).toEqual(bytes);
    });

    it("reports a capture that came back empty rather than writing a picture of nothing", async () => {
        const root = await tempRoot();
        const result = await writeScreenshotFile({
            directory: path.join(root, "screenshots"),
            capture: async () => new Uint8Array(0),
        });

        expect(result.outcome).toBe("failed");
        expect(result.path).toBeNull();
        expect(result.error).toBeTruthy();
        // Nothing was created either: a folder appearing on a failure is a folder nobody explained.
        await expect(fs.readdir(path.join(root, "screenshots"))).rejects.toThrow();
    });

    it("keeps both captures when they have the same timestamp", async () => {
        const root = await tempRoot();
        const directory = path.join(root, "screenshots");
        const now = () => new Date(2026, 8, 2, 13, 45, 1, 7);
        const results = await Promise.all([
            writeScreenshotFile({ directory, now, capture: async () => Uint8Array.of(1) }),
            writeScreenshotFile({ directory, now, capture: async () => Uint8Array.of(2) }),
        ]);
        expect(results.map(result => result.outcome)).toEqual(["saved", "saved"]);
        expect(results[0].path).not.toBe(results[1].path);
        expect(await fs.readFile(results[0].path!)).toEqual(Buffer.from([1]));
        expect(await fs.readFile(results[1].path!)).toEqual(Buffer.from([2]));
    });

    it("keeps an existing screenshot with the same name", async () => {
        const root = await tempRoot();
        const directory = path.join(root, "screenshots");
        const now = () => new Date(2026, 8, 2, 13, 45, 1, 7);
        await fs.mkdir(directory);
        const existing = path.join(directory, blueprintScreenshotFileName(now()));
        await fs.writeFile(existing, "existing");

        const result = await writeScreenshotFile({ directory, now, capture: async () => Uint8Array.of(7) });

        expect(result.outcome).toBe("saved");
        expect(result.path).not.toBe(existing);
        expect(await fs.readFile(existing, "utf-8")).toBe("existing");
        expect(await fs.readFile(result.path!)).toEqual(Buffer.from([7]));
    });

    it("reports a capture that threw as a failure the graph can branch on", async () => {
        const root = await tempRoot();
        const result = await writeScreenshotFile({
            directory: path.join(root, "screenshots"),
            capture: async () => {
                throw new Error("the window is gone");
            },
        });

        expect(result).toEqual({ outcome: "failed", path: null, error: "the window is gone" });
    });
});

describe("openScreenshotsFolder", () => {
    it("makes the folder before opening it, so a player who has taken none still gets a window", async () => {
        const root = await tempRoot();
        const directory = path.join(root, "screenshots");
        const opened: string[] = [];

        const result = await openScreenshotsFolder({
            directory,
            openPath: async target => {
                opened.push(target);
                return "";
            },
        });

        expect(result).toEqual({ outcome: "opened", path: directory, error: null });
        expect(opened).toEqual([directory]);
        expect((await fs.stat(directory)).isDirectory()).toBe(true);
    });

    it("passes on what the platform said when it would not open", async () => {
        const root = await tempRoot();
        const result = await openScreenshotsFolder({
            directory: path.join(root, "screenshots"),
            openPath: async () => "no file manager",
        });

        expect(result).toEqual({ outcome: "failed", path: null, error: "no file manager" });
    });
});

describe("blueprintScreenshotFileName", () => {
    it("names two captures in the same second apart", () => {
        const first = blueprintScreenshotFileName(new Date(2026, 0, 1, 0, 0, 0, 1));
        const second = blueprintScreenshotFileName(new Date(2026, 0, 1, 0, 0, 0, 2));
        expect(first).not.toBe(second);
        expect(first).toBe("screenshot-20260101-000000-001.png");
    });
});
