import { describe, expect, it } from "vitest";
import type { StoryBlock } from "@shared/types/story";
import { getQuickParams } from "./storyQuickParams";

function action(payload: Extract<StoryBlock, { kind: "action" }>["payload"]): StoryBlock {
    return { id: "b", kind: "action", parentId: null, childrenIds: [], payload };
}

describe("getQuickParams", () => {
    it("exposes a wait's duration (with presets) only in duration mode", () => {
        const params = getQuickParams(action({ action: "wait", mode: "duration", durationMs: 500 }));
        expect(params).toHaveLength(1);
        expect(params[0].value).toMatchObject({ kind: "duration", ms: 500 });
        expect((params[0].value as { presetsMs: number[] }).presetsMs).toEqual([200, 500, 1000, 2000, 3000]);
        expect(getQuickParams(action({ action: "wait", mode: "click" }))).toEqual([]);
    });

    it("exposes a jump's target scene and applies a new one", () => {
        const block: StoryBlock = { id: "j", kind: "jump", parentId: null, childrenIds: [], payload: { targetSceneId: "s1" } };
        const params = getQuickParams(block);
        expect(params[0].value).toMatchObject({ kind: "scene", sceneId: "s1" });
        expect(params[0].apply({ kind: "scene", sceneId: "s2" })).toMatchObject({ targetSceneId: "s2" });
    });

    it("exposes audio volume + loop and applies edits without touching other fields", () => {
        const params = getQuickParams(action({ action: "audio", operation: "setBgm", assetId: "a1", volume: 0.8, loop: true }));
        expect(params.map(p => p.id)).toEqual(["vol", "loop"]);
        expect(params[0].apply({ kind: "percent", ratio: 0.5 })).toMatchObject({ assetId: "a1", volume: 0.5, loop: true });
        expect(params[1].apply({ kind: "toggle", on: false })).toMatchObject({ volume: 0.8, loop: false });
    });

    it("exposes a transition duration only when a transition already exists", () => {
        expect(getQuickParams(action({ action: "setBackground", assetId: "img" }))).toEqual([]);
        const withTransition = getQuickParams(action({ action: "setBackground", assetId: "img", transition: { kind: "dissolve", durationMs: 300 } }));
        expect(withTransition[0]).toMatchObject({ id: "t" });
        expect(withTransition[0].apply({ kind: "duration", ms: 700 })).toMatchObject({ transition: { kind: "dissolve", durationMs: 700 } });
    });

    it("exposes the enter/exit transition duration but nothing for move/expression", () => {
        expect(getQuickParams(action({ action: "character", operation: "enter", characterId: "c1", transition: { kind: "fadeIn", durationMs: 200 } }))[0]).toMatchObject({ id: "d" });
        expect(getQuickParams(action({ action: "character", operation: "expression", characterId: "c1", transition: { kind: "fadeIn", durationMs: 200 } }))).toEqual([]);
    });
});
