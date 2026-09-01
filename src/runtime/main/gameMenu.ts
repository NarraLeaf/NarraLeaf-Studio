/**
 * The shipped game's menu bar, laid out from a model the renderer resolved.
 *
 * Nothing here knows what a save, a language or a skip is. The renderer sends labels, ticks and
 * grey-outs already decided (see `@shared/types/gameMenu`), this turns them into a menu, and a
 * click comes back as the id it was drawn with. That is the whole contract, and it is what lets the
 * feature that uses it live in a plugin.
 *
 * Two platform facts shape the file, and both are the reason a menu bar was refused here for so
 * long:
 *
 *  - **Windows and Linux lay the bar out inside the window**, so a menu costs the stage a strip of
 *    its own height. The caller re-measures the frame afterwards (see `main.ts`), which is the only
 *    honest way to get a number that depends on the platform, the theme and the display scaling.
 *  - **macOS cannot be given the bar alone.** The application menu is the process's only route to
 *    Quit and the Edit roles are what make Cmd+C/V work inside a text field at all, so the author's
 *    menus are laid *between* them rather than instead of them.
 *
 * No item carries an accelerator, and none may: a menu accelerator is consumed by this process
 * before the page sees the key, so a game whose author bound a shortcut here would have a key the
 * player presses and the author's own input intents never receive. Keys belong to the author's
 * graphs; this is only a bar to click.
 *
 * Comments in English per project convention.
 */

import type { GameMenuModel, GameMenuModelItem } from "@shared/types/gameMenu";

/**
 * The subset of Electron's `MenuItemConstructorOptions` this builder produces.
 *
 * Declared structurally rather than imported so the layout can be tested without an Electron
 * process - the same reason `windowGeometry` is arithmetic over plain numbers.
 */
export type GameMenuTemplateItem = {
    label?: string;
    type?: "normal" | "separator" | "checkbox" | "radio";
    role?: "appMenu" | "editMenu" | "windowMenu";
    id?: string;
    enabled?: boolean;
    checked?: boolean;
    click?: () => void;
    submenu?: GameMenuTemplateItem[];
};

/** What a drawn item does when the player picks it. */
export type GameMenuCommandDispatch = (itemId: string) => void;

function isDroppedOnPlatform(item: GameMenuModelItem, platform: NodeJS.Platform): boolean {
    // The only platform filter, and it is one item rather than a rule: macOS has already put Quit
    // in the application menu, so the author's own row would be the second one on the same bar.
    return platform === "darwin" && item.kind === "command" && item.role === "quit";
}

/**
 * Drop separators that would draw a line against nothing.
 *
 * Repeated from the model's own normalization because the platform filter above can leave a groove
 * behind: a File menu whose last two rows are a separator and Quit becomes a menu ending in a
 * separator on macOS alone, which no other platform would ever show.
 */
function trimSeparators(items: GameMenuTemplateItem[]): GameMenuTemplateItem[] {
    const kept: GameMenuTemplateItem[] = [];
    for (const item of items) {
        const previous = kept[kept.length - 1];
        if (item.type === "separator" && (kept.length === 0 || previous?.type === "separator")) {
            continue;
        }
        kept.push(item);
    }
    while (kept.length > 0 && kept[kept.length - 1]?.type === "separator") {
        kept.pop();
    }
    return kept;
}

function buildItems(
    items: readonly GameMenuModelItem[],
    platform: NodeJS.Platform,
    dispatch: GameMenuCommandDispatch,
): GameMenuTemplateItem[] {
    const built: GameMenuTemplateItem[] = [];
    for (const item of items) {
        if (isDroppedOnPlatform(item, platform)) {
            continue;
        }
        if (item.kind === "separator") {
            built.push({ type: "separator" });
            continue;
        }
        if (item.kind === "submenu") {
            const children = buildItems(item.items, platform, dispatch);
            if (children.length > 0) {
                built.push({ label: item.label, submenu: children });
            }
            continue;
        }
        built.push({
            id: item.id,
            label: item.label,
            type: item.kind === "command" ? "normal" : item.kind,
            enabled: item.enabled,
            ...(item.kind === "command" ? {} : { checked: item.checked }),
            // Bound to the id rather than to the action: what the item does is the renderer's to
            // know, and this process must not learn it in order to report a click.
            click: () => dispatch(item.id),
        });
    }
    return trimSeparators(built);
}

/**
 * Lay a resolved model out as a menu template.
 *
 * Returns an empty array for a model with nothing in it, which the caller reads as "no bar" rather
 * than as an empty one - on macOS that still means the OS menus, because a process there without
 * them has no Quit and no working clipboard shortcuts.
 */
export function buildGameMenuTemplate(
    model: GameMenuModel,
    platform: NodeJS.Platform,
    dispatch: GameMenuCommandDispatch,
): GameMenuTemplateItem[] {
    const authored: GameMenuTemplateItem[] = [];
    for (const menu of model.menus) {
        const items = buildItems(menu.items, platform, dispatch);
        if (items.length > 0) {
            authored.push({ label: menu.label, submenu: items });
        }
    }
    if (platform !== "darwin") {
        return authored;
    }
    if (authored.length === 0) {
        return [{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }];
    }
    // The author's menus sit between the OS's own: the application menu is first on every macOS
    // app and Edit and Window are the ones the system routes through, so putting the game's menus
    // in the middle is the only order that leaves both halves where a macOS player looks for them.
    return [{ role: "appMenu" }, ...authored, { role: "editMenu" }, { role: "windowMenu" }];
}
