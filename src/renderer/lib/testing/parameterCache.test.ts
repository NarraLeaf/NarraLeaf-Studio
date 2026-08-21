import { describe, expect, it } from "vitest";
import {
    parseTestParameterMemory,
    rememberTestParameters,
    serializeTestParameterMemory,
} from "./parameterCache";

/**
 * The file behind the picker's memory, and the one promise it makes: it can be deleted, truncated or
 * hand-edited into nonsense, and the worst that happens is that the author picks from a dropdown
 * again. Nothing here may throw, and nothing here may be worth telling anyone about.
 */

describe("parseTestParameterMemory", () => {
    it("reads a file that was written by the other half of this module", () => {
        const memory = rememberTestParameters({}, "acme:walk", { ending: "true", skipRead: true });

        expect(parseTestParameterMemory(JSON.parse(serializeTestParameterMemory(memory)))).toEqual({
            "acme:walk": { ending: "true", skipRead: true },
        });
    });

    it("answers nothing for everything that is not a memory", () => {
        for (const raw of [undefined, null, 42, "{}", [], [{ ending: "true" }]]) {
            expect(parseTestParameterMemory(raw)).toEqual({});
        }
    });

    it("drops what it cannot read and keeps the rest", () => {
        // One entry going bad is no reason to forget the others, and a value of an unexpected type
        // is dropped here rather than passed on to be argued with against a live declaration.
        expect(parseTestParameterMemory({
            "acme:walk": { ending: "true", retries: 3, target: { id: "x" } },
            "acme:broken": "not an object",
            "acme:empty": {},
            "acme:offline": { blocked: false },
        })).toEqual({
            "acme:walk": { ending: "true" },
            "acme:offline": { blocked: false },
        });
    });
});

describe("rememberTestParameters", () => {
    it("replaces one test's values and leaves its neighbours alone", () => {
        const before = { "acme:walk": { ending: "good" }, "acme:offline": { blocked: true } };
        const after = rememberTestParameters(before, "acme:walk", { ending: "true" });

        expect(after).toEqual({ "acme:walk": { ending: "true" }, "acme:offline": { blocked: true } });
        // The memory the picker read is not mutated under it.
        expect(before["acme:walk"]).toEqual({ ending: "good" });
    });

    it("drops the entry rather than writing an empty one", () => {
        // A test with no resolved values could not have been started, so a row for it would be a
        // line in the file that no run ever produced.
        expect(rememberTestParameters({ "acme:walk": { ending: "good" } }, "acme:walk", {})).toEqual({});
    });
});
