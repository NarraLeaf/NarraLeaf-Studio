/**
 * A pointer press on one of a game's controls does not leave the keyboard focus on it.
 *
 * The browser's rule is that pressing on anything focusable focuses it, and every control a game
 * draws is focusable, so that the keyboard can reach it. Left as it is, that rule hands the keys to
 * whatever the player last clicked: click Auto on the quick menu, then press Space to read on, and
 * Space presses Auto again instead - the focused control takes its activation keys, as it must for a
 * player who moved there with Tab (see `keyInputClaimedByControl`). The story stops answering the
 * one key every reader uses, on the screen they use it on most, because of a click a moment ago.
 *
 * So in a running game the keyboard focus is the keyboard's. A press on a control is answered
 * exactly as before - it is a click - but the default that would focus the control is prevented,
 * and whatever held the focus lets go of it, the way it does when the press lands on something
 * that cannot take the focus at all. A control the player reaches with Tab is focused, drawn with
 * its focus ring, and hears Enter and Space; one the player clicks is not. It is also what keeps a
 * control's `focus` and `blur` heads meaning the keyboard rather than the last click.
 *
 * Only the controls the game draws, and only when the press lands on one rather than on something
 * inside it that takes the focus for its own sake: a text field in a list row still gets the caret.
 *
 * Comments in English per project convention.
 */

import { CONTROL_TARGET_SELECTOR } from "../navigation/focusNavigation";

/**
 * The controls a game draws that take the keyboard focus to be pressed - a button, a switch, a list
 * row - and the boxes an author made reachable by navigation. One list, kept by `focusNavigation`,
 * which the focus ring in `styles.css` is drawn for too.
 */
export const GAME_KEYBOARD_CONTROL_SELECTOR = CONTROL_TARGET_SELECTOR;

/** Anything a press can put the focus on. The nearest one to the press is the one that would get it. */
const FOCUSABLE_SELECTOR = "input, textarea, select, button, a[href], [contenteditable], [tabindex]";

/** The class every surface drawing carries, in a game and on the editor's canvas alike. */
const SURFACE_SELECTOR = ".ui-editor-surface";

/**
 * Keep a pointer press on a game control from moving the keyboard focus onto it. Meant for a
 * capturing `mousedown` listener on the game's drawing root; a touch raises the same `mousedown`.
 */
export function keepPointerPressOffKeyboardFocus(
    event: Pick<MouseEvent, "target" | "preventDefault">,
): void {
    const target = event.target;
    if (typeof Element === "undefined" || !(target instanceof Element)) {
        return;
    }
    const focusable = target.closest(FOCUSABLE_SELECTOR);
    if (!focusable || !focusable.matches(GAME_KEYBOARD_CONTROL_SELECTOR) || !focusable.closest(SURFACE_SELECTOR)) {
        return;
    }
    event.preventDefault();
    // What pressing on something unfocusable does: the focus leaves whatever had it, a control the
    // player had reached with Tab included, so the next key is the game's rather than that control's.
    const active = target.ownerDocument.activeElement;
    if (active instanceof HTMLElement && active !== target.ownerDocument.body) {
        active.blur();
    }
}
