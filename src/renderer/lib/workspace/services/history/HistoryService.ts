import { getProjectWriteFreeze } from "@/lib/app/writeFreeze";
import { EventEmitter } from "../ui/EventEmitter";
import { Service } from "../Service";
import type { IHistoryService, WorkspaceContext } from "../services";
import {
  createCheckpointEntry,
  createCommandEntry,
  createSnapshotEntry,
  DEFAULT_HISTORY_LIMIT,
  HistoryStack,
  type HistoryEntry,
  type HistoryLabel,
  type HistoryScopeId
} from "./historyModel";

/**
 * The workspace's undo stacks, all of them.
 *
 * Owning them centrally buys three things the five private implementations could not:
 *
 *  - **an entry can come from anywhere.** A script import, a sidebar command, a plugin - none of
 *    them are inside the editor that owns the document, and none of them could previously leave an
 *    undo step behind (`storySceneUndoBridge` is the workaround, and this service replaces it).
 *  - **an entry says what it was.** Every entry carries a {@link HistoryLabel}, so a menu item can
 *    read "Undo delete character" instead of a bare "Undo" that may or may not do anything.
 *  - **one place knows every stack.** Reloading the working tree from disk (VCS restore, external
 *    edit) has to throw away every pre-reload snapshot, and "every" used to mean "the two the
 *    reload service happened to import".
 *
 * # Scopes
 *
 * A scope is one undo stack plus the pair of functions that read and write the state it undoes.
 * Whoever owns that state registers it; entries reference the scope **by id** and resolve those
 * functions when they run, not when they were pushed. That is what lets a stack outlive the editor
 * that made it: close a scene tab and reopen it, and Ctrl+Z still works, because the new tab
 * registers the same scope id over the stack that was already there.
 *
 * The reverse case is handled honestly rather than defensively: undo against a scope with no live
 * registration returns `false` and leaves the stack untouched. Inventing a way to apply the
 * snapshot would mean writing a document nothing is showing.
 *
 * # Freeze
 *
 * Undo is a write. While the workspace is frozen (browsing a past revision, quarantined document)
 * it is refused here, not only in the editors that remembered to wrap their handler - the refusal
 * belongs next to the stack, or the next editor to grow undo will be the one that forgets.
 */

/** What a scope's snapshots mean. Supplied by whoever owns the state the scope undoes. */
export interface HistoryScope<S = any> {
  id: HistoryScopeId;
  /** What this stack is, for surfaces that name it ("Undo in <scene>"). */
  label: HistoryLabel;
  /** The state as it stands, or null when it cannot be read right now (document not loaded). */
  capture: () => S | null;
  /** Put the state back. Must not itself record history - the service suppresses that anyway. */
  apply: (snapshot: S) => void;
  /** Overrides {@link DEFAULT_HISTORY_LIMIT} for this scope only. */
  limit?: number;
}

export type HistoryPushRequest = {
  label: HistoryLabel;
  mergeKey?: string;
  mergeWindowMs?: number;
};

export type HistoryCheckpointRequest = HistoryPushRequest & {
  /**
   * The state to return to, when the caller already holds it and `capture` would be too late.
   *
   * For editors that notice an edit *after* it landed by diffing the document against the copy
   * they were holding (the story motion timeline works this way). Without it such a caller would
   * checkpoint the state it is trying to undo.
   */
  before?: unknown;
};

/**
 * Whether an edit changed anything, and therefore whether it is worth an undo step.
 *
 * The default compares serializations rather than references because every scope's `capture`
 * returns a fresh clone - identity would call every no-op a change, and the author would then need
 * two Ctrl+Z to get anywhere. Scopes with a cheaper answer pass their own `equals`.
 */
function historySnapshotsEqual<S>(a: S, b: S, equals?: (a: S, b: S) => boolean): boolean {
  if (a === b) {
    return true;
  }
  if (equals) {
    return equals(a, b);
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

export type HistoryEvents = {
  /** A stack changed: pushed, merged, undone, redone or cleared. */
  changed: { scopeId: HistoryScopeId };
  /** The scope that a bare Ctrl+Z would act on changed. */
  activeScopeChanged: { scopeId: HistoryScopeId | null };
};

/**
 * How many stacks are kept for scopes nobody has registered any more.
 *
 * Not zero, because "close the tab and reopen it" must not lose the history - that is half the
 * point of holding stacks here. Not unbounded, because a scene snapshot is a whole scene and an
 * author who has opened forty scenes in a session should not be carrying forty times a hundred of
 * them. Least-recently-touched goes first.
 */
const RETAINED_INACTIVE_SCOPES = 8;

export class HistoryService extends Service<HistoryService> implements IHistoryService {
  private readonly scopes = new Map<HistoryScopeId, HistoryScope>();
  private readonly stacks = new Map<HistoryScopeId, HistoryStack>();
  /** Touch order for the retention cap; most recently used last. */
  private readonly touchOrder: HistoryScopeId[] = [];
  private readonly events = new EventEmitter<HistoryEvents>();
  private activeScopeId: HistoryScopeId | null = null;
  private defaultLimit = DEFAULT_HISTORY_LIMIT;
  /**
   * Non-zero while an entry is being applied. Edits made by `apply` must not record history of
   * their own, or one undo would push a fresh entry and the stack would never drain.
   */
  private suppressionDepth = 0;
  /** An asynchronous entry still running. A second undo while one is in flight is refused. */
  private pending: Promise<void> | null = null;

  protected init(_ctx: WorkspaceContext): void {}

  // === Scopes =============================================================

  /**
   * Publish a scope's readers. Returns the disposer; disposing drops the readers but **keeps the
   * stack** so a remounted editor picks its history back up - use {@link clearScope} to discard.
   */
  public registerScope<S>(scope: HistoryScope<S>): () => void {
    this.scopes.set(scope.id, scope as HistoryScope);
    const stack = this.ensureStack(scope.id);
    if (scope.limit !== undefined) {
      stack.setLimit(scope.limit);
    }
    this.touch(scope.id);
    return () => {
      if (this.scopes.get(scope.id) === (scope as HistoryScope)) {
        this.scopes.delete(scope.id);
        this.evictInactive();
      }
    };
  }

  public getScope(scopeId: HistoryScopeId): HistoryScope | undefined {
    return this.scopes.get(scopeId);
  }

  public hasScope(scopeId: HistoryScopeId): boolean {
    return this.scopes.has(scopeId);
  }

  /**
   * Say which stack a scope-less undo command acts on. Editors set this when they take focus.
   * Passing a scope that is not registered is allowed - it becomes active when it registers.
   */
  public setActiveScope(scopeId: HistoryScopeId | null): void {
    if (this.activeScopeId === scopeId) {
      return;
    }
    this.activeScopeId = scopeId;
    if (scopeId) {
      this.touch(scopeId);
    }
    this.events.emit("activeScopeChanged", { scopeId });
  }

  public getActiveScopeId(): HistoryScopeId | null {
    return this.activeScopeId;
  }

  // === Recording ==========================================================

  /**
   * Record the state as it is *now*, immediately before mutating it.
   *
   * The one-line form every editor already used (`recordHistory()` and friends): the entry's
   * "after" is whatever is live when undo runs, so nothing has to be captured a second time and
   * un-recorded edits in between are not silently dropped from the redo side.
   *
   * Returns false when there is nothing to record - no scope, or its `capture` says the document
   * is not readable yet.
   */
  public checkpoint(scopeId: HistoryScopeId, request: HistoryCheckpointRequest): boolean {
    if (this.suppressionDepth > 0) {
      return false;
    }
    const scope = this.scopes.get(scopeId);
    if (!scope) {
      return false;
    }
    const before = request.before !== undefined ? request.before : scope.capture();
    if (before === null) {
      return false;
    }
    return this.pushEntry(
      createCheckpointEntry({
        scopeId,
        label: request.label,
        before,
        mergeKey: request.mergeKey,
        now: Date.now()
      }),
      request
    );
  }

  /** Record an edit whose end state is already known. Skipped when the two sides are equal. */
  public pushSnapshot<S>(
    scopeId: HistoryScopeId,
    request: HistoryPushRequest & { before: S; after: S; equals?: (a: S, b: S) => boolean }
  ): boolean {
    if (this.suppressionDepth > 0) {
      return false;
    }
    if (historySnapshotsEqual(request.before, request.after, request.equals)) {
      return false;
    }
    return this.pushEntry(
      createSnapshotEntry({
        scopeId,
        label: request.label,
        before: request.before,
        after: request.after,
        mergeKey: request.mergeKey,
        now: Date.now()
      }),
      request
    );
  }

  /**
   * Record an operation that carries its own inverse.
   *
   * For edits whose effect is not a snapshot of one document - a deletion that also moved files,
   * a rename that touched three stores. The pair must be genuinely inverse and must not record
   * history of their own; the service suppresses recording while they run, so a `redo` built out
   * of the same service calls the author used is safe.
   */
  public pushCommand(
    scopeId: HistoryScopeId,
    request: HistoryPushRequest & {
      undo: () => void | Promise<void>;
      redo: () => void | Promise<void>;
      /** Reclaim anything the entry held once it can never run again; see `HistoryEntry.dispose`. */
      dispose?: () => void;
    }
  ): boolean {
    if (this.suppressionDepth > 0) {
      // The caller's work is already done and this entry will never exist, so anything it was
      // holding for a later undo is unreachable from this moment.
      request.dispose?.();
      return false;
    }
    return this.pushEntry(
      createCommandEntry({
        scopeId,
        label: request.label,
        undo: request.undo,
        redo: request.redo,
        mergeKey: request.mergeKey,
        now: Date.now(),
        dispose: request.dispose
      }),
      request
    );
  }

  /**
   * Run `fn` as one undoable step: capture, mutate, capture, record the pair.
   *
   * Use it when the mutation is a self-contained call. When the edit is spread over a long
   * handler with early returns, {@link checkpoint} in front of it is the honest shape.
   */
  public run<T, S = unknown>(
    scopeId: HistoryScopeId,
    request: HistoryPushRequest & { equals?: (a: S, b: S) => boolean },
    fn: () => T
  ): T {
    const scope = this.scopes.get(scopeId) as HistoryScope<S> | undefined;
    if (!scope || this.suppressionDepth > 0) {
      return fn();
    }
    const before = scope.capture();
    const result = fn();
    const after = scope.capture();
    if (before !== null && after !== null) {
      this.pushSnapshot<S>(scopeId, { ...request, before, after });
    }
    return result;
  }

  /**
   * End the current merge group for a scope, so the next edit starts a fresh undo step even if it
   * would otherwise fold into the last one.
   */
  public breakMerge(scopeId: HistoryScopeId): void {
    this.stacks.get(scopeId)?.breakMerge();
  }

  /** True while an entry is being applied - the signal document services use to skip re-recording. */
  public isRestoring(): boolean {
    return this.suppressionDepth > 0;
  }

  /** Run `fn` with recording turned off. For code that rebuilds state as a side effect of a restore. */
  public withoutRecording<T>(fn: () => T): T {
    this.suppressionDepth += 1;
    try {
      return fn();
    } finally {
      this.suppressionDepth -= 1;
    }
  }

  // === Applying ===========================================================

  public canUndo(scopeId?: HistoryScopeId): boolean {
    const id = scopeId ?? this.activeScopeId;
    return !!id && !!this.stacks.get(id)?.canUndo();
  }

  public canRedo(scopeId?: HistoryScopeId): boolean {
    const id = scopeId ?? this.activeScopeId;
    return !!id && !!this.stacks.get(id)?.canRedo();
  }

  /** What the next undo would reverse, for a menu item or tooltip. */
  public peekUndo(scopeId?: HistoryScopeId): HistoryLabel | null {
    const id = scopeId ?? this.activeScopeId;
    return (id ? this.stacks.get(id)?.peekUndo()?.label : null) ?? null;
  }

  public peekRedo(scopeId?: HistoryScopeId): HistoryLabel | null {
    const id = scopeId ?? this.activeScopeId;
    return (id ? this.stacks.get(id)?.peekRedo()?.label : null) ?? null;
  }

  /**
   * Undo one step in `scopeId`, or in the active scope.
   *
   * Returns whether a step was taken. `false` covers every reason it could not be: nothing on the
   * stack, the workspace is frozen, no live registration to apply the snapshot through, or an
   * asynchronous entry is still running. In all of them the stack is exactly as it was.
   */
  public undo(scopeId?: HistoryScopeId): boolean {
    return this.step("undo", scopeId);
  }

  public redo(scopeId?: HistoryScopeId): boolean {
    return this.step("redo", scopeId);
  }

  /** Resolves once any asynchronous entry started by {@link undo} / {@link redo} has settled. */
  public async settled(): Promise<void> {
    while (this.pending) {
      await this.pending;
    }
  }

  // === Lifecycle ==========================================================

  public getLimit(): number {
    return this.defaultLimit;
  }

  /** Change the depth of every scope that has not asked for one of its own. */
  public setLimit(limit: number): void {
    const next = Math.max(1, Math.floor(limit));
    if (!Number.isFinite(next) || next === this.defaultLimit) {
      return;
    }
    this.defaultLimit = next;
    for (const [scopeId, stack] of this.stacks) {
      if (this.scopes.get(scopeId)?.limit === undefined) {
        stack.setLimit(next);
        this.events.emit("changed", { scopeId });
      }
    }
  }

  /** Override the depth of one scope, whether or not it is registered yet. */
  public setScopeLimit(scopeId: HistoryScopeId, limit: number): void {
    this.ensureStack(scopeId).setLimit(limit);
    this.events.emit("changed", { scopeId });
  }

  /** Throw away one scope's stack, keeping its registration. */
  public clearScope(scopeId: HistoryScopeId): void {
    const stack = this.stacks.get(scopeId);
    if (!stack) {
      return;
    }
    stack.clear();
    this.events.emit("changed", { scopeId });
  }

  /**
   * Throw away every stack.
   *
   * What a reload from disk needs: every snapshot taken before it describes a document that no
   * longer exists, and applying one would write the pre-reload text back over the new file. There
   * is nothing coherent left to undo *to*, so losing the stacks is the correct trade.
   */
  public clearAll(): void {
    const ids = [...this.stacks.keys()];
    for (const stack of this.stacks.values()) {
      stack.clear();
    }
    for (const id of ids) {
      this.events.emit("changed", { scopeId: id });
    }
  }

  /** Drop the stacks whose scope id starts with `prefix` - one story's scenes, say. */
  public clearMatching(predicate: (scopeId: HistoryScopeId) => boolean): void {
    for (const [scopeId, stack] of this.stacks) {
      if (!predicate(scopeId)) {
        continue;
      }
      stack.clear();
      this.stacks.delete(scopeId);
      const index = this.touchOrder.indexOf(scopeId);
      if (index >= 0) {
        this.touchOrder.splice(index, 1);
      }
      this.events.emit("changed", { scopeId });
    }
  }

  public on<K extends keyof HistoryEvents>(
    event: K,
    handler: (data: HistoryEvents[K]) => void
  ): () => void {
    return this.events.on(event, handler);
  }

  public override dispose(_ctx: WorkspaceContext): void {
    this.scopes.clear();
    this.stacks.clear();
    this.touchOrder.length = 0;
    this.activeScopeId = null;
    this.suppressionDepth = 0;
    this.pending = null;
    this.events.clear();
  }

  /** Depths of every live stack, for diagnostics and tests. */
  public describe(): Array<{
    scopeId: HistoryScopeId;
    undo: number;
    redo: number;
    registered: boolean;
  }> {
    return [...this.stacks.entries()].map(([scopeId, stack]) => ({
      scopeId,
      undo: stack.undoDepth,
      redo: stack.redoDepth,
      registered: this.scopes.has(scopeId)
    }));
  }

  // === Internals ==========================================================

  private pushEntry(entry: HistoryEntry, request: HistoryPushRequest): boolean {
    const stack = this.ensureStack(entry.scopeId);
    stack.push(entry, { now: entry.createdAt, mergeWindowMs: request.mergeWindowMs });
    this.touch(entry.scopeId);
    this.events.emit("changed", { scopeId: entry.scopeId });
    return true;
  }

  private step(direction: "undo" | "redo", scopeId?: HistoryScopeId): boolean {
    const id = scopeId ?? this.activeScopeId;
    if (!id || this.pending || getProjectWriteFreeze()) {
      return false;
    }
    const stack = this.stacks.get(id);
    if (!stack) {
      return false;
    }
    const entry = direction === "undo" ? stack.takeUndo() : stack.takeRedo();
    if (!entry) {
      return false;
    }

    const put =
      direction === "undo" ? () => stack.restoreUndo(entry) : () => stack.restoreRedo(entry);
    const accept =
      direction === "undo" ? () => stack.acceptUndo(entry) : () => stack.acceptRedo(entry);

    let result: void | Promise<void>;
    this.suppressionDepth += 1;
    try {
      result = this.applyEntry(entry, direction);
    } catch (error) {
      this.suppressionDepth -= 1;
      put();
      console.error(`[History] ${direction} failed in ${id}`, error);
      return false;
    }

    if (!(result instanceof Promise)) {
      this.suppressionDepth -= 1;
      accept();
      this.touch(id);
      this.events.emit("changed", { scopeId: id });
      return true;
    }

    this.pending = result
      .then(() => {
        accept();
      })
      .catch((error) => {
        put();
        console.error(`[History] ${direction} failed in ${id}`, error);
      })
      .finally(() => {
        this.suppressionDepth -= 1;
        this.pending = null;
        this.touch(id);
        this.events.emit("changed", { scopeId: id });
      });
    return true;
  }

  /**
   * Apply one entry in one direction.
   *
   * Throws (rather than returning false) when a checkpoint cannot be applied, so the caller's
   * catch puts the entry back: a checkpoint whose scope has gone is not "nothing to do", it is an
   * undo the author asked for and did not get.
   */
  private applyEntry(entry: HistoryEntry, direction: "undo" | "redo"): void | Promise<void> {
    if (entry.body.kind === "command") {
      return direction === "undo" ? entry.body.undo() : entry.body.redo();
    }

    const scope = this.scopes.get(entry.scopeId);
    if (!scope) {
      throw new Error(`No live registration for history scope "${entry.scopeId}"`);
    }

    if (entry.body.kind === "snapshot") {
      scope.apply(direction === "undo" ? entry.body.before.value : entry.body.after.value);
      return;
    }

    // Checkpoint: the "after" side is whatever is live at the moment of the first undo, which is
    // also the only moment it can be read. Captured once and kept, so redo is repeatable.
    if (direction === "undo") {
      const present = scope.capture();
      if (present !== null) {
        entry.body.after = { value: present };
      }
      scope.apply(entry.body.before.value);
      return;
    }
    if (!entry.body.after) {
      throw new Error(`Nothing to redo for history entry ${entry.id}`);
    }
    scope.apply(entry.body.after.value);
  }

  private ensureStack(scopeId: HistoryScopeId): HistoryStack {
    let stack = this.stacks.get(scopeId);
    if (!stack) {
      stack = new HistoryStack(this.scopes.get(scopeId)?.limit ?? this.defaultLimit);
      this.stacks.set(scopeId, stack);
    }
    return stack;
  }

  private touch(scopeId: HistoryScopeId): void {
    const index = this.touchOrder.indexOf(scopeId);
    if (index >= 0) {
      this.touchOrder.splice(index, 1);
    }
    this.touchOrder.push(scopeId);
  }

  /** Drop the least-recently-touched stacks that nothing is registered against any more. */
  private evictInactive(): void {
    const inactive = this.touchOrder.filter((id) => !this.scopes.has(id) && this.stacks.has(id));
    const excess = inactive.length - RETAINED_INACTIVE_SCOPES;
    for (let i = 0; i < excess; i++) {
      const scopeId = inactive[i];
      this.stacks.delete(scopeId);
      const index = this.touchOrder.indexOf(scopeId);
      if (index >= 0) {
        this.touchOrder.splice(index, 1);
      }
      this.events.emit("changed", { scopeId });
    }
  }
}
