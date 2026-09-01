/**
 * The running game's half of the menu bar: what the authored menu means, and what it says right now.
 *
 * The shell below draws labels and reports clicks (see `@shared/types/gameMenu`); everything that
 * needs to know what a save, a language or a skip is happens here, because this is the only side
 * that can. A tick is the preference store's answer, a grey-out is whether a playthrough is
 * running, and the language list is what the build actually shipped.
 *
 * Two things follow from that split and are worth stating, because both look like omissions:
 *
 *  - **Fn-bound items are never greyed out.** Studio cannot know when the author's own function is
 *    ready to run, and an item that guessed would be wrong in the direction that costs the player a
 *    click they should have had. The function decides for itself, which it can - it has the whole
 *    node catalogue in reach.
 *  - **Nothing here has an accelerator.** A menu accelerator is consumed by the main process before
 *    the page sees the key, so a shortcut bound here would take a key away from the author's input
 *    intents without anything saying so.
 *
 * React-free on purpose, like `localeRestart`: the whole of it is testable without a window.
 *
 * Comments in English per project convention.
 */

import {
    EMPTY_GAME_MENU_MODEL,
    type GameMenuAction,
    type GameMenuLabel,
    type GameMenuItemSpec,
    type GameMenuModel,
    type GameMenuModelItem,
    type GameMenuSpec,
} from "@shared/types/gameMenu";
import type {
    BlueprintGamePreferenceKey,
    BlueprintGamePreferenceValue,
} from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";

/** A language the player may pick, as the project named it. */
export type GameMenuLanguageOption = {
    readonly code: string;
    readonly displayName: string;
};

/**
 * Everything the menu needs from the running game.
 *
 * One flat object rather than the host API itself, because the pieces come from three different
 * places - the engine's preferences, the shell's window, the surface router - and a menu that
 * reached for them directly would be a fourth caller to keep in step with all three. Optional
 * members are capabilities a shell may not have; an absent one drops the row it would have drawn
 * rather than drawing one that does nothing.
 */
export type GameMenuPort = {
    isInGame: () => boolean;
    getPreference: (key: BlueprintGamePreferenceKey) => BlueprintGamePreferenceValue;
    setPreference: (key: BlueprintGamePreferenceKey, value: BlueprintGamePreferenceValue) => Promise<void>;
    canUndoHistory: () => boolean;
    canRedoHistory: () => boolean;
    undoHistory: () => Promise<void>;
    redoHistory: () => Promise<void>;
    next: () => Promise<void>;
    toggleDialog: () => Promise<void>;
    openPage: (surfaceId: string) => Promise<void>;
    openLayer: (
        surfaceId: string,
        options: { modal: boolean; dismissible: boolean; group: string | null },
    ) => Promise<void>;
    quitToPage: (surfaceId: string) => Promise<void>;
    quitApplication: () => Promise<void>;
    getFullscreen?: () => Promise<boolean>;
    setFullscreen?: (fullscreen: boolean) => Promise<void>;
    getWindowScale?: () => Promise<number>;
    getWindowScaleOptions?: () => Promise<number[]>;
    setWindowScale?: (scale: number) => Promise<void>;
    /**
     * One of the project's localization keys, in the language given.
     *
     * Synchronous and taking the locale rather than reading it, so every row of one rebuild is
     * resolved against the same language - a bar half in one language and half in another is what
     * an async lookup per row would eventually produce.
     */
    localizedText: (key: string, locale: string) => string | null;
    listTextLanguages: () => readonly GameMenuLanguageOption[];
    getTextLanguage: () => Promise<string>;
    setTextLanguage: (code: string) => Promise<void>;
    listVoiceLanguages: () => readonly GameMenuLanguageOption[];
    getVoiceLanguage: () => Promise<string>;
    setVoiceLanguage: (code: string) => Promise<void>;
    /** Run a function declared in the global blueprint. */
    callFn: (fnRef: string, args?: Record<string, unknown>) => Promise<void>;
};

/**
 * What a drawn item does, once the dynamic lists have been expanded.
 *
 * The authored actions plus the three the expansion produces: an author names the *list*, and each
 * row of it is a choice only this module ever constructs.
 */
export type ResolvedMenuCommand =
    | GameMenuAction
    | { readonly type: "pickTextLanguage"; readonly code: string }
    | { readonly type: "pickVoiceLanguage"; readonly code: string }
    | { readonly type: "pickWindowScale"; readonly scale: number };

/** The state a whole model is resolved against, read once so every row agrees with every other. */
type MenuState = {
    readonly inGame: boolean;
    readonly fullscreen: boolean | null;
    readonly windowScale: number | null;
    readonly windowScaleOptions: readonly number[];
    readonly textLanguage: string;
    readonly voiceLanguage: string;
};

export type ResolvedGameMenu = {
    readonly model: GameMenuModel;
    readonly commands: ReadonlyMap<string, ResolvedMenuCommand>;
};

const EMPTY_RESOLVED: ResolvedGameMenu = { model: EMPTY_GAME_MENU_MODEL, commands: new Map() };

/** How long a rebuild is held off for, so a skipped run does not redraw the bar per line. */
const MENU_REFRESH_INTERVAL_MS = 150;

function readBoolean(value: BlueprintGamePreferenceValue): boolean {
    return value === true;
}

/**
 * Percent rather than a multiplier: a size menu is read by a player, and every other application
 * they have used says 150%. The number carries no language, which is why this is one of the labels
 * the author does not write - see the plugin, which localizes the ones they do.
 */
function windowScaleLabel(scale: number): string {
    return `${Math.round(scale * 100)}%`;
}

async function readMenuState(port: GameMenuPort): Promise<MenuState> {
    // Each of these can be absent, or can fail on a shell that only half has a window; a menu is
    // not worth a rejected promise, so an unavailable answer becomes "no opinion" and the rows that
    // depend on it drop out below.
    const [fullscreen, windowScale, windowScaleOptions, textLanguage, voiceLanguage] = await Promise.all([
        port.getFullscreen ? port.getFullscreen().catch(() => null) : Promise.resolve(null),
        port.getWindowScale ? port.getWindowScale().catch(() => null) : Promise.resolve(null),
        port.getWindowScaleOptions ? port.getWindowScaleOptions().catch(() => []) : Promise.resolve([]),
        port.getTextLanguage().catch(() => ""),
        port.getVoiceLanguage().catch(() => ""),
    ]);
    return {
        inGame: port.isInGame(),
        fullscreen,
        windowScale,
        windowScaleOptions: windowScaleOptions ?? [],
        textLanguage: textLanguage ?? "",
        voiceLanguage: voiceLanguage ?? "",
    };
}

/**
 * The words on a row, in the language the game is being read in.
 *
 * The key is the answer and the typed text is the net: a key the build does not carry - removed
 * since the menu was written, or never translated - falls through to the author's own wording
 * rather than leaving a blank the player cannot even name when reporting it.
 */
function resolveLabel(label: GameMenuLabel, state: MenuState, port: GameMenuPort): string {
    const translated = label.key ? port.localizedText(label.key, state.textLanguage) : null;
    return translated ?? label.text;
}

/** Whether two window scales are the same rung, allowing for the rounding a real window does. */
function isSameScale(a: number | null, b: number): boolean {
    return a !== null && Math.abs(a - b) < 0.005;
}

/**
 * Drop separators with nothing on one side of them.
 *
 * The spec was tidied when it was read, but resolution drops rows too - a size list on a display
 * with no room, a full-screen row on a shell with no window - and a menu that loses its last item
 * that way must not keep the line that used to sit above it.
 */
function trimSeparators(items: GameMenuModelItem[]): GameMenuModelItem[] {
    const kept: GameMenuModelItem[] = [];
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

function resolveActionItem(
    item: Extract<GameMenuItemSpec, { kind: "action" }>,
    id: string,
    label: string,
    state: MenuState,
    port: GameMenuPort,
    commands: Map<string, ResolvedMenuCommand>,
): GameMenuModelItem | null {
    const action = item.action;
    const command = (enabled: boolean): GameMenuModelItem => {
        commands.set(id, action);
        return { kind: "command", id, label, enabled };
    };
    const checkbox = (enabled: boolean, checked: boolean): GameMenuModelItem => {
        commands.set(id, action);
        return { kind: "checkbox", id, label, enabled, checked };
    };
    switch (action.type) {
        case "openPage":
        case "openLayer":
        case "fn":
            return command(true);
        case "quitToPage":
            return command(state.inGame);
        case "quitApp":
            commands.set(id, action);
            // The one row the shell is told about: macOS has already put Quit in the application
            // menu, and two of them on one bar is the platform's mistake to avoid, not the game's.
            return { kind: "command", id, label, enabled: true, role: "quit" };
        case "next":
            return command(state.inGame);
        case "historyUndo":
            return command(state.inGame && port.canUndoHistory());
        case "historyRedo":
            return command(state.inGame && port.canRedoHistory());
        case "toggleAutoForward":
            return checkbox(state.inGame, readBoolean(port.getPreference("autoForward")));
        case "toggleSkipping":
            return checkbox(state.inGame, readBoolean(port.getPreference("skipping")));
        case "toggleDialog":
            return checkbox(state.inGame, readBoolean(port.getPreference("showDialog")));
        case "setSkipReadText":
            // A setting rather than an act, so it is answerable on the title screen too - which is
            // where a player who was just stopped by an unread line goes to change it.
            commands.set(id, action);
            return {
                kind: "radio",
                id,
                label,
                enabled: true,
                checked: readBoolean(port.getPreference("skipReadText")) === action.value,
            };
        case "toggleFullscreen":
            if (state.fullscreen === null || !port.setFullscreen) {
                return null;
            }
            return checkbox(true, state.fullscreen);
        default:
            return null;
    }
}

function resolveDynamicItems(
    item: Extract<GameMenuItemSpec, { kind: "dynamic" }>,
    idPrefix: string,
    state: MenuState,
    port: GameMenuPort,
    commands: Map<string, ResolvedMenuCommand>,
): GameMenuModelItem[] {
    const items: GameMenuModelItem[] = [];
    if (item.source === "textLanguage") {
        for (const [index, language] of port.listTextLanguages().entries()) {
            const id = `${idPrefix}.${index}`;
            commands.set(id, { type: "pickTextLanguage", code: language.code });
            items.push({
                kind: "radio",
                id,
                label: language.displayName,
                enabled: true,
                checked: language.code === state.textLanguage,
            });
        }
        return items;
    }
    if (item.source === "voiceLanguage") {
        for (const [index, language] of port.listVoiceLanguages().entries()) {
            const id = `${idPrefix}.${index}`;
            commands.set(id, { type: "pickVoiceLanguage", code: language.code });
            items.push({
                kind: "radio",
                id,
                label: language.displayName,
                enabled: true,
                checked: language.code === state.voiceLanguage,
            });
        }
        return items;
    }
    if (!port.setWindowScale) {
        return items;
    }
    /*
     * Radio rows only while one of them is actually the current size.
     *
     * A window may be any size at all - full screen, or dragged to something between two rungs - and
     * in that case none of these is the answer. Left as a radio group, the platform supplies an
     * answer anyway: MEASURED on Windows, a group with nothing checked is drawn with its FIRST row
     * ticked, so a stage at 97% of the design size reported itself as 50%. Plain rows carry no such
     * claim, which is the honest way to say "none of these".
     */
    const current = state.windowScaleOptions.findIndex(scale => (
        state.fullscreen !== true && isSameScale(state.windowScale, scale)
    ));
    for (const [index, scale] of state.windowScaleOptions.entries()) {
        const id = `${idPrefix}.${index}`;
        commands.set(id, { type: "pickWindowScale", scale });
        items.push(current < 0
            ? { kind: "command", id, label: windowScaleLabel(scale), enabled: true }
            : {
                kind: "radio",
                id,
                label: windowScaleLabel(scale),
                enabled: true,
                checked: index === current,
            });
    }
    return items;
}

function resolveItems(
    items: readonly GameMenuItemSpec[],
    idPrefix: string,
    state: MenuState,
    port: GameMenuPort,
    commands: Map<string, ResolvedMenuCommand>,
): GameMenuModelItem[] {
    const resolved: GameMenuModelItem[] = [];
    for (const [index, item] of items.entries()) {
        const id = `${idPrefix}.${index}`;
        if (item.kind === "separator") {
            resolved.push({ kind: "separator" });
            continue;
        }
        if (item.kind === "dynamic") {
            resolved.push(...resolveDynamicItems(item, id, state, port, commands));
            continue;
        }
        if (item.kind === "submenu") {
            const children = resolveItems(item.items, id, state, port, commands);
            if (children.length > 0) {
                resolved.push({ kind: "submenu", label: resolveLabel(item.label, state, port), items: children });
            }
            continue;
        }
        const action = resolveActionItem(item, id, resolveLabel(item.label, state, port), state, port, commands);
        if (action) {
            resolved.push(action);
        }
    }
    return trimSeparators(resolved);
}

/**
 * Turn an authored menu into the one the shell draws, against the game as it is this instant.
 *
 * Ids are the item's path through the tree, so the same menu resolves to the same ids every time -
 * which is what lets a click that arrives during a rebuild still name the row the player pressed.
 */
export async function resolveGameMenu(
    spec: GameMenuSpec | null,
    port: GameMenuPort,
): Promise<ResolvedGameMenu> {
    if (!spec || spec.menus.length === 0) {
        return EMPTY_RESOLVED;
    }
    const state = await readMenuState(port);
    const commands = new Map<string, ResolvedMenuCommand>();
    const menus: GameMenuModel["menus"][number][] = [];
    for (const [index, menu] of spec.menus.entries()) {
        const items = resolveItems(menu.items, String(index), state, port, commands);
        if (items.length > 0) {
            menus.push({ label: resolveLabel(menu.label, state, port), items });
        }
    }
    return { model: { menus }, commands };
}

/** Run what an item was drawn for. */
export async function runGameMenuCommand(
    command: ResolvedMenuCommand,
    port: GameMenuPort,
): Promise<void> {
    switch (command.type) {
        case "openPage":
            return port.openPage(command.surfaceId);
        case "openLayer":
            return port.openLayer(command.surfaceId, {
                modal: command.modal === true,
                dismissible: command.dismissible !== false,
                group: command.group ?? null,
            });
        case "quitToPage":
            return port.quitToPage(command.surfaceId);
        case "quitApp":
            return port.quitApplication();
        case "next":
            return port.next();
        case "toggleAutoForward":
            return port.setPreference("autoForward", !readBoolean(port.getPreference("autoForward")));
        case "toggleSkipping":
            return port.setPreference("skipping", !readBoolean(port.getPreference("skipping")));
        case "toggleDialog":
            return port.toggleDialog();
        case "setSkipReadText":
            return port.setPreference("skipReadText", command.value);
        case "historyUndo":
            return port.undoHistory();
        case "historyRedo":
            return port.redoHistory();
        case "toggleFullscreen": {
            if (!port.setFullscreen || !port.getFullscreen) {
                return;
            }
            const current = await port.getFullscreen();
            return port.setFullscreen(!current);
        }
        case "fn":
            return port.callFn(command.fnRef, command.args ? { ...command.args } : undefined);
        case "pickTextLanguage":
            return port.setTextLanguage(command.code);
        case "pickVoiceLanguage":
            return port.setVoiceLanguage(command.code);
        case "pickWindowScale":
            return port.setWindowScale ? port.setWindowScale(command.scale) : undefined;
        default:
            return;
    }
}

export type GameMenuController = {
    /** Declare the whole bar. `null` takes it away. */
    setSpec: (spec: GameMenuSpec | null) => void;
    /** Redraw against the state as it is now. Coalesced; safe to call on every engine signal. */
    refresh: () => void;
    /** Run the item the shell says was picked. */
    handleCommand: (itemId: string) => void;
    dispose: () => void;
};

export type CreateGameMenuControllerOptions = {
    /**
     * The running game, read at call time.
     *
     * A getter rather than the object, and for the reason a compiled story's callbacks are refs:
     * the port is rebuilt whenever the surface under it changes, and a controller holding the first
     * one would keep answering for a page that has gone.
     */
    getPort: () => GameMenuPort | null;
    setMenu: (model: GameMenuModel) => Promise<void>;
    log: (level: "warning" | "error", message: string) => void;
};

/**
 * Own the menu bar for as long as the game is up.
 *
 * Rebuilds are coalesced because their triggers are not: a preference write, a language change and
 * every advanced line all say "this may have changed", and a skipped run says it several times a
 * second. One leading rebuild and one trailing one per window is enough for a bar the player has to
 * reach for with a mouse.
 */
export function createGameMenuController(options: CreateGameMenuControllerOptions): GameMenuController {
    let spec: GameMenuSpec | null = null;
    let commands: ReadonlyMap<string, ResolvedMenuCommand> = new Map();
    let disposed = false;
    let running = false;
    let queued = false;
    let cooldown: ReturnType<typeof setTimeout> | null = null;

    const report = (error: unknown): void => {
        options.log("warning", `Menu bar: ${error instanceof Error ? error.message : String(error)}`);
    };

    const build = async (): Promise<void> => {
        const port = options.getPort();
        if (!port) {
            // No game yet, or one on its way out. The bar goes rather than freezes: a menu resolved
            // against a port that has gone would show the last playthrough's ticks.
            commands = new Map();
            await options.setMenu(EMPTY_GAME_MENU_MODEL);
            return;
        }
        const resolved = await resolveGameMenu(spec, port);
        if (disposed) {
            return;
        }
        commands = resolved.commands;
        await options.setMenu(resolved.model);
    };

    const run = (): void => {
        running = true;
        void build()
            .catch(report)
            .finally(() => {
                running = false;
                if (disposed) {
                    return;
                }
                cooldown = setTimeout(() => {
                    cooldown = null;
                    if (queued && !disposed) {
                        queued = false;
                        run();
                    }
                }, MENU_REFRESH_INTERVAL_MS);
            });
    };

    const refresh = (): void => {
        if (disposed) {
            return;
        }
        if (running || cooldown) {
            queued = true;
            return;
        }
        run();
    };

    return {
        setSpec: next => {
            spec = next;
            refresh();
        },
        refresh,
        handleCommand: itemId => {
            const command = commands.get(itemId);
            const port = options.getPort();
            if (!command || !port) {
                // Not an error: a click can land on a bar drawn a moment before a rebuild, and the
                // honest answer to "that row is gone" is to do nothing.
                return;
            }
            void runGameMenuCommand(command, port)
                .then(() => refresh())
                .catch(error => {
                    report(error);
                    refresh();
                });
        },
        dispose: () => {
            disposed = true;
            if (cooldown) {
                clearTimeout(cooldown);
                cooldown = null;
            }
        },
    };
}
