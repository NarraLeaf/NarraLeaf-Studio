import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createStoryStartGate, publishMenuEnvironmentMount, surfacesMayDraw } from "./storyBootGate";

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
        await expect(gate({ storyId: "s", sceneId: "c" })).rejects.toThrow("“Start Game” needs a running game.");
    });
});

/**
 * A quit lands on a menu, and a menu stands on a game environment of its own: without one the
 * title screen's click sounds were skipped and Load and Continue failed with "game runtime is not
 * available" from the first Return to title on. The environment is mounted in the background, so
 * what has to hold is the press that arrives while it is.
 */
describe("publishMenuEnvironmentMount", () => {
    class Superseded extends Error {}

    function mountControls() {
        let finish = () => undefined as void;
        let fail = (_error: unknown) => undefined as void;
        const mount = vi.fn(() => new Promise<void>((resolve, reject) => {
            finish = resolve;
            fail = reject;
        }));
        return { mount, finish: () => finish(), fail: (error: unknown) => fail(error) };
    }

    it("makes a Start pressed during the mount wait for it, then start once", async () => {
        const pendingBoot: { current: Promise<void> | null } = { current: null };
        const start = { current: vi.fn(async () => undefined) };
        const gate = createStoryStartGate({ pendingBoot, start });
        const controls = mountControls();

        void publishMenuEnvironmentMount({
            mount: controls.mount,
            pendingBoot,
            isSuperseded: error => error instanceof Superseded,
            onSuperseded: vi.fn(),
            onFailure: vi.fn(),
        });
        const pressed = gate({ storyId: "s", sceneId: "c" });
        await Promise.resolve();
        await Promise.resolve();
        expect(start.current).not.toHaveBeenCalled();

        controls.finish();
        await pressed;
        expect(start.current).toHaveBeenCalledTimes(1);
    });

    it("hears a superseded mount as done, not failed, and lets the press through", async () => {
        const pendingBoot: { current: Promise<void> | null } = { current: null };
        const start = { current: vi.fn(async () => undefined) };
        const onSuperseded = vi.fn();
        const onFailure = vi.fn();
        const controls = mountControls();

        const published = publishMenuEnvironmentMount({
            mount: controls.mount,
            pendingBoot,
            isSuperseded: error => error instanceof Superseded,
            onSuperseded,
            onFailure,
        });
        const pressed = createStoryStartGate({ pendingBoot, start })({ storyId: "s", sceneId: "c" });
        controls.fail(new Superseded("a hot reload took the environment"));

        await expect(published).resolves.toBeUndefined();
        await pressed;
        expect(onSuperseded).toHaveBeenCalledTimes(1);
        expect(onFailure).not.toHaveBeenCalled();
        expect(start.current).toHaveBeenCalledTimes(1);
    });

    it("reports a mount that failed, and still never holds the gate shut", async () => {
        const pendingBoot: { current: Promise<void> | null } = { current: null };
        const onFailure = vi.fn();
        const controls = mountControls();

        const published = publishMenuEnvironmentMount({
            mount: controls.mount,
            pendingBoot,
            isSuperseded: error => error instanceof Superseded,
            onSuperseded: vi.fn(),
            onFailure,
        });
        expect(pendingBoot.current).toBe(published);
        controls.fail(new Error("the scene would not compile"));

        await expect(published).resolves.toBeUndefined();
        expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ message: "the scene would not compile" }));
    });

    /**
     * The helper is only half of it: nothing makes the app call it. Pinned on the source, the way
     * the host builder is, because GameApp cannot be mounted without an engine behind it.
     */
    it("is what every quit ends with, and what the boot's own menu launch mounts", () => {
        const source = fs.readFileSync(path.join(__dirname, "GameApp.tsx"), "utf-8");
        const quitStart = source.indexOf("const quitGame = useCallback(");
        expect(quitStart).toBeGreaterThan(-1);
        const quitBody = source.slice(quitStart, source.indexOf("}, [", quitStart));
        const finallyAt = quitBody.lastIndexOf("} finally {");
        expect(finallyAt).toBeGreaterThan(-1);
        expect(quitBody.slice(finallyAt)).toContain("remountMenuEnvironmentRef.current?.()");

        const remountAt = source.indexOf("remountMenuEnvironmentRef.current = () => {");
        expect(source.slice(remountAt, remountAt + 400)).toContain("mount: mountMenuEnvironment");
        const bootAt = source.indexOf("runBootRef.current = async () => {");
        expect(source.slice(bootAt, remountAt)).toContain("await mountMenuEnvironment();");
    });
});
