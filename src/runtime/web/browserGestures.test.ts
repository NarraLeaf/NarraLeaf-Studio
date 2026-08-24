import { describe, expect, it } from "vitest";
import { installBrowserGestureGuards, type BrowserGestureEvent } from "./browserGestures";

type Registered = {
    type: string;
    listener: (event: BrowserGestureEvent) => void;
    options?: { passive?: boolean };
};

function fakeHost() {
    const registered: Registered[] = [];
    return {
        host: {
            addEventListener: (
                type: string,
                listener: (event: BrowserGestureEvent) => void,
                options?: { passive?: boolean },
            ) => {
                registered.push({ type, listener, options });
            },
        },
        registered,
        /** Deliver an event to every listener for `type`, reporting whether it was cancelled. */
        fire: (type: string, target?: unknown): boolean => {
            let prevented = false;
            for (const entry of registered.filter(item => item.type === type)) {
                entry.listener({ target, preventDefault: () => { prevented = true; } });
            }
            return prevented;
        },
    };
}

/** An element whose `closest` answers for one selector, the way the DOM's would. */
function elementMatching(selector: string): unknown {
    return {
        closest: (selectors: string) => (selectors.includes(selector) ? {} : null),
    };
}

describe("installBrowserGestureGuards", () => {
    it("cancels Safari's pinch, which touch-action alone does not reach", () => {
        const { host, fire } = fakeHost();
        installBrowserGestureGuards(host);
        expect(fire("gesturestart")).toBe(true);
        expect(fire("gesturechange")).toBe(true);
        expect(fire("gestureend")).toBe(true);
    });

    it("registers the pinch listeners as non-passive", () => {
        // A listener the browser assumed to be passive has its preventDefault() ignored, which
        // would leave the guard installed and doing nothing.
        const { host, registered } = fakeHost();
        installBrowserGestureGuards(host);
        const pinch = registered.filter(entry => entry.type.startsWith("gesture"));
        expect(pinch).toHaveLength(3);
        for (const entry of pinch) {
            expect(entry.options?.passive).toBe(false);
        }
    });

    it("swallows the context menu over the game", () => {
        // On Android this is what a long press on the dialogue produces, and it offers Reload.
        const { host, fire } = fakeHost();
        installBrowserGestureGuards(host);
        expect(fire("contextmenu", elementMatching("input"))).toBe(false);
        expect(fire("contextmenu", { closest: () => null })).toBe(true);
        expect(fire("contextmenu", null)).toBe(true);
    });

    it("leaves the menu to a text field, where Paste lives", () => {
        const { host, fire } = fakeHost();
        installBrowserGestureGuards(host);
        for (const selector of ["input", "textarea", "select", "contenteditable"]) {
            expect(fire("contextmenu", elementMatching(selector))).toBe(false);
        }
    });
});
