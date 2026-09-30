import type { WorkspaceFreezeKind } from "@shared/types/ipcEvents";
import { WorkspaceMenuAction } from "@shared/types/menu";
import { refusesOperations } from "@shared/types/workspaceFreeze";
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
 * File is New Workspace / Open Workspace / Export Project / Back to Launcher / Close Window, Help is
 * the help entries. Leaving them live is also what keeps a frozen window escapable - a workspace you
 * cannot close or leave would be a trap, and Back to Launcher is the one that leaves without ending
 * the session.
 *
 * The third is the image preview's Zoom in / Zoom out / Reset view, which move a viewport and write
 * nothing whatsoever. Measured on a frozen project: opening a past revision of an image and being
 * unable to zoom in on it, which is the one thing the author opened it to do. It is exempt as a
 * group rather than per-command because a top-bar group is what those three are registered as; the
 * editor had to be given a fixed id first, since it used to build one per tab and a table that
 * matches ids exactly can name no such thing.
 *
 * A fourth escape is conditional rather than absolute, and is why everything here takes the freeze
 * KIND instead of a boolean: an action that only *starts* something main owns - the production build
 * - is exempt from the freezes main itself does not refuse. See {@link FREEZE_OPERATION_ACTION_IDS}.
 */
const FREEZE_EXEMPT_GROUP_IDS: ReadonlySet<string> = new Set([
    "narraleaf-studio:file",
    "narraleaf-studio:help",
    "narraleaf-studio:image-preview-actions",
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
const FREEZE_EXEMPT_COMMAND_IDS: ReadonlySet<string> = new Set([
    "lint:project",
]);

/** Whether a registered palette command, and the controls that run it, stay live while frozen. */
export function isFreezeExemptCommand(commandId: string): boolean {
    return FREEZE_EXEMPT_COMMAND_IDS.has(commandId);
}

/**
 * The actions that do not write project data at all but *start* something the main process owns.
 *
 * A third table because it is exempt under a different condition from the two above. Those are
 * exempt from every freeze; these are exempt only from a freeze that does not refuse operations,
 * which `refusesOperations` decides and main's managers ask for themselves before they run anything.
 * The pair has to agree: main lets a live session build, and a Build row greyed out over a build
 * main would have started is a dead button, which is worse than either honest state.
 *
 * One member today - Production Build is the only operation reachable as a registered action; Dev
 * Mode, Preview and Test are palette commands the Run control registers and gates itself.
 */
const FREEZE_OPERATION_ACTION_IDS: ReadonlySet<string> = new Set<string>([WorkspaceMenuAction.Build]);

/**
 * Whether this action starts an operation the freeze in force does not refuse.
 *
 * The only place the KIND of freeze is read, and it is not compared against a name here: it goes
 * straight to `refusesOperations`, which is also what the manager on the other side of the IPC
 * boundary asks before it starts the same thing.
 */
/**
 * Whether this action starts something the main process owns, whatever the reason for asking.
 *
 * The same set {@link staysLiveAsOperation} reads, exported because project trust needs the same
 * question and must not answer it with a second list. Freeze exempts these under a condition;
 * distrust refuses them outright - a project that arrived from elsewhere gets no operation at all -
 * so the two callers combine one membership test with their own verdict rather than sharing a rule.
 */
export function startsMainOperation(actionId: string): boolean {
    return FREEZE_OPERATION_ACTION_IDS.has(actionId);
}

function staysLiveAsOperation(actionId: string, freeze: WorkspaceFreezeKind | null): boolean {
    return freeze !== null && FREEZE_OPERATION_ACTION_IDS.has(actionId) && !refusesOperations(freeze);
}

/**
 * Whether the freeze is what makes `action` unavailable - which is what the hover reason keys off,
 * so the top bar only claims "frozen" when that is actually the cause.
 *
 * Answers independently of `action.disabled`: an action that was registered disabled is disabled for
 * its own reason, and saying "because the project is frozen" about it would be a lie that outlives
 * the thaw.
 *
 * `freeze` is the kind in force, or null when the workspace is writable. It is the kind rather than
 * a boolean because the answer is not the same for all of them: see {@link FREEZE_OPERATION_ACTION_IDS}.
 * Everything else stays frozen out under every kind - an action carries no statement of which
 * document it writes, so there is nothing here to be partial about.
 */
export function isActionFrozenOut(action: ActionDefinition, freeze: WorkspaceFreezeKind | null): boolean {
    if (freeze === null) {
        return false;
    }
    if (action.group !== undefined && isFreezeExemptActionGroup(action.group)) {
        return false;
    }
    return !staysLiveAsOperation(action.id, freeze);
}

/**
 * The disabled state to RENDER for a standalone top-bar action. Never written back: the registered
 * objects are shared registry state that outlives a freeze, so a freeze that mutated them would
 * leave every action disabled forever once the author thawed.
 */
export function resolveFrozenActionDisabled(action: ActionDefinition, freeze: WorkspaceFreezeKind | null): boolean {
    return action.disabled === true || isActionFrozenOut(action, freeze);
}

/**
 * The same for a group's menu, as copies - `disabled: true` on every action, recursively.
 *
 * Submenu rows are deliberately left enabled: a group that could not be opened would hide what the
 * freeze is doing, and the point of rendering-but-disabled is that the author can look. So the menu
 * still expands, every leaf inside it is inert.
 *
 * `frozenOut` is the caller's verdict on the GROUP, which is where the group exemption is decided
 * (a menu row does not carry the group it was declared in). `freeze` is the kind in force, passed
 * through so a row that starts an operation this freeze does not refuse survives the sweep - a menu
 * that greyed out Production Build while main would have run it teaches the author the opposite of
 * what is true.
 *
 * `frozenOut === false` returns the input untouched, by identity, so nothing downstream re-renders
 * on the common path.
 */
export function applyFreezeToActionMenuItems(
    items: ActionMenuItem[],
    frozenOut: boolean,
    freeze: WorkspaceFreezeKind | null,
): ActionMenuItem[] {
    if (!frozenOut) {
        return items;
    }
    return (items || []).map<ActionMenuItem>(item => {
        if (isActionMenuSeparator(item)) {
            return item;
        }
        if (isActionMenuAction(item)) {
            return staysLiveAsOperation(item.id, freeze) ? item : { ...item, disabled: true };
        }
        return { ...item, items: applyFreezeToActionMenuItems(item.items, true, freeze) } satisfies ActionSubmenu;
    });
}
