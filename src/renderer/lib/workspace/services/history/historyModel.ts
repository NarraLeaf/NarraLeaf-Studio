import type { TranslationKey } from "@shared/i18n";

/**
 * The one undo entry shape the whole workspace uses, and the stack that holds them.
 *
 * Before this module every editor grew its own undo: two `useRef` stacks in the story scene
 * controller, two more in the story motion tab, a `{past, present, future}` reducer in the audio
 * preview, a private `Map<surfaceId, {undo, redo}>` in `UIEditorHistoryService`, another in
 * `LocalBlueprintService`. Five implementations of the same data structure, five limits, five
 * definitions of "these two edits merge", and - the part that actually hurt - no way for anything
 * outside an editor to put a step onto a stack. `storySceneUndoBridge` exists only because a script
 * import had to reach into a mounted tab's refs to leave a checkpoint behind.
 *
 * Nothing here knows about services, React or documents on purpose: it is a data structure with
 * tests, and {@link HistoryService} is the part that knows what a snapshot means.
 */

/** Deferred translation of what an entry did, so a menu can say "Undo delete character". */
export type HistoryLabel = {
    key: TranslationKey;
    params?: Record<string, string | number>;
};

/**
 * Which stack an entry belongs to. Built by `historyScopes.ts` rather than spelled out at call
 * sites - a scope id is a key into a Map, and a typo produces a second, silently empty stack.
 */
export type HistoryScopeId = string;

/** Boxed so that `undefined` is a legitimate snapshot value and not "nothing captured yet". */
export type HistorySnapshotBox = { value: unknown };

export type HistoryEntryBody =
    /**
     * The state *before* an edit, captured on the way in. The state after is whatever is live when
     * undo runs, so the entry is complete from one call at the mutation site - the shape every
     * `recordHistory()` call site in the editors already had.
     */
    | { kind: "checkpoint"; before: HistorySnapshotBox; after: HistorySnapshotBox | null }
    /** Both sides known at push time - the shape `UIEditorHistoryService` and blueprints record. */
    | { kind: "snapshot"; before: HistorySnapshotBox; after: HistorySnapshotBox }
    /**
     * Neither side is a snapshot: the entry carries its own inverse. What an operation with effects
     * outside one document needs (deleting an asset moves a file; putting it back moves it back).
     */
    | { kind: "command"; undo: () => void | Promise<void>; redo: () => void | Promise<void> };

export type HistoryEntry = {
    readonly id: string;
    readonly scopeId: HistoryScopeId;
    label: HistoryLabel;
    /** Same key within {@link HistoryPushOptions.mergeWindowMs} folds into the previous entry. */
    mergeKey?: string;
    createdAt: number;
    updatedAt: number;
    body: HistoryEntryBody;
    /**
     * Called once when this entry leaves the stack for good - trimmed past the depth limit,
     * cleared, or dropped because a new edit invalidated the redo branch.
     *
     * For entries that own something outside memory. Deleting an asset moves its bytes to a trash
     * directory instead of unlinking them, and this is what says "that copy is now unreachable, let
     * it go" — without it the trash would grow for the life of the session and a discarded entry
     * would leave a payload nothing can ever restore.
     *
     * Must not throw and must be safe to call after the state it refers to is gone; the stack calls
     * it while unwinding and has nowhere to report a failure.
     */
    dispose?: () => void;
};

export type HistoryPushOptions = {
    now: number;
    mergeWindowMs?: number;
};

/** Undo depth per scope. Snapshots are whole documents, so this is a memory bound, not a taste one. */
export const DEFAULT_HISTORY_LIMIT = 100;
/** How long two same-key edits stay mergeable. A drag emits one per frame; a retype does not. */
export const DEFAULT_MERGE_WINDOW_MS = 800;

let entrySequence = 0;

/** Ids are for equality and debugging only - never persisted, so a counter is enough. */
export function nextHistoryEntryId(): string {
    entrySequence += 1;
    return `h${entrySequence}`;
}

export function createCheckpointEntry(input: {
    scopeId: HistoryScopeId;
    label: HistoryLabel;
    before: unknown;
    mergeKey?: string;
    now: number;
}): HistoryEntry {
    return {
        id: nextHistoryEntryId(),
        scopeId: input.scopeId,
        label: input.label,
        mergeKey: input.mergeKey,
        createdAt: input.now,
        updatedAt: input.now,
        body: { kind: "checkpoint", before: { value: input.before }, after: null },
    };
}

export function createSnapshotEntry(input: {
    scopeId: HistoryScopeId;
    label: HistoryLabel;
    before: unknown;
    after: unknown;
    mergeKey?: string;
    now: number;
}): HistoryEntry {
    return {
        id: nextHistoryEntryId(),
        scopeId: input.scopeId,
        label: input.label,
        mergeKey: input.mergeKey,
        createdAt: input.now,
        updatedAt: input.now,
        body: { kind: "snapshot", before: { value: input.before }, after: { value: input.after } },
    };
}

export function createCommandEntry(input: {
    scopeId: HistoryScopeId;
    label: HistoryLabel;
    undo: () => void | Promise<void>;
    redo: () => void | Promise<void>;
    mergeKey?: string;
    now: number;
    dispose?: () => void;
}): HistoryEntry {
    return {
        id: nextHistoryEntryId(),
        scopeId: input.scopeId,
        label: input.label,
        mergeKey: input.mergeKey,
        createdAt: input.now,
        updatedAt: input.now,
        body: { kind: "command", undo: input.undo, redo: input.redo },
        dispose: input.dispose,
    };
}

/** Run an entry's disposer, swallowing anything it throws - see {@link HistoryEntry.dispose}. */
function disposeEntry(entry: HistoryEntry): void {
    try {
        entry.dispose?.();
    } catch (error) {
        console.warn("[History] an entry's disposer threw", error);
    }
}

/**
 * Fold `incoming` into `previous`, or say it cannot be done.
 *
 * The two kinds merge in opposite directions and both are right:
 *
 *  - two checkpoints: keep the *older* `before` and throw the newer one away. The pair describes one
 *    continuous gesture, and the state to return to is the one it started from.
 *  - two snapshots: keep the older `before` and take the newer `after` - same result, stated the
 *    other way round because a snapshot entry carries its end state.
 *
 * Anything else (a command, or the two kinds mixed) does not merge. A command's inverse is not
 * composable in general, and pretending otherwise loses half a gesture.
 */
export function mergeHistoryEntries(previous: HistoryEntry, incoming: HistoryEntry): boolean {
    if (previous.body.kind === "checkpoint" && incoming.body.kind === "checkpoint") {
        // The stack moved on, so any `after` recorded by an earlier undo of this entry is stale.
        previous.body.after = null;
        previous.updatedAt = incoming.updatedAt;
        previous.label = incoming.label;
        return true;
    }
    if (previous.body.kind === "snapshot" && incoming.body.kind === "snapshot") {
        previous.body.after = incoming.body.after;
        previous.updatedAt = incoming.updatedAt;
        previous.label = incoming.label;
        return true;
    }
    return false;
}

/**
 * One scope's undo and redo stacks.
 *
 * Deliberately dumb: it holds entries, enforces the depth limit and decides when two entries merge.
 * It never runs an entry - {@link HistoryService} does, because running one can be asynchronous and
 * can fail, and a data structure that half-applies an edit is worse than none.
 */
export class HistoryStack {
    private undoEntries: HistoryEntry[] = [];
    private redoEntries: HistoryEntry[] = [];
    private limit: number;
    /**
     * Set when something states that the next edit begins a new step even if it would otherwise
     * merge - a typed space between two words, a tool change between two drags. Cleared by the next
     * push, so it is a one-shot barrier rather than a mode.
     */
    private mergeBarrier = false;

    constructor(limit: number = DEFAULT_HISTORY_LIMIT) {
        this.limit = Math.max(1, Math.floor(limit));
    }

    public getLimit(): number {
        return this.limit;
    }

    public setLimit(limit: number): void {
        const next = Math.max(1, Math.floor(limit));
        if (!Number.isFinite(next) || next === this.limit) {
            return;
        }
        this.limit = next;
        this.trim();
    }

    public get undoDepth(): number {
        return this.undoEntries.length;
    }

    public get redoDepth(): number {
        return this.redoEntries.length;
    }

    public canUndo(): boolean {
        return this.undoEntries.length > 0;
    }

    public canRedo(): boolean {
        return this.redoEntries.length > 0;
    }

    public peekUndo(): HistoryEntry | null {
        return this.undoEntries[this.undoEntries.length - 1] ?? null;
    }

    public peekRedo(): HistoryEntry | null {
        return this.redoEntries[this.redoEntries.length - 1] ?? null;
    }

    /** End the current merge group, so the next push starts a fresh entry. */
    public breakMerge(): void {
        this.mergeBarrier = true;
    }

    /**
     * Add an entry, merging it into the previous one when both ask for it.
     *
     * Any push clears the redo stack: the author has taken a different branch, and keeping the old
     * one around means a later Ctrl+Shift+Z reapplies an edit to a document it no longer fits.
     */
    public push(entry: HistoryEntry, options: HistoryPushOptions): "pushed" | "merged" {
        const previous = this.peekUndo();
        const window = options.mergeWindowMs ?? DEFAULT_MERGE_WINDOW_MS;
        const mergeable =
            !this.mergeBarrier &&
            !!entry.mergeKey &&
            previous?.mergeKey === entry.mergeKey &&
            options.now - previous.updatedAt <= window;
        this.mergeBarrier = false;

        if (mergeable && previous && mergeHistoryEntries(previous, entry)) {
            this.dropRedoBranch();
            return "merged";
        }

        this.undoEntries.push(entry);
        this.trim();
        this.dropRedoBranch();
        return "pushed";
    }

    /** Take the top undo entry off. The caller runs it and then calls {@link acceptUndo} or {@link restoreUndo}. */
    public takeUndo(): HistoryEntry | null {
        return this.undoEntries.pop() ?? null;
    }

    public takeRedo(): HistoryEntry | null {
        return this.redoEntries.pop() ?? null;
    }

    /** The entry ran: it is now redoable. */
    public acceptUndo(entry: HistoryEntry): void {
        this.redoEntries.push(entry);
        this.mergeBarrier = true;
    }

    /** The entry ran: it is undoable again. */
    public acceptRedo(entry: HistoryEntry): void {
        this.undoEntries.push(entry);
        this.mergeBarrier = true;
    }

    /** The entry did not run - put it back where it was, unchanged. */
    public restoreUndo(entry: HistoryEntry): void {
        this.undoEntries.push(entry);
    }

    public restoreRedo(entry: HistoryEntry): void {
        this.redoEntries.push(entry);
    }

    public clear(): void {
        [...this.undoEntries, ...this.redoEntries].forEach(disposeEntry);
        this.undoEntries = [];
        this.redoEntries = [];
        this.mergeBarrier = false;
    }

    /**
     * The author took a different branch, so the redo side describes a document that no longer
     * exists. Those entries are unreachable from here on, which is exactly when their disposers run.
     */
    private dropRedoBranch(): void {
        const dropped = this.redoEntries;
        this.redoEntries = [];
        dropped.forEach(disposeEntry);
    }

    /** Entries oldest-first. For tests and diagnostics; callers must not mutate them. */
    public listUndo(): readonly HistoryEntry[] {
        return this.undoEntries;
    }

    public listRedo(): readonly HistoryEntry[] {
        return this.redoEntries;
    }

    private trim(): void {
        if (this.undoEntries.length <= this.limit) {
            return;
        }
        this.undoEntries.splice(0, this.undoEntries.length - this.limit).forEach(disposeEntry);
    }
}
