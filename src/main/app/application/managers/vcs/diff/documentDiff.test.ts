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

    it("hands an asset to the content step rather than reporting it as raw bytes", () => {
        // The step between structural and opaque. These two are truncated PNG signatures, so no
        // dimensions come out of them, and the size row is what is left - but it is the content
        // step's row, which is how a real PNG gets a dimension row beside it.
        const diff = diffDocumentBytes({
            path: "assets/content/ab/cd/portrait.png",
            base: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
            head: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]),
        });

        // `content`, not `opaque`, and the difference is a sentence the author reads: `opaque`'s
        // caption says "Not read. Too large, not text, or unreadable. Only its size is reported",
        // which would sit directly above a row naming this file's dimensions. A provider that
        // opens the header earns the rung that says so; one that reads no header stays on
        // `opaque`, which the `.blend` case below pins.
        expect(diff.tier).toBe("content");
        expect(diff.changes).toEqual([{
            path: ["size"],
            kind: "changed",
            label: { key: "documentDiff.content.size", params: { fromBytes: 4, toBytes: 5 } },
        }]);
    });

    it("keeps a format nobody can open on the tier that admits it read nothing", () => {
        // The other half of the rule above, and the reason the rule is on `headBytes` rather than
        // on "the content step ran": this file went through the same step and came out with a
        // size row, because there is no reader for it. "Only its size is reported" is the whole
        // truth here, so `opaque` and its caption are the honest pair.
        const diff = diffDocumentBytes({
            path: "assets/content/ab/cd/scene.blend",
            base: Buffer.from([0x42, 0x4c, 0x45, 0x4e]),
            head: Buffer.from([0x42, 0x4c, 0x45, 0x4e, 0x44]),
        });

        expect(diff.tier).toBe("opaque");
    });

    it("reports text that is not JSON by size alone, without calling the format unrecognised", () => {
        // The content step is skipped for a path whose class says its bytes were worth reading.
        // "Studio does not recognise this format" about an author's `.txt` would be false.
        const diff = diffDocumentBytes({
            path: "notes/todo.txt",
            base: Buffer.from("one"),
            head: Buffer.from("two!"),
        });

        expect(diff.tier).toBe("opaque");
        expect(diff.changes).toEqual([{
            path: [],
            kind: "changed",
            label: { key: "documentDiff.opaque.changed", params: { fromBytes: 3, toBytes: 4 } },
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

/**
 * The path shape a real project actually holds, which is where this whole step was silently dead.
 *
 * Studio writes an asset's contents under its id, sharded two levels deep and with no extension:
 * `assets/content/99/55/3d15abb54213bad7203798a1adc4`. Everything above classifies by name, so
 * every one of those was `unknown`, and `unknown` means "read it, it might be JSON" - which read
 * both copies of a sprite in full and then reported two byte counts. Measured in the app: a
 * 1088x1984 PNG replaced by a 1024x1024 one said "Not read - Changed (1.6 MB -> 226.6 KB)".
 *
 * These fixtures therefore use the shard shape and nothing else. A test written against
 * `assets/content/ab/cd/portrait.png` passes either way, which is exactly how the defect got past
 * a full round of them.
 */
describe("an asset stored under its id, with no extension to read", () => {
    const SHARD = "assets/content/99/55/3d15abb54213bad7203798a1adc4";

    /** A PNG signature, an IHDR and as much filler as the file is supposed to weigh. */
    function png(width: number, height: number, size = 64): Buffer {
        const out = Buffer.alloc(Math.max(size, 33), 0x7f);
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(out, 0);
        out.writeUInt32BE(13, 8);
        out.write("IHDR", 12);
        out.writeUInt32BE(width, 16);
        out.writeUInt32BE(height, 20);
        return out;
    }

    /** A 44-byte WAVE header whose `data` chunk declares a length it does not carry. */
    function wav(sampleRate: number, seconds: number): Buffer {
        const channels = 2;
        const byteRate = sampleRate * channels * 2;
        const out = Buffer.alloc(44);
        out.write("RIFF", 0);
        out.writeUInt32LE(36 + byteRate * seconds, 4);
        out.write("WAVE", 8);
        out.write("fmt ", 12);
        out.writeUInt32LE(16, 16);
        out.writeUInt16LE(1, 20);
        out.writeUInt16LE(channels, 22);
        out.writeUInt32LE(sampleRate, 24);
        out.writeUInt32LE(byteRate, 28);
        out.writeUInt16LE(channels * 2, 32);
        out.writeUInt16LE(16, 34);
        out.write("data", 36);
        out.writeUInt32LE(byteRate * seconds, 40);
        return out;
    }

    const keys = (diff: DocumentDiff): string[] => diff.changes.map((change) => change.label.key);

    it("names the resolution of a bitmap that has no name to be read", () => {
        const diff = diffDocumentBytes({
            path: SHARD,
            base: png(1088, 1984, 1_600_000),
            head: png(1024, 1024, 226_000),
        });

        // `content`, whose caption is "Format only". Not `opaque`, whose caption is "Not read" -
        // the sentence that was on screen above this file's size row.
        expect(diff.tier).toBe("content");
        expect(diff.changes[0]).toEqual({
            path: ["dimensions"],
            kind: "changed",
            label: {
                key: "documentDiff.content.dimensions",
                params: { fromWidth: 1088, fromHeight: 1984, toWidth: 1024, toHeight: 1024 },
            },
        });
        expect(keys(diff)).toEqual(["documentDiff.content.dimensions", "documentDiff.content.size"]);
    });

    it("names the length of a sound the same way", () => {
        const diff = diffDocumentBytes({ path: SHARD, base: wav(44_100, 12), head: wav(44_100, 30) });

        expect(diff.tier).toBe("content");
        expect(keys(diff)).toEqual(["documentDiff.content.duration"]);
        expect(diff.changes[0].label.params).toEqual({ fromSeconds: 12, toSeconds: 30 });
    });

    it("recognises a font under an id as a font", () => {
        // Nothing here reads the family - the name table is past these bytes - so what is pinned
        // is the rung. `content` says the format was recognised and what it reports was compared;
        // `unknown`'s provider would instead have claimed Studio cannot read the format at all.
        const font = (size: number): Buffer => {
            const out = Buffer.alloc(size, 0x11);
            out.write("OTTO", 0);
            return out;
        };

        const diff = diffDocumentBytes({ path: SHARD, base: font(900), head: font(1200) });

        expect(diff.tier).toBe("content");
        expect(keys(diff)).toEqual(["documentDiff.content.size"]);
    });

    it("falls back to two byte counts for bytes nothing recognises", () => {
        // The honest half of the same change. No header placed these, so the class stays
        // `unknown`, the content step is never reached, and `opaque` plus its "Not read" caption
        // is the true pair rather than the false one.
        const diff = diffDocumentBytes({
            path: SHARD,
            base: Buffer.from("QRSTUVWXYZ not a format anybody knows"),
            head: Buffer.from("QRSTUVWXYZ still not a format anybody knows"),
        });

        expect(diff.tier).toBe("opaque");
        expect(keys(diff)).toEqual(["documentDiff.opaque.changed"]);
    });

    it("still parses a document that happens to live under an id", () => {
        // Non-vacuous the other way: the sniff must not stop an extensionless JSON being read as
        // JSON. Nothing places `{`, so the class stays `unknown` and the structural tier answers.
        const diff = diffDocumentBytes({
            path: SHARD,
            base: bytes({ a: 1 }),
            head: bytes({ a: 2 }),
        });

        expect(diff.tier).toBe("structural");
    });

    it("takes the class from the caller when the caller already settled it", () => {
        // The working-tree side probes the file's front before planning, so it arrives knowing.
        // Passing it through has to actually route the comparison, or the probe bought nothing.
        const diff = diffDocumentBytes({
            path: SHARD,
            contentClass: "bitmap",
            base: png(64, 64, 100),
            head: png(32, 32, 120),
        });

        expect(diff.tier).toBe("content");
        expect(keys(diff)).toContain("documentDiff.content.dimensions");
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
