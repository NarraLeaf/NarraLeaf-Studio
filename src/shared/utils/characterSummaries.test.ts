import { describe, expect, it } from "vitest";
import { mapCharacterStoreEntriesToSummaries } from "@shared/utils/characterSummaries";

function entry(profile: Record<string, unknown>) {
    return { profile };
}

describe("mapCharacterStoreEntriesToSummaries", () => {
    it("maps a named character", () => {
        const summaries = mapCharacterStoreEntriesToSummaries([entry({ id: "char-alice", name: "Alice" })]);

        expect(summaries).toEqual([{ id: "char-alice", name: "Alice", defaultForm: null, forms: [] }]);
    });

    it("trims the name", () => {
        const [summary] = mapCharacterStoreEntriesToSummaries([entry({ id: "char-alice", name: "  Alice  " })]);

        expect(summary.name).toBe("Alice");
    });

    // `name` is display text - the story compiler feeds it straight to the NLR nametag - and the
    // id is a UUID, which must never reach the UI. Naming an unnamed character is the compiler's job.
    it.each([
        ["empty", ""],
        ["whitespace-only", "   "],
        ["missing", undefined],
        ["non-string", 42],
    ])("leaves a %s name empty rather than substituting the id", (_label, name) => {
        const [summary] = mapCharacterStoreEntriesToSummaries([entry({ id: "char-alice", name })]);

        expect(summary.name).toBe("");
        expect(summary.id).toBe("char-alice");
    });

    it("skips entries with no usable id", () => {
        expect(mapCharacterStoreEntriesToSummaries([
            entry({ id: "", name: "Alice" }),
            entry({ name: "Bob" }),
            { profile: null },
            null,
        ])).toEqual([]);
    });
});
