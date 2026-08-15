// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentMergeDecision } from "@shared/documents/diff";
import type { VcsMergeDocumentBlocker } from "@shared/types/vcs";
import { ConflictFooter, ConflictResolveView, type WriteGuard } from "./ConflictResolveView";
import { buildConflictRows, type MergeChoiceState, type MergeDocumentEntry } from "./mergeDecisionView";

/**
 * What the merge panel promises, on screen.
 *
 * `mergeDecisionView.test.ts` pins what a file's state IS; this pins that the state is what gets
 * drawn. The four failures it exists for all pass a model test, and three of them were the shape of
 * the surface this replaced: an index row that grows with what is inside its file, two files'
 * decisions mounted at once, a file that cannot be merged per change losing its controls to a blank
 * space, and an undecided file that looks exactly like a decided one.
 */

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        t: (key: string, params?: Record<string, unknown>) =>
            (params ? `${key}(${Object.values(params).join(",")})` : key),
        has: () => false,
        tn: (key: string, count: number) => `${key}(${count})`,
    }),
}));

afterEach(cleanup);

/** A guard that switches nothing off, so what is disabled below is disabled for its own reason. */
const THAWED: WriteGuard = {
    writes: (ownDisabled = false, ownTooltip?: string) => ({ disabled: ownDisabled, "data-tip": ownTooltip }),
};

function decision(outcome: DocumentMergeDecision["outcome"], name: string): DocumentMergeDecision {
    return {
        path: ["units", name],
        outcome,
        label: { key: "documentDiff.localization.changed" },
        mine: { present: true, value: { target: `${name} mine` } },
        theirs: { present: true, value: { target: `${name} theirs` } },
    };
}

function ready(path: string, decisions: DocumentMergeDecision[]): MergeDocumentEntry {
    return {
        status: "ready",
        document: { path, decisions, conflicts: decisions.filter(one => one.outcome === "conflict").length },
    };
}

function blocked(path: string, blocker: VcsMergeDocumentBlocker, detail?: string): MergeDocumentEntry {
    return { status: "ready", document: { path, decisions: [], conflicts: 0, blocked: blocker, detail } };
}

function tree(paths: readonly string[], partial: Partial<MergeChoiceState>, selected: string | null) {
    const state: MergeChoiceState = {
        decisions: {}, perChange: {}, changeChoices: {}, documents: {}, ...partial,
    };
    const rows = buildConflictRows(paths, state);
    return (
        <>
            <ConflictResolveView
                rows={rows}
                conflictCount={paths.length}
                omitted={0}
                selectedPath={selected}
                onSelect={() => undefined}
                documents={state.documents}
                changeChoices={state.changeChoices}
                running={false}
                guard={THAWED}
                onChooseWhole={() => undefined}
                onChooseMerged={() => undefined}
                onChooseChange={() => undefined}
                onChooseAll={() => undefined}
            />
            <ConflictFooter
                rows={rows}
                running={null}
                guard={THAWED}
                onFinish={() => undefined}
                onAbandon={() => undefined}
            />
        </>
    );
}

const surface = (
    paths: readonly string[],
    partial: Partial<MergeChoiceState>,
    selected: string | null,
) => render(tree(paths, partial, selected));

const rowsOf = (container: HTMLElement) => container.querySelectorAll("[data-resolve-row]");
const details = (container: HTMLElement) => container.querySelectorAll("[data-resolve-detail]");
const finish = (container: HTMLElement) => container.querySelector<HTMLButtonElement>("[data-resolve-finish]")!;

describe("the conflict index", () => {
    it("draws one row per conflicted file however many decisions the file holds", () => {
        const many = Array.from({ length: 40 }, (_, index) => decision("conflict", `unit${index}`));
        const { container } = surface(
            ["editor/localization/en.json", "editor/story/a/storydoc.json"],
            { documents: { "editor/localization/en.json": ready("editor/localization/en.json", many) } },
            "editor/localization/en.json",
        );

        expect(rowsOf(container)).toHaveLength(2);
        // The decisions are on screen - they are what the detail is for - and none of them reached
        // the index. A change's own label in there is the first sign a row has started growing with
        // what it stands for, which is how the surface this replaced became unreadable.
        const index = container.querySelector("[aria-label='documentDiff.resolve.fileList']")!;
        expect(index.textContent).not.toContain("documentDiff.localization.changed");
        expect(container.textContent).toContain("documentDiff.localization.changed");
    });

    it("mounts exactly one file's decisions at a time", () => {
        const documents = {
            "a.json": ready("a.json", [decision("conflict", "greeting")]),
            "b.json": ready("b.json", [decision("conflict", "farewell")]),
        };

        const { container, rerender } = surface(["a.json", "b.json"], { documents }, "a.json");
        expect(details(container)).toHaveLength(1);
        expect(details(container)[0].getAttribute("data-resolve-detail")).toBe("a.json");

        // Moving the selection replaces the detail rather than adding one. The surface this
        // replaced grew a second list per file the author opened, which is what made a merge of
        // forty files unreadable.
        rerender(tree(["a.json", "b.json"], { documents }, "b.json"));
        expect(details(container)).toHaveLength(1);
        expect(details(container)[0].getAttribute("data-resolve-detail")).toBe("b.json");
    });
});

/**
 * The third state is the one that has to be unmistakable: it is what stops the merge being
 * finished, and an author looking for the files still holding it open cannot be made to read every
 * button on every row.
 */
describe("the three states of a row", () => {
    it("marks the undecided row and leaves the two decided ones unmarked", () => {
        const { container } = surface(
            ["a.json", "b.json", "c.json"],
            { decisions: { "a.json": "mine", "b.json": "theirs" } },
            null,
        );

        const [a, b, c] = [...rowsOf(container)];
        expect([a, b, c].map(row => row.getAttribute("data-resolve-decision"))).toEqual(["mine", "theirs", "none"]);
        expect(a.querySelector("[data-resolve-pending]")).toBeNull();
        expect(b.querySelector("[data-resolve-pending]")).toBeNull();
        expect(c.querySelector("[data-resolve-pending]")).not.toBeNull();
    });

    it("presses one button on a decided row and neither on an undecided one", () => {
        const { container } = surface(["a.json", "c.json"], { decisions: { "a.json": "mine" } }, null);

        const pressed = (row: Element) =>
            [...row.querySelectorAll("[aria-pressed]")].map(node => node.getAttribute("aria-pressed"));
        const [a, c] = [...rowsOf(container)];
        expect(pressed(a)).toEqual(["true", "false"]);
        expect(pressed(c)).toEqual(["false", "false"]);
    });

    it("refuses to finish while any file is undecided, and says how many", () => {
        const { container } = surface(["a.json", "c.json"], { decisions: { "a.json": "mine" } }, null);

        expect(finish(container).disabled).toBe(true);
        expect(finish(container).textContent).toContain("documentDiff.resolve.finishUndecided(1)");
    });

    it("finishes once every file has a side", () => {
        const { container } = surface(
            ["a.json", "c.json"],
            { decisions: { "a.json": "mine", "c.json": "theirs" } },
            null,
        );

        expect(finish(container).disabled).toBe(false);
        expect(finish(container).textContent).toContain("documentDiff.resolve.finish");
    });
});

/**
 * Tier three: refuse and say why. "Studio cannot merge this format" and "there is nothing left to
 * decide here" must not be the same blank space, and the whole-file answer is still the answer for
 * a file like this - so the two buttons stay.
 */
describe("a file that cannot be merged change by change", () => {
    it("keeps both whole-file buttons and states the reason beside them", () => {
        const { container } = surface(
            ["assets/assets.metadata.image.json"],
            { documents: { "assets/assets.metadata.image.json": blocked("assets/assets.metadata.image.json", "read-only", "serialize refused") } },
            "assets/assets.metadata.image.json",
        );

        const controls = rowsOf(container)[0].querySelectorAll("[role='group'] button");
        expect([...controls].map(node => node.textContent)).toEqual([
            "documentDiff.resolve.takeMine",
            "documentDiff.resolve.takeTheirs",
        ]);

        const detail = details(container)[0];
        expect(detail.textContent).toContain("documentDiff.resolve.change.blocked.title");
        expect(detail.textContent).toContain("documentDiff.resolve.change.blocked.readOnly");
        // The producer's own words, kept: they are the only part that says which serializer refused.
        expect(detail.textContent).toContain("serialize refused");
    });

    it("offers the per-change control on a file that can take it", () => {
        const { container } = surface(
            ["editor/localization/en.json"],
            { documents: { "editor/localization/en.json": ready("editor/localization/en.json", [decision("conflict", "greeting")]) } },
            "editor/localization/en.json",
        );

        const controls = rowsOf(container)[0].querySelectorAll("[role='group'] button");
        expect([...controls].map(node => node.textContent)).toEqual([
            "documentDiff.resolve.takeMine",
            "documentDiff.resolve.takeTheirs",
            "documentDiff.resolve.change.auto",
        ]);
    });

    it("draws no per-change control before the file has been read", () => {
        const { container } = surface(["editor/localization/en.json"], {}, "editor/localization/en.json");

        expect(rowsOf(container)[0].querySelectorAll("[role='group'] button")).toHaveLength(2);
        expect(details(container)[0].textContent).toContain("documentDiff.resolve.change.loading");
    });
});
