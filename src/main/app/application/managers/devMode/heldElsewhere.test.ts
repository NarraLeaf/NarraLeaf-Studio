import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { App } from "@/app/app";
import type { DevModeEntry } from "@shared/types/devMode";
import { IPCEventType } from "@shared/types/ipcEvents";
import type { ProjectSessionHolder } from "@shared/types/projectSession";
import { DevModeManager } from "./DevModeManager";
import type { DevModeBundleLoadContext, DevModeBundleSource } from "./pipeline/types";

/**
 * Dev Mode on a project another NarraLeaf Studio has open.
 *
 * The workspace that loses the session claim stops on its error screen, but the window stays - and
 * a Dev Mode started from it came up black: the title page's words in the interface font, no picture,
 * no background, no project font, a story that never began, and nothing saying why. Every asset a
 * Dev Mode window shows is resolved through the project's workspace, and that workspace never
 * started. These pin the refusal that replaced it.
 */

const ENTRY: DevModeEntry = { kind: "surface", surfaceId: "main" };
const OTHER_STUDIO: ProjectSessionHolder = { hostname: "studio-two", startedAt: "2026-09-21T10:00:00.000Z", sameHost: true };

let root: string;
let devMode: DevModeManager;
let compiled: DevModeBundleLoadContext[];
let launchedWindows: { sent: { type: IPCEventType; payload: unknown }[] }[];
/** What the lock manager says about the project; the tests move it between the two answers. */
let heldElsewhere: ProjectSessionHolder | null;

const recordingBundleSource: DevModeBundleSource = {
    kind: "recording",
    async load(context: DevModeBundleLoadContext) {
        compiled.push(context);
        return {
            bundleId: context.bundleId,
            revision: context.revision,
            timestamp: new Date().toISOString(),
            ui: {},
        } as never;
    },
};

function fakeWindow() {
    const closeHandlers: (() => void)[] = [];
    const window = {
        closed: false,
        sent: [] as { type: IPCEventType; payload: unknown }[],
        isClosed: () => window.closed,
        isDestroyed: () => window.closed,
        show: () => undefined,
        focus: () => undefined,
        win: {
            focus: () => undefined,
            on: () => undefined,
            isVisible: () => !window.closed,
            isFullScreen: () => false,
            hide: () => undefined,
            isDestroyed: () => window.closed,
            destroy: () => undefined,
        },
        onClose: (handler: () => void) => closeHandlers.push(handler),
        onReady: (handler: () => void) => handler(),
        setCloseGuard: () => undefined,
        sendIpcEvent: (type: IPCEventType, payload: unknown) => window.sent.push({ type, payload }),
        forceClose: () => {
            window.closed = true;
            for (const handler of closeHandlers) handler();
        },
    };
    return window;
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
        getProjectSessionLockManager: () => ({ heldElsewhere: () => heldElsewhere }),
        launchDevMode: async () => {
            const window = fakeWindow();
            launchedWindows.push(window);
            return window;
        },
    } as unknown as App;
}

beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nl-devmode-held-")));
    fs.writeFileSync(path.join(root, "project.json"), JSON.stringify({ name: "held" }));
    compiled = [];
    launchedWindows = [];
    heldElsewhere = null;
    devMode = new DevModeManager(fakeApp(), undefined, recordingBundleSource);
});

afterEach(async () => {
    heldElsewhere = null;
    await devMode.stop(root).catch(() => undefined);
    fs.rmSync(root, { recursive: true, force: true });
});

describe("Dev Mode on a project another Studio has", () => {
    it("is refused before a window exists, and says why", async () => {
        heldElsewhere = OTHER_STUDIO;

        await expect(devMode.launch(root, ENTRY)).rejects.toThrow(/open in another NarraLeaf Studio on this computer/);

        // The half-open state this replaces began with a window: no window, no compile.
        expect(launchedWindows).toHaveLength(0);
        expect(compiled).toHaveLength(0);
        expect(devMode.getStatus(root)).toBe("idle");
    });

    it("starts as usual once this Studio has claimed the project", async () => {
        // Retry on the error screen, after the other Studio closed it.
        heldElsewhere = OTHER_STUDIO;
        await expect(devMode.launch(root, ENTRY)).rejects.toThrow();

        heldElsewhere = null;
        await expect(devMode.launch(root, ENTRY)).resolves.toBe("running");
        expect(launchedWindows).toHaveLength(1);
    });

    it("does not recompile a running session whose project was lost, and tells its window", async () => {
        // The workspace reloaded onto the error screen while the Dev Mode window stayed up. A
        // recompile would resolve assets through a workspace that is not running any more.
        await devMode.launch(root, ENTRY);
        const window = launchedWindows[0];
        const compiledBefore = compiled.length;
        window.sent.length = 0;

        heldElsewhere = OTHER_STUDIO;
        await expect(devMode.reload(root)).resolves.toBe("error");

        expect(compiled).toHaveLength(compiledBefore);
        const errors = window.sent.filter(event => event.type === IPCEventType.devModeControlError);
        expect(errors).toHaveLength(1);
        expect((errors[0].payload as { message: string }).message).toContain("open in another NarraLeaf Studio");
    });
});
