import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "@/app/app";
import { DEV_MODE_AGENT_IDLE_MS, type DevModeEntry } from "@shared/types/devMode";
import { IPCEventType } from "@shared/types/ipcEvents";
import { DevModeManager } from "./DevModeManager";
import type { DevModeBundleLoadContext, DevModeBundleSource } from "./pipeline/types";

/**
 * A Dev Mode session an agent's play-test opened: hidden, kept running when the author closes its
 * window, handed back by the author's own launch, and stopped after five minutes without a call.
 */

let root: string;
let devMode: DevModeManager;
let launched: { window: FakeWindow; hidden: boolean }[];

const SURFACE_ENTRY: DevModeEntry = { kind: "surface", surfaceId: "main" };
const STORY_ENTRY: DevModeEntry = { kind: "story", storyId: "story-1", sceneId: "scene-1" };

const bundleSource: DevModeBundleSource = {
    kind: "recording",
    async load(context: DevModeBundleLoadContext) {
        return {
            bundleId: context.bundleId,
            revision: context.revision,
            timestamp: new Date().toISOString(),
            ui: {},
        } as never;
    },
};

type FakeWindow = {
    closed: boolean;
    hiddenByGuard: number;
    shown: number;
    throttled: boolean;
    sent: { type: IPCEventType; payload: unknown }[];
    requestClose(): boolean;
    isClosed(): boolean;
};

function fakeWindow(): FakeWindow {
    const closeHandlers: (() => void)[] = [];
    let guard: (() => boolean) | null = null;
    const window = {
        closed: false,
        hiddenByGuard: 0,
        shown: 0,
        throttled: true,
        sent: [] as FakeWindow["sent"],
        isClosed: () => window.closed,
        isDestroyed: () => window.closed,
        show: () => {
            window.shown += 1;
        },
        win: {
            focus: () => undefined,
            on: () => undefined,
            once: () => undefined,
            isVisible: () => false,
            isFullScreen: () => false,
            hide: () => {
                window.hiddenByGuard += 1;
            },
            isDestroyed: () => window.closed,
            destroy: () => undefined,
            webContents: {
                getBackgroundThrottling: () => window.throttled,
                setBackgroundThrottling: (value: boolean) => {
                    window.throttled = value;
                },
            },
        },
        onClose: (handler: () => void) => closeHandlers.push(handler),
        onReady: (handler: () => void) => handler(),
        setCloseGuard: (next: () => boolean) => {
            guard = next;
        },
        /** The author's close box: true when the guard swallowed it. */
        requestClose: () => guard?.() ?? false,
        sendIpcEvent: (type: IPCEventType, payload: unknown) => window.sent.push({ type, payload }),
        forceClose: () => {
            window.closed = true;
            for (const handler of closeHandlers) handler();
        },
    };
    return window as unknown as FakeWindow;
}

function fakeApp(): App {
    const noop = () => undefined;
    return {
        logger: { info: noop, warn: noop, error: noop, debug: noop },
        isQuitting: () => false,
        windowManager: { getWindows: () => [] },
        findWorkspaceForProject: () => undefined,
        getGlobalState: () => ({ get: () => undefined }),
        projectTrustManager: { isTrusted: () => true },
        getProjectSessionLockManager: () => ({ heldElsewhere: () => null }),
        launchDevMode: async (_props: unknown, _options: unknown, extra: { hidden?: boolean } = {}) => {
            const window = fakeWindow();
            launched.push({ window, hidden: extra.hidden === true });
            return window;
        },
    } as unknown as App;
}

function holdEvents(window: FakeWindow): unknown[] {
    return window.sent.filter(event => event.type === IPCEventType.devModeAgentHoldChanged).map(event => event.payload);
}

beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nl-devmode-agent-hold-")));
    fs.writeFileSync(path.join(root, "project.json"), JSON.stringify({ name: "agent-hold" }));
    launched = [];
    devMode = new DevModeManager(fakeApp(), bundleSource);
});

afterEach(async () => {
    vi.useRealTimers();
    await devMode.stop(root).catch(() => undefined);
    fs.rmSync(root, { recursive: true, force: true });
});

describe("a Dev Mode session an agent opened", () => {
    it("opens its window hidden and tells the window it is held", async () => {
        await expect(devMode.launch(root, SURFACE_ENTRY, { agent: true })).resolves.toBe("running");

        expect(launched).toHaveLength(1);
        expect(launched[0].hidden).toBe(true);
        expect(devMode.isAgentHeld(root)).toBe(true);
        expect(holdEvents(launched[0].window)).toEqual([{ held: true }]);
    });

    it("an author's launch opens a visible window that is not held", async () => {
        await devMode.launch(root, SURFACE_ENTRY);

        expect(launched[0].hidden).toBe(false);
        expect(devMode.isAgentHeld(root)).toBe(false);
        expect(holdEvents(launched[0].window)).toEqual([]);
    });

    it("hides rather than closes when the author closes its window", async () => {
        await devMode.launch(root, SURFACE_ENTRY, { agent: true });
        const { window } = launched[0];

        expect(window.requestClose()).toBe(true);

        expect(window.hiddenByGuard).toBe(1);
        expect(window.isClosed()).toBe(false);
        expect(devMode.getStatus(root)).toBe("running");
    });

    it("can be shown without letting go of it", async () => {
        await devMode.launch(root, SURFACE_ENTRY, { agent: true });

        expect(devMode.reveal(root)).toBe(true);

        expect(launched[0].window.shown).toBe(1);
        expect(devMode.isAgentHeld(root)).toBe(true);
    });

    it("is handed back by the author's launch in place, and stops hiding on close", async () => {
        await devMode.launch(root, STORY_ENTRY, { agent: true });
        const { window } = launched[0];

        await devMode.launch(root, STORY_ENTRY);

        expect(launched).toHaveLength(1);
        expect(devMode.isAgentHeld(root)).toBe(false);
        expect(holdEvents(window)).toEqual([{ held: true }, { held: false }]);
        // The close goes to the game's blueprints again rather than being turned into a hide.
        window.requestClose();
        expect(window.hiddenByGuard).toBe(0);
    });

    it("takes over a window the author had open, without hiding it, and keeps it painting", async () => {
        await devMode.launch(root, STORY_ENTRY);
        const { window } = launched[0];
        const shownBefore = window.shown;

        await devMode.launch(root, STORY_ENTRY, { agent: true });

        expect(devMode.isAgentHeld(root)).toBe(true);
        expect(window.shown).toBe(shownBefore);
        expect(window.throttled).toBe(false);
    });

    it("is stopped after five minutes without a play-test call, and every call restarts the clock", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        await devMode.launch(root, SURFACE_ENTRY, { agent: true });
        const { window } = launched[0];

        await vi.advanceTimersByTimeAsync(DEV_MODE_AGENT_IDLE_MS - 1000);
        // Refused (the fake window does not answer), but a call all the same.
        await devMode.agentControl(root, { kind: "state" }).catch(() => undefined);
        await vi.advanceTimersByTimeAsync(DEV_MODE_AGENT_IDLE_MS - 1000);
        expect(window.isClosed()).toBe(false);

        await vi.advanceTimersByTimeAsync(2000);
        expect(window.isClosed()).toBe(true);
        expect(devMode.getStatus(root)).toBe("idle");
    });

    it("an author's session has no idle limit", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        await devMode.launch(root, SURFACE_ENTRY);

        await vi.advanceTimersByTimeAsync(DEV_MODE_AGENT_IDLE_MS * 2);

        expect(launched[0].window.isClosed()).toBe(false);
    });
});
