import { describe, expect, it } from "vitest";
import type { TranslationKey } from "@shared/i18n";
import {
  createCheckpointEntry,
  createCommandEntry,
  createSnapshotEntry,
  HistoryStack,
  type HistoryEntry
} from "./historyModel";

const LABEL = { key: "workspace.history.entry.edit" as TranslationKey };

function checkpoint(before: unknown, now: number, mergeKey?: string): HistoryEntry {
  return createCheckpointEntry({ scopeId: "s", label: LABEL, before, mergeKey, now });
}

function snapshot(before: unknown, after: unknown, now: number, mergeKey?: string): HistoryEntry {
  return createSnapshotEntry({ scopeId: "s", label: LABEL, before, after, mergeKey, now });
}

describe("HistoryStack", () => {
  it("pushes and pops in order", () => {
    const stack = new HistoryStack();
    stack.push(checkpoint("a", 0), { now: 0 });
    stack.push(checkpoint("b", 1), { now: 1 });

    expect(stack.undoDepth).toBe(2);
    const top = stack.takeUndo();
    expect((top?.body as { before: { value: unknown } }).before.value).toBe("b");
  });

  it("clears redo on a fresh push, so a new branch cannot reapply the abandoned one", () => {
    const stack = new HistoryStack();
    stack.push(checkpoint("a", 0), { now: 0 });
    const entry = stack.takeUndo()!;
    stack.acceptUndo(entry);
    expect(stack.redoDepth).toBe(1);

    stack.push(checkpoint("c", 10_000), { now: 10_000 });
    expect(stack.redoDepth).toBe(0);
  });

  it("merges two checkpoints with the same key inside the window, keeping the older before", () => {
    const stack = new HistoryStack();
    stack.push(checkpoint("first", 0, "drag"), { now: 0, mergeWindowMs: 800 });
    stack.push(checkpoint("second", 100, "drag"), { now: 100, mergeWindowMs: 800 });

    expect(stack.undoDepth).toBe(1);
    expect((stack.peekUndo()?.body as { before: { value: unknown } }).before.value).toBe("first");
  });

  it("merges two snapshots by taking the newer after", () => {
    const stack = new HistoryStack();
    stack.push(snapshot("a0", "a1", 0, "drag"), { now: 0 });
    stack.push(snapshot("a1", "a2", 100, "drag"), { now: 100 });

    expect(stack.undoDepth).toBe(1);
    const body = stack.peekUndo()?.body as {
      before: { value: unknown };
      after: { value: unknown };
    };
    expect(body.before.value).toBe("a0");
    expect(body.after.value).toBe("a2");
  });

  it("does not merge past the window", () => {
    const stack = new HistoryStack();
    stack.push(checkpoint("first", 0, "drag"), { now: 0, mergeWindowMs: 800 });
    stack.push(checkpoint("second", 5000, "drag"), { now: 5000, mergeWindowMs: 800 });
    expect(stack.undoDepth).toBe(2);
  });

  it("does not merge across kinds", () => {
    const stack = new HistoryStack();
    stack.push(checkpoint("a", 0, "k"), { now: 0 });
    stack.push(snapshot("a", "b", 10, "k"), { now: 10 });
    expect(stack.undoDepth).toBe(2);
  });

  it("never merges commands, whose inverses do not compose", () => {
    const stack = new HistoryStack();
    const command = () =>
      createCommandEntry({
        scopeId: "s",
        label: LABEL,
        undo: () => {},
        redo: () => {},
        mergeKey: "k",
        now: 0
      });
    stack.push(command(), { now: 0 });
    stack.push(command(), { now: 1 });
    expect(stack.undoDepth).toBe(2);
  });

  it("breakMerge ends the group for exactly one push", () => {
    const stack = new HistoryStack();
    stack.push(checkpoint("a", 0, "typing"), { now: 0 });
    stack.breakMerge();
    stack.push(checkpoint("b", 10, "typing"), { now: 10 });
    expect(stack.undoDepth).toBe(2);

    stack.push(checkpoint("c", 20, "typing"), { now: 20 });
    expect(stack.undoDepth).toBe(2);
  });

  it("drops the oldest entries past the limit", () => {
    const stack = new HistoryStack(3);
    for (let i = 0; i < 5; i++) {
      stack.push(checkpoint(i, i * 10_000), { now: i * 10_000 });
    }
    expect(stack.undoDepth).toBe(3);
    expect((stack.listUndo()[0].body as { before: { value: unknown } }).before.value).toBe(2);
  });

  it("re-trims when the limit shrinks", () => {
    const stack = new HistoryStack(10);
    for (let i = 0; i < 6; i++) {
      stack.push(checkpoint(i, i * 10_000), { now: i * 10_000 });
    }
    stack.setLimit(2);
    expect(stack.undoDepth).toBe(2);
  });

  it("puts an entry back untouched when the caller could not run it", () => {
    const stack = new HistoryStack();
    stack.push(checkpoint("a", 0), { now: 0 });
    const entry = stack.takeUndo()!;
    stack.restoreUndo(entry);
    expect(stack.undoDepth).toBe(1);
    expect(stack.redoDepth).toBe(0);
  });

  it("blocks merging across an undo, so redo-then-edit does not fold into the redone step", () => {
    const stack = new HistoryStack();
    stack.push(checkpoint("a", 0, "typing"), { now: 0 });
    const entry = stack.takeUndo()!;
    stack.acceptUndo(entry);
    const redone = stack.takeRedo()!;
    stack.acceptRedo(redone);

    stack.push(checkpoint("b", 10, "typing"), { now: 10 });
    expect(stack.undoDepth).toBe(2);
  });
});
