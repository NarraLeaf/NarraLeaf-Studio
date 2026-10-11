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
import { askGitCode, chooseUpdateSource, type UpdateOffer } from "./updateSource";
import { UPDATE_RETRY_DELAYS_MS, UpdateManager } from "./updateManager";

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
            setFeedURL: vi.fn(),
            checkForUpdates: vi.fn(),
            downloadUpdate: vi.fn(() => new Promise(() => undefined)),
            quitAndInstall: vi.fn(),
        },
    };
});

vi.mock("child_process", () => ({ spawn: vi.fn() }));

vi.mock("electron", () => ({ session: { fromPartition: () => ({ fetch: vi.fn() }) } }));

// Which source answers is updateSource.test.ts's business; here it is whatever a test says.
vi.mock("./updateSource", async importOriginal => ({
    ...await importOriginal<typeof import("./updateSource")>(),
    chooseUpdateSource: vi.fn(async () => null),
    askGitCode: vi.fn(async () => null),
}));

vi.mock("./releaseDirectoryProvider", () => ({
    releaseDirectoryFeed: (url: string) => ({ provider: "custom", url }),
}));

const GITCODE_OFFER: UpdateOffer = {
    source: "gitcode",
    version: "1.2.4",
    feedUrl: "https://gitcode.com/NarraLeaf/NarraLeaf-Studio/releases/download/v1.2.4",
    installerUrl: "https://gitcode.com/NarraLeaf/NarraLeaf-Studio/releases/download/v1.2.4/NarraLeaf-Studio-Setup-1.2.4-x64.exe",
    releaseUrl: "https://gitcode.com/NarraLeaf/NarraLeaf-Studio/releases/v1.2.4",
};

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
            // Read by the main translator, which words a failed download.
            getCommandLineBuild: () => null,
            getCommandLineCheck: () => null,
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
                    if (key === "app.language") return "en";
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

    it("asks GitCode when GitHub does not answer, and links to its copy of the release", async () => {
        vi.mocked(askGitCode).mockResolvedValueOnce(GITCODE_OFFER);
        const { app } = makeApp({ launchUpdateCheck: false });
        const manager = new UpdateManager(app);
        manager.initialize();

        const state = await manager.check();

        expect(state.status).toBe("manual");
        expect(state.availableVersion).toBe("1.2.4");
        expect(state.releaseUrl).toBe(GITCODE_OFFER.releaseUrl);
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

    describe("where it updates from", () => {
        beforeEach(() => {
            vi.mocked(autoUpdater.setFeedURL).mockClear();
            vi.mocked(autoUpdater.checkForUpdates).mockClear();
            vi.mocked(chooseUpdateSource).mockReset().mockResolvedValue(null);
        });

        it("points the updater at the release directory of the source chosen, before checking", async () => {
            vi.mocked(chooseUpdateSource).mockResolvedValue(GITCODE_OFFER);
            const { manager } = managerFor({ autoDownloadSetting: false });

            await manager.check();

            expect(autoUpdater.setFeedURL).toHaveBeenCalledWith({ provider: "custom", url: GITCODE_OFFER.feedUrl });
            expect(vi.mocked(autoUpdater.setFeedURL).mock.invocationCallOrder[0])
                .toBeLessThan(vi.mocked(autoUpdater.checkForUpdates).mock.invocationCallOrder[0]);
            // "Release notes" opens the copy on the host the update comes from.
            updaterListener<{ version: string }>("update-available")({ version: "1.2.4" });
            expect(manager.getState().releaseUrl).toBe(GITCODE_OFFER.releaseUrl);
        });

        it("falls back to the packaged feed when no source answered, so the failure reads as it always has", async () => {
            const { manager } = managerFor();

            await manager.check();

            expect(autoUpdater.setFeedURL).toHaveBeenCalledWith({ provider: "github", owner: "NarraLeaf", repo: "NarraLeaf-Studio" });
            expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
        });
    });

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

describe("UpdateManager incremental downloads", () => {
    const realPlatform = process.platform;

    beforeEach(() => {
        Object.defineProperty(process, "platform", { value: "win32" });
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        Object.defineProperty(process, "platform", { value: realPlatform });
    });

    it("retries a 502 as an incremental download instead of falling back to the full installer", async () => {
        // The shape of electron-updater's own method: it logs why it gave up, then answers true.
        const attempts: string[] = [];
        const updater = autoUpdater as unknown as {
            logger: { error(message: string): void };
            differentialDownloadInstaller: (...args: unknown[]) => Promise<boolean>;
        };
        updater.differentialDownloadInstaller = async function (this: typeof updater) {
            attempts.push("attempt");
            if (attempts.length === 1) {
                this.logger.error("Cannot download differentially, fallback to full download: HttpError: 502 \nHeaders: {}");
                return true;
            }
            return false;
        };
        new UpdateManager(makeApp({ launchUpdateCheck: false, packaged: true }).app).initialize();

        const result = updater.differentialDownloadInstaller({}, { cancellationToken: { cancelled: false } });
        await vi.advanceTimersByTimeAsync(3_000);

        await expect(result).resolves.toBe(false);
        expect(attempts).toHaveLength(2);
    });

    it("stops waiting to retry once the download is cancelled", async () => {
        const updater = autoUpdater as unknown as {
            logger: { error(message: string): void };
            differentialDownloadInstaller: (...args: unknown[]) => Promise<boolean>;
        };
        let attempts = 0;
        updater.differentialDownloadInstaller = async function (this: typeof updater) {
            attempts += 1;
            this.logger.error("Cannot download differentially, fallback to full download: HttpError: 502");
            return true;
        };
        new UpdateManager(makeApp({ launchUpdateCheck: false, packaged: true }).app).initialize();
        const token = { cancelled: false };

        const result = updater.differentialDownloadInstaller({}, { cancellationToken: token });
        await vi.advanceTimersByTimeAsync(1_000);
        token.cancelled = true;
        await vi.advanceTimersByTimeAsync(250);

        // True hands the cancelled token to the updater's own full download, which rejects at once.
        await expect(result).resolves.toBe(true);
        expect(attempts).toBe(1);
    });
});

describe("UpdateManager after a failed download", () => {
    const realPlatform = process.platform;
    const dropped = () => new Error("HttpError: 502 Bad Gateway\nHeaders: {}");
    const settle = () => vi.advanceTimersByTimeAsync(0);

    beforeEach(() => {
        Object.defineProperty(process, "platform", { value: "win32" });
        vi.useFakeTimers();
        vi.mocked(autoUpdater.on).mockClear();
        vi.mocked(autoUpdater.setFeedURL).mockClear();
        vi.mocked(autoUpdater.downloadUpdate).mockReset().mockImplementation(() => new Promise(() => undefined));
        // A check answers the way electron-updater does: it announces what it found before resolving.
        vi.mocked(autoUpdater.checkForUpdates).mockReset().mockImplementation(async () => {
            updaterListener<{ version: string }>("update-available")({ version: "1.2.4" });
            return null as never;
        });
        vi.mocked(chooseUpdateSource).mockReset().mockResolvedValue(GITCODE_OFFER);
    });

    afterEach(() => {
        vi.useRealTimers();
        Object.defineProperty(process, "platform", { value: realPlatform });
    });

    function started(options: { autoDownloadSetting?: boolean } = {}) {
        const made = makeApp({ launchUpdateCheck: false, packaged: true, ...options });
        const manager = new UpdateManager(made.app);
        manager.initialize();
        return manager;
    }

    it("says the connection dropped, and schedules another try", async () => {
        vi.mocked(autoUpdater.downloadUpdate).mockRejectedValueOnce(dropped());
        const manager = started();

        await manager.check();
        await settle();

        const state = manager.getState();
        expect(state.status).toBe("error");
        expect(state.availableVersion).toBe("1.2.4");
        // The few words that name it, not the updater's message with its headers and stack.
        expect(state.error).toContain("HTTP 502");
        expect(state.error).not.toContain("Headers");
        expect(state.retryAt).toBe(Date.now() + UPDATE_RETRY_DELAYS_MS[0]);
    });

    it("tries again from the other source when it comes to the retry", async () => {
        vi.mocked(autoUpdater.downloadUpdate).mockRejectedValueOnce(dropped());
        const manager = started();
        await manager.check();
        await settle();

        await vi.advanceTimersByTimeAsync(UPDATE_RETRY_DELAYS_MS[0]);

        expect(vi.mocked(chooseUpdateSource).mock.calls.at(-1)?.[0].avoid).toEqual({ version: "1.2.4", source: "gitcode" });
        expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(2);
        expect(manager.getState().status).toBe("downloading");
        expect(manager.getState().retryAt).toBeUndefined();
    });

    it("downloads on Try Again even with automatic downloads off, as a download the author asked for", async () => {
        const manager = started({ autoDownloadSetting: false });
        await manager.check();
        expect(manager.getState().status).toBe("available");

        vi.mocked(autoUpdater.downloadUpdate).mockRejectedValueOnce(dropped());
        await manager.download();
        await settle();
        expect(manager.getState().status).toBe("error");

        await manager.download();
        await settle();

        expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(2);
        expect(manager.getState().status).toBe("downloading");
        expect(manager.isDownloadingOnRequest()).toBe(true);
    });

    it("stops trying on its own after the last scheduled attempt", async () => {
        vi.mocked(autoUpdater.downloadUpdate).mockReset().mockRejectedValue(dropped());
        const manager = started();
        await manager.check();
        await settle();

        for (const delay of UPDATE_RETRY_DELAYS_MS) {
            await vi.advanceTimersByTimeAsync(delay);
        }
        await vi.advanceTimersByTimeAsync(UPDATE_RETRY_DELAYS_MS.at(-1)! * 4);

        expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1 + UPDATE_RETRY_DELAYS_MS.length);
        expect(manager.getState().status).toBe("error");
        expect(manager.getState().retryAt).toBeUndefined();
    });

    it("keeps the version on offer when a retry's check cannot reach anything", async () => {
        vi.mocked(autoUpdater.downloadUpdate).mockRejectedValueOnce(dropped());
        const manager = started();
        await manager.check();
        await settle();

        vi.mocked(autoUpdater.checkForUpdates).mockRejectedValueOnce(new Error("net::ERR_INTERNET_DISCONNECTED"));
        await vi.advanceTimersByTimeAsync(UPDATE_RETRY_DELAYS_MS[0]);

        const state = manager.getState();
        expect(state.status).toBe("error");
        expect(state.availableVersion).toBe("1.2.4");
        expect(state.error).toContain("net::ERR_INTERNET_DISCONNECTED");
        expect(state.retryAt).toBe(Date.now() + UPDATE_RETRY_DELAYS_MS[1]);
    });
});
