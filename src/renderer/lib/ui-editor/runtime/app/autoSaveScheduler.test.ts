import { describe, expect, it } from "vitest";
import {
    DEFAULT_AUTO_SAVE_CONFIGURATION,
    autoSaveSlotId,
    type AutoSaveConfiguration,
    type AutoSaveEntry,
} from "@shared/types/saves";
import { AutoSaveScheduler, type AutoSaveWriteReason } from "./autoSaveScheduler";

function entry(slot: number, timestamp: number): AutoSaveEntry {
    return {
        id: autoSaveSlotId(slot),
        slot,
        timestamp,
        createdAt: timestamp,
        preview: null,
        line: "",
        speaker: "",
        metadata: null,
    };
}

function harness(overrides?: {
    config?: Partial<AutoSaveConfiguration>;
    playing?: boolean;
    stored?: AutoSaveEntry[];
    failWrites?: number;
}) {
    const written: string[] = [];
    const reasons: AutoSaveWriteReason[] = [];
    const logs: string[] = [];
    let remainingFailures = overrides?.failWrites ?? 0;
    const state = {
        config: { ...DEFAULT_AUTO_SAVE_CONFIGURATION, ...overrides?.config },
        playing: overrides?.playing ?? true,
    };
    const scheduler = new AutoSaveScheduler({
        getConfig: () => state.config,
        isPlaying: () => state.playing,
        playthrough: () => 1,
        write: async (id, reason) => {
            if (remainingFailures > 0) {
                remainingFailures -= 1;
                throw new Error("disk is on fire");
            }
            written.push(id);
            reasons.push(reason);
        },
        listStored: async () => overrides?.stored ?? [],
        log: (_level, message) => logs.push(message),
    });
    return { scheduler, written, reasons, logs, state };
}

describe("AutoSaveScheduler", () => {
    it("writes nothing until the story has advanced", async () => {
        const { scheduler, written } = harness();

        await scheduler.tick();
        await scheduler.tick();
        expect(written).toEqual([]);

        scheduler.markStoryAdvanced();
        await scheduler.tick();
        expect(written).toEqual([autoSaveSlotId(0)]);
    });

    it("does not re-save a state it already saved", async () => {
        const { scheduler, written } = harness();

        scheduler.markStoryAdvanced();
        await scheduler.tick();
        // Player idles: many ticks, no further writes and no wasted captures.
        await scheduler.tick();
        await scheduler.tick();
        expect(written).toEqual([autoSaveSlotId(0)]);

        scheduler.markStoryAdvanced();
        await scheduler.tick();
        expect(written).toEqual([autoSaveSlotId(0), autoSaveSlotId(1)]);
    });

    it("rotates through the ring and wraps back to the start", async () => {
        const { scheduler, written } = harness({ config: { slots: 3 } });

        for (let i = 0; i < 4; i += 1) {
            scheduler.markStoryAdvanced();
            await scheduler.tick();
        }
        expect(written).toEqual([
            autoSaveSlotId(0),
            autoSaveSlotId(1),
            autoSaveSlotId(2),
            autoSaveSlotId(0),
        ]);
    });

    it("resumes at the oldest slot so a relaunch does not clobber the newest save", async () => {
        const { scheduler, written } = harness({
            config: { slots: 3 },
            stored: [entry(0, 3_000), entry(1, 1_000), entry(2, 2_000)],
        });

        scheduler.markStoryAdvanced();
        await scheduler.tick();
        scheduler.markStoryAdvanced();
        await scheduler.tick();
        expect(written).toEqual([autoSaveSlotId(1), autoSaveSlotId(2)]);
    });

    it("fills an empty slot before overwriting any written one", async () => {
        const { scheduler, written } = harness({
            config: { slots: 3 },
            stored: [entry(0, 3_000), entry(2, 1_000)],
        });

        scheduler.markStoryAdvanced();
        await scheduler.tick();
        expect(written).toEqual([autoSaveSlotId(1)]);
    });

    it("ignores slots left behind by a larger ring", async () => {
        const { scheduler, written } = harness({
            config: { slots: 2 },
            // Slot 4 is a leftover from when the author kept 5 autosaves. It is
            // still listed for the player, but the ring must not aim at it.
            stored: [entry(0, 5_000), entry(1, 4_000), entry(4, 1_000)],
        });

        scheduler.markStoryAdvanced();
        await scheduler.tick();
        expect(written).toEqual([autoSaveSlotId(1)]);
    });

    it("stays quiet while autosaving is off or no game is running", async () => {
        const off = harness({ config: { enabled: false } });
        off.scheduler.markStoryAdvanced();
        await off.scheduler.tick();
        expect(off.written).toEqual([]);

        const menu = harness({ playing: false });
        menu.scheduler.markStoryAdvanced();
        await menu.scheduler.tick();
        expect(menu.written).toEqual([]);
    });

    it("retries the same slot after a failed write instead of consuming it", async () => {
        const { scheduler, written, logs } = harness({ failWrites: 1 });

        scheduler.markStoryAdvanced();
        await scheduler.tick();
        expect(written).toEqual([]);
        expect(logs[0]).toContain("disk is on fire");

        // The flag is still up, so the very next tick retries - into slot 0,
        // which the failure never reached.
        await scheduler.tick();
        expect(written).toEqual([autoSaveSlotId(0)]);
    });

    it("retries the same slot when a scheduled write is cancelled", async () => {
        const attempted: string[] = [];
        const scheduler = new AutoSaveScheduler({
            getConfig: () => ({ ...DEFAULT_AUTO_SAVE_CONFIGURATION, slots: 3 }),
            isPlaying: () => true,
            playthrough: () => 1,
            write: async id => {
                attempted.push(id);
                if (attempted.length === 1) {
                    return false;
                }
            },
            listStored: async () => [],
            log: () => undefined,
        });

        scheduler.markStoryAdvanced();
        await scheduler.tick();
        await scheduler.tick();

        expect(attempted).toEqual([autoSaveSlotId(0), autoSaveSlotId(0)]);
    });

    it("writes on request even when autosaving is off and the story has not moved", async () => {
        const { scheduler, written } = harness({ config: { enabled: false } });

        await scheduler.writeNow();
        expect(written).toEqual([autoSaveSlotId(0)]);
    });

    it("tells the write whether the timer or the author asked for it", async () => {
        const { scheduler, reasons } = harness();

        scheduler.markStoryAdvanced();
        await scheduler.tick();
        await scheduler.writeNow();
        // A timer write may wait for a quiet moment to take its picture; the author's may not.
        expect(reasons).toEqual(["scheduled", "requested"]);
    });

    it("rejects an explicit write when no game is running", async () => {
        const { scheduler } = harness({ playing: false });

        await expect(scheduler.writeNow()).rejects.toThrow("“Auto Save” needs a running game.");
    });

    it("surfaces a failed explicit write to its caller", async () => {
        const { scheduler } = harness({ failWrites: 1 });

        await expect(scheduler.writeNow()).rejects.toThrow("disk is on fire");
    });

    it("drops a tick that lands while a write is in flight", async () => {
        const gate: { release: (() => void) | null } = { release: null };
        const written: string[] = [];
        const scheduler = new AutoSaveScheduler({
            getConfig: () => ({ ...DEFAULT_AUTO_SAVE_CONFIGURATION, slots: 3 }),
            isPlaying: () => true,
            playthrough: () => 1,
            write: async id => {
                await new Promise<void>(resolve => { gate.release = resolve; });
                written.push(id);
            },
            listStored: async () => [],
            log: () => undefined,
        });

        scheduler.markStoryAdvanced();
        const first = scheduler.tick();
        await Promise.resolve();
        await scheduler.tick(); // lands mid-write: must not queue a second save
        gate.release?.();
        await first;

        expect(written).toEqual([autoSaveSlotId(0)]);
    });

    it("does not write a scheduled save after the game ends during ring discovery", async () => {
        let playing = true;
        let finishListing = (_entries: AutoSaveEntry[]) => undefined as void;
        const written: string[] = [];
        const scheduler = new AutoSaveScheduler({
            getConfig: () => DEFAULT_AUTO_SAVE_CONFIGURATION,
            isPlaying: () => playing,
            playthrough: () => 1,
            write: async id => { written.push(id); },
            listStored: () => new Promise(resolve => { finishListing = resolve; }),
            log: () => undefined,
        });
        scheduler.markStoryAdvanced();
        const saving = scheduler.tick();
        playing = false;
        finishListing([]);
        await saving;
        expect(written).toEqual([]);
    });

    it("does not transfer a scheduled save to a new playthrough during ring discovery", async () => {
        let playthrough = 1;
        let finishListing = (_entries: AutoSaveEntry[]) => undefined as void;
        const written: number[] = [];
        const scheduler = new AutoSaveScheduler({
            getConfig: () => DEFAULT_AUTO_SAVE_CONFIGURATION,
            isPlaying: () => true,
            playthrough: () => playthrough,
            write: async () => { written.push(playthrough); },
            listStored: () => new Promise(resolve => { finishListing = resolve; }),
            log: () => undefined,
        });
        scheduler.markStoryAdvanced();
        const saving = scheduler.tick();
        playthrough = 2;
        finishListing([]);
        await saving;
        expect(written).toEqual([]);
        scheduler.markStoryAdvanced();
        await scheduler.tick();
        expect(written).toEqual([2]);
    });

    it("does not move a queued explicit request to a later playthrough", async () => {
        let playthrough = 1;
        let release = () => undefined as void;
        let started = () => undefined as void;
        const firstStarted = new Promise<void>(resolve => { started = resolve; });
        const firstWrite = new Promise<void>(resolve => { release = resolve; });
        const written: number[] = [];
        const scheduler = new AutoSaveScheduler({
            getConfig: () => DEFAULT_AUTO_SAVE_CONFIGURATION,
            isPlaying: () => true,
            playthrough: () => playthrough,
            write: async () => {
                written.push(playthrough);
                started();
                await firstWrite;
            },
            listStored: async () => [],
            log: () => undefined,
        });
        const first = scheduler.writeNow();
        await firstStarted;
        const second = scheduler.writeNow();
        const secondResult = second.then(() => "written", () => "cancelled");
        playthrough = 2;
        release();
        await first;
        expect(await secondResult).toBe("cancelled");
        expect(written).toEqual([1]);
    });

    it("preserves story advances that happen after an in-flight save takes its snapshot", async () => {
        let release = () => undefined as void;
        let started = () => undefined as void;
        const firstStarted = new Promise<void>(resolve => { started = resolve; });
        const firstWrite = new Promise<void>(resolve => { release = resolve; });
        const written: string[] = [];
        const scheduler = new AutoSaveScheduler({
            getConfig: () => ({ ...DEFAULT_AUTO_SAVE_CONFIGURATION, slots: 3 }),
            isPlaying: () => true,
            playthrough: () => 1,
            write: async (id, _reason, captured) => {
                written.push(id);
                captured();
                if (written.length === 1) {
                    started();
                    await firstWrite;
                }
            },
            listStored: async () => [],
            log: () => undefined,
        });

        scheduler.markStoryAdvanced();
        const saving = scheduler.tick();
        await firstStarted;
        scheduler.markStoryAdvanced();
        release();
        await saving;
        await scheduler.tick();

        expect(written).toEqual([autoSaveSlotId(0), autoSaveSlotId(1)]);
    });

    it("does not write the same state again when the story moved before the snapshot", async () => {
        let release = () => undefined as void;
        let started = () => undefined as void;
        const firstStarted = new Promise<void>(resolve => { started = resolve; });
        const waitingForPicture = new Promise<void>(resolve => { release = resolve; });
        const written: string[] = [];
        const scheduler = new AutoSaveScheduler({
            getConfig: () => ({ ...DEFAULT_AUTO_SAVE_CONFIGURATION, slots: 3 }),
            isPlaying: () => true,
            playthrough: () => 1,
            write: async (id, _reason, captured) => {
                written.push(id);
                if (written.length === 1) {
                    started();
                    await waitingForPicture;
                }
                captured();
            },
            listStored: async () => [],
            log: () => undefined,
        });

        scheduler.markStoryAdvanced();
        const saving = scheduler.tick();
        await firstStarted;
        scheduler.markStoryAdvanced();
        release();
        await saving;
        await scheduler.tick();

        expect(written).toEqual([autoSaveSlotId(0)]);
    });

    it("keeps advances captured by an explicit write when that write fails", async () => {
        let release = () => undefined as void;
        let started = () => undefined as void;
        const firstStarted = new Promise<void>(resolve => { started = resolve; });
        const waitingForPicture = new Promise<void>(resolve => { release = resolve; });
        const written: string[] = [];
        const scheduler = new AutoSaveScheduler({
            getConfig: () => ({ ...DEFAULT_AUTO_SAVE_CONFIGURATION, slots: 3 }),
            isPlaying: () => true,
            playthrough: () => 1,
            write: async (id, _reason, captured) => {
                written.push(id);
                if (written.length === 1) {
                    started();
                    await waitingForPicture;
                    captured();
                    throw new Error("disk full");
                }
                captured();
            },
            listStored: async () => [],
            log: () => undefined,
        });

        const saving = scheduler.writeNow();
        await firstStarted;
        scheduler.markStoryAdvanced();
        release();
        await expect(saving).rejects.toThrow("disk full");
        await scheduler.tick();

        expect(written).toEqual([autoSaveSlotId(0), autoSaveSlotId(0)]);
    });

    it("does not overlap a timer write with a waiting explicit save", async () => {
        let releaseFirst = () => undefined as void;
        let releaseSecond = () => undefined as void;
        let started = () => undefined as void;
        const firstStarted = new Promise<void>(resolve => { started = resolve; });
        const firstWrite = new Promise<void>(resolve => { releaseFirst = resolve; });
        const secondWrite = new Promise<void>(resolve => { releaseSecond = resolve; });
        const reasons: AutoSaveWriteReason[] = [];
        let active = 0;
        let maxActive = 0;
        const scheduler = new AutoSaveScheduler({
            getConfig: () => ({ ...DEFAULT_AUTO_SAVE_CONFIGURATION, slots: 3 }),
            isPlaying: () => true,
            playthrough: () => 1,
            write: async (_id, reason, captured) => {
                reasons.push(reason);
                active += 1;
                maxActive = Math.max(active, maxActive);
                captured();
                if (reasons.length === 1) {
                    started();
                    await firstWrite;
                } else if (reasons.length === 2) {
                    await secondWrite;
                }
                active -= 1;
            },
            listStored: async () => [],
            log: () => undefined,
        });

        const first = scheduler.writeNow();
        await firstStarted;
        const waiting = scheduler.writeNow();
        scheduler.markStoryAdvanced();
        releaseFirst();
        await first;
        const tick = scheduler.tick();
        await Promise.resolve();
        await Promise.resolve();
        releaseSecond();
        await Promise.all([waiting, tick]);

        expect(reasons.filter(reason => reason === "requested")).toHaveLength(2);
        expect(maxActive).toBe(1);
    });

    it("serializes simultaneous explicit requests through successive ring slots", async () => {
        let release = () => undefined as void;
        let started = () => undefined as void;
        const firstStarted = new Promise<void>(resolve => { started = resolve; });
        const firstWrite = new Promise<void>(resolve => { release = resolve; });
        const written: string[] = [];
        const scheduler = new AutoSaveScheduler({
            getConfig: () => ({ ...DEFAULT_AUTO_SAVE_CONFIGURATION, slots: 3 }),
            isPlaying: () => true,
            playthrough: () => 1,
            write: async id => {
                written.push(id);
                if (written.length === 1) {
                    started();
                    await firstWrite;
                }
            },
            listStored: async () => [],
            log: () => undefined,
        });

        const first = scheduler.writeNow();
        const second = scheduler.writeNow();
        await firstStarted;
        await Promise.resolve();
        const startedBeforeRelease = [...written];
        release();
        await Promise.all([first, second]);

        expect(startedBeforeRelease).toEqual([autoSaveSlotId(0)]);
        expect(written).toEqual([autoSaveSlotId(0), autoSaveSlotId(1)]);
    });
});
