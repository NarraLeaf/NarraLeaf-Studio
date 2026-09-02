/**
 * One change, one event - which is the whole job of this module on the web.
 *
 * Comments in English per project convention.
 */
import { describe, expect, it } from "vitest";
import { createWindowFocusTracker } from "./windowFocus";

/** A page whose visibility and focus can be moved by hand, and which raises the signals a browser does. */
function fakePage(initial = true) {
    const listeners = new Set<() => void>();
    // The page's own state, held apart from the object below so the tracker can read it without
    // the object having to be typed before it exists.
    const state = { focused: initial, removed: 0 };
    return {
        state,
        tracker: createWindowFocusTracker({
            read: (): boolean => state.focused,
            subscribe: listener => {
                listeners.add(listener);
                return () => {
                    listeners.delete(listener);
                    state.removed += 1;
                };
            },
        }),
        /** What a browser does when the player switches tab: several signals for one change. */
        raise: (times = 1) => {
            for (let index = 0; index < times; index += 1) {
                for (const listener of [...listeners]) {
                    listener();
                }
            }
        },
    };
}

describe("the web export's window focus", () => {
    it("reports one change per change, however many signals the browser raised", () => {
        const page = fakePage(true);
        const seen: boolean[] = [];
        page.tracker.onChange((isFocused: boolean) => seen.push(isFocused));

        // Switching away raises `blur` and `visibilitychange` together.
        page.state.focused = false;
        page.raise(2);
        expect(seen).toEqual([false]);

        page.state.focused = true;
        page.raise(2);
        expect(seen).toEqual([false, true]);
    });

    it("says nothing for a signal that changed nothing", () => {
        // Clicking into an already-focused page raises `focus`. A game that heard about it would
        // re-run every `On Window Focus Changed` graph in the project for no reason.
        const page = fakePage(true);
        const seen: boolean[] = [];
        page.tracker.onChange((isFocused: boolean) => seen.push(isFocused));

        page.raise(3);
        expect(seen).toEqual([]);
    });

    it("reads the page rather than what it last announced", () => {
        const page = fakePage(false);
        expect(page.tracker.isFocused()).toBe(false);
        page.state.focused = true;
        expect(page.tracker.isFocused()).toBe(true);
    });

    it("takes its listeners off the page when it is let go", () => {
        const page = fakePage(true);
        const stop = page.tracker.onChange(() => undefined);
        stop();
        expect(page.state.removed).toBe(1);

        const seen: boolean[] = [];
        page.tracker.onChange((isFocused: boolean) => seen.push(isFocused));
        stop();
        page.state.focused = false;
        page.raise();
        expect(seen).toEqual([false]);
    });
});
