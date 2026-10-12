/**
 * The pure-JS SHA-1 against `node:crypto`, and the ids derived from it against the ones the
 * `node:crypto` derivation produced.
 *
 * Element ids a `.ui` file does not state are derived from where the element sits; a template applied
 * twice, or once from the command line and once through Studio's agent bridge, must produce the same
 * ids. So the digest has to be byte-identical to the one these ids were first derived with, across
 * the block boundaries the padding rule makes interesting and across non-ASCII names.
 *
 * Comments in English per project convention.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deriveElementId } from "./model";
import { sha1, toHex } from "./sha1";

/** The derivation as it was written against `node:crypto`, kept here as the reference. */
function referenceElementId(scope: string, elementPathKey: string): string {
    const digest = createHash("sha1").update(`narraleaf-studio:ui-cli\u0000${scope}\u0000${elementPathKey}`).digest();
    const bytes = Buffer.from(digest.subarray(0, 16));
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const INPUTS = [
    "",
    "abc",
    "The quick brown fox jumps over the lazy dog",
    // Either side of the one-block padding limit (55/56 bytes) and the block size itself.
    "a".repeat(55),
    "a".repeat(56),
    "a".repeat(63),
    "a".repeat(64),
    "a".repeat(65),
    "b".repeat(1000),
    "标题页 / 开始按钮",
    "タイトル画面\u0000ボタン",
    "emoji 🍃 leaf",
];

describe("sha1", () => {
    it("matches node:crypto byte for byte", () => {
        for (const input of INPUTS) {
            expect(toHex(sha1(input)), JSON.stringify(input)).toBe(createHash("sha1").update(input, "utf8").digest("hex"));
        }
    });

    it("answers the FIPS 180-4 test vector", () => {
        expect(toHex(sha1("abc"))).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    });
});

describe("deriveElementId", () => {
    it("derives the same ids the node:crypto derivation did", () => {
        const cases: [string, string][] = [
            ["surface:Title", "Title"],
            ["surface:Title", "Title/Menu/Start"],
            ["component:Save slot", "Save slot/Thumbnail"],
            ["surface:标题", "标题/菜单/开始游戏"],
            ["surface:" + "x".repeat(40), "y".repeat(80)],
        ];
        for (const [scope, key] of cases) {
            expect(deriveElementId(scope, key)).toBe(referenceElementId(scope, key));
        }
    });

    it("is a v5-shaped UUID", () => {
        expect(deriveElementId("surface:Title", "Title")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });
});
