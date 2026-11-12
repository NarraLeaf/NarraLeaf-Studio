import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryScene } from "@shared/types/story";
import {
    alignFromBox,
    gizmoStartScale,
    gizmoTransformPatch,
    moveGizmo,
    resolveStageGizmoRow,
    scaleGizmo,
    snapBox,
    writeGizmoTransform,
    type GizmoBox,
} from "./stageGizmoModel";

function action(id: string, payload: unknown): StoryBlock {
    return { id, kind: "action", parentId: null, childrenIds: [], payload } as unknown as StoryBlock;
}

function sceneOf(...blocks: StoryBlock[]): StoryScene {
    return { id: "s", name: "S", blocks: Object.fromEntries(blocks.map(block => [block.id, block])) } as unknown as StoryScene;
}

const CONTAINER = { width: 960, height: 540 };

describe("resolveStageGizmoRow", () => {
    it("lets a character enter or move be placed, keyed by its stage name", () => {
        const enter = action("a", { action: "character", operation: "enter", characterId: "c1" });
        const move = action("b", { action: "character", operation: "move", characterId: "c1", objectName: "hero" });
        expect(resolveStageGizmoRow(sceneOf(enter), enter, false)).toMatchObject({ kind: "editable", stageKey: "c1" });
        expect(resolveStageGizmoRow(sceneOf(move), move, false)).toMatchObject({ kind: "editable", stageKey: "hero" });
    });

    it("explains a row that mentions the object without placing it", () => {
        const expression = action("a", { action: "character", operation: "expression", characterId: "c1" });
        const hide = action("b", { action: "image", operation: "hide", objectName: "poster" });
        const loop = action("c", { action: "displayable", operation: "loop", target: { name: "poster", kind: "image" } });
        for (const block of [expression, hide, loop]) {
            expect(resolveStageGizmoRow(sceneOf(block), block, false)).toEqual({ kind: "blocked", blockId: block.id, reason: "operation" });
        }
    });

    it("follows a displayable reference to its creator's current name", () => {
        const create = action("create", { action: "image", operation: "create", objectName: "door" });
        const transform = action("t", {
            action: "displayable",
            operation: "transform",
            target: { sourceBlockId: "create", name: "old-name", kind: "image" },
        });
        expect(resolveStageGizmoRow(sceneOf(create, transform), transform, false)).toMatchObject({ kind: "editable", stageKey: "door" });
    });

    it("refuses motion-driven rows, text, layers and built-ins, and a read-only scene", () => {
        const motion = action("m", { action: "character", operation: "move", characterId: "c1", transform: { mode: "animation", animationId: "x" } });
        const text = action("t", { action: "text", operation: "show", objectName: "title" });
        const background = action("b", { action: "displayable", operation: "transform", target: { builtin: "background" } });
        const show = action("s", { action: "image", operation: "show", objectName: "poster" });
        expect(resolveStageGizmoRow(sceneOf(motion), motion, false)).toMatchObject({ reason: "motion" });
        expect(resolveStageGizmoRow(sceneOf(text), text, false)).toMatchObject({ reason: "text" });
        expect(resolveStageGizmoRow(sceneOf(background), background, false)).toMatchObject({ reason: "notSprite" });
        expect(resolveStageGizmoRow(sceneOf(show), show, true)).toMatchObject({ reason: "readOnly" });
    });

    it("stays out of the way on rows with nothing on the stage", () => {
        const dialogue = { id: "d", kind: "nodeAction", parentId: null, childrenIds: [], payload: { action: "dialogue" } } as unknown as StoryBlock;
        const wait = action("w", { action: "wait", mode: "click" });
        expect(resolveStageGizmoRow(sceneOf(dialogue), dialogue, false)).toBeNull();
        expect(resolveStageGizmoRow(sceneOf(wait), wait, false)).toBeNull();
        expect(resolveStageGizmoRow(null, null, false)).toBeNull();
    });
});

describe("screen to position", () => {
    it("reads the centre as shares from the bottom-left, whatever the stage is drawn at", () => {
        expect(alignFromBox({ cx: 480, cy: 270 }, CONTAINER)).toEqual({ xalign: 0.5, yalign: 0.5 });
        expect(alignFromBox({ cx: 240, cy: 405 }, CONTAINER)).toEqual({ xalign: 0.25, yalign: 0.25 });
        // The same object on a stage drawn at half the size (Studio zoomed out, a narrower pane).
        expect(alignFromBox({ cx: 120, cy: 202.5 }, { width: 480, height: 270 })).toEqual({ xalign: 0.25, yalign: 0.25 });
    });
});

describe("snapping", () => {
    const box: GizmoBox = { cx: 484, cy: 100, width: 100, height: 200 };

    it("pulls a centre near the middle onto it and names the guide", () => {
        const result = snapBox(box, CONTAINER);
        expect(result.box.cx).toBe(480);
        expect(result.guides).toContainEqual({ axis: "x", at: 0.5, kind: "center" });
    });

    it("pulls an edge onto the safe area", () => {
        // Left edge at 51; the safe line is 5% of 960 = 48.
        const result = snapBox({ cx: 101, cy: 270, width: 100, height: 100 }, CONTAINER);
        expect(result.box.cx).toBe(98);
        expect(result.guides).toContainEqual({ axis: "x", at: 0.05, kind: "safe" });
    });

    it("leaves a box out of reach of every guide alone", () => {
        const far = { cx: 400, cy: 200, width: 30, height: 30 };
        expect(snapBox(far, CONTAINER)).toEqual({ box: far, guides: [] });
    });

    it("can be switched off, and keeps a locked axis where it was", () => {
        expect(moveGizmo(box, 0, 0, CONTAINER, { snap: false, axisLock: false }).box.cx).toBe(484);
        const locked = moveGizmo({ cx: 300, cy: 268, width: 50, height: 50 }, 10, 3, CONTAINER, { snap: true, axisLock: true });
        expect(locked.box.cy).toBe(268);
        expect(locked.guides.every(guide => guide.axis === "x")).toBe(true);
    });
});

describe("corner scaling", () => {
    const start: GizmoBox = { cx: 500, cy: 300, width: 200, height: 100 };

    it("keeps the opposite corner fixed and the proportions held", () => {
        // Bottom-right corner dragged out along its own diagonal by half the box.
        const result = scaleGizmo(start, { sx: 1, sy: 1 }, 200, 100, { free: false, fromCenter: false });
        expect(result.factorX).toBeCloseTo(2);
        expect(result.factorY).toBeCloseTo(2);
        expect(result.box.cx - result.box.width / 2).toBeCloseTo(400);
        expect(result.box.cy - result.box.height / 2).toBeCloseTo(250);
    });

    it("grows about the centre with Alt", () => {
        const result = scaleGizmo(start, { sx: -1, sy: -1 }, -100, -50, { free: false, fromCenter: true });
        expect(result.factorX).toBeCloseTo(2);
        expect(result.box.cx).toBe(500);
        expect(result.box.cy).toBe(300);
    });

    it("scales each axis on its own with Shift", () => {
        const result = scaleGizmo(start, { sx: 1, sy: 1 }, 200, 0, { free: true, fromCenter: false });
        expect(result.factorX).toBeCloseTo(2);
        expect(result.factorY).toBeCloseTo(1);
    });

    it("never folds the box through itself", () => {
        const result = scaleGizmo(start, { sx: 1, sy: 1 }, -1000, -1000, { free: false, fromCenter: false });
        expect(result.factorX).toBeGreaterThan(0);
    });
});

describe("writing back", () => {
    const design = { width: 1920, height: 1080 };

    it("writes the centre as rounded shares and keeps the row's offsets", () => {
        const patch = gizmoTransformPatch({
            box: { cx: 320.4, cy: 135, width: 10, height: 10 },
            container: CONTAINER,
            position: { xalign: 0.5, yalign: 0.5, xoffset: 192 },
            designSize: design,
            moved: true,
        });
        // 320.4/960 = 0.33375, less 192/1920 = 0.1.
        expect(patch.position).toEqual({ xalign: 0.234, yalign: 0.75, xoffset: 192 });
    });

    it("holds a far drop to the align reach the command line accepts", () => {
        const patch = gizmoTransformPatch({ box: { cx: 5000, cy: 0, width: 1, height: 1 }, container: CONTAINER, position: undefined, designSize: design, moved: true });
        expect(patch.position?.xalign).toBe(2);
    });

    it("multiplies the row's zoom for a proportional resize, the axes for a free one", () => {
        const start = { zoom: 1.5, scaleX: -1, scaleY: 1 };
        const uniform = gizmoTransformPatch({ box: { cx: 0, cy: 0, width: 1, height: 1 }, container: CONTAINER, position: undefined, designSize: design, moved: false, scale: { factorX: 1.2, factorY: 1.2, free: false, start } });
        expect(uniform).toEqual({ zoom: 1.8 });
        const free = gizmoTransformPatch({ box: { cx: 0, cy: 0, width: 1, height: 1 }, container: CONTAINER, position: undefined, designSize: design, moved: false, scale: { factorX: 2, factorY: 0.5, free: true, start } });
        expect(free).toEqual({ scaleX: -2, scaleY: 0.5 });
    });

    it("merges into the row's transform without touching the rest of the row", () => {
        const payload = {
            action: "character" as const,
            operation: "move" as const,
            characterId: "c1",
            transform: { durationMs: 400, easing: "easeOut", to: { opacity: 1, position: { xalign: 0.2, yalign: 0.5 } } },
        };
        const next = writeGizmoTransform(payload, { position: { xalign: 0.7, yalign: 0.4 }, zoom: 1.1 });
        expect(next).toEqual({
            ...payload,
            transform: { mode: "props", durationMs: 400, easing: "easeOut", to: { opacity: 1, position: { xalign: 0.7, yalign: 0.4 }, zoom: 1.1 } },
        });
        expect(payload.transform.to.position.xalign).toBe(0.2);
    });

    it("starts from the row's own size, else the stage's, else neutral", () => {
        expect(gizmoStartScale({ zoom: 2 }, { zoom: 3, scaleX: -1 })).toEqual({ zoom: 2, scaleX: -1, scaleY: 1 });
        expect(gizmoStartScale(undefined, null)).toEqual({ zoom: 1, scaleX: 1, scaleY: 1 });
    });
});
