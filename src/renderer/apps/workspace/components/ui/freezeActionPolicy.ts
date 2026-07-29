import type { ActionDefinition, ActionMenuItem, ActionSubmenu } from "../../registry/types";
import { isActionMenuAction, isActionMenuSeparator } from "./actionMenuModel";

/**
 * Which top-bar controls a frozen workspace turns off, and which keep working.
 *
 * While the workspace is frozen every registered action still RENDERS - disabled, not hidden. A
 * button that vanishes cannot explain itself: the author reads the gap as a broken plugin, not as
 * "I am looking at a frozen project". Disabled with a reason on hover says which one it is.
 *
 * **The exemption is a table here, in Studio's own source, and NOT a flag on `ActionDefinition`.**
 * That is the whole point of the rule. The write boundary (`@/lib/app/writeFreeze`) already stops
 * any action - plugin actions included - from writing project data, so what is left to prevent is
 * the side effects it cannot catch: starting a build, calling an external service, changing a global
 * setting. Those cannot be audited in third-party code, so a plugin must have no way to opt itself
 * back in; an `exemptWhileFrozen?: boolean` on the definition would be exactly that way in.
 *
 * The two exempt groups are project-level NAVIGATION, none of which edits this project's content:
 * File is New Workspace / Open Workspace / Export Project / Close, Help is the help entries. Leaving
 * them live is also what keeps a frozen window escapable - a workspace you cannot close or leave
 * would be a trap.
 */
const FREEZE_EXEMPT_GROUP_IDS: ReadonlySet<string> = new Set([
    "narraleaf-studio:file",
    "narraleaf-studio:help",
]);

/** Whether a top-bar action group and everything inside it keeps working while frozen. */
export function isFreezeExemptActionGroup(groupId: string): boolean {
    return FREEZE_EXEMPT_GROUP_IDS.has(groupId);
}

/**
 * Whether the freeze is what makes `action` unavailable - which is what the hover reason keys off,
 * so the top bar only claims "frozen" when that is actually the cause.
 *
 * Answers independently of `action.disabled`: an action that was registered disabled is disabled for
 * its own reason, and saying "because the project is frozen" about it would be a lie that outlives
 * the thaw.
 */
export function isActionFrozenOut(action: ActionDefinition, frozen: boolean): boolean {
    if (!frozen) {
        return false;
    }
    return action.group === undefined || !isFreezeExemptActionGroup(action.group);
}

/**
 * The disabled state to RENDER for a standalone top-bar action. Never written back: the registered
 * objects are shared registry state that outlives a freeze, so a freeze that mutated them would
 * leave every action disabled forever once the author thawed.
 */
export function resolveFrozenActionDisabled(action: ActionDefinition, frozen: boolean): boolean {
    return action.disabled === true || isActionFrozenOut(action, frozen);
}

/**
 * The same for a group's menu, as copies - `disabled: true` on every action, recursively.
 *
 * Submenu rows are deliberately left enabled: a group that could not be opened would hide what the
 * freeze is doing, and the point of rendering-but-disabled is that the author can look. So the menu
 * still expands, every leaf inside it is inert.
 *
 * `frozenOut === false` returns the input untouched, by identity, so nothing downstream re-renders
 * on the common path.
 */
export function applyFreezeToActionMenuItems(items: ActionMenuItem[], frozenOut: boolean): ActionMenuItem[] {
    if (!frozenOut) {
        return items;
    }
    return (items || []).map<ActionMenuItem>(item => {
        if (isActionMenuSeparator(item)) {
            return item;
        }
        if (isActionMenuAction(item)) {
            return { ...item, disabled: true };
        }
        return { ...item, items: applyFreezeToActionMenuItems(item.items, true) } satisfies ActionSubmenu;
    });
}
