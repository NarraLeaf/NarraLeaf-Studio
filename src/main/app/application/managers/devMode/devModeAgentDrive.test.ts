import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEV_MODE_AGENT_BUDGET_MS, DevModeAgentErrorCode, type DevModeAgentAction, type DevModeAgentResult } from "@shared/types/devMode";
import type { RequestStatus } from "@shared/types/ipcEvents";
import { DevModeAgentError, devModeAgentAnswerTimeoutMs, driveDevModeWindow, type DevModeAgentDriveTarget } from "./devModeAgentDrive";

/**
 * An agent's play-test action between main and the Dev Mode window (F14).
 *
 * The acceptance run lost six minutes to six screenshots that each waited the transport's full 60 s
 * and then said "Start the game with playtest_start first" about a game that was running. These pin
 * the replacement: the window is kept painting, every wait is the action's own and short, and what
 * comes back says which wait ran out.
 */

function target(overrides: Partial<DevModeAgentDriveTarget> = {}) {
    const calls = { keepPainting: 0, asked: [] as { action: DevModeAgentAction; timeoutMs: number }[] };
    const value: DevModeAgentDriveTarget = {
        ask: async (action, timeoutMs) => {
            calls.asked.push({ action, timeoutMs });
            return { success: true, data: { kind: "advance", advanced: 1 } };
        },
        capturePage: async () => "data:image/png;base64,WINDOW",
        keepPainting: () => {
            calls.keepPainting += 1;
        },
        isClosed: () => false,
        ...overrides,
    };
    return { value, calls };
}

const never = <T,>() => new Promise<T>(() => undefined);

describe("driveDevModeWindow", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("keeps the window painting before it asks anything", async () => {
        const { value, calls } = target();
        await driveDevModeWindow(value, { kind: "advance", steps: 1 });
        expect(calls.keepPainting).toBe(1);
    });

    it("gives a screenshot 15 s, not the 60 s that cost the acceptance run a minute a call", async () => {
        expect(devModeAgentAnswerTimeoutMs("capture")).toBe(15_000);
        const { value, calls } = target({ ask: () => never<RequestStatus<DevModeAgentResult>>() });
        const drive = driveDevModeWindow(value, { kind: "capture" });
        const assertion = expect(drive).rejects.toMatchObject({
            code: DevModeAgentErrorCode.noAnswer,
            message: expect.stringMatching(/open but did not answer the screenshot within 15 s/),
        });
        await vi.advanceTimersByTimeAsync(15_000);
        await assertion;
        expect(calls.keepPainting).toBe(1);
    });

    it("sets the transport's own timer later than its own, so its sentence is the one that arrives", async () => {
        const asked: number[] = [];
        const { value } = target({
            ask: async (_action, timeoutMs) => {
                asked.push(timeoutMs);
                return { success: true, data: { kind: "state", state: { ready: false, inGame: false, entries: 0, line: null, choices: null, page: null } } };
            },
        });
        await driveDevModeWindow(value, { kind: "state" });
        expect(asked).toEqual([devModeAgentAnswerTimeoutMs("state") + 1000]);
    });

    it("says the window closed, as not running, when it goes away mid-call", async () => {
        let closed = false;
        const { value } = target({
            ask: async () => {
                closed = true;
                throw new Error("Window closed before replying to IPC request: x");
            },
            isClosed: () => closed,
        });
        await expect(driveDevModeWindow(value, { kind: "capture" })).rejects.toMatchObject({
            code: DevModeAgentErrorCode.notRunning,
        });
    });

    it("carries the window's own refusal and its code through", async () => {
        const { value } = target({
            ask: async () => ({ success: false, error: "capture took too long", code: DevModeAgentErrorCode.captureTimeout }),
        });
        const error = await driveDevModeWindow(value, { kind: "capture" }).catch(caught => caught);
        expect(error).toBeInstanceOf(DevModeAgentError);
        expect(error).toMatchObject({ message: "capture took too long", code: DevModeAgentErrorCode.captureTimeout });
    });

    it("photographs the window when the game had no stage to capture, within the capture budget", async () => {
        const { value } = target({
            ask: async () => ({ success: true, data: { kind: "capture", png: "", source: "engine" } }),
        });
        await expect(driveDevModeWindow(value, { kind: "capture" })).resolves.toEqual({
            kind: "capture",
            png: "data:image/png;base64,WINDOW",
            source: "window",
        });

        const { value: hanging } = target({
            ask: async () => ({ success: true, data: { kind: "capture", png: "", source: "engine" } }),
            capturePage: () => never<string>(),
        });
        const drive = driveDevModeWindow(hanging, { kind: "capture" });
        const assertion = expect(drive).rejects.toMatchObject({ code: DevModeAgentErrorCode.captureTimeout });
        await vi.advanceTimersByTimeAsync(DEV_MODE_AGENT_BUDGET_MS.capture);
        await assertion;
    });
});
