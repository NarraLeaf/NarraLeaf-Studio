/**
 * The story editor opens its action creator on a leading "/". When `editor.slashAtAlias` is on, "@"
 * works as a second trigger: a Simplified-Chinese input method rewrites the "/" key as "、", so authors
 * writing in Chinese would otherwise have to switch IME just to start a command.
 *
 * "@" is a *display* trigger only. The insert slot keeps whatever the author typed (so they see the
 * "@" they pressed), but every point that parses the line or commits it folds a leading "@" back to
 * "/" first - so the parser, the ghost hint, the command search, and the saved document only ever deal
 * in the canonical "/". Because only the first character can change, a caret offset into the displayed
 * line stays valid against the canonical form.
 */

export const ACTION_TRIGGER = "/";
export const ALT_ACTION_TRIGGER = "@";

/** The trigger at the head of the line, or null when the line does not open the action creator. */
export function actionTrigger(value: string, aliasEnabled: boolean): "/" | "@" | null {
    if (value.startsWith(ACTION_TRIGGER)) {
        return ACTION_TRIGGER;
    }
    if (aliasEnabled && value.startsWith(ALT_ACTION_TRIGGER)) {
        return ALT_ACTION_TRIGGER;
    }
    return null;
}

/** Whether the line opens the action creator (via "/", or "@" when the alias is enabled). */
export function isActionCommandLine(value: string, aliasEnabled: boolean): boolean {
    return actionTrigger(value, aliasEnabled) !== null;
}

/** Which candidate menu an insert line is asking for. */
export type InsertChooser = "none" | "action" | "character";

/**
 * The candidate menu an insert line offers, derived purely from its text: a "/" (or aliased "@") line
 * opens the action creator, a "#" line the speaker picker, anything else is prose with no menu. The
 * caret decides *which* part of an action line is being completed (command name vs argument), but that
 * runs through the cursor, not this. The insert state deliberately does not store this - a stored copy
 * drifted out of sync, which is how a reopened draft row kept a stale "none" and lost its completion
 * (bible M3). Escape's one-shot suppression is the one thing text cannot express; it rides a separate
 * `chooserDismissed` flag that the next keystroke clears.
 */
export function insertChooserType(value: string, aliasEnabled: boolean): InsertChooser {
    if (isActionCommandLine(value, aliasEnabled)) {
        return "action";
    }
    if (value.startsWith("#")) {
        return "character";
    }
    return "none";
}

/**
 * Fold a displayed line onto the canonical form the parser and the document use: a leading "@" (when
 * the alias is on) becomes "/"; everything else - a "/" line, a "#" line, prose - is returned
 * unchanged. Only the first character can differ, so offsets into the input remain valid.
 */
export function toCanonicalCommandLine(value: string, aliasEnabled: boolean): string {
    return aliasEnabled && value.startsWith(ALT_ACTION_TRIGGER) ? ACTION_TRIGGER + value.slice(1) : value;
}
