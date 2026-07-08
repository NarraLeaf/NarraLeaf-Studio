import { Menu, MenuItemConstructorOptions, BrowserWindow, shell } from "electron";
import { BaseApp } from "../baseApp";
import { IPCEventType, WorkspaceMenuAction } from "@shared/types/ipcEvents";
import { WindowAppType } from "@shared/types/window";
import { APP_DISPLAY_NAME } from "@shared/constants/app";
import { getMainTranslator } from "../i18n";

export class MenuManager {
    private static readonly DocumentationUrl = "https://www.narraleaf.com/docs/studio";

    private menu: Menu | null = null;

    constructor(private readonly app: BaseApp) {
    }

    public initialize(): void {
        this.buildMenu();
    }

    public buildMenu(): Menu {
        const template: MenuItemConstructorOptions[] = this.buildMenuTemplate();
        this.menu = Menu.buildFromTemplate(template);
        this.setMenu(this.menu);
        return this.menu;
    }

    public updateMenu(): void {
        if (this.menu) {
            this.buildMenu();
        }
    }

    public setMenu(menu: Menu): void {
        Menu.setApplicationMenu(menu);
    }

    private getFocusedAppWindow() {
        const focusedWindow = BrowserWindow.getFocusedWindow();
        if (!focusedWindow || focusedWindow.isDestroyed()) return null;

        return this.app.windowManager
            .getWindows()
            .find((win) => !win.isClosed() && win.getBrowserWindow() === focusedWindow);
    }

    private sendActionToFocusedWindow(action: WorkspaceMenuAction): void {
        const appWindow = this.getFocusedAppWindow();
        if (appWindow?.getWindowType() === WindowAppType.Workspace) {
            appWindow.sendIpcEvent(IPCEventType.menuAction, { action });
        }
    }

    private openPreferencesForFocusedWindow(): void {
        const appWindow = this.getFocusedAppWindow();
        if (!appWindow) {
            return;
        }

        void appWindow.getApp().launchSettings(appWindow, {}, {
            parent: appWindow.win,
            minWidth: 800,
            minHeight: 500,
            width: 1200,
            height: 800,
            center: true,
            x: undefined,
            y: undefined,
            backgroundColor: "#0f1115",
        }).catch((error) => {
            this.app.logger.error("Failed to open preferences:", error);
        });
    }

    private buildMenuTemplate(): MenuItemConstructorOptions[] {
        if (process.platform !== "darwin") {
            return [];
        }

        // Built fresh on every rebuild so the menu re-localizes when the language
        // changes (AppGlobalStateSetHandler calls updateMenu()). System `role`
        // items are localized by Electron/macOS itself and stay untranslated here.
        const { t } = getMainTranslator(this.app);

        return [
            {
                label: APP_DISPLAY_NAME,
                submenu: [
                    { role: "about" },
                    { type: "separator" },
                    {
                        label: t("menu.app.preferences"),
                        accelerator: "Cmd+,",
                        click: () => {
                            this.openPreferencesForFocusedWindow();
                        },
                    },
                    { type: "separator" },
                    { role: "services" },
                    { type: "separator" },
                    { role: "hide" },
                    { role: "hideOthers" },
                    { role: "unhide" },
                    { type: "separator" },
                    { role: "quit" },
                ],
            },
            {
                label: t("menu.file.title"),
                submenu: [
                    {
                        label: t("menu.file.new"),
                        accelerator: "Cmd+N",
                        click: () => {
                            this.sendActionToFocusedWindow(WorkspaceMenuAction.NewWorkspace);
                        },
                    },
                    {
                        label: t("menu.file.open"),
                        accelerator: "Cmd+O",
                        click: () => {
                            this.sendActionToFocusedWindow(WorkspaceMenuAction.OpenWorkspace);
                        },
                    },
                    { type: "separator" },
                    {
                        label: t("menu.file.export"),
                        accelerator: "Cmd+Shift+E",
                        click: () => {
                            this.sendActionToFocusedWindow(WorkspaceMenuAction.ExportProject);
                        },
                    },
                    { type: "separator" },
                    {
                        label: t("menu.file.close"),
                        accelerator: "Cmd+Shift+W",
                        click: () => {
                            this.sendActionToFocusedWindow(WorkspaceMenuAction.CloseWorkspace);
                        },
                    },
                ],
            },
            { role: "editMenu" },
            {
                label: t("menu.view.title"),
                submenu: [
                    { role: "reload" },
                    { role: "forceReload" },
                    { role: "toggleDevTools" },
                    { type: "separator" },
                    { role: "resetZoom" },
                    { role: "zoomIn" },
                    { role: "zoomOut" },
                    { type: "separator" },
                    { role: "togglefullscreen" },
                ],
            },
            {
                role: "windowMenu",
                label: t("menu.window.title"),
                submenu: [
                    { role: "minimize" },
                    { role: "zoom" },
                    { type: "separator" },
                    { role: "front" },
                ],
            },
            {
                role: "help",
                label: t("menu.help.title"),
                submenu: [
                    {
                        label: t("menu.help.welcome"),
                        click: () => {
                            this.sendActionToFocusedWindow(WorkspaceMenuAction.OpenWelcome);
                        },
                    },
                    { type: "separator" },
                    {
                        label: t("menu.help.docs"),
                        click: () => {
                            void this.openDocumentation();
                        },
                    },
                ],
            },
        ];
    }

    private async openDocumentation(): Promise<void> {
        try {
            await shell.openExternal(MenuManager.DocumentationUrl);
        } catch (error) {
            this.app.logger.error("Failed to open documentation:", error);
        }
    }

    public cleanup(): void {
        this.menu = null;
    }
}
