import { describe, expect, it, vi } from "vitest";
import { WINDOW_PROJECT_MISMATCH_CODE } from "@shared/types/window";

vi.mock("electron", () => ({}));

const {
    PreviewGetStatusHandler,
    PreviewLaunchHandler,
    PreviewResetDataHandler,
    PreviewStopHandler,
} = await import("./previewAction");

type AppWindowLike = Parameters<InstanceType<typeof PreviewLaunchHandler>["handle"]>[0];

/**
 * A window on one project, whose preview manager records what it was asked to do.
 *
 * One double for both handlers: what is under test is whether the manager is reached at all, and
 * with which project, which is the same question at either door.
 */
function makeWindow(projectPath?: string) {
    const launch = vi.fn(async () => "running");
    const resetPlayerData = vi.fn(async () => undefined);
    const stop = vi.fn(async () => "idle");
    const getStatus = vi.fn(() => "running");
    const window = {
        getProps: () => ({ projectPath }),
        getApp: () => ({ getPreviewManager: () => ({ launch, resetPlayerData, stop, getStatus }) }),
    } as unknown as AppWindowLike;
    return { window, launch, resetPlayerData, stop, getStatus };
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

/**
 * Which project has its preview saves thrown away.
 *
 * A recursive delete of a directory derived from the path this is handed -
 * `<project>/.nlstudio/preview/userData/saves`, plus its `persistence.json`. Everything else in a
 * preview profile is a cache the next launch rebuilds; these two are the playthrough, and there is
 * no undo for them. So the payload naming another project is not a leak but a deletion in it.
 */
describe("PreviewResetDataHandler", () => {
    it("clears the window's own project", async () => {
        const { window, resetPlayerData } = makeWindow(MINE);

        const result = await new PreviewResetDataHandler().handle(window, { projectPath: MINE });

        expect(result.success).toBe(true);
        expect(resetPlayerData).toHaveBeenCalledWith(MINE);
    });

    it("refuses a project this window does not have open, and deletes nothing", async () => {
        const { window, resetPlayerData } = makeWindow(MINE);

        const result = await new PreviewResetDataHandler().handle(window, { projectPath: THEIRS });

        expect(result.success).toBe(false);
        expect(result.code).toBe(WINDOW_PROJECT_MISMATCH_CODE);
        expect(resetPlayerData).not.toHaveBeenCalled();
    });

    it("refuses a window that has no project open", async () => {
        const { window, resetPlayerData } = makeWindow();

        const result = await new PreviewResetDataHandler().handle(window, { projectPath: MINE });

        expect(result.code).toBe(WINDOW_PROJECT_MISMATCH_CODE);
        expect(resetPlayerData).not.toHaveBeenCalled();
    });
});

/**
 * Which project's preview is ended, and whose is being watched.
 *
 * Neither is a launch, and the harm is correspondingly smaller - one cuts a session short, the
 * other says whether there is one. They are here because the question is identical and the answer
 * has to be: a guard that stops another project being started but lets it be stopped from any
 * window is not a rule about ownership, it is a list of the sharpest cases. The status probe is
 * also the one the workspace polls once a second, which is the difference between glimpsing another
 * author's session and watching it.
 */
describe("the preview session controls take their project from the window", () => {
    it("stops the window's own preview", async () => {
        const { window, stop } = makeWindow(MINE);

        const result = await new PreviewStopHandler().handle(window, { projectPath: MINE });

        expect(result.success).toBe(true);
        expect(stop).toHaveBeenCalledWith(MINE);
    });

    it("refuses to stop a project this window does not have open", async () => {
        const { window, stop } = makeWindow(MINE);

        const result = await new PreviewStopHandler().handle(window, { projectPath: THEIRS });

        expect(result.success).toBe(false);
        expect(result.code).toBe(WINDOW_PROJECT_MISMATCH_CODE);
        expect(stop).not.toHaveBeenCalled();
    });

    it("answers the status of the window's own project", () => {
        const { window, getStatus } = makeWindow(MINE);

        const result = new PreviewGetStatusHandler().handle(window, { projectPath: MINE });

        expect(result.success).toBe(true);
        expect(getStatus).toHaveBeenCalledWith(MINE);
    });

    /**
     * This one answers synchronously and had no `try` of its own, so the refusal has to be turned
     * into a failed status here rather than thrown - a guard that threw would reach the renderer
     * without the code the refusal is recognised by.
     */
    it("refuses to report on a project this window does not have open", () => {
        const { window, getStatus } = makeWindow(MINE);

        const result = new PreviewGetStatusHandler().handle(window, { projectPath: THEIRS });

        expect(result).toMatchObject({ success: false, code: WINDOW_PROJECT_MISMATCH_CODE });
        expect(getStatus).not.toHaveBeenCalled();
    });

    it("refuses both from a window that has no project open", async () => {
        const { window, stop, getStatus } = makeWindow();

        expect(await new PreviewStopHandler().handle(window, { projectPath: MINE }))
            .toMatchObject({ code: WINDOW_PROJECT_MISMATCH_CODE });
        expect(new PreviewGetStatusHandler().handle(window, { projectPath: MINE }))
            .toMatchObject({ code: WINDOW_PROJECT_MISMATCH_CODE });
        expect(stop).not.toHaveBeenCalled();
        expect(getStatus).not.toHaveBeenCalled();
    });
});
