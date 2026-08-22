import { describe, expect, it, vi } from "vitest";
import {
    findEmptyTestSelect,
    resolveTestParameters,
    resolveTestParameterValues,
} from "./parameters";
import type { TestAvailabilityContext, TestDefinition, TestParameterDefinition } from "./types";

/**
 * The arithmetic between a declaration and the value a run is started with.
 *
 * The property every case here defends is one: **a value the declaration cannot account for is not a
 * value.** An author who deletes an ending must not find the picker pointing at nothing, and the
 * deleted id must not reach `run` either - so the fallbacks below are the difference between a test
 * that walks somewhere and one that walks nowhere and says it passed.
 */

const CONTEXT: TestAvailabilityContext = { projectPath: "D:/project", frozen: false };

function parametersOf(...parameters: TestParameterDefinition[]) {
    const definition: TestDefinition = {
        id: "unit:parametrised",
        title: { text: "Parametrised" },
        presentation: "headless",
        parameters,
        run: () => ({ status: "passed" }),
    };
    return resolveTestParameters(definition, CONTEXT);
}

function ending(...values: string[]): TestParameterDefinition {
    return {
        id: "ending",
        kind: "select",
        label: { text: "Ending" },
        options: () => values.map(value => ({ value, label: { text: value.toUpperCase() } })),
    };
}

describe("resolveTestParameters", () => {
    it("evaluates each select's options once, with the availability context", () => {
        const options = vi.fn(() => [{ value: "good", label: { text: "Good end" } }]);
        const resolved = parametersOf({ id: "ending", kind: "select", label: { text: "Ending" }, options });

        expect(options).toHaveBeenCalledTimes(1);
        expect(options).toHaveBeenCalledWith(CONTEXT);
        expect(resolved).toEqual([
            {
                kind: "select",
                definition: expect.objectContaining({ id: "ending" }),
                options: [{ value: "good", label: { text: "Good end" } }],
            },
        ]);
    });

    it("counts a definition that throws while listing as having nothing to offer", () => {
        // Same treatment `checkAvailability` gets: a defective definition greys its own test out
        // rather than taking the picker down with it.
        const resolved = parametersOf({
            id: "ending",
            kind: "select",
            label: { text: "Ending" },
            options: () => {
                throw new Error("the index was not loaded");
            },
        });

        expect(findEmptyTestSelect(resolved)?.id).toBe("ending");
    });

    it("collapses a repeated id to its first declaration", () => {
        const resolved = parametersOf(ending("a"), ending("b"));

        expect(resolved).toHaveLength(1);
        expect(resolved[0].kind === "select" && resolved[0].options.map(option => option.value)).toEqual(["a"]);
    });

    it("reports no empty select when every list has something in it", () => {
        expect(findEmptyTestSelect(parametersOf(ending("a"), { id: "skip", kind: "boolean", label: { text: "Skip" } })))
            .toBeNull();
    });
});

describe("resolveTestParameterValues", () => {
    it("carries only declared ids, whatever it was handed", () => {
        const values = resolveTestParameterValues(parametersOf(ending("a", "b")), {
            ending: "b",
            // Never declared. Nothing in the picker can put this in front of a test.
            secretMode: true,
        });

        expect(values).toEqual({ ending: "b" });
    });

    it("keeps a remembered value that is still an option", () => {
        expect(resolveTestParameterValues(parametersOf(ending("good", "true")), { ending: "true" }))
            .toEqual({ ending: "true" });
    });

    it("falls back to the default when the remembered option has been deleted", () => {
        const resolved = parametersOf({
            id: "ending",
            kind: "select",
            label: { text: "Ending" },
            defaultValue: "good",
            options: () => [
                { value: "good", label: { text: "Good end" } },
                { value: "true", label: { text: "True end" } },
            ],
        });

        expect(resolveTestParameterValues(resolved, { ending: "the-one-they-deleted" }))
            .toEqual({ ending: "good" });
    });

    it("falls back to the first option when the default itself is gone", () => {
        const resolved = parametersOf({
            id: "ending",
            kind: "select",
            label: { text: "Ending" },
            defaultValue: "also-deleted",
            options: () => [{ value: "true", label: { text: "True end" } }],
        });

        expect(resolveTestParameterValues(resolved, { ending: "deleted" })).toEqual({ ending: "true" });
    });

    it("gives a select with nothing to choose from no value at all", () => {
        // The state that makes the whole test unavailable, so nobody downstream has to invent one.
        expect(resolveTestParameterValues(parametersOf(ending()), { ending: "gone" })).toEqual({});
    });

    it("reads a boolean's default as off, and ignores a remembered value of the wrong type", () => {
        const resolved = parametersOf(
            { id: "skipRead", kind: "boolean", label: { text: "Skip read text" }, defaultValue: true },
            { id: "verbose", kind: "boolean", label: { text: "Verbose" } },
        );

        expect(resolveTestParameterValues(resolved)).toEqual({ skipRead: true, verbose: false });
        expect(resolveTestParameterValues(resolved, { skipRead: false })).toEqual({ skipRead: false, verbose: false });
        expect(resolveTestParameterValues(resolved, { skipRead: "yes" })).toEqual({ skipRead: true, verbose: false });
    });

    it("resolves a test that declares nothing to an empty set", () => {
        expect(resolveTestParameterValues([], { ending: "true" })).toEqual({});
    });
});
