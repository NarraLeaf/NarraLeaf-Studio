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
 */

import {
  autoSaveSlotId,
  type AutoSaveConfiguration,
  type AutoSaveEntry
} from "@shared/types/saves";

export type AutoSaveLogLevel = "info" | "warning" | "error";

export type AutoSaveSchedulerDeps = {
  /** Live configuration; re-read on every tick so a Dev Mode reload takes effect. */
  getConfig: () => AutoSaveConfiguration;
  /** True while a playthrough is running and can be serialized. */
  isPlaying: () => boolean;
  /** Write one autosave into the given reserved id. */
  write: (id: string) => Promise<void>;
  /** Every reserved autosave currently stored, in any order. */
  listStored: () => Promise<AutoSaveEntry[]>;
  log: (level: AutoSaveLogLevel, message: string) => void;
};

export class AutoSaveScheduler {
  /** Set when the story advanced; cleared by a successful write. */
  private storyAdvanced = false;
  /** Next ring slot to overwrite, or null until resolved from what is stored. */
  private cursor: number | null = null;
  private inFlight: Promise<void> | null = null;
  private disposed = false;

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
    if (this.disposed || this.inFlight || !this.storyAdvanced) {
      return;
    }
    if (!this.deps.getConfig().enabled || !this.deps.isPlaying()) {
      return;
    }
    await this.runWrite();
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
    if (this.disposed) {
      throw new Error("Auto Save: the game app is gone");
    }
    // Let an in-flight scheduled write finish first rather than racing it
    // into the same slot; its failure is not this caller's problem.
    await this.inFlight?.catch(() => undefined);
    if (!this.deps.isPlaying()) {
      throw new Error("Auto Save: no game is running");
    }
    await this.runWrite({ rethrow: true });
  }

  public dispose(): void {
    this.disposed = true;
  }

  private async runWrite(options?: { rethrow?: boolean }): Promise<void> {
    const config = this.deps.getConfig();
    const task = (async () => {
      const slot = (await this.resolveCursor(config)) % config.slots;
      await this.deps.write(autoSaveSlotId(slot));
      // Only on success: a failed write must not consume the slot it never
      // reached, and must leave the flag up so the next tick retries.
      this.cursor = slot + 1;
      this.storyAdvanced = false;
    })();
    this.inFlight = task.then(
      () => undefined,
      () => undefined
    );
    try {
      await task;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.log("warning", `Auto save failed: ${message}`);
      if (options?.rethrow) {
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
