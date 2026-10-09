import { describe, expect, it, vi } from "vitest";
import { STORY_RUMBLE_PRESETS } from "@shared/types/story";
import { createGameStoryInputHost } from "./storyInputHost";

function hostWith(overrides: { isSkipping?: () => boolean } = {}) {
    const releases: ReturnType<typeof vi.fn>[] = [];
    const holdAdvance = vi.fn(() => {
        const release = vi.fn();
        releases.push(release);
        return { release };
    });
    const host = createGameStoryInputHost({
        isSkipping: overrides.isSkipping ?? (() => false),
        readActions: () => ({}),
        holdAdvance,
    });
    return { host, holdAdvance, releases };
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
