import { useMemo } from "react";
import { useStatusBarItems } from "../../hooks/useUIService";
import { useTranslation } from "@/lib/i18n";
import { StatusBarAlignment, type StatusBarItem } from "@/lib/workspace/services/ui/types";
import { builtInStatusBarEntries, StatusEntry } from "../../modules/status-bar";
import type { StatusBarEntryModule } from "../../modules/types";
import { orderStatusBarEntries } from "./statusBarEntryOrder";
import { useStatusBarContextMenu } from "./useStatusBarContextMenu";

/** Fixed bar height; the dock solver subtracts this from the viewport it lays out into. */
export const STATUS_BAR_HEIGHT = 24;

/**
 * A resolved cell: either a built-in module (renders its own component) or an item registered at
 * runtime on the StatusBarService (rendered from its plain text/icon fields). Unifying them here is
 * what lets ordering and the toggle menu treat both kinds identically.
 */
type ResolvedEntry =
    | { kind: "module"; id: string; alignment: StatusBarAlignment; module: StatusBarEntryModule }
    | { kind: "service"; id: string; alignment: StatusBarAlignment; item: StatusBarItem };

/**
 * The workspace status bar: one quiet strip along the bottom, driven entirely by the entry
 * registry. Built-in signals only appear when they carry information (a runtime actually running, a
 * build in flight, unsaved story changes, a non-default zoom) — an idle workspace shows little more
 * than the shortcut hint.
 *
 * Placement follows registration order and is not user-configurable; right-clicking the bar toggles
 * individual entries on and off. See `orderStatusBarEntries` and `useStatusBarContextMenu`.
 */
export function StatusBar() {
    const { t } = useTranslation();
    const serviceItems = useStatusBarItems();

    // Built-ins first, then runtime registrations — so plugin entries pack closest to the centre.
    const entries: ResolvedEntry[] = useMemo(
        () => [
            ...builtInStatusBarEntries.map(
                (module): ResolvedEntry => ({
                    kind: "module",
                    id: module.id,
                    alignment: module.alignment,
                    module,
                }),
            ),
            ...serviceItems.map(
                (item): ResolvedEntry => ({
                    kind: "service",
                    id: item.id,
                    alignment: item.alignment,
                    item,
                }),
            ),
        ],
        [serviceItems],
    );

    // Every registered entry is listed in the menu, including ones currently rendering nothing —
    // the checklist describes the registry, not what happens to be on screen this second.
    const menuEntries = useMemo(
        () =>
            entries.map(entry => ({
                id: entry.id,
                label: entry.kind === "module" ? t(entry.module.labelKey) : entry.item.text,
            })),
        [entries, t],
    );
    const { hiddenIds, openMenu, menu } = useStatusBarContextMenu(menuEntries);

    const renderEntry = (entry: ResolvedEntry) => {
        const onContextMenu = (event: React.MouseEvent) => openMenu(event, entry.id);
        if (entry.kind === "module") {
            const Component = entry.module.component;
            return (
                <div key={entry.id} className="flex items-stretch" onContextMenu={onContextMenu}>
                    <Component />
                </div>
            );
        }
        const { item } = entry;
        if (item.visible === false) {
            return null;
        }
        return (
            <div key={entry.id} className="flex min-w-0 items-stretch" onContextMenu={onContextMenu}>
                <StatusEntry onClick={item.command} title={item.tooltip}>
                    {item.icon}
                    <span className="truncate">{item.text}</span>
                </StatusEntry>
            </div>
        );
    };

    const renderSide = (alignment: StatusBarAlignment) =>
        orderStatusBarEntries(entries, alignment, hiddenIds).map(renderEntry);

    return (
        <div
            className="flex shrink-0 items-stretch justify-between overflow-hidden border-t border-edge bg-surface-sunken"
            style={{ height: STATUS_BAR_HEIGHT }}
            onContextMenu={event => openMenu(event)}
        >
            <div className="flex min-w-0 items-stretch">{renderSide(StatusBarAlignment.Left)}</div>
            <div className="flex min-w-0 items-stretch">{renderSide(StatusBarAlignment.Right)}</div>
            {menu}
        </div>
    );
}
