import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryDocument, StoryScene } from "@shared/types/story";
import { rankSpeakers, scanStories } from "./projectStatsSnapshot";

type DialogueSpec = { characterId?: string; speakerName?: string };

function dialogue(id: string, value: string, speaker: DialogueSpec = {}): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds: [],
        payload: {
            action: "dialogue",
            ...speaker,
            text: { textId: `${id}-t`, role: "dialogue", value },
        },
    } as StoryBlock;
}

function narration(id: string, value: string): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds: [],
        payload: { action: "narration", text: { textId: `${id}-t`, role: "narration", value } },
    } as StoryBlock;
}

function sceneOf(id: string, blocks: StoryBlock[]): StoryScene {
    return {
        id,
        name: id,
        runtimeName: id,
        rootBlockIds: blocks.map(block => block.id),
        blocks: Object.fromEntries(blocks.map(block => [block.id, block])),
    } as StoryScene;
}

function documentOf(scenes: StoryScene[]): StoryDocument {
    return {
        chapters: [],
        scenes: Object.fromEntries(scenes.map(scene => [scene.id, scene])),
    } as unknown as StoryDocument;
}

/** The cast the rows resolve against, as `readCast` hands it over. */
function cast(names: Record<string, string>): (id: string) => string | undefined {
    return id => names[id];
}

describe("scanStories speaker tallies", () => {
    it("splits lines and words by the character that speaks them", () => {
        const speakers = scanStories([
            documentOf([
                sceneOf("s1", [
                    dialogue("a", "we should go", { characterId: "c1" }),
                    dialogue("b", "not yet", { characterId: "c2" }),
                    dialogue("c", "why not", { characterId: "c1" }),
                    narration("n", "the rain kept on"),
                ]),
            ]),
        ]).speakers;

        expect(speakers.get("id:c1")).toEqual({ characterId: "c1", lines: 2, words: 3 + 2 });
        expect(speakers.get("id:c2")).toEqual({ characterId: "c2", lines: 1, words: 2 });
        // Narration has no speaker, and must not land in the nameless bucket.
        expect(speakers.has("")).toBe(false);
    });

    it("accumulates across every scene and story rather than per scene", () => {
        const speakers = scanStories([
            documentOf([sceneOf("s1", [dialogue("a", "one", { characterId: "c1" })])]),
            documentOf([
                sceneOf("s2", [dialogue("b", "two", { characterId: "c1" })]),
                sceneOf("s3", [dialogue("c", "three", { characterId: "c1" })]),
            ]),
        ]).speakers;

        expect(speakers.get("id:c1")?.lines).toBe(3);
    });

    it("keeps a bare speaker name apart from a character that happens to share it", () => {
        const speakers = scanStories([
            documentOf([
                sceneOf("s1", [
                    dialogue("a", "hello", { characterId: "c1" }),
                    dialogue("b", "hello", { speakerName: "Alice" }),
                ]),
            ]),
        ]).speakers;

        // Two identities, not one: a temp speaker spelled like a character is still not that
        // character, so renaming the character must not merge their lines.
        expect(speakers.get("id:c1")?.lines).toBe(1);
        expect(speakers.get("name:Alice")?.lines).toBe(1);
    });

    it("ignores a blank speaker name and buckets the line as nameless", () => {
        const speakers = scanStories([
            documentOf([sceneOf("s1", [dialogue("a", "who said that", { speakerName: "   " })])]),
        ]).speakers;

        expect(speakers.get("")).toEqual({ lines: 1, words: 3 });
    });

    it("counts a block reachable twice only once", () => {
        const child = dialogue("child", "again", { characterId: "c1" });
        const first = dialogue("first", "one", { characterId: "c1" });
        const second = dialogue("second", "two", { characterId: "c1" });
        first.childrenIds = ["child"];
        second.childrenIds = ["child"];
        const scene = sceneOf("s1", [first, second]);
        scene.blocks["child"] = child;

        expect(scanStories([documentOf([scene])]).speakers.get("id:c1")?.lines).toBe(3);
    });

    it("counts words on the same basis as the project total", () => {
        const scan = scanStories([
            documentOf([
                sceneOf("s1", [
                    dialogue("a", "留下来", { characterId: "c1" }),
                    dialogue("b", "we should go", { characterId: "c2" }),
                    narration("n", "the door opened"),
                ]),
            ]),
        ]);
        const spoken = [...scan.speakers.values()].reduce((sum, tally) => sum + tally.words, 0);

        expect(scan.speakers.get("id:c1")?.words).toBe(3);
        // Every spoken word is in the project total, and narration is the difference.
        expect(spoken).toBe(scan.totalWords - 3);
    });
});

describe("rankSpeakers", () => {
    const tallies = (entries: Record<string, { characterId?: string; name?: string; lines: number; words: number }>) =>
        new Map(Object.entries(entries));

    it("labels a live character by its current name, not the name the line was written with", () => {
        const { speakers } = rankSpeakers(
            tallies({ "id:c1": { characterId: "c1", name: "Old", lines: 1, words: 1 } }),
            cast({ c1: "Alice" }),
        );

        expect(speakers[0]).toMatchObject({ kind: "character", name: "Alice" });
    });

    it("falls back to the bare name when the character is gone, and to nothing when there is none", () => {
        const { speakers } = rankSpeakers(
            tallies({
                "id:c1": { characterId: "c1", name: "Alice", lines: 2, words: 2 },
                "id:c2": { characterId: "c2", lines: 1, words: 1 },
            }),
            cast({}),
        );

        expect(speakers[0]).toMatchObject({ kind: "named", name: "Alice" });
        expect(speakers[1]).toMatchObject({ kind: "unknown" });
        expect(speakers[1].name).toBeUndefined();
    });

    it("marks the nameless bucket as unassigned", () => {
        const { speakers } = rankSpeakers(tallies({ "": { lines: 1, words: 1 } }), cast({}));

        expect(speakers[0]).toMatchObject({ key: "", kind: "unassigned" });
    });

    it("orders by lines, then words, then name, so two recomputes agree", () => {
        const { speakers } = rankSpeakers(
            tallies({
                "name:Bo": { name: "Bo", lines: 2, words: 9 },
                "name:Ann": { name: "Ann", lines: 5, words: 1 },
                "name:Cy": { name: "Cy", lines: 2, words: 9 },
                "name:Dee": { name: "Dee", lines: 2, words: 40 },
            }),
            cast({}),
        );

        expect(speakers.map(speaker => speaker.name)).toEqual(["Ann", "Dee", "Bo", "Cy"]);
    });

    it("folds everything past the cap into one total instead of dropping it", () => {
        const many = Object.fromEntries(
            Array.from({ length: 10 }, (_, index) => [
                `name:s${index}`,
                { name: `s${index}`, lines: 10 - index, words: (10 - index) * 2 },
            ]),
        );

        const { speakers, overflow } = rankSpeakers(tallies(many), cast({}), 4);

        expect(speakers).toHaveLength(4);
        expect(overflow).toEqual({
            speakers: 6,
            // Ranks 5..10 by line count: 6+5+4+3+2+1.
            lines: 21,
            words: 42,
        });
    });

    it("reports no overflow when every speaker fits", () => {
        const { speakers, overflow } = rankSpeakers(
            tallies({ "name:Ann": { name: "Ann", lines: 1, words: 1 } }),
            cast({}),
            4,
        );

        expect(speakers).toHaveLength(1);
        expect(overflow).toBeNull();
    });
});
