import { describe, expect, it } from "vitest";
import { EMPTY_STORY_COMMAND_CONTEXT } from "@/apps/workspace/modules/story/scene-editor/storyCommandValues";
import { characterLooksOf, formatTargets } from "./targets";

/**
 * `story targets` names each character's looks - the word after the name on `/show` and `/char` -
 * right under the characters: a preset's poses, a layered character's tags by the axis each moves,
 * the default marked, and a puppet's said to be the model's.
 */
describe("character looks in story targets", () => {
    const character = (name: string, kind: string, poses: string[], axes: { name: string; tags: string[]; defaultIndex: number }[] = []) => ({
        profile: {
            getName: () => name,
            appearance: {
                getKind: () => kind,
                getPoses: () => poses.map(pose => ({ name: pose })),
                getAxes: () => axes.map(axis => ({
                    name: axis.name,
                    tags: axis.tags.map(tag => ({ id: `${axis.name}:${tag}`, name: tag })),
                    defaultTagId: `${axis.name}:${axis.tags[axis.defaultIndex]}`,
                })),
            },
        },
    });

    it("lists poses, tags per axis with the default starred, and model-named looks", () => {
        const looks = characterLooksOf([
            character("Aoi", "preset", ["normal", "smile"]),
            character("Mei", "layered", [], [{ name: "expression", tags: ["normal", "smile"], defaultIndex: 0 }, { name: "outfit", tags: ["school", "casual"], defaultIndex: 1 }]),
            character("Hiyori", "live2d", []),
        ]);
        const text = formatTargets({ ...EMPTY_STORY_COMMAND_CONTEXT, characters: [{ id: "a", name: "Aoi" }] }, "", [], looks);
        expect(text).toContain("character looks  (the word after the name on /show and /char");
        expect(text).toContain("  Aoi: normal  smile");
        expect(text).toContain("  Mei (expression): normal*  smile");
        expect(text).toContain("  Mei (outfit): school  casual*");
        expect(text).toContain("  Hiyori: named by its live2d model (/char, /motion, /skin)");
        expect(text.indexOf("characters")).toBeLessThan(text.indexOf("character looks"));
    });

    it("finds a look by search like any other name", () => {
        const looks = characterLooksOf([character("Mei", "layered", [], [{ name: "outfit", tags: ["school", "casual"], defaultIndex: 0 }])]);
        expect(formatTargets(EMPTY_STORY_COMMAND_CONTEXT, "casual", [], looks)).toBe(
            "character looks  (the word after the name on /show and /char; a layered character's tag changes its own axis only, * = default)\n  Mei (outfit): school*  casual",
        );
    });
});
