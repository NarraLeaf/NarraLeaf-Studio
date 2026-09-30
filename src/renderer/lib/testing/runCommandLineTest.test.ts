import { describe, expect, it } from "vitest";
import type { ResolvedTestParameter } from "./parameters";
import { coerceParameter, describeParameter } from "./runCommandLineTest";

/**
 * What a command line writes for a `select` option, and what it is shown.
 *
 * A walkthrough's endings are stored as a pair of generated ids. The listing must not print them
 * and the line must not need them: each ending is named, the listing prints the name in the value's
 * place, and the line takes the name back. A list whose values are already words is untouched.
 */
const STORED = "3f0c9d2e-1b7a-4c55-9e10-6a2b8d4f7c31/9d1e2f3a-4b5c-4d6e-8f70-1a2b3c4d5e6f";

const endings: ResolvedTestParameter = {
    kind: "select",
    definition: { id: "ending", kind: "select", label: { text: "Ending" }, options: () => [] },
    options: [
        { value: STORED, label: { text: "Main / Roof / Same time tomorrow" }, name: "Same time tomorrow" },
        { value: "other/pair", label: { text: "Main / Pier / Bad End" }, name: "Bad End" },
    ],
};

const speeds: ResolvedTestParameter = {
    kind: "select",
    definition: { id: "speed", kind: "select", label: { text: "Speed" }, options: () => [], defaultValue: "fast" },
    options: [
        { value: "fast", label: { text: "Fast" } },
        { value: "slow", label: { text: "Slow" } },
    ],
};

describe("describeParameter", () => {
    it("lists a named option by its name, never by its stored value", () => {
        const listing = describeParameter(endings);

        expect(listing.options).toEqual([
            { value: "Same time tomorrow", label: "Main / Roof / Same time tomorrow" },
            { value: "Bad End", label: "Main / Pier / Bad End" },
        ]);
        expect(listing.defaultValue).toBe("Same time tomorrow");
        expect(JSON.stringify(listing)).not.toContain(STORED);
    });

    it("lists an unnamed option by its value", () => {
        expect(describeParameter(speeds)).toMatchObject({
            options: [{ value: "fast" }, { value: "slow" }],
            defaultValue: "fast",
        });
    });
});

describe("coerceParameter", () => {
    it("takes a name, without regard to case, and hands the test the stored value", () => {
        expect(coerceParameter(endings, "same TIME tomorrow")).toEqual({ ok: true, value: STORED });
    });

    it("refuses the stored value of a named option and says the name to write instead", () => {
        const refused = coerceParameter(endings, STORED);

        expect(refused).toEqual({
            ok: false,
            reason: '--test-parameter ending: that is the id Studio stores for "Same time tomorrow", not what a line calls it.'
                + " Write it as ending=Same time tomorrow.",
        });
    });

    it("takes an unnamed option's value exactly as before", () => {
        expect(coerceParameter(speeds, "slow")).toEqual({ ok: true, value: "slow" });
        expect(coerceParameter(speeds, "Slow").ok).toBe(false);
    });

    it("lists what the line may write when it wrote something else", () => {
        expect(coerceParameter(endings, "Good End")).toEqual({
            ok: false,
            reason: '--test-parameter ending: "Good End" is not one this project offers. It accepts: Same time tomorrow, Bad End.',
        });
    });
});
