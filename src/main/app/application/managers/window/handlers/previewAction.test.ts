import { describe, expect, it, vi } from "vitest";
import { WINDOW_PROJECT_MISMATCH_CODE } from "@shared/types/window";

vi.mock("electron", () => ({}));

const { PreviewLaunchHandler } = await import("./previewAction");

type AppWindowLike = Parameters<InstanceType<typeof PreviewLaunchHandler>["handle"]>[0];

/** A window on one project, whose preview manager records what it was asked to launch. */
function makeWindow(projectPath?: string) {
    const launch = vi.fn(async () => "running");
    const window = {
        getProps: () => ({ projectPath }),
        getApp: () => ({ getPreviewManager: () => ({ launch }) }),
    } as unknown as AppWindowLike;
    return { window, launch };
}

const MINE = "D:/games/mine";
const THEIRS = "D:/games/theirs";

/**
 * Which project a preview is started for.
 *
 * A preview runs the project's code, so the project has to be the one this window was opened on:
 * the payload is whatever the renderer sent, and a renderer free to name a project would be free to
 * have another one compiled and run on its behalf. Same rule as a build and a Dev Mode launch.
 */
describe("PreviewLaunchHandler", () => {
    it("launches the window's own project", async () => {
        const { window, launch } = makeWindow(MINE);

        const result = await new PreviewLaunchHandler().handle(window, { projectPath: MINE, entry: {} as never });

        expect(result.success).toBe(true);
        expect(launch).toHaveBeenCalledWith(MINE, {});
    });

    it("refuses a project this window does not have open", async () => {
        const { window, launch } = makeWindow(MINE);

        const result = await new PreviewLaunchHandler().handle(window, { projectPath: THEIRS, entry: {} as never });

        expect(result.success).toBe(false);
        expect(result.code).toBe(WINDOW_PROJECT_MISMATCH_CODE);
        expect(launch).not.toHaveBeenCalled();
    });

    it("refuses a window that has no project open", async () => {
        const { window, launch } = makeWindow();

        const result = await new PreviewLaunchHandler().handle(window, { projectPath: MINE, entry: {} as never });

        expect(result.code).toBe(WINDOW_PROJECT_MISMATCH_CODE);
        expect(launch).not.toHaveBeenCalled();
    });
});
