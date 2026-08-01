import { describe, expect, it } from "vitest";
import { detectTextEncodingFromBom, type TextEncodingId } from "@shared/types/textEncoding";
import { decodeTextBytes, encodeTextBytes, resolveTextEncodingId } from "./textCodec";

/**
 * Round-trips for the text editor's save path.
 *
 * The assertion that matters is not `decode(encode(x)) === x` on its own - a codec that encoded
 * everything as UTF-8 would pass that. Each case also pins the *bytes*, because the bug this
 * guards against is a save that claims to be GBK and writes UTF-8: the file reads back correctly
 * in Studio and is mojibake in every other tool the author shares it with.
 */

const SAMPLE = "计划表 plan v2\nRow\t1";
/**
 * Shift_JIS has no simplified Chinese: 计 and 划 are not in it, and asking for them back would
 * assert that a codec can invent characters its codepage does not contain. The shared traditional
 * forms are the honest CJK sample for it.
 */
const SAMPLE_SJIS = "計画表 plan v2\nRow\t1";

describe("text codec round-trip", () => {
    const cases: Array<[TextEncodingId, string, string]> = [
        ["utf8", "UTF-8", SAMPLE],
        ["utf8bom", "UTF-8 with BOM", SAMPLE],
        ["utf16le", "UTF-16 LE", SAMPLE],
        ["gbk", "GBK", SAMPLE],
        ["shiftjis", "Shift_JIS", SAMPLE_SJIS],
    ];

    for (const [encoding, label, sample] of cases) {
        it(`round-trips CJK text through ${label}`, () => {
            const bytes = encodeTextBytes(sample, encoding);
            expect(decodeTextBytes(bytes, encoding)).toBe(sample);
        });
    }

    it("round-trips the remaining CJK and Latin encodings", () => {
        expect(decodeTextBytes(encodeTextBytes("中文 GB18030", "gb18030"), "gb18030")).toBe("中文 GB18030");
        expect(decodeTextBytes(encodeTextBytes("繁體中文", "big5"), "big5")).toBe("繁體中文");
        expect(decodeTextBytes(encodeTextBytes("한국어", "euckr"), "euckr")).toBe("한국어");
        expect(decodeTextBytes(encodeTextBytes("naïve — café", "windows1252"), "windows1252")).toBe("naïve — café");
        expect(decodeTextBytes(encodeTextBytes("naïve café", "iso88591"), "iso88591")).toBe("naïve café");
        expect(decodeTextBytes(encodeTextBytes(SAMPLE, "utf16be"), "utf16be")).toBe(SAMPLE);
    });
});

describe("text codec byte shapes", () => {
    it("writes GBK bytes, not UTF-8 ones", () => {
        // 中文 is D6 D0 CE C4 in GBK and E4 B8 AD E6 96 87 in UTF-8.
        expect([...encodeTextBytes("中文", "gbk")]).toEqual([0xd6, 0xd0, 0xce, 0xc4]);
        expect([...encodeTextBytes("中文", "utf8")]).toEqual([0xe4, 0xb8, 0xad, 0xe6, 0x96, 0x87]);
    });

    it("writes Shift_JIS bytes for kana", () => {
        // あ is 82 A0 in Shift_JIS.
        expect([...encodeTextBytes("あ", "shiftjis")]).toEqual([0x82, 0xa0]);
    });

    it("puts a mark on utf8bom and none on utf8", () => {
        expect([...encodeTextBytes("a", "utf8bom")]).toEqual([0xef, 0xbb, 0xbf, 0x61]);
        expect([...encodeTextBytes("a", "utf8")]).toEqual([0x61]);
    });

    it("puts the right mark on each UTF-16 order", () => {
        expect([...encodeTextBytes("a", "utf16le")]).toEqual([0xff, 0xfe, 0x61, 0x00]);
        expect([...encodeTextBytes("a", "utf16be")]).toEqual([0xfe, 0xff, 0x00, 0x61]);
    });
});

describe("byte-order marks", () => {
    it("strips the mark on decode so it never reaches the document", () => {
        expect(decodeTextBytes(Buffer.from([0xef, 0xbb, 0xbf, 0x61]), "utf8bom")).toBe("a");
        // Same bytes read as plain UTF-8: still no stray U+FEFF in the text.
        expect(decodeTextBytes(Buffer.from([0xef, 0xbb, 0xbf, 0x61]), "utf8")).toBe("a");
        expect(decodeTextBytes(Buffer.from([0xff, 0xfe, 0x61, 0x00]), "utf16le")).toBe("a");
        expect(decodeTextBytes(Buffer.from([0xfe, 0xff, 0x00, 0x61]), "utf16be")).toBe("a");
    });

    it("does not grow a second mark when the text already carries one", () => {
        expect([...encodeTextBytes("﻿a", "utf8bom")]).toEqual([0xef, 0xbb, 0xbf, 0x61]);
    });

    it("detects the encoding a mark declares, and nothing else", () => {
        expect(detectTextEncodingFromBom(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe("utf8bom");
        expect(detectTextEncodingFromBom(new Uint8Array([0xff, 0xfe, 0x61, 0x00]))).toBe("utf16le");
        expect(detectTextEncodingFromBom(new Uint8Array([0xfe, 0xff, 0x00, 0x61]))).toBe("utf16be");
        expect(detectTextEncodingFromBom(new Uint8Array([0xd6, 0xd0]))).toBeNull();
        expect(detectTextEncodingFromBom(new Uint8Array([]))).toBeNull();
    });
});

describe("encoding id resolution", () => {
    it("maps the hyphenated Node spellings onto the ids", () => {
        expect(resolveTextEncodingId("utf-8")).toBe("utf8");
        expect(resolveTextEncodingId("utf8")).toBe("utf8");
        expect(resolveTextEncodingId("utf-16le")).toBe("utf16le");
    });

    it("leaves byte transports to Node", () => {
        expect(resolveTextEncodingId("base64")).toBeNull();
        expect(resolveTextEncodingId("hex")).toBeNull();
        expect(resolveTextEncodingId("latin1")).toBeNull();
        expect(resolveTextEncodingId(undefined)).toBeNull();
    });
});
