import { autoUpdater } from "electron-updater";
import { IPCEventType } from "@shared/types/ipcEvents";
import {
    UPDATE_AUTO_CHECK_DELAY_MS,
    UPDATE_AUTO_CHECK_KEY,
    UPDATE_RELEASES_URL,
    type UpdateState,
    type UpdateStatus,
} from "@shared/constants/update";
import { applyDownloadRewrite } from "./downloadRewrites";
import type { BaseApp } from "../baseApp";

/** Where the check-only path reads the newest published release from. */
const GITHUB_LATEST_RELEASE_API = "https://api.github.com/repos/NarraLeaf/NarraLeaf-Studio/releases/latest";

/** A check that hangs is worse than one that fails: the panel would spin forever. */
const CHECK_TIMEOUT_MS = 15_000;

/**
 * Compare two `X.Y.Z` versions, ignoring any pre-release suffix beyond ordering it below the
 * release it belongs to. Returns >0 when `a` is newer.
 *
 * Hand-rolled rather than pulled from `semver`, which is only in the tree as somebody else's
 * transitive dependency - importing it here would make an update check depend on a package this
 * app never declared, and it would keep working right up until a fresh install hoisted it
 * somewhere else. The comparison Studio needs is the whole of what its own tags use.
 */
export function compareVersions(a: string, b: string): number {
    const parse = (value: string) => {
        const [core, prerelease] = value.replace(/^v/i, "").split("-", 2);
        const parts = core.split(".").map(part => Number.parseInt(part, 10) || 0);
        return { parts, prerelease: prerelease ?? "" };
    };
    const left = parse(a);
    const right = parse(b);
    for (let index = 0; index < 3; index += 1) {
        const diff = (left.parts[index] ?? 0) - (right.parts[index] ?? 0);
        if (diff !== 0) {
            return diff > 0 ? 1 : -1;
        }
    }
    // 1.0.0 beats 1.0.0-rc1; two pre-releases of the same version compare lexically, which is
    // enough to stop Studio offering someone the build they are already running.
    if (left.prerelease === right.prerelease) {
        return 0;
    }
    if (!left.prerelease) {
        return 1;
    }
    if (!right.prerelease) {
        return -1;
    }
    return left.prerelease > right.prerelease ? 1 : -1;
}

/**
 * Everything Studio knows about newer versions of itself.
 *
 * Two very different paths, chosen by {@link canSelfUpdate}:
 *
 * - **Windows, packaged** - electron-updater against the GitHub release the `v*` tag published.
 *   `autoDownload` is off: the installer is ~270 MB and downloading that behind someone's back on
 *   a metered connection is not a decision this app gets to make. So a check only ever produces
 *   an offer, and the download starts when the user presses the button in Settings.
 * - **Everything else** - one GitHub API request and a version comparison, reported as `manual`.
 *   macOS cannot self-update at all until Studio is code-signed (Squirrel.Mac refuses an unsigned
 *   app, and the updater's mac channel wants a `zip` target we do not build); Linux is not
 *   published by `release.yml` at all; and an unpackaged development build has no
 *   `app-update.yml` to read. Saying so and linking to the download page is the honest answer -
 *   a disabled button on the one host a feature was written for is a mistake this codebase has
 *   made before.
 *
 * State is pushed, never polled. The Settings panel draws exactly what the downloader reports,
 * so a progress bar moving means bytes arrived.
 */
export class UpdateManager {
    private state: UpdateState;
    private wired = false;
    private autoCheckTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly app: BaseApp) {
        this.state = {
            status: "idle",
            currentVersion: "",
            canInstall: this.canSelfUpdate(),
        };
    }

    /**
     * Whether this build can download and apply an update itself.
     *
     * Packaged Windows only, for the reasons in the class header. Read once per call rather than
     * cached so a development build reports the same answer the panel shows.
     */
    public canSelfUpdate(): boolean {
        return this.app.isPackaged() && process.platform === "win32";
    }

    public getState(): UpdateState {
        return this.state;
    }

    /** True while an installer is coming down. The quit guard's only question. */
    public isDownloading(): boolean {
        return this.state.status === "downloading";
    }

    /**
     * Wire the updater and, if the author has not turned it off, schedule the launch check.
     *
     * Called once the app is ready. The delay exists so the check never competes with opening a
     * project: it is the least urgent thing Studio does at start-up.
     */
    public initialize(): void {
        this.state = { ...this.state, currentVersion: this.app.getAppInfo().version };

        if (this.canSelfUpdate()) {
            this.wireAutoUpdater();
        }

        if (this.app.globalState.get(UPDATE_AUTO_CHECK_KEY) === false) {
            this.app.logger.info("[Update] Launch check is off.");
            return;
        }
        this.autoCheckTimer = setTimeout(() => {
            this.autoCheckTimer = null;
            void this.check().catch(() => undefined);
        }, UPDATE_AUTO_CHECK_DELAY_MS);
    }

    public dispose(): void {
        if (this.autoCheckTimer) {
            clearTimeout(this.autoCheckTimer);
            this.autoCheckTimer = null;
        }
    }

    private wireAutoUpdater(): void {
        if (this.wired) {
            return;
        }
        this.wired = true;

        // Never behind the user's back: see the class header.
        autoUpdater.autoDownload = false;
        // Once an installer *is* on disk, applying it on the way out is the whole point - the
        // alternative is asking a second time about work the user already agreed to.
        autoUpdater.autoInstallOnAppQuit = true;
        autoUpdater.logger = {
            info: (message: unknown) => this.app.logger.info("[Update]", message),
            warn: (message: unknown) => this.app.logger.warn("[Update]", message),
            error: (message: unknown) => this.app.logger.error("[Update]", message),
            debug: (message: unknown) => this.app.logger.debug("[Update]", message),
        };

        autoUpdater.on("checking-for-update", () => {
            this.setState({ status: "checking", error: undefined });
        });
        autoUpdater.on("update-available", info => {
            this.setState({
                status: "available",
                availableVersion: info.version,
                releaseUrl: UPDATE_RELEASES_URL,
                error: undefined,
            });
        });
        autoUpdater.on("update-not-available", () => {
            this.setState({ status: "idle", availableVersion: undefined, error: undefined });
        });
        autoUpdater.on("download-progress", progress => {
            this.setState({
                status: "downloading",
                transferredBytes: progress.transferred,
                totalBytes: progress.total,
                bytesPerSecond: progress.bytesPerSecond,
            });
        });
        autoUpdater.on("update-downloaded", info => {
            this.setState({
                status: "ready",
                availableVersion: info.version,
                transferredBytes: undefined,
                totalBytes: undefined,
                bytesPerSecond: undefined,
            });
        });
        autoUpdater.on("error", error => {
            this.setState({ status: "error", error: describeError(error) });
        });
    }

    /**
     * Ask whether there is a newer version.
     *
     * Refuses to start a second check, and refuses to interrupt a download - both would leave the
     * panel showing a state that is no longer what the process is doing.
     */
    public async check(): Promise<UpdateState> {
        if (this.state.status === "checking" || this.state.status === "downloading") {
            return this.state;
        }

        if (this.canSelfUpdate()) {
            try {
                await autoUpdater.checkForUpdates();
            } catch (error) {
                // The listener above has usually already reported this; setting it again is
                // harmless and covers a rejection that never reached the 'error' event.
                this.setState({ status: "error", error: describeError(error) });
            }
            return this.state;
        }

        return this.checkViaGitHub();
    }

    /**
     * The check-only path: one request to the releases API, one comparison.
     *
     * Goes through `applyDownloadRewrite` so an author behind a mirror can reach it. The
     * *download* is not rewritten - electron-updater resolves its own URLs from `app-update.yml`,
     * and pointing it at a mirror means a `generic` feed whose layout has to match GitHub's
     * release URLs exactly. That is a separate piece of work, not a line here; until it exists an
     * author on a mirror can still see that an update exists and fetch it from the page.
     */
    private async checkViaGitHub(): Promise<UpdateState> {
        this.setState({ status: "checking", error: undefined });
        try {
            const url = applyDownloadRewrite(GITHUB_LATEST_RELEASE_API, message => this.app.logger.info("[Update]", message));
            const response = await fetch(url, {
                headers: { Accept: "application/vnd.github+json" },
                signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
            });
            if (!response.ok) {
                this.setState({ status: "error", error: `GitHub answered ${response.status}` });
                return this.state;
            }
            const payload = await response.json() as { tag_name?: unknown; html_url?: unknown };
            const tag = typeof payload.tag_name === "string" ? payload.tag_name : "";
            if (!tag) {
                this.setState({ status: "error", error: "The latest release has no tag." });
                return this.state;
            }

            const latest = tag.replace(/^v/i, "");
            if (compareVersions(latest, this.state.currentVersion) <= 0) {
                this.setState({ status: "idle", availableVersion: undefined });
                return this.state;
            }
            this.setState({
                status: "manual",
                availableVersion: latest,
                releaseUrl: typeof payload.html_url === "string" ? payload.html_url : UPDATE_RELEASES_URL,
            });
        } catch (error) {
            this.setState({ status: "error", error: describeError(error) });
        }
        return this.state;
    }

    /**
     * Start downloading the offered update.
     *
     * Only ever reached from a press in Settings - the notification's action opens the panel, it
     * does not start a download. That is deliberate: the offer and the ~270 MB commitment are two
     * different decisions, and a toast is not where the second one belongs.
     */
    public async download(): Promise<UpdateState> {
        if (!this.canSelfUpdate()) {
            return this.state;
        }
        if (this.state.status !== "available" && this.state.status !== "error") {
            return this.state;
        }
        this.setState({ status: "downloading", transferredBytes: 0, totalBytes: undefined, error: undefined });
        try {
            await autoUpdater.downloadUpdate();
        } catch (error) {
            this.setState({ status: "error", error: describeError(error) });
        }
        return this.state;
    }

    /**
     * Quit and apply the downloaded installer.
     *
     * `isSilent` is not optional. Studio's installer is now an assisted wizard (welcome, install
     * mode, directory, finish), and without it every update would walk the user back through all
     * of it - including a directory page for a directory they already chose. NSIS reads the
     * existing `InstallLocation` from the registry, so a silent run lands where the app already
     * is. `isForceRunAfter` brings Studio back, which is what "install now" implies.
     */
    public installNow(): void {
        if (this.state.status !== "ready") {
            return;
        }
        this.app.logger.info("[Update] Quitting to install.");
        autoUpdater.quitAndInstall(true, true);
    }

    private setState(patch: Partial<UpdateState> & { status: UpdateStatus }): void {
        this.state = { ...this.state, ...patch, canInstall: this.canSelfUpdate() };
        this.broadcast();
        // The tray's update row says what the state is, so it has to be rebuilt with it.
        this.app.trayManager?.rebuildMenu();
    }

    private broadcast(): void {
        for (const window of this.app.windowManager.getWindows()) {
            if (window.isClosed()) {
                continue;
            }
            try {
                window.sendIpcEvent(IPCEventType.appUpdateStateChanged, { state: this.state });
            } catch (error) {
                this.app.logger.debug(`[Update] Failed to push state to a window: ${String(error)}`);
            }
        }
    }
}

/** Updater failures arrive as Errors, strings, and occasionally objects. All of them get read. */
function describeError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
