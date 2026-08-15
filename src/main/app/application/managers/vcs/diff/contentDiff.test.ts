import { describe, expect, it } from "vitest";
import type { DocumentChange } from "@shared/documents/diff";
import { contentClassOf } from "@shared/vcs/contentClass";
import {
    CONTENT_DIFF_PROVIDERS,
    CONTENT_HEAD_BYTE_CEILING,
    contentProviderFor,
    pairMoves,
    probesMatch,
    type ContentProbe,
    type ContentSide,
} from "./contentDiff";
import { diffDocumentContent } from "./documentDiff";

/**
 * The providers, and the two-phase contract they are the point of.
 *
 * Everything here is pure: a provider is handed a probe and at most a prefix, and answers rows.
 * What is worth pinning is not mostly the wording of a row - it is that a provider asks for a
 * bounded prefix or none at all, that it says nothing it cannot see, and that a file which
 * merely moved is recognised without anybody reading it.
 */

const side = (size: number, head?: Buffer, hash?: string): ContentSide => ({
    probe: { size, ...(hash ? { hash } : {}) },
    ...(head ? { head } : {}),
});

function rows(path: string, a: ContentSide | null, b: ContentSide | null): readonly DocumentChange[] {
    return diffDocumentContent({ path, contentClass: contentClassOf(path), base: a, head: b }).changes;
}

function keys(changes: readonly DocumentChange[]): string[] {
    return changes.map((change) => change.label.key);
}

/** A real PNG signature plus an IHDR, which is all `readImageDimensions` needs. */
function png(width: number, height: number): Buffer {
    const out = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(out, 0);
    out.writeUInt32BE(13, 8);
    out.write("IHDR", 12);
    out.writeUInt32BE(width, 16);
    out.writeUInt32BE(height, 20);
    return out;
}

/** MPEG-1 Layer III at the given rate index, with a Xing frame count. */
function mp3(rateIndex: number, frames: number): Buffer {
    const frame = Buffer.from([0xff, 0xfb, 0x90 | (rateIndex << 2), 0x00]);
    const xing = Buffer.alloc(12);
    xing.write("Xing", 0);
    xing.writeUInt32BE(0x01, 4);
    xing.writeUInt32BE(frames, 8);
    return Buffer.concat([frame, Buffer.alloc(32), xing, Buffer.alloc(16)]);
}

describe("the registry", () => {
    it("has a provider for every path, so no caller needs a fallback", () => {
        for (const path of ["a.png", "a.mp3", "a.mp4", "a.ttf", "a.moc3", "a.qqq", "a.txt", "noextension"]) {
            expect(contentProviderFor(path, contentClassOf(path)).id).toBeTruthy();
        }
    });

    it("routes each class to the provider named after it", () => {
        expect(contentProviderFor("a/b.png", "bitmap").id).toBe("bitmap");
        expect(contentProviderFor("a/b.mp3", "audio").id).toBe("audio");
        expect(contentProviderFor("a/b.mp4", "video").id).toBe("video");
        expect(contentProviderFor("a/b.ttf", "font").id).toBe("font");
        expect(contentProviderFor("a/b.moc3", "model").id).toBe("model");
        expect(contentProviderFor("a/b.qqq", "unknown").id).toBe("unknown");
        // A class whose bytes were worth reading, that some budget declined to read.
        expect(contentProviderFor("a/b.txt", "text").id).toBe("opaque");
    });

    /**
     * The bound the whole arrangement rests on.
     *
     * A provider that asked for a megabyte would quietly turn "describe an asset" back into
     * "read an asset", which is the defect this tier was built to remove - and it would do it
     * without changing a single row of output, so nothing else here would notice.
     */
    it("keeps every provider's appetite inside the ceiling", () => {
        for (const provider of CONTENT_DIFF_PROVIDERS) {
            expect(provider.headBytes, provider.id).toBeLessThanOrEqual(CONTENT_HEAD_BYTE_CEILING);
        }
        expect(CONTENT_HEAD_BYTE_CEILING).toBeLessThanOrEqual(64 * 1024);
    });

    /**
     * The strongest form of the invariant, stated per provider.
     *
     * `headBytes: 0` is a promise that describing one of these files causes no read at all, and
     * for the model provider it is a design decision rather than an omission: Studio must never
     * learn to parse `.moc3` or `.skel` (see `shared/utils/modelBundle.ts`).
     */
    it("reads nothing whatsoever for a model binary or an unrecognised file", () => {
        expect(contentProviderFor("a/b.moc3", "model").headBytes).toBe(0);
        expect(contentProviderFor("a/b.qqq", "unknown").headBytes).toBe(0);
        expect(contentProviderFor("a/b.txt", "text").headBytes).toBe(0);
    });
});

describe("bitmaps", () => {
    it("puts a resolution change in a row of its own", () => {
        // Separate from the size row because a sprite that is suddenly half as wide is a broken
        // scene, and a re-export at a different file size is a detail.
        const changes = rows("assets/content/face.png", side(2048, png(512, 512)), side(4096, png(256, 256)));

        expect(changes[0]).toEqual({
            path: ["dimensions"],
            kind: "changed",
            label: {
                key: "documentDiff.content.dimensions",
                params: { fromWidth: 512, fromHeight: 512, toWidth: 256, toHeight: 256 },
            },
        });
        expect(keys(changes)).toEqual(["documentDiff.content.dimensions", "documentDiff.content.size"]);
    });

    it("says only the size changed when the resolution did not", () => {
        const changes = rows("assets/content/face.png", side(2048, png(512, 512)), side(9000, png(512, 512)));
        expect(keys(changes)).toEqual(["documentDiff.content.size"]);
    });

    it("says the header was not read when it was not given one", () => {
        // The revision side of a large file: the backend has no ranged fetch, so a prefix costs
        // the whole blob and the comparison declined to pay it.
        const changes = rows("assets/content/huge.png", side(90_000_000), side(90_000_000));
        expect(keys(changes)).toEqual(["documentDiff.content.notInspected"]);
    });

    it("reads the dimensions out of the bytes, not out of the name", () => {
        // A `.png` that is really a JPEG still gets its dimensions, because the provider
        // confirms the format from the header rather than trusting the extension.
        const jpeg = Buffer.from([
            0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x02, 0x8a, 0x03, 0x01, 0x22, 0x00,
        ]);
        const other = Buffer.from(jpeg);
        other.writeUInt16BE(600, 7);

        const changes = rows("assets/content/mislabelled.png", side(100, jpeg), side(120, other));
        expect(changes[0].label.params).toEqual({
            fromWidth: 650, fromHeight: 300, toWidth: 650, toHeight: 600,
        });
    });
});

describe("sound", () => {
    it("reports the length and the sample rate", () => {
        const changes = rows("assets/content/bgm.mp3", side(3_000, mp3(0, 1000)), side(4_000, mp3(1, 2000)));

        expect(keys(changes)).toEqual([
            "documentDiff.content.duration",
            "documentDiff.content.sampleRate",
            "documentDiff.content.size",
        ]);
        expect(changes[1].label.params).toEqual({ fromHertz: 44100, toHertz: 48000 });
    });

    it("says the contents changed when the header reports the same numbers", () => {
        // Three separate facts - read and unchanged, not read, and never readable - and this is
        // the first. Collapsing them would leave an author unable to tell a budget from a wall.
        const same = mp3(0, 1000);
        const changes = rows("assets/content/bgm.mp3", side(3_000, same), side(3_000, Buffer.from(same)));
        expect(keys(changes)).toEqual(["documentDiff.content.changed"]);
    });
});

describe("fonts", () => {
    it("carries the family as the author's own word", () => {
        const font = (family: string): Buffer => {
            const text = Buffer.from(family, "utf16le").swap16();
            const name = Buffer.concat([
                Buffer.from([0, 0, 0, 1, 0, 18]),
                Buffer.from([0, 3, 0, 1, 4, 9, 0, 1, 0, text.length, 0, 0]),
                text,
            ]);
            const head = Buffer.alloc(28);
            head.writeUInt32BE(0x00010000, 0);
            head.writeUInt16BE(1, 4);
            head.write("name", 12);
            head.writeUInt32BE(28, 20);
            head.writeUInt32BE(name.length, 24);
            return Buffer.concat([head, name]);
        };

        const changes = rows("assets/content/ui.ttf", side(400, font("Inter")), side(420, font("Noto Sans")));

        expect(changes[0].label).toEqual({
            key: "documentDiff.content.family",
            params: { from: "Inter", to: "Noto Sans" },
        });
        // `subject` is defined to hold what the author wrote, and a family name is exactly that -
        // unlike a dimension, which Studio computed.
        expect(changes[0].subject).toBe("Noto Sans");
    });
});

describe("formats nobody here reads", () => {
    it("tells an unrecognised format from an uninspected one", () => {
        expect(keys(rows("a/b.qqq", side(10, undefined, "x"), side(20, undefined, "y"))))
            .toEqual(["documentDiff.content.unrecognized", "documentDiff.content.size"]);
        expect(keys(rows("a/b.txt", side(10), side(20))))
            .toEqual(["documentDiff.content.notInspected", "documentDiff.content.size"]);
    });

    it("says a model binary changed and nothing else, ever", () => {
        expect(keys(rows("assets/content/hiyori/Hiyori.moc3", side(1000), side(2000))))
            .toEqual(["documentDiff.content.size"]);
    });
});

describe("a file on one side only", () => {
    it("is one row, whatever its header would have said", () => {
        // Listing every field of a new file as a change would spend a budget restating one act -
        // the same call `presenceDiff` makes for documents.
        expect(rows("assets/content/new.png", null, side(2048, png(64, 64)))).toEqual([{
            path: [],
            kind: "added",
            label: { key: "documentDiff.document.added", params: { bytes: 2048 } },
        }]);
        expect(rows("assets/content/gone.png", side(64), null)[0].kind).toBe("removed");
    });

    it("is nothing at all when neither side holds it", () => {
        expect(rows("assets/content", null, null)).toEqual([]);
    });
});

describe("deciding two files hold the same bytes", () => {
    const probe = (size: number, hash?: string): ContentProbe => ({ size, ...(hash ? { hash } : {}) });

    it("needs the address AND the size, never either alone", () => {
        expect(probesMatch(probe(10, "a"), probe(10, "a"))).toBe(true);
        expect(probesMatch(probe(10, "a"), probe(11, "a"))).toBe(false);
        expect(probesMatch(probe(10, "a"), probe(10, "b"))).toBe(false);
        // A working-tree file has no address at all, and must never be paired on its length.
        expect(probesMatch(probe(10), probe(10))).toBe(false);
        expect(probesMatch(undefined, probe(10, "a"))).toBe(false);
    });

    it("pairs a removal with the addition holding the same bytes", () => {
        const pairs = pairMoves(
            new Map([["old/a.png", probe(10, "h1")], ["old/b.png", probe(20, "h2")]]),
            new Map([["new/a.png", probe(10, "h1")], ["new/b.png", probe(20, "h2")]]),
        );
        expect([...pairs]).toEqual([["new/a.png", "old/a.png"], ["new/b.png", "old/b.png"]]);
    });

    it("consumes each removal once, so two additions of one file are not both moves", () => {
        const pairs = pairMoves(
            new Map([["old/a.png", probe(10, "h1")]]),
            new Map([["new/a.png", probe(10, "h1")], ["new/b.png", probe(10, "h1")]]),
        );
        expect([...pairs]).toEqual([["new/a.png", "old/a.png"]]);
    });

    it("answers the same way every time when the bytes are indistinguishable", () => {
        // Two placeholders with identical contents have no fact saying which became which. What
        // must not happen is the answer changing between two reads of the same pair of versions.
        const removed = new Map([["z/one.bin", probe(4, "h")], ["a/two.bin", probe(4, "h")]]);
        const added = new Map([["q/one.bin", probe(4, "h")], ["b/two.bin", probe(4, "h")]]);
        expect([...pairMoves(removed, added)]).toEqual([...pairMoves(removed, added)]);
        expect([...pairMoves(removed, added)]).toEqual([["b/two.bin", "a/two.bin"], ["q/one.bin", "z/one.bin"]]);
    });

    it("pairs nothing when one side has no addresses", () => {
        expect([...pairMoves(new Map([["a", probe(4)]]), new Map([["b", probe(4)]]))]).toEqual([]);
    });
});
