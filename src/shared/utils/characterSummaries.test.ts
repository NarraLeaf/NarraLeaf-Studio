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

    // The per-character voice bus. Carried unresolved, and absent rather than empty when unset -
    // the compiler reads "no key" as "the seeded voice bus", which is where every character was
    // before this field existed, so an empty string would be a reference to a track nobody can name.
    it.each([
        ["a set bus", "t_alice", "t_alice"],
        ["a padded bus", "  t_alice  ", "t_alice"],
    ])("forwards %s", (_label, voiceTrackId, expected) => {
        const [summary] = mapCharacterStoreEntriesToSummaries([entry({ id: "char-alice", name: "Alice", voiceTrackId })]);

        expect(summary.voiceTrackId).toBe(expected);
    });

    it.each([
        ["unset", undefined],
        ["empty", ""],
        ["whitespace-only", "  "],
        ["non-string", 7],
    ])("omits the voice bus key entirely when it is %s", (_label, voiceTrackId) => {
        const [summary] = mapCharacterStoreEntriesToSummaries([entry({ id: "char-alice", name: "Alice", voiceTrackId })]);

        expect(summary).not.toHaveProperty("voiceTrackId");
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

    it("carries the accent colour verbatim, trimmed", () => {
        const [summary] = mapCharacterStoreEntriesToSummaries([entry({
            id: "char-alice",
            name: "Alice",
            color: "  #40A8C4  ",
        })]);

        expect(summary.color).toBe("#40A8C4");
    });

    // Readability is a per-surface question: Studio chrome bands it, the runtime nametag takes the
    // author's word. A mapper that pre-judged the value would take that decision away from both.
    it("does not judge whether the colour is readable", () => {
        const [summary] = mapCharacterStoreEntriesToSummaries([entry({ id: "char-alice", color: "#FFFFFF" })]);

        expect(summary.color).toBe("#FFFFFF");
    });

    it.each([
        ["empty", ""],
        ["whitespace-only", "   "],
        ["missing", undefined],
        ["non-string", 0x40a8c4],
    ])("omits a %s colour rather than carrying a blank one", (_label, color) => {
        const [summary] = mapCharacterStoreEntriesToSummaries([entry({ id: "char-alice", color })]);

        expect(summary).not.toHaveProperty("color");
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
