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
 * Two of the three are project-level NAVIGATION, neither of which edits this project's content:
 * File is New Workspace / Open Workspace / Export Project / Close, Help is the help entries. Leaving
 * them live is also what keeps a frozen window escapable - a workspace you cannot close or leave
 * would be a trap.
 *
 * The third is the image preview's Zoom in / Zoom out / Reset view, which move a viewport and write
 * nothing whatsoever. Measured on a frozen project: opening a past revision of an image and being
 * unable to zoom in on it, which is the one thing the author opened it to do. It is exempt as a
 * group rather than per-command because a top-bar group is what those three are registered as; the
 * editor had to be given a fixed id first, since it used to build one per tab and a table that
 * matches ids exactly can name no such thing.
 */
const FREEZE_EXEMPT_GROUP_IDS: ReadonlySet<string> = new Set([
  "narraleaf-studio:file",
  "narraleaf-studio:help",
  "narraleaf-studio:image-preview-actions"
]);

/** Whether a top-bar action group and everything inside it keeps working while frozen. */
export function isFreezeExemptActionGroup(groupId: string): boolean {
  return FREEZE_EXEMPT_GROUP_IDS.has(groupId);
}

/**
 * The commands that keep working while frozen - the same table, for the palette's *registered*
 * commands rather than for toolbar actions.
 *
 * A registered command has no `group` to be read through {@link isFreezeExemptActionGroup}, so its
 * own entry points ask here instead. The one member is the project lint sweep (ruling R3): it reads
 * every project document and writes none, and a read-only sweep is precisely what an author wants
 * while inspecting a frozen revision - refusing it would switch off the tool for the case it is most
 * useful in.
 *
 * Ids Studio owns, listed here in Studio's source, for the reason the group table gives: a plugin
 * that could name itself exempt would be a way around the side effects the write boundary cannot
 * catch. Exempting the wrong thing offers a write inside a frozen project; leaving something out
 * only greys a control.
 */
const FREEZE_EXEMPT_COMMAND_IDS: ReadonlySet<string> = new Set(["lint:project"]);

/** Whether a registered palette command, and the controls that run it, stay live while frozen. */
export function isFreezeExemptCommand(commandId: string): boolean {
  return FREEZE_EXEMPT_COMMAND_IDS.has(commandId);
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
export function applyFreezeToActionMenuItems(
  items: ActionMenuItem[],
  frozenOut: boolean
): ActionMenuItem[] {
  if (!frozenOut) {
    return items;
  }
  return (items || []).map<ActionMenuItem>((item) => {
    if (isActionMenuSeparator(item)) {
      return item;
    }
    if (isActionMenuAction(item)) {
      return { ...item, disabled: true };
    }
    return {
      ...item,
      items: applyFreezeToActionMenuItems(item.items, true)
    } satisfies ActionSubmenu;
  });
}
