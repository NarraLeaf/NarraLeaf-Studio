// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withDeadline } from "./frameTiming";

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("withDeadline", () => {
    it("resolves as soon as the work lands, without waiting out the deadline", async () => {
        let settle: (() => void) | null = null;
        const onTimeout = vi.fn();
        const waited = withDeadline(new Promise<void>(resolve => {
            settle = resolve;
        }), 10_000, onTimeout);

        let done = false;
        void waited.then(() => {
            done = true;
        });

        settle!();
        await vi.advanceTimersByTimeAsync(0);
        expect(done).toBe(true);
        expect(onTimeout).not.toHaveBeenCalled();
    });

    it("gives up after the deadline so the caller can make progress", async () => {
        const onTimeout = vi.fn();
        // A promise that never settles: the preload this stands in for may never report in.
        const waited = withDeadline(new Promise<void>(() => undefined), 5_000, onTimeout);

        let done = false;
        void waited.then(() => {
            done = true;
        });

        await vi.advanceTimersByTimeAsync(4_999);
        expect(done).toBe(false);

        await vi.advanceTimersByTimeAsync(1);
        expect(done).toBe(true);
        expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    it("treats a rejection as settled — the failure belongs to the promise owner", async () => {
        const onTimeout = vi.fn();
        const waited = withDeadline(Promise.reject(new Error("broken asset")), 5_000, onTimeout);

        await expect(waited).resolves.toBeUndefined();
        expect(onTimeout).not.toHaveBeenCalled();
    });

    it("calls onTimeout at most once", async () => {
        const onTimeout = vi.fn();
        let settle: (() => void) | null = null;
        withDeadline(new Promise<void>(resolve => {
            settle = resolve;
        }), 1_000, onTimeout);

        await vi.advanceTimersByTimeAsync(1_000);
        settle!();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(onTimeout).toHaveBeenCalledTimes(1);
    });
});
