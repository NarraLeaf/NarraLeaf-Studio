import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryDocument, StoryScene } from "@shared/types/story";
import {
    describeStoryBlock,
    projectStoryRow,
    storyBlockBadge,
    storyContainerChain,
    storyRowAccentColor,
    storyRowBarColor,
    storyRowSentence,
    storyRowSpeaker,
    storyTextSegmentPlain,
    type StoryRowLookups,
} from "./storyRowProjection";

const bare: StoryRowLookups = { character: () => null };

function withCharacters(names: Record<string, string>): StoryRowLookups {
    return { character: id => (names[id] ? { name: names[id] } : null) };
}

function action(payload: Extract<StoryBlock, { kind: "action" }>["payload"], id = "b"): StoryBlock {
    return { id, kind: "action", parentId: null, childrenIds: [], payload };
}

function control(payload: Extract<StoryBlock, { kind: "control" }>["payload"], id = "c"): StoryBlock {
    return { id, kind: "control", parentId: null, childrenIds: [], payload };
}

function narration(text: string, id = "n"): StoryBlock {
    return {
        id, kind: "nodeAction", parentId: null, childrenIds: [],
        payload: { action: "narration", text: { textId: `t-${id}`, value: text, role: "narration" } },
    };
}

describe("storyRowSentence — the sentence the editor shows", () => {
    it("names a character entrance rather than printing its enums", () => {
        const block = action({ action: "character", operation: "enter", characterId: "c1" });
        // The old debug projection said `character enter · character` here.
        expect(storyRowSentence(block, withCharacters({ c1: "Nattou" }))).toBe("Enter Nattou");
    });

    it("resolves a background's asset id to its name, and keeps the quick-param token in the line", () => {
        const block = action({
            action: "setBackground",
            assetId: "asset-1",
            transition: { kind: "dissolve", durationMs: 5000 },
        });
        const lookups: StoryRowLookups = { ...bare, assetName: id => (id === "asset-1" ? "outside_s.jpg" : null) };
        expect(storyRowSentence(block, lookups)).toBe("Set background outside_s.jpg d 5s");
    });

    it("names the Story Motion a camera row is driving, and degrades to the operation without a table", () => {
        // Several `/camera motion` rows in one scene are otherwise all just "Motion". The Dev Mode
        // timeline is the caller with no motion table, and it must still read as a camera row rather
        // than printing a uuid.
        const block = action({
            action: "camera",
            operation: "motion",
            motion: { mode: "animation", animationId: "anim-1" },
        });
        expect(storyRowSentence(block, { ...bare, motionName: id => (id === "anim-1" ? "Camera Shake" : null) }))
            .toBe("Motion Camera Shake");
        expect(storyRowSentence(block, bare)).toBe("Motion");
        expect(storyRowSentence(block, { ...bare, motionName: () => null })).toBe("Motion");
        // An unbound motion row has nothing to name, table or not.
        expect(storyRowSentence(action({ action: "camera", operation: "motion" }), { ...bare, motionName: () => "x" }))
            .toBe("Motion");
    });

    it("falls back to the id when the caller has no asset table, and says so when the table misses", () => {
        const block = action({ action: "setBackground", assetId: "asset-1" });
        expect(storyRowSentence(block, bare)).toBe("Set background asset-1");
        expect(storyRowSentence(block, { ...bare, assetName: () => null })).toBe("Set background Missing image");
    });

    it("keeps an inline value chip in the line instead of dropping it with the plain text", () => {
        const declaration: StoryBlock = {
            id: "decl", kind: "declaration", parentId: null, childrenIds: [],
            payload: { scope: "scene", name: "a", valueType: "number", defaultValue: 0, storageKey: "a" },
        };
        const line: StoryBlock = {
            id: "line", kind: "nodeAction", parentId: null, childrenIds: [],
            payload: {
                action: "narration",
                text: {
                    textId: "t", role: "narration", value: "OK ",
                    rich: [
                        { text: "OK " },
                        { interpolation: { kind: "variable", target: { scope: "scene", variableId: "decl" } } },
                    ],
                },
            },
        };
        const scene: StoryScene = {
            id: "s1", name: "First Day", runtimeName: "first",
            rootBlockIds: ["decl", "line"],
            blocks: { decl: declaration, line },
        };
        const document = { id: "story", scenes: { s1: scene } } as unknown as StoryDocument;
        expect(storyRowSentence(line, { ...bare, scene, scenes: document.scenes, document })).toBe("OK a");
    });

    it("shows a pause chip as its seconds and a click pause as nothing, exactly like the chip", () => {
        const segment = {
            textId: "t", role: "narration" as const, value: "ab",
            rich: [{ text: "a" }, { pause: 1500 }, { pause: true as const }, { text: "b" }],
        };
        // `1.5s` is what `createPauseChip` writes into the chip; a click pause's chip is icon-only.
        expect(storyTextSegmentPlain(segment, bare)).toBe("a1.5sb");
    });

    it("leads a container with its plain-language pill, not the raw control enum", () => {
        expect(storyRowSentence(control({ control: "repeat", times: 3 }), bare)).toBe("Repeat 3 times");
        expect(storyRowSentence(control({ control: "parallel", mode: "all" }), bare)).toBe("Run at the same time");
        const option: StoryBlock = {
            id: "o", kind: "nodeAction", parentId: null, childrenIds: [],
            payload: { action: "choiceOption", text: { textId: "t", role: "choiceText", value: "Left" } },
        };
        expect(storyRowSentence(option, bare)).toBe("Option Left");
    });

    it("shows an empty text row's placeholder, which is what the editor draws there", () => {
        expect(storyRowSentence(narration(""), bare)).toBe("Double-click to enter narration");
    });

    it("drops that placeholder for a read-only surface, which has no double-click to offer", () => {
        expect(storyRowSentence(narration(""), bare, { editingPlaceholders: false })).toBe("");
        // Only the empty case changes: a row with words reads identically on both surfaces.
        expect(storyRowSentence(narration("Rain."), bare, { editingPlaceholders: false })).toBe("Rain.");
    });
});

describe("speaker", () => {
    const dialogue = (payload: Record<string, unknown>): StoryBlock => ({
        id: "d", kind: "nodeAction", parentId: null, childrenIds: [],
        payload: {
            action: "dialogue",
            text: { textId: "t", role: "dialogue", value: "hi" },
            ...payload,
        } as Extract<StoryBlock, { kind: "nodeAction" }>["payload"],
    });

    it("is the resolved character, and is left out of the sentence itself", () => {
        const block = dialogue({ characterId: "c1" });
        expect(storyRowSpeaker(block, withCharacters({ c1: "Youk" }))).toEqual({ name: "Youk" });
        expect(storyRowSentence(block, withCharacters({ c1: "Youk" }))).toBe("hi");
    });

    it("falls back to a bare speaker name when there is no character record", () => {
        expect(storyRowSpeaker(dialogue({ speakerName: "Stranger" }), bare)).toEqual({ name: "Stranger" });
    });

    it("is null on every row that is not dialogue", () => {
        expect(storyRowSpeaker(narration("hi"), bare)).toBeNull();
        expect(storyRowSpeaker(action({ action: "wait", mode: "click" }), bare)).toBeNull();
    });
});

describe("colour", () => {
    it("gives a row the hue of its command group", () => {
        expect(storyRowAccentColor(action({ action: "setBackground" }))).toBe("#8fa9c7");
        expect(storyRowAccentColor(action({ action: "audio", operation: "setBgm" }))).toBe("#bd97a3");
    });

    it("marks an invalid row as an error rather than as another kind of action", () => {
        const invalid: StoryBlock = {
            id: "i", kind: "invalid", parentId: null, childrenIds: [],
            payload: { source: "/nope" },
        };
        expect(storyBlockBadge(invalid).group).toBeNull();
        expect(storyRowAccentColor(invalid)).toBe("rgb(var(--nl-danger))");
    });

    it("bars staging rows and leaves prose bare, matching the editor's row chrome", () => {
        expect(storyRowBarColor(narration("hi"))).toBeNull();
        expect(storyRowBarColor(action({ action: "character", operation: "enter", characterId: "c1" })))
            .toBe("var(--narraleaf-accent, #40a8c4)");
    });
});

describe("storyContainerChain", () => {
    it("walks parentId outward and reports only the rows that are containers", () => {
        const outer = control({ control: "repeat", times: 2 }, "outer");
        outer.childrenIds = ["label", "inner"];
        const label = control({ control: "label", name: "top" }, "label");
        label.parentId = "outer";
        const inner = control({ control: "parallel", mode: "all" }, "inner");
        inner.parentId = "outer";
        inner.childrenIds = ["leaf"];
        const leaf = { ...narration("body", "leaf"), parentId: "inner" };
        const scene: StoryScene = {
            id: "s", name: "S", runtimeName: "s",
            rootBlockIds: ["outer"],
            blocks: { outer, label, inner, leaf },
        };
        expect(storyContainerChain(scene, "leaf").map(rung => rung.info.pill))
            .toEqual(["Repeat", "Run at the same time"]);
        expect(storyContainerChain(scene, "outer")).toEqual([]);
    });

    it("does not hang on a corrupted parentId cycle", () => {
        const a = control({ control: "sequence", mode: "do" }, "a");
        const b = control({ control: "sequence", mode: "do" }, "b");
        a.parentId = "b";
        b.parentId = "a";
        const scene: StoryScene = { id: "s", name: "S", runtimeName: "s", rootBlockIds: ["a"], blocks: { a, b } };
        expect(storyContainerChain(scene, "a")).toHaveLength(2);
    });
});

describe("projectStoryRow", () => {
    it("answers the four things a row surface needs in one pass", () => {
        const block = action({ action: "character", operation: "enter", characterId: "c1" });
        expect(projectStoryRow(block, withCharacters({ c1: "Nattou" }))).toEqual({
            sentence: "Enter Nattou",
            speaker: null,
            barColor: "var(--narraleaf-accent, #40a8c4)",
            containerPill: null,
        });
    });

    it("keeps describeStoryBlock as the base sentence for rows with no tokens", () => {
        const block = action({ action: "wait", mode: "click" });
        expect(storyRowSentence(block, bare)).toBe(describeStoryBlock(block, bare));
    });
});
