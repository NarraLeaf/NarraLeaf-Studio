import { describe, expect, it } from "vitest";
import {
    assetStorageIdFromContentPath,
    assetStorageIdFromShards,
    isValidAssetStorageId,
    splitAssetStorageId,
} from "./assetStorageId";

describe("asset storage ids", () => {
    const uuid = "123e4567-e89b-12d3-a456-426614174000";
    const sha256 = "a".repeat(64);

    it("accepts generated UUIDs and legacy SHA-256 hashes", () => {
        expect(isValidAssetStorageId(uuid)).toBe(true);
        expect(isValidAssetStorageId(sha256)).toBe(true);
        expect(splitAssetStorageId(uuid)).toEqual([
            "12",
            "3e",
            "4567e89b12d3a456426614174000",
        ]);
    });

    it("rejects ids that could become path traversal segments", () => {
        expect(isValidAssetStorageId("aaaa../../../../../victim.txt")).toBe(false);
        expect(isValidAssetStorageId("/tmp/asset")).toBe(false);
        expect(() => splitAssetStorageId("aaaa../../../../../victim.txt")).toThrow("Invalid asset storage id");
    });
});

/**
 * A deterministic hex source. Reproducibility matters more than statistical quality here: a
 * failure has to be reproducible from the file alone, without a recorded seed.
 */
function hexStream(seed: number): () => string {
    let state = seed >>> 0;
    return () => {
        // Numerical Recipes' LCG constants; any full-period generator would do.
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return (state >>> 28).toString(16);
    };
}

function hexString(next: () => string, length: number): string {
    let out = "";
    for (let index = 0; index < length; index++) {
        out += next();
    }
    return out;
}

function hyphenate(hex32: string): string {
    return [
        hex32.slice(0, 8),
        hex32.slice(8, 12),
        hex32.slice(12, 16),
        hex32.slice(16, 20),
        hex32.slice(20),
    ].join("-");
}

/**
 * Candidate strings for the round-trip property below. Deliberately a mix of ids and near-misses:
 * the property is asserted over whatever `isValidAssetStorageId` picks out of this corpus, so the
 * accepted set is derived rather than hand-listed, and a widening of that predicate is picked up
 * here without anyone remembering to edit an example.
 */
function candidateIds(): string[] {
    const next = hexStream(0x5eed);
    const candidates: string[] = [];

    for (let round = 0; round < 24; round++) {
        const hex32 = hexString(next, 32);
        const hex64 = hexString(next, 64);

        // Shapes that are ids.
        candidates.push(hyphenate(hex32), hex64);
        // The same ids in the other cases the predicate accepts.
        candidates.push(hyphenate(hex32).toUpperCase(), hex64.toUpperCase());
        candidates.push(hyphenate(hex32.slice(0, 16) + hex32.slice(16).toUpperCase()));

        // Shapes that are not: wrong length, wrong hyphenation, non-hex, and a traversal attempt.
        candidates.push(hex32, hex64.slice(0, 63), hex64 + "0", hyphenate(hex32).slice(0, 35));
        candidates.push(hyphenate(hex32).replace("-", ""), hex64.replace(/^../, "zz"));
        candidates.push(`${hex32.slice(0, 4)}../../../../../victim.txt`, "", "/tmp/asset");
    }

    return candidates;
}

describe("asset storage id shard inverse", () => {
    const uuid = "123e4567-e89b-12d3-a456-426614174000";
    const sha256 = "3d15" + "b".repeat(60);

    it("round-trips every id splitAssetStorageId accepts", () => {
        const candidates = candidateIds();
        const accepted = candidates.filter(isValidAssetStorageId);

        // Guard against a corpus that has quietly stopped containing ids, which would let the
        // property below pass over an empty set.
        expect(accepted.length).toBeGreaterThan(50);
        expect(accepted.length).toBeLessThan(candidates.length);

        for (const id of accepted) {
            const [a, b, rest] = splitAssetStorageId(id);
            expect(assetStorageIdFromShards(a, b, rest), `round trip of ${id}`).toBe(id);
        }
    });

    it("returns a legacy SHA-256 unhyphenated", () => {
        const [a, b, rest] = splitAssetStorageId(sha256);
        expect([a, b, rest]).toEqual(["3d", "15", "b".repeat(60)]);
        expect(assetStorageIdFromShards(a, b, rest)).toBe(sha256);
    });

    it("re-inserts UUID hyphens at 8/4/4/4/12", () => {
        expect(assetStorageIdFromShards("12", "3e", "4567e89b12d3a456426614174000")).toBe(uuid);
    });

    it("rejects segments of the wrong length", () => {
        // Fan-out segments are two characters each; a one- or three-character directory is not
        // this scheme's, even when the characters rejoin into something id-shaped.
        expect(assetStorageIdFromShards("1", "23e", "4567e89b12d3a456426614174000")).toBeNull();
        expect(assetStorageIdFromShards("123e", "45", "67e89b12d3a456426614174000")).toBeNull();
        // Right fan-out, wrong total: 31 and 33 characters are neither shape.
        expect(assetStorageIdFromShards("12", "3e", "4567e89b12d3a45642661417400")).toBeNull();
        expect(assetStorageIdFromShards("12", "3e", "4567e89b12d3a4564266141740000")).toBeNull();
    });

    it("rejects non-hex segments", () => {
        expect(assetStorageIdFromShards("zz", "3e", "4567e89b12d3a456426614174000")).toBeNull();
        expect(assetStorageIdFromShards("12", "3e", "4567e89b12d3a45642661417400z")).toBeNull();
        // A hyphen inside a segment cannot re-form a UUID: it lands inside a group, not between.
        expect(assetStorageIdFromShards("12", "3e", "4567e89b12d3a4564266141740-0")).toBeNull();
    });

    it("preserves the case it was given, being the exact inverse of the split", () => {
        // `isValidAssetStorageId` accepts upper-case hex, so the inverse has to return it
        // unchanged or the round trip above would not hold. The path reader below is the one
        // that insists on the canonical lower case.
        expect(assetStorageIdFromShards("12", "3E", "4567E89B12D3A456426614174000"))
            .toBe("123E4567-E89B-12D3-A456-426614174000");
    });
});

describe("asset storage id from a content path", () => {
    const uuid = "123e4567-e89b-12d3-a456-426614174000";
    const sha256 = "3d15" + "b".repeat(60);

    it("reads back the path AssetsDataShard would have written", () => {
        expect(assetStorageIdFromContentPath("assets/content/12/3e/4567e89b12d3a456426614174000")).toBe(uuid);
        expect(assetStorageIdFromContentPath(`assets/content/3d/15/${"b".repeat(60)}`)).toBe(sha256);
    });

    it("accepts either separator", () => {
        expect(assetStorageIdFromContentPath("assets\\content\\12\\3e\\4567e89b12d3a456426614174000")).toBe(uuid);
    });

    it("rejects the wrong number of segments", () => {
        expect(assetStorageIdFromContentPath("assets/content/12/3e")).toBeNull();
        expect(assetStorageIdFromContentPath("assets/content/12/3e/4567e89b12d3a456426614174000/extra")).toBeNull();
    });

    it("rejects non-hex and wrong-length segments", () => {
        expect(assetStorageIdFromContentPath("assets/content/zz/3e/4567e89b12d3a456426614174000")).toBeNull();
        expect(assetStorageIdFromContentPath("assets/content/123/e/4567e89b12d3a456426614174000")).toBeNull();
        expect(assetStorageIdFromContentPath("assets/content/../../../etc/passwd")).toBeNull();
    });

    it("rejects upper and mixed case, which the writer never produces", () => {
        expect(assetStorageIdFromContentPath("assets/content/12/3E/4567e89b12d3a456426614174000")).toBeNull();
        expect(assetStorageIdFromContentPath("assets/content/12/3e/4567E89B12d3a456426614174000")).toBeNull();
        expect(assetStorageIdFromContentPath("ASSETS/CONTENT/12/3e/4567e89b12d3a456426614174000")).toBeNull();
    });

    it("rejects a path that is not under assets/content", () => {
        expect(assetStorageIdFromContentPath("assets/cache/12/3e/4567e89b12d3a456426614174000")).toBeNull();
        expect(assetStorageIdFromContentPath("content/12/3e/4567e89b12d3a456426614174000")).toBeNull();
        expect(assetStorageIdFromContentPath("resources/icons/12/3e/4567e89b12d3a456426614174000")).toBeNull();
        expect(assetStorageIdFromContentPath("12/3e/4567e89b12d3a456426614174000")).toBeNull();
    });
});
