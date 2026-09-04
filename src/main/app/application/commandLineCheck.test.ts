import { describe, expect, it } from "vitest";
import { readTestParameters } from "./commandLineCheck";

/**
 * `--test-parameter` is the one place a check's command line carries a key and a value in one
 * argument, and the one place where being wrong is silent: a value nobody could act on would
 * otherwise fall back on the test's default and report a green verdict about a run nobody asked for.
 */
describe("readTestParameters", () => {
    it("reads id=value pairs", () => {
        expect(readTestParameters(["ending=good", "verbose=true"])).toEqual({
            ok: true,
            values: { ending: "good", verbose: "true" },
        });
    });

    it("keeps everything after the first separator", () => {
        expect(readTestParameters(["query=a=b"])).toEqual({ ok: true, values: { query: "a=b" } });
    });

    it("accepts an empty value", () => {
        expect(readTestParameters(["ending="])).toEqual({ ok: true, values: { ending: "" } });
    });

    it("refuses an argument with no separator", () => {
        expect(readTestParameters(["ending"])).toEqual({
            ok: false,
            reason: "--test-parameter ending: expected id=value",
        });
    });

    it("refuses an argument with no id", () => {
        expect(readTestParameters(["=good"])).toEqual({
            ok: false,
            reason: "--test-parameter =good: expected id=value",
        });
    });

    it("refuses one id given twice rather than picking a side", () => {
        expect(readTestParameters(["ending=good", "ending=bad"])).toEqual({
            ok: false,
            reason: "--test-parameter ending was given twice",
        });
    });

    it("reads nothing from nothing", () => {
        expect(readTestParameters([])).toEqual({ ok: true, values: {} });
    });
});
