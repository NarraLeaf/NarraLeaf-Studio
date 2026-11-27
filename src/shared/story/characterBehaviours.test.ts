import { describe, expect, it } from "vitest";
import type { StoryBlock } from "../types/story/document";
import {
    findCharacterBehaviourConflicts,
    handWrittenChannelsBeforeLine,
    isCharacterBehaviourBlock,
    sanitizeCharacterBehaviours,
    staticPreviousSpeaker,
    storyRowStageChannels,
    type CharacterBehaviours,
} from "./characterBehaviours";

function block(id: string, kind: StoryBlock["kind"], payload: unknown, parentId: string | null = null, childrenIds: string[] = []): StoryBlock {
    return { id, kind, parentId, childrenIds, payload } as StoryBlock;
}

const line = (id: string, characterId?: string, extra: Record<string, unknown> = {}) => block(id, "nodeAction", characterId
    ? { action: "dialogue", characterId, text: { textId: `${id}-t`, value: "Hi", role: "dialogue" }, ...extra }
    : { action: "narration", text: { textId: `${id}-t`, value: "Hi", role: "narration" }, ...extra });
const move = (id: string, characterId: string, to: Record<string, unknown>) =>
    block(id, "action", { action: "character", operation: "move", characterId, transform: { mode: "props", to } });

function scene(rows: StoryBlock[], rootBlockIds = rows.filter(row => row.parentId === null).map(row => row.id)) {
    return { blocks: Object.fromEntries(rows.map(row => [row.id, row])), rootBlockIds };
}

describe("isCharacterBehaviourBlock", () => {
    it("keeps staging and refuses what would change the flow or the cast", () => {
        expect(isCharacterBehaviourBlock(move("m", "a", { zoom: 1.1 }))).toBe(true);
        expect(isCharacterBehaviourBlock(block("e", "action", { action: "character", operation: "expression", characterId: "a", pose: "smile" }))).toBe(true);
        expect(isCharacterBehaviourBlock(block("f", "action", { action: "displayable", operation: "bringToFront", target: { name: "a" } }))).toBe(true);
        expect(isCharacterBehaviourBlock(block("x", "action", { action: "character", operation: "enter", characterId: "a" }))).toBe(false);
        expect(isCharacterBehaviourBlock(block("h", "action", { action: "displayable", operation: "hide", target: { name: "a" } }))).toBe(false);
        expect(isCharacterBehaviourBlock(block("w", "action", { action: "wait", durationMs: 100 }))).toBe(false);
        expect(isCharacterBehaviourBlock(line("l", "a"))).toBe(false);
        expect(isCharacterBehaviourBlock(block("j", "jump", { targetSceneId: "s" }))).toBe(false);
    });
});

describe("sanitizeCharacterBehaviours", () => {
    it("drops rows a behaviour cannot hold, duplicate ids and undefined fields, and keeps an empty event", () => {
        const result = sanitizeCharacterBehaviours({
            startSpeaking: [
                { ...move("m", "a", { zoom: 1.1 }), disabled: true, payload: { action: "character", operation: "move", characterId: "a", objectName: undefined, transform: { mode: "props", to: { zoom: 1.1 } } } },
                move("m", "a", { zoom: 2 }),
                line("l", "a"),
                "nonsense",
            ],
            stopSpeaking: [],
            somethingElse: [move("z", "a", {})],
        });
        expect(result?.startSpeaking).toHaveLength(1);
        expect(result?.startSpeaking?.[0]).not.toHaveProperty("disabled");
        expect(result?.startSpeaking?.[0].payload).not.toHaveProperty("objectName");
        expect(result?.stopSpeaking).toEqual([]);
        expect(result).not.toHaveProperty("somethingElse");
    });

    it("reads anything that is not a record as no behaviours", () => {
        expect(sanitizeCharacterBehaviours(null)).toBeUndefined();
        expect(sanitizeCharacterBehaviours({})).toBeUndefined();
    });
});

describe("storyRowStageChannels", () => {
    it("names a character's channels by its stage key, so a displayable row on the same portrait matches", () => {
        expect([...storyRowStageChannels(move("m", "a", { zoom: 1.1, filterRaw: "blur(2px)" }))]).toEqual(["stage:a|transform:zoom", "stage:a|transform:filter"]);
        const displayable = block("d", "action", { action: "displayable", operation: "transform", target: { name: "a", kind: "character" }, transform: { mode: "props", to: { zoom: 1.2 } } });
        expect([...storyRowStageChannels(displayable)]).toEqual(["stage:a|transform:zoom"]);
    });
});

describe("static reading of a scene", () => {
    it("collects the channels written straight above a line, stopping at the previous line", () => {
        const rows = [move("m0", "a", { zoom: 3 }), line("l0", "b"), move("m1", "a", { zoom: 1.2 }), move("m2", "a", { opacity: 0.5 }), line("l1", "a")];
        const written = handWrittenChannelsBeforeLine(scene(rows), "l1");
        expect(written.get("stage:a|transform:zoom")).toBe("m1");
        expect(written.get("stage:a|transform:opacity")).toBe("m2");
        expect(written.size).toBe(2);
    });

    it("names the previous speaker through plain rows, skips an opted-out line, and gives up at a container", () => {
        const rows = [line("l0", "b"), line("skip", "c", { skipCharacterBehaviours: true }), move("m", "a", {}), line("l1", "a")];
        expect(staticPreviousSpeaker(scene(rows), "l1")).toBe("b");
        const guarded = [line("l0", "b"), block("cond", "control", { control: "condition" }, null, []), line("l1", "a")];
        expect(staticPreviousSpeaker(scene(guarded), "l1")).toBeUndefined();
        expect(staticPreviousSpeaker(scene([line("n", undefined), line("l1", "a")]), "l1")).toBeNull();
    });
});

describe("findCharacterBehaviourConflicts", () => {
    const behaviours = new Map<string, CharacterBehaviours>([
        ["a", { startSpeaking: [move("grow", "a", { zoom: 1.05 })] }],
        ["b", { stopSpeaking: [move("dim", "b", { filter: { brightness: 0.6 } })] }],
    ]);

    it("marks the hand-written row that sets what the speaker's start sets", () => {
        const rows = [move("hand", "a", { zoom: 1.2 }), line("l1", "a")];
        expect(findCharacterBehaviourConflicts(scene(rows), behaviours)).toEqual([
            { rowBlockId: "hand", lineBlockId: "l1", characterId: "a", event: "startSpeaking", behaviourRowId: "grow" },
        ]);
    });

    it("marks a row overlapping the previous speaker's stop, and nothing for a different channel", () => {
        const rows = [line("l0", "b"), move("hand", "b", { look: { preset: "noir" } }), move("other", "a", { opacity: 1 }), line("l1", "a")];
        expect(findCharacterBehaviourConflicts(scene(rows), behaviours).map(conflict => conflict.rowBlockId)).toEqual(["hand"]);
    });

    it("marks a row overlapping the stop of a character brought on right above the line", () => {
        const withMiki = new Map(behaviours).set("miki", { stopSpeaking: [move("miki-dim", "miki", { zoom: 0.9 })] });
        const rows = [block("in-m", "action", { action: "character", operation: "enter", characterId: "miki" }), move("hand", "miki", { zoom: 1 }), line("l1", "a")];
        expect(findCharacterBehaviourConflicts(scene(rows), withMiki).map(conflict => [conflict.rowBlockId, conflict.characterId])).toEqual([["hand", "miki"]]);
    });

    it("says nothing where the floor does not change hands or the line opts out", () => {
        expect(findCharacterBehaviourConflicts(scene([line("l0", "a"), move("hand", "a", { zoom: 2 }), line("l1", "a")]), behaviours)).toEqual([]);
        expect(findCharacterBehaviourConflicts(scene([move("hand", "a", { zoom: 2 }), line("l1", "a", { skipCharacterBehaviours: true })]), behaviours)).toEqual([]);
    });
});
