import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startVisibleWatchdog, type VisibilitySource } from "./visibleWatchdog";

/**
 * The live preview's settle deadline counts only while the window is on screen: a rebuild that waits
 * on painted frames cannot finish in a minimised or covered window, and an author who switched away
 * must come back to the edit, not to a failure.
 */

function fakeVisibility(initial: DocumentVisibilityState = "visible") {
    const listeners = new Set<() => void>();
    const source: VisibilitySource & { set(state: DocumentVisibilityState): void; listenerCount(): number } = {
        visibilityState: initial,
        addEventListener: (_type, listener) => {
            listeners.add(listener);
        },
        removeEventListener: (_type, listener) => {
            listeners.delete(listener);
        },
        set(state) {
            (this as { visibilityState: DocumentVisibilityState }).visibilityState = state;
            listeners.forEach(listener => listener());
        },
        listenerCount: () => listeners.size,
    };
    return source;
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("startVisibleWatchdog", () => {
    it("expires after the given time on a visible page", () => {
        const page = fakeVisibility();
        const expired = vi.fn();
        startVisibleWatchdog(expired, 5000, page);
        vi.advanceTimersByTime(4999);
        expect(expired).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(expired).toHaveBeenCalledTimes(1);
        expect(page.listenerCount()).toBe(0);
    });

    it("never expires while the page is hidden, however long that lasts", () => {
        const page = fakeVisibility();
        const expired = vi.fn();
        startVisibleWatchdog(expired, 5000, page);
        vi.advanceTimersByTime(1000);
        page.set("hidden");
        vi.advanceTimersByTime(10 * 60_000);
        expect(expired).not.toHaveBeenCalled();
    });

    it("gives the work a whole new window once the page is visible again", () => {
        const page = fakeVisibility();
        const expired = vi.fn();
        startVisibleWatchdog(expired, 5000, page);
        vi.advanceTimersByTime(4000);
        page.set("hidden");
        vi.advanceTimersByTime(60_000);
        page.set("visible");
        vi.advanceTimersByTime(4999);
        expect(expired).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(expired).toHaveBeenCalledTimes(1);
    });

    it("starts counting only once a page that begins hidden is shown", () => {
        const page = fakeVisibility("hidden");
        const expired = vi.fn();
        startVisibleWatchdog(expired, 5000, page);
        vi.advanceTimersByTime(30_000);
        expect(expired).not.toHaveBeenCalled();
        page.set("visible");
        vi.advanceTimersByTime(5000);
        expect(expired).toHaveBeenCalledTimes(1);
    });

    it("does not expire for a deadline that came due while the page was already hidden", () => {
        // The timer fired before the visibility change reached the listener.
        const page = fakeVisibility();
        const expired = vi.fn();
        startVisibleWatchdog(expired, 5000, page);
        (page as { visibilityState: DocumentVisibilityState }).visibilityState = "hidden";
        vi.advanceTimersByTime(5000);
        expect(expired).not.toHaveBeenCalled();
        page.set("hidden");
        page.set("visible");
        vi.advanceTimersByTime(5000);
        expect(expired).toHaveBeenCalledTimes(1);
    });

    it("stays quiet once cancelled, visible or not", () => {
        const page = fakeVisibility();
        const expired = vi.fn();
        const cancel = startVisibleWatchdog(expired, 5000, page);
        cancel();
        page.set("hidden");
        page.set("visible");
        vi.advanceTimersByTime(60_000);
        expect(expired).not.toHaveBeenCalled();
        expect(page.listenerCount()).toBe(0);
    });
});
