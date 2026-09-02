/**
 * Whether the player is looking at the page, for the web export.
 *
 * The desktop shells ask the process that owns the window and get one event per change. A page has
 * no such process and no such event: it has `visibilitychange`, `focus` and `blur`, three signals
 * for two facts, which fire together and fire again for things that are not changes at all -
 * switching to another tab raises both `blur` and `visibilitychange`, and clicking back into an
 * already-visible page raises `focus` after nothing happened.
 *
 * So this collapses them. Both facts count as away, because a game told to go quiet when it loses
 * focus should be quiet in a background tab as well as behind another application, and
 * `visibilitychange` is the one a mobile browser reliably raises when the player switches apps -
 * some do not raise `blur` at all.
 *
 * Everything environmental is injected, for the reason the wake lock next door injects it: the
 * whole decision can then be exercised without a browser.
 *
 * Comments in English per project convention.
 */

export type WindowFocusOptions = {
    /** `document.visibilityState !== "hidden" && document.hasFocus()`. */
    read: () => boolean;
    /** Registers one listener for a signal; returns the function that removes it. */
    subscribe: (listener: () => void) => () => void;
};

export type WindowFocusTracker = {
    /** What the page says right now. */
    isFocused: () => boolean;
    /** Fires once per change, never for a signal that changed nothing. Returns an unsubscribe fn. */
    onChange: (listener: (isFocused: boolean) => void) => () => void;
};

export function createWindowFocusTracker(options: WindowFocusOptions): WindowFocusTracker {
    const { read, subscribe } = options;
    return {
        isFocused: () => read() === true,
        onChange: listener => {
            let last = read() === true;
            return subscribe(() => {
                const next = read() === true;
                if (next === last) {
                    return;
                }
                last = next;
                listener(next);
            });
        },
    };
}
