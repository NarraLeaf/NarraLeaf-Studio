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
    it("cancels Safari's pinch where the shell has no way back out of a zoom", () => {
        const { host, fire } = fakeHost();
        installBrowserGestureGuards(host, { blockPinch: true });
        expect(fire("gesturestart")).toBe(true);
        expect(fire("gesturechange")).toBe(true);
        expect(fire("gestureend")).toBe(true);
    });

    it("leaves the pinch alone in a browser, trackpad included", () => {
        // Visual zoom is the reader's, not the game's: it magnifies what is drawn without
        // re-laying anything out, and a browser window has its own chrome to undo it with.
        const { host, registered, fire } = fakeHost();
        installBrowserGestureGuards(host, { blockPinch: false });
        expect(registered.some(entry => entry.type.startsWith("gesture"))).toBe(false);
        expect(fire("gesturestart")).toBe(false);
    });

    it("registers the pinch listeners as non-passive", () => {
        // A listener the browser assumed to be passive has its preventDefault() ignored, which
        // would leave the guard installed and doing nothing.
        const { host, registered } = fakeHost();
        installBrowserGestureGuards(host, { blockPinch: true });
        const pinch = registered.filter(entry => entry.type.startsWith("gesture"));
        expect(pinch).toHaveLength(3);
        for (const entry of pinch) {
            expect(entry.options?.passive).toBe(false);
        }
    });

    it("swallows the context menu over the game", () => {
        // On Android this is what a long press on the dialogue produces, and it offers Reload.
        const { host, fire } = fakeHost();
        installBrowserGestureGuards(host, { blockPinch: false });
        expect(fire("contextmenu", elementMatching("input"))).toBe(false);
        expect(fire("contextmenu", { closest: () => null })).toBe(true);
        expect(fire("contextmenu", null)).toBe(true);
    });

    it("leaves the menu to a text field, where Paste lives", () => {
        const { host, fire } = fakeHost();
        installBrowserGestureGuards(host, { blockPinch: true });
        for (const selector of ["input", "textarea", "select", "contenteditable"]) {
            expect(fire("contextmenu", elementMatching(selector))).toBe(false);
        }
    });
});
