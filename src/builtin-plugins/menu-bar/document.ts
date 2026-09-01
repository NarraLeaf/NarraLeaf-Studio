/**
 * The menu the author writes down, and how it becomes the one the game draws.
 *
 * Two documents are in play and they are deliberately not the same shape:
 *
 *  - This one is *authored*. Every row carries an id (so the panel can select and reorder it) and
 *    a label that is a **localization key** rather than a string, because a menu bar is read by the
 *    player and everything else the player reads travels through the project's own translation
 *    tables. The key is optional and the fallback beside it is not: a project that has not set up
 *    localization still gets a menu, and a key that no longer exists still gets a word.
 *  - `GameMenuSpec` (`@shared/types/gameMenu`) is what the running game is handed - the same tree
 *    with the panel's ids dropped and the unfinished rows left out, because what the game needs to
 *    know is what a row says and does, never which row of a panel it came from. The labels travel
 *    with their keys intact: the running game is the only side that can resolve one, and it does
 *    that on every redraw so the bar follows a language change.
 *
 * Comments in English per project convention.
 */

import type {
    GameMenuAction,
    GameMenuDynamicSource,
    GameMenuItemSpec,
    GameMenuSpec,
} from "@shared/types/gameMenu";

export const MENU_BAR_STORE_NAMESPACE = "narraleaf.menu-bar.menu";

export const MENU_BAR_DOCUMENT_VERSION = 1 as const;

/**
 * What a row says.
 *
 * The key is the answer and the text is the safety net, never the other way round: an author who
 * picks a key gets a row that follows the player's language, and one who has not set localization
 * up yet gets the word they typed. `text` is also what the panel shows, so a menu is readable in
 * the editor without resolving anything.
 */
export type MenuBarLabel = {
    /** A project localization key, or null while the author has not chosen one. */
    key: string | null;
    /** Shown when there is no key, or when the key is not in the running build. */
    text: string;
};

export type MenuBarItem =
    | { id: string; kind: "separator" }
    | { id: string; kind: "submenu"; label: MenuBarLabel; items: MenuBarItem[] }
    | { id: string; kind: "action"; label: MenuBarLabel; action: GameMenuAction }
    | { id: string; kind: "dynamic"; source: GameMenuDynamicSource };

export type MenuBarMenu = {
    id: string;
    label: MenuBarLabel;
    items: MenuBarItem[];
};

export type MenuBarDocument = {
    version: typeof MENU_BAR_DOCUMENT_VERSION;
    /**
     * Whether the game shows the bar at all.
     *
     * Kept rather than making an empty document mean the same thing, because emptying a menu to
     * switch it off would lose the author's work - and a project that is deciding whether to ship
     * one wants to try both without rebuilding the rows.
     */
    enabled: boolean;
    menus: MenuBarMenu[];
};

export const EMPTY_MENU_BAR_DOCUMENT: MenuBarDocument = {
    version: MENU_BAR_DOCUMENT_VERSION,
    enabled: true,
    menus: [],
};

/** The item kinds a panel can add, in the order the add menu offers them. */
export const MENU_BAR_ITEM_KINDS = ["action", "dynamic", "submenu", "separator"] as const;

export type MenuBarItemKind = typeof MENU_BAR_ITEM_KINDS[number];

/**
 * Ids are the panel's, never the player's.
 *
 * Random enough not to collide inside one document and short enough to stay out of the way in a
 * diff. They are not shown anywhere in the interface - a row is identified by its label.
 */
export function createMenuBarId(prefix: string): string {
    const random = Math.random().toString(36).slice(2, 8);
    return `${prefix}-${random}`;
}

export function createMenuBarLabel(text: string): MenuBarLabel {
    return { key: null, text };
}

function normalizeLabel(value: unknown): MenuBarLabel {
    const record = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    const key = typeof record.key === "string" && record.key.trim() ? record.key.trim() : null;
    const text = typeof record.text === "string" ? record.text : "";
    return { key, text };
}

function normalizeAction(value: unknown): GameMenuAction | null {
    if (!value || typeof value !== "object") {
        return null;
    }
    const record = value as Record<string, unknown>;
    const surfaceId = typeof record.surfaceId === "string" ? record.surfaceId : "";
    switch (record.type) {
        case "openPage":
            return { type: "openPage", surfaceId };
        case "openLayer":
            return {
                type: "openLayer",
                surfaceId,
                modal: record.modal === true,
                dismissible: record.dismissible !== false,
                group: typeof record.group === "string" && record.group.trim() ? record.group.trim() : null,
            };
        case "quitToPage":
            return { type: "quitToPage", surfaceId };
        case "setSkipReadText":
            return { type: "setSkipReadText", value: record.value === true };
        case "fn":
            return {
                type: "fn",
                fnRef: typeof record.fnRef === "string" ? record.fnRef : "",
                args: record.args && typeof record.args === "object" && !Array.isArray(record.args)
                    ? { ...record.args as Record<string, unknown> }
                    : {},
            };
        case "quitApp":
        case "next":
        case "toggleAutoForward":
        case "toggleSkipping":
        case "toggleDialog":
        case "historyUndo":
        case "historyRedo":
        case "toggleFullscreen":
            return { type: record.type };
        default:
            return null;
    }
}

function normalizeItems(value: unknown, depth: number): MenuBarItem[] {
    if (!Array.isArray(value) || depth > 2) {
        return [];
    }
    const items: MenuBarItem[] = [];
    for (const entry of value) {
        if (!entry || typeof entry !== "object") {
            continue;
        }
        const record = entry as Record<string, unknown>;
        const id = typeof record.id === "string" && record.id ? record.id : createMenuBarId("item");
        if (record.kind === "separator") {
            items.push({ id, kind: "separator" });
            continue;
        }
        if (record.kind === "dynamic") {
            const source = ["textLanguage", "voiceLanguage", "windowScale"]
                .find(candidate => candidate === record.source) as GameMenuDynamicSource | undefined;
            if (source) {
                items.push({ id, kind: "dynamic", source });
            }
            continue;
        }
        if (record.kind === "submenu") {
            items.push({
                id,
                kind: "submenu",
                label: normalizeLabel(record.label),
                items: normalizeItems(record.items, depth + 1),
            });
            continue;
        }
        if (record.kind === "action") {
            const action = normalizeAction(record.action);
            if (action) {
                items.push({ id, kind: "action", label: normalizeLabel(record.label), action });
            }
        }
    }
    return items;
}

/**
 * Read stored JSON into a document.
 *
 * Never throws and keeps rows a running game would drop - an action with no page chosen yet, a
 * submenu with nothing in it. The editor is where a menu is half-finished, and a panel that
 * silently ate the row an author was in the middle of building would be worse than one that shows
 * it as incomplete. The dropping happens on the way out, in {@link toGameMenuSpec}.
 */
export function normalizeMenuBarDocument(value: unknown): MenuBarDocument {
    const record = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    const menus = Array.isArray(record.menus) ? record.menus : [];
    return {
        version: MENU_BAR_DOCUMENT_VERSION,
        enabled: record.enabled !== false,
        menus: menus.flatMap(entry => {
            if (!entry || typeof entry !== "object") {
                return [];
            }
            const menu = entry as Record<string, unknown>;
            return [{
                id: typeof menu.id === "string" && menu.id ? menu.id : createMenuBarId("menu"),
                label: normalizeLabel(menu.label),
                items: normalizeItems(menu.items, 1),
            }];
        }),
    };
}

/** Whether an authored row is finished enough for a player to be shown it. */
export function isMenuBarItemComplete(item: MenuBarItem): boolean {
    if (item.kind === "separator" || item.kind === "dynamic") {
        return true;
    }
    if (item.kind === "submenu") {
        return item.items.some(isMenuBarItemComplete);
    }
    const action = item.action;
    if (action.type === "openPage" || action.type === "openLayer" || action.type === "quitToPage") {
        return Boolean(action.surfaceId);
    }
    if (action.type === "fn") {
        return Boolean(action.fnRef);
    }
    return true;
}

/**
 * Turn the authored document into the spec the running game is handed.
 *
 * Two things happen here and nowhere else: the panel's own bookkeeping (row ids) is dropped, and so
 * are the rows that were never finished. Dropping late is the point - the panel keeps showing them
 * so the author can finish them, and the player never sees a row that leads nowhere.
 *
 * Labels travel as they were written, key and all. Resolving them here would freeze the wording at
 * the moment the plugin published - which is during boot, before the project's tables can even be
 * read - and would leave the bar in the launch language for the rest of the session. The running
 * game resolves them per redraw instead (see the runtime's `gameMenu`).
 */
export function toGameMenuSpec(document: MenuBarDocument): GameMenuSpec {
    if (!document.enabled) {
        return { menus: [] };
    }
    const convert = (items: MenuBarItem[]): GameMenuItemSpec[] => items.flatMap((item): GameMenuItemSpec[] => {
        if (!isMenuBarItemComplete(item)) {
            return [];
        }
        if (item.kind === "separator") {
            return [{ kind: "separator" }];
        }
        if (item.kind === "dynamic") {
            return [{ kind: "dynamic", source: item.source }];
        }
        if (item.kind === "submenu") {
            const children = convert(item.items);
            return children.length > 0
                ? [{ kind: "submenu", label: item.label, items: children }]
                : [];
        }
        return [{ kind: "action", label: item.label, action: item.action }];
    });
    return {
        menus: document.menus.flatMap(menu => {
            const items = convert(menu.items);
            return items.length > 0 ? [{ label: menu.label, items }] : [];
        }),
    };
}
