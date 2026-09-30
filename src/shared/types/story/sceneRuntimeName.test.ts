import { describe, expect, it } from "vitest";
import type { StoryScene } from "./document";
import {
    mintSceneRuntimeName,
    sceneRuntimeName,
    sceneRuntimeNameStem,
    takenSceneRuntimeNames,
    uniqueSceneRuntimeName,
} from "./sceneRuntimeName";

function scene(id: string, name: string, runtimeName: string): StoryScene {
    return { id, name, runtimeName, rootBlockIds: [], blocks: {} };
}

function scenes(...list: StoryScene[]): { scenes: Record<string, StoryScene> } {
    return { scenes: Object.fromEntries(list.map(item => [item.id, item])) };
}

describe("sceneRuntimeName", () => {
    it("answers the stored name, else the display name, else the id - the compiler's expression", () => {
        expect(sceneRuntimeName(scene("s1", "Chapter 1", "chapter_1"))).toBe("chapter_1");
        expect(sceneRuntimeName(scene("s1", "Chapter 1", ""))).toBe("Chapter 1");
        expect(sceneRuntimeName(scene("s1", "", ""))).toBe("s1");
    });
});

describe("sceneRuntimeNameStem", () => {
    it("folds a display name into lower case ASCII and single underscores", () => {
        expect(sceneRuntimeNameStem("  Chapter 1: The Door!  ")).toBe("chapter_1_the_door");
    });

    it("makes nothing of a name with no ASCII in it", () => {
        expect(sceneRuntimeNameStem("第一章")).toBe("");
        expect(sceneRuntimeNameStem("屋上・夜")).toBe("");
    });
});

describe("uniqueSceneRuntimeName", () => {
    it("keeps a free name and numbers a taken one from 2", () => {
        const taken = new Set(["chapter_1", "chapter_1_2"]);
        expect(uniqueSceneRuntimeName("prologue", name => taken.has(name))).toBe("prologue");
        expect(uniqueSceneRuntimeName("chapter_1", name => taken.has(name))).toBe("chapter_1_3");
    });
});

describe("takenSceneRuntimeNames", () => {
    it("holds what every scene compiles under, leaving out the one asked about", () => {
        const document = scenes(scene("a", "A", "alpha"), scene("b", "Old", ""), scene("c", "C", "gamma"));
        expect([...takenSceneRuntimeNames(document)].sort()).toEqual(["Old", "alpha", "gamma"]);
        expect([...takenSceneRuntimeNames(document, "a")].sort()).toEqual(["Old", "gamma"]);
    });
});

describe("mintSceneRuntimeName", () => {
    it("gives a second scene of one name a name of its own", () => {
        const document = scenes(scene("a", "Chapter 1", "chapter_1"));
        expect(mintSceneRuntimeName("Chapter 1", document, () => "unused")).toBe("chapter_1_2");
        expect(mintSceneRuntimeName("Chapter 2", document, () => "unused")).toBe("chapter_2");
    });

    it("hands a name it can make nothing of to the fallback, and trusts what comes back", () => {
        const document = scenes(scene("a", "第一章", "scene_1234"));
        expect(mintSceneRuntimeName("第一章", document, () => "scene_5678")).toBe("scene_5678");
    });
});
