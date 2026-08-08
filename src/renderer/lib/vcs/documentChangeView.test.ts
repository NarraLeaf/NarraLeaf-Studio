import { describe, expect, it } from "vitest";
import { buildDocumentDiff, type DocumentChange, type DocumentDiff } from "@shared/documents/diff";
import {
    buildDocumentChangeRows,
    documentDiffTierCaption,
    formatBytes,
    resolveDocumentChangeLabel,
    type LabelTranslator,
} from "./documentChangeView";

/**
 * The half of a change list that can be wrong without a screenshot showing it: how many rows fit,
 * which ones survive, how many were left out, and how a key plus parameters becomes text.
 *
 * There are no component-render tests in this codebase, which is why these decisions live in a module
 * of their own rather than inside the two components that draw them.
 */

/** A translator with a fixed catalogue, so a test asserts on WHICH key was asked for. */
function translatorFor(catalog: Record<string, string>): LabelTranslator {
    return {
        has: (key: string) => key in catalog,
        t: ((key: string, params?: Record<string, string | number>) => {
            const template = catalog[key];
            if (template === undefined) {
                return key;
            }
            return template.replace(/\{(\w+)\}/g, (match, name: string) =>
                params && name in params ? String(params[name]) : match);
        }) as LabelTranslator["t"],
    };
}

function leaf(name: string, kind: DocumentChange["kind"] = "changed"): DocumentChange {
    return { path: [name], kind, label: { key: "documentDiff.structural.property", params: { name } } };
}

describe("buildDocumentChangeRows", () => {
    it("keeps the head of an already ordered list rather than picking from it", () => {
        const diff = buildDocumentDiff([leaf("a"), leaf("b"), leaf("c")], { tier: "structural", limit: 10 });

        const rows = buildDocumentChangeRows(diff, 2);

        expect(rows.rows.map(row => row.change.path[0])).toEqual(["a", "b"]);
        expect(rows.hidden).toBe(1);
        expect(rows.total).toBe(3);
    });

    it("counts a group by its children, and its own dropped children as hidden", () => {
        const group: DocumentChange = {
            path: ["scenes"],
            kind: "changed",
            label: { key: "documentDiff.structural.property", params: { name: "scenes" } },
            children: [leaf("one"), leaf("two")],
            // The producer already gave up on three of them; they are part of `total` and must stay
            // part of what the surface is told is missing.
            truncated: 3,
        };
        const diff = buildDocumentDiff([group], { tier: "structural", limit: 10, total: 5 });

        const all = buildDocumentChangeRows(diff, 10);
        expect(all.rows).toHaveLength(3);
        expect(all.rows[0].truncated).toBe(3);
        expect(all.hidden).toBe(3);

        // Room for the header and one child only: the group is kept with what fits, never dropped.
        const cut = buildDocumentChangeRows(diff, 2);
        expect(cut.rows.map(row => row.depth)).toEqual([0, 1]);
        expect(cut.rows[0].truncated).toBe(4);
        expect(cut.hidden).toBe(4);
    });

    it("keeps a group's header even when no child fits, so the group is never silently absent", () => {
        const group: DocumentChange = {
            path: ["scenes"],
            kind: "changed",
            label: { key: "documentDiff.structural.property" },
            children: [leaf("one"), leaf("two")],
        };
        const diff = buildDocumentDiff([group], { tier: "structural", limit: 10 });

        const rows = buildDocumentChangeRows(diff, 1);

        expect(rows.rows).toHaveLength(1);
        expect(rows.rows[0].truncated).toBe(2);
        expect(rows.hidden).toBe(2);
    });

    it("says nothing is hidden when the whole list is on screen", () => {
        const diff = buildDocumentDiff([leaf("a")], { tier: "semantic", limit: 10 });

        expect(buildDocumentChangeRows(diff, 8).hidden).toBe(0);
    });

    it("still reports something hidden when the PRODUCER truncated and the surface did not", () => {
        // This is what makes `hidden > 0` a sound stand-in for `DocumentDiff.complete === false`:
        // a surface with room to spare must not read a producer-truncated diff as a whole one.
        const diff = buildDocumentDiff([leaf("a")], { tier: "structural", limit: 1, total: 40 });

        expect(diff.complete).toBe(false);
        expect(buildDocumentChangeRows(diff, 1000).hidden).toBe(39);
    });

    it("gives every row a distinct key, including two changes at the document root", () => {
        const root = (kind: DocumentChange["kind"]): DocumentChange =>
            ({ path: [], kind, label: { key: "documentDiff.opaque.changed" } });
        const diff = buildDocumentDiff([root("added"), root("removed")], { tier: "opaque", limit: 10 });

        const keys = buildDocumentChangeRows(diff, 8).rows.map(row => row.key);

        expect(new Set(keys).size).toBe(keys.length);
    });
});

describe("resolveDocumentChangeLabel", () => {
    const catalog = {
        "documentDiff.structural.property": "{name}",
        "documentDiff.summary.count": "{name}",
        "documentDiff.summary.title": "Name",
        "documentDiff.count.audioTracks": "Audio tracks",
        "documentDiff.document.added": "Added ({bytes})",
    };

    it("draws from/to as values instead of folding them into the sentence", () => {
        const view = resolveDocumentChangeLabel(
            {
                path: ["volume"],
                kind: "changed",
                label: { key: "documentDiff.structural.property", params: { name: "volume", from: 0.8, to: 0.9 } },
                subject: "volume",
            },
            translatorFor(catalog),
        );

        expect(view).toEqual({ primary: "volume", from: "0.8", to: "0.9" });
    });

    it("does not print the author's own word twice", () => {
        const translator = translatorFor(catalog);

        // The subject IS the label's `name` parameter at the structural tier.
        expect(resolveDocumentChangeLabel(
            { path: ["title"], kind: "changed", label: { key: "documentDiff.structural.property", params: { name: "title" } }, subject: "title" },
            translator,
        ).detail).toBeUndefined();

        // ...and it is the new VALUE on a summary title change.
        expect(resolveDocumentChangeLabel(
            { path: ["title"], kind: "changed", label: { key: "documentDiff.summary.title", params: { from: "a", to: "b" } }, subject: "b" },
            translator,
        )).toEqual({ primary: "Name", from: "a", to: "b" });
    });

    it("leads with the subject when the label does not carry it", () => {
        const view = resolveDocumentChangeLabel(
            {
                path: [],
                kind: "added",
                label: { key: "documentDiff.document.added", params: { bytes: 2048 } },
                subject: "Chapter One",
            },
            translatorFor(catalog),
        );

        expect(view.primary).toBe("Chapter One");
        expect(view.detail).toBe("Added (2.0 KB)");
    });

    it("translates a summary count's name, and falls back to the raw identifier", () => {
        const translator = translatorFor(catalog);

        expect(resolveDocumentChangeLabel(
            { path: ["counts", "audioTracks"], kind: "changed", label: { key: "documentDiff.summary.count", params: { name: "audioTracks", from: 3, to: 4 } } },
            translator,
        )).toEqual({ primary: "Audio tracks", from: "3", to: "4" });

        // A spec may add a count before anyone translates it; the identifier beats a dotted key.
        expect(resolveDocumentChangeLabel(
            { path: ["counts", "puppets"], kind: "added", label: { key: "documentDiff.summary.count", params: { name: "puppets", to: 2 } } },
            translator,
        )).toEqual({ primary: "puppets", to: "2" });
    });

    it("renders an unknown producer key as itself rather than as nothing", () => {
        const view = resolveDocumentChangeLabel(
            { path: [], kind: "changed", label: { key: "documentDiff.someone.renamed.this" } },
            translatorFor(catalog),
        );

        expect(view.primary).toBe("documentDiff.someone.renamed.this");
    });
});

describe("documentDiffTierCaption", () => {
    it("captions every tier except the one whose rows mean what they appear to mean", () => {
        expect(documentDiffTierCaption("semantic")).toBeNull();
        for (const tier of ["summary", "structural", "opaque"] as const) {
            const caption = documentDiffTierCaption(tier);
            expect(caption, `${tier} must be captioned`).not.toBeNull();
            expect(caption!.key).not.toBe(caption!.hintKey);
        }
    });

    it("gives a structural diff a different caption from a semantic one, which is the whole point", () => {
        const structural: DocumentDiff = buildDocumentDiff([leaf("a")], { tier: "structural", limit: 8 });
        const semantic: DocumentDiff = buildDocumentDiff([leaf("a")], { tier: "semantic", limit: 8 });

        expect(documentDiffTierCaption(structural.tier)).not.toEqual(documentDiffTierCaption(semantic.tier));
    });
});

describe("formatBytes", () => {
    it("reads as a size at every scale, and refuses to invent one", () => {
        expect(formatBytes(0)).toBe("0 B");
        expect(formatBytes(1023)).toBe("1023 B");
        expect(formatBytes(2048)).toBe("2.0 KB");
        expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
        expect(formatBytes(Number.NaN)).toBe("—");
    });
});
