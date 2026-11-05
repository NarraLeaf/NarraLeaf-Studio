import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PuppetStatus } from "narraleaf-react";
import { PUPPET_ENTRANCE_WAIT_MS, PUPPET_UNMOUNTED_GRACE_MS, waitForPuppetModel, type PuppetStatusSource } from "./puppetEntranceWait";

/** A puppet whose status the test moves, as the engine's mount and the backend's load would. */
function fakePuppet(initial: PuppetStatus) {
    let status = initial;
    const listeners = new Set<(next: PuppetStatus) => void>();
    const puppet: PuppetStatusSource = {
        getStatus: () => status,
        onStatusChange: listener => {
            listeners.add(listener);
            return { cancel: () => listeners.delete(listener) } as ReturnType<PuppetStatusSource["onStatusChange"]>;
        },
    };
    return {
        puppet,
        set(next: PuppetStatus) {
            status = next;
            for (const listener of [...listeners]) listener(next);
        },
        listening: () => listeners.size,
    };
}

/** Whether the promise has settled, after letting everything already due run. */
async function settled(promise: Promise<void>): Promise<boolean> {
    let done = false;
    void promise.then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(0);
    return done;
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("an entrance waiting for its character's model", () => {
    it("goes straight on when the model is already drawn, or never will be", async () => {
        for (const status of ["ready", "error", "missing-backend"] as const) {
            expect(await settled(waitForPuppetModel(fakePuppet(status).puppet, new AbortController().signal))).toBe(true);
        }
    });

    it("waits while the model loads, and goes on once it is drawn", async () => {
        const doll = fakePuppet("loading");
        const wait = waitForPuppetModel(doll.puppet, new AbortController().signal);
        expect(await settled(wait)).toBe(false);
        await vi.advanceTimersByTimeAsync(1000);
        expect(await settled(wait)).toBe(false);

        doll.set("ready");
        expect(await settled(wait)).toBe(true);
        expect(doll.listening()).toBe(0);
    });

    it("goes on when the load fails", async () => {
        const doll = fakePuppet("loading");
        const wait = waitForPuppetModel(doll.puppet, new AbortController().signal);
        doll.set("error");
        expect(await settled(wait)).toBe(true);
    });

    it("waits for a box the scene put on stage to mount, and loads from there", async () => {
        const doll = fakePuppet("unmounted");
        const wait = waitForPuppetModel(doll.puppet, new AbortController().signal);
        doll.set("loading");
        await vi.advanceTimersByTimeAsync(PUPPET_UNMOUNTED_GRACE_MS * 2);
        expect(await settled(wait)).toBe(false);
        doll.set("ready");
        expect(await settled(wait)).toBe(true);
    });

    it("does not wait for a box nothing mounts", async () => {
        const wait = waitForPuppetModel(fakePuppet("unmounted").puppet, new AbortController().signal);
        await vi.advanceTimersByTimeAsync(PUPPET_UNMOUNTED_GRACE_MS);
        expect(await settled(wait)).toBe(true);
    });

    it("gives up on a load that never settles", async () => {
        const wait = waitForPuppetModel(fakePuppet("loading").puppet, new AbortController().signal);
        await vi.advanceTimersByTimeAsync(PUPPET_ENTRANCE_WAIT_MS);
        expect(await settled(wait)).toBe(true);
    });

    it("stops waiting when the row is undone or the game is loaded", async () => {
        const controller = new AbortController();
        const doll = fakePuppet("loading");
        const wait = waitForPuppetModel(doll.puppet, controller.signal);
        controller.abort();
        expect(await settled(wait)).toBe(true);
        expect(doll.listening()).toBe(0);
    });
});
