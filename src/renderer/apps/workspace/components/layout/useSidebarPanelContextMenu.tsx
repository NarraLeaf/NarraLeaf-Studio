import React, { useCallback } from "react";
import { Check } from "lucide-react";
import {
    ContextMenu,
    ContextMenuDef,
    useContextMenu,
} from "@/lib/components/elements/ContextMenu";
import { useTranslation } from "@/lib/i18n";
import { useRegistry } from "../../registry";
import { PanelPosition, type PanelDefinition } from "../../registry/types";
import { mergeVisibleRailOrder } from "./sidebarPanelOrder";

interface SidebarPanelContextMenu {
    /** Panels the rail should render: the ones currently shown (hidden panels drop out). */
    railPanels: PanelDefinition[];
    /** Whether this dock area has any panels registered at all (regardless of visibility). */
    hasPanels: boolean;
    /** Commit a reorder of the *visible* rail ids, keeping hidden panels pinned to their slots. */
    commitReorder: (orderedVisibleIds: string[]) => void;
    /** Open the context menu; pass a panelId to target a specific icon (adds "remove this item"). */
    openMenu: (event: React.MouseEvent, panelId?: string) => void;
    /** The rendered menu element; drop it into the selector's JSX (it portals to the body). */
    menu: React.ReactNode;
}

/**
 * Shared right-click behaviour for a sidebar rail (left / right / bottom dock).
 *
 * Right-clicking the rail — either empty space or a specific icon — opens a checklist of every
 * panel registered for that dock (rail actions like the dashboard included), each row checked when
 * its icon is currently shown. Clicking a row shows or hides that panel. When the menu is opened on
 * a specific icon, a trailing "remove this item" entry hides just that panel.
 *
 * The rail itself only renders {@link SidebarPanelContextMenu.railPanels} (the shown panels), so
 * hidden panels drop out of the strip but stay reachable through the menu.
 */
export function useSidebarPanelContextMenu(position: PanelPosition): SidebarPanelContextMenu {
    const { t } = useTranslation();
    const {
        getPanelsByPosition,
        reorderPanels,
        visiblePanels,
        setPanelVisibility,
    } = useRegistry();
    const { menuState, showMenu, hideMenu } = useContextMenu();
    // The icon the menu was opened on (null when opened over empty rail space).
    const [targetPanelId, setTargetPanelId] = React.useState<string | null>(null);

    const allPanels = getPanelsByPosition(position);
    // A panel counts as visible unless explicitly hidden. `undefined` reads as visible because most
    // panels register with `defaultVisible: false` yet have always shown in the rail — that flag
    // gates auto-opening the sidebar, not the rail icon.
    const isVisible = (panel: PanelDefinition) => visiblePanels[panel.id] !== false;
    // The rail (and this menu) treat every entry — including rail actions like the dashboard — the
    // same, so any of them can be hidden and brought back.
    const railPanels = allPanels.filter(isVisible);

    const openMenu = useCallback((event: React.MouseEvent, panelId?: string) => {
        event.preventDefault();
        event.stopPropagation();
        // Nothing registered and no specific icon targeted: don't pop an empty menu.
        if (allPanels.length === 0 && !panelId) {
            return;
        }
        setTargetPanelId(panelId ?? null);
        showMenu(event);
    }, [showMenu, allPanels.length]);

    const commitReorder = useCallback((orderedVisibleIds: string[]) => {
        // The drag only reordered the visible ids; splice them back over the full order so hidden
        // panels keep their absolute position instead of being shuffled to the end.
        const merged = mergeVisibleRailOrder(allPanels.map(panel => panel.id), orderedVisibleIds);
        reorderPanels(position, merged);
    }, [allPanels, position, reorderPanels]);

    // Drive the click off the *displayed* checked state, not the store's blind toggle: clicking a
    // checked row always hides, an unchecked row always shows. (A blind toggle flips an unseeded
    // `undefined` to `true`, which would re-show and focus the panel instead of hiding it.)
    const items: ContextMenuDef = allPanels.map(panel => ({
        id: panel.id,
        label: panel.titleKey ? t(panel.titleKey) : panel.title,
        icon: isVisible(panel) ? <Check className="h-4 w-4 text-primary" /> : undefined,
        onClick: () => setPanelVisibility(panel.id, !isVisible(panel)),
    }));

    const target = targetPanelId
        ? allPanels.find(panel => panel.id === targetPanelId)
        : undefined;
    if (target) {
        items.push({ separator: true as const, id: "sep-remove" });
        items.push({
            id: "remove-item",
            label: t("workspace.shell.panelMenu.removeItem"),
            onClick: () => setPanelVisibility(target.id, false),
        });
    }

    const menu = (
        <ContextMenu
            items={items}
            position={menuState.position}
            visible={menuState.visible}
            onClose={hideMenu}
            iconsEnabled
        />
    );

    return { railPanels, hasPanels: allPanels.length > 0, commitReorder, openMenu, menu };
}
