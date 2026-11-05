import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryScene } from "@shared/types/story";
import {
    DEFAULT_STORY_OUTLINE_DENSITY,
    normalizeStoryOutlineDensity,
    storyOutlineCastCap,
    storySceneCastIds,
} from "./storyOutlineView";

function dialogue(id: string, characterId: string | undefined, extra: Partial<StoryBlock> = {}): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds: [],
        payload: {
            action: "dialogue",
            characterId,
            text: { textId: `t-${id}`, role: "dialogue", value: "Hi" },
        },
        ...extra,
    } as StoryBlock;
}

function characterEnter(id: string, characterId: string): StoryBlock {
    return {
        id,
        kind: "action",
        parentId: null,
        childrenIds: [],
        payload: { action: "character", operation: "enter", characterId },
    };
}

function scene(roots: string[], blocks: StoryBlock[]): StoryScene {
    return {
        id: "scene-1",
        name: "Scene",
        runtimeName: "scene_1",
        rootBlockIds: roots,
        blocks: Object.fromEntries(blocks.map(block => [block.id, block])),
    } as StoryScene;
}

describe("a scene's cast on the outline", () => {
    it("lists speakers and staged characters once each, in the order they first appear", () => {
        const subject = scene(["a", "b", "c", "d"], [
            characterEnter("a", "char-aoi"),
            dialogue("b", "char-narra"),
            dialogue("c", "char-aoi"),
            dialogue("d", undefined),
        ]);

        expect(storySceneCastIds(subject)).toEqual(["char-aoi", "char-narra"]);
    });

    it("reads rows nested under control flow", () => {
        const subject = scene(["if"], [
            { ...characterEnter("if", "char-aoi"), childrenIds: ["inner"] },
            { ...dialogue("inner", "char-kaede"), parentId: "if" },
        ]);

        expect(storySceneCastIds(subject)).toEqual(["char-aoi", "char-kaede"]);
    });

    it("leaves out a character who only appears under a disabled row", () => {
        const subject = scene(["off", "on"], [
            { ...dialogue("off", "char-kaede", { disabled: true }), childrenIds: ["under"] },
            { ...dialogue("under", "char-narra"), parentId: "off" },
            dialogue("on", "char-aoi"),
        ]);

        expect(storySceneCastIds(subject)).toEqual(["char-aoi"]);
    });
});

describe("the outline's layout", () => {
    it("defaults to compact and reads anything unknown as the default", () => {
        expect(DEFAULT_STORY_OUTLINE_DENSITY).toBe("compact");
        expect(normalizeStoryOutlineDensity("comfortable")).toBe("comfortable");
        expect(normalizeStoryOutlineDensity("standard")).toBe("compact");
        expect(normalizeStoryOutlineDensity(undefined)).toBe("compact");
    });

    it("shows fewer faces on a compact row in a narrow panel, and more on a comfortable row's own line", () => {
        expect(storyOutlineCastCap("compact", false)).toBe(3);
        expect(storyOutlineCastCap("compact", true)).toBe(2);
        expect(storyOutlineCastCap("comfortable", true)).toBe(6);
    });
});
