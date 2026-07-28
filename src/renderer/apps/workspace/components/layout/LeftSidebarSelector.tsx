import React, { useRef, useState, type MouseEvent } from "react";
import { ContextMenu, type ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { useTranslation } from "@/lib/i18n";
import { useWorkspace } from "../../context";
import { PanelPosition, type PanelDefinition } from "../../registry/types";
import { SidebarPanelRail } from "./SidebarPanelRail";
import { SIDEBAR_GROUP_ID } from "./sidebarPanelGroup";
import { useSidebarPanelContextMenu } from "./useSidebarPanelContextMenu";

interface LeftSidebarSelectorProps {
    visible: boolean;
    activeId: string | null;
    onToggleVisibility: () => void;
    onSelectPanel: (id: string) => void;
    /** Activate panel, show sidebar, and focus it (asset drop). */
    onActivatePanelForDrop?: (panelId: string) => void;
}

/**
 * Left sidebar panel selector
 * Displays vertically aligned icons for left sidebar panels, plus the collapse group — one icon
 * standing in for the panels folded behind it, which unfolds into a flyout beside the rail.
 */
export function LeftSidebarSelector({
    visible,
    activeId,
    onToggleVisibility,
    onSelectPanel,
    onActivatePanelForDrop,
}: LeftSidebarSelectorProps) {
    const { context } = useWorkspace();
    const { t } = useTranslation();
    const { railPanels, groupPanels, commitReorder, openMenu, menu } = useSidebarPanelContextMenu(
        PanelPosition.Left,
        { grouping: true },
    );
    // Where the collapse group's flyout is pinned (null while closed).
    const [groupMenuAt, setGroupMenuAt] = useState<{ x: number; y: number } | null>(null);
    // A click on the group icon while its flyout is open arrives *after* the outside-mousedown
    // handler has already closed it, so without this the flyout could never be dismissed by
    // clicking the icon again — it would close and immediately reopen.
    const groupClosedAt = useRef(0);

    const openPanel = (panelId: string) => {
        onSelectPanel(panelId);
        if (!visible) {
            onToggleVisibility();
        }
    };

    const runPanel = (panel: PanelDefinition) => {
        if (panel.railAction) {
            // A rail action leads somewhere else entirely (an editor tab, a window), so it neither
            // becomes the active panel nor disturbs the sidebar's current visibility.
            if (context) {
                panel.railAction(context);
            }
            return;
        }
        openPanel(panel.id);
    };

    const handlePanelClick = (panelId: string, event: MouseEvent<HTMLElement>) => {
        if (panelId === SIDEBAR_GROUP_ID) {
            if (Date.now() - groupClosedAt.current < 250) {
                groupClosedAt.current = 0;
                return;
            }
            // Pinned to the icon's right edge so the flyout reads as unfolding out of the rail.
            const rect = event.currentTarget.getBoundingClientRect();
            setGroupMenuAt({ x: rect.right + 4, y: rect.top });
            return;
        }

        const panel = railPanels.find(entry => entry.id === panelId);
        if (panel?.railAction) {
            runPanel(panel);
            return;
        }

        if (activeId === panelId && visible) {
            // Clicking active panel toggles visibility
            onToggleVisibility();
        } else {
            // Clicking different panel switches to it and ensures visibility
            openPanel(panelId);
        }
    };

    const groupItems: ContextMenuDef = groupPanels.map(panel => ({
        id: panel.id,
        label: panel.titleKey ? t(panel.titleKey) : panel.title,
        icon: panel.icon,
        onClick: () => runPanel(panel),
    }));

    // The group stands in for whatever is folded inside it, so it lights up while one of its
    // members is the panel on screen.
    const railActiveId = activeId && groupPanels.some(panel => panel.id === activeId)
        ? SIDEBAR_GROUP_ID
        : activeId;

    return (
        <div
            data-workspace-sidebar-rail=""
            className="bg-surface-sunken border-r border-edge flex flex-col items-center py-2 px-1 gap-1"
            onContextMenu={(event) => openMenu(event)}
        >
            <SidebarPanelRail
                panels={railPanels}
                activeId={railActiveId}
                sidebarVisible={visible}
                onPanelClick={handlePanelClick}
                onActivateForDrop={onActivatePanelForDrop}
                onReorder={commitReorder}
                onPanelContextMenu={openMenu}
            />
            {menu}
            {groupMenuAt && (
                <ContextMenu
                    items={groupItems}
                    position={groupMenuAt}
                    visible
                    onClose={() => {
                        setGroupMenuAt(null);
                        groupClosedAt.current = Date.now();
                    }}
                    iconsEnabled
                />
            )}
        </div>
    );
}
