import { Menu, MenuItemConstructorOptions, BrowserWindow, shell } from "electron";
import { BaseApp } from "../baseApp";
import { IPCEventType } from "@shared/types/ipcEvents";
import { Namespace } from "@shared/types/ipc";

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

    private sendActionToFocusedWindow(action: string): void {
        const focusedWindow = BrowserWindow.getFocusedWindow();
        if (!focusedWindow || focusedWindow.isDestroyed()) return;

        // Find the corresponding AppWindow and use its IPC proxy
        const windows = this.app.windowManager.getWindows();
        for (const win of windows) {
            if (win.getBrowserWindow() === focusedWindow) {
                win.sendIpcEvent(IPCEventType.menuAction, { action });
                break;
            }
        }
    }

    private buildMenuTemplate(): MenuItemConstructorOptions[] {
        if (process.platform !== "darwin") {
            return [];
        }

        return [
            {
                role: "appMenu",
                label: "NarraLeaf Studio",
                submenu: [
                    { role: "about" },
                    { type: "separator" },
                    {
                        label: "Preferences\u2026",
                        accelerator: "Cmd+,",
                        click: () => {
                            this.sendActionToFocusedWindow("preferences");
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
                label: "File",
                submenu: [
                    {
                        label: "New Workspace",
                        accelerator: "Cmd+N",
                        click: () => {
                            this.sendActionToFocusedWindow("new-workspace");
                        },
                    },
                    {
                        label: "Open Workspace",
                        accelerator: "Cmd+O",
                        click: () => {
                            this.sendActionToFocusedWindow("open-workspace");
                        },
                    },
                    { type: "separator" },
                    {
                        label: "Export Project",
                        accelerator: "Cmd+Shift+E",
                        click: () => {
                            this.sendActionToFocusedWindow("export-project");
                        },
                    },
                    { type: "separator" },
                    {
                        label: "Close Workspace",
                        accelerator: "Cmd+W",
                        click: () => {
                            this.sendActionToFocusedWindow("close-workspace");
                        },
                    },
                ],
            },
            { role: "editMenu" },
            {
                label: "View",
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
                label: "Window",
                submenu: [
                    { role: "minimize" },
                    { role: "zoom" },
                    { type: "separator" },
                    { role: "front" },
                ],
            },
            {
                role: "help",
                label: "Help",
                submenu: [
                    {
                        label: "Open Welcome",
                        click: () => {
                            this.sendActionToFocusedWindow("open-welcome");
                        },
                    },
                    { type: "separator" },
                    {
                        label: "Documentation",
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
