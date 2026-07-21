import os from "os";
import { Menu, MenuItemConstructorOptions, BrowserWindow, shell } from "electron";
import { BaseApp } from "../baseApp";
import { IPCEventType } from "@shared/types/ipcEvents";
import { formatRecentProjectLabel } from "@shared/utils/recentProject";
import {
    EditMenuRole,
    MenuActionId,
    NativeMenuGroup,
    NativeMenuItem,
    NativeMenuModel,
    WorkspaceMenuAction,
} from "@shared/types/menu";
import { WindowAppType } from "@shared/types/window";
import { APP_DISPLAY_NAME } from "@shared/constants/app";
import { getMainTranslator } from "../i18n";
import type { AppWindow } from "./window/appWindow";
import type { Translator } from "@shared/i18n";

/**
 * Owns the macOS application menu.
 *
 * The menu is rebuilt rather than mutated, because its shape depends on things that change at
 * runtime: which window is focused (home and a project get different menus), the language, and
 * the menu model the focused workspace pushes up over IPC (see `syncWindowMenu`). Menu items
 * only name renderer action ids - the renderer owns the behaviour (`useMenuActionHandler`).
 *
 * No group is recognised by id here: a synced group carries the `slot` it asked for, and this
 * class only decides what each slot means. Which panel produced a group is none of its business.
 */
export class MenuManager {
    private static readonly DocumentationUrl = "https://www.narraleaf.com/docs/studio";

    private menu: Menu | null = null;
    /**
     * Latest menu model per window. Keyed by the AppWindow object itself - unlike its
     * webContents id, the object stays safely usable after the BrowserWindow is destroyed,
     * and forgetWindow runs from the 'closed' handler where webContents access throws.
     */
    private readonly syncedModels = new Map<AppWindow, NativeMenuModel>();
    /**
     * The window the menu currently describes. Electron reports no focused window whenever the
     * app is not frontmost, and the menu must not collapse to the home shape just because the
     * user clicked another app - so the last focused window stays authoritative.
     */
    private lastFocusedWindow: AppWindow | null = null;
    /** Input snapshot of the last build, so redundant rebuilds can be skipped (see computeMenuKey). */
    private lastMenuKey: string | null = null;

    constructor(private readonly app: BaseApp) {
    }

    public initialize(): void {
        this.buildMenu();

        // Only macOS has an application menu to keep in sync; elsewhere buildMenuTemplate is
        // empty and every rebuild would be busywork.
        if (process.platform !== "darwin") {
            return;
        }

        // The menu shape follows the focused window. Only focus is tracked, not blur: blurring
        // means the app went to the background, which must not change the menu. Focus events
        // also fire on every app activation, so this path skips the rebuild when the menu
        // would come out identical - rebuilding closes any open menu under the user's pointer.
        this.app.electronApp.on("browser-window-focus", this.onBrowserWindowFocus);
    }

    private readonly onBrowserWindowFocus = (): void => {
        this.rememberFocus();
        this.updateMenuIfChanged();
    };

    public buildMenu(): Menu {
        const template: MenuItemConstructorOptions[] = this.buildMenuTemplate();
        this.menu = Menu.buildFromTemplate(template);
        this.lastMenuKey = this.computeMenuKey();
        this.setMenu(this.menu);

        // The native menu bar cannot be inspected from the renderer, so log what was built -
        // it is the only way to check the menu's shape without clicking it by hand.
        this.app.logger.debug(`[Menu] Built: ${template.map(item => item.label ?? item.role).join(" | ")}`);

        return this.menu;
    }

    public updateMenu(): void {
        if (this.menu) {
            this.buildMenu();
        }
    }

    /** Rebuild only if the menu's inputs changed since the last build. */
    private updateMenuIfChanged(): void {
        if (this.menu && this.computeMenuKey() !== this.lastMenuKey) {
            this.buildMenu();
        }
    }

    /**
     * Everything the menu template is derived from, cheap enough to compare per focus event:
     * the language, what kind of window the menu describes, and that window's synced model.
     */
    private computeMenuKey(): string {
        const target = this.getMenuTargetWindow();
        const locale = String(this.app.globalState.get("app.language"));
        if (!target) {
            return `${locale}|<none>`;
        }
        const model = this.syncedModels.get(target);
        return `${locale}|${target.getWindowType()}|${model ? JSON.stringify(model) : ""}`;
    }

    public setMenu(menu: Menu): void {
        Menu.setApplicationMenu(menu);
    }

    /**
     * Take the menu model a workspace renderer pushed up. Only rebuilds when that window is the
     * focused one - a background window's model is stored for when it comes forward.
     */
    public syncWindowMenu(window: AppWindow, model: NativeMenuModel): void {
        this.syncedModels.set(window, model);
        const groupSummary = model.groups
            .map(group => `${group.label}[${group.slot}](${group.items.length})`)
            .join(", ") || "<none>";
        this.app.logger.debug(
            `[Menu] Synced: ${groupSummary} | devMode=${model.runtime.devModeActive} preview=${model.runtime.previewActive}`,
        );

        if (this.getMenuTargetWindow() === window) {
            this.updateMenu();
        }
    }

    /**
     * Drop a closed window's model so it cannot leak into a later menu. Called from
     * unregisterWindow, which can run after the BrowserWindow is destroyed - nothing here may
     * touch the window's webContents.
     */
    public forgetWindow(window: AppWindow): void {
        this.syncedModels.delete(window);
        if (this.lastFocusedWindow === window) {
            this.lastFocusedWindow = null;
        }
    }

    private getFocusedAppWindow(): AppWindow | null {
        const focusedWindow = BrowserWindow.getFocusedWindow();
        if (!focusedWindow || focusedWindow.isDestroyed()) return null;

        return this.app.windowManager
            .getWindows()
            .find((win) => !win.isClosed() && win.getBrowserWindow() === focusedWindow) ?? null;
    }

    /**
     * The window the menu and its actions belong to: whatever is focused, or - while the app is
     * in the background - whatever was focused last, as long as it is still alive.
     *
     * Read-only, so it is safe to call from computeMenuKey and from a menu item's click. The
     * fallback is kept current by rememberFocus/forgetWindow.
     */
    private getMenuTargetWindow(): AppWindow | null {
        const focused = this.getFocusedAppWindow();
        if (focused) {
            return focused;
        }

        if (this.lastFocusedWindow && !this.lastFocusedWindow.isClosed()) {
            return this.lastFocusedWindow;
        }

        return null;
    }

    /** Latch the focused window, so the menu survives the app going to the background. */
    private rememberFocus(): void {
        const focused = this.getFocusedAppWindow();
        if (focused) {
            this.lastFocusedWindow = focused;
        }
    }

    /**
     * Menu actions are handled by the renderer, so they only reach windows that run an action
     * registry: the workspace, and the launcher (its File menu).
     */
    private sendActionToFocusedWindow(action: MenuActionId): void {
        const appWindow = this.getMenuTargetWindow();
        if (!appWindow) {
            return;
        }

        const windowType = appWindow.getWindowType();
        if (windowType === WindowAppType.Workspace || windowType === WindowAppType.Launcher) {
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
        }).catch((error) => {
            this.app.logger.error("Failed to open preferences:", error);
        });
    }

    private buildMenuTemplate(): MenuItemConstructorOptions[] {
        if (process.platform !== "darwin") {
            return [];
        }

        // Built fresh on every rebuild so the menu re-localizes when the language
        // changes (AppGlobalStateSetHandler calls updateMenu()). `role` items need an
        // explicit `label`: macOS localizes roles to the *system* language only, so
        // leaving them bare would ignore the in-app language picker.
        const { t } = getMainTranslator(this.app);

        const focused = this.getMenuTargetWindow();
        const isWorkspace = focused?.getWindowType() === WindowAppType.Workspace;

        // Everything that is not a project is treated as "home": the launcher, but also
        // Settings and the project wizard, which need the same minimal menu.
        return isWorkspace
            ? this.buildWorkspaceTemplate(t, focused)
            : this.buildHomeTemplate(t, focused);
    }

    /**
     * Home keeps only App / File / Edit / Help.
     *
     * Edit stays despite only File and Help being asked for: on macOS the standard editing
     * shortcuts (Cmd+C/V/X/A) are routed *through* the Edit menu's roles, so dropping it would
     * break copy and paste in every text field outside the workspace, Settings included.
     */
    private buildHomeTemplate(t: Translator["t"], target: AppWindow | null): MenuItemConstructorOptions[] {
        // Menu actions land in a renderer that handles them, and outside the workspace only the
        // launcher does. With Settings or the project wizard focused the items would silently
        // no-op, so they grey out instead.
        const canDispatch = target?.getWindowType() === WindowAppType.Launcher;

        return [
            this.buildAppMenu(t),
            {
                label: t("menu.file.title"),
                submenu: [
                    {
                        label: t("menu.file.new"),
                        accelerator: "Cmd+N",
                        enabled: canDispatch,
                        click: () => {
                            this.sendActionToFocusedWindow(WorkspaceMenuAction.NewWorkspace);
                        },
                    },
                    {
                        label: t("menu.file.open"),
                        accelerator: "Cmd+O",
                        enabled: canDispatch,
                        click: () => {
                            this.sendActionToFocusedWindow(WorkspaceMenuAction.OpenWorkspace);
                        },
                    },
                    this.buildOpenRecentMenu(t),
                    { type: "separator" },
                    // No project is open, so there is nothing to export or close.
                    { label: t("menu.file.export"), enabled: false },
                    { label: t("menu.file.close"), enabled: false },
                ],
            },
            this.buildEditMenu(t),
            {
                role: "help",
                label: t("menu.help.title"),
                submenu: [
                    // The welcome page is a workspace editor tab; there is nowhere to open it from home.
                    { label: t("menu.help.welcome"), enabled: false },
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

    private buildWorkspaceTemplate(t: Translator["t"], window: AppWindow): MenuItemConstructorOptions[] {
        const model = this.syncedModels.get(window);
        const groups = model?.groups ?? [];
        // Each group goes where it asked to go. A slot may hold more than one group - nothing
        // stops two surfaces from both contributing Edit items - so these are filters, not finds.
        const editGroups = groups.filter(group => group.slot === "edit");
        const windowGroups = groups.filter(group => group.slot === "window");
        const topLevelGroups = groups.filter(group => group.slot === "top-level");
        const runtime = model?.runtime;

        return [
            this.buildAppMenu(t),
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
                    this.buildOpenRecentMenu(t),
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
            this.buildEditMenu(t, editGroups),
            // Whatever else the workspace currently offers: an image tab's Preview, an audio
            // tab's Playback, plugin groups. These come and go with focus, hence the sync.
            ...topLevelGroups.map(group => this.buildSyncedGroupMenu(group)),
            {
                label: t("menu.dev.title"),
                submenu: [
                    // Dev Mode and Preview are toggles (the same action stops a running
                    // instance), so a checkmark shows which one is live. Electron flips a
                    // checkbox visually on every click, before anything has actually started -
                    // the rebuild right after puts the checkmark back under the synced status,
                    // which flips it for real once the runtime reports running.
                    {
                        label: t("menu.dev.devMode"),
                        type: "checkbox",
                        checked: runtime?.devModeActive ?? false,
                        click: () => {
                            this.sendActionToFocusedWindow(WorkspaceMenuAction.DevMode);
                            this.updateMenu();
                        },
                    },
                    {
                        label: t("menu.dev.preview"),
                        type: "checkbox",
                        checked: runtime?.previewActive ?? false,
                        click: () => {
                            this.sendActionToFocusedWindow(WorkspaceMenuAction.Preview);
                            this.updateMenu();
                        },
                    },
                    { type: "separator" },
                    {
                        label: t("menu.dev.build"),
                        click: () => {
                            this.sendActionToFocusedWindow(WorkspaceMenuAction.Build);
                        },
                    },
                ],
            },
            {
                role: "windowMenu",
                label: t("menu.window.title"),
                submenu: [
                    { role: "minimize", label: t("menu.window.minimize") },
                    { role: "zoom", label: t("menu.window.zoom") },
                    ...this.buildSlottedItems(windowGroups.flatMap(group => group.items)),
                    { type: "separator" },
                    { role: "front", label: t("menu.window.front") },
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
                    { type: "separator" },
                    {
                        // Opens the workspace's About editor tab; the renderer resolves this
                        // action id against the Help group (see useMenuActionHandler). Distinct
                        // from the App menu's native "About" panel (role: "about").
                        label: t("menu.help.about", { name: APP_DISPLAY_NAME }),
                        click: () => {
                            this.sendActionToFocusedWindow(WorkspaceMenuAction.About);
                        },
                    },
                ],
            },
        ];
    }

    /**
     * The "Open Recent" submenu. Unlike New/Open - which dispatch an action into the focused
     * renderer - its items open (or focus, if already open) a project straight from the main
     * process, so they work regardless of which surface handles menu actions. An empty history
     * shows a single disabled placeholder rather than a bare submenu.
     */
    private buildOpenRecentMenu(t: Translator["t"]): MenuItemConstructorOptions {
        const recentProjects = this.app.globalState.recentlyOpened.list();
        const homeDir = os.homedir();
        const submenu: MenuItemConstructorOptions[] = recentProjects.length === 0
            ? [{ label: t("menu.file.noRecent"), enabled: false }]
            : recentProjects.map(project => ({
                // Name and path together, so two projects that share a name stay distinguishable.
                label: formatRecentProjectLabel(project, homeDir),
                click: () => {
                    this.openRecentProject(project.path);
                },
            }));

        return {
            label: t("menu.file.openRecent"),
            submenu,
        };
    }

    private openRecentProject(projectPath: string): void {
        // launchWorkspace and its file-access authorization live on App, reachable through the
        // target window (this.app is the narrower BaseApp), mirroring how preferences are opened.
        const target = this.getMenuTargetWindow();
        if (!target) {
            return;
        }

        void target.getApp().openProject(target, projectPath).catch((error) => {
            this.app.logger.error("Failed to open recent project from menu:", error);
        });
    }

    private buildAppMenu(t: Translator["t"]): MenuItemConstructorOptions {
        return {
            label: APP_DISPLAY_NAME,
            submenu: [
                { role: "about", label: t("menu.app.about", { name: APP_DISPLAY_NAME }) },
                { type: "separator" },
                {
                    label: t("menu.app.preferences"),
                    accelerator: "Cmd+,",
                    click: () => {
                        this.openPreferencesForFocusedWindow();
                    },
                },
                { type: "separator" },
                { role: "services", label: t("menu.app.services") },
                { type: "separator" },
                { role: "hide", label: t("menu.app.hide", { name: APP_DISPLAY_NAME }) },
                { role: "hideOthers", label: t("menu.app.hideOthers") },
                { role: "unhide", label: t("menu.app.unhide") },
                { type: "separator" },
                { role: "quit", label: t("menu.app.quit", { name: APP_DISPLAY_NAME }) },
            ],
        };
    }

    /**
     * The standard Edit menu. When the focused surface supplies its own version of a standard
     * command (a copy/cut/paste/delete tagged with `role`), that command is routed to the
     * surface's action instead of the built-in webContents role - the menu shows one Copy, and
     * it does the right thing for what is focused. Untagged entries are appended below a
     * separator.
     */
    private buildEditMenu(t: Translator["t"], contextGroups: NativeMenuGroup[] = []): MenuItemConstructorOptions {
        const contextItems = contextGroups.flatMap(group => group.items);
        const roleOverrides = new Map<EditMenuRole, Extract<NativeMenuItem, { kind: "action" }>>();
        for (const item of contextItems) {
            if (item.kind === "action" && item.role) {
                roleOverrides.set(item.role, item);
            }
        }
        const extraItems = contextItems.filter(item => !(item.kind === "action" && item.role));

        // On macOS, Cmd+C/X/V exist only as Edit-menu key equivalents, so the substituted items
        // must carry them or the shortcuts die window-wide while the surface is focused. The
        // renderer decides per keystroke whether the action or plain text editing is meant
        // (see useMenuActionHandler's edit-role fallback).
        const EDIT_ROLE_ACCELERATORS: Record<EditMenuRole, string | undefined> = {
            cut: "CmdOrCtrl+X",
            copy: "CmdOrCtrl+C",
            paste: "CmdOrCtrl+V",
            delete: undefined,
        };

        const standardItem = (role: EditMenuRole, electronRole: MenuItemConstructorOptions["role"], label: string): MenuItemConstructorOptions => {
            const override = roleOverrides.get(role);
            if (!override) {
                return { role: electronRole, label };
            }
            return {
                label,
                accelerator: EDIT_ROLE_ACCELERATORS[role],
                // Not override.enabled: this item is now also the window's only Cmd+C/X/V
                // binding, and text editing must keep working when the surface action happens
                // to be disabled (nothing selected). The renderer no-ops disabled actions.
                click: () => {
                    this.sendActionToFocusedWindow(override.id);
                },
            };
        };

        return {
            role: "editMenu",
            label: t("menu.edit.title"),
            submenu: [
                { role: "undo", label: t("menu.edit.undo") },
                { role: "redo", label: t("menu.edit.redo") },
                { type: "separator" },
                standardItem("cut", "cut", t("menu.edit.cut")),
                standardItem("copy", "copy", t("menu.edit.copy")),
                standardItem("paste", "paste", t("menu.edit.paste")),
                { role: "pasteAndMatchStyle", label: t("menu.edit.pasteAndMatchStyle") },
                standardItem("delete", "delete", t("menu.edit.delete")),
                { role: "selectAll", label: t("menu.edit.selectAll") },
                { type: "separator" },
                {
                    label: t("menu.edit.speech.title"),
                    submenu: [
                        { role: "startSpeaking", label: t("menu.edit.speech.startSpeaking") },
                        { role: "stopSpeaking", label: t("menu.edit.speech.stopSpeaking") },
                    ],
                },
                ...this.buildSlottedItems(extraItems),
            ],
        };
    }

    private buildSyncedGroupMenu(group: NativeMenuGroup): MenuItemConstructorOptions {
        return {
            label: group.label,
            submenu: group.items.map(item => this.buildSyncedMenuItem(item)),
        };
    }

    /**
     * Items to splice into a standard menu, behind a leading separator so they read as an
     * addition rather than part of the built-in set. Nothing to splice means no separator either.
     */
    private buildSlottedItems(items: NativeMenuItem[]): MenuItemConstructorOptions[] {
        if (items.length === 0) {
            return [];
        }
        return [
            { type: "separator" },
            ...items.map(item => this.buildSyncedMenuItem(item)),
        ];
    }

    /**
     * Synced items deliberately carry no accelerator: `shortcut` on a renderer action is display
     * text only, and the real key handling lives in the renderer's KeybindingService. Declaring
     * the same key here would risk firing the action twice.
     */
    private buildSyncedMenuItem(item: NativeMenuItem): MenuItemConstructorOptions {
        if (item.kind === "separator") {
            return { type: "separator" };
        }

        if (item.kind === "submenu") {
            return {
                label: item.label,
                submenu: item.items.map(child => this.buildSyncedMenuItem(child)),
            };
        }

        const actionId = item.id;
        const isCheckbox = item.checked !== undefined;
        return {
            label: item.label,
            enabled: item.enabled,
            ...(isCheckbox ? { type: "checkbox" as const, checked: item.checked } : {}),
            click: () => {
                this.sendActionToFocusedWindow(actionId);
                if (isCheckbox) {
                    // Undo Electron's automatic visual flip; the synced state stays authoritative.
                    this.updateMenu();
                }
            },
        };
    }

    private async openDocumentation(): Promise<void> {
        try {
            await shell.openExternal(MenuManager.DocumentationUrl);
        } catch (error) {
            this.app.logger.error("Failed to open documentation:", error);
        }
    }

    public cleanup(): void {
        this.app.electronApp.off("browser-window-focus", this.onBrowserWindowFocus);
        this.menu = null;
        this.syncedModels.clear();
        this.lastFocusedWindow = null;
    }
}
