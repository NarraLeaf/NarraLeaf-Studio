import { describe, expect, it, vi } from "vitest";
import { WINDOW_PROJECT_MISMATCH_CODE } from "@shared/types/window";

vi.mock("electron", () => ({}));

const { GameTestLaunchHandler } = await import("./gameTestAction");

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
