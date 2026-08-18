// Electron
import { app, dialog, nativeTheme } from "electron/main";
import { crashReporter } from "electron";

// Utils
import fs from "fs";
import { Platform, PlatformInfo } from "@shared/types/os";
import { Logger } from "@shared/utils/logger";
import EventEmitter from "events";

// Managers
import { AppEventToken, AppInfo } from "@shared/types/app";
import { IPCEventType } from "@shared/types/ipcEvents";
import { getLocaleRegistryVersion, setLocaleContributions } from "@shared/i18n";
import { GlobalStateKeys, GlobalStateValue } from "@shared/types/state/globalState";
import { WindowAppType } from "@shared/types/window";
import { readJson } from "@shared/utils/json";
import { safeExecuteFn } from "@shared/utils/os";
import { StringKeyOf } from "@shared/utils/types";
import path from "path";
import { MenuManager } from "./managers/menuManager";
import { TrayManager } from "./managers/trayManager";
import { ProtocolManager } from "./managers/protocolManager";
import { StorageManager } from "./managers/storageManager";
import { WindowManager } from "./managers/windowManager";
import { GlobalStateManager } from "./managers/storage/globalState";
import { DOWNLOAD_REWRITES_KEY, setDownloadRewriteSource } from "./managers/downloadRewrites";
import { sweepPsdTempDirectories } from "./managers/storage/cacheInventory";
import { PluginPermissionManager } from "./managers/pluginPermissionManager";
import { PluginManager } from "./managers/pluginManager";
import { PluginIconCache } from "./managers/pluginIconCache";
import { UITemplatePosterCache } from "./managers/uiTemplatePosterCache";
import { isMainDevMode, parseMainCommandLine } from "./commandLine";
import { applyThemeMode, getWindowBackgroundColor } from "./theme";
import { StudioDebugServer } from "./managers/debug/studioDebugServer";
import { installFileLogSink } from "./logging/fileLogSink";
import { getMainTranslator } from "./i18n";
import { APP_DISPLAY_NAME } from "@shared/constants/app";

export interface AppDependencies {
  protocolManager: ProtocolManager;
  windowManager: WindowManager;
  storageManager: StorageManager;
}
export interface BaseAppConfig {}

export type AppEvents = {
  ready: [];
  "ready-failed": [error: Error];
};

/** What a dev-server reload broadcast asks for. Mirrors dev-electron.js. */
type DevReloadTarget = "all" | "workspace" | "builtin-plugins";

export class BaseApp {
  public static Events = {
    Ready: "ready",
    ReadyFailed: "ready-failed"
  } as const;

  public readonly electronApp: Electron.App;
  public readonly platform: PlatformInfo;
  public readonly events: EventEmitter<AppEvents>;
  public readonly config: BaseAppConfig;
  public readonly logger: Logger;

  public readonly protocolManager: ProtocolManager;
  public readonly windowManager: WindowManager;
  public readonly menuManager: MenuManager;
  public readonly storageManager: StorageManager;
  public readonly globalState: GlobalStateManager;
  public readonly pluginPermissionManager: PluginPermissionManager;
  public readonly pluginManager: PluginManager;
  public readonly pluginIconCache: PluginIconCache;
  public readonly uiTemplatePosterCache: UITemplatePosterCache;
  /**
   * The status-bar item, once `App` has built it. Null on macOS, which deliberately has none,
   * and null until the app is ready.
   *
   * Assigned by the subclass rather than constructed here because its menu drives the launcher
   * and the Settings window, neither of which this class knows about. What this class does own
   * is the language, so it is the one that has to ask for a rebuild.
   */
  public trayManager: TrayManager | null = null;

  private initialized: boolean = false;
  private readyError: Error | null = null;
  private quitting: boolean = false;
  protected appInfo: AppInfo | null = null;
  private readonly commandLine = parseMainCommandLine(process.argv);
  private debugServer: StudioDebugServer | null = null;

  constructor(config: BaseAppConfig) {
    this.config = config;
    this.electronApp = app;
    this.electronApp.on("before-quit", () => {
      this.quitting = true;
    });
    // Take the icon down ourselves rather than leaving it to the shell. Windows only reaps a
    // notification icon whose owner is gone when something makes it check - usually a mouse
    // moving over it - so an icon that is not deleted stays on screen, and clicking it does
    // nothing. `will-quit` rather than `before-quit`: the latter fires on quits that are still
    // cancellable (an update still downloading asks, and `cancelQuit()` puts the session back),
    // and a Studio that stayed open with no window and no icon has no handle left at all.
    this.electronApp.on("will-quit", () => {
      this.trayManager?.destroy();
      this.trayManager = null;
    });
    // Studio outlives its windows: closing the last one leaves it in the status bar (Windows,
    // Linux) or the Dock (macOS), which is what makes "finish this update in the background"
    // possible at all. Electron's built-in behaviour is the opposite - with no listener at
    // all it quits the app on non-darwin platforms - so this empty listener is the whole
    // mechanism, not a placeholder. What actually brings a surface back is
    // `App.handleLastWindowClosed`.
    this.electronApp.on("window-all-closed", () => {
      this.logger.info("[App] Last window closed; staying resident.");
    });
    this.electronApp.setName(APP_DISPLAY_NAME);
    this.electronApp.setAboutPanelOptions({
      applicationName: APP_DISPLAY_NAME
    });
    this.platform = Platform.getInfo(process, this.electronApp.isPackaged);
    this.logger = new Logger("MainProcess");
    this.events = new EventEmitter();

    this.configureCdp();
    this.setupUserDataDir();
    this.setupLogging();

    this.globalState = new GlobalStateManager(this.getUserDataDir());
    // Before any window exists, so nothing has read a retired value and there is nothing to
    // broadcast to. Silent on a profile that never carried them.
    const sweptKeys = this.globalState.sweepRetiredKeys();
    if (sweptKeys.length > 0) {
      this.logger.info(
        `[App] Removed ${sweptKeys.length} retired setting(s): ${sweptKeys.join(", ")}`
      );
    }
    // Read through on every download rather than snapshotted: a mirror typed in the Settings
    // window has to apply to the next fetch, not the next launch.
    setDownloadRewriteSource(() => this.globalState.get(DOWNLOAD_REWRITES_KEY));
    this.pluginPermissionManager = new PluginPermissionManager(this.getUserDataDir());
    this.pluginManager = new PluginManager(this.getUserDataDir(), this.pluginPermissionManager, {
      builtInPluginsDir: this.getBuiltInPluginsDir()
    });
    this.pluginIconCache = new PluginIconCache(this.getUserDataDir());
    this.uiTemplatePosterCache = new UITemplatePosterCache(this.getUserDataDir());

    this.protocolManager = new ProtocolManager(this);
    this.windowManager = new WindowManager(this);
    this.menuManager = new MenuManager(this);
    this.storageManager = new StorageManager(this);

    this.setupCrashObservability();

    // Every PSD import used to leave a directory of full-canvas PNGs in the system temp folder
    // forever. The handler now clears its own as it goes; this collects what earlier versions
    // left, and anything a killed session abandoned. Best-effort by design - a temp directory
    // that will not delete is not a reason to fail startup.
    void sweepPsdTempDirectories()
      .then((removed) => {
        if (removed > 0) {
          this.logger.info(`[App] Removed ${removed} leftover PSD import folder(s)`);
        }
      })
      .catch(() => undefined);

    void this.prepare().catch((error) => this.failBootstrap(error));
  }

  /**
   * Persist a global-state value, fan it out to every open window, and run the
   * main-process side effects the key carries.
   *
   * The one write path for global state: the Settings window arrives here over
   * IPC, and the zoom shortcuts call it directly. Keeping it in one place is
   * what lets a keystroke in one window re-zoom all of them.
   */
  public setGlobalStateAndBroadcast<K extends GlobalStateKeys>(
    key: K,
    value: GlobalStateValue<K>
  ): void {
    this.globalState.set(key, value);

    for (const window of this.windowManager.getWindows()) {
      if (window.isClosed()) {
        continue;
      }
      try {
        window.sendIpcEvent(IPCEventType.appGlobalStateChanged, { key, value });
      } catch (error) {
        this.logger.debug(`Failed to broadcast global state change to a window: ${String(error)}`);
      }
    }

    this.runGlobalStateSideEffects(key, value);
  }

  /**
   * Remove a stored value and tell every window it is gone.
   *
   * The broadcast carries `undefined`, which every renderer-side reader already has to handle:
   * it is what `getGlobalState` returns for a key that was never written. That is the whole
   * point of deleting rather than writing a default - `ui.background*` and
   * `editor.slashAtAlias` only reach their real fallback when nothing is stored.
   *
   * The per-key side effects run afterwards exactly as they do for a write, so resetting the
   * theme or the zoom applies rather than waiting for a restart.
   */
  public deleteGlobalStateAndBroadcast<K extends GlobalStateKeys>(key: K): void {
    this.globalState.delete(key);

    for (const window of this.windowManager.getWindows()) {
      if (window.isClosed()) {
        continue;
      }
      try {
        window.sendIpcEvent(IPCEventType.appGlobalStateChanged, { key, value: undefined });
      } catch (error) {
        this.logger.debug(`Failed to broadcast global state delete to a window: ${String(error)}`);
      }
    }

    this.runGlobalStateSideEffects(key, this.globalState.get(key));
  }

  /**
   * What the main process itself has to do when a key changes, for the keys it owns.
   *
   * Extracted so a delete runs them with the resolved default in hand; before there was a
   * delete channel, a write was the only way a value could ever change.
   */
  private runGlobalStateSideEffects<K extends GlobalStateKeys>(
    key: K,
    value: GlobalStateValue<K>
  ): void {
    // The language also drives the native application menu, which is owned by
    // the main process and must be rebuilt here.
    if (key === "app.language") {
      this.menuManager.updateMenu();
      // Same reasoning as the native menu, and the same blind spot: the tray menu is built
      // in the main process from a translator snapshot, so nothing about the renderer-side
      // language broadcast reaches it.
      this.trayManager?.rebuildMenu();
    }

    // The "Open Recent" submenu is built from this list, so a change here - most
    // visibly the launcher removing a project - has to rebuild the native menu, or it
    // keeps offering a project the user just deleted. Renderer surfaces refresh from the
    // broadcast above; the native menu is main-process-owned and does not see it.
    if (key === "app.recentProjects") {
      this.menuManager.updateMenu();
    }

    // The theme is owned by the main process: nativeTheme drives
    // prefers-color-scheme in every renderer (which flips the CSS tokens) plus
    // native chrome. Window background colors follow via the nativeTheme
    // "updated" listener in prepare().
    if (key === "ui.themeMode") {
      applyThemeMode(value);
    }

    // Zoom is a per-webContents property, so unlike the theme it has to be
    // pushed to each window rather than resolved from one switch.
    if (key === "ui.zoomPercent") {
      for (const window of this.windowManager.getWindows()) {
        if (!window.isClosed()) {
          window.applyStoredZoom();
        }
      }
    }
  }

  /**
   * Aggregate every enabled plugin's Studio language-pack contributions, push
   * them into this process's locale registry (so the native menu localizes),
   * rebuild the native menu, and notify every window to re-fetch + re-localize.
   * Call at startup and whenever the enabled plugin set changes
   * (install/enable/disable/uninstall).
   */
  public async refreshPluginLocales(): Promise<void> {
    try {
      const contributions = await this.pluginManager.listLocaleContributions();
      setLocaleContributions(contributions, {
        onWarn: (message) => this.logger.warn(message)
      });
    } catch (error) {
      this.logger.warn(`Failed to aggregate plugin locale contributions: ${String(error)}`);
    }

    this.menuManager.updateMenu();

    const version = getLocaleRegistryVersion();
    for (const window of this.windowManager.getWindows()) {
      if (window.isClosed()) {
        continue;
      }
      try {
        window.sendIpcEvent(IPCEventType.pluginLocalesChanged, { version });
      } catch (error) {
        this.logger.debug(`Failed to broadcast plugin locale change to a window: ${String(error)}`);
      }
    }
  }

  public onReady(fn: (...args: AppEvents["ready"]) => void): AppEventToken {
    const handler = () => {
      safeExecuteFn(fn);
    };
    this.events.on<"ready">(BaseApp.Events.Ready, handler);

    return {
      cancel: () => {
        this.events.off(BaseApp.Events.Ready, handler);
      }
    };
  }

  /**
   * Wait until the app is ready
   *
   * @example
   * ```ts
   * app.whenReady().then(() => {
   *     console.log("App is ready");
   * });
   * ```
   */
  public whenReady(): Promise<void> {
    if (this.initialized) {
      return Promise.resolve();
    }
    if (this.readyError) {
      return Promise.reject(this.readyError);
    }
    return new Promise((resolve, reject) => {
      const onReady = () => {
        this.events.off(BaseApp.Events.ReadyFailed, onFailed);
        resolve();
      };
      const onFailed = (error: Error) => {
        this.events.off(BaseApp.Events.Ready, onReady);
        reject(error);
      };
      this.events.once(BaseApp.Events.Ready, onReady);
      this.events.once(BaseApp.Events.ReadyFailed, onFailed);
    });
  }

  /**
   * Alias for whenReady
   */
  public untilReady(): Promise<void> {
    return this.whenReady();
  }

  /**
   * Return the application path.
   *
   * This will return the project path in development and the path of the `app.asar` file in production.
   */
  public getAppPath(): string {
    // This will return "NarraLeaf-Studio\build\win-unpacked\resources\app.asar" in production
    // The asar archive includes package.json and "dist" directory
    // and "NarraLeaf-Studio\dist\main" in development
    const appDir = this.electronApp.getAppPath();

    return this.electronApp.isPackaged ? appDir : path.resolve(appDir, "../..");
  }

  public getResourcesDir(): string {
    const appDir = this.getAppPath();
    return this.electronApp.isPackaged
      ? path.resolve(appDir, "..", "resources")
      : path.resolve(appDir, "resources");
  }

  public resolveResource(p: string): string {
    return path.resolve(this.getResourcesDir(), p);
  }

  public getWindowIconPath(): string | null {
    if (process.platform === "darwin") {
      return null;
    }

    if (process.platform === "win32") {
      return this.resolveExistingResource("app-icon.ico", "app-icon.png");
    }

    return this.resolveExistingResource("app-icon.png", "app-icon.ico");
  }

  public getDockIconPath(): string | null {
    if (process.platform !== "darwin") {
      return null;
    }

    return this.resolveExistingResource("app-icon-mac.png", "app-icon.png", "app-icon.icns");
  }

  /**
   * The icon a packaged game wears when its project sets none: NarraLeaf's
   * own mark, not Electron's default and not the mobile shell's placeholder.
   * A game that ships looking like the framework it was built with is a
   * worse answer than one that looks like the engine it runs on.
   *
   * `opaque` selects the pre-flattened variant, committed alongside because
   * iOS and apple-touch icons must carry no alpha channel and the build
   * deliberately does no compositing of its own.
   */
  public getDefaultGameIconPath(opaque = false): string | null {
    return opaque
      ? this.resolveExistingResource("app-icon-opaque.png", "app-icon.png")
      : this.resolveExistingResource("app-icon.png", "app-icon.ico");
  }

  public getDistDir(): string {
    return path.resolve(this.getAppPath(), "dist");
  }

  public getBuiltInPluginsDir(): string {
    return path.resolve(this.getDistDir(), "builtin-plugins");
  }

  public getPublicDir(): string {
    return path.resolve(this.getAppPath(), this.isPackaged() ? "public" : "src/renderer/public");
  }

  public isPackaged(): boolean {
    return this.electronApp.isPackaged;
  }

  public getUserDataDir(): string {
    return app.getPath("userData");
  }

  public getPreloadScript(): string {
    return path.resolve(this.getDistDir(), "main", "preload.js");
  }

  public getDevTempDir(): string {
    return path.join(this.getAppPath(), ".dev", "temp");
  }

  public quit(): void {
    this.electronApp.quit();
  }

  /**
   * Claim this profile for this process, or report that another Studio already owns it.
   *
   * Matters now that Studio outlives its windows: without it, launching from the Start menu
   * while a windowless instance sits in the tray would start a *second* Studio - two tray
   * items, two update checks, and two processes writing the same `globalState.json`.
   *
   * Must be called after {@link setupUserDataDir}: Electron keys the lock on the userData
   * directory, and development redirects that path.
   *
   * Development is exempt. `dev-electron.js` restarts this process on every rebuild, and a new
   * instance starting before the old one has finished exiting would lose the lock and quit -
   * a dev loop that dies at random, in exchange for behaviour that only an installed app has
   * any use for.
   */
  public acquireSingleInstanceLock(): boolean {
    if (!this.electronApp.isPackaged) {
      return true;
    }
    return this.electronApp.requestSingleInstanceLock();
  }

  /**
   * True once the whole app is on its way out (Quit menu item, Cmd+Q, session logout).
   * Window close guards must stand aside in that case, or they would cancel the quit.
   */
  public isQuitting(): boolean {
    return this.quitting;
  }

  /**
   * Take back the "we are quitting" flag after a `before-quit` listener cancelled the quit.
   *
   * The flag is set by this class's own `before-quit` listener, which has already run by the
   * time anyone downstream calls `event.preventDefault()`. Leaving it set would be silent and
   * lasting: `isQuitting()` is what every window close guard checks in order to stand aside, so
   * an app that stayed open after a cancelled quit would never again ask to save anything.
   */
  public cancelQuit(): void {
    this.quitting = false;
  }

  /**
   * End the process, having said so and offered to come back.
   *
   * The exit is not negotiable - this is called for failures that leave the process unable to be
   * trusted with the next write. What is negotiable is what happens next, and "start it again"
   * is what almost everyone wants: before this, a fatal error was an error box quoting a stack
   * trace and then an application that was simply gone, with every window it had open.
   *
   * Everything here is written so that failing to ask still exits. The prompt reads global state
   * for the language and talks to the window server, both of which can be exactly what has just
   * broken, so a failure anywhere in it falls through to the same exit.
   */
  public crash(error: string | Error): void {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    this.logger.error("[App] Fatal error, terminating:", message);
    try {
      if (this.electronApp.isReady()) {
        if (this.askToRestartAfterCrash(message)) {
          this.electronApp.relaunch();
        }
      } else {
        console.error(message);
      }
    } catch (promptError) {
      console.error(message);
      console.error("Failed to report the fatal error:", promptError);
    } finally {
      this.electronApp.exit(1);
    }
  }

  /**
   * The native prompt behind {@link crash}. Returns whether to come back up.
   *
   * Synchronous, because the process is on its way out and there is nothing left to await in.
   * Only the first line of the failure is shown: the rest is a stack trace, which belongs in the
   * log this names rather than wrapped across a message box.
   */
  private askToRestartAfterCrash(message: string): boolean {
    const logsDir = path.join(this.getUserDataDir(), "logs");
    const headline = message.split("\n", 1)[0] ?? message;
    let title = `${APP_DISPLAY_NAME}: Fatal Error`;
    let body = headline;
    let detail = `The report is in ${logsDir}.`;
    let buttons = ["Restart", "Quit"];
    try {
      const { t } = getMainTranslator(this);
      title = t("crash.fatal.title");
      body = `${t("crash.fatal.message")}\n\n${headline}`;
      detail = t("crash.fatal.detail", { path: logsDir });
      buttons = [t("crash.fatal.restart"), t("crash.fatal.quit")];
    } catch (translationError) {
      this.logger.warn("[App] Could not translate the fatal error prompt:", translationError);
    }

    const choice = dialog.showMessageBoxSync({
      type: "error",
      title,
      message: body,
      detail,
      buttons,
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
    return choice === 0;
  }

  public isDevMode(): boolean {
    return isMainDevMode(this.commandLine, this.electronApp.isPackaged);
  }

  /**
   * Whether this launch asked for first-run setup regardless of what the profile has been
   * through - `--onboarding`, which only development honors.
   *
   * The dev gate lives here rather than at the call site so there is one place that decides it:
   * a second reader that forgot the gate would let a packaged build be talked into the setup
   * flow by an argument on a shortcut.
   */
  public wantsOnboardingRerun(): boolean {
    return this.isDevMode() && this.commandLine.onboarding;
  }

  /**
   * Whether this launch asked *not* to be shown first-run setup - `--skip-onboarding`, or
   * `--project`, which says where the session is going and therefore is not going to sit on the
   * home screen answering questions.
   *
   * Same dev gate and same single-reader rule as {@link wantsOnboardingRerun}; `--onboarding`
   * beats both, which is settled in `App.shouldRunOnboarding` rather than here.
   */
  public wantsOnboardingSkipped(): boolean {
    if (!this.isDevMode()) {
      return false;
    }
    return this.commandLine.skipOnboarding || this.commandLine.project.selector !== null;
  }

  /**
   * The project this launch asked to open, exactly as it was written on the command line - a
   * path, or a name to look for in the recent list. Null when nothing was asked for, which is
   * also what a packaged build always sees.
   */
  public getStartupProjectSelector(): string | null {
    return this.isDevMode() ? this.commandLine.project.selector : null;
  }

  /** What was wrong with `--project`, for the one place that reports it. Dev-gated as above. */
  public getStartupProjectError(): string | null {
    return this.isDevMode() ? this.commandLine.project.error : null;
  }

  public getAppEntry(type: WindowAppType): string {
    return path.resolve(this.getDistDir(), "windows", type, "index.html");
  }

  public getAppInfo(): AppInfo {
    if (!this.appInfo) {
      throw new Error("App info is not available");
    }
    return this.appInfo;
  }

  public getGlobalState(): GlobalStateManager {
    if (!this.globalState) {
      throw new Error("Global state is not available");
    }
    return this.globalState;
  }

  /**
   * Setup development userData path if running in development mode
   * This must be called before creating managers that depend on userData path
   */
  /**
   * Start writing the main-process log to disk, and point Electron's own `logs` path at the same
   * directory.
   *
   * The `setPath` matters more than it looks on macOS: the default is
   * `~/Library/Logs/<app name>`, which is the *same* directory for the dev build and the packaged
   * one, so two Studios would interleave their lines into one file. Everything else already lives
   * under the (dev-specific) userData dir; the logs now do too.
   */
  private setupLogging(): void {
    const logsDir = path.join(this.getUserDataDir(), "logs");
    installFileLogSink(logsDir);
    try {
      this.electronApp.setPath("logs", logsDir);
    } catch (error) {
      this.logger.warn("[Logging] Could not redirect Electron's log path:", error);
    }
    // Collect native crash dumps next to the log. Never uploaded - this is for the user handing
    // us a folder, not telemetry.
    crashReporter.start({ uploadToServer: false });
  }

  /**
   * Notice the ways this app can die that are not exceptions.
   *
   * A GPU, utility or renderer process dying left no trace at all before this; a hung window
   * looked identical to a slow one. All of it now reaches the log - which, since
   * {@link setupLogging}, outlives the process that wrote it. (The renderer and hang cases are
   * reported by `AppWindow`, which is where those events arrive.)
   */
  private setupCrashObservability(): void {
    this.electronApp.on("child-process-gone", (_event, details) => {
      if (details.reason === "clean-exit") {
        return;
      }
      this.logger.error(
        `[Crash] Child process "${details.type}"${details.name ? ` (${details.name})` : ""} exited: ` +
          `${details.reason} (exit code ${details.exitCode})`
      );
    });
    this.markSessionRunning();
  }

  /**
   * Leave a file behind for as long as this session is running, and find out whether the last
   * one managed to remove its own.
   *
   * The failures worth knowing about are the ones that write nothing: a process killed by the
   * system, a native fault below JavaScript, a machine that lost power. All of them leave a log
   * that simply stops, which reads the same as a clean quit. This is the one line that tells the
   * two apart, and it is in the log every support bundle carries.
   *
   * Best-effort throughout. A profile directory that cannot be written is a problem for other
   * reasons, and none of them are made better by refusing to start.
   */
  private markSessionRunning(): void {
    const marker = path.join(this.getUserDataDir(), "session.running");
    try {
      if (fs.existsSync(marker)) {
        this.logger.warn(
          "[Crash] The previous session did not shut down cleanly." +
            " Anything it had not written to disk was lost."
        );
      }
      fs.mkdirSync(path.dirname(marker), { recursive: true });
      fs.writeFileSync(marker, new Date().toISOString(), "utf-8");
    } catch (error) {
      this.logger.warn("[Crash] Could not record the session marker:", error);
      return;
    }

    // `will-quit` rather than `before-quit`: the latter fires on quits that are still
    // cancellable, and removing the marker there would call a cancelled quit a clean exit.
    this.electronApp.on("will-quit", () => {
      try {
        fs.rmSync(marker, { force: true });
      } catch (error) {
        this.logger.warn("[Crash] Could not clear the session marker:", error);
      }
    });
  }

  private setupUserDataDir(): void {
    if (!this.electronApp.isPackaged) {
      const userDataPath = path.join(this.getDevTempDir(), "userData-dev");
      this.electronApp.setPath("userData", userDataPath);
      this.logger.info(`[App] Setting up dev userData path: ${userDataPath}`);
    }
  }

  private configureCdp(): void {
    const cdp = this.commandLine.cdp;
    if (!cdp.enabled) {
      return;
    }

    if (!this.isDevMode()) {
      this.logger.warn("[CDP] Ignoring --cdp because it is only available in development mode.");
      return;
    }

    if (cdp.error) {
      this.logger.warn(`[CDP] ${cdp.error}. CDP was not enabled.`);
      return;
    }

    this.electronApp.commandLine.appendSwitch("remote-debugging-port", String(cdp.port));
    this.logger.info(`[CDP] Enabled on port ${cdp.port}.`);
  }

  private async prepare(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (!this.electronApp && !app) {
      throw new Error("Electron App is not available");
    }

    // Initialize managers
    this.windowManager.initialize();
    this.protocolManager.initialize();
    this.menuManager.initialize();
    this.storageManager.initialize();
    this.pluginPermissionManager.initialize();
    this.pluginManager.initialize();
    // Feed plugin language packs into the locale registry and rebuild the
    // native menu once they resolve (best-effort; never blocks startup).
    void this.refreshPluginLocales();

    if (this.isDevMode()) {
      this.logger.info("App is running in development mode");
      void this.setupDevReloadSocket();
      this.startDebugServer();
    }

    await this.electronApp.whenReady();

    // Resolve the persisted theme before any window exists, so the first
    // window already paints (backgroundColor + prefers-color-scheme) in
    // the right theme. Keep open windows' paint-behind color in sync when
    // the effective theme changes later (setting switched, or the OS
    // flips while in "auto").
    applyThemeMode(this.globalState.get("ui.themeMode"));
    nativeTheme.on("updated", () => {
      const backgroundColor = getWindowBackgroundColor();
      for (const window of this.windowManager.getWindows()) {
        if (window.isClosed()) {
          continue;
        }
        try {
          window.win.setBackgroundColor(backgroundColor);
        } catch (error) {
          this.logger.debug(`[Theme] Failed to update a window background: ${String(error)}`);
        }
      }
    });

    // Retrieve app info
    this.appInfo = await this.constructAppInfo();
    this.configurePlatformAppIcon();

    this.initialized = true;
    this.logger.info("App initialization completed");

    this.emit(BaseApp.Events.Ready);
  }

  private failBootstrap(error: unknown): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.readyError = normalized;
    this.emit(BaseApp.Events.ReadyFailed, normalized);
    this.crash(normalized);
  }

  /**
   * Connect to the development reload server. Failures are never fatal:
   * a missing dev server only disables auto-reload.
   *
   * The port comes from --dev-reload-port, which dev-electron.js passes from its
   * own DEV_RELOAD_PORT. Hardcoding 5588 here did two bad things to a worktree
   * session on NLS_DEV_RELOAD_PORT: its own reload never arrived, and — with the
   * main checkout also running — it latched onto *that* session's socket and
   * reloaded its windows on the other tree's rebuilds.
   */
  private async setupDevReloadSocket(): Promise<void> {
    const { port, error } = this.commandLine.devReload;
    if (error) {
      this.logger.warn(`[Dev] ${error}. Falling back to port ${port}.`);
    }

    try {
      const { WebSocket } = await import("ws");
      const ws = new WebSocket(`ws://localhost:${port}`);
      ws.onerror = (event) => {
        this.logger.warn(
          `[Dev] Reload server on port ${port} not reachable; auto-reload disabled.`,
          event.message
        );
      };
      ws.onmessage = (event) => {
        void this.handleDevReload(this.parseDevReloadTarget(event.data));
      };
    } catch (error) {
      this.logger.warn("[Dev] Failed to set up reload socket:", error);
    }
  }

  /**
   * Start the dev-only debug HTTP server (127.0.0.1). It exposes the app's
   * Console service and every window's DevTools console feed so tooling can
   * pull Studio's logs without a hand-rolled CDP session. Never fatal: a
   * failure here only disables the convenience surface.
   */
  private startDebugServer(): void {
    try {
      this.debugServer = new StudioDebugServer(this);
      this.debugServer.start();
      this.electronApp.on("before-quit", () => this.debugServer?.stop());
    } catch (error) {
      this.logger.warn("[Debug] Failed to start debug server:", error);
    }
  }

  /**
   * Apply one dev reload broadcast.
   *
   * `builtin-plugins` is the rebuild of `dist/builtin-plugins`. Reloading the
   * windows alone would show the same code again: the packages the renderer
   * loads are the copies the main process synced into userData at start-up, so
   * the sync has to run again *before* the reload, or a dev edit to a built-in
   * plugin would only appear after restarting Studio.
   */
  private async handleDevReload(target: DevReloadTarget): Promise<void> {
    if (target === "builtin-plugins") {
      try {
        await this.pluginManager.refreshBuiltInPlugins();
      } catch (error) {
        this.logger.warn("[Dev] Failed to re-sync built-in plugins:", error);
      }
    }

    const workspaceOnly = target !== "all";
    this.windowManager.getWindows().forEach((w) => {
      if (w.isClosed()) {
        return;
      }
      if (workspaceOnly && w.getWindowType() !== WindowAppType.Workspace) {
        return;
      }
      // Avoid interrupting an in-flight navigation which causes ERR_ABORTED
      try {
        const wc = w.getWebContents();
        if (!wc.isLoadingMainFrame()) {
          w.reload();
        }
      } catch {
        // Window might be destroyed; ignore
      }
    });
  }

  private parseDevReloadTarget(data: unknown): DevReloadTarget {
    const text =
      typeof data === "string" ? data : Buffer.isBuffer(data) ? data.toString("utf-8") : "";
    if (!text || text === "reload") {
      return "all";
    }

    try {
      const parsed = JSON.parse(text) as { target?: unknown };
      return parsed.target === "workspace" || parsed.target === "builtin-plugins"
        ? parsed.target
        : "all";
    } catch {
      return "all";
    }
  }

  private async constructAppInfo(): Promise<AppInfo> {
    const pkg = await readJson<{ version: string }>(
      path.resolve(this.getAppPath(), "package.json")
    );
    if (!pkg.ok) {
      throw new Error(`Failed to load app info: ${pkg.error}`);
    }

    return {
      version: pkg.data.version
    };
  }

  private configurePlatformAppIcon(): void {
    const dockIconPath = this.getDockIconPath();
    if (!dockIconPath) {
      return;
    }

    this.electronApp.dock?.setIcon(dockIconPath);
  }

  private resolveExistingResource(...filenames: string[]): string | null {
    for (const filename of filenames) {
      const resourcePath = this.resolveResource(filename);
      if (fs.existsSync(resourcePath)) {
        return resourcePath;
      }
    }

    this.logger.warn(`[App] No matching icon resource found for: ${filenames.join(", ")}`);
    return null;
  }

  private emit<K extends StringKeyOf<AppEvents>>(event: K, ...args: AppEvents[K]): void {
    this.events.emit(event, ...(args as any));
  }
}
