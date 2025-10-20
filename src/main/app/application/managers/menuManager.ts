import { Menu, MenuItemConstructorOptions } from "electron";
import { BaseApp } from "../baseApp";

// type MenuRole = MenuItemConstructorOptions['role'];
// type MenuItemType = MenuItemConstructorOptions['type'];

export class MenuManager {
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
        const template: MenuItemConstructorOptions[] = [];
        return template;
    }

    public cleanup(): void {
        this.menu = null;
    }
} 