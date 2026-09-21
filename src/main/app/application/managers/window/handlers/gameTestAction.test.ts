import { describe, expect, it, vi } from "vitest";
import { WINDOW_PROJECT_MISMATCH_CODE } from "@shared/types/window";

vi.mock("electron", () => ({}));

const { GameTestLaunchHandler, GameTestSendCommandHandler, GameTestStopHandler } = await import("./gameTestAction");

type AppWindowLike = Parameters<InstanceType<typeof GameTestLaunchHandler>["handle"]>[0];

function makeWindow(projectPath?: string) {
    const launch = vi.fn(async () => ({ ok: true, sessionId: "s1" }));
    const window = {
        getProps: () => ({ projectPath }),
        getApp: () => ({ getGameTestManager: () => ({ launch }) }),
    } as unknown as AppWindowLike;
    return { window, launch };
}

const MINE = "D:/games/mine";
const THEIRS = "D:/games/theirs";

/**
 * A test run starts the same game process a preview does, and is judged the same way: the project
 * is the window's own, and the rest of the request travels through untouched.
 */
describe("GameTestLaunchHandler", () => {
    it("launches the window's own project, keeping the rest of the request", async () => {
        const { window, launch } = makeWindow(MINE);

        const result = await new GameTestLaunchHandler().handle(window, {
            projectPath: MINE,
            runId: "run-1",
            network: "blocked",
        });

        expect(result.success).toBe(true);
        expect(launch).toHaveBeenCalledWith({ projectPath: MINE, runId: "run-1", network: "blocked" });
    });

    it("refuses a project this window does not have open", async () => {
        const { window, launch } = makeWindow(MINE);

        const result = await new GameTestLaunchHandler().handle(window, { projectPath: THEIRS, runId: "run-1" });

        expect(result.success).toBe(false);
        expect(result.code).toBe(WINDOW_PROJECT_MISMATCH_CODE);
        expect(launch).not.toHaveBeenCalled();
    });
});

/**
 * The two calls that reach a session once it is running. Main checks the session id as well, but an
 * id is a thing a renderer can learn, and which project's session is being steered is not the
 * caller's choice any more than which project is launched.
 */
describe("the calls into a running test session", () => {
    function makeSessionWindow(projectPath?: string) {
        const sendCommand = vi.fn((_projectPath: string, _sessionId: string, _command: unknown) => true);
        const stop = vi.fn(async (_projectPath: string, _sessionId: string) => undefined);
        const window = {
            getProps: () => ({ projectPath }),
            getApp: () => ({ getGameTestManager: () => ({ sendCommand, stop }) }),
        } as unknown as AppWindowLike;
        return { window, sendCommand, stop };
    }

    const command = { kind: "advance" } as never;

    it("steers and stops the window's own project's session", async () => {
        const { window, sendCommand, stop } = makeSessionWindow(MINE);

        await expect(new GameTestSendCommandHandler().handle(window, { projectPath: MINE, sessionId: "s1", command }))
            .resolves.toMatchObject({ success: true, data: { delivered: true } });
        await expect(new GameTestStopHandler().handle(window, { projectPath: MINE, sessionId: "s1" }))
            .resolves.toMatchObject({ success: true });
        expect(sendCommand.mock.calls[0][0]).toBe(MINE);
        expect(stop.mock.calls[0][0]).toBe(MINE);
    });

    it("refuses a project this window does not have open, and reaches no session", async () => {
        const { window, sendCommand, stop } = makeSessionWindow(MINE);

        await expect(new GameTestSendCommandHandler().handle(window, { projectPath: THEIRS, sessionId: "s1", command }))
            .resolves.toMatchObject({ success: false, code: WINDOW_PROJECT_MISMATCH_CODE });
        await expect(new GameTestStopHandler().handle(window, { projectPath: THEIRS, sessionId: "s1" }))
            .resolves.toMatchObject({ success: false, code: WINDOW_PROJECT_MISMATCH_CODE });
        expect(sendCommand).not.toHaveBeenCalled();
        expect(stop).not.toHaveBeenCalled();
    });

    it("refuses a window that has no project open", async () => {
        const { window, sendCommand, stop } = makeSessionWindow();

        await expect(new GameTestSendCommandHandler().handle(window, { projectPath: MINE, sessionId: "s1", command }))
            .resolves.toMatchObject({ code: WINDOW_PROJECT_MISMATCH_CODE });
        await expect(new GameTestStopHandler().handle(window, { projectPath: MINE, sessionId: "s1" }))
            .resolves.toMatchObject({ code: WINDOW_PROJECT_MISMATCH_CODE });
        expect(sendCommand).not.toHaveBeenCalled();
        expect(stop).not.toHaveBeenCalled();
    });
});
