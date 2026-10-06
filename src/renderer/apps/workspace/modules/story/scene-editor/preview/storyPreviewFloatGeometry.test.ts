import { describe, expect, it } from "vitest";
import {
    clampStoryPreviewFloatRect,
    createDefaultStoryPreviewFloatRect,
    migrateEditorBodyStoryPreviewFloatRect,
    moveStoryPreviewFloatRect,
    resizeStoryPreviewFloatRect,
    STORY_PREVIEW_FLOAT_MARGIN,
} from "./storyPreviewFloatGeometry";
import {
    parseStoryScenePreviewPaneState,
    STORY_PREVIEW_FLOAT_MIN_HEIGHT,
    STORY_PREVIEW_FLOAT_MIN_WIDTH,
} from "./storyScenePreviewSessionStore";

/**
 * The floating preview's placement over the workspace's content area: kept inside it however the
 * window is dragged or the area shrinks, opened over the editor it came from, and carried over from
 * the editor-body frame older builds saved it in.
 */

const AREA = { width: 1352, height: 838 };

describe("floating preview geometry", () => {
    it("keeps a window inside the area, at its minimum size when the area is smaller", () => {
        expect(clampStoryPreviewFloatRect({ x: 1200, y: 700, width: 420, height: 300 }, AREA))
            .toEqual({ x: 932, y: 538, width: 420, height: 300 });
        expect(clampStoryPreviewFloatRect({ x: -40, y: -10, width: 420, height: 300 }, AREA))
            .toEqual({ x: 0, y: 0, width: 420, height: 300 });
        expect(clampStoryPreviewFloatRect({ x: 50, y: 50, width: 420, height: 300 }, { width: 200, height: 100 }))
            .toEqual({ x: 0, y: 0, width: STORY_PREVIEW_FLOAT_MIN_WIDTH, height: STORY_PREVIEW_FLOAT_MIN_HEIGHT });
    });

    it("re-clamps a stored rect against a smaller area without changing the stored one", () => {
        const stored = { x: 900, y: 500, width: 420, height: 300 };
        const shrunk = clampStoryPreviewFloatRect(stored, { width: 1000, height: 600 });
        expect(shrunk).toEqual({ x: 580, y: 300, width: 420, height: 300 });
        expect(shrunk.x + shrunk.width).toBeLessThanOrEqual(1000);
        expect(stored).toEqual({ x: 900, y: 500, width: 420, height: 300 });
        expect(clampStoryPreviewFloatRect(stored, AREA)).toEqual(stored);
    });

    it("drags anywhere in the area, docks included, and stops at its edges", () => {
        const start = { x: 610, y: 500, width: 420, height: 300 };
        expect(moveStoryPreviewFloatRect(start, 300, 0, AREA)).toEqual({ ...start, x: 910 });
        expect(moveStoryPreviewFloatRect(start, 2000, 2000, AREA)).toEqual({ ...start, x: 932, y: 538 });
        expect(moveStoryPreviewFloatRect(start, -2000, -2000, AREA)).toEqual({ ...start, x: 0, y: 0 });
    });

    it("resizes from a corner while the opposite corner stays put", () => {
        const start = { x: 100, y: 100, width: 420, height: 300 };
        expect(resizeStoryPreviewFloatRect(start, "se", 50, 40, AREA)).toEqual({ x: 100, y: 100, width: 470, height: 340 });
        expect(resizeStoryPreviewFloatRect(start, "nw", -50, -40, AREA)).toEqual({ x: 50, y: 60, width: 470, height: 340 });
        expect(resizeStoryPreviewFloatRect(start, "nw", 1000, 1000, AREA))
            .toEqual({ x: 520 - STORY_PREVIEW_FLOAT_MIN_WIDTH, y: 400 - STORY_PREVIEW_FLOAT_MIN_HEIGHT, width: STORY_PREVIEW_FLOAT_MIN_WIDTH, height: STORY_PREVIEW_FLOAT_MIN_HEIGHT });
        expect(resizeStoryPreviewFloatRect(start, "se", 5000, 5000, AREA)).toEqual({ x: 100, y: 100, width: 1252, height: 738 });
    });

    it("opens over the bottom-right corner of the editor it was popped out of", () => {
        const editorBody = { x: 371, y: 82, width: 660, height: 756 };
        const rect = createDefaultStoryPreviewFloatRect(AREA, editorBody);
        expect(rect).toEqual({
            x: 371 + 660 - 420 - STORY_PREVIEW_FLOAT_MARGIN,
            y: 82 + 756 - 300 - STORY_PREVIEW_FLOAT_MARGIN,
            width: 420,
            height: 300,
        });
        expect(createDefaultStoryPreviewFloatRect(AREA, null)).toEqual({
            x: AREA.width - 420 - STORY_PREVIEW_FLOAT_MARGIN,
            y: AREA.height - 300 - STORY_PREVIEW_FLOAT_MARGIN,
            width: 420,
            height: 300,
        });
    });

    it("opens at the top-right corner of an editor whose subject sits low", () => {
        const canvas = { x: 371, y: 130, width: 660, height: 708 };
        expect(createDefaultStoryPreviewFloatRect(AREA, canvas, "top-right")).toEqual({
            x: 371 + 660 - 420 - STORY_PREVIEW_FLOAT_MARGIN,
            y: 130 + STORY_PREVIEW_FLOAT_MARGIN,
            width: 420,
            height: 300,
        });
        // An editor barely taller than the window keeps the window inside it.
        expect(createDefaultStoryPreviewFloatRect(AREA, { ...canvas, height: 310 }, "top-right").y).toBe(140);
    });

    it("puts a rect saved against the editor body back where it was on screen", () => {
        const saved = { x: 240, y: 432, width: 420, height: 300 };
        expect(migrateEditorBodyStoryPreviewFloatRect(saved, { x: 371, y: 82 })).toEqual({ x: 611, y: 514, width: 420, height: 300 });
        // Without an editor on screen to measure, the rect is read as it stands; the clamp keeps it inside.
        expect(migrateEditorBodyStoryPreviewFloatRect(saved, null)).toEqual(saved);
    });
});

describe("stored preview layout", () => {
    it("reads a record from before the window belonged to the workspace as an editor-body rect", () => {
        const legacy = parseStoryScenePreviewPaneState({ open: true, width: 420, mode: "float", float: { x: 240, y: 432, width: 420, height: 300 } });
        expect(legacy.mode).toBe("float");
        expect(legacy.float).toEqual({ x: 240, y: 432, width: 420, height: 300 });
        expect(legacy.floatFrame).toBe("editorBody");
    });

    it("reads a current record in the workspace frame, and an empty one as having nothing to carry over", () => {
        const current = parseStoryScenePreviewPaneState({
            open: true, width: 420, mode: "float", float: { x: 911, y: 514, width: 420, height: 300 }, floatFrame: "workspace",
        });
        expect(current.floatFrame).toBe("workspace");
        const empty = parseStoryScenePreviewPaneState(undefined);
        expect(empty).toMatchObject({ open: false, mode: "dock", float: null, floatFrame: "workspace" });
    });
});
