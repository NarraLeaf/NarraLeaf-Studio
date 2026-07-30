import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameRuntimeLaunchEntry } from "@shared/types/gameRuntime";
import { forgetWorkspaceFreeze, reportWorkspaceFreeze } from "../../utils/workspaceFreeze";
import { formatPreviewProcessOutput, PreviewManager, resolvePreviewRunnerBinaryForApp } from "./PreviewManager";

// The freeze refusal reports itself on the workspace console; keep it away from the window plumbing.
vi.mock("../../utils/workspaceConsole", () => ({
    emitWorkspaceConsoleLog: () => undefined,
}));

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

describe("PreviewManager.launch while the workspace is frozen", () => {
    // Enough app for the guard and for launchNow to fail on its own terms; see below.
    const makeManager = () => new PreviewManager({
        logger: { error: () => undefined },
    } as unknown as ConstructorParameters<typeof PreviewManager>[0]);
    const entry = { kind: "surface", surfaceId: "main" } as GameRuntimeLaunchEntry;
    const projectPath = path.join("/nonexistent", "frozen-preview-project");

    afterEach(() => {
        forgetWorkspaceFreeze(projectPath);
    });

    it("refuses, telling the author how to get out of the freeze", async () => {
        // RunControl already disables Preview while frozen; this is the same refusal for the callers
        // a disabled button does not reach. Rejects rather than answering a status, so a plugin or a
        // keybinding is told why.
        reportWorkspaceFreeze(projectPath, "revision");

        await expect(makeManager().launch(projectPath, entry)).rejects.toThrow(/Leave the revision/);
    });

    it("refuses a hand-frozen workspace with the remedy that fits it", async () => {
        reportWorkspaceFreeze(projectPath, "manual");

        await expect(makeManager().launch(projectPath, entry)).rejects.toThrow(/Unfreeze the workspace/);
    });

    it("launches again once the workspace is thawed", async () => {
        reportWorkspaceFreeze(projectPath, "revision");
        reportWorkspaceFreeze(projectPath, null);

        // Past the guard, launchNow runs and then fails on this test double's missing plugin
        // manager - which it reports as a status rather than a rejection. That difference is the
        // assertion: refused rejects, allowed resolves.
        await expect(makeManager().launch(projectPath, entry)).resolves.toBe("error");
    });
});
