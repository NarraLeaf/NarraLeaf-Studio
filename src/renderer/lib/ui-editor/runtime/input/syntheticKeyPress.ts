/**
 * A key press the game makes on a control's behalf, and the listeners that must not mistake it for
 * the player's.
 *
 * A pad's Confirm presses the focused control the way Enter does: every control a keyboard can press
 * - a button, a switch, a list row, a plugin's widget - already answers Enter on itself, so that is
 * the one contract every control shares, and a pad that speaks it reaches every control there is
 * without each of them learning about pads.
 *
 * The press is a `keydown` event, so it travels like one, and the game's own key listeners would hear
 * it: the device tracker would decide the player had picked up a keyboard, the hold tracker would
 * hold an Enter nobody lets go of, and the game's key heads would hear an Enter nobody pressed. They
 * ask {@link isSyntheticKeyPress} and step over it.
 *
 * Comments in English per project convention.
 */

const synthetic = new WeakSet<Event>();

/** Whether this event is one {@link pressLikeEnter} raised rather than the player's own key. */
export function isSyntheticKeyPress(event: Event): boolean {
    return synthetic.has(event);
}

/**
 * Press `target` the way Enter would, and report whether it answered.
 *
 * A control that answers Enter prevents its default; one that does not - anything that only listens
 * for clicks - is clicked instead, which is what the player pointing at it and pressing would do.
 */
export function pressLikeEnter(target: HTMLElement): void {
    const view = target.ownerDocument.defaultView;
    const KeyboardEventCtor = view?.KeyboardEvent ?? KeyboardEvent;
    const event = new KeyboardEventCtor("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true,
    });
    synthetic.add(event);
    target.dispatchEvent(event);
    if (!event.defaultPrevented) {
        target.click();
    }
}
