/**
 * The autosave engine, kept free of React so it can be driven and asserted
 * directly. {@link useAutoSave} is the thin hook that owns the timer and the
 * play-head subscription; everything that decides *whether* and *where* to
 * write lives here.
 *
 * Two rules shape it:
 *
 * - **Only write what changed.** A timer that serializes the game every N
 *   seconds regardless of what the player did burns a screenshot capture and a
 *   disk write on an idle title-adjacent moment, and fills the ring with N
 *   identical states. The scheduler writes only when the story play head moved
 *   since the last autosave, so an idle game costs nothing no matter how short
 *   the interval is.
 * - **Rotate, never grow.** Writes go round a fixed ring of reserved ids
 *   (see `@shared/types/saves`), oldest first, so autosaving forever costs a
 *   bounded amount of disk.
 *
 * There is deliberately no `dispose`, for the reason `PlaytimeClock` has none either. A scheduler
 * that can be switched off permanently is one an effect cleanup will eventually switch off by
 * accident: `React.StrictMode` - on in every unpackaged build, which is every Dev Mode run - mounts,
 * tears down and remounts, so the throwaway pass's cleanup lands on the instance the surviving mount
 * goes on using. MEASURED: that is why Dev Mode never wrote an autosave at all while a shipped build
 * wrote them correctly, and why `Auto Save` answered "needs a running game" over a stage that was
 * plainly playing. Stopping the timer is the owner's job and `clearInterval` already does it, so
 * nothing here needs a one-way switch; every operation on this class is repeatable.
 */

import {
    autoSaveSlotId,
    type AutoSaveConfiguration,
    type AutoSaveEntry,
} from "@shared/types/saves";
import { needsRunningGame } from "./runtimeRefusals";

export type AutoSaveLogLevel = "info" | "warning" | "error";

/**
 * Why a write happens: the timer found the story moved, or the author asked for one (`Auto Save`).
 * A scheduled write may wait for a quiet moment to take its picture; a requested one does not.
 */
export type AutoSaveWriteReason = "scheduled" | "requested";

export type AutoSaveSchedulerDeps = {
    /** Live configuration; re-read on every tick so a Dev Mode reload takes effect. */
    getConfig: () => AutoSaveConfiguration;
    /** True while a playthrough is running and can be serialized. */
    isPlaying: () => boolean;
    /** Changes whenever a new playthrough is entered or a save is loaded. */
    playthrough: () => number;
    /** Call `captured` when the snapshot is taken; false means nothing reached the store. */
    write: (id: string, reason: AutoSaveWriteReason, captured: () => void, isCurrent: () => boolean) => Promise<void | false>;
    /** Every reserved autosave currently stored, in any order. */
    listStored: () => Promise<AutoSaveEntry[]>;
    log: (level: AutoSaveLogLevel, message: string) => void;
};

export class AutoSaveScheduler {
    /** Story movement not yet included in the current snapshot or last successful save. */
    private storyAdvanced = false;
    /** Next ring slot to overwrite, or null until resolved from what is stored. */
    private cursor: number | null = null;
    private inFlight: Promise<void> | null = null;

    constructor(private readonly deps: AutoSaveSchedulerDeps) {}

    /**
     * The story play head moved. Cheap and called often (once per action), so it
     * does nothing but raise the flag the next tick reads.
     */
    public markStoryAdvanced(): void {
        this.storyAdvanced = true;
    }

    /**
     * One timer tick. Silently does nothing unless autosaving is on, a game is
     * running, the story moved since the last write, and no write is already
     * in flight - a tick that lands mid-write is dropped rather than queued,
     * because the queued one would only save a moment that already passed.
     */
    public async tick(): Promise<void> {
        if (this.inFlight || !this.storyAdvanced) {
            return;
        }
        if (!this.deps.getConfig().enabled || !this.deps.isPlaying()) {
            return;
        }
        await this.runWrite({ reason: "scheduled", playthrough: this.deps.playthrough() });
    }

    /**
     * Write an autosave now, on the author's explicit request (the `Auto Save`
     * blueprint node). Ignores both the enabled flag and the play-head gate -
     * the author asked for this one - but still rotates the same ring, so an
     * authored autosave and a scheduled one are indistinguishable afterwards.
     *
     * Rejects when no game is running, matching every other save node.
     */
    public async writeNow(): Promise<void> {
        if (!this.deps.isPlaying()) {
            throw needsRunningGame("blueprint.node.autoSave");
        }
        const playthrough = this.deps.playthrough();
        // Each request waits for earlier writes before choosing its ring slot.
        while (this.inFlight) {
            await this.inFlight;
        }
        if (!this.deps.isPlaying() || this.deps.playthrough() !== playthrough) {
            throw autoSaveSuperseded();
        }
        await this.runWrite({ reason: "requested", rethrow: true, playthrough });
    }

    private async runWrite(options: { reason: AutoSaveWriteReason; playthrough: number; rethrow?: boolean }): Promise<void> {
        const config = this.deps.getConfig();
        const isCurrent = () => this.deps.isPlaying() && this.deps.playthrough() === options.playthrough;
        const task = (async () => {
            const slot = (await this.resolveCursor(config)) % config.slots;
            if (!isCurrent()) {
                if (options.rethrow) throw autoSaveSuperseded();
                return;
            }
            let capturedAdvance = this.storyAdvanced;
            this.storyAdvanced = false;
            const captured = () => {
                capturedAdvance ||= this.storyAdvanced;
                this.storyAdvanced = false;
            };
            try {
                const written = await this.deps.write(autoSaveSlotId(slot), options.reason, captured, isCurrent);
                if (written === false) {
                    this.storyAdvanced ||= capturedAdvance;
                    if (options.rethrow) throw autoSaveSuperseded();
                    return;
                }
            } catch (error) {
                this.storyAdvanced ||= capturedAdvance;
                throw error;
            }
            // Only on success: a failed write must not consume the slot it never
            // reached, and must leave the flag up so the next tick retries.
            this.cursor = slot + 1;
        })();
        this.inFlight = task.then(() => undefined, () => undefined);
        try {
            await task;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.deps.log("warning", `Auto save failed: ${message}`);
            if (options.rethrow) {
                throw error;
            }
        } finally {
            this.inFlight = null;
        }
    }

    /**
     * Where the ring resumes. Resolved once, from what is actually stored, so a
     * relaunch continues the rotation instead of restarting at slot 0 and
     * clobbering the newest autosave the player has.
     *
     * An empty slot wins over any written one; otherwise the oldest goes first.
     * Slots left behind by a larger ring (the author lowered the count) are
     * ignored here - they are still listed, just never overwritten again.
     */
    private async resolveCursor(config: AutoSaveConfiguration): Promise<number> {
        if (this.cursor !== null) {
            return this.cursor;
        }
        let stored: AutoSaveEntry[];
        try {
            stored = await this.deps.listStored();
        } catch {
            // Unreadable store: start at the top rather than refusing to save.
            this.cursor = 0;
            return 0;
        }
        const timestampBySlot = new Map<number, number>();
        for (const entry of stored) {
            if (entry.slot >= 0 && entry.slot < config.slots) {
                timestampBySlot.set(entry.slot, entry.timestamp);
            }
        }
        let target = 0;
        let oldest = Number.POSITIVE_INFINITY;
        for (let slot = 0; slot < config.slots; slot += 1) {
            const timestamp = timestampBySlot.get(slot);
            if (timestamp === undefined) {
                target = slot;
                oldest = Number.NEGATIVE_INFINITY;
                break;
            }
            if (timestamp < oldest) {
                target = slot;
                oldest = timestamp;
            }
        }
        this.cursor = target;
        return target;
    }
}

export function autoSaveSuperseded(): Error {
    return new Error("Auto save was cancelled because the playthrough changed.");
}
