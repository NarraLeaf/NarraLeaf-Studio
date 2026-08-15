// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RendererErrorReport } from "@shared/types/ipcEvents";

const reported: RendererErrorReport[] = [];

vi.mock("../bridge", () => ({
    getInterface: () => ({
        reportError: (report: RendererErrorReport) => {
            reported.push(report);
        },
    }),
}));

import {
    reportRendererError,
    resetCrashRecoveryForTests,
    runCrashRecoveryFlush,
    setCrashRecoveryFlush,
} from "./crashRecovery";

describe("reportRendererError", () => {
    beforeEach(() => {
        reported.length = 0;
        resetCrashRecoveryForTests();
        vi.spyOn(console, "error").mockImplementation(() => undefined);
    });

    it("flattens an error to a message and a stack", () => {
        const error = new TypeError("x is not a function");
        error.stack = "TypeError: x is not a function\n    at render (index.js:1:2)";

        reportRendererError({ source: "boundary", error, componentStack: "\n    in Panel" });

        expect(reported).toHaveLength(1);
        expect(reported[0]).toMatchObject({
            source: "boundary",
            label: null,
            message: "TypeError: x is not a function",
            componentStack: "\n    in Panel",
        });
        expect(reported[0].stack).toContain("at render");
    });

    it("reports something that is not an Error at all", () => {
        reportRendererError({ source: "rejection", error: "connection refused" });

        expect(reported[0]).toMatchObject({ message: "connection refused", stack: null });
    });

    it("collapses the same failure repeating", () => {
        // A render loop fails once per frame. Without this, one bug writes the log full.
        for (let index = 0; index < 10; index++) {
            reportRendererError({ source: "panel", label: "Assets", error: new Error("same") });
        }

        expect(reported).toHaveLength(1);
    });

    it("keeps reporting a different failure", () => {
        reportRendererError({ source: "panel", label: "Assets", error: new Error("first") });
        reportRendererError({ source: "panel", label: "Assets", error: new Error("second") });

        expect(reported).toHaveLength(2);
    });

    it("caps how much one window may send", () => {
        for (let index = 0; index < 80; index++) {
            reportRendererError({ source: "window", error: new Error(`failure ${index}`) });
        }

        expect(reported).toHaveLength(50);
    });
});

describe("runCrashRecoveryFlush", () => {
    beforeEach(() => {
        reported.length = 0;
        resetCrashRecoveryForTests();
        vi.spyOn(console, "error").mockImplementation(() => undefined);
    });

    it("says nothing was at risk when nobody registered a flush", async () => {
        await expect(runCrashRecoveryFlush()).resolves.toBe("none");
    });

    it("runs the registered flush", async () => {
        const flush = vi.fn(async () => undefined);
        setCrashRecoveryFlush(flush);

        await expect(runCrashRecoveryFlush()).resolves.toBe("saved");
        expect(flush).toHaveBeenCalledTimes(1);
    });

    it("gives up rather than leaving the crash screen unable to offer a reload", async () => {
        setCrashRecoveryFlush(() => new Promise(() => undefined));

        await expect(runCrashRecoveryFlush(10)).resolves.toBe("failed");
    });

    it("reports a failing flush instead of swallowing it", async () => {
        setCrashRecoveryFlush(async () => {
            throw new Error("disk is full");
        });

        await expect(runCrashRecoveryFlush()).resolves.toBe("failed");
        expect(reported[0]).toMatchObject({ label: "pending-save-flush" });
    });
});
