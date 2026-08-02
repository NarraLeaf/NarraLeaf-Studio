import {describe, expect, it} from "vitest";
import {
    CanonicalJsonError,
    encodeCanonicalJson,
    findCanonicalJsonDefect,
    formatJsonPath,
    isCanonicalJson,
} from "@shared/documents/canonicalJson";

function rejectionAt(value: unknown): {path: string; message: string} {
    try {
        encodeCanonicalJson(value);
    } catch (error) {
        if (error instanceof CanonicalJsonError) {
            return {path: error.jsonPath, message: error.message};
        }
        throw error;
    }
    throw new Error("Expected encodeCanonicalJson to reject this value.");
}

describe("encodeCanonicalJson: shape of the output", () => {
    it("indents with two spaces, ends with exactly one newline, and never emits CR", () => {
        const text = encodeCanonicalJson({b: 1, a: [1, 2]});

        expect(text).toBe("{\n  \"a\": [\n    1,\n    2\n  ],\n  \"b\": 1\n}\n");
        expect(text).not.toContain("\r");
        expect(text.endsWith("}\n")).toBe(true);
        expect(text.endsWith("\n\n")).toBe(false);
    });

    it("writes empty objects and arrays inline", () => {
        expect(encodeCanonicalJson({a: {}, b: []})).toBe("{\n  \"a\": {},\n  \"b\": []\n}\n");
    });

    it("nests objects and arrays at increasing indent", () => {
        const text = encodeCanonicalJson({outer: [{inner: [[1]]}]});

        expect(text).toBe([
            "{",
            "  \"outer\": [",
            "    {",
            "      \"inner\": [",
            "        [",
            "          1",
            "        ]",
            "      ]",
            "    }",
            "  ]",
            "}",
            "",
        ].join("\n"));
    });

    it("encodes top-level scalars", () => {
        expect(encodeCanonicalJson(null)).toBe("null\n");
        expect(encodeCanonicalJson(true)).toBe("true\n");
        expect(encodeCanonicalJson(12)).toBe("12\n");
        expect(encodeCanonicalJson("hi")).toBe("\"hi\"\n");
    });
});

describe("encodeCanonicalJson: determinism", () => {
    it("produces identical bytes for objects built in different insertion orders", () => {
        const first: Record<string, unknown> = {};
        first.zebra = 1;
        first.apple = {n: 2, m: 3};
        first.middle = [1, 2];

        const second: Record<string, unknown> = {};
        second.middle = [1, 2];
        second.apple = {m: 3, n: 2};
        second.zebra = 1;

        expect(encodeCanonicalJson(first)).toBe(encodeCanonicalJson(second));
    });

    it("is idempotent through a parse round trip", () => {
        const value = {
            stories: [{id: "b", scenes: {two: 2, one: 1}}, {id: "a", scenes: {}}],
            meta: {version: 9, tags: ["x", "y"], nested: {deep: {deeper: [true, null, -1.5]}}},
        };

        const once = encodeCanonicalJson(value);
        const twice = encodeCanonicalJson(JSON.parse(once) as unknown);

        expect(twice).toBe(once);
    });

    it("sorts keys by UTF-16 code unit, not by code point or locale", () => {
        // U+1F600 is the surrogate pair D83D DE00, so by code unit it sorts BEFORE
        // U+FF00 even though its code point is far higher. A code-point or locale-aware
        // sort would put them the other way round.
        const text = encodeCanonicalJson({"\uFF00": 1, "\u{1F600}": 2, "Z": 3, "a": 4});
        const keys = (text.match(/"(.*?)":/g) ?? []).map(entry => entry.slice(1, -2));

        expect(keys).toEqual(["Z", "a", "\u{1F600}", "\uFF00"]);
    });

    it("sorts integer-like keys as strings", () => {
        // Object.keys hands these back in ascending numeric order; the format is defined
        // on the sorted string order, so "10" precedes "2".
        const text = encodeCanonicalJson({"2": "b", "10": "a", "1": "c"});

        expect(text).toBe("{\n  \"1\": \"c\",\n  \"10\": \"a\",\n  \"2\": \"b\"\n}\n");
    });

    it("keeps array order untouched", () => {
        expect(encodeCanonicalJson(["z", "a", "m"])).toBe("[\n  \"z\",\n  \"a\",\n  \"m\"\n]\n");
    });
});

describe("encodeCanonicalJson: strings and numbers", () => {
    it("keeps astral characters literal and escapes lone surrogates", () => {
        expect(encodeCanonicalJson({k: "a\u{1F600}b"})).toBe("{\n  \"k\": \"a\u{1F600}b\"\n}\n");
        expect(encodeCanonicalJson({k: "\uD83D"})).toBe("{\n  \"k\": \"\\ud83d\"\n}\n");
    });

    it("round-trips an astral key", () => {
        const text = encodeCanonicalJson({"\u{1F600}": "emoji"});

        expect(JSON.parse(text)).toEqual({"\u{1F600}": "emoji"});
    });

    it("escapes control characters and quotes", () => {
        expect(encodeCanonicalJson({k: "a\nb\t\"c\"\\"})).toBe("{\n  \"k\": \"a\\nb\\t\\\"c\\\"\\\\\"\n}\n");
    });

    it("writes numbers in their shortest round-tripping form", () => {
        expect(encodeCanonicalJson([1, 1.5, 1e21, 1e-7, -0.5, 0])).toBe(
            "[\n  1,\n  1.5,\n  1e+21,\n  1e-7,\n  -0.5,\n  0\n]\n",
        );
    });

    it("preserves negative zero, which String() would flatten to 0", () => {
        const text = encodeCanonicalJson({k: -0});

        expect(text).toBe("{\n  \"k\": -0\n}\n");
        expect(Object.is((JSON.parse(text) as {k: number}).k, -0)).toBe(true);
    });

    it("round-trips a __proto__ key without touching the prototype", () => {
        const parsed = JSON.parse("{\n  \"__proto__\": {\n    \"a\": 1\n  }\n}\n") as object;

        expect(encodeCanonicalJson(parsed)).toBe("{\n  \"__proto__\": {\n    \"a\": 1\n  }\n}\n");
        expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    });
});

describe("encodeCanonicalJson: rejections", () => {
    it("rejects undefined in an object property, naming the path", () => {
        const {path, message} = rejectionAt({stories: [{}, {}, {updatedAt: undefined}]});

        expect(path).toBe("stories[2].updatedAt");
        expect(message).toContain("undefined");
        expect(message).toContain("stories[2].updatedAt");
    });

    it("rejects undefined inside an array", () => {
        expect(rejectionAt({a: [1, undefined]}).path).toBe("a[1]");
    });

    it("rejects an array hole, which JSON.stringify would turn into null", () => {
        const sparse = new Array<number>(3);
        sparse[0] = 1;

        expect(rejectionAt({a: sparse}).path).toBe("a[1]");
    });

    it("rejects undefined at the root", () => {
        expect(rejectionAt(undefined).path).toBe("(root)");
    });

    it("rejects functions and symbols", () => {
        expect(rejectionAt({a: {b: () => 1}}).path).toBe("a.b");
        expect(rejectionAt({a: Symbol("s")}).path).toBe("a");
    });

    it("rejects symbol-keyed properties rather than dropping them", () => {
        const value: Record<string, unknown> = {a: 1};
        (value as Record<symbol, unknown>)[Symbol("hidden")] = 2;

        const {path, message} = rejectionAt({wrapper: value});
        expect(path).toBe("wrapper");
        expect(message).toContain("symbol-keyed");
    });

    it("rejects bigint", () => {
        expect(rejectionAt({a: 1n}).path).toBe("a");
    });

    it("rejects NaN and both infinities", () => {
        expect(rejectionAt({a: NaN}).message).toContain("NaN");
        expect(rejectionAt({a: Infinity}).message).toContain("Infinity");
        expect(rejectionAt({a: -Infinity}).message).toContain("-Infinity");
        expect(rejectionAt({deep: {list: [0, Number.NaN]}}).path).toBe("deep.list[1]");
    });

    it("rejects Date, because it would parse back as a string", () => {
        const {path, message} = rejectionAt({meta: {updatedAt: new Date(0)}});

        expect(path).toBe("meta.updatedAt");
        expect(message).toContain("Date");
    });

    it("rejects Map, Set and class instances rather than writing {}", () => {
        class Character {
            public name = "Alice";
        }

        expect(rejectionAt({a: new Map()}).message).toContain("Map");
        expect(rejectionAt({a: new Set()}).message).toContain("Set");
        expect(rejectionAt({a: new Character()}).message).toContain("Character");
        expect(rejectionAt({a: /re/}).path).toBe("a");
    });

    it("accepts a null-prototype object", () => {
        const value = Object.create(null) as Record<string, unknown>;
        value.a = 1;

        expect(encodeCanonicalJson(value)).toBe("{\n  \"a\": 1\n}\n");
    });

    it("rejects a cycle at the point it closes", () => {
        const inner: Record<string, unknown> = {};
        const outer = {chapters: [{scene: inner}]};
        inner.back = outer;

        const {path, message} = rejectionAt(outer);
        expect(path).toBe("chapters[0].scene.back");
        expect(message).toContain("cycle");
    });

    it("accepts a value referenced twice, which is not a cycle", () => {
        const shared = {n: 1};

        expect(encodeCanonicalJson({a: shared, b: shared})).toBe(
            "{\n  \"a\": {\n    \"n\": 1\n  },\n  \"b\": {\n    \"n\": 1\n  }\n}\n",
        );
    });

    it("quotes keys that are not identifiers in the reported path", () => {
        expect(rejectionAt({"a-b": {"0x": undefined}}).path).toBe("[\"a-b\"][\"0x\"]");
    });
});

describe("isCanonicalJson", () => {
    const canonical = encodeCanonicalJson({b: 1, a: {d: [1, 2], c: "x"}, e: null});

    it("accepts exactly what the encoder produces", () => {
        expect(isCanonicalJson(canonical)).toBe(true);
    });

    it("agrees with the encoder over a spread of shapes", () => {
        const values: unknown[] = [
            {}, [], null, 0, -0, "", "\u{1F600}",
            {a: [{}, [], {b: null}]},
            {"\uFF00": 1, "\u{1F600}": 2},
            [1e21, 1e-7, -0.5],
        ];

        for (const value of values) {
            expect(isCanonicalJson(encodeCanonicalJson(value))).toBe(true);
        }
    });

    it("rejects bytes that differ from the canonical form in any way", () => {
        expect(isCanonicalJson("{\n  \"b\": 1,\n  \"a\": 2\n}\n")).toBe(false); // unsorted
        expect(isCanonicalJson("{\n    \"a\": 1\n}\n")).toBe(false); // four-space indent
        expect(isCanonicalJson("{\"a\": 1}\n")).toBe(false); // single line
        expect(isCanonicalJson(canonical.trimEnd())).toBe(false); // no trailing newline
        expect(isCanonicalJson(`${canonical}\n`)).toBe(false); // two trailing newlines
        expect(isCanonicalJson(canonical.replace(/\n/g, "\r\n"))).toBe(false); // CRLF
        expect(isCanonicalJson("{\n  \"a\": 1.0\n}\n")).toBe(false); // non-shortest number
        expect(isCanonicalJson("{\n  \"a\": 1,\n  \"a\": 2\n}\n")).toBe(false); // duplicate key
        expect(isCanonicalJson("{\n  \"\\u00e9\": 1\n}\n")).toBe(false); // escaped where literal is canonical
    });

    it("rejects text that is not JSON at all", () => {
        expect(isCanonicalJson("")).toBe(false);
        expect(isCanonicalJson("{")).toBe(false);
        expect(isCanonicalJson("not json")).toBe(false);
    });
});

describe("findCanonicalJsonDefect: what JSON.parse can smuggle past the encoder", () => {
    it("finds nothing wrong with ordinary parsed JSON", () => {
        expect(findCanonicalJsonDefect(JSON.parse("{\"a\": [1, \"x\", null, true, -0, 1e-400]}"))).toBeNull();
    });

    it("catches Infinity from a numeric literal that overflows a double", () => {
        // The whole reason this function exists: `1e400` survives JSON.parse and only
        // fails on the way back out.
        expect(JSON.parse("1e400")).toBe(Infinity);

        const defect = findCanonicalJsonDefect(JSON.parse("{\"settings\": {\"volume\": 1e400}}"));
        expect(defect?.jsonPath).toBe("settings.volume");
        expect(defect?.message).toContain("Infinity");
    });

    it("catches -Infinity, and Infinity from a very long integer literal", () => {
        expect(findCanonicalJsonDefect(JSON.parse("[-1e400]"))?.jsonPath).toBe("[0]");
        expect(findCanonicalJsonDefect(JSON.parse(`[${"9".repeat(400)}]`))?.jsonPath).toBe("[0]");
    });

    it("treats an underflowing literal as the finite number it is", () => {
        // 1e-400 parses to 0 and -1e-400 to -0; both round-trip, so neither is a defect.
        expect(findCanonicalJsonDefect(JSON.parse("[1e-400, -1e-400]"))).toBeNull();
        expect(encodeCanonicalJson(JSON.parse("[1e-400, -1e-400]"))).toBe("[\n  0,\n  -0\n]\n");
    });

    it("cannot be handed NaN, because the JSON grammar has no literal for it", () => {
        expect(() => JSON.parse("NaN")).toThrow(SyntaxError);
        expect(() => JSON.parse("[1e400 - 1e400]")).toThrow(SyntaxError);
    });

    it("reports nesting too deep to walk instead of letting the RangeError out", () => {
        // V8 parses JSON iteratively, so it accepts structures a recursive encoder cannot
        // walk. Without this branch the RangeError would escape loadDocument.
        const deep = JSON.parse(`${"[".repeat(100000)}${"]".repeat(100000)}`) as unknown;

        expect(() => encodeCanonicalJson(deep)).toThrow(RangeError);
        expect(findCanonicalJsonDefect(deep)).toBeInstanceOf(CanonicalJsonError);
    });

    it("does not object to a __proto__ key, which parses as an ordinary own property", () => {
        const primitive = JSON.parse("{\"__proto__\": 1}") as object;
        const nested = JSON.parse("{\"a\": {\"__proto__\": {\"polluted\": true}}}") as object;

        expect(findCanonicalJsonDefect(primitive)).toBeNull();
        expect(findCanonicalJsonDefect(nested)).toBeNull();
        expect(Object.getPrototypeOf(primitive)).toBe(Object.prototype);
        expect(({} as {polluted?: boolean}).polluted).toBeUndefined();
        expect(encodeCanonicalJson(primitive)).toBe("{\n  \"__proto__\": 1\n}\n");
    });

    it("reports the defects the encoder would throw for, for values that did not come from JSON", () => {
        expect(findCanonicalJsonDefect({a: undefined})?.jsonPath).toBe("a");
        expect(findCanonicalJsonDefect({a: new Date(0)})?.jsonPath).toBe("a");
        expect(findCanonicalJsonDefect(new Map())?.jsonPath).toBe("(root)");
    });
});

describe("formatJsonPath", () => {
    it("renders the root, identifiers, indices and awkward keys", () => {
        expect(formatJsonPath([])).toBe("(root)");
        expect(formatJsonPath(["stories", 2, "updatedAt"])).toBe("stories[2].updatedAt");
        expect(formatJsonPath([0])).toBe("[0]");
        expect(formatJsonPath(["needs quotes", "ok"])).toBe("[\"needs quotes\"].ok");
    });
});
