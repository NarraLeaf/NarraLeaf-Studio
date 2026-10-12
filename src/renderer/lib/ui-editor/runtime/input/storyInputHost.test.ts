import { describe, expect, it, vi } from "vitest";
import { STORY_RUMBLE_PRESETS } from "@shared/types/story";
import { createGameStoryInputHost } from "./storyInputHost";
import { announceStoryInputActions } from "./storyInputWait";

function hostWith(overrides: { isSkipping?: () => boolean } = {}) {
    const releases: ReturnType<typeof vi.fn>[] = [];
    const holdAdvance = vi.fn(() => {
        const release = vi.fn();
        releases.push(release);
        return { release };
    });
    // Read by every poll of a `/hold`, so a spy on it shows whether one is still running.
    const readActions = vi.fn(() => ({}));
    const host = createGameStoryInputHost({
        isSkipping: overrides.isSkipping ?? (() => false),
        readActions,
        holdAdvance,
        isStageCovered: () => false,
    });
    return { host, holdAdvance, releases, readActions };
}

describe("createGameStoryInputHost", () => {
    it("takes one suspension for a lock and gives it back on unlock", () => {
        const { host, holdAdvance, releases } = hostWith();
        host.setAdvanceLocked(true);
        // A second lock is not a second suspension: one unlock has to be enough.
        host.setAdvanceLocked(true);
        expect(holdAdvance).toHaveBeenCalledTimes(1);
        expect(host.isAdvanceLocked()).toBe(true);
        host.setAdvanceLocked(false);
        expect(releases[0]).toHaveBeenCalledTimes(1);
        expect(host.isAdvanceLocked()).toBe(false);
    });

    it("hands the story back on reset", () => {
        const { host, releases } = hostWith();
        host.setAdvanceLocked(true);
        host.reset();
        expect(releases[0]).toHaveBeenCalledTimes(1);
        expect(host.isAdvanceLocked()).toBe(false);
    });

    it("drops every wait on reset: no more polling, no listener, and no answer", async () => {
        vi.useFakeTimers();
        try {
            const { host, readActions } = hostWith();
            let settled = false;
            void host.waitForInput({ operation: "hold", actionId: "confirm", holdMs: 1000 }, new AbortController().signal)
                .then(() => {
                    settled = true;
                });
            void host.waitForInput({ operation: "wait", timeoutMs: 5000 }, new AbortController().signal)
                .then(() => {
                    settled = true;
                });
            await vi.advanceTimersByTimeAsync(100);
            expect(readActions).toHaveBeenCalled();

            host.reset();
            readActions.mockClear();
            await vi.advanceTimersByTimeAsync(10_000);
            announceStoryInputActions([{ actionId: "confirm" }]);
            await vi.advanceTimersByTimeAsync(0);
            expect(readActions).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
            // The run it belonged to is being replaced: settling would hand that run an answer.
            expect(settled).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it("still ends a wait the usual way when the row is abandoned", async () => {
        const { host } = hostWith();
        const abort = new AbortController();
        const result = host.waitForInput({ operation: "wait" }, abort.signal);
        abort.abort();
        await expect(result).resolves.toBe(false);
    });

    it("plays no rumble while the player is skipping", async () => {
        const playEffect = vi.fn(() => Promise.resolve());
        vi.stubGlobal("navigator", {
            getGamepads: () => [{ mapping: "standard", vibrationActuator: { playEffect } }],
        });
        try {
            const skipping = hostWith({ isSkipping: () => true });
            await skipping.host.rumble(STORY_RUMBLE_PRESETS.tap, { wait: true });
            expect(playEffect).not.toHaveBeenCalled();
            const playing = hostWith();
            await playing.host.rumble({ ...STORY_RUMBLE_PRESETS.tap, durationMs: 0 }, { wait: true });
            expect(playEffect).toHaveBeenCalledTimes(1);
        } finally {
            vi.unstubAllGlobals();
        }
    });
});
