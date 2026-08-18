import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TranslationKey } from "@shared/i18n";
import { HistoryService } from "./HistoryService";

vi.mock("@/lib/app/writeFreeze", () => ({ getProjectWriteFreeze: () => null }));

const LABEL = { key: "workspace.history.entry.edit" as TranslationKey };

/**
 * An entry's disposer is what lets a command entry own something outside memory - the asset trash
 * is the reason it exists. These cover every way an entry can become unreachable, because a missed
 * one is a payload that is never reclaimed and never restorable either.
 */
describe("history entry disposal", () => {
  let history: HistoryService;
  let disposed: string[];

  const push = (name: string) =>
    history.pushCommand("project", {
      label: LABEL,
      undo: () => {},
      redo: () => {},
      dispose: () => void disposed.push(name)
    });

  beforeEach(() => {
    history = new HistoryService();
    history.setContext({ project: {} as never, services: {} as never });
    disposed = [];
  });

  it("disposes entries trimmed past the depth limit", () => {
    history.setScopeLimit("project", 2);
    push("a");
    push("b");
    push("c");
    expect(disposed).toEqual(["a"]);
  });

  it("disposes the redo branch a new edit invalidates", () => {
    push("a");
    history.undo("project");
    expect(disposed).toEqual([]);

    push("b");
    // "a" is on the redo side and a new edit has replaced that future; it can never run again.
    expect(disposed).toEqual(["a"]);
  });

  it("disposes everything a clear throws away", () => {
    push("a");
    push("b");
    history.undo("project");
    history.clearScope("project");
    expect(disposed.sort()).toEqual(["a", "b"]);
  });

  it("disposes through clearAll, which is what a reload from disk uses", () => {
    push("a");
    history.clearAll();
    expect(disposed).toEqual(["a"]);
  });

  it("disposes an entry that was never recorded because a restore was in progress", () => {
    const state = { value: 0 };
    history.registerScope<number>({
      id: "doc",
      label: LABEL,
      capture: () => state.value,
      apply: (value) => {
        state.value = value;
        // A service that deletes something while re-applying a snapshot: the entry it tries
        // to record is refused, and whatever it set aside has to be released anyway.
        push("during-restore");
      }
    });
    history.checkpoint("doc", { label: LABEL });
    state.value = 1;
    history.undo("doc");
    expect(disposed).toEqual(["during-restore"]);
  });

  it("does not dispose an entry that is merely undone", () => {
    push("a");
    history.undo("project");
    expect(disposed).toEqual([]);
    history.redo("project");
    expect(disposed).toEqual([]);
  });

  it("survives a disposer that throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    history.pushCommand("project", {
      label: LABEL,
      undo: () => {},
      redo: () => {},
      dispose: () => {
        throw new Error("nope");
      }
    });
    push("b");
    expect(() => history.clearAll()).not.toThrow();
    expect(disposed).toEqual(["b"]);
    warn.mockRestore();
  });
});
