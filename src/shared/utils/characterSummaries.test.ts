import { describe, expect, it } from "vitest";
import { mapCharacterStoreEntriesToSummaries } from "@shared/utils/characterSummaries";

function entry(profile: Record<string, unknown>) {
    return { profile };
}

describe("mapCharacterStoreEntriesToSummaries", () => {
    it("maps a named character", () => {
        const summaries = mapCharacterStoreEntriesToSummaries([entry({ id: "char-alice", name: "Alice" })]);

        expect(summaries).toEqual([{ id: "char-alice", name: "Alice", appearance: { kind: "preset", poses: [], defaultPoseId: null } }]);
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

    it("forwards a puppet's resting pose", () => {
        const [summary] = mapCharacterStoreEntriesToSummaries([entry({
            id: "char-doll",
            name: "Doll",
            appearance: {
                kind: "puppet",
                assetId: "asset-model",
                backend: "some-runtime",
                defaultState: { motion: " walk ", expression: "", skin: null },
            },
        })]);

        expect(summary.appearance).toMatchObject({
            kind: "puppet",
            defaultState: { motion: "walk", expression: null, skin: null },
        });
    });

    it("drops a resting pose with nothing in it", () => {
        // All three cleared is the same state as no default at all; forwarding the triple would
        // make every consumer downstream have to know that it means nothing.
        const [summary] = mapCharacterStoreEntriesToSummaries([entry({
            id: "char-doll",
            appearance: {
                kind: "puppet",
                assetId: "asset-model",
                backend: "some-runtime",
                defaultState: { motion: null, expression: "  ", skin: 7 },
            },
        })]);

        expect(summary.appearance).not.toHaveProperty("defaultState");
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
