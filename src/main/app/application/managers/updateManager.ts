import { spawn, type ChildProcess } from "child_process";
import os from "os";
import { autoUpdater, CancellationToken } from "electron-updater";
import { IPCEventType } from "@shared/types/ipcEvents";
import {
    UPDATE_AUTO_CHECK_DELAY_MS,
    UPDATE_AUTO_CHECK_KEY,
    UPDATE_AUTO_DOWNLOAD_KEY,
    UPDATE_RECHECK_INTERVAL_MS,
    UPDATE_RELEASES_URL,
    type UpdateState,
    type UpdateStatus,
} from "@shared/constants/update";
import { applyDownloadRewrite } from "./downloadRewrites";
import { studioFetch } from "./downloadProxy";
import { compareVersions } from "./updateVersions";
import {
    UPDATE_WAIT_PID_ENV,
    cleanUpAfterUpdate,
    installLayout,
    readPrepareProgress,
    readPreparedVersion,
    removeStagedCopy,
    updaterCacheDir,
    type InstallLayout,
} from "./updateStaging";
import type { BaseApp } from "../baseApp";

export { compareVersions } from "./updateVersions";

/** Where the check-only path reads the newest published release from. */
const GITHUB_LATEST_RELEASE_API = "https://api.github.com/repos/NarraLeaf/NarraLeaf-Studio/releases/latest";

/** A check that hangs is worse than one that fails: the panel would spin forever. */
const CHECK_TIMEOUT_MS = 15_000;

/** How often the unpacking progress the installer writes is read back while preparing. */
const PREPARE_POLL_MS = 500;

/**
 * How long after launch the leftovers of the last update are tidied. Late, so it never competes with
 * opening a project, and so the installer that started this Studio has finished deleting the old
 * version itself.
 */
const CLEAN_UP_DELAY_MS = 2 * 60_000;

/** The states in which a check would describe something other than what the process is doing. */
const BUSY_STATUSES: ReadonlySet<UpdateStatus> = new Set(["checking", "downloading", "preparing", "ready"]);

/**
 * Everything Studio knows about newer versions of itself.
 *
 * Two very different paths, chosen by {@link canSelfUpdate}:
 *
 * - **Windows, packaged** - electron-updater against the GitHub release the `v*` tag published, in
 *   three steps that all run while the author works: check, download, prepare. Preparing runs the
 *   downloaded installer with `--nl-prepare`, which unpacks the new version into the installation
 *   beside the running one (see `updateStaging.ts` for the layout). Applying it is then a swap of
 *   folders, so the restart the author asks for takes as long as any other restart instead of the
 *   minutes a full install keeps Studio closed. A version found by a check is downloaded and
 *   prepared without asking unless the author turned that off (`UPDATE_AUTO_DOWNLOAD_KEY`).
 * - **Everything else** - one GitHub API request and a version comparison, reported as `manual`.
 *   macOS cannot self-update at all until Studio is code-signed (Squirrel.Mac refuses an unsigned
 *   app, and the updater's mac channel wants a `zip` target we do not build); Linux is not
 *   published by `release.yml` at all; and an unpackaged development build has no
 *   `app-update.yml` to read. Saying so and linking to the download page is the honest answer -
 *   a disabled button on the one host a feature was written for is a mistake this codebase has
 *   made before.
 *
 * Every step that has not finished can be cancelled, and any step that fails leaves the update in
 * the state the step before it reached: a prepare that does not finish still leaves an installer
 * that the restart runs in full, exactly as every update ran before preparing existed.
 *
 * State is pushed, never polled. Every surface draws exactly what the downloader and the installer
 * report, so a progress ring moving means bytes arrived or files were unpacked.
 */
export class UpdateManager {
    private state: UpdateState;
    private wired = false;
    private autoCheckTimer: ReturnType<typeof setTimeout> | null = null;
    private recheckTimer: ReturnType<typeof setInterval> | null = null;
    private cleanUpTimer: ReturnType<typeof setTimeout> | null = null;
    /** The download in flight, so it can be cancelled. */
    private downloadToken: CancellationToken | null = null;
    /** Whether the download in flight was started by the author pressing Download. */
    private downloadByRequest = false;
    /** The installer for the version on offer, once it is on disk. */
    private downloaded: { file: string; version: string } | null = null;
    /** The installer unpacking the new version, while it runs. */
    private prepareProcess: ChildProcess | null = null;
    private preparePoll: ReturnType<typeof setInterval> | null = null;
    /**
     * A version the author cancelled in this session. Studio does not fetch it again on its own
     * initiative until the next launch; pressing Download still does.
     */
    private declinedVersion: string | null = null;

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

    /**
     * Whether quitting now would abandon a download the author asked for. The quit guard's only
     * question.
     *
     * A download Studio started on its own is not asked about: it resumes from the start on the next
     * launch, and a prompt standing between someone and quitting, about work they never requested,
     * is a prompt they did not need.
     */
    public isDownloadingOnRequest(): boolean {
        return this.state.status === "downloading" && this.downloadByRequest;
    }

    /**
     * Wire the updater and, if the author has not turned it off, schedule the checks.
     *
     * Called once the app is ready. The first check waits a few seconds so it never competes with
     * opening a project: it is the least urgent thing Studio does at start-up. Later checks follow
     * every {@link UPDATE_RECHECK_INTERVAL_MS}, because a Studio left in the notification area can
     * run for days.
     *
     * The checks are the half a command-line run does not get: `--build`, `--test` and `--lint`
     * answer one question and ask nothing of the network on the way. See `startupExtras.ts`. The
     * wiring above it still happens, so anything that reads this state in a run reads a true one -
     * only the requests are missing.
     */
    public initialize(): void {
        this.state = { ...this.state, currentVersion: this.app.getAppInfo().version };

        if (this.canSelfUpdate()) {
            this.wireAutoUpdater();
        }

        if (!this.app.getStartupExtras().launchUpdateCheck) {
            this.app.logger.info("[Update] No launch check: this is a command-line run.");
            return;
        }

        if (this.canSelfUpdate()) {
            this.cleanUpTimer = setTimeout(() => {
                this.cleanUpTimer = null;
                void this.cleanUp();
            }, CLEAN_UP_DELAY_MS);
        }

        // Read at every tick rather than once, so turning the setting on or off takes effect without
        // a restart.
        this.recheckTimer = setInterval(() => {
            if (this.autoCheckEnabled()) {
                void this.check().catch(() => undefined);
            }
        }, UPDATE_RECHECK_INTERVAL_MS);

        if (!this.autoCheckEnabled()) {
            this.app.logger.info("[Update] Launch check is off.");
            return;
        }
        this.autoCheckTimer = setTimeout(() => {
            this.autoCheckTimer = null;
            void this.check().catch(() => undefined);
        }, UPDATE_AUTO_CHECK_DELAY_MS);
    }

    public dispose(): void {
        for (const timer of [this.autoCheckTimer, this.cleanUpTimer]) {
            if (timer) {
                clearTimeout(timer);
            }
        }
        this.autoCheckTimer = null;
        this.cleanUpTimer = null;
        if (this.recheckTimer) {
            clearInterval(this.recheckTimer);
            this.recheckTimer = null;
        }
        this.stopPreparing();
    }

    private autoCheckEnabled(): boolean {
        return this.app.globalState.get(UPDATE_AUTO_CHECK_KEY) !== false;
    }

    private autoDownloadEnabled(): boolean {
        return this.app.globalState.get(UPDATE_AUTO_DOWNLOAD_KEY) !== false;
    }

    private layout(): InstallLayout {
        return installLayout(process.execPath);
    }

    private wireAutoUpdater(): void {
        if (this.wired) {
            return;
        }
        this.wired = true;

        // Studio decides when to download (see `takesOnItsOwn`), so the updater never starts one itself.
        autoUpdater.autoDownload = false;
        // Left on for the whole session, because the updater registers its quit handler only if
        // this is on at the moment a download completes. Whether a quit actually applies the update
        // is decided on the way out (`beforeQuit`), when the state that decides it is known.
        autoUpdater.autoInstallOnAppQuit = true;
        // Read by quitAndInstall when the run is not silent; it is what puts --force-run on the
        // installer's command line, and so what brings Studio back after "restart to update".
        autoUpdater.autoRunAppAfterInstall = true;
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
            if (this.takesOnItsOwn(info.version)) {
                // Straight to downloading, without passing through "available": every surface that
                // announces an offer would otherwise announce one that is already being acted on.
                this.state = { ...this.state, availableVersion: info.version, releaseUrl: UPDATE_RELEASES_URL, error: undefined };
                void this.beginDownload(false);
                return;
            }
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
            // A cancelled download can still report the chunk that was in flight.
            if (this.downloadToken === null || this.downloadToken.cancelled) {
                return;
            }
            this.setState({
                status: "downloading",
                transferredBytes: progress.transferred,
                totalBytes: progress.total,
                bytesPerSecond: progress.bytesPerSecond,
            });
        });
        autoUpdater.on("update-downloaded", info => {
            this.downloadToken = null;
            this.downloadByRequest = false;
            this.downloaded = info.downloadedFile ? { file: info.downloadedFile, version: info.version } : null;
            void this.prepare(info.version);
        });
        // A cancelled download never arrives here: the updater does not report cancellation as an
        // error, and `cancel` has already said what happened.
        autoUpdater.on("error", error => {
            this.fail(error);
        });

        this.app.electronApp?.on("will-quit", () => this.beforeQuit());
    }

    /**
     * Whether a version a check has just found is downloaded straight away: yes, unless the author
     * turned that off or cancelled this very version earlier in the session.
     */
    private takesOnItsOwn(version: string): boolean {
        return this.autoDownloadEnabled() && this.declinedVersion !== version;
    }

    /**
     * Ask whether there is a newer version.
     *
     * Refuses while anything is in flight or an update is waiting to be applied - each would leave
     * the surfaces showing a state that is no longer what the process is doing. A newer release
     * published in the meantime is found by the first check after the restart.
     */
    public async check(): Promise<UpdateState> {
        if (BUSY_STATUSES.has(this.state.status)) {
            return this.state;
        }

        if (this.canSelfUpdate()) {
            try {
                await autoUpdater.checkForUpdates();
            } catch (error) {
                // The listener above has usually already reported this; reporting it again is
                // harmless and covers a rejection that never reached the 'error' event.
                this.fail(error);
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
            const response = await studioFetch(url, {
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

    /** Start downloading the offered update, because the author pressed Download. */
    public async download(): Promise<UpdateState> {
        return this.startDownload(true);
    }

    private async startDownload(byRequest: boolean): Promise<UpdateState> {
        if (!this.canSelfUpdate()) {
            return this.state;
        }
        if (this.state.status !== "available" && this.state.status !== "error") {
            return this.state;
        }
        if (byRequest) {
            this.declinedVersion = null;
        }
        return this.beginDownload(byRequest);
    }

    private async beginDownload(byRequest: boolean): Promise<UpdateState> {
        const token = new CancellationToken();
        this.downloadToken = token;
        this.downloadByRequest = byRequest;
        this.setState({ status: "downloading", transferredBytes: 0, totalBytes: undefined, bytesPerSecond: undefined, error: undefined });
        try {
            await autoUpdater.downloadUpdate(token);
        } catch (error) {
            // A cancelled download rejects too; `cancel` has already put the state back.
            if (!token.cancelled) {
                this.fail(error);
            }
        } finally {
            if (this.downloadToken === token) {
                this.downloadToken = null;
            }
        }
        return this.state;
    }

    /**
     * Stop the update in progress: the download, or the unpacking that follows it.
     *
     * The version is remembered as declined for the rest of the session, so the next automatic
     * check does not start it again behind the author's back; Download still does. What has been
     * downloaded is kept by the updater, so taking the update later does not download it twice.
     */
    public cancel(): UpdateState {
        const version = this.state.availableVersion ?? null;
        if (this.state.status === "downloading" && this.downloadToken) {
            const token = this.downloadToken;
            this.downloadToken = null;
            this.downloadByRequest = false;
            this.declinedVersion = version;
            token.cancel();
            this.app.logger.info(`[Update] Download of ${version ?? "the update"} cancelled.`);
            this.offerAgain();
        } else if (this.state.status === "preparing") {
            this.declinedVersion = version;
            this.stopPreparing();
            this.app.logger.info(`[Update] Preparing ${version ?? "the update"} cancelled.`);
            this.offerAgain();
            // The half-unpacked copy is no use to anyone; the next prepare would delete it anyway.
            void removeStagedCopy(this.layout());
        }
        return this.state;
    }

    /** Back to "a newer version exists", which is what remains true after a cancel. */
    private offerAgain(): void {
        this.setState({
            status: "available",
            transferredBytes: undefined,
            totalBytes: undefined,
            bytesPerSecond: undefined,
            prepareProgress: undefined,
            fastRestart: undefined,
            error: undefined,
        });
    }

    /**
     * Unpack the downloaded version beside the running one.
     *
     * A copy an earlier session already prepared for this same version is used as it is - the
     * download is still on disk from that session, and so is the copy. Otherwise the installer runs
     * with `--nl-prepare`, silently and below normal priority, and reports how far it has got in a
     * file this polls. The copy is only trusted once the installer has written the version into it,
     * which it does last; any other ending leaves the update ready for a full install instead.
     */
    private async prepare(version: string): Promise<void> {
        const installer = this.downloaded;
        if (!installer || installer.version !== version) {
            this.becomeReady(version, false);
            return;
        }
        const layout = this.layout();
        if (await readPreparedVersion(layout) === version) {
            this.app.logger.info(`[Update] ${version} is already prepared.`);
            this.becomeReady(version, true);
            return;
        }

        this.setState({
            status: "preparing",
            availableVersion: version,
            prepareProgress: 0,
            transferredBytes: undefined,
            totalBytes: undefined,
            bytesPerSecond: undefined,
            error: undefined,
        });

        let child: ChildProcess;
        try {
            child = spawn(installer.file, ["--nl-prepare", "/S"], { windowsHide: true, stdio: "ignore" });
        } catch (error) {
            this.app.logger.warn(`[Update] Could not start preparing ${version}: ${describeError(error)}`);
            this.becomeReady(version, false);
            return;
        }
        this.prepareProcess = child;
        this.app.logger.info(`[Update] Preparing ${version} in ${layout.stagedDir}.`);
        if (child.pid !== undefined) {
            try {
                os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
            } catch {
                // Normal priority is slower for the author, not wrong.
            }
        }

        this.preparePoll = setInterval(() => {
            void readPrepareProgress(layout).then(progress => {
                if (progress === null || this.prepareProcess !== child || this.state.status !== "preparing") {
                    return;
                }
                // Pushed only when it moves: every push reaches each window and rebuilds the tray menu.
                if (progress !== this.state.prepareProgress) {
                    this.setState({ status: "preparing", prepareProgress: progress });
                }
            });
        }, PREPARE_POLL_MS);

        child.once("error", error => {
            this.app.logger.warn(`[Update] Preparing ${version} failed to run: ${describeError(error)}`);
            void this.finishPreparing(child, version, null);
        });
        child.once("exit", code => {
            void this.finishPreparing(child, version, code);
        });
    }

    private async finishPreparing(child: ChildProcess, version: string, code: number | null): Promise<void> {
        // Cancelled, or superseded: whoever stopped it has already said what happens next.
        if (this.prepareProcess !== child) {
            return;
        }
        this.stopPreparing();
        const prepared = await readPreparedVersion(this.layout());
        if (prepared === version) {
            this.app.logger.info(`[Update] ${version} is prepared.`);
            this.becomeReady(version, true);
            return;
        }
        this.app.logger.warn(`[Update] Preparing ${version} did not finish (exit code ${code ?? "none"}); the restart will run the full install.`);
        this.becomeReady(version, false);
    }

    /** Stop the installer that is unpacking, if one is. */
    private stopPreparing(): void {
        if (this.preparePoll) {
            clearInterval(this.preparePoll);
            this.preparePoll = null;
        }
        const child = this.prepareProcess;
        this.prepareProcess = null;
        if (child && child.exitCode === null && !child.killed) {
            try {
                child.kill();
            } catch {
                // Already gone.
            }
        }
    }

    private becomeReady(version: string, fastRestart: boolean): void {
        this.setState({
            status: "ready",
            availableVersion: version,
            fastRestart,
            prepareProgress: undefined,
            transferredBytes: undefined,
            totalBytes: undefined,
            bytesPerSecond: undefined,
            error: undefined,
        });
    }

    /**
     * Quit and apply the update.
     *
     * Not silent. When the new version is prepared, the installer swaps the folders and starts the
     * new Studio before it has drawn anything, so there is nothing to see; when it is not, the
     * installer recognises the `--updated` the updater passes and shows a window that only says
     * Studio is being updated and how far it has got, until the new Studio has a window
     * (project/installer/installer.nsh, "the update").
     *
     * `--force-run` is what tells the installer to start Studio again, so `autoRunAppAfterInstall`
     * is pinned on in `wireAutoUpdater`: for a run that is not silent, electron-updater takes the
     * force-run flag from that setting rather than from the second argument here.
     *
     * Quitting with an update ready, rather than pressing this, still applies it silently: the user
     * asked Studio to go away, so nothing appears and nothing starts afterwards. See `beforeQuit`.
     */
    public installNow(): void {
        if (this.state.status !== "ready") {
            return;
        }
        this.app.logger.info(`[Update] Quitting to install${this.state.fastRestart ? " the prepared update" : ""}.`);
        process.env[UPDATE_WAIT_PID_ENV] = String(process.pid);
        autoUpdater.quitAndInstall(false, true);
    }

    /**
     * The quit is certain: decide whether it applies the update.
     *
     * Only an update that is ready is applied on the way out. One that is still preparing is stopped
     * where it is and resumes on the next launch, where the download is found already on disk; one
     * the author cancelled is not applied at all.
     *
     * The installer is told which process to wait for before it moves anything, because it is
     * started while this one is still exiting.
     */
    private beforeQuit(): void {
        this.stopPreparing();
        const apply = this.state.status === "ready";
        autoUpdater.autoInstallOnAppQuit = apply;
        if (apply) {
            process.env[UPDATE_WAIT_PID_ENV] = String(process.pid);
        }
    }

    /** See {@link cleanUpAfterUpdate}. */
    private async cleanUp(): Promise<void> {
        try {
            const cache = await updaterCacheDir(process.resourcesPath, process.env.LOCALAPPDATA);
            const result = await cleanUpAfterUpdate({
                layout: this.layout(),
                currentVersion: this.state.currentVersion,
                updaterCache: cache,
                log: message => this.app.logger.warn("[Update]", message),
            });
            if (result.removed.length > 0) {
                this.app.logger.info(`[Update] Removed what the last update left behind: ${result.removed.join(", ")}`);
            }
        } catch (error) {
            this.app.logger.warn(`[Update] Tidying up after the last update failed: ${describeError(error)}`);
        }
    }

    /**
     * Report a failure. One that happened while checking says nothing about any version, so the one
     * on offer is dropped with it; one that happened while downloading keeps it, because that
     * version is still there to retry.
     */
    private fail(error: unknown): void {
        if (this.state.status === "error" && this.state.error === describeError(error)) {
            return;
        }
        const duringCheck = this.state.status === "checking";
        this.setState({
            status: "error",
            error: describeError(error),
            ...(duringCheck ? { availableVersion: undefined } : {}),
            transferredBytes: undefined,
            totalBytes: undefined,
            bytesPerSecond: undefined,
            prepareProgress: undefined,
        });
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
