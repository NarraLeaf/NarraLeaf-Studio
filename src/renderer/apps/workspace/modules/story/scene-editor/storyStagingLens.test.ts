import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryBlockId, StoryScene } from "@shared/types/story";
import { applyStagingLensToRows, isLensContainer, lensTrackRendersBar, projectStagingLens, resolveEffectiveLensContainers, type StoryLensRowTrack } from "./storyStagingLens";

/**
 * Build a one-container scene: the container holds `children` (already carrying ids), and every block
 * — including nested ones passed via `extra` — lands in the flat `blocks` map the projection reads.
 */
function sceneWith(container: StoryBlock, ...extra: StoryBlock[]): StoryScene {
    const blocks: Record<StoryBlockId, StoryBlock> = {};
    const index = (block: StoryBlock) => {
        blocks[block.id] = block;
    };
    index(container);
    extra.forEach(index);
    return {
        id: "scene",
        name: "Scene",
        runtimeName: "scene",
        rootBlockIds: [container.id],
        blocks,
    };
}

function control(id: string, control: "parallel" | "race" | "sequence" | "repeat", childrenIds: string[], extra?: Partial<Extract<StoryBlock, { kind: "control" }>["payload"]> & { disabled?: boolean }): StoryBlock {
    const { disabled, ...payloadExtra } = extra ?? {};
    return { id, kind: "control", parentId: null, childrenIds, payload: { control, ...payloadExtra } as never, ...(disabled ? { disabled } : {}) };
}

function action(id: string, parentId: string | null, payload: Extract<StoryBlock, { kind: "action" }>["payload"], disabled?: boolean): StoryBlock {
    return { id, kind: "action", parentId, childrenIds: [], payload, ...(disabled ? { disabled } : {}) };
}

function narration(id: string, parentId: string | null, value = "prose"): StoryBlock {
    return { id, kind: "nodeAction", parentId, childrenIds: [], payload: { action: "narration", text: { textId: `t-${id}`, value, role: "narration" } } };
}

function dialogue(id: string, parentId: string | null, pauseAfter?: number): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId,
        childrenIds: [],
        payload: { action: "dialogue", speakerName: "Ana", text: { textId: `t-${id}`, value: "line", role: "dialogue" }, ...(pauseAfter === undefined ? {} : { pauseAfter }) },
    };
}

describe("isLensContainer", () => {
    it("accepts parallel and race, rejects sequence/repeat/condition and non-control blocks", () => {
        expect(isLensContainer(control("p", "parallel", []))).toBe(true);
        expect(isLensContainer(control("r", "race", []))).toBe(true);
        expect(isLensContainer(control("s", "sequence", []))).toBe(false);
        expect(isLensContainer(control("rp", "repeat", []))).toBe(false);
        expect(isLensContainer(action("a", null, { action: "wait", mode: "click" }))).toBe(false);
    });
});

describe("projectStagingLens — duration derivation", () => {
    it("reads a proportional duration from each timing source and scales to the longest", () => {
        const move = action("move", "p", { action: "displayable", operation: "transform", target: { name: "hero" }, durationMs: 1000 });
        const fade = action("fade", "p", { action: "character", operation: "enter", characterId: "c", transition: { kind: "fadeIn", durationMs: 400 } });
        const bgm = action("bgm", "p", { action: "audio", operation: "setBgm", assetId: "a", fadeMs: 500 });
        const scene = sceneWith(control("p", "parallel", ["move", "fade", "bgm"]), move, fade, bgm);

        const lens = projectStagingLens(scene, scene.blocks.p);
        expect(lens.mode).toBe("parallel");
        expect(lens.scaleMs).toBe(1000);
        expect(lens.tracks.map(t => ({ id: t.blockId, kind: t.kind, durationMs: t.durationMs, unknown: t.unknown }))).toEqual([
            { id: "move", kind: "action", durationMs: 1000, unknown: false },
            { id: "fade", kind: "action", durationMs: 400, unknown: false },
            { id: "bgm", kind: "action", durationMs: 500, unknown: false },
        ]);
        expect(lens.tracks[2].isLast).toBe(true);
        expect(lens.winnerFinishMs).toBeNull();
    });

    it("draws a camera move to scale against the sprite move it runs with", () => {
        // The canonical `/parallel`: push the camera in while a portrait slides. If the camera track
        // came out `unknown` it would render as an equal-width dashed stub next to a real bar, which
        // is exactly the composition the lens exists to show (plan 2026-07-24-006 §12.7).
        const zoom = action("cam", "p", { action: "camera", operation: "zoom", zoom: 1.4, durationMs: 800 });
        const move = action("move", "p", { action: "displayable", operation: "transform", target: { name: "hero" }, durationMs: 400 });
        const scene = sceneWith(control("p", "parallel", ["cam", "move"]), zoom, move);

        const lens = projectStagingLens(scene, scene.blocks.p);
        expect(lens.scaleMs).toBe(800);
        expect(lens.tracks.map(t => ({ id: t.blockId, kind: t.kind, durationMs: t.durationMs, unknown: t.unknown }))).toEqual([
            { id: "cam", kind: "action", durationMs: 800, unknown: false },
            { id: "move", kind: "action", durationMs: 400, unknown: false },
        ]);
    });

    it("draws a vfx fade to scale, and only its fading operations", () => {
        // "The rain fades in while the camera pushes past" is the same canonical parallel, and the
        // engine's Vfx.show/hide WAIT for the fade, so the bar is a real footprint (§12.7). Its instant
        // operations carry no duration at all and must stay unknown rather than claiming a width.
        const fadeIn = action("rain", "p", { action: "vfx", operation: "show", objectName: "rain", durationMs: 1200 });
        const freeze = action("freeze", "p", { action: "vfx", operation: "pause", objectName: "rain" });
        const scene = sceneWith(control("p", "parallel", ["rain", "freeze"]), fadeIn, freeze);

        const lens = projectStagingLens(scene, scene.blocks.p);
        expect(lens.scaleMs).toBe(1200);
        expect(lens.tracks.map(t => ({ id: t.blockId, durationMs: t.durationMs, unknown: t.unknown }))).toEqual([
            { id: "rain", durationMs: 1200, unknown: false },
            { id: "freeze", durationMs: 0, unknown: true },
        ]);
    });

    it("treats an action with no derivable duration as unknown (equal-width stub)", () => {
        const setVar = action("set", "p", { action: "setVariable", target: { scope: "scene", variableId: "v" } as never, value: { kind: "number", value: 1 } as never });
        const scene = sceneWith(control("p", "parallel", ["set"]), setVar);
        const lens = projectStagingLens(scene, scene.blocks.p);
        expect(lens.tracks[0]).toMatchObject({ kind: "action", unknown: true, durationMs: 0, delayMs: 0 });
        // All-unknown container floors the scale to 1 so bar widths never divide by zero.
        expect(lens.scaleMs).toBe(1);
    });

    it("renders a timed wait as a leading delay and a click-wait as unknown", () => {
        const timed = action("w1", "p", { action: "wait", mode: "duration", durationMs: 800 });
        const click = action("w2", "p", { action: "wait", mode: "click" });
        const scene = sceneWith(control("p", "parallel", ["w1", "w2"]), timed, click);
        const lens = projectStagingLens(scene, scene.blocks.p);
        expect(lens.tracks[0]).toMatchObject({ kind: "wait", delayMs: 800, durationMs: 0, unknown: false, finishMs: 800 });
        expect(lens.tracks[1]).toMatchObject({ kind: "wait", unknown: true });
        expect(lens.scaleMs).toBe(800);
    });
});

describe("projectStagingLens — text children keep their ordinary row", () => {
    /**
     * A prose child is reachable inside a lens today (the tail "+" commits typed prose as a narration
     * child of the container). It must NOT become a bar-only track: the renderer keys off `kind` to
     * keep it on the ordinary row path, which is the only path that carries the in-place text editor,
     * the voice indicator and the row actions. A bar-only track there renders an inert row that
     * swallows every keystroke once click / double-click / Enter opens it for editing.
     */
    it("classifies a narration child as a text track with no footprint", () => {
        const prose = narration("n", "p");
        const move = action("move", "p", { action: "displayable", operation: "transform", target: { name: "hero" }, durationMs: 600 });
        const scene = sceneWith(control("p", "parallel", ["n", "move"]), prose, move);
        const lens = projectStagingLens(scene, scene.blocks.p);
        expect(lens.tracks.map(t => ({ id: t.blockId, kind: t.kind }))).toEqual([
            { id: "n", kind: "text" },
            { id: "move", kind: "action" },
        ]);
        expect(lens.tracks[0]).toMatchObject({ delayMs: 0, durationMs: 0, finishMs: 0, unknown: true });
        // The prose track is invisible on the timeline, so it must not shrink the bars around it.
        expect(lens.scaleMs).toBe(600);
    });

    it("tells the row renderer to keep the ordinary content column for a text track only", () => {
        // The seam the row renderer branches on: everything else swaps its content column for a bar,
        // prose keeps the ordinary one (and with it the editor / voice indicator / row actions).
        const prose = narration("n", "p");
        const wait = action("w", "p", { action: "wait", mode: "duration", durationMs: 300 });
        const inner = control("inner", "sequence", []);
        inner.parentId = "p";
        const scene = sceneWith(control("p", "parallel", ["n", "w", "inner"]), prose, wait, inner);
        const bars = projectStagingLens(scene, scene.blocks.p).tracks
            .map(segment => lensTrackRendersBar({ segment, scaleMs: 1, mode: "parallel", winnerFinishMs: null }));
        expect(bars).toEqual([false, true, true]);
    });

    it("keeps a dialogue child out of the scale and the race decision", () => {
        // `pauseAfter` is a real dwell, but a track that draws no bar must not set the scale nor place
        // the race marker where no visible bar explains it. It still counts inside a subgroup aggregate.
        const line = dialogue("d", "r", 2000);
        const fast = action("fast", "r", { action: "displayable", operation: "transform", target: { name: "x" }, durationMs: 400 });
        const scene = sceneWith(control("r", "race", ["d", "fast"]), line, fast);
        const lens = projectStagingLens(scene, scene.blocks.r);
        expect(lens.tracks[0]).toMatchObject({ kind: "text", unknown: true, finishMs: 0 });
        expect(lens.scaleMs).toBe(400);
        expect(lens.winnerFinishMs).toBe(400);
    });

});

describe("projectStagingLens — race semantics", () => {
    it("marks the earliest known finish without shortening any bar", () => {
        const quick = action("q", "r", { action: "displayable", operation: "transform", target: { name: "x" }, durationMs: 300 });
        const slow = action("s", "r", { action: "displayable", operation: "transform", target: { name: "y" }, durationMs: 1200 });
        const scene = sceneWith(control("r", "race", ["q", "s"]), quick, slow);
        const lens = projectStagingLens(scene, scene.blocks.r);
        expect(lens.mode).toBe("race");
        // The decision point is the SHORTEST track; the longer track keeps its full 1200ms footprint.
        expect(lens.winnerFinishMs).toBe(300);
        expect(lens.scaleMs).toBe(1200);
        expect(lens.tracks.find(t => t.blockId === "s")?.finishMs).toBe(1200);
    });

    it("has no decision marker when every race track is unknown", () => {
        const a = action("a", "r", { action: "wait", mode: "click" });
        const b = action("b", "r", { action: "setVariable", target: { scope: "scene", variableId: "v" } as never, value: { kind: "number", value: 1 } as never });
        const scene = sceneWith(control("r", "race", ["a", "b"]), a, b);
        expect(projectStagingLens(scene, scene.blocks.r).winnerFinishMs).toBeNull();
    });
});

describe("projectStagingLens — nested containers and disabled children", () => {
    it("collapses a nested container into one subgroup track, summing a sequence and maxing a parallel", () => {
        // sequence [500,700] -> 1200 sum; parallel [300,900] -> 900 max
        const seqChildA = action("sa", "seq", { action: "displayable", operation: "transform", target: { name: "a" }, durationMs: 500 });
        const seqChildB = action("sb", "seq", { action: "displayable", operation: "transform", target: { name: "b" }, durationMs: 700 });
        const seq = control("seq", "sequence", ["sa", "sb"]);
        seq.parentId = "p";
        const parChildA = action("pa", "par", { action: "displayable", operation: "transform", target: { name: "c" }, durationMs: 300 });
        const parChildB = action("pb", "par", { action: "displayable", operation: "transform", target: { name: "d" }, durationMs: 900 });
        const par = control("par", "parallel", ["pa", "pb"]);
        par.parentId = "p";
        const scene = sceneWith(control("p", "parallel", ["seq", "par"]), seq, par, seqChildA, seqChildB, parChildA, parChildB);

        const lens = projectStagingLens(scene, scene.blocks.p);
        expect(lens.tracks.map(t => ({ id: t.blockId, kind: t.kind, durationMs: t.durationMs }))).toEqual([
            { id: "seq", kind: "subgroup", durationMs: 1200 },
            { id: "par", kind: "subgroup", durationMs: 900 },
        ]);
        expect(lens.scaleMs).toBe(1200);
    });

    it("keeps a disabled child as a track but excludes it from the scale and race marker", () => {
        const on = action("on", "r", { action: "displayable", operation: "transform", target: { name: "a" }, durationMs: 400 });
        const off = action("off", "r", { action: "displayable", operation: "transform", target: { name: "b" }, durationMs: 100 }, true);
        const scene = sceneWith(control("r", "race", ["on", "off"]), on, off);
        const lens = projectStagingLens(scene, scene.blocks.r);
        expect(lens.tracks.map(t => t.blockId)).toEqual(["on", "off"]);
        expect(lens.tracks[1].disabled).toBe(true);
        // The disabled 100ms track does not win the race nor set the scale.
        expect(lens.winnerFinishMs).toBe(400);
        expect(lens.scaleMs).toBe(400);
    });
});

/** A minimal visible-row stand-in for the row-projection tests (only `block` is read). */
type Row = { block: StoryBlock; lensTrack?: StoryLensRowTrack };
function rowsOf(scene: StoryScene, ...ids: string[]): Row[] {
    return ids.map(id => ({ block: scene.blocks[id] }));
}

describe("resolveEffectiveLensContainers", () => {
    it("keeps only existing parallel/race ids, dropping deleted ids and non-lens kinds", () => {
        const seq = control("seq", "sequence", []);
        const par = control("par", "parallel", []);
        const scene = sceneWith(par, seq);
        const effective = resolveEffectiveLensContainers(scene, new Set(["par", "seq", "ghost"]));
        expect([...effective]).toEqual(["par"]);
    });

    it("drops a lens nested inside another enabled lens (it shows as a subgroup track)", () => {
        const inner = control("inner", "parallel", []);
        inner.parentId = "outer";
        const outer = control("outer", "parallel", ["inner"]);
        const scene = sceneWith(outer, inner);
        expect([...resolveEffectiveLensContainers(scene, new Set(["outer", "inner"]))]).toEqual(["outer"]);
        // With only the inner enabled, it renders on its own.
        expect([...resolveEffectiveLensContainers(scene, new Set(["inner"]))]).toEqual(["inner"]);
    });
});

describe("applyStagingLensToRows", () => {
    it("annotates each direct child with a track and leaves outside rows untouched", () => {
        const a = action("a", "p", { action: "wait", mode: "duration", durationMs: 500 });
        const b = action("b", "p", { action: "wait", mode: "duration", durationMs: 1000 });
        const outside = action("out", null, { action: "wait", mode: "duration", durationMs: 200 });
        const par = control("p", "parallel", ["a", "b"]);
        const scene = sceneWith(par, a, b, outside);
        const rows: Row[] = [{ block: par }, ...rowsOf(scene, "a", "b"), { block: outside }];
        const result = applyStagingLensToRows(scene, rows, new Set(["p"]));
        expect(result.map(r => r.block.id)).toEqual(["p", "a", "b", "out"]);
        // The container header and the outside row carry no track; the two children do.
        expect(result[0].lensTrack).toBeUndefined();
        expect(result[3].lensTrack).toBeUndefined();
        expect(result[1].lensTrack).toMatchObject({ mode: "parallel", scaleMs: 1000, segment: { blockId: "a", delayMs: 500 } });
        expect(result[2].lensTrack).toMatchObject({ segment: { blockId: "b", isLast: true } });
    });

    it("still annotates a text child as a track, so the lens keeps its tail + on the last row", () => {
        // The prose row renders on the ordinary path (no bar), but it is a direct child like any other:
        // it stays in the row list and keeps `isLast`, which is what hangs the lens's tail "+" off it.
        const move = action("move", "p", { action: "displayable", operation: "transform", target: { name: "hero" }, durationMs: 600 });
        const prose = narration("n", "p");
        const par = control("p", "parallel", ["move", "n"]);
        const scene = sceneWith(par, move, prose);
        const result = applyStagingLensToRows(scene, [{ block: par }, { block: move }, { block: prose }] as Row[], new Set(["p"]));
        expect(result.map(r => r.block.id)).toEqual(["p", "move", "n"]);
        expect(result[2].lensTrack).toMatchObject({ segment: { blockId: "n", kind: "text", isLast: true } });
    });

    it("prunes a nested container's own descendants, keeping the container as one subgroup track", () => {
        const grand = action("g", "inner", { action: "wait", mode: "duration", durationMs: 300 });
        const inner = control("inner", "parallel", ["g"]);
        inner.parentId = "outer";
        const sibling = action("s", "outer", { action: "wait", mode: "duration", durationMs: 700 });
        const outer = control("outer", "parallel", ["inner", "s"]);
        const scene = sceneWith(outer, inner, grand, sibling);
        // buildVisibleRows would emit outer, inner, grand, sibling (all expanded).
        const rows: Row[] = [{ block: outer }, { block: inner }, { block: grand }, { block: sibling }];
        const result = applyStagingLensToRows(scene, rows, new Set(["outer"]));
        // The grandchild `g` is dropped; `inner` survives as a subgroup track.
        expect(result.map(r => r.block.id)).toEqual(["outer", "inner", "s"]);
        expect(result[1].lensTrack).toMatchObject({ segment: { blockId: "inner", kind: "subgroup", durationMs: 300 } });
        expect(result[2].lensTrack).toMatchObject({ segment: { blockId: "s", kind: "wait" } });
    });
});

describe("projectStagingLens — malformed graph guards (never hang the render thread)", () => {
    it("terminates on a childrenIds cycle instead of recursing forever", () => {
        // p -> inner -> p (a corrupted cycle): the nested aggregation must bottom out, not spin.
        const inner = control("inner", "parallel", ["p"]);
        inner.parentId = "p";
        const par = control("p", "parallel", ["inner"]);
        const scene = sceneWith(par, inner);
        const lens = projectStagingLens(scene, scene.blocks.p);
        expect(lens.tracks.map(t => t.blockId)).toEqual(["inner"]);
        // No known duration survives the cycle break, so the subgroup reads as unknown.
        expect(lens.tracks[0]).toMatchObject({ kind: "subgroup", unknown: true });
    });

    it("terminates the ancestor walk on a parentId cycle", () => {
        const a = action("a", "b", { action: "wait", mode: "duration", durationMs: 100 });
        const b = action("b", "a", { action: "wait", mode: "duration", durationMs: 200 });
        const scene = sceneWith(control("p", "parallel", []), a, b);
        // a.parent=b, b.parent=a — neither is a lens, but the walk must stop rather than loop.
        expect(resolveEffectiveLensContainers(scene, new Set(["p"]))).toBeInstanceOf(Set);
        const result = applyStagingLensToRows(scene, [{ block: a }] as Row[], new Set(["p"]));
        expect(result.map(r => r.block.id)).toEqual(["a"]);
    });
});
