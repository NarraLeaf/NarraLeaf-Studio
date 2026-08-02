import { describe, expect, it, vi } from "vitest";
import type { DocumentDiff } from "@shared/documents/diff";
import { defineDocumentSpec } from "@shared/documents/registry";
import type { AnyDocumentSpec } from "@shared/documents/types";
import { DIFF_PARSE_BYTE_CEILING, diffDocumentBytes } from "./documentDiff";

/**
 * The four-tier degradation, one test per rung and one per way of falling off it.
 *
 * The rungs matter more than the rows they produce: a diff that claims a tier it did not
 * reach is the one failure the model cannot express, because every tier renders as a list
 * of changes and only `tier` says which kind of list it is.
 *
 * The specs here are built rather than registered - `defineDocumentSpec` does not touch
 * the registry - so nothing in this file can affect what another test resolves.
 */

const bytes = (value: unknown): Buffer => Buffer.from(JSON.stringify(value), "utf-8");

/** A document format that counts its own entries and nothing else. Stands in for the real five. */
function countingSpec(overrides: Partial<AnyDocumentSpec> = {}): AnyDocumentSpec {
    return {
        ...defineDocumentSpec<{ title?: string; items?: unknown[] }>({
            kind: "story",
            version: 1,
            paths: ["editor/story/index.json"],
            parse: (raw) => raw as { title?: string; items?: unknown[] },
            summarize: (document) => ({
                title: document.title ?? "",
                counts: [{ key: "items", value: document.items?.length ?? 0 }],
            }),
        }),
        ...overrides,
    };
}

describe("tier 1 - a spec that implements diff", () => {
    it("passes the spec's own diff through, tier and all", () => {
        const produced: DocumentDiff = {
            changes: [{ path: ["scene", "1"], kind: "changed", label: { key: "story.line" }, subject: "Prologue" }],
            complete: true,
            total: 1,
            tier: "semantic",
        };
        const spec = countingSpec({ diff: () => produced });

        const diff = diffDocumentBytes({ path: "editor/story/index.json", base: bytes({ a: 1 }), head: bytes({ a: 2 }), spec });

        expect(diff).toEqual(produced);
    });

    it("re-imposes the budget on a spec that ignores it", () => {
        // The contract says `limit` is hard; a spec is code someone else will write later, and one
        // that returns ten thousand rows would otherwise put all of them on an IPC message.
        const spec = countingSpec({
            diff: () => ({
                changes: Array.from({ length: 40 }, (_, index) => ({
                    path: [String(index)],
                    kind: "changed" as const,
                    label: { key: "story.line" },
                })),
                complete: true,
                total: 40,
                tier: "semantic" as const,
            }),
        });

        const diff = diffDocumentBytes(
            { path: "editor/story/index.json", base: bytes({ a: 1 }), head: bytes({ a: 2 }), spec },
            { limit: 5 },
        );

        expect(diff.changes).toHaveLength(5);
        expect(diff.total).toBe(40);
        expect(diff.complete).toBe(false);
        expect(diff.tier).toBe("semantic");
    });

    it("degrades instead of throwing when the spec's diff throws", () => {
        // One throw on this path costs every document in the revision, not one.
        const spec = countingSpec({
            diff: () => {
                throw new Error("cannot align two rebuilt scene trees");
            },
        });
        const onDegrade = vi.fn();

        const diff = diffDocumentBytes(
            { path: "editor/story/index.json", base: bytes({ a: 1 }), head: bytes({ a: 2 }), spec },
            { onDegrade },
        );

        expect(diff.tier).toBe("structural");
        expect(onDegrade).toHaveBeenCalledWith(expect.stringContaining("cannot align two rebuilt scene trees"));
    });

    it("degrades when the spec hands back something that is not a diff", () => {
        const spec = countingSpec({ diff: () => undefined as unknown as DocumentDiff });

        expect(diffDocumentBytes({
            path: "editor/story/index.json",
            base: bytes({ a: 1 }),
            head: bytes({ a: 2 }),
            spec,
        }).tier).toBe("structural");
    });
});

describe("tier 2 - a spec with no diff", () => {
    it("compares what the two sides say about themselves", () => {
        const diff = diffDocumentBytes({
            path: "editor/story/index.json",
            base: bytes({ title: "Prologue", items: [1, 2] }),
            head: bytes({ title: "Prologue", items: [1, 2, 3] }),
            spec: countingSpec(),
        });

        expect(diff.tier).toBe("summary");
        expect(diff.changes).toEqual([{
            path: ["counts", "items"],
            kind: "changed",
            label: { key: "documentDiff.summary.count", params: { name: "items", from: 2, to: 3 } },
        }]);
    });

    it("reports a renamed document with the author's own words on both sides", () => {
        const diff = diffDocumentBytes({
            path: "editor/story/index.json",
            base: bytes({ title: "Prologue", items: [] }),
            head: bytes({ title: "Chapter One", items: [] }),
            spec: countingSpec(),
        });

        expect(diff.changes[0].label.params).toEqual({ from: "Prologue", to: "Chapter One" });
        expect(diff.changes[0].subject).toBe("Chapter One");
    });

    it("says something rather than nothing when the summary cannot see the change", () => {
        // Different bytes with identical summaries. An empty list here would tell the author
        // nothing happened to a file they can see is dirty.
        const diff = diffDocumentBytes({
            path: "editor/story/index.json",
            base: bytes({ title: "", items: [{ id: "a" }] }),
            head: bytes({ title: "", items: [{ id: "b" }] }),
            spec: countingSpec(),
        });

        expect(diff.tier).toBe("summary");
        expect(diff.changes).toEqual([{ path: [], kind: "changed", label: { key: "documentDiff.summary.other" } }]);
    });

    it("falls to the generic tier when the spec rejects one side as corrupt", () => {
        // And emphatically does not quarantine it: these bytes are a revision's, and a copy
        // filed under `.nlstudio/quarantine` would accuse a committed file of being broken.
        const spec = countingSpec({
            parse: (raw, context) => {
                const record = raw as { items?: unknown };
                if (!Array.isArray(record.items)) context.corrupt("items must be an array");
                return record;
            },
        });
        const onDegrade = vi.fn();

        const diff = diffDocumentBytes(
            {
                path: "editor/story/index.json",
                base: bytes({ items: "not an array" }),
                head: bytes({ items: [1] }),
                spec,
            },
            { onDegrade },
        );

        expect(diff.tier).toBe("structural");
        expect(onDegrade).toHaveBeenCalledWith(expect.stringContaining("items must be an array"));
    });
});

describe("tier 3 and 4 - no spec", () => {
    it("compares two JSON documents structurally", () => {
        const diff = diffDocumentBytes({ path: "editor/unknown.json", base: bytes({ a: 1 }), head: bytes({ a: 2 }) });

        expect(diff.tier).toBe("structural");
        expect(diff.changes[0].path).toEqual(["a"]);
    });

    it("reports bytes that are not JSON by size alone", () => {
        const diff = diffDocumentBytes({
            path: "assets/content/ab/cd/portrait.png",
            base: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
            head: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]),
        });

        expect(diff.tier).toBe("opaque");
        expect(diff.changes).toEqual([{
            path: [],
            kind: "changed",
            label: { key: "documentDiff.opaque.changed", params: { fromBytes: 4, toBytes: 5 } },
        }]);
    });

    it("refuses to parse a document over the byte ceiling", () => {
        const huge = Buffer.alloc(DIFF_PARSE_BYTE_CEILING + 1, 0x20);
        const onDegrade = vi.fn();

        const diff = diffDocumentBytes(
            { path: "editor/unknown.json", base: bytes({ a: 1 }), head: huge },
            { onDegrade },
        );

        expect(diff.tier).toBe("opaque");
        expect(onDegrade).toHaveBeenCalledWith(expect.stringContaining("parse ceiling"));
    });
});

describe("a document that exists on one side only", () => {
    it("is one change, not one per field of it", () => {
        const added = bytes({ a: 1, b: 2, c: 3 });
        const diff = diffDocumentBytes({ path: "editor/unknown.json", base: null, head: added });

        expect(diff.changes).toEqual([{
            path: [],
            kind: "added",
            label: { key: "documentDiff.document.added", params: { bytes: added.length } },
        }]);
        expect(diff.tier).toBe("opaque");
    });

    it("carries the document's own title when a spec can read it", () => {
        const diff = diffDocumentBytes({
            path: "editor/story/index.json",
            base: bytes({ title: "Prologue", items: [] }),
            head: null,
            spec: countingSpec(),
        });

        expect(diff.changes[0].kind).toBe("removed");
        expect(diff.changes[0].subject).toBe("Prologue");
        expect(diff.tier).toBe("summary");
    });

    it("answers an empty diff for a path neither side holds", () => {
        // A directory, which the backend reports as a changed path in its own right.
        const diff = diffDocumentBytes({ path: "editor/story", base: null, head: null });

        expect(diff.changes).toEqual([]);
        expect(diff.total).toBe(0);
    });
});

describe("two sides that are the same bytes", () => {
    it("finds nothing and claims nothing", () => {
        const same = bytes({ a: 1 });
        const diff = diffDocumentBytes({ path: "editor/story/index.json", base: same, head: bytes({ a: 1 }), spec: countingSpec() });

        expect(diff.changes).toEqual([]);
        // Not "summary": nothing looked inside, and an empty list is the same list at every tier.
        expect(diff.tier).toBe("opaque");
    });
});
