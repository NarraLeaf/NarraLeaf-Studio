import { describe, expect, it } from "vitest";
import type { StoryBlock } from "@shared/types/story";
import { blockOverview, getQuickParams } from "./storyQuickParams";

function action(payload: Extract<StoryBlock, { kind: "action" }>["payload"]): StoryBlock {
    return { id: "b", kind: "action", parentId: null, childrenIds: [], payload };
}

// Identity label so the assertions do not depend on the loaded locale.
const label = (key: "story.quickParam.jumpLabel" | "story.quickParam.waitLabel") => key;

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
        // The token edits the transition *duration* (`d=`), matching the `bg` spec's `quickParams: ["d"]`.
        // The transition *kind* (`t=`, an enum) stays an inspector choice, so the token is labelled "d".
        expect(withTransition[0]).toMatchObject({ id: "d" });
        expect(withTransition[0].apply({ kind: "duration", ms: 700 })).toMatchObject({ transition: { kind: "dissolve", durationMs: 700 } });
    });

    it("exposes the enter/exit transition duration but nothing for move/expression", () => {
        expect(getQuickParams(action({ action: "character", operation: "enter", characterId: "c1", transition: { kind: "fadeIn", durationMs: 200 } }))[0]).toMatchObject({ id: "d" });
        expect(getQuickParams(action({ action: "character", operation: "expression", characterId: "c1", transition: { kind: "fadeIn", durationMs: 200 } }))).toEqual([]);
    });
});

describe("blockOverview (structured projection)", () => {
    it("puts wait/jump values only in the token, keeping the bare verb as the base", () => {
        const wait = blockOverview(action({ action: "wait", mode: "duration", durationMs: 500 }), [], undefined, undefined, label);
        expect(wait).toEqual([
            { kind: "text", text: "story.quickParam.waitLabel" },
            { kind: "quick", param: expect.objectContaining({ id: "duration" }) },
        ]);
        const jump: StoryBlock = { id: "j", kind: "jump", parentId: null, childrenIds: [], payload: { targetSceneId: "s1" } };
        const jumpFragments = blockOverview(jump, [], undefined, undefined, label);
        expect(jumpFragments.map(f => f.kind)).toEqual(["text", "quick"]);
        expect(jumpFragments[0]).toEqual({ kind: "text", text: "story.quickParam.jumpLabel" });
    });

    it("splices quick-param tokens in as fragments after the base, not as a second layer", () => {
        const fragments = blockOverview(action({ action: "audio", operation: "setBgm", assetId: "a1", volume: 0.8, loop: true }), [], undefined, undefined, label);
        // A text base (describeBlock) followed by the vol + loop tokens, all in one fragment stream.
        expect(fragments[0].kind).toBe("text");
        expect(fragments.slice(1).map(f => f.kind === "quick" ? f.param.id : f.kind)).toEqual(["vol", "loop"]);
    });

    it("falls back to a single text fragment for a row with no quick params", () => {
        const fragments = blockOverview(action({ action: "wait", mode: "click" }), [], undefined, undefined, label);
        // Click-mode wait owns no token; the base carries the whole summary.
        expect(fragments).toHaveLength(1);
        expect(fragments[0].kind).toBe("text");
    });
});
