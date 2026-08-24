// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentChange, DocumentDiffEntry, DocumentDiffTier } from "@shared/documents/diff";
import { ChangeIndexPane } from "./ChangeIndexPane";
import { buildChangeIndex, type ChangeIndexGroup } from "./changeIndex";

/**
 * What the model promises, on screen.
 *
 * `changeIndex.test.ts` pins the shape; this pins that the shape is what gets drawn. The two failures
 * it is for both pass a model test: a row that renders its file's changes underneath itself, and a
 * closed heading that draws its contents anyway with `hidden` on them.
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

function entry(path: string, changes: number, tier: DocumentDiffTier = "semantic"): DocumentDiffEntry {
    const list: DocumentChange[] = Array.from({ length: changes }, (_, index) => ({
        path: [`field${index}`],
        kind: "changed",
        label: { key: "documentDiff.structural.property", params: { name: `field${index}` } },
    }));
    return {
        path,
        kind: "changed",
        diff: { changes: list, complete: true, total: list.length, tier },
    };
}

function pane(entries: readonly DocumentDiffEntry[], open: (group: ChangeIndexGroup) => boolean) {
    const index = buildChangeIndex(entries, { rowBudget: 1000, complete: true });
    return render(
        <ChangeIndexPane
            index={index}
            isOpen={open}
            onToggle={() => undefined}
            selectedKey={null}
            onSelect={() => undefined}
        />,
    );
}

const rows = (container: HTMLElement) => container.querySelectorAll("[data-change-index-row]");

describe("ChangeIndexPane", () => {
    it("draws one row per file however many changes the file has", () => {
        const { container } = pane([
            entry("editor/story/stories/a/storydoc.json", 1),
            entry("editor/story/stories/b/storydoc.json", 200),
            entry("editor/story/stories/c/storydoc.json", 40, "structural"),
        ], () => true);

        expect(rows(container)).toHaveLength(3);
        // Nothing from inside a file reaches the index: a change's own label would be the first sign
        // that a row has started growing with what it stands for.
        expect(container.textContent).not.toContain("documentDiff.structural.property");
    });

    it("draws a closed heading as one line and nothing else", () => {
        const many = Array.from({ length: 200 }, (_, index) => entry(`assets/content/ab/cd/f${index}`, 5));

        const { container } = pane(many, group => !group.collapsed);

        expect(rows(container)).toHaveLength(0);
        expect(container.querySelectorAll("[aria-expanded]")).toHaveLength(1);
        expect(container.querySelector("[aria-expanded]")!.getAttribute("aria-expanded")).toBe("false");
        // The heading still carries the number, so the group is not merely hidden - it says what
        // opening it will cost.
        expect(container.textContent).toContain("200");
    });

    it("states a group's caveat once, not once per row", () => {
        const many = Array.from(
            { length: 5 },
            (_, index) => entry(`assets/content/ab/cd/f${index}`, 2, "structural"),
        );

        const { container } = pane(many, () => true);

        expect(rows(container)).toHaveLength(5);
        expect(container.querySelectorAll("[data-testid='group-caveat']")).toHaveLength(1);
        expect(container.querySelector("[data-testid='group-caveat']")!.textContent)
            .toBe("documentDiff.shell.partial(5)");
    });

    it("says nothing about a group whose files were all read in full", () => {
        const { container } = pane([entry("editor/brand.json", 2)], () => true);

        expect(container.querySelectorAll("[data-testid='group-caveat']")).toHaveLength(0);
    });

    it("names a content file nothing claims, rather than drawing its hash", () => {
        // The one row whose file name says nothing at all. Its path is still in the tooltip, so
        // naming it hides nothing - and leaving it out would hide the state entirely.
        const orphan: DocumentDiffEntry = {
            path: "assets/content/99/55/3d15abb54213bad7203798a1adc4",
            kind: "changed",
            contentClass: "bitmap",
            diff: { changes: [], complete: true, total: 1, tier: "content" },
        };
        // A shard that WAS read record by record, so the absence of a record for these bytes is a
        // fact about the project rather than about how far the comparison got.
        const shard: DocumentDiffEntry = {
            path: "assets/assets.metadata.image.json",
            kind: "changed",
            documentKind: "assets-metadata",
            diff: {
                changes: [{
                    path: ["assets", "11111111-1111-4111-8111-111111111111"],
                    kind: "changed",
                    label: { key: "documentDiff.assets.changed" },
                    subject: "Another picture",
                }],
                complete: true,
                total: 1,
                tier: "semantic",
            },
        };

        const { container } = pane([shard, orphan], () => true);

        expect(rows(container)).toHaveLength(2);
        expect(rows(container)[1].textContent).toContain("documentDiff.assets.orphanContent");
        expect(rows(container)[1].getAttribute("data-tip"))
            .toBe("assets/content/99/55/3d15abb54213bad7203798a1adc4");
    });

    it("draws one line for an asset stored as a record and a file", () => {
        const id = "99553d15-abb5-4213-bad7-203798a1adc4";
        const entries: DocumentDiffEntry[] = [
            {
                path: "assets/assets.metadata.image.json",
                kind: "changed",
                documentKind: "assets-metadata",
                diff: {
                    changes: [{
                        path: ["assets", id],
                        kind: "changed",
                        label: { key: "documentDiff.assets.changed" },
                        subject: "Hero portrait",
                    }],
                    complete: true,
                    total: 1,
                    tier: "semantic",
                },
            },
            {
                path: "assets/content/99/55/3d15abb54213bad7203798a1adc4",
                kind: "changed",
                contentClass: "bitmap",
                diff: { changes: [], complete: true, total: 1, tier: "content" },
            },
        ];

        const { container } = pane(entries, () => true);

        expect(rows(container)).toHaveLength(1);
        expect(rows(container)[0].textContent).toContain("Hero portrait");
        // The second file is in the tooltip, on the discipline every multi-file row follows: a row
        // that grew a line for what it stands for would be the report this pane replaced.
        expect(rows(container)[0].getAttribute("data-tip"))
            .toContain("documentDiff.shell.setFiles(1)");
    });

    it("draws a heading per category, in the model's order", () => {
        const { container } = pane([
            entry("assets/assets.metadata.image.json", 1),
            entry("editor/story/index.json", 1),
        ], () => true);

        const headings = [...container.querySelectorAll("[aria-expanded]")].map(node => node.textContent);
        expect(headings).toEqual([
            "documentDiff.category.story1",
            "documentDiff.category.assets1",
        ]);
    });
});
