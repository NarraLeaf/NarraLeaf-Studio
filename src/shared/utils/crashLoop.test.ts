import { describe, expect, it } from "vitest";
import { CRASH_LOOP_LIMIT, CRASH_LOOP_WINDOW_MS, isCrashLooping, recordCrash } from "./crashLoop";

describe("recordCrash", () => {
  it("forgets crashes older than the loop window", () => {
    const now = 10_000_000;
    const history = recordCrash([now - CRASH_LOOP_WINDOW_MS - 1, now - 1_000], now);

    expect(history).toEqual([now - 1_000, now]);
  });

  it("does not mutate the history it was given", () => {
    const history = [1_000];

    recordCrash(history, 2_000);

    expect(history).toEqual([1_000]);
  });
});

describe("isCrashLooping", () => {
  it("still offers a reload for the first crashes", () => {
    // The common renderer death is a single page running out of memory, and it comes back
    // fine. Refusing to reload those would make one bad frame close the project.
    expect(isCrashLooping([])).toBe(false);
    expect(isCrashLooping(new Array(CRASH_LOOP_LIMIT - 1).fill(1))).toBe(false);
  });

  it("stops offering once the window has died repeatedly", () => {
    expect(isCrashLooping(new Array(CRASH_LOOP_LIMIT).fill(1))).toBe(true);
  });

  it("counts a slow trickle of crashes as separate incidents", () => {
    // Three crashes over an afternoon are three incidents; each deserves its own offer.
    let history: number[] = [];
    for (let index = 0; index < 5; index++) {
      history = recordCrash(history, index * (CRASH_LOOP_WINDOW_MS + 1));
    }

    expect(isCrashLooping(history)).toBe(false);
  });
});
