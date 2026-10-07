import { EventEmitter } from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    UPDATE_AUTO_CHECK_DELAY_MS,
    UPDATE_AUTO_CHECK_KEY,
    UPDATE_AUTO_DOWNLOAD_KEY,
    UPDATE_RECHECK_INTERVAL_MS,
} from "@shared/constants/update";
import type { StartupExtras } from "../startupExtras";
import type { BaseApp } from "../baseApp";
import { autoUpdater } from "electron-updater";
import { spawn } from "child_process";
import { readPreparedVersion, removeStagedCopy, UPDATE_WAIT_PID_ENV } from "./updateStaging";
import { UpdateManager } from "./updateManager";

// electron-updater reaches for Electron's app at import time, so the whole module is a stand-in:
// the listeners the manager registers are captured and fired by hand, which is all any of these
// paths need from it.
vi.mock("electron-updater", () => {
    class CancellationToken {
        cancelled = false;
        cancel() {
            this.cancelled = true;
        }
    }
    return {
        CancellationToken,
        autoUpdater: {
            autoDownload: true,
            autoInstallOnAppQuit: false,
            autoRunAppAfterInstall: false,
            logger: null,
            on: vi.fn(),
            checkForUpdates: vi.fn(),
            downloadUpdate: vi.fn(() => new Promise(() => undefined)),
            quitAndInstall: vi.fn(),
        },
    };
});

vi.mock("child_process", () => ({ spawn: vi.fn() }));

vi.mock("./updateStaging", async importOriginal => {
    const actual = await importOriginal<typeof import("./updateStaging")>();
    return {
        ...actual,
        readPreparedVersion: vi.fn(async () => null),
        readPrepareProgress: vi.fn(async () => null),
        removeStagedCopy: vi.fn(async () => undefined),
        cleanUpAfterUpdate: vi.fn(async () => ({ removed: [] })),
    };
});

function makeApp(options: { launchUpdateCheck: boolean; autoCheckSetting?: boolean; autoDownloadSetting?: boolean; packaged?: boolean }) {
    const extras = { launchUpdateCheck: options.launchUpdateCheck } as StartupExtras;
    const info: string[] = [];
    const quitListeners: Array<() => void> = [];
    return {
        app: {
            getStartupExtras: () => extras,
            getAppInfo: () => ({ version: "1.2.3" }),
            isPackaged: () => options.packaged ?? false,
            logger: {
                info: (message: string) => info.push(message),
                warn: (message: string) => info.push(message),
                error: () => undefined,
                debug: () => undefined,
            },
            globalState: {
                get: (key: string) => {
                    if (key === UPDATE_AUTO_CHECK_KEY) return options.autoCheckSetting;
                    if (key === UPDATE_AUTO_DOWNLOAD_KEY) return options.autoDownloadSetting;
                    return undefined;
                },
            },
            windowManager: { getWindows: () => [] },
            electronApp: {
                on: (event: string, listener: () => void) => {
                    if (event === "will-quit") quitListeners.push(listener);
                },
            },
        } as unknown as BaseApp,
        info,
        quit: () => quitListeners.forEach(listener => listener()),
    };
}

/** The listener the manager registered on the updater for `event`. */
function updaterListener<T>(event: string): (payload: T) => void {
    const call = vi.mocked(autoUpdater.on).mock.calls.filter(([name]) => name === event).at(-1);
    if (!call) {
        throw new Error(`no listener for ${event}`);
    }
    return call[1] as (payload: T) => void;
}

const flush = () => new Promise(resolve => setImmediate(resolve));

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
        vi.advanceTimersByTime(UPDATE_RECHECK_INTERVAL_MS * 2);

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
        manager.dispose();
    });

    it("checks again while Studio stays running", async () => {
        const { app } = makeApp({ launchUpdateCheck: true, autoCheckSetting: true });
        const manager = new UpdateManager(app);

        manager.initialize();
        vi.advanceTimersByTime(UPDATE_AUTO_CHECK_DELAY_MS);
        // Let the failed launch check settle, so the next one is not refused as still in flight.
        await vi.runOnlyPendingTimersAsync().catch(() => undefined);
        const afterLaunch = fetchCalls;

        await vi.advanceTimersByTimeAsync(UPDATE_RECHECK_INTERVAL_MS);
        expect(fetchCalls).toBe(afterLaunch + 1);
        manager.dispose();
    });

    it("asks nothing when the author turned the automatic check off", () => {
        const { app } = makeApp({ launchUpdateCheck: true, autoCheckSetting: false });
        const manager = new UpdateManager(app);

        manager.initialize();
        vi.advanceTimersByTime(UPDATE_RECHECK_INTERVAL_MS * 2);

        expect(fetchCalls).toBe(0);
        manager.dispose();
    });
});

describe("UpdateManager on packaged Windows", () => {
    const realPlatform = process.platform;
    const realWaitPid = process.env[UPDATE_WAIT_PID_ENV];

    beforeEach(() => {
        // The self-updating path is the packaged Windows one; the test host may be anything.
        Object.defineProperty(process, "platform", { value: "win32" });
        vi.mocked(autoUpdater.on).mockClear();
        vi.mocked(autoUpdater.quitAndInstall).mockClear();
        vi.mocked(autoUpdater.downloadUpdate).mockClear();
        vi.mocked(spawn).mockReset();
        vi.mocked(readPreparedVersion).mockReset().mockResolvedValue(null);
        vi.mocked(removeStagedCopy).mockClear();
        delete process.env[UPDATE_WAIT_PID_ENV];
    });

    afterEach(() => {
        Object.defineProperty(process, "platform", { value: realPlatform });
        if (realWaitPid === undefined) {
            delete process.env[UPDATE_WAIT_PID_ENV];
        } else {
            process.env[UPDATE_WAIT_PID_ENV] = realWaitPid;
        }
    });

    function managerFor(options: { autoDownloadSetting?: boolean } = {}) {
        const made = makeApp({ launchUpdateCheck: false, packaged: true, ...options });
        const manager = new UpdateManager(made.app);
        manager.initialize();
        return { manager, ...made };
    }

    function fakeChild() {
        const child = new EventEmitter() as EventEmitter & { pid: number; exitCode: number | null; killed: boolean; kill: () => boolean };
        child.pid = 4242;
        child.exitCode = null;
        child.killed = false;
        child.kill = vi.fn(() => {
            child.killed = true;
            return true;
        });
        return child;
    }

    describe("a version a check finds", () => {
        it("is downloaded at once, without ever being offered", () => {
            const { manager } = managerFor();
            const seen: string[] = [];
            const setState = (manager as unknown as { setState: (patch: { status: string }) => void }).setState.bind(manager);
            (manager as unknown as { setState: (patch: { status: string }) => void }).setState = patch => {
                seen.push(patch.status);
                setState(patch);
            };

            updaterListener<{ version: string }>("update-available")({ version: "1.2.4" });

            expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
            expect(manager.getState().status).toBe("downloading");
            expect(manager.getState().availableVersion).toBe("1.2.4");
            // "available" is never announced for a version Studio takes on its own.
            expect(seen).not.toContain("available");
        });

        it("waits for Download when the author turned automatic downloads off", async () => {
            const { manager } = managerFor({ autoDownloadSetting: false });

            updaterListener<{ version: string }>("update-available")({ version: "1.2.4" });

            expect(manager.getState().status).toBe("available");
            expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();

            void manager.download();
            expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
            expect(manager.getState().status).toBe("downloading");
        });
    });

    describe("cancelling", () => {
        it("stops the download and does not start it again on the next check", () => {
            const { manager } = managerFor();
            updaterListener<{ version: string }>("update-available")({ version: "1.2.4" });
            const token = vi.mocked(autoUpdater.downloadUpdate).mock.calls[0][0] as { cancelled: boolean };

            manager.cancel();

            expect(token.cancelled).toBe(true);
            expect(manager.getState().status).toBe("available");

            updaterListener<{ version: string }>("update-available")({ version: "1.2.4" });
            expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
            expect(manager.getState().status).toBe("available");
        });

        it("still takes a newer version than the one declined", () => {
            const { manager } = managerFor();
            updaterListener<{ version: string }>("update-available")({ version: "1.2.4" });
            manager.cancel();

            updaterListener<{ version: string }>("update-available")({ version: "1.2.5" });

            expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(2);
            expect(manager.getState().status).toBe("downloading");
        });

        it("stops the unpacking and throws away the half-unpacked copy", async () => {
            const child = fakeChild();
            vi.mocked(spawn).mockReturnValue(child as never);
            const { manager } = managerFor();
            updaterListener<{ version: string; downloadedFile: string }>("update-downloaded")({
                version: "1.2.4",
                downloadedFile: "C:\\cache\\pending\\NarraLeaf-Studio-Setup-1.2.4-x64.exe",
            });
            await flush();
            expect(manager.getState().status).toBe("preparing");

            manager.cancel();

            expect(child.kill).toHaveBeenCalled();
            expect(removeStagedCopy).toHaveBeenCalled();
            expect(manager.getState().status).toBe("available");
            // The killed installer's exit must not turn the cancel into "ready".
            child.emit("exit", 1);
            await flush();
            expect(manager.getState().status).toBe("available");
        });
    });

    describe("the quit guard", () => {
        it("asks about a download the author started, not one Studio started", () => {
            const automatic = managerFor().manager;
            updaterListener<{ version: string }>("update-available")({ version: "1.2.4" });
            expect(automatic.isDownloadingOnRequest()).toBe(false);

            const requested = managerFor({ autoDownloadSetting: false }).manager;
            updaterListener<{ version: string }>("update-available")({ version: "1.2.4" });
            void requested.download();
            expect(requested.isDownloadingOnRequest()).toBe(true);
        });
    });

    describe("preparing", () => {
        const installer = "C:\\cache\\pending\\NarraLeaf-Studio-Setup-1.2.4-x64.exe";

        it("runs the downloaded installer to unpack the new version, and is ready once it has", async () => {
            const child = fakeChild();
            vi.mocked(spawn).mockReturnValue(child as never);
            const { manager } = managerFor();

            updaterListener<{ version: string; downloadedFile: string }>("update-downloaded")({ version: "1.2.4", downloadedFile: installer });
            await flush();

            expect(spawn).toHaveBeenCalledWith(installer, ["--nl-prepare", "/S"], expect.objectContaining({ windowsHide: true }));
            expect(manager.getState().status).toBe("preparing");

            vi.mocked(readPreparedVersion).mockResolvedValue("1.2.4");
            child.emit("exit", 0);
            await flush();

            expect(manager.getState().status).toBe("ready");
            expect(manager.getState().fastRestart).toBe(true);
        });

        it("leaves the update ready for a full install when the unpacking does not finish", async () => {
            const child = fakeChild();
            vi.mocked(spawn).mockReturnValue(child as never);
            const { manager } = managerFor();

            updaterListener<{ version: string; downloadedFile: string }>("update-downloaded")({ version: "1.2.4", downloadedFile: installer });
            await flush();
            child.emit("exit", 2);
            await flush();

            expect(manager.getState().status).toBe("ready");
            expect(manager.getState().fastRestart).toBe(false);
        });

        it("uses a copy an earlier session already prepared", async () => {
            vi.mocked(readPreparedVersion).mockResolvedValue("1.2.4");
            const { manager } = managerFor();

            updaterListener<{ version: string; downloadedFile: string }>("update-downloaded")({ version: "1.2.4", downloadedFile: installer });
            await flush();

            expect(spawn).not.toHaveBeenCalled();
            expect(manager.getState().status).toBe("ready");
            expect(manager.getState().fastRestart).toBe(true);
        });
    });

    describe("applying", () => {
        function readyManager() {
            const made = managerFor();
            // No installer path: ready without a prepared copy, the same as an update that could not
            // be prepared.
            updaterListener<{ version: string }>("update-downloaded")({ version: "1.2.4" });
            return made;
        }

        it("runs the installer visibly, asks it to start Studio again, and says which process to wait for", () => {
            const { manager } = readyManager();
            expect(manager.getState().status).toBe("ready");

            manager.installNow();

            // Not silent, so a full install shows its update window; and for a run that is not silent
            // electron-updater puts --force-run on the command line from autoRunAppAfterInstall.
            expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true);
            expect(autoUpdater.autoRunAppAfterInstall).toBe(true);
            expect(process.env[UPDATE_WAIT_PID_ENV]).toBe(String(process.pid));
        });

        it("does nothing until an update is ready", () => {
            const { manager } = managerFor();

            manager.installNow();

            expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
        });

        it("applies a ready update on the way out, and nothing else", async () => {
            const preparing = managerFor();
            const child = fakeChild();
            vi.mocked(spawn).mockReturnValue(child as never);
            updaterListener<{ version: string; downloadedFile: string }>("update-downloaded")({
                version: "1.2.4",
                downloadedFile: "C:\\cache\\pending\\NarraLeaf-Studio-Setup-1.2.4-x64.exe",
            });
            await flush();
            expect(preparing.manager.getState().status).toBe("preparing");

            preparing.quit();

            expect(autoUpdater.autoInstallOnAppQuit).toBe(false);
            expect(child.kill).toHaveBeenCalled();
            expect(process.env[UPDATE_WAIT_PID_ENV]).toBeUndefined();

            const ready = readyManager();
            ready.quit();

            expect(autoUpdater.autoInstallOnAppQuit).toBe(true);
            expect(process.env[UPDATE_WAIT_PID_ENV]).toBe(String(process.pid));
        });
    });
});
