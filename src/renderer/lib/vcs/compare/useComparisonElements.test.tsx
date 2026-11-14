// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentDiffEntry } from "@shared/documents/diff";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { DocumentChangeRow } from "../documentChangeView";
import { useComparisonElements } from "./useComparisonElements";

const fixture = vi.hoisted(() => ({
    context: null as unknown,
    document: null as unknown,
}));

vi.mock("@/apps/workspace/context", () => ({ useWorkspace: () => ({ context: fixture.context }) }));
vi.mock("../presenters/sideDocument", () => ({
    useSideDocument: () => ({ status: "ready", document: fixture.document, error: null }),
}));

afterEach(cleanup);

describe("selection in two comparisons of the same document", () => {
    it("highlights and clears only the comparison that owns the selection", () => {
        type Selection = { type: string | null; data: unknown };
        let selected: Selection = { type: null, data: null };
        const listeners = new Set<(value: Selection) => void>();
        const store = {
            getSelection: () => selected,
            setSelection: (value: Selection) => {
                selected = value;
                for (const listener of listeners) listener(value);
            },
        };
        const ui = {
            getStore: () => store,
            getEvents: () => ({ on: (_event: string, listener: (value: Selection) => void) => {
                listeners.add(listener);
                return () => listeners.delete(listener);
            } }),
        };
        fixture.context = { services: { get: () => ui } };
        fixture.document = { elements: { title: { id: "title", name: "Title", type: "nl.text" } } } as unknown as UIDocument;
        const entry = { documentKind: "ui-document", kind: "changed" } as DocumentDiffEntry;
        const row = {
            key: "title",
            depth: 0,
            truncated: 0,
            change: { kind: "changed", path: ["surfaces", "main", "elements", "title"], label: { key: "title" } },
        } as DocumentChangeRow;
        const useComparison = (comparisonId: string, currentEntry = entry) => useComparisonElements({
            comparisonId,
            entry: currentEntry,
            path: "editor/ui/uidoc.json",
            sides: { before: { at: "revision", revision: comparisonId }, after: { at: "working-tree" } },
            baseLabel: comparisonId,
            headLabel: "Working tree",
            labelFor: name => name,
        });
        const first = renderHook(() => useComparison("first"));
        const second = renderHook(({ currentEntry }) => useComparison("second", currentEntry), {
            initialProps: { currentEntry: entry },
        });

        act(() => second.result.current!(row, "base")!.onSelect());

        expect(first.result.current!(row, "base")!.selected).toBe(false);
        expect(second.result.current!(row, "base")!.selected).toBe(true);
        first.unmount();
        expect(store.getSelection().type).toBe("comparisonElement");
        second.rerender({ currentEntry: { ...entry } });
        expect(store.getSelection().type).toBeNull();
        act(() => second.result.current!(row, "base")!.onSelect());
        second.unmount();
        expect(store.getSelection().type).toBeNull();
    });
});
