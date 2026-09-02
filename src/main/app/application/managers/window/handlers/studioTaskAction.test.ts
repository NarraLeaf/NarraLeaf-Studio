import { describe, expect, it, vi } from "vitest";
import { WINDOW_PROJECT_MISMATCH_CODE } from "@shared/types/window";

vi.mock("electron", () => ({}));

// The quality and thread count are read off global state by helpers this test does not exercise;
// what matters here is which project reaches the baker.
vi.mock("../../weather/screenEffectQuality", () => ({
    devModeScreenEffectQuality: () => "draft",
    screenEffectBakeThreads: () => 1,
}));

const { StudioTasksPrebakeWeatherHandler } = await import("./studioTaskAction");

type AppWindowLike = Parameters<InstanceType<typeof StudioTasksPrebakeWeatherHandler>["handle"]>[0];

function makeWindow(projectPath?: string) {
    const ensure = vi.fn(async (_request: unknown) => ({ failures: new Map() }));
    const window = {
        getProps: () => ({ projectPath }),
        getApp: () => ({ getWeatherBakeManager: () => ({ ensure }) }),
    } as unknown as AppWindowLike;
    return { window, ensure };
}

const MINE = "D:/games/mine";
const THEIRS = "D:/games/theirs";

/**
 * Pre-baking reads a project's stories and spawns ffmpeg over its clips, so the project it is asked
 * for has to be the window's own. The handler answers synchronously and starts the bake in the
 * background, which is why the refusal is a thrown mismatch rather than a failed status.
 */
describe("StudioTasksPrebakeWeatherHandler", () => {
    it("bakes for the window's own project", () => {
        const { window, ensure } = makeWindow(MINE);

        const result = new StudioTasksPrebakeWeatherHandler().handle(window, { projectPath: MINE, specs: [] });

        expect(result.success).toBe(true);
        expect(ensure).toHaveBeenCalledOnce();
        expect(ensure.mock.calls[0]![0]).toMatchObject({ projectRoot: MINE, priority: "idle" });
    });

    it("refuses a project this window does not have open", () => {
        const { window, ensure } = makeWindow(MINE);

        expect(() => new StudioTasksPrebakeWeatherHandler().handle(window, { projectPath: THEIRS, specs: [] }))
            .toThrow(expect.objectContaining({ code: WINDOW_PROJECT_MISMATCH_CODE }));
        expect(ensure).not.toHaveBeenCalled();
    });
});
