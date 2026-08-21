import type { NativeMenuSlot } from "@shared/types/menu";
import type { ActionGroup, ActionMenuItem } from "../../registry/types";
import { getActionGroupItems, isActionMenuSeparator } from "./actionMenuModel";
import { isFreezeExemptActionGroup } from "./freezeActionPolicy";

/**
 * The slots that name a menu several groups can contribute to, rather than a menu of their own.
 *
 * `top-level` is a menu per group by definition, and `none` means the group is not mirrored at all
 * (File and Help, which the main process builds itself on macOS) - folding those together would put
 * File and Help in one menu off macOS, where they are drawn from these same registrations.
 *
 * Reachable by Studio's own surfaces only: `pluginRuntime` confines a plugin's group to `top-level`
 * or `none`, so nothing a package registers can arrive inside the Edit menu.
 */
const FOLDED_MENU_SLOTS: ReadonlySet<NativeMenuSlot> = new Set<NativeMenuSlot>(["edit", "window"]);

/**
 * The registered groups as the title bar draws them: everything naming the same standard menu folded
 * into one, instead of a second dropdown with the same name beside the first.
 *
 * The macOS menu bar has always done this - `menuSlot: "edit"` means "hang these under the standard
 * editing commands", and the assets panel's Copy/Cut/Paste say so. Off macOS the same registrations
 * were each drawn as a menu of their own, so an author with the assets panel open had two menus
 * called Edit in the title bar and no way to tell which was which. This is what makes the two
 * platforms agree, and it is also what keeps the collapsed arrangement readable, where the two would
 * otherwise be adjacent rows reading the same word.
 *
 * Order within the folded menu is the groups' own `order`, and the first contributor is the menu:
 * its id, label and accelerator are what the result carries. So Undo/Redo lead the Edit menu and a
 * panel's editing commands follow, under a separator.
 *
 * **A group that the freeze treats differently from the menu it would join is left on its own.**
 * A folded menu has one id, and that id is what `freezeActionPolicy` answers for; folding an exempt
 * group into a frozen-out one would silently switch off the exemption (or, the other way round,
 * offer a write inside a frozen project). No pair does this today - the exempt groups are File, Help
 * and the image preview, none of which name a shared slot - and if one ever did, two menus on the
 * bar is the visible failure rather than the invisible one.
 */
export function foldActionGroupsByMenuSlot(groups: readonly ActionGroup[]): ActionGroup[] {
    const folded: ActionGroup[] = [];
    const menuBySlot = new Map<NativeMenuSlot, ActionGroup>();

    for (const group of groups) {
        const slot = group.menuSlot ?? "top-level";
        if (!FOLDED_MENU_SLOTS.has(slot)) {
            folded.push(group);
            continue;
        }
        const menu = menuBySlot.get(slot);
        if (!menu) {
            const opened = { ...group, items: rank(getActionGroupItems(group)) };
            menuBySlot.set(slot, opened);
            folded.push(opened);
            continue;
        }
        if (isFreezeExemptActionGroup(menu.id) !== isFreezeExemptActionGroup(group.id)) {
            folded.push(group);
            continue;
        }
        // Ranked from where the menu currently ends, so the sort every menu runs on its rows keeps
        // each contribution together instead of interleaving them by the orders they registered
        // with - two groups both numbering their rows from zero is the normal case, not an unlucky
        // one.
        const items = menu.items ?? [];
        menu.items = [...items, ...rank(getActionGroupItems(group), items.length + 1, true)];
    }

    return folded;
}

/**
 * One contribution's rows, renumbered onto the end of the menu they are joining.
 *
 * The rows are copied rather than renumbered in place: they are registry state that outlives this
 * render, and a group re-registered on every undo would otherwise accumulate whatever the last fold
 * gave it.
 */
function rank(items: ActionMenuItem[], from = 0, separate = false): ActionMenuItem[] {
    const ranked: ActionMenuItem[] = separate ? [{ separator: true, order: from - 1 }] : [];
    let order = from;
    for (const item of sortForFold(items)) {
        ranked.push(isActionMenuSeparator(item) ? { ...item, order } : { ...item, order });
        order += 1;
    }
    return ranked;
}

/** The rows in the order their own group meant them to be in, before they are given new numbers. */
function sortForFold(items: ActionMenuItem[]): ActionMenuItem[] {
    return [...items].sort((a, b) => (
        isActionMenuSeparator(a) || isActionMenuSeparator(b) ? 0 : (a.order ?? 0) - (b.order ?? 0)
    ));
}
