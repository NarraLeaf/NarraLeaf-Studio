/**
 * The choice voice throttle. Every assertion here is about *how many times a clip starts*, because
 * the trigger in practice is a hover and a hover fires on every crossing of the row.
 * Comments in English per project convention.
 */

import { describe, expect, it, vi } from "vitest";
import { createChoiceVoicePlayer, type ChoiceVoiceToken } from "./choiceVoicePlayback";

type FakeToken = ChoiceVoiceToken & {
    stopped: boolean;
    /** Play out to the end, as the audio backend reports it. */
    end: () => void;
};

function fakeToken(): FakeToken {
    const handlers = new Map<string, (() => void)[]>();
    let playing = true;
    const token: FakeToken = {
        stopped: false,
        isPlaying: () => playing,
        stop: () => {
            token.stopped = true;
            playing = false;
            for (const handler of handlers.get("stop") ?? []) {
                handler();
            }
            return undefined;
        },
        once: (event, callback) => {
            handlers.set(event, [...(handlers.get(event) ?? []), callback]);
            return undefined;
        },
        end: () => {
            playing = false;
            for (const handler of handlers.get("ended") ?? []) {
                handler();
            }
        },
    };
    return token;
}

/** A promise the test resolves by hand, to hold a start open across another call. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => {
        resolve = done;
    });
    return { promise, resolve };
}

/** A player whose starts resolve immediately, with the tokens it handed out. */
function playerWithTokens() {
    const tokens = new Map<string, FakeToken>();
    const start = vi.fn(async (unitId: string) => {
        const token = fakeToken();
        tokens.set(unitId, token);
        return token;
    });
    return { player: createChoiceVoicePlayer({ start }), start, tokens };
}

describe("choice voice playback", () => {
    it("ignores a repeat trigger while the same option is still speaking", async () => {
        const { player, start } = playerWithTokens();

        expect(await player.play("t-1")).toBe(true);
        expect(await player.play("t-1")).toBe(false);
        expect(await player.play("t-1")).toBe(false);
        expect(start).toHaveBeenCalledTimes(1);
    });

    it("speaks the same option again once it has played out", async () => {
        const { player, start, tokens } = playerWithTokens();

        await player.play("t-1");
        tokens.get("t-1")?.end();

        expect(await player.play("t-1")).toBe(true);
        expect(start).toHaveBeenCalledTimes(2);
    });

    /** The throttle is per line. Two options are two lines, and a menu may read them over each other. */
    it("lets a different option start while one is speaking", async () => {
        const { player, start, tokens } = playerWithTokens();

        expect(await player.play("t-1")).toBe(true);
        expect(await player.play("t-2")).toBe(true);
        expect(start).toHaveBeenCalledTimes(2);
        expect(tokens.get("t-1")?.stopped).toBe(false);
    });

    it("stops the other options only when the author asks it to", async () => {
        const { player, tokens } = playerWithTokens();

        await player.play("t-1");
        await player.play("t-2", { interruptOthers: true });

        expect(tokens.get("t-1")?.stopped).toBe(true);
        expect(tokens.get("t-2")?.stopped).toBe(false);
    });

    /**
     * Two hovers inside the window where the clip is still loading. Without the slot being reserved
     * before the fetch, both would see nothing playing and the line would start twice - which is
     * exactly the crossing speed a pointer produces.
     */
    it("holds the line while its clip is still loading", async () => {
        const loading = deferred<ChoiceVoiceToken>();
        const start = vi.fn(() => loading.promise);
        const player = createChoiceVoicePlayer({ start });

        const first = player.play("t-1");
        const second = player.play("t-1");
        expect(await second).toBe(false);

        loading.resolve(fakeToken());
        expect(await first).toBe(true);
        expect(start).toHaveBeenCalledTimes(1);
    });

    it("stops a clip that was cut before it finished loading", async () => {
        const pending = fakeToken();
        const loading = deferred<void>();
        const start = vi.fn(async (unitId: string) => {
            if (unitId === "t-1") {
                await loading.promise;
                return pending;
            }
            return fakeToken();
        });
        const player = createChoiceVoicePlayer({ start });

        const first = player.play("t-1");
        await player.play("t-2", { interruptOthers: true });
        loading.resolve();

        expect(await first).toBe(false);
        expect(pending.stopped).toBe(true);
    });

    it("reports an option with no take without holding the slot against the next trigger", async () => {
        const start = vi.fn(async () => null);
        const player = createChoiceVoicePlayer({ start });

        expect(await player.play("t-9")).toBe(false);
        expect(await player.play("t-9")).toBe(false);
        expect(start).toHaveBeenCalledTimes(2);
    });

    /** A choice that will not speak must not take the menu down with it. */
    it("survives a failed start and stays playable", async () => {
        const onError = vi.fn();
        let fail = true;
        const start = vi.fn(async () => {
            if (fail) {
                throw new Error("decode failed");
            }
            return fakeToken();
        });
        const player = createChoiceVoicePlayer({ start, onError });

        expect(await player.play("t-1")).toBe(false);
        expect(onError).toHaveBeenCalledTimes(1);

        fail = false;
        expect(await player.play("t-1")).toBe(true);
    });

    it("treats a blank unit id as nothing to play", async () => {
        const { player, start } = playerWithTokens();

        expect(await player.play("   ")).toBe(false);
        expect(start).not.toHaveBeenCalled();
    });
});
