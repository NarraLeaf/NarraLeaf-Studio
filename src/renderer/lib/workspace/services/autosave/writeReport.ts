import type { TranslationKey } from "@shared/i18n";

/**
 * What the author knows a written file as, for the notice that says it could not be saved.
 *
 * Never the file's own name. The last segment of an asset's content path is the tail of the asset's
 * id, a story document is `storydoc.json` inside a folder named after the story's id, and the rest
 * are names Studio chose (`uidoc.json`, `assets.groups.image.json`) that an author never sees
 * anywhere else. The writer knows what it is writing; the path it writes to does not say.
 */
export type SavedFileName =
    /**
     * One of the project's stores, by the label the save surfaces already use for it - "project
     * settings", "asset library" (`workspace.shell.save.stores.*`).
     */
    | { store: TranslationKey }
    /** Something the author named: an asset, a story, a motion. Shown in quotes. */
    | { item: string };

/**
 * What becomes of a write that fails, which is what decides what the author is told about it.
 *
 * - `retried`: an auto-saver still owes the file and keeps trying on its backoff (`DebouncedSaver`).
 *   The notice says so and offers "Retry now", and the status bar says a save is owed.
 * - `notRetried`: nothing tries the write again and nothing else tells the author. The notice says
 *   the change was not saved, and offers no retry, because there is nothing for one to replay.
 * - `handledByWriter`: the code that wrote the file deals with the failure itself. Either the
 *   surface that made the change is waiting on the answer and says what happened (a project
 *   setting, an export, the text editor's save), or losing the write costs the author nothing worth
 *   telling them (a cache Studio rebuilds, the scratch copy a media probe reads). One console line.
 */
export type WriteFailureFollowUp = "retried" | "notRetried" | "handledByWriter";

/** Carried with a write to the save-status surface, which is the one place a failed write is reported. */
export type FsWriteReport = {
    name: SavedFileName;
    afterFailure: WriteFailureFollowUp;
};

/** A write to one of the project's stores. */
export function storeWrite(store: TranslationKey, afterFailure: WriteFailureFollowUp): FsWriteReport {
    return { name: { store }, afterFailure };
}

/**
 * A write to something the author named, falling back to its store when the name is blank - an
 * asset or a story can exist before anybody has typed a name for it, and an empty pair of quotes
 * names nothing.
 */
export function itemWrite(
    item: string | null | undefined,
    store: TranslationKey,
    afterFailure: WriteFailureFollowUp,
): FsWriteReport {
    const name = item?.trim();
    return { name: name ? { item: name } : { store }, afterFailure };
}
