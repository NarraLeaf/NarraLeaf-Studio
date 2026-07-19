import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    TEXT_READ_PERSISTENCE_KEY,
    createReadKeyResolver,
    createTextReadTracker,
    type TextReadDialogSnapshot,
    type TextReadTrackerOptions,
} from "./textReadTracker";
import type { NlrActionIdBinding } from "@/lib/ui-editor/runtime/game/storyCompiler";

type Harness = {
    setDialog: (dialog: TextReadDialogSnapshot | null) => void;
    notify: () => void;
    mirror: boolean[];
    persisted: unknown[];
    cancelCount: () => number;
    tracker: ReturnType<typeof createTextReadTracker>;
};

function createHarness(overrides: Partial<TextReadTrackerOptions> = {}, storedIds: unknown = []): Harness {
    let dialog: TextReadDialogSnapshot | null = null;
    let listener: (() => void) | null = null;
    let cancels = 0;
    const mirror: boolean[] = [];
    const persisted: unknown[] = [];

    const tracker = createTextReadTracker({
        getCurrentDialog: () => dialog,
        subscribe: cb => {
            listener = cb;
            return {
                cancel: () => {
                    cancels += 1;
                    listener = null;
                },
            };
        },
        persistenceGetAsync: async () => storedIds,
        persistenceSet: (key, value) => {
            expect(key).toBe(TEXT_READ_PERSISTENCE_KEY);
            persisted.push(value);
        },
        setMirror: value => {
            mirror.push(value);
        },
        resolveReadKey: actionId => actionId,
        persistDebounceMs: 50,
        ...overrides,
    });

    return {
        setDialog: next => {
            dialog = next;
        },
        notify: () => listener?.(),
        mirror,
        persisted,
        cancelCount: () => cancels,
        tracker,
    };
}

describe("createTextReadTracker", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("marks a line as read only once its display has ended", async () => {
        const harness = createHarness();
        await harness.tracker.whenLoaded;

        harness.setDialog({ actionId: "uuid-1", ended: false });
        harness.notify();
        expect(harness.tracker.isCurrentTextRead()).toBe(false);

        harness.setDialog({ actionId: "uuid-1", ended: true });
        harness.notify();
        expect(harness.tracker.isCurrentTextRead()).toBe(true);

        // Advancing to the next unread line drops back to false.
        harness.setDialog({ actionId: "uuid-2", ended: false });
        harness.notify();
        expect(harness.tracker.isCurrentTextRead()).toBe(false);

        // Revisiting the read line reports true while it is still typing.
        harness.setDialog({ actionId: "uuid-1", ended: false });
        harness.notify();
        expect(harness.tracker.isCurrentTextRead()).toBe(true);

        // No dialog on screen → false.
        harness.setDialog(null);
        harness.notify();
        expect(harness.tracker.isCurrentTextRead()).toBe(false);
    });

    it("merges the persisted read set and reports previously seen lines", async () => {
        const harness = createHarness({}, ["uuid-old", 42, ""]);
        await harness.tracker.whenLoaded;

        harness.setDialog({ actionId: "uuid-old", ended: false });
        harness.notify();
        expect(harness.tracker.isCurrentTextRead()).toBe(true);

        // Malformed entries were dropped.
        harness.setDialog({ actionId: "42", ended: false });
        harness.notify();
        expect(harness.tracker.isCurrentTextRead()).toBe(false);
    });

    it("debounces persistence and flushes pending writes on detach", async () => {
        const harness = createHarness();
        await harness.tracker.whenLoaded;

        harness.setDialog({ actionId: "uuid-1", ended: true });
        harness.notify();
        expect(harness.persisted).toEqual([]);

        vi.advanceTimersByTime(60);
        expect(harness.persisted).toEqual([["uuid-1"]]);

        harness.setDialog({ actionId: "uuid-2", ended: true });
        harness.notify();
        harness.tracker.detach();
        expect(harness.persisted).toEqual([["uuid-1"], ["uuid-1", "uuid-2"]]);
        expect(harness.cancelCount()).toBe(1);
        // Mirror reset to false on detach.
        expect(harness.mirror[harness.mirror.length - 1]).toBe(false);
    });

    it("clearAll wipes memory and persistence immediately and re-marks a finished on-screen line", async () => {
        const harness = createHarness({}, ["uuid-old"]);
        await harness.tracker.whenLoaded;

        // Clearing between lines: previously seen lines become unread.
        harness.setDialog({ actionId: "uuid-old", ended: false });
        harness.notify();
        expect(harness.tracker.isCurrentTextRead()).toBe(true);

        harness.setDialog(null);
        harness.notify();
        harness.tracker.clearAll();
        expect(harness.persisted).toEqual([[]]);

        harness.setDialog({ actionId: "uuid-old", ended: false });
        harness.notify();
        expect(harness.tracker.isCurrentTextRead()).toBe(false);

        // Clearing while a finished line is on screen: that line re-marks itself
        // (the player is looking at it), everything else stays cleared.
        harness.setDialog({ actionId: "uuid-old", ended: true });
        harness.notify();
        harness.tracker.clearAll();
        expect(harness.tracker.isCurrentTextRead()).toBe(true);
        vi.advanceTimersByTime(60);
        expect(harness.persisted[harness.persisted.length - 1]).toEqual(["uuid-old"]);
    });

    it("ignores dialogs without a resolvable read key", async () => {
        const harness = createHarness({ resolveReadKey: () => null });
        await harness.tracker.whenLoaded;

        harness.setDialog({ actionId: "uuid-1", ended: true });
        harness.notify();
        expect(harness.tracker.isCurrentTextRead()).toBe(false);
        vi.advanceTimersByTime(60);
        expect(harness.persisted).toEqual([]);
    });

    it("degrades to session-only tracking when persistence is unreadable", async () => {
        const harness = createHarness({
            persistenceGetAsync: async () => {
                throw new Error("storage unavailable");
            },
        });
        await harness.tracker.whenLoaded;

        harness.setDialog({ actionId: "uuid-1", ended: true });
        harness.notify();
        expect(harness.tracker.isCurrentTextRead()).toBe(true);
    });
});

describe("createReadKeyResolver", () => {
    it("maps static action ids to text UUIDs and falls back to the raw id", () => {
        const bindings = [
            { staticId: "studio:s:sc:b:text-1:0", blockId: "b", textId: "text-1" },
            { staticId: "studio:s:sc:b2:action:1", blockId: "b2" },
        ] as unknown as NlrActionIdBinding[];
        const resolve = createReadKeyResolver(bindings);

        expect(resolve("studio:s:sc:b:text-1:0")).toBe("text-1");
        // Non-text action ids and foreign ids fall back to the raw id.
        expect(resolve("studio:s:sc:b2:action:1")).toBe("studio:s:sc:b2:action:1");
        expect(resolve(" custom-action ")).toBe("custom-action");
        expect(resolve("   ")).toBeNull();
    });
});
