import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatPreviewProcessOutput, resolvePreviewRunnerBinaryForApp } from "./PreviewManager";

let tempDir = "";

describe("resolvePreviewRunnerBinaryForApp", () => {
    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-preview-runner-"));
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("uses the current Electron executable in development instead of require(\"electron\")", () => {
        const app = {
            isPackaged: () => false,
            resolveResource: (relativePath: string) => path.join(tempDir, relativePath),
        };

        expect(resolvePreviewRunnerBinaryForApp(app, "/Applications/Electron.app/Contents/MacOS/Electron"))
            .toBe("/Applications/Electron.app/Contents/MacOS/Electron");
    });

    it("resolves the embedded preview runner in packaged builds", async () => {
        const runnerDist = path.join(tempDir, "preview-runner", "dist");
        const binary = process.platform === "darwin"
            ? path.join(runnerDist, "Electron.app", "Contents", "MacOS", "Electron")
            : process.platform === "win32"
              ? path.join(runnerDist, "electron.exe")
              : path.join(runnerDist, "electron");
        await fs.mkdir(path.dirname(binary), { recursive: true });
        await fs.writeFile(binary, "", "utf-8");
        const app = {
            isPackaged: () => true,
            resolveResource: (relativePath: string) => path.join(tempDir, relativePath),
        };

        expect(resolvePreviewRunnerBinaryForApp(app)).toBe(binary);
    });
});

describe("formatPreviewProcessOutput", () => {
    it("preserves multiline output as a single message", () => {
        expect(formatPreviewProcessOutput(Buffer.from("first\nsecond\nthird\n")))
            .toBe("first\nsecond\nthird");
    });

    it("normalizes CRLF output while preserving indentation and blank lines", () => {
        expect(formatPreviewProcessOutput(Buffer.from("\r\nError:\r\n  at file.ts:1\r\n\r\n  at file.ts:2\r\n")))
            .toBe("Error:\n  at file.ts:1\n\n  at file.ts:2");
    });

    it("skips whitespace-only output", () => {
        expect(formatPreviewProcessOutput(Buffer.from("\n  \r\n"))).toBeNull();
    });
});
