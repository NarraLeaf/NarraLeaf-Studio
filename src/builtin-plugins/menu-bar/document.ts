/**
 * The menu the author writes down, and how it becomes the one the game draws.
 *
 * Two documents are in play and they are deliberately not the same shape:
 *
 *  - This one is *authored*. Every row carries an id (so the panel can select and reorder it) and
 *    a label written directly or read from one of the project's **translation keys**, because a
 *    menu bar is read by the player and everything else the player reads travels through the
 *    project's own translation tables. Words written directly are offered for translation under the
 *    row's id (`menuBarWords`), so they reach the translation table like words on the interface; a
 *    key's words are translated as the key, and the words beside a key are what shows when the key
 *    no longer exists.
 *  - `GameMenuSpec` (`@shared/types/gameMenu`) is what the running game is handed - the same tree
 *    with the panel's ids dropped and the unfinished rows left out, because what the game needs to
 *    know is what a row says and does, never which row of a panel it came from. The labels travel
 *    with their keys, or the id of their own words, intact: the running game is the only side that
 *    can resolve either, and it does that on every redraw so the bar follows a language change.
 *
 * Comments in English per project convention.
 */

import type {
    GameMenuAction,
    GameMenuDynamicSource,
    GameMenuItemSpec,
    GameMenuLabel,
    GameMenuSpec,
} from "@shared/types/gameMenu";

/**
 * The plugin's own version, and why it may not take a major bump.
 *
 * A project records the version of every plugin it depends on, and this one is a *hard* dependency:
 * the menu it publishes only means anything while the plugin that reads it ships. `classifyCompatibility`
 * calls a different major incompatible, and a hard dependency that resolves incompatible is
 * suppressed - so bumping this to 2.0.0 would take the menu bar out of every game authored before
 * it, silently, leaving only a line in the project's dependency list.
 *
 * Nothing about shipping needs a major: this plugin travels with Studio, so a change reaches every
 * author at once, and the stored document carries its own {@link MENU_BAR_DOCUMENT_VERSION} for
 * shape changes - which `normalizeMenuBarDocument` absorbs rather than refusing. Bump the minor.
 *
 * The guard in `document.test.ts` is what makes this note hard to miss.
 */
export const MENU_BAR_STORE_NAMESPACE = "narraleaf.menu-bar.menu";

export const MENU_BAR_DOCUMENT_VERSION = 1 as const;

/**
 * What a row says.
 *
 * Words written directly (no key) or read from a translation key, one of the two, as the panel's
 * words field writes them. Words written directly are translated through their own unit, under the
 * row's id; a key's words are translated as the key, and `text` beside a key - the key's words when
 * it was chosen - is the net a running game shows if the key is not in it. `text` is also what the
 * panel titles a row by, so a menu is readable in the editor without resolving anything.
 */
export type MenuBarLabel = {
    /** A project translation key, or null for words written directly. */
    key: string | null;
    /** The words written directly; beside a key, what shows when the key is not in the running build. */
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

/** The id a row's own words are offered for translation under (`plugin:narraleaf.menu-bar/<id>`). */
export function menuBarWordsId(rowId: string): string {
    return `${rowId}.label`;
}

/** One of the menu's own words, as the studio entry offers it for translation. */
export type MenuBarWordsEntry = { id: string; text: string; context: string };

/**
 * Every label the author wrote directly, as words to translate: one per menu and per row, under the
 * row's id, with the path the player follows to it as the context ("File › Save"). Labels read from a
 * key are translated as the key and are not listed; separators and automatic lists say nothing of
 * their own. Listed whether or not the bar is shown - switching it off loses nothing.
 */
export function menuBarWords(document: MenuBarDocument): MenuBarWordsEntry[] {
    const out: MenuBarWordsEntry[] = [];
    const visit = (id: string, label: MenuBarLabel, path: string[], items: MenuBarItem[]): void => {
        const here = [...path, label.text.trim() || "…"];
        if (!label.key && label.text.trim()) {
            out.push({ id: menuBarWordsId(id), text: label.text, context: here.join(" › ") });
        }
        for (const item of items) {
            if (item.kind === "action") {
                visit(item.id, item.label, here, []);
            } else if (item.kind === "submenu") {
                visit(item.id, item.label, here, item.items);
            }
        }
    };
    for (const menu of document.menus) {
        visit(menu.id, menu.label, [], menu.items);
    }
    return out;
}

/** A row's label as the game is handed it: its key, or the id its own words are translated under. */
function toGameMenuLabel(id: string, label: MenuBarLabel): GameMenuLabel {
    return label.key ? { key: label.key, text: label.text } : { key: null, text: label.text, words: menuBarWordsId(id) };
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
 * A complete menu bar, in one click.
 *
 * Every row here works in any project: nothing names a page, a function or anything else the author
 * has to have made first, so the bar the button produces is one the player can use immediately.
 * Rows that would need a target - Save, Load, Settings - are left out rather than added incomplete;
 * a row pointing nowhere is worse than a row the author adds themselves.
 *
 * The labels come from the caller, which reads them from the editor's language at the moment the
 * button is pressed, and they are written as plain text with no localization key. A preset is a
 * starting point, not a translation contract: an author who wants the bar to follow the player's
 * language sets keys on the rows they keep.
 */
export type MenuBarPresetLabels = {
    fileMenu: string;
    gameMenu: string;
    viewMenu: string;
    languageMenu: string;
    quit: string;
    next: string;
    autoForward: string;
    skipping: string;
    skipRead: string;
    skipAll: string;
    dialog: string;
    undo: string;
    redo: string;
    fullscreen: string;
    windowScale: string;
    textLanguage: string;
    voiceLanguage: string;
};

export function createMenuBarPreset(labels: MenuBarPresetLabels): MenuBarMenu[] {
    const action = (text: string, action: GameMenuAction): MenuBarItem => ({
        id: createMenuBarId("item"),
        kind: "action",
        label: createMenuBarLabel(text),
        action,
    });
    const dynamic = (source: GameMenuDynamicSource): MenuBarItem => ({
        id: createMenuBarId("item"),
        kind: "dynamic",
        source,
    });
    const separator = (): MenuBarItem => ({ id: createMenuBarId("item"), kind: "separator" });
    const menu = (text: string, items: MenuBarItem[]): MenuBarMenu => ({
        id: createMenuBarId("menu"),
        label: createMenuBarLabel(text),
        items,
    });

    return [
        menu(labels.fileMenu, [
            action(labels.quit, { type: "quitApp" }),
        ]),
        menu(labels.gameMenu, [
            action(labels.next, { type: "next" }),
            separator(),
            action(labels.autoForward, { type: "toggleAutoForward" }),
            action(labels.skipping, { type: "toggleSkipping" }),
            action(labels.skipRead, { type: "setSkipReadText", value: true }),
            action(labels.skipAll, { type: "setSkipReadText", value: false }),
            separator(),
            action(labels.dialog, { type: "toggleDialog" }),
            separator(),
            action(labels.undo, { type: "historyUndo" }),
            action(labels.redo, { type: "historyRedo" }),
        ]),
        menu(labels.viewMenu, [
            action(labels.fullscreen, { type: "toggleFullscreen" }),
            separator(),
            dynamic("windowScale"),
        ]),
        menu(labels.languageMenu, [
            dynamic("textLanguage"),
            dynamic("voiceLanguage"),
        ]),
    ];
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
                ? [{ kind: "submenu", label: toGameMenuLabel(item.id, item.label), items: children }]
                : [];
        }
        return [{ kind: "action", label: toGameMenuLabel(item.id, item.label), action: item.action }];
    });
    return {
        menus: document.menus.flatMap(menu => {
            const items = convert(menu.items);
            return items.length > 0 ? [{ label: toGameMenuLabel(menu.id, menu.label), items }] : [];
        }),
    };
}
