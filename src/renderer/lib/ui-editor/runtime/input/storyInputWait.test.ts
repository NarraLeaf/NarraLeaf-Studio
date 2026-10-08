import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { announceStoryInputActions, waitForStoryInput, type StoryInputWaitRequest } from "./storyInputWait";

/**
 * The waiting rows, driven the way the game drives them: actions announced as the funnel announces
 * them, the hold read off a held-set the test owns, and time moved by hand.
 */

let held = new Set<string>();
const deps = { isActionHeld: (actionId: string | undefined) => (actionId ? held.has(actionId) : held.size > 0) };

function press(...actionIds: string[]): void {
    announceStoryInputActions(actionIds.map(actionId => ({ actionId })));
}

function start(request: StoryInputWaitRequest, signal?: AbortSignal): { result: () => boolean | undefined } {
    let result: boolean | undefined;
    void waitForStoryInput(request, deps, signal).then(value => {
        result = value;
    });
    return { result: () => result };
}

beforeEach(() => {
    vi.useFakeTimers();
    held = new Set();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("wait", () => {
    it("settles on the named action, after the input has finished dispatching", async () => {
        const wait = start({ operation: "wait", actionId: "confirm" });
        press("dodge");
        await vi.advanceTimersByTimeAsync(0);
        expect(wait.result()).toBeUndefined();
        press("confirm");
        // Not in the same task: the press is still on its way to the page and the dialogue box.
        await Promise.resolve();
        expect(wait.result()).toBeUndefined();
        await vi.advanceTimersByTimeAsync(0);
        expect(wait.result()).toBe(true);
    });

    it("takes any action when none is named", async () => {
        const wait = start({ operation: "wait" });
        press("dodge");
        await vi.advanceTimersByTimeAsync(0);
        expect(wait.result()).toBe(true);
    });

    it("fails when the deadline passes first", async () => {
        const wait = start({ operation: "wait", actionId: "confirm", timeoutMs: 2000 });
        await vi.advanceTimersByTimeAsync(2000);
        expect(wait.result()).toBe(false);
        press("confirm");
        await vi.advanceTimersByTimeAsync(0);
        expect(wait.result()).toBe(false);
    });

    it("lets go on abort", async () => {
        const abort = new AbortController();
        const wait = start({ operation: "wait", actionId: "confirm" }, abort.signal);
        abort.abort();
        await vi.advanceTimersByTimeAsync(0);
        expect(wait.result()).toBe(false);
    });
});

describe("mash", () => {
    it("counts presses of the action and nothing else", async () => {
        const mash = start({ operation: "mash", actionId: "confirm", count: 3, timeoutMs: 1000 });
        press("confirm");
        press("dodge");
        press("confirm");
        await vi.advanceTimersByTimeAsync(0);
        expect(mash.result()).toBeUndefined();
        press("confirm");
        await vi.advanceTimersByTimeAsync(0);
        expect(mash.result()).toBe(true);
    });

    it("fails a count not reached in time", async () => {
        const mash = start({ operation: "mash", actionId: "confirm", count: 3, timeoutMs: 1000 });
        press("confirm");
        await vi.advanceTimersByTimeAsync(1000);
        expect(mash.result()).toBe(false);
    });
});

describe("hold", () => {
    it("completes once the action has been down long enough and is let go", async () => {
        const hold = start({ operation: "hold", actionId: "confirm", holdMs: 500 });
        held.add("confirm");
        await vi.advanceTimersByTimeAsync(600);
        // Reached, but still down: the release of a mouse button is a click, which must land while
        // the row is still waiting.
        expect(hold.result()).toBeUndefined();
        held.delete("confirm");
        await vi.advanceTimersByTimeAsync(20);
        expect(hold.result()).toBe(true);
    });

    it("starts over when let go early, rather than failing", async () => {
        const hold = start({ operation: "hold", actionId: "confirm", holdMs: 500 });
        held.add("confirm");
        await vi.advanceTimersByTimeAsync(300);
        held.delete("confirm");
        await vi.advanceTimersByTimeAsync(50);
        held.add("confirm");
        await vi.advanceTimersByTimeAsync(300);
        held.delete("confirm");
        await vi.advanceTimersByTimeAsync(50);
        expect(hold.result()).toBeUndefined();
    });

    it("does not count a key that was already down when the row started", async () => {
        held.add("confirm");
        const hold = start({ operation: "hold", actionId: "confirm", holdMs: 200, timeoutMs: 1000 });
        await vi.advanceTimersByTimeAsync(1000);
        expect(hold.result()).toBe(false);
    });

    it("is not failed by the deadline once the hold is complete", async () => {
        const hold = start({ operation: "hold", actionId: "confirm", holdMs: 200, timeoutMs: 400 });
        held.add("confirm");
        await vi.advanceTimersByTimeAsync(800);
        held.delete("confirm");
        await vi.advanceTimersByTimeAsync(20);
        expect(hold.result()).toBe(true);
    });
});
