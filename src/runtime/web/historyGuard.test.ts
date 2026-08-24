import { describe, expect, it } from "vitest";
import { HISTORY_GUARD_STATE_KEY, installHistoryGuard } from "./historyGuard";

/** A history of one document: entries this page pushed, and the one it stands on. */
function browser(initialState: unknown = null) {
    const entries: unknown[] = [initialState];
    let index = 0;
    let onPop: (() => void) | null = null;
    const logs: string[] = [];
    return {
        entries,
        logs,
        currentState: () => entries[index],
        back() {
            if (index === 0) {
                return;
            }
            index -= 1;
            // Forward entries survive a Back until something is pushed over them, which is what the
            // guard does.
            onPop?.();
        },
        host: {
            readState: () => entries[index],
            pushState: (state: unknown) => {
                entries.splice(index + 1);
                entries.push(state);
                index = entries.length - 1;
            },
            onPopState: (listener: () => void) => {
                onPop = listener;
            },
            log: (message: string) => logs.push(message),
        },
    };
}

describe("installHistoryGuard", () => {
    it("takes an entry of its own so Back has something to consume", () => {
        const b = browser();
        installHistoryGuard(b.host);
        expect(b.entries).toHaveLength(2);
        expect(b.currentState()).toEqual({ [HISTORY_GUARD_STATE_KEY]: true });
    });

    it("puts the entry back on every Back, so the page is never left", () => {
        const b = browser();
        installHistoryGuard(b.host);
        for (let press = 0; press < 5; press += 1) {
            b.back();
            expect(b.currentState()).toEqual({ [HISTORY_GUARD_STATE_KEY]: true });
        }
    });

    it("says so once, however many times Back is pressed", () => {
        const b = browser();
        installHistoryGuard(b.host);
        b.back();
        b.back();
        expect(b.logs).toHaveLength(1);
        expect(b.logs[0]).toContain("Back");
    });

    it("does not stack a second entry when the page reloads onto its own", () => {
        // A reload comes back to the entry the guard pushed, state included.
        const b = browser({ [HISTORY_GUARD_STATE_KEY]: true });
        installHistoryGuard(b.host);
        expect(b.entries).toHaveLength(1);
    });

    it("ignores state some other page left on the entry", () => {
        const b = browser({ some: "other page" });
        installHistoryGuard(b.host);
        expect(b.entries).toHaveLength(2);
    });
});
