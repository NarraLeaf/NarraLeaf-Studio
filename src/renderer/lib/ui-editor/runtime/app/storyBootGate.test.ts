import { describe, expect, it, vi } from "vitest";
import { createStoryStartGate, surfacesMayDraw } from "./storyBootGate";

/**
 * Drawing the interface and having a story to start used to be the same moment. Dev Mode pulls
 * them apart so the author can look at the interface without waiting for a project's worth of
 * assets to resolve; what has to survive that is the press that arrives in between.
 */
describe("surfacesMayDraw", () => {
    it("holds the stack until the story environment has booted", () => {
        expect(surfacesMayDraw({
            storyBootFinished: false,
            hostDrawsBeforeStoryBoot: false,
            localeResumePending: false,
        })).toBe(false);
    });

    it("draws without one for a host that asked not to wait", () => {
        expect(surfacesMayDraw({
            storyBootFinished: false,
            hostDrawsBeforeStoryBoot: true,
            localeResumePending: false,
        })).toBe(true);
    });

    it("waits for a language restart either way, because that is a playthrough coming back", () => {
        for (const hostDrawsBeforeStoryBoot of [false, true]) {
            expect(surfacesMayDraw({
                storyBootFinished: true,
                hostDrawsBeforeStoryBoot,
                localeResumePending: true,
            })).toBe(false);
        }
    });
});

describe("createStoryStartGate", () => {
    it("waits for a boot in flight, then starts once", async () => {
        let releaseBoot = () => undefined as void;
        const pendingBoot = { current: new Promise<void>(resolve => { releaseBoot = resolve; }) };
        const start = { current: vi.fn(async () => undefined) };

        const gate = createStoryStartGate({ pendingBoot, start });
        const pressed = gate({ storyId: "s", sceneId: "c" });
        await Promise.resolve();
        expect(start.current).not.toHaveBeenCalled();

        releaseBoot();
        await pressed;
        expect(start.current).toHaveBeenCalledTimes(1);
        expect(start.current).toHaveBeenCalledWith({ storyId: "s", sceneId: "c" }, undefined);
    });

    it("forwards what a Load Save carries into the run it starts", async () => {
        const start = { current: vi.fn(async () => undefined) };
        const saved = { at: "chapter two" };
        await createStoryStartGate({ pendingBoot: { current: Promise.resolve() }, start })(
            { storyId: "s", sceneId: "c" },
            { inheritSavedGame: saved },
        );
        expect(start.current).toHaveBeenCalledWith(
            { storyId: "s", sceneId: "c" },
            { inheritSavedGame: saved },
        );
    });

    it("starts straight away when no boot is in flight", async () => {
        const start = { current: vi.fn(async () => undefined) };
        await createStoryStartGate({ pendingBoot: { current: null }, start })({ storyId: "s", sceneId: "c" });
        expect(start.current).toHaveBeenCalledTimes(1);
    });

    it("folds a second press of the same button into the start already running", async () => {
        let releaseStart = () => undefined as void;
        const start = { current: vi.fn(() => new Promise<void>(resolve => { releaseStart = resolve; })) };
        const gate = createStoryStartGate({ pendingBoot: { current: null }, start });

        const first = gate({ storyId: "s", sceneId: "c" });
        await Promise.resolve();
        const second = gate({ storyId: "s", sceneId: "c" });
        releaseStart();
        await Promise.all([first, second]);

        expect(start.current).toHaveBeenCalledTimes(1);
    });

    it("runs a press for a different story on its own", async () => {
        // One resolver per call: the point of the test is that there are two runs to release.
        const release: Array<() => void> = [];
        const start = { current: vi.fn(() => new Promise<void>(resolve => { release.push(resolve); })) };
        const gate = createStoryStartGate({ pendingBoot: { current: null }, start });

        const first = gate({ storyId: "s", sceneId: "c" });
        await Promise.resolve();
        const other = gate({ storyId: "s", sceneId: "other" });
        await Promise.resolve();
        for (const resolve of release) {
            resolve();
        }
        await Promise.all([first, other]);

        expect(start.current).toHaveBeenCalledTimes(2);
    });

    it("starts again once the run it folded into has finished", async () => {
        const start = { current: vi.fn(async () => undefined) };
        const gate = createStoryStartGate({ pendingBoot: { current: null }, start });

        await gate({ storyId: "s", sceneId: "c" });
        await gate({ storyId: "s", sceneId: "c" });

        expect(start.current).toHaveBeenCalledTimes(2);
    });

    it("says the runtime is not ready when the boot left nothing to start", async () => {
        const gate = createStoryStartGate({
            pendingBoot: { current: Promise.resolve() },
            start: { current: null },
        });
        await expect(gate({ storyId: "s", sceneId: "c" })).rejects.toThrow("runtime is not ready");
    });
});
