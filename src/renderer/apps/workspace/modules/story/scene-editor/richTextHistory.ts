import type { StoryRichRun } from "@shared/types/story";

/**
 * Undo history for one rich-text row, at the runs level.
 *
 * The row cannot use Chromium's native contentEditable undo stack: `renderRunsToElement` clears the
 * root (`root.textContent = ""`) on every rich-text operation, which destroys that stack. And it
 * cannot use story history either - `KeybindingService` suppresses `Mod+Z` inside editable fields on
 * purpose, because story undo works in whole blocks and would throw away the paragraph being typed
 * instead of the last keystroke. So the row owns its own stack, in the one model that survives a
 * re-render: the runs.
 *
 * Pure by construction - no DOM, no time source of its own. The caller snapshots and passes `now`.
 */

export type RichTextSelection = { start: number; end: number };

/** A point-in-time state of one row. `range` restores the caret, so undo puts it back where the edit happened. */
export type RichTextSnapshot = { runs: StoryRichRun[]; range: RichTextSelection | null };

export type RichTextEditKind = "typing" | "deleting" | "structural";

export type RichTextRecordOptions = {
    kind: RichTextEditKind;
    /** A word boundary (a typed space). Closes the current coalescing group so undo steps by word. */
    boundary?: boolean;
    now: number;
};

/** Same-kind edits less than this far apart coalesce into one entry, so undo steps by burst, not by keystroke. */
export const RICH_TEXT_COALESCE_IDLE_MS = 600;

const DEFAULT_LIMIT = 200;

export class RichTextHistory {
    private entries: RichTextSnapshot[] = [];
    private redoEntries: RichTextSnapshot[] = [];
    private lastKind: RichTextEditKind | null = null;
    private lastAt = 0;

    constructor(private readonly limit: number = DEFAULT_LIMIT) {}

    get canUndo(): boolean {
        return this.entries.length > 0;
    }

    get canRedo(): boolean {
        return this.redoEntries.length > 0;
    }

    /** Entries currently on the undo stack. Exposed for tests and assertions, not for mutation. */
    get depth(): number {
        return this.entries.length;
    }

    /**
     * Record the state *before* an edit. Call it on the way in - `beforeinput` for typing, and ahead of
     * any programmatic mutation.
     *
     * Coalescing keeps a burst of typing as one entry: an edit joins the previous group when it is the
     * same kind, lands within {@link RICH_TEXT_COALESCE_IDLE_MS} of the last one, and is not a word
     * boundary. `structural` edits (a pause chip, a mark, an inserted value) never coalesce - each is
     * one deliberate act and undoes on its own.
     *
     * Takes ownership of `before`: pass a fresh snapshot, never a live reference.
     */
    record(before: RichTextSnapshot, options: RichTextRecordOptions): void {
        this.redoEntries = [];
        const contiguous =
            this.entries.length > 0 &&
            this.lastKind === options.kind &&
            options.kind !== "structural" &&
            !options.boundary &&
            options.now - this.lastAt < RICH_TEXT_COALESCE_IDLE_MS;
        if (!contiguous) {
            this.entries.push(before);
            if (this.entries.length > this.limit) {
                this.entries.shift();
            }
        }
        this.lastKind = options.kind;
        this.lastAt = options.now;
    }

    /** The state to restore, or null when this row has nothing left - the caller then falls through to story history. */
    undo(current: RichTextSnapshot): RichTextSnapshot | null {
        const previous = this.entries.pop();
        if (!previous) {
            return null;
        }
        this.redoEntries.push(current);
        // An undo ends whatever burst was open: the next keystroke starts a new entry rather than
        // merging into the group we just stepped out of.
        this.lastKind = null;
        return previous;
    }

    redo(current: RichTextSnapshot): RichTextSnapshot | null {
        const next = this.redoEntries.pop();
        if (!next) {
            return null;
        }
        this.entries.push(current);
        this.lastKind = null;
        return next;
    }
}

/** Map a `beforeinput` inputType to the coalescing group it belongs to. */
export function editKindForInputType(inputType: string): RichTextEditKind {
    if (inputType.startsWith("insert")) {
        return inputType === "insertText" || inputType === "insertCompositionText" ? "typing" : "structural";
    }
    if (inputType.startsWith("delete")) {
        return "deleting";
    }
    return "structural";
}
