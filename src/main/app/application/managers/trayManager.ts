import { Menu, Tray, nativeImage } from "electron";
import { APP_DISPLAY_NAME } from "@shared/constants/app";
import type { BaseApp } from "../baseApp";
import { getMainTranslator } from "../i18n";

/**
 * What the status-bar item can do. Handed in rather than reached for, because every one of these
 * lives on `App` (the launcher, the Settings window) while this manager only ever holds a
 * `BaseApp` - the same reason `VcsManager` takes its flush callback as a function.
 */
export interface TrayActions {
  /** Bring the home screen back, opening it if the user closed everything. */
  openLauncher(): void | Promise<void>;
  /** Open Settings on the software-update panel. */
  openUpdateSettings(): void | Promise<void>;
}

/**
 * Owns the status-bar item Studio lives in once its windows are gone.
 *
 * Studio no longer exits when the last window closes (see `App.handleLastWindowClosed`), which
 * only works if there is still something to click: a resident process with no visible surface is
 * indistinguishable from a leak. This is that surface on Windows and Linux.
 *
 * **macOS deliberately has no tray item.** The Dock already represents a running app with no
 * windows, and a status-bar item next to it would be a second, redundant way to say the same
 * thing - one that macOS users read as a background agent rather than as the editor they left
 * open. The residency itself still applies there; the Dock is its handle (Quit from the Dock menu,
 * click to bring the launcher back). So this manager reports itself unavailable on darwin and
 * every caller treats that as normal rather than as a failure.
 *
 * The menu is rebuilt rather than mutated, for the same reason `MenuManager` rebuilds: its labels
 * follow the in-app language, and the update row's label follows the updater's state.
 */
export class TrayManager {
  private tray: Tray | null = null;

  constructor(
    private readonly app: BaseApp,
    private readonly actions: TrayActions
  ) {}

  /** Whether this platform gets a status-bar item at all. False on macOS, by design. */
  public static isSupported(): boolean {
    return process.platform !== "darwin";
  }

  /**
   * Whether there is a status-bar item on screen right now.
   *
   * Load-bearing rather than informational: on Windows and Linux this is the only handle a
   * windowless Studio has, so `App.handleLastWindowClosed` quits instead of going resident when
   * it is false. Staying alive with neither a window nor a tray item is a process the user can
   * only end from Task Manager.
   */
  public isActive(): boolean {
    return this.tray !== null;
  }

  /**
   * Create the status-bar item. Safe to call once, after the app is ready.
   *
   * A tray that cannot be created is not a reason to fail startup - on Linux it depends on a
   * StatusNotifier host that may simply not be running. It does, however, change what closing
   * the last window means, so it is logged loudly enough to explain a Studio that seems to have
   * vanished.
   */
  public initialize(): void {
    if (!TrayManager.isSupported() || this.tray) {
      return;
    }

    const iconPath = this.app.getWindowIconPath();
    if (!iconPath) {
      this.app.logger.warn("[Tray] No icon resource; the status-bar item was not created.");
      return;
    }

    try {
      const image = nativeImage.createFromPath(iconPath);
      this.tray = new Tray(image.isEmpty() ? iconPath : image);
    } catch (error) {
      this.app.logger.warn("[Tray] Failed to create the status-bar item:", error);
      return;
    }

    this.tray.setToolTip(APP_DISPLAY_NAME);
    // Windows only. On Linux a left click opens the context menu (the platform has no
    // separate click event), so wiring this there would double up with "Open Launcher".
    if (process.platform === "win32") {
      this.tray.on("click", () => {
        void this.actions.openLauncher();
      });
    }
    this.rebuildMenu();
  }

  /**
   * Rebuild the context menu against the current language and updater state.
   *
   * Called on every language change and whenever the update state moves, so the row that
   * offers an update says what is actually true. Cheap: the menu is four items.
   */
  public rebuildMenu(): void {
    if (!this.tray) {
      return;
    }

    const { t } = getMainTranslator(this.app);
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: t("menu.tray.openLauncher"),
        click: () => {
          void this.actions.openLauncher();
        }
      },
      { type: "separator" },
      {
        label: t("menu.tray.checkForUpdates"),
        click: () => {
          void this.actions.openUpdateSettings();
        }
      },
      { type: "separator" },
      {
        label: t("menu.tray.quit", { name: APP_DISPLAY_NAME }),
        click: () => {
          this.app.quit();
        }
      }
    ];

    this.tray.setContextMenu(Menu.buildFromTemplate(template));
  }

  /**
   * Say, once, that Studio is still running after its last window closed.
   *
   * Windows files a newly registered notification icon into the overflow flyout rather than
   * showing it, so the first time someone closes everything the app appears to have vanished:
   * no window, no taskbar button, and an icon behind a chevron they have no reason to open.
   * The balloon is what turns that into a place they know to look - and it comes from the icon
   * itself, so it points at where the icon is.
   *
   * Windows only. `displayBalloon` is a no-op elsewhere, and macOS has no tray item at all.
   */
  public announceResidency(title: string, content: string): void {
    if (!this.tray || process.platform !== "win32") {
      return;
    }
    try {
      this.tray.displayBalloon({ title, content, iconType: "info" });
    } catch (error) {
      this.app.logger.debug(`[Tray] Could not show the residency balloon: ${String(error)}`);
    }
  }

  public destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}
