import { describe, expect, it } from "vitest";
import {
    PUPPET_DESCRIPTION_CACHE_VERSION,
    normalizePuppetDescription,
    parsePuppetDescriptionRecord,
    puppetChoiceOptions,
    puppetDescriptionFingerprint,
    puppetDescriptionKey,
    stablePuppetJson,
    type PuppetDescriptionFingerprintInput,
} from "./puppetDescriptionModel";

const baseFingerprint: PuppetDescriptionFingerprintInput = {
    assetHash: "abc",
    bundleBytes: 1024,
    resolvedEntry: "model.skel",
    backend: "runtime-a",
    backendStamp: "500@2026-01-01T00:00:00.000Z",
    options: { atlas: "model.atlas" },
    size: { width: 700, height: 900 },
};

describe("stablePuppetJson", () => {
    it("is independent of key order", () => {
        expect(stablePuppetJson({ b: 1, a: 2 })).toBe(stablePuppetJson({ a: 2, b: 1 }));
    });

    it("distinguishes values that JSON.stringify would flatten", () => {
        expect(stablePuppetJson({ a: undefined })).not.toBe(stablePuppetJson({}));
        expect(stablePuppetJson([1, 2])).not.toBe(stablePuppetJson({ 0: 1, 1: 2 }));
    });

    it("survives what an author options bag may actually hold", () => {
        // An options bag is the author's; the fingerprint must not throw on it the way a document
        // encoder would.
        expect(() => stablePuppetJson({ fn: () => 1, nan: NaN, big: 1n })).not.toThrow();
    });
});

describe("puppetDescriptionKey", () => {
    it("is the identity of the model/runtime pair, not its state on disk", () => {
        const key = puppetDescriptionKey({ assetId: "a", backend: "r", entry: null, options: {} });
        expect(puppetDescriptionKey({ assetId: "a", backend: "r", options: {} })).toBe(key);
        // The size is an observation, not identity: two characters sharing a model share a file.
        expect(puppetDescriptionKey({ assetId: "a", backend: "r", size: { width: 9, height: 9 } })).toBe(key);
    });

    it("separates two entries within one bundle", () => {
        expect(puppetDescriptionKey({ assetId: "a", backend: "r", entry: "one.skel" }))
            .not.toBe(puppetDescriptionKey({ assetId: "a", backend: "r", entry: "two.skel" }));
    });

    it("is filesystem safe", () => {
        const key = puppetDescriptionKey({ assetId: "../../etc/passwd", backend: "r/../x" });
        expect(key).toMatch(/^[a-z0-9]+$/);
    });
});

describe("puppetDescriptionFingerprint", () => {
    it("is stable for unchanged inputs", () => {
        expect(puppetDescriptionFingerprint(baseFingerprint))
            .toBe(puppetDescriptionFingerprint({ ...baseFingerprint, options: { atlas: "model.atlas" } }));
    });

    it.each([
        ["a re-exported bundle", { assetHash: "def" }],
        ["a texture edited in place", { bundleBytes: 2048 }],
        ["a different entry", { resolvedEntry: "other.skel" }],
        ["a new runtime build", { backendStamp: "900@2026-02-02T00:00:00.000Z" }],
        ["a different runtime", { backend: "runtime-b" }],
        ["changed options", { options: { atlas: "other.atlas" } }],
        ["a different box", { size: { width: 1, height: 1 } }],
    ])("changes for %s", (_label, patch) => {
        expect(puppetDescriptionFingerprint({ ...baseFingerprint, ...patch }))
            .not.toBe(puppetDescriptionFingerprint(baseFingerprint));
    });

    it("carries the record version, so a shape change invalidates every file", () => {
        expect(puppetDescriptionFingerprint(baseFingerprint))
            .toMatch(new RegExp(`^${PUPPET_DESCRIPTION_CACHE_VERSION}\\.`));
    });
});

describe("normalizePuppetDescription", () => {
    it("accepts what a backend actually returns", () => {
        expect(normalizePuppetDescription({
            motions: ["walk", "run"],
            expressions: [],
            skins: ["default"],
            params: [{ id: "timeScale", min: 0, max: 4, default: 1 }],
            size: { width: 470, height: 700 },
        })).toEqual({
            motions: ["walk", "run"],
            expressions: [],
            skins: ["default"],
            params: [{ id: "timeScale", min: 0, max: 4, default: 1 }],
            size: { width: 470, height: 700 },
        });
    });

    it("drops names an author could not tell apart or select", () => {
        const result = normalizePuppetDescription({ motions: ["walk", "walk", "  ", 7, " run "] });
        expect(result?.motions).toEqual(["walk", "run"]);
    });

    it("keeps a model that has nothing in one category", () => {
        const result = normalizePuppetDescription({ motions: [], skins: ["a"] });
        expect(result).not.toBeNull();
        expect(result?.motions).toEqual([]);
    });

    it("rejects a value that is not a description at all", () => {
        // The module is the author's and nothing type-checked what crossed the line; an
        // unvalidated answer would reach a <Select> as undefined.map.
        expect(normalizePuppetDescription(null)).toBeNull();
        expect(normalizePuppetDescription("walk")).toBeNull();
        expect(normalizePuppetDescription([])).toBeNull();
        expect(normalizePuppetDescription({ hello: true })).toBeNull();
    });

    it("repairs a malformed param rather than dropping the whole answer", () => {
        const result = normalizePuppetDescription({
            motions: ["walk"],
            params: [{ id: "a", min: "x", max: null }, { id: "" }, { id: "a" }, 5],
        });
        expect(result?.params).toEqual([{ id: "a", min: 0, max: 1, default: 0 }]);
    });

    it("treats a degenerate size as no size", () => {
        expect(normalizePuppetDescription({ motions: [], size: { width: 0, height: 10 } })?.size).toBeNull();
        expect(normalizePuppetDescription({ motions: [] })?.size).toBeNull();
    });
});

describe("parsePuppetDescriptionRecord", () => {
    const record = {
        version: PUPPET_DESCRIPTION_CACHE_VERSION,
        fingerprint: "1.abc",
        describedAt: "2026-07-28T00:00:00.000Z",
        description: { motions: ["walk"], expressions: [], skins: [], params: [], size: null },
    };

    it("reads back what was written", () => {
        expect(parsePuppetDescriptionRecord(record)?.fingerprint).toBe("1.abc");
    });

    it("rejects a record from a different cache shape", () => {
        expect(parsePuppetDescriptionRecord({ ...record, version: 999 })).toBeNull();
    });

    it("rejects a record with no fingerprint, which could never be checked for staleness", () => {
        expect(parsePuppetDescriptionRecord({ ...record, fingerprint: "" })).toBeNull();
        expect(parsePuppetDescriptionRecord({ ...record, description: null })).toBeNull();
    });
});

describe("puppetChoiceOptions", () => {
    it("is empty when the model listed nothing, so the field falls back to free text", () => {
        expect(puppetChoiceOptions([], null)).toEqual([]);
        expect(puppetChoiceOptions([], "typed")).toEqual([]);
    });

    it("keeps a value the model no longer has, rather than rewriting the character on open", () => {
        expect(puppetChoiceOptions(["walk", "run"], "jump")).toEqual(["jump", "walk", "run"]);
    });

    it("does not duplicate the current value", () => {
        expect(puppetChoiceOptions(["walk", "run"], "walk")).toEqual(["walk", "run"]);
    });
});
