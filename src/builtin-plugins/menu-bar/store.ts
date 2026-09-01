/**
 * The editing store behind the Menu Bar panel.
 *
 * One observable copy of the authored menu, mutated through named operations that all funnel into
 * `commit`: normalize, notify, then persist. The same shape the Gallery store uses, and the two
 * unusual things in it are the same two:
 *
 *  - **`commit` refuses to run while the project is frozen.** Persisting last is only safe while
 *    the write lands. Frozen, the write is dropped at the boundary and the mutation would survive
 *    in memory alone - and memory is what the next successful save writes.
 *  - **`reload` exists.** Studio replaces the project's documents under the editors (a restored
 *    version, a version view, a thaw) and this store is one of them.
 *
 * Rows are addressed by a path of ids from the menu down, because that is what a tree with two
 * levels of nesting needs and an index would not survive a reorder.
 *
 * Comments in English per project convention.
 */

import type { GameMenuAction, GameMenuDynamicSource } from "@shared/types/gameMenu";
import type { PluginApp } from "narraleaf-studio/plugin";
import {
    EMPTY_MENU_BAR_DOCUMENT,
    MENU_BAR_STORE_NAMESPACE,
    createMenuBarId,
    createMenuBarLabel,
    normalizeMenuBarDocument,
    type MenuBarDocument,
    type MenuBarItem,
    type MenuBarItemKind,
    type MenuBarLabel,
    type MenuBarMenu,
} from "./document";

export type MenuBarStore = ReturnType<typeof createMenuBarStore>;

/** Where a row sits: the menu's id, then one id per level down. */
export type MenuBarPath = string[];

export function samePath(a: MenuBarPath | null, b: MenuBarPath | null): boolean {
    return Boolean(a && b) && a!.length === b!.length && a!.every((id, index) => id === b![index]);
}

/** The default action a new row gets: the one that needs a target, so the row reads as unfinished. */
const DEFAULT_ACTION: GameMenuAction = { type: "openPage", surfaceId: "" };

function newItem(kind: MenuBarItemKind, label: string): MenuBarItem {
    const id = createMenuBarId("item");
    switch (kind) {
        case "separator":
            return { id, kind: "separator" };
        case "submenu":
            return { id, kind: "submenu", label: createMenuBarLabel(label), items: [] };
        case "dynamic":
            return { id, kind: "dynamic", source: "textLanguage" };
        default:
            return { id, kind: "action", label: createMenuBarLabel(label), action: DEFAULT_ACTION };
    }
}

/** Replace one row somewhere in the tree, leaving everything else identical. */
function mapItems(
    items: MenuBarItem[],
    path: MenuBarPath,
    replace: (item: MenuBarItem) => MenuBarItem | null,
): MenuBarItem[] {
    const [head, ...rest] = path;
    return items.flatMap(item => {
        if (item.id !== head) {
            return [item];
        }
        if (rest.length === 0) {
            const next = replace(item);
            return next ? [next] : [];
        }
        return item.kind === "submenu"
            ? [{ ...item, items: mapItems(item.items, rest, replace) }]
            : [item];
    });
}

/**
 * Move a row to a gap in its own list. Never moves a row between lists.
 *
 * A gap index rather than "before this row": a list of n rows has n+1 places a row can land, the
 * lower half of one row and the upper half of the next are the same place, and an index is the only
 * way to say that once. See the drop model the whole app shares.
 *
 * The index is read against the list with the dragged row already taken out, which is what makes
 * dragging downwards land where the line was drawn rather than one row short.
 */
function moveToGapWithin(items: MenuBarItem[], path: MenuBarPath, gapIndex: number): MenuBarItem[] {
    const [head, ...rest] = path;
    if (rest.length > 0) {
        return items.map(item => (
            item.id === head && item.kind === "submenu"
                ? { ...item, items: moveToGapWithin(item.items, rest, gapIndex) }
                : item
        ));
    }
    return reorderToGap(items, head ?? "", gapIndex);
}

/** The list with `id` lifted out and put back at `gapIndex`, or the same list when nothing moves. */
function reorderToGap<T extends { id: string }>(items: T[], id: string, gapIndex: number): T[] {
    const from = items.findIndex(item => item.id === id);
    if (from < 0) {
        return items;
    }
    const without = items.filter(item => item.id !== id);
    const to = Math.max(0, Math.min(without.length, gapIndex > from ? gapIndex - 1 : gapIndex));
    if (to === from) {
        // Dropped back where it started: no write, no history entry, nothing to report.
        return items;
    }
    const next = [...without];
    next.splice(to, 0, items[from]!);
    return next;
}

function findItem(items: MenuBarItem[], path: MenuBarPath): MenuBarItem | null {
    const [head, ...rest] = path;
    const item = items.find(candidate => candidate.id === head) ?? null;
    if (!item || rest.length === 0) {
        return item;
    }
    return item.kind === "submenu" ? findItem(item.items, rest) : null;
}

export function createMenuBarStore(app: PluginApp) {
    let data: MenuBarDocument = EMPTY_MENU_BAR_DOCUMENT;
    const listeners = new Set<() => void>();

    const notify = (): void => {
        for (const listener of listeners) {
            listener();
        }
    };

    const read = async (): Promise<MenuBarDocument> => normalizeMenuBarDocument(
        await app.services.storage.readJson<MenuBarDocument>(MENU_BAR_STORE_NAMESPACE),
    );

    const commit = async (next: Partial<MenuBarDocument>): Promise<void> => {
        // Nothing at all, not even in memory - see the note at the top of this file. The panel
        // greys out every control that gets here, so reaching it is a path that was missed rather
        // than something the author can do.
        if (app.services.workspace.frozen) {
            return;
        }
        data = normalizeMenuBarDocument({ ...data, ...next });
        notify();
        await app.services.storage.writeJson<MenuBarDocument>(MENU_BAR_STORE_NAMESPACE, data);
    };

    const commitMenus = (menus: MenuBarMenu[]): Promise<void> => commit({ menus });

    /** Apply an edit to one menu's item tree, or to the menu itself when the path is just its id. */
    const editMenu = (path: MenuBarPath, edit: (menu: MenuBarMenu) => MenuBarMenu | null): Promise<void> => {
        const [menuId] = path;
        return commitMenus(data.menus.flatMap(menu => {
            if (menu.id !== menuId) {
                return [menu];
            }
            const next = edit(menu);
            return next ? [next] : [];
        }));
    };

    return {
        getData: (): MenuBarDocument => data,
        subscribe: (listener: () => void): (() => void) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        load: async (): Promise<void> => {
            data = await read();
            notify();
        },
        reload: async (): Promise<void> => {
            data = await read();
            notify();
        },
        find: (path: MenuBarPath): MenuBarMenu | MenuBarItem | null => {
            const [menuId, ...rest] = path;
            const menu = data.menus.find(candidate => candidate.id === menuId) ?? null;
            if (!menu || rest.length === 0) {
                return menu;
            }
            return findItem(menu.items, rest);
        },
        setEnabled: (enabled: boolean): Promise<void> => commit({ enabled }),
        addMenu: (label: string): MenuBarPath => {
            const menu: MenuBarMenu = { id: createMenuBarId("menu"), label: createMenuBarLabel(label), items: [] };
            void commitMenus([...data.menus, menu]);
            return [menu.id];
        },
        /** Add a row to a menu, or to a submenu when the path names one. */
        addItem: (path: MenuBarPath, kind: MenuBarItemKind, label: string): MenuBarPath => {
            const item = newItem(kind, label);
            const [menuId, ...rest] = path;
            void editMenu([menuId!], menu => (rest.length === 0
                ? { ...menu, items: [...menu.items, item] }
                : {
                    ...menu,
                    items: mapItems(menu.items, rest, target => (target.kind === "submenu"
                        ? { ...target, items: [...target.items, item] }
                        : target)),
                }));
            return [...path, item.id];
        },
        remove: (path: MenuBarPath): void => {
            const [menuId, ...rest] = path;
            if (rest.length === 0) {
                void commitMenus(data.menus.filter(menu => menu.id !== menuId));
                return;
            }
            void editMenu([menuId!], menu => ({ ...menu, items: mapItems(menu.items, rest, () => null) }));
        },
        /** Drop a menu or a row into one of the gaps in the list it already belongs to. */
        moveToGap: (path: MenuBarPath, gapIndex: number): void => {
            const [menuId, ...rest] = path;
            if (rest.length === 0) {
                const menus = reorderToGap(data.menus, menuId ?? "", gapIndex);
                if (menus !== data.menus) {
                    void commitMenus(menus);
                }
                return;
            }
            void editMenu([menuId!], menu => ({
                ...menu,
                items: moveToGapWithin(menu.items, rest, gapIndex),
            }));
        },
        setLabel: (path: MenuBarPath, label: MenuBarLabel): void => {
            const [menuId, ...rest] = path;
            if (rest.length === 0) {
                void editMenu([menuId!], menu => ({ ...menu, label }));
                return;
            }
            void editMenu([menuId!], menu => ({
                ...menu,
                items: mapItems(menu.items, rest, item => (item.kind === "separator" || item.kind === "dynamic"
                    ? item
                    : { ...item, label })),
            }));
        },
        setAction: (path: MenuBarPath, action: GameMenuAction): void => {
            const [menuId, ...rest] = path;
            void editMenu([menuId!], menu => ({
                ...menu,
                items: mapItems(menu.items, rest, item => (item.kind === "action" ? { ...item, action } : item)),
            }));
        },
        setSource: (path: MenuBarPath, source: GameMenuDynamicSource): void => {
            const [menuId, ...rest] = path;
            void editMenu([menuId!], menu => ({
                ...menu,
                items: mapItems(menu.items, rest, item => (item.kind === "dynamic" ? { ...item, source } : item)),
            }));
        },
    };
}
