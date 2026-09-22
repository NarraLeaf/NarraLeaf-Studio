import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UPDATE_AUTO_CHECK_DELAY_MS, UPDATE_AUTO_CHECK_KEY } from "@shared/constants/update";
import type { StartupExtras } from "../startupExtras";
import type { BaseApp } from "../baseApp";
import { UpdateManager } from "./updateManager";

// electron-updater reaches for Electron's app at import time, and none of the paths under test get
// as far as the updater itself - the point of every one of them is that no request is made.
vi.mock("electron-updater", () => ({
    autoUpdater: {
        autoDownload: true,
        autoInstallOnAppQuit: false,
        logger: null,
        on: vi.fn(),
        checkForUpdates: vi.fn(),
        downloadUpdate: vi.fn(),
        quitAndInstall: vi.fn(),
    },
}));

function makeApp(options: { launchUpdateCheck: boolean; autoCheckSetting?: boolean }) {
    const extras = { launchUpdateCheck: options.launchUpdateCheck } as StartupExtras;
    const info: string[] = [];
    return {
        app: {
            getStartupExtras: () => extras,
            getAppInfo: () => ({ version: "1.2.3" }),
            isPackaged: () => false,
            logger: {
                info: (message: string) => info.push(message),
                warn: () => undefined,
                error: () => undefined,
                debug: () => undefined,
            },
            globalState: {
                get: (key: string) => (key === UPDATE_AUTO_CHECK_KEY ? options.autoCheckSetting : undefined),
            },
            windowManager: { getWindows: () => [] },
        } as unknown as BaseApp,
        info,
    };
}

describe("UpdateManager.initialize", () => {
    // Any request at all is the failure these guard against, wherever in the manager it came from,
    // so the global is replaced rather than one client stubbed.
    const realFetch = globalThis.fetch;
    let fetchCalls = 0;

    beforeEach(() => {
        vi.useFakeTimers();
        fetchCalls = 0;
        (globalThis as { fetch: unknown }).fetch = () => {
            fetchCalls += 1;
            return Promise.reject(new Error("the network is not available in a test"));
        };
    });

    afterEach(() => {
        vi.useRealTimers();
        (globalThis as { fetch: unknown }).fetch = realFetch;
    });

    it("asks nothing of the network in a command-line run", () => {
        const { app, info } = makeApp({ launchUpdateCheck: false, autoCheckSetting: true });
        const manager = new UpdateManager(app);

        manager.initialize();
        vi.advanceTimersByTime(UPDATE_AUTO_CHECK_DELAY_MS * 4);

        expect(fetchCalls).toBe(0);
        expect(info.some(line => line.includes("command-line run"))).toBe(true);
        // The state it leaves behind is still truthful; only the request is missing.
        expect(manager.getState().currentVersion).toBe("1.2.3");
        expect(manager.getState().status).toBe("idle");
    });

    it("checks once, after the delay, in an ordinary launch", () => {
        const { app } = makeApp({ launchUpdateCheck: true, autoCheckSetting: true });
        const manager = new UpdateManager(app);

        manager.initialize();
        expect(fetchCalls).toBe(0);

        vi.advanceTimersByTime(UPDATE_AUTO_CHECK_DELAY_MS);
        expect(fetchCalls).toBe(1);
    });

    it("asks nothing when the author turned the launch check off", () => {
        const { app } = makeApp({ launchUpdateCheck: true, autoCheckSetting: false });
        const manager = new UpdateManager(app);

        manager.initialize();
        vi.advanceTimersByTime(UPDATE_AUTO_CHECK_DELAY_MS * 4);

        expect(fetchCalls).toBe(0);
    });
});
