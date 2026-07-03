import { describe, expect, it, vi } from "vitest";
import { subscribeGamePreferenceChanges } from "./gamePreferenceSubscription";

function makeLiveGame(initial: Record<string, unknown>) {
    let listener: ((key: string, value: unknown) => void) | null = null;
    const cancel = vi.fn(() => {
        listener = null;
    });
    return {
        liveGame: {
            game: {
                preference: {
                    getPreferences: () => ({ ...initial }),
                    onPreferenceChange: (fn: (key: string, value: unknown) => void) => {
                        listener = fn;
                        return { cancel };
                    },
                },
            },
        },
        emit: (key: string, value: unknown) => listener?.(key, value),
        cancel,
    };
}

describe("subscribeGamePreferenceChanges", () => {
    it("seeds the snapshot and reports the previous value on change", () => {
        const { liveGame, emit } = makeLiveGame({ bgmVolume: 1, voiceVolume: 0.5 });
        const snapshotRef = { current: {} as Record<string, unknown> };
        const changes: Array<[string, unknown, unknown]> = [];

        const token = subscribeGamePreferenceChanges(liveGame, snapshotRef, (key, value, previousValue) => {
            changes.push([key, value, previousValue]);
        });

        expect(token).not.toBeNull();
        expect(snapshotRef.current).toEqual({ bgmVolume: 1, voiceVolume: 0.5 });

        emit("bgmVolume", 0.2);
        emit("bgmVolume", 0.8);
        emit("newKey", true);

        expect(changes).toEqual([
            ["bgmVolume", 0.2, 1],
            ["bgmVolume", 0.8, 0.2],
            ["newKey", true, null],
        ]);
        expect(snapshotRef.current.bgmVolume).toBe(0.8);
    });

    it("returns null when the live game has no preference dispatcher", () => {
        const snapshotRef = { current: {} as Record<string, unknown> };
        expect(subscribeGamePreferenceChanges(null, snapshotRef, () => {})).toBeNull();
        expect(subscribeGamePreferenceChanges({ game: {} }, snapshotRef, () => {})).toBeNull();
    });
});
