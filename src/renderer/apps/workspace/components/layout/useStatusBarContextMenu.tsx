import React, { useCallback } from "react";
import { Check } from "lucide-react";
import { ContextMenu, ContextMenuDef, useContextMenu } from "@/lib/components/elements/ContextMenu";
import { useTranslation } from "@/lib/i18n";
import { useStatusBarEntryVisibility } from "./useStatusBarEntryVisibility";

/** A row in the toggle menu: one registered entry, however it got registered. */
export interface StatusBarMenuEntry {
    id: string;
    label: string;
}

interface StatusBarContextMenu {
    hiddenIds: ReadonlySet<string>;
    /** Open the menu; pass an entryId to target a specific cell (adds "remove this item"). */
    openMenu: (event: React.MouseEvent, entryId?: string) => void;
    /** The rendered menu element; drop it into the bar's JSX (it portals to the body). */
    menu: React.ReactNode;
}

/**
 * Right-click behaviour for the status bar, mirroring the sidebar rails' panel menu.
 *
 * Right-clicking the bar — either empty space or a specific cell — opens a checklist of every
 * registered entry, checked when it is switched on. Clicking a row shows or hides that entry.
 * Opening the menu on a cell adds a trailing "remove this item" that hides just that one.
 *
 * Unlike the sidebar rails there is no reordering here: status bar placement follows registration
 * order (see `orderStatusBarEntries`), and the menu deliberately offers no way to change it.
 */
export function useStatusBarContextMenu(entries: StatusBarMenuEntry[]): StatusBarContextMenu {
    const { t } = useTranslation();
    const { hiddenIds, setEntryHidden } = useStatusBarEntryVisibility();
    const { menuState, showMenu, hideMenu } = useContextMenu();
    // The cell the menu was opened on (null when opened over empty bar space).
    const [targetId, setTargetId] = React.useState<string | null>(null);

    const openMenu = useCallback(
        (event: React.MouseEvent, entryId?: string) => {
            event.preventDefault();
            event.stopPropagation();
            setTargetId(entryId ?? null);
            showMenu(event);
        },
        [showMenu],
    );

    const items: ContextMenuDef = entries.map(entry => ({
        id: entry.id,
        label: entry.label,
        icon: hiddenIds.has(entry.id) ? undefined : <Check className="h-4 w-4 text-primary" />,
        onClick: () => setEntryHidden(entry.id, !hiddenIds.has(entry.id)),
    }));

    const target = targetId ? entries.find(entry => entry.id === targetId) : undefined;
    if (target) {
        items.push({ separator: true as const, id: "sep-remove" });
        items.push({
            id: "remove-item",
            label: t("workspace.shell.panelMenu.removeItem"),
            onClick: () => setEntryHidden(target.id, true),
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

    return { hiddenIds, openMenu, menu };
}
