/**
 * An auto-save takes its picture while the player reads, and keeps the last one while they skip.
 *
 * Time is a stand-in: `sleep` advances the clock and runs whatever the test says happens in that
 * stretch, so a wait that would take seconds in a game takes none here and lands exactly where the
 * test puts it. What is pinned is when the stage is pictured and which picture each write keeps.
 *
 * Comments in English per project convention.
 */
import { describe, expect, it } from "vitest";
import {
    AUTO_SAVE_QUIET_MS,
    AUTO_SAVE_QUIET_POLL_MS,
    AUTO_SAVE_QUIET_WAIT_MS,
    AutoSavePicture,
} from "./autoSavePicture";

function harness() {
    const state = {
        now: 10_000,
        skipping: false,
        playthrough: 1,
        /** Runs at every poll, before the clock moves on: what the game does while the write waits. */
        duringWait: (_now: number): void => undefined,
    };
    const captures: number[] = [];
    let idleWaits = 0;
    const picture = new AutoSavePicture({
        isSkipping: () => state.skipping,
        playthrough: () => state.playthrough,
        capture: async () => {
            captures.push(state.now);
            return `picture@${state.now}`;
        },
        now: () => state.now,
        sleep: async ms => {
            state.duringWait(state.now);
            state.now += ms;
        },
        whenIdle: async () => {
            idleWaits += 1;
        },
    });
    return { picture, state, captures, idleWaits: () => idleWaits };
}

describe("AutoSavePicture", () => {
    it("pictures the stage at once when the play head has been still for the quiet window", async () => {
        const { picture, state, captures, idleWaits } = harness();
        picture.markPlayHeadMoved();
        state.now += AUTO_SAVE_QUIET_MS;

        expect(await picture.pictureForWrite("auto-0")).toBe(`picture@${state.now}`);
        expect(captures).toEqual([state.now]);
        // Taken in the browser's idle time, not the first moment it could be.
        expect(idleWaits()).toBe(1);
    });

    it("waits mid-line until the line has been still for the quiet window", async () => {
        const { picture, state, captures } = harness();
        picture.markPlayHeadMoved();
        const movedAt = state.now;
        state.now += 300;

        await picture.pictureForWrite("auto-0");

        expect(captures).toHaveLength(1);
        expect(captures[0] - movedAt).toBeGreaterThanOrEqual(AUTO_SAVE_QUIET_MS);
        expect(captures[0] - movedAt).toBeLessThan(AUTO_SAVE_QUIET_MS + AUTO_SAVE_QUIET_POLL_MS);
    });

    it("keeps the last picture of the playthrough while the skip runs", async () => {
        const { picture, state, captures } = harness();
        state.now += AUTO_SAVE_QUIET_MS;
        const first = await picture.pictureForWrite("auto-0");

        state.skipping = true;
        picture.markPlayHeadMoved();
        expect(await picture.pictureForWrite("auto-1")).toBe(first);
        expect(captures).toHaveLength(1);
    });

    it("stops waiting and keeps the last picture when the skip starts during the wait", async () => {
        const { picture, state, captures } = harness();
        state.now += AUTO_SAVE_QUIET_MS;
        const first = await picture.pictureForWrite("auto-0");

        picture.markPlayHeadMoved();
        state.duringWait = () => {
            state.skipping = true;
            picture.markPlayHeadMoved();
        };
        expect(await picture.pictureForWrite("auto-1")).toBe(first);
        expect(captures).toHaveLength(1);
    });

    it("takes one picture while skipping when the playthrough has none yet", async () => {
        const { picture, state, captures } = harness();
        state.skipping = true;
        picture.markPlayHeadMoved();

        expect(await picture.pictureForWrite("auto-0")).toBe(`picture@${state.now}`);
        expect(captures).toHaveLength(1);
    });

    it("never reuses a picture from an earlier playthrough", async () => {
        const { picture, state, captures } = harness();
        state.now += AUTO_SAVE_QUIET_MS;
        await picture.pictureForWrite("auto-0");

        // A save was loaded: somewhere else in the story, so the old picture is of the wrong screen.
        state.playthrough = 2;
        state.skipping = true;
        picture.markPlayHeadMoved();
        expect(await picture.pictureForWrite("auto-1")).toBe(`picture@${state.now}`);
        expect(captures).toHaveLength(2);
    });

    it("keeps the last picture when the player never stops long enough", async () => {
        const { picture, state, captures } = harness();
        state.now += AUTO_SAVE_QUIET_MS;
        const first = await picture.pictureForWrite("auto-0");

        // A click every half second: never quiet.
        picture.markPlayHeadMoved();
        let nextClick = state.now + 500;
        state.duringWait = now => {
            if (now >= nextClick) {
                picture.markPlayHeadMoved();
                nextClick = now + 500;
            }
        };
        const startedAt = state.now;
        expect(await picture.pictureForWrite("auto-1")).toBe(first);
        expect(state.now - startedAt).toBeGreaterThanOrEqual(AUTO_SAVE_QUIET_WAIT_MS);
        expect(captures).toHaveLength(1);
    });

    it("keeps no picture that could not be taken", async () => {
        const { state } = harness();
        let calls = 0;
        const picture = new AutoSavePicture({
            isSkipping: () => true,
            playthrough: () => 1,
            capture: async () => { calls += 1; return undefined; },
            now: () => state.now,
            sleep: async ms => { state.now += ms; },
            whenIdle: async () => undefined,
        });

        expect(await picture.pictureForWrite("auto-0")).toBeUndefined();
        // Nothing was kept, so the next write tries again rather than reusing a missing picture.
        expect(await picture.pictureForWrite("auto-1")).toBeUndefined();
        expect(calls).toBe(2);
    });
});
