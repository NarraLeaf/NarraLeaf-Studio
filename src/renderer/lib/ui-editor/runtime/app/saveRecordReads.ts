/**
 * The save store as a save screen reads it: each record once, however many nodes ask.
 *
 * A save screen asks one question per field. The starter's slot reads a save's metadata, its line
 * twice, its times, its playtime and its picture, each through its own node, and each of those went
 * to the store for the whole record - the serialized playthrough and the picture, a few hundred KB
 * carried across the process boundary and parsed again for every field. Nine slots on a page made
 * forty-odd such reads, and the slots sat showing "empty" until the last one came back. MEASURED in
 * a 1920x1080 port with nine filled slots: about 0.9 s from the page appearing to its last picture.
 *
 * So a record read is kept for {@link SAVE_RECORD_REUSE_MS} and every read of the same slot in that
 * time is answered from it, the listing likewise, and the picture is taken off a record already in
 * hand rather than read again. Short on purpose: long enough to cover one screen opening, short
 * enough that a slot changed from outside this game - the Dev Mode saves panel, another window - is
 * read fresh the next time a screen opens. A write or a removal through this game drops what it
 * held for that slot at once, before and after, so a screen refreshed after a save never shows the
 * save it replaced.
 *
 * Loading a save does not come through here: a load reads the record it is about to apply directly
 * from the store.
 *
 * Comments in English per project convention.
 */

import type { GameAppSaveHeader, GameAppSaveRecord, GameAppSaveStore } from "./GameAppHost";

/** How long a record or a listing read for a save screen answers further reads. */
export const SAVE_RECORD_REUSE_MS = 2000;

type Held<T> = { at: number; value: Promise<T> };

export class SaveRecordReads {
    private readonly records = new Map<string, Held<GameAppSaveRecord | null>>();
    private headers: Held<GameAppSaveHeader[]> | null = null;

    constructor(
        private readonly store: Pick<GameAppSaveStore, "read" | "readPreview" | "listHeaders">,
        private readonly now: () => number = () => performance.now(),
        private readonly reuseMs: number = SAVE_RECORD_REUSE_MS,
    ) {}

    /** One slot's record, read once for every node that asks within the reuse window. */
    public read(id: string): Promise<GameAppSaveRecord | null> {
        const held = this.records.get(id);
        if (held && this.fresh(held)) {
            return held.value;
        }
        const entry: Held<GameAppSaveRecord | null> = { at: this.now(), value: this.store.read(id) };
        this.records.set(id, entry);
        // A failed read is not kept: the next node asking tries the store again.
        entry.value.catch(() => {
            if (this.records.get(id) === entry) {
                this.records.delete(id);
            }
        });
        return entry.value;
    }

    /**
     * One slot's picture: off the record when one is already held, which on a save screen it is -
     * the slot read its other fields first - and from the store's own preview read otherwise.
     */
    public async readPreview(id: string): Promise<string | null | undefined> {
        const held = this.records.get(id);
        if (held && this.fresh(held)) {
            try {
                const record = await held.value;
                return record ? record.metadata.capture ?? null : null;
            } catch {
                // Fall through to the store's own read.
            }
        }
        return this.store.readPreview(id);
    }

    /** Every slot's header, listed once for every slot that asks within the reuse window. */
    public listHeaders(): Promise<GameAppSaveHeader[]> {
        if (this.headers && this.fresh(this.headers)) {
            return this.headers.value;
        }
        const entry: Held<GameAppSaveHeader[]> = { at: this.now(), value: this.store.listHeaders() };
        this.headers = entry;
        entry.value.catch(() => {
            if (this.headers === entry) {
                this.headers = null;
            }
        });
        return entry.value;
    }

    /** A slot was written or removed through this game: nothing held for it, or for the listing, stands. */
    public forget(id: string): void {
        this.records.delete(id);
        this.headers = null;
    }

    private fresh(held: Held<unknown>): boolean {
        return this.now() - held.at < this.reuseMs;
    }
}
