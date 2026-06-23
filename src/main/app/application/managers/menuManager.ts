import { Menu, MenuItemConstructorOptions, shell } from "electron";
import { BaseApp } from "../baseApp";

// type MenuRole = MenuItemConstructorOptions['role'];
// type MenuItemType = MenuItemConstructorOptions['type'];

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

    private buildMenuTemplate(): MenuItemConstructorOptions[] {
        if (process.platform !== "darwin") {
            return [];
        }

        return [
            { role: "appMenu", visible: false },
            { role: "editMenu" },
            {
                role: "help",
                label: "Help",
                submenu: [
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
