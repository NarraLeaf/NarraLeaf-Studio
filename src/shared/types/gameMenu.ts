/**
 * The menu bar a shipped desktop game shows above its stage.
 *
 * Two shapes travel this file, and keeping them apart is the whole design:
 *
 *  - A {@link GameMenuSpec} is what the *author* declared - an ordered tree of labels and actions,
 *    published with the game. It says what the menu offers, never what state it is in.
 *  - A {@link GameMenuModel} is what the *main process* draws - the same tree with every label
 *    resolved, every dynamic list expanded, and every tick and grey-out already decided.
 *
 * The resolution between them happens in the game renderer, because that is the only side that
 * knows whether a playthrough is running, which language is on, or what the display can fit. The
 * main process therefore holds no game concepts at all: it lays out labels and reports which id was
 * clicked. That boundary is what lets the whole feature live in a plugin - see the built-in
 * `narraleaf.menu-bar`, which owns the authoring surface and the document, while nothing in
 * Studio's own model grows a notion of a menu bar.
 *
 * Comments in English per project convention.
 */

/**
 * Lists whose members only the running game knows.
 *
 * They are a separate item kind rather than something an author enumerates, because the author
 * cannot: which dub languages a build ships is decided at build time, and which window sizes fit is
 * decided by the display in front of the player. An empty answer draws nothing at all - the same
 * degradation `Get Window Scale Options` already has, so a game on a small screen loses the row
 * instead of offering a size it cannot take.
 */
/**
 * What a row says, before the running game has looked the wording up.
 *
 * A key and a fallback rather than a string, because a menu bar is read by the player and
 * everything else the player reads travels through the project's own localization tables. The key
 * is resolved when the bar is drawn rather than when it is declared, which is what makes the words
 * follow a language change and what keeps a plugin from having to publish its menu again to get
 * them. `text` is what shows when there is no key, or when the key is not in this build.
 */
export type GameMenuLabel = {
    readonly key?: string | null;
    readonly text: string;
};

export const GAME_MENU_DYNAMIC_SOURCES = ["textLanguage", "voiceLanguage", "windowScale"] as const;

export type GameMenuDynamicSource = typeof GAME_MENU_DYNAMIC_SOURCES[number];

/**
 * What a menu item does when it is clicked.
 *
 * A closed vocabulary plus one escape hatch, and the split is deliberate. The named actions are the
 * ones that carry *state* - a tick, a grey-out, a radio group - which an author cannot express from
 * outside the running game. Everything else is a fn call: it runs a function the author declared in
 * the global blueprint, so the menu never has to grow a second scripting model of its own.
 */
export type GameMenuAction =
    /** Open an app surface as a page. */
    | { readonly type: "openPage"; readonly surfaceId: string }
    /** Open an app surface as a layer over whatever is on screen. */
    | {
        readonly type: "openLayer";
        readonly surfaceId: string;
        readonly modal?: boolean;
        readonly dismissible?: boolean;
        readonly group?: string | null;
    }
    /** End the playthrough and hand the screen to a page - the same act as the story's quit row. */
    | { readonly type: "quitToPage"; readonly surfaceId: string }
    /**
     * Close the game.
     *
     * The same act as the Quit Application node, which means the same terms: a graceful quit that
     * does NOT run the author's close handler (`On Window Close Requested` answers the window
     * frame's own close, and the node deliberately stands the guard aside so a quit the game asked
     * for is not asked back about). An author who wants their own "really quit?" screen binds a
     * function instead and calls the node at the end of it - which is the same answer this menu
     * gives for every other confirmation.
     */
    | { readonly type: "quitApp" }
    /** Advance the line on screen. */
    | { readonly type: "next" }
    /** Auto-forward on/off. Ticked while on. */
    | { readonly type: "toggleAutoForward" }
    /** Skipping on/off. Ticked while running. */
    | { readonly type: "toggleSkipping" }
    /** Which lines skipping stops at. The two values are a radio pair, never one switch. */
    | { readonly type: "setSkipReadText"; readonly value: boolean }
    /** Show or hide the dialogue box. Ticked while shown. */
    | { readonly type: "toggleDialog" }
    /** Step back one line of history. Greyed out when there is none. */
    | { readonly type: "historyUndo" }
    /** Step forward again after an undo. Greyed out when there is none. */
    | { readonly type: "historyRedo" }
    /** Full-screen on/off. Ticked while full-screen, including when the OS did it. */
    | { readonly type: "toggleFullscreen" }
    /**
     * Call a function declared in the global blueprint.
     *
     * `fnRef` is the catalogue's own reference (see `fnCatalog`), and `args` are keyed by the head's
     * parameter pin ids. Everything the named actions above do not cover goes through here -
     * including every confirmation, because what a game asks before losing a playthrough is the
     * author's screen and not a native box in a language the game may not even be running in.
     */
    | {
        readonly type: "fn";
        readonly fnRef: string;
        readonly args?: Readonly<Record<string, unknown>>;
    };

/** An authored menu entry, before the running game has said anything about its state. */
export type GameMenuItemSpec =
    | { readonly kind: "separator" }
    | { readonly kind: "submenu"; readonly label: GameMenuLabel; readonly items: readonly GameMenuItemSpec[] }
    | { readonly kind: "action"; readonly label: GameMenuLabel; readonly action: GameMenuAction }
    | { readonly kind: "dynamic"; readonly source: GameMenuDynamicSource };

/** One top-level menu: the word on the bar, and what drops down from it. */
export type GameMenuSpecMenu = {
    readonly label: GameMenuLabel;
    readonly items: readonly GameMenuItemSpec[];
};

/** The whole bar, as the author ordered it. */
export type GameMenuSpec = {
    readonly menus: readonly GameMenuSpecMenu[];
};

/** A drawn menu entry: label resolved, state decided, click routed by `id`. */
export type GameMenuModelItem =
    | { readonly kind: "separator" }
    | { readonly kind: "submenu"; readonly label: string; readonly items: readonly GameMenuModelItem[] }
    | {
        readonly kind: "command";
        readonly id: string;
        readonly label: string;
        readonly enabled: boolean;
        /**
         * What the platform already has its own item for.
         *
         * Only the shell can act on this, which is why it is a hint rather than a decision: macOS
         * puts Quit in the application menu and puts it there whatever the game says, so an
         * author's own Quit row would be the second one on the same bar. Windows and Linux have no
         * such menu and draw the row as authored.
         */
        readonly role?: "quit";
    }
    | {
        readonly kind: "checkbox";
        readonly id: string;
        readonly label: string;
        readonly enabled: boolean;
        readonly checked: boolean;
    }
    | {
        readonly kind: "radio";
        readonly id: string;
        readonly label: string;
        readonly enabled: boolean;
        readonly checked: boolean;
    };

export type GameMenuModelMenu = {
    readonly label: string;
    readonly items: readonly GameMenuModelItem[];
};

/** What the main process is handed. An empty `menus` means take the bar away. */
export type GameMenuModel = {
    readonly menus: readonly GameMenuModelMenu[];
};

export const EMPTY_GAME_MENU_MODEL: GameMenuModel = { menus: [] };

/**
 * How deep a submenu may nest before the tree is refused.
 *
 * Deeper rows are dropped, and a submenu left with nothing under it is dropped in turn - so a
 * branch that runs past the cap goes entirely rather than ending in a word that opens onto nothing.
 * The authoring panel never builds one this deep; the cap is for a document edited by hand.
 */
export const GAME_MENU_MAX_DEPTH = 3;

/** Longest label a menu may carry, in characters. Anything longer is truncated on the way in. */
export const GAME_MENU_MAX_LABEL_LENGTH = 120;

/**
 * Read a spec label.
 *
 * A bare string is accepted and read as "no key": that is what a caller with nothing to translate
 * writes, and refusing it would make the simple case the awkward one.
 */
function normalizeSpecLabel(value: unknown): GameMenuLabel | null {
    if (typeof value === "string") {
        const text = normalizeLabel(value);
        return text ? { key: null, text } : null;
    }
    if (!value || typeof value !== "object") {
        return null;
    }
    const record = value as Record<string, unknown>;
    const key = typeof record.key === "string" && record.key.trim() ? record.key.trim() : null;
    const text = normalizeLabel(record.text);
    // A key with no fallback is still a usable row - the key is the answer and the fallback is the
    // net - but a row with neither says nothing at all.
    return key || text ? { key, text } : null;
}

function normalizeLabel(value: unknown): string {
    if (typeof value !== "string") {
        return "";
    }
    // Newlines and tabs are laid out by the platform in ways no author can predict, and a label is
    // one line by definition - so they become spaces here rather than a reason to drop the item.
    const flattened = value.replace(/[\r\n\t]+/g, " ").trim();
    return flattened.length > GAME_MENU_MAX_LABEL_LENGTH
        ? flattened.slice(0, GAME_MENU_MAX_LABEL_LENGTH)
        : flattened;
}

function normalizeAction(value: unknown): GameMenuAction | null {
    if (!value || typeof value !== "object") {
        return null;
    }
    const record = value as Record<string, unknown>;
    const surfaceId = typeof record.surfaceId === "string" ? record.surfaceId.trim() : "";
    switch (record.type) {
        case "openPage":
            return surfaceId ? { type: "openPage", surfaceId } : null;
        case "openLayer":
            return surfaceId
                ? {
                    type: "openLayer",
                    surfaceId,
                    modal: record.modal === true,
                    dismissible: record.dismissible !== false,
                    group: typeof record.group === "string" && record.group.trim()
                        ? record.group.trim()
                        : null,
                }
                : null;
        case "quitToPage":
            return surfaceId ? { type: "quitToPage", surfaceId } : null;
        case "setSkipReadText":
            return { type: "setSkipReadText", value: record.value === true };
        case "fn": {
            const fnRef = typeof record.fnRef === "string" ? record.fnRef.trim() : "";
            if (!fnRef) {
                return null;
            }
            const args = record.args && typeof record.args === "object" && !Array.isArray(record.args)
                ? { ...record.args as Record<string, unknown> }
                : undefined;
            return args ? { type: "fn", fnRef, args } : { type: "fn", fnRef };
        }
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

/**
 * Drop separators that would draw a line against nothing.
 *
 * Leading, trailing and doubled ones all come from the same place - an author reordering rows, or
 * an item that was dropped on the way in - and every platform draws them as a stray groove.
 */
function trimSeparators(items: GameMenuItemSpec[]): GameMenuItemSpec[] {
    const kept: GameMenuItemSpec[] = [];
    for (const item of items) {
        const previous = kept[kept.length - 1];
        if (item.kind === "separator" && (kept.length === 0 || previous?.kind === "separator")) {
            continue;
        }
        kept.push(item);
    }
    while (kept.length > 0 && kept[kept.length - 1]?.kind === "separator") {
        kept.pop();
    }
    return kept;
}

function normalizeItems(value: unknown, depth: number): GameMenuItemSpec[] {
    if (!Array.isArray(value) || depth > GAME_MENU_MAX_DEPTH) {
        return [];
    }
    const items: GameMenuItemSpec[] = [];
    for (const entry of value) {
        if (!entry || typeof entry !== "object") {
            continue;
        }
        const record = entry as Record<string, unknown>;
        if (record.kind === "separator") {
            items.push({ kind: "separator" });
            continue;
        }
        if (record.kind === "dynamic") {
            const source = GAME_MENU_DYNAMIC_SOURCES.find(candidate => candidate === record.source);
            if (source) {
                items.push({ kind: "dynamic", source });
            }
            continue;
        }
        const label = normalizeSpecLabel(record.label);
        if (record.kind === "submenu") {
            const children = normalizeItems(record.items, depth + 1);
            // A submenu with nothing under it is a word the player can click and watch do nothing,
            // which is worse than the row not being there.
            if (label && children.length > 0) {
                items.push({ kind: "submenu", label, items: children });
            }
            continue;
        }
        if (record.kind === "action") {
            const action = normalizeAction(record.action);
            if (label && action) {
                items.push({ kind: "action", label, action });
            }
        }
    }
    return trimSeparators(items);
}

/**
 * Read anything into a menu the game can draw.
 *
 * Never throws, and drops what it cannot read rather than refusing the whole bar: this runs on a
 * document a plugin published with the game, and a game whose menu is one row short is a game that
 * still plays. What it does drop is a top-level menu with nothing under it, because an empty word
 * on the bar is the one failure a player can see and not explain.
 */
export function normalizeGameMenuSpec(value: unknown): GameMenuSpec {
    const record = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    const menus = Array.isArray(record.menus) ? record.menus : [];
    const normalized: GameMenuSpecMenu[] = [];
    for (const entry of menus) {
        if (!entry || typeof entry !== "object") {
            continue;
        }
        const menu = entry as Record<string, unknown>;
        const label = normalizeSpecLabel(menu.label);
        const items = normalizeItems(menu.items, 1);
        if (label && items.length > 0) {
            normalized.push({ label, items });
        }
    }
    return { menus: normalized };
}

function normalizeModelItems(value: unknown, depth: number): GameMenuModelItem[] {
    if (!Array.isArray(value) || depth > GAME_MENU_MAX_DEPTH) {
        return [];
    }
    const items: GameMenuModelItem[] = [];
    for (const entry of value) {
        if (!entry || typeof entry !== "object") {
            continue;
        }
        const record = entry as Record<string, unknown>;
        if (record.kind === "separator") {
            items.push({ kind: "separator" });
            continue;
        }
        const label = normalizeLabel(record.label);
        if (!label) {
            continue;
        }
        if (record.kind === "submenu") {
            const children = normalizeModelItems(record.items, depth + 1);
            if (children.length > 0) {
                items.push({ kind: "submenu", label, items: children });
            }
            continue;
        }
        const id = typeof record.id === "string" ? record.id.trim() : "";
        if (!id) {
            continue;
        }
        const enabled = record.enabled !== false;
        if (record.kind === "checkbox" || record.kind === "radio") {
            items.push({ kind: record.kind, id, label, enabled, checked: record.checked === true });
            continue;
        }
        if (record.kind === "command") {
            items.push(record.role === "quit"
                ? { kind: "command", id, label, enabled, role: "quit" }
                : { kind: "command", id, label, enabled });
        }
    }
    return items;
}

/**
 * Read anything into a model the shell can draw.
 *
 * The renderer already resolved this one, so nothing here is a second opinion about what the menu
 * says - it is the boundary check every IPC payload gets, and it drops what it cannot read rather
 * than throwing. A menu bar is not worth ending a process over.
 *
 * Separators are kept exactly as sent, unlike {@link normalizeGameMenuSpec}: by this point the
 * platform still has one filter of its own to apply (see the shell's template builder), so tidying
 * grooves here would only have to be done again afterwards.
 */
export function normalizeGameMenuModel(value: unknown): GameMenuModel {
    const record = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    const menus = Array.isArray(record.menus) ? record.menus : [];
    const normalized: GameMenuModelMenu[] = [];
    for (const entry of menus) {
        if (!entry || typeof entry !== "object") {
            continue;
        }
        const menu = entry as Record<string, unknown>;
        const label = normalizeLabel(menu.label);
        const items = normalizeModelItems(menu.items, 1);
        if (label && items.length > 0) {
            normalized.push({ label, items });
        }
    }
    return { menus: normalized };
}

/** Whether a model has anything to draw. `false` is the signal to take the bar away entirely. */
export function isGameMenuModelEmpty(model: GameMenuModel | null | undefined): boolean {
    return !model || model.menus.length === 0;
}
