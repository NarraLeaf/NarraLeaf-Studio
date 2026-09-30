import React, { useCallback } from "react";
import { Check, Ellipsis } from "lucide-react";
import {
    ContextMenu,
    ContextMenuDef,
    useContextMenu,
} from "@/lib/components/elements/ContextMenu";
import { useTranslation } from "@/lib/i18n";
import { useRegistry } from "../../registry";
import { PanelPosition, type PanelDefinition } from "../../registry/types";
import { mergeVisibleRailOrder } from "./sidebarPanelOrder";
import {
    DEFAULT_COLLAPSED_PANEL_IDS,
    isRailLayoutDefault,
    SIDEBAR_GROUP_ID,
    weaveGroupSlot,
} from "./sidebarPanelGroup";

interface SidebarPanelContextMenuOptions {
    /**
     * Give this dock a collapse group: an extra rail entry that panels can be folded into.
     * Off by default — only the left rail has one.
     */
    grouping?: boolean;
}

interface SidebarPanelContextMenu {
    /**
     * Panels the rail should render, in display order: the ones currently shown (hidden and
     * collapsed panels drop out), with the collapse group's own entry woven in at its slot.
     */
    railPanels: PanelDefinition[];
    /** Whether this dock area has any panels registered at all (regardless of visibility). */
    hasPanels: boolean;
    /** The panels folded into the collapse group, in rail order (what its flyout should list). */
    groupPanels: PanelDefinition[];
    /** Commit a reorder of the *visible* rail ids, keeping hidden panels pinned to their slots. */
    commitReorder: (orderedVisibleIds: string[]) => void;
    /** Open the context menu; pass a panelId to target a specific icon (adds "hide this item"). */
    openMenu: (event: React.MouseEvent, panelId?: string) => void;
    /** The rendered menu element; drop it into the selector's JSX (it portals to the body). */
    menu: React.ReactNode;
}

/**
 * Shared right-click behaviour for a sidebar rail (left / right / bottom dock), plus the collapse
 * group's membership bookkeeping.
 *
 * Right-clicking the rail — either empty space or a specific icon — opens a checklist of every
 * panel registered for that dock (rail actions like the dashboard included), each row checked when
 * its icon is currently shown. Clicking a row shows or hides that panel. When the menu is opened on
 * a specific icon, a trailing block appears: fold it into the group, or hide it.
 * Right-clicking the group's own icon instead lists everything currently folded into it, each row
 * checked; clicking one lifts it back out onto the rail. A final block, present however the menu
 * was opened, puts the whole rail back to its default layout — order, hidden panels and collapse
 * group together; it is greyed out, with the reason as its hover text, while the rail is already
 * in that state.
 *
 * The rail itself only renders {@link SidebarPanelContextMenu.railPanels}, so hidden panels drop out
 * of the strip but stay reachable through the menu, and collapsed ones move into the group's flyout.
 */
export function useSidebarPanelContextMenu(
    position: PanelPosition,
    { grouping = false }: SidebarPanelContextMenuOptions = {},
): SidebarPanelContextMenu {
    const { t } = useTranslation();
    const {
        getPanelsByPosition,
        reorderPanels,
        resetPanelOrder,
        getDefaultPanelOrder,
        resetPanelVisibility,
        panelOrder,
        collapsedPanels,
        setCollapsedPanels,
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
    const label = (panel: PanelDefinition) => (panel.titleKey ? t(panel.titleKey) : panel.title);

    const collapsedIds = grouping ? collapsedPanels[position] ?? [] : [];
    const isCollapsed = (panel: PanelDefinition) => collapsedIds.includes(panel.id);
    // Everything folded away, in rail order — including panels that are also hidden, so the group's
    // menu can still let one go instead of trapping it behind two separate switches.
    const collapsedMembers = allPanels.filter(isCollapsed);
    // Hidden members stay out of the flyout for the same reason they stay off the rail.
    const groupPanels = collapsedMembers.filter(isVisible);
    // A group with nothing to show has nothing to open, so it earns no rail slot; folding a panel
    // in (or un-hiding one that is already in) brings it back.
    const groupShown = groupPanels.length > 0;

    // The group's stand-in rail entry. It carries no `component` and no `railAction`, which is how
    // the icon (asset drops) and the selector (click handling) recognise it as not-a-panel.
    const groupPanel: PanelDefinition = {
        id: SIDEBAR_GROUP_ID,
        title: t("workspace.shell.panelGroup.title"),
        icon: <Ellipsis className="w-4 h-4" />,
        position,
    };

    const panelIds = allPanels.map(panel => panel.id);
    // The dock's full slot list, group included — also the basis for splicing a drag back over the
    // entries that are not currently on the rail.
    const fullIds = groupShown ? weaveGroupSlot(panelIds, panelOrder[position]) : panelIds;

    // What a reset would leave behind: static panel order, nothing hidden, the group back to its
    // out-of-the-box membership and sitting last. With the rail already there a reset would change
    // nothing — including one that would only clear a stored order that happens to match — so the
    // menu says so instead of offering a click with no visible effect.
    const defaultCollapsedIds = grouping ? DEFAULT_COLLAPSED_PANEL_IDS : [];
    const defaultIds = getDefaultPanelOrder(position);
    // Everything is visible after a reset, so the group earns a slot as long as one of its default
    // members is registered in this window at all.
    const defaultGroupShown = defaultCollapsedIds.some(id => panelIds.includes(id));
    const layoutIsDefault = isRailLayoutDefault({
        railIds: fullIds,
        defaultRailIds: defaultGroupShown ? [...defaultIds, SIDEBAR_GROUP_ID] : defaultIds,
        hiddenIds: allPanels.filter(panel => !isVisible(panel)).map(panel => panel.id),
        collapsedIds,
        defaultCollapsedIds,
    });

    const railPanels = fullIds.flatMap(id => {
        if (id === SIDEBAR_GROUP_ID) {
            return [groupPanel];
        }
        const panel = allPanels.find(entry => entry.id === id);
        return panel && isVisible(panel) && !isCollapsed(panel) ? [panel] : [];
    });

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
        // and collapsed panels keep their absolute position instead of being shuffled to the end.
        reorderPanels(position, mergeVisibleRailOrder(fullIds, orderedVisibleIds));
    }, [fullIds, position, reorderPanels]);

    const setCollapsed = useCallback((ids: string[]) => {
        setCollapsedPanels(position, ids);
    }, [position, setCollapsedPanels]);

    // Undo everything the author can do to this rail from here: the drag order, the panels switched
    // off, and the collapse group's membership. Anything left over would make the row a half-reset
    // whose remainder the author has no way to name.
    const resetLayout = useCallback(() => {
        resetPanelOrder(position);
        resetPanelVisibility(position);
        setCollapsedPanels(position, grouping ? [...DEFAULT_COLLAPSED_PANEL_IDS] : []);
    }, [grouping, position, resetPanelOrder, resetPanelVisibility, setCollapsedPanels]);

    // Drive the click off the *displayed* checked state, not the store's blind toggle: clicking a
    // checked row always hides, an unchecked row always shows. (A blind toggle flips an unseeded
    // `undefined` to `true`, which would re-show and focus the panel instead of hiding it.)
    const items: ContextMenuDef = allPanels.map(panel => ({
        id: panel.id,
        label: label(panel),
        icon: isVisible(panel) ? <Check className="h-4 w-4 text-primary" /> : undefined,
        onClick: () => setPanelVisibility(panel.id, !isVisible(panel)),
    }));

    if (targetPanelId === SIDEBAR_GROUP_ID) {
        // On the group itself the trailing block is its membership: every folded panel, checked,
        // and clicking one lifts it back onto the rail. ("Hide this item" is deliberately absent
        // — hiding the group would strand whatever is inside it.)
        items.push({ separator: true as const, id: "sep-group" });
        for (const panel of collapsedMembers) {
            items.push({
                id: `group:${panel.id}`,
                label: label(panel),
                icon: <Check className="h-4 w-4 text-primary" />,
                onClick: () => setCollapsed(collapsedIds.filter(id => id !== panel.id)),
            });
        }
    } else if (targetPanelId) {
        const target = allPanels.find(panel => panel.id === targetPanelId);
        if (target) {
            items.push({ separator: true as const, id: "sep-hide" });
            if (grouping) {
                items.push({
                    id: "collapse-item",
                    label: t("workspace.shell.panelMenu.collapseItem"),
                    onClick: () => setCollapsed([...collapsedIds, target.id]),
                });
            }
            items.push({
                id: "hide-item",
                label: t("workspace.shell.panelMenu.hideItem"),
                onClick: () => setPanelVisibility(target.id, false),
            });
        }
    }

    // The rail's own housekeeping sits last, in its own block: it acts on the whole dock rather
    // than on one row, so it must not read as part of the checklist above it.
    items.push({ separator: true as const, id: "sep-reset" });
    items.push({
        id: "reset-layout",
        label: t("workspace.shell.panelMenu.resetLayout"),
        disabled: layoutIsDefault,
        tooltip: layoutIsDefault ? t("workspace.shell.panelMenu.resetLayoutDisabled") : undefined,
        onClick: resetLayout,
    });

    const menu = (
        <ContextMenu
            items={items}
            position={menuState.position}
            visible={menuState.visible}
            onClose={hideMenu}
            iconsEnabled
        />
    );

    return {
        railPanels,
        hasPanels: allPanels.length > 0,
        groupPanels,
        commitReorder,
        openMenu,
        menu,
    };
}
