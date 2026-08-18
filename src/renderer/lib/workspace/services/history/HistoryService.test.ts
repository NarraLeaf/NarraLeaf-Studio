import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TranslationKey } from "@shared/i18n";
import { HistoryService } from "./HistoryService";

vi.mock("@/lib/app/writeFreeze", () => ({
  getProjectWriteFreeze: () => frozen
}));

let frozen: unknown = null;

const LABEL = { key: "workspace.history.entry.edit" as TranslationKey };

/** A scope over one mutable string - enough to tell "which state came back" apart. */
function createDocumentScope(history: HistoryService, id = "doc") {
  const state = { text: "a", live: true };
  const dispose = history.registerScope<string>({
    id,
    label: LABEL,
    capture: () => (state.live ? state.text : null),
    apply: (snapshot) => {
      state.text = snapshot;
    }
  });
  return { state, dispose, id };
}

describe("HistoryService", () => {
  let history: HistoryService;

  beforeEach(() => {
    frozen = null;
    history = new HistoryService();
    history.setContext({ project: {} as never, services: {} as never });
  });

  it("checkpoint + undo returns the state the checkpoint was taken at", () => {
    const doc = createDocumentScope(history);

    history.checkpoint(doc.id, { label: LABEL });
    doc.state.text = "b";

    expect(history.undo(doc.id)).toBe(true);
    expect(doc.state.text).toBe("a");
  });

  it("redo of a checkpoint restores what was live when it was undone", () => {
    const doc = createDocumentScope(history);

    history.checkpoint(doc.id, { label: LABEL });
    doc.state.text = "b";
    history.undo(doc.id);

    expect(history.redo(doc.id)).toBe(true);
    expect(doc.state.text).toBe("b");
  });

  it("does not record while an entry is being applied", () => {
    const state = { text: "a" };
    history.registerScope<string>({
      id: "doc",
      label: LABEL,
      capture: () => state.text,
      // An apply that tries to record its own edit - what a document service does when it
      // cannot tell a restore from an author's keystroke.
      apply: (snapshot) => {
        state.text = snapshot;
        history.checkpoint("doc", { label: LABEL });
      }
    });

    history.checkpoint("doc", { label: LABEL });
    state.text = "b";
    history.undo("doc");

    expect(history.canUndo("doc")).toBe(false);
    expect(state.text).toBe("a");
  });

  it("keeps stacks separate per scope", () => {
    const a = createDocumentScope(history, "a");
    const b = createDocumentScope(history, "b");

    history.checkpoint("a", { label: LABEL });
    a.state.text = "a2";
    history.checkpoint("b", { label: LABEL });
    b.state.text = "b2";

    expect(history.undo("a")).toBe(true);
    expect(a.state.text).toBe("a");
    expect(b.state.text).toBe("b2");
  });

  it("keeps the stack when a scope unregisters, and revives it on re-registration", () => {
    const first = createDocumentScope(history);
    history.checkpoint(first.id, { label: LABEL });
    first.state.text = "b";
    first.dispose();

    // Nothing live to apply the snapshot through: refuse rather than write a document
    // nothing is showing.
    expect(history.undo(first.id)).toBe(false);

    const second = createDocumentScope(history);
    second.state.text = "b";
    expect(history.undo(second.id)).toBe(true);
    expect(second.state.text).toBe("a");
  });

  it("refuses to undo while the workspace is frozen, leaving the stack intact", () => {
    const doc = createDocumentScope(history);
    history.checkpoint(doc.id, { label: LABEL });
    doc.state.text = "b";

    frozen = { kind: "revision" };
    expect(history.undo(doc.id)).toBe(false);
    expect(doc.state.text).toBe("b");

    frozen = null;
    expect(history.undo(doc.id)).toBe(true);
    expect(doc.state.text).toBe("a");
  });

  it("skips a checkpoint whose scope cannot read the state yet", () => {
    const doc = createDocumentScope(history);
    doc.state.live = false;

    expect(history.checkpoint(doc.id, { label: LABEL })).toBe(false);
    expect(history.canUndo(doc.id)).toBe(false);
  });

  it("run() records the pair around a mutation and skips a no-op", () => {
    const doc = createDocumentScope(history);

    history.run<void, string>(doc.id, { label: LABEL }, () => {
      doc.state.text = "b";
    });
    expect(history.canUndo(doc.id)).toBe(true);

    history.run<void, string>(doc.id, { label: LABEL }, () => {
      // no change
    });
    expect(history.undo(doc.id)).toBe(true);
    expect(doc.state.text).toBe("a");
    expect(history.canUndo(doc.id)).toBe(false);
  });

  it("routes a scope-less undo to the active scope", () => {
    const a = createDocumentScope(history, "a");
    const b = createDocumentScope(history, "b");
    history.checkpoint("a", { label: LABEL });
    a.state.text = "a2";
    history.checkpoint("b", { label: LABEL });
    b.state.text = "b2";

    history.setActiveScope("b");
    expect(history.undo()).toBe(true);
    expect(b.state.text).toBe("a");
    expect(a.state.text).toBe("a2");
  });

  it("runs a command entry's own inverse", () => {
    const log: string[] = [];
    history.pushCommand("project", {
      label: LABEL,
      undo: () => void log.push("undo"),
      redo: () => void log.push("redo")
    });

    expect(history.undo("project")).toBe(true);
    expect(history.redo("project")).toBe(true);
    expect(log).toEqual(["undo", "redo"]);
  });

  it("puts a failing entry back rather than losing the step", () => {
    history.pushCommand("project", {
      label: LABEL,
      undo: () => {
        throw new Error("nope");
      },
      redo: () => {}
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(history.undo("project")).toBe(false);
    expect(history.canUndo("project")).toBe(true);
    expect(history.canRedo("project")).toBe(false);
    error.mockRestore();
  });

  it("serializes an asynchronous entry and refuses a second undo while it runs", async () => {
    const log: string[] = [];
    let release: () => void = () => {};
    history.pushCommand("project", {
      label: LABEL,
      undo: () => void log.push("sync"),
      redo: () => {}
    });
    history.pushCommand("project", {
      label: LABEL,
      undo: () =>
        new Promise<void>((resolve) => {
          log.push("async-start");
          release = resolve;
        }),
      redo: () => {}
    });

    expect(history.undo("project")).toBe(true);
    // A second press while the first is still running would interleave two restores over the
    // same document - refused, and the entry it would have taken is still there afterwards.
    expect(history.undo("project")).toBe(false);

    release();
    await history.settled();
    expect(log).toEqual(["async-start"]);

    expect(history.undo("project")).toBe(true);
    expect(log).toEqual(["async-start", "sync"]);
  });

  it("clearAll drops every stack", () => {
    const a = createDocumentScope(history, "a");
    const b = createDocumentScope(history, "b");
    history.checkpoint("a", { label: LABEL });
    a.state.text = "x";
    history.checkpoint("b", { label: LABEL });
    b.state.text = "y";

    history.clearAll();
    expect(history.canUndo("a")).toBe(false);
    expect(history.canUndo("b")).toBe(false);
  });

  it("peekUndo names the step so a menu can say what it reverses", () => {
    const doc = createDocumentScope(history);
    history.checkpoint(doc.id, {
      label: { key: "workspace.history.entry.storyEdit" as TranslationKey }
    });
    expect(history.peekUndo(doc.id)?.key).toBe("workspace.history.entry.storyEdit");
  });
});
