import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryDocument, StoryScene } from "@shared/types/story/document";
import { blueprintIdsNamedByScene, scenesNamingBlueprint } from "@/lib/story/sceneBlueprintRefs";
import { buildSceneVariableOptions } from "./sceneVariableOptions";

function declaration(id: string, name: string): StoryBlock {
    return {
        id,
        parentId: null,
        childrenIds: [],
        kind: "declaration",
        payload: { scope: "scene", name, valueType: "number", defaultValue: 0, storageKey: id },
    } as StoryBlock;
}

function blueprintRow(id: string, blueprintId: string): StoryBlock {
    return {
        id,
        parentId: null,
        childrenIds: [],
        kind: "action",
        payload: { action: "blueprint", blueprintId },
    } as unknown as StoryBlock;
}

function scene(id: string, name: string, blocks: StoryBlock[]): StoryScene {
    return {
        id,
        name,
        runtimeName: id,
        rootBlockIds: blocks.map(block => block.id),
        blocks: Object.fromEntries(blocks.map(block => [block.id, block])),
    } as StoryScene;
}

function story(scenes: StoryScene[]): StoryDocument {
    return {
        id: "story",
        name: "Story",
        chapters: [{ id: "chapter", name: "Chapter", sceneIds: scenes.map(item => item.id) }],
        scenes: Object.fromEntries(scenes.map(item => [item.id, item])),
    } as unknown as StoryDocument;
}

describe("blueprintIdsNamedByScene", () => {
    it("finds a blueprint however a row names it", () => {
        const condition = {
            id: "if",
            parentId: null,
            childrenIds: [],
            kind: "control",
            payload: { control: "conditionBranch", condition: { kind: "blueprint", blueprintId: "bp-condition" } },
        } as unknown as StoryBlock;
        const found = blueprintIdsNamedByScene(scene("s", "Scene", [blueprintRow("row", "bp-action"), condition]));
        expect([...found].sort()).toEqual(["bp-action", "bp-condition"]);
    });
});

describe("the scene variable picker", () => {
    const rooftop = scene("rooftop", "Rooftop", [declaration("hp", "hp"), declaration("mood", "Mood"), blueprintRow("row", "bp")]);
    const hallway = scene("hallway", "Hallway", [declaration("steps", "Steps")]);

    it("lists the variables of the scene whose row runs the blueprint, by name, holding their ids", () => {
        const options = buildSceneVariableOptions([{ id: "story", document: story([hallway, rooftop]) }], "bp", "Untitled");
        expect(options).toEqual([
            { value: "hp", label: "hp" },
            { value: "mood", label: "Mood" },
        ]);
    });

    it("tells two scenes' variables apart by scene when rows in both run the blueprint", () => {
        const copied = scene("hallway", "Hallway", [declaration("steps", "Steps"), blueprintRow("copy", "bp")]);
        const document = story([copied, rooftop]);
        expect(scenesNamingBlueprint([{ id: "story", document }], "bp").map(ref => ref.scene.id)).toEqual(["hallway", "rooftop"]);
        expect(buildSceneVariableOptions([{ id: "story", document }], "bp", "Untitled").map(option => option.label)).toEqual([
            "Hallway / Steps",
            "Rooftop / hp",
            "Rooftop / Mood",
        ]);
    });

    it("lists nothing for a blueprint no row runs", () => {
        expect(buildSceneVariableOptions([{ id: "story", document: story([hallway]) }], "bp", "Untitled")).toEqual([]);
        expect(buildSceneVariableOptions([{ id: "story", document: undefined }], "bp", "Untitled")).toEqual([]);
    });
});
