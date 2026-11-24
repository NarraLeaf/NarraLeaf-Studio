import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryRichRun, StoryScene } from "@shared/types/story";
import { foldInlineFades, inlineFadesAtBlockStart, ownInlineFadeMs } from "./inlineExpressionFade";

const face = (fadeMs?: number): StoryRichRun => ({
    event: { expression: { characterId: "c", pose: "p", ...(fadeMs === undefined ? {} : { fadeMs }) } },
});

function dialogue(id: string, rich: StoryRichRun[], childrenIds: string[] = []): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds,
        payload: { action: "dialogue", characterId: "c", text: { textId: `t-${id}`, value: "", role: "dialogue", rich } },
    } as StoryBlock;
}

function scene(blocks: StoryBlock[], rootBlockIds: string[]): StoryScene {
    return {
        id: "s",
        name: "s",
        rootBlockIds,
        blocks: Object.fromEntries(blocks.map(block => [block.id, block])),
    } as unknown as StoryScene;
}

describe("ownInlineFadeMs", () => {
    it("reads 0 as a value of its own and an absent fade as none", () => {
        expect(ownInlineFadeMs({ expression: { characterId: "c", fadeMs: 0 } })).toBe(0);
        expect(ownInlineFadeMs({ expression: { characterId: "c", fadeMs: 200 } })).toBe(200);
        expect(ownInlineFadeMs({ expression: { characterId: "c" } })).toBeUndefined();
        expect(ownInlineFadeMs({ expression: { characterId: "c", fadeMs: -1 } })).toBeUndefined();
    });
});

describe("foldInlineFades", () => {
    it("carries a set fade to the changes after it until one sets its own", () => {
        const runs = [face(), { text: "a" }, face(200), face(), face(0), face()];
        const { fades, endMs } = foldInlineFades(runs, 0);
        expect(runs.filter(run => "event" in run).map(run => fades.get(run))).toEqual([0, 200, 200, 0, 0]);
        expect(endMs).toBe(0);
    });

    it("starts from the fade the line inherits, and a sound-only event passes it through", () => {
        const sound: StoryRichRun = { event: { sound: { assetId: "se" } } };
        const runs = [sound, face()];
        const { fades, endMs } = foldInlineFades(runs, 300);
        expect(fades.has(sound)).toBe(false);
        expect(fades.get(runs[1])).toBe(300);
        expect(endMs).toBe(300);
    });
});

describe("inlineFadesAtBlockStart", () => {
    it("carries forward across rows in document order and never back", () => {
        const s = scene([
            dialogue("a", [face()]),
            dialogue("b", [face(250)]),
            dialogue("c", [{ text: "no change here" }]),
            dialogue("d", [face(0), face()]),
            dialogue("e", [face()]),
        ], ["a", "b", "c", "d", "e"]);
        const starts = inlineFadesAtBlockStart(s);
        expect(["a", "b", "c", "d", "e"].map(id => starts.get(id))).toEqual([0, 0, 250, 250, 0]);
    });

    it("walks a container's children before the rows after it, as the page reads", () => {
        const s = scene([
            dialogue("parent", [], ["child"]),
            dialogue("child", [face(400)]),
            dialogue("after", [face()]),
        ], ["parent", "after"]);
        expect(inlineFadesAtBlockStart(s).get("after")).toBe(400);
    });
});
