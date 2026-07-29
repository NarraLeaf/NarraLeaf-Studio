import { describe, expect, it } from "vitest";
import {
    DEFAULT_AUTO_SAVE_CONFIGURATION,
    autoSaveSlotId,
    type AutoSaveConfiguration,
    type AutoSaveEntry,
} from "@shared/types/saves";
import { AutoSaveScheduler } from "./autoSaveScheduler";

function entry(slot: number, timestamp: number): AutoSaveEntry {
    return { id: autoSaveSlotId(slot), slot, timestamp, createdAt: timestamp, metadata: null };
}

function harness(overrides?: {
    config?: Partial<AutoSaveConfiguration>;
    playing?: boolean;
    stored?: AutoSaveEntry[];
    failWrites?: number;
}) {
    const written: string[] = [];
    const logs: string[] = [];
    let remainingFailures = overrides?.failWrites ?? 0;
    const state = {
        config: { ...DEFAULT_AUTO_SAVE_CONFIGURATION, ...overrides?.config },
        playing: overrides?.playing ?? true,
    };
    const scheduler = new AutoSaveScheduler({
        getConfig: () => state.config,
        isPlaying: () => state.playing,
        write: async id => {
            if (remainingFailures > 0) {
                remainingFailures -= 1;
                throw new Error("disk is on fire");
            }
            written.push(id);
        },
        listStored: async () => overrides?.stored ?? [],
        log: (_level, message) => logs.push(message),
    });
    return { scheduler, written, logs, state };
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

    it("writes on request even when autosaving is off and the story has not moved", async () => {
        const { scheduler, written } = harness({ config: { enabled: false } });

        await scheduler.writeNow();
        expect(written).toEqual([autoSaveSlotId(0)]);
    });

    it("rejects an explicit write when no game is running", async () => {
        const { scheduler } = harness({ playing: false });

        await expect(scheduler.writeNow()).rejects.toThrow("no game is running");
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
});
