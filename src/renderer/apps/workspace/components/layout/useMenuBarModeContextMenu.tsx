import React, { useCallback } from "react";
import { Check } from "lucide-react";
import { ContextMenu, ContextMenuDef, useContextMenu } from "@/lib/components/elements/ContextMenu";
import { getInterface } from "@/lib/app/bridge";
import { useTranslation } from "@/lib/i18n";
import { MENU_BAR_MODE_KEY, MENU_BAR_MODES, MenuBarMode } from "@/lib/settings/menuBarOptions";

interface MenuBarModeContextMenu {
    /** Open the menu at the pointer; wire it to the title bar's `onContextMenu`. */
    openMenu: (event: React.MouseEvent) => void;
    /** The rendered menu element; drop it into the bar's JSX (it portals to the body). */
    menu: React.ReactNode;
}

/** The mode names, spelled out rather than built from the id, so the keys stay greppable. */
const MODE_LABEL_KEYS = {
    hamburger: "workspace.shell.mainMenu.modes.hamburger",
    toolbar: "workspace.shell.mainMenu.modes.toolbar",
} as const;

/**
 * Right-click behaviour for the title bar's left cluster: a checklist of where the main menu goes.
 *
 * The same preference as the Appearance settings row (`ui.menuBar.mode`), offered on the thing it
 * moves. That is what makes the hamburger reversible: an author who collapsed the menus and wants
 * them back has no File ▸ menu left to look in, and right-clicking the bar the menus used to be on
 * is where they will look before they think of the settings window.
 *
 * Written straight to the global store rather than held here, so the Settings window - a different
 * window, reading the same key - agrees with the bar the moment either one changes.
 */
export function useMenuBarModeContextMenu(mode: MenuBarMode): MenuBarModeContextMenu {
    const { t } = useTranslation();
    const { menuState, showMenu, hideMenu } = useContextMenu();

    const openMenu = useCallback(
        (event: React.MouseEvent) => {
            event.preventDefault();
            showMenu(event);
        },
        [showMenu],
    );

    const items: ContextMenuDef = [{
        id: "menu-bar-mode",
        label: t("workspace.shell.mainMenu.label"),
        submenuIconsEnabled: true,
        submenu: MENU_BAR_MODES.map(candidate => ({
            id: `menu-bar-mode:${candidate}`,
            label: t(MODE_LABEL_KEYS[candidate]),
            icon: candidate === mode ? <Check className="h-4 w-4 text-primary" /> : undefined,
            onClick: () => {
                void getInterface().app.state.setGlobalState(MENU_BAR_MODE_KEY, candidate);
            },
        })),
    }];

    const menu = (
        <ContextMenu
            items={items}
            position={menuState.position}
            visible={menuState.visible}
            onClose={hideMenu}
        />
    );

    return { openMenu, menu };
}
