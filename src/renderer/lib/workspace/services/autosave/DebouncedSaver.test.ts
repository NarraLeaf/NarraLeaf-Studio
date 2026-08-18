import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DebouncedSaver, type SaveState } from "./DebouncedSaver";

describe("DebouncedSaver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const makeSaver = (save: () => Promise<void>, onError?: (error: unknown) => void) =>
    new DebouncedSaver({ delayMs: 800, maxWaitMs: 5_000, save, onError });

  it("coalesces a burst of edits into one write after the quiet period", async () => {
    const save = vi.fn(async () => undefined);
    const saver = makeSaver(save);

    saver.schedule();
    await vi.advanceTimersByTimeAsync(400);
    saver.schedule();
    await vi.advanceTimersByTimeAsync(400);
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("writes at the ceiling even while the edits never stop", async () => {
    // The defect this class exists to fix: with a pure trailing debounce, an edit every 400ms
    // means the quiet timer never expires and nothing reaches disk. Ever.
    const save = vi.fn(async () => undefined);
    const saver = makeSaver(save);

    for (let elapsed = 0; elapsed < 12_000; elapsed += 400) {
      saver.schedule();
      await vi.advanceTimersByTimeAsync(400);
    }

    expect(save).toHaveBeenCalled();
    // 12s of unbroken typing owes at least two ceiling-driven writes at a 5s cap.
    expect(save.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("measures the ceiling from the first edit of a streak, not from the last save", async () => {
    const save = vi.fn(async () => undefined);
    const saver = makeSaver(save);

    // Keep the quiet period alive throughout, so only the ceiling can fire.
    for (let elapsed = 0; elapsed < 4_800; elapsed += 400) {
      saver.schedule();
      await vi.advanceTimersByTimeAsync(400);
    }
    expect(save).not.toHaveBeenCalled();

    // Editing right before the ceiling must not push it out.
    saver.schedule();
    await vi.advanceTimersByTimeAsync(200);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("starts a fresh ceiling for the next streak", async () => {
    const save = vi.fn(async () => undefined);
    const saver = makeSaver(save);

    saver.schedule();
    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenCalledTimes(1);

    saver.schedule();
    await vi.advanceTimersByTimeAsync(799);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("cancel drops the pending write, including the one owed at the ceiling", async () => {
    const save = vi.fn(async () => undefined);
    const saver = makeSaver(save);

    saver.schedule();
    await vi.advanceTimersByTimeAsync(400);
    saver.cancel();

    await vi.advanceTimersByTimeAsync(20_000);
    expect(save).not.toHaveBeenCalled();
    expect(saver.isPending()).toBe(false);
  });

  it("flush writes immediately and leaves nothing armed", async () => {
    const save = vi.fn(async () => undefined);
    const saver = makeSaver(save);

    saver.schedule();
    await saver.flush();

    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("flush is a no-op when nothing is owed", async () => {
    const save = vi.fn(async () => undefined);
    const saver = makeSaver(save);

    await saver.flush();

    expect(save).not.toHaveBeenCalled();
  });

  it("serialises writes so two saves never overlap", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const releases: Array<() => void> = [];
    const save = vi.fn(async () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise<void>((resolve) => {
        releases.push(resolve);
      });
      concurrent -= 1;
    });
    const saver = makeSaver(save);

    saver.schedule();
    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenCalledTimes(1);

    // Second write comes due while the first is still running.
    saver.schedule();
    await vi.advanceTimersByTimeAsync(800);
    expect(maxConcurrent).toBe(1);

    releases.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
    releases.shift()?.();
    await vi.advanceTimersByTimeAsync(0);

    expect(save).toHaveBeenCalledTimes(2);
    expect(maxConcurrent).toBe(1);
  });

  it("reports a failed timer-driven save without stopping later ones", async () => {
    const onError = vi.fn();
    let attempt = 0;
    const save = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error("disk full");
      }
    });
    const saver = makeSaver(save, onError);

    saver.schedule();
    await vi.advanceTimersByTimeAsync(800);
    expect(onError).toHaveBeenCalledTimes(1);

    saver.schedule();
    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("throws out of flush rather than swallowing, because the caller asked for the write", async () => {
    const onError = vi.fn();
    const saver = makeSaver(async () => {
      throw new Error("read-only volume");
    }, onError);

    saver.schedule();

    await expect(saver.flush()).rejects.toThrow("read-only volume");
    expect(onError).not.toHaveBeenCalled();
  });

  it("retries a rejected write on its own, with no further edits", async () => {
    // The other half of the defect: the old copies logged a failed save and forgot it, leaving
    // the document dirty with nothing scheduled. Only the next keystroke could rescue it.
    let attempt = 0;
    const save = vi.fn(async () => {
      attempt += 1;
      if (attempt <= 2) {
        throw new Error("disk full");
      }
    });
    const saver = makeSaver(save);

    saver.schedule();
    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenCalledTimes(1);
    expect(saver.getState()).toBe("failed");

    await vi.advanceTimersByTimeAsync(1_000);
    expect(save).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(save).toHaveBeenCalledTimes(3);
    expect(saver.getState()).toBe("clean");
    expect(saver.isPending()).toBe(false);
  });

  it("keeps retrying past the end of the backoff ladder", async () => {
    const save = vi.fn(async () => {
      throw new Error("read-only volume");
    });
    const saver = makeSaver(save);

    saver.schedule();
    // 1 + 2 + 4 + 8 + 15 + 30s of ladder, then the 30s step repeating.
    await vi.advanceTimersByTimeAsync(800 + 60_000);
    const afterLadder = save.mock.calls.length;
    expect(afterLadder).toBeGreaterThanOrEqual(6);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(save.mock.calls.length).toBeGreaterThan(afterLadder);
    expect(saver.getState()).toBe("failed");
  });

  it("reports the state a save-status readout needs", async () => {
    const states: SaveState[] = [];
    let attempt = 0;
    const save = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error("disk full");
      }
    });
    const saver = makeSaver(save);
    saver.onStateChanged((state) => states.push(state));

    saver.schedule();
    expect(states).toEqual(["dirty"]);

    await vi.advanceTimersByTimeAsync(800);
    expect(states).toEqual(["dirty", "saving", "failed"]);

    // An edit during a failing streak must not downgrade the readout to "unsaved changes":
    // the disk is still refusing, and that is the thing worth showing.
    saver.schedule();
    expect(states).toEqual(["dirty", "saving", "failed"]);

    await vi.advanceTimersByTimeAsync(800);
    expect(states).toEqual(["dirty", "saving", "failed", "saving", "clean"]);
    expect(saver.getLastError()).toBeNull();
  });
});
