import { describe, expect, it } from "vitest";
import {
    dragStoryPreviewDockWidth,
    resolveStoryPreviewDockLayout,
    STORY_PREVIEW_DOCK_SEAM_PX,
    STORY_SCRIPT_MIN_LINE_EM,
    storyPreviewDockFitsBeside,
    storyScriptMinWidth,
} from "./storyPreviewDockLayout";
import {
    STORY_PREVIEW_PANE_DEFAULT_WIDTH,
    STORY_PREVIEW_PANE_MIN_WIDTH,
} from "./storyScenePreviewSessionStore";
import { storyGutterWidth } from "../storyEditorTextStyle";

/**
 * The docked live preview shares the scene editor's body with the script, and the script keeps a
 * readable width: the preview's stored width is honoured while it fits beside that, shrinks toward
 * its own minimum when it does not, and moves under the script when even the minimum does not fit.
 */

/** The default editor face (14px, compact) and a scene of fewer than a hundred rows. */
const SCRIPT_MIN = storyScriptMinWidth({ fontSize: 14, gutterWidth: storyGutterWidth(21) });

describe("the script's minimum width", () => {
    it("is a narration row's furniture plus twenty ems of words", () => {
        expect(STORY_SCRIPT_MIN_LINE_EM).toBe(20);
        // 202px of furniture (scrollbar, edge, gutter, mark, gaps, actions, padding) + 20 x 14px.
        expect(SCRIPT_MIN).toBe(482);
    });

    it("follows the editor's face and the gutter's width", () => {
        expect(storyScriptMinWidth({ fontSize: 18, gutterWidth: 38 })).toBe(202 + 20 * 18);
        // A thousand-row scene's gutter is one digit wider, and the words keep their twenty ems.
        expect(storyScriptMinWidth({ fontSize: 14, gutterWidth: storyGutterWidth(1000) })).toBe(SCRIPT_MIN + 12);
        // A density's scaled face is fractional before rounding; the minimum is whole pixels.
        expect(Number.isInteger(storyScriptMinWidth({ fontSize: 15.12, gutterWidth: 38 }))).toBe(true);
    });
});

describe("where the docked preview goes", () => {
    it("keeps the stored width while there is room for it beside the script", () => {
        expect(resolveStoryPreviewDockLayout({ bodyWidth: 1180, storedWidth: 420, scriptMinWidth: SCRIPT_MIN }))
            .toMatchObject({ kind: "side", previewWidth: 420 });
    });

    it("gives way to the script first, and takes the stored width back when the room returns", () => {
        const squeezed = resolveStoryPreviewDockLayout({ bodyWidth: 860, storedWidth: 420, scriptMinWidth: SCRIPT_MIN });
        expect(squeezed).toEqual({ kind: "side", previewWidth: 860 - STORY_PREVIEW_DOCK_SEAM_PX - SCRIPT_MIN, maxPreviewWidth: 376 });
        // Nothing was written: the same stored width, in a wider body, is honoured again.
        expect(resolveStoryPreviewDockLayout({ bodyWidth: 1180, storedWidth: 420, scriptMinWidth: SCRIPT_MIN }))
            .toMatchObject({ kind: "side", previewWidth: 420 });
    });

    it("goes no narrower than its own minimum beside the script, and moves under it below that", () => {
        const tightest = SCRIPT_MIN + STORY_PREVIEW_DOCK_SEAM_PX + STORY_PREVIEW_PANE_MIN_WIDTH;
        expect(storyPreviewDockFitsBeside(tightest, SCRIPT_MIN)).toBe(true);
        expect(resolveStoryPreviewDockLayout({ bodyWidth: tightest, storedWidth: 420, scriptMinWidth: SCRIPT_MIN }))
            .toEqual({ kind: "side", previewWidth: STORY_PREVIEW_PANE_MIN_WIDTH, maxPreviewWidth: STORY_PREVIEW_PANE_MIN_WIDTH });
        expect(storyPreviewDockFitsBeside(tightest - 1, SCRIPT_MIN)).toBe(false);
        expect(resolveStoryPreviewDockLayout({ bodyWidth: tightest - 1, storedWidth: 420, scriptMinWidth: SCRIPT_MIN }))
            .toEqual({ kind: "stack" });
    });

    it("moves under the script in a 1400px window with both sidebars open", () => {
        // The editor body measured at that size: 660px, where the stored 420 used to leave the
        // script 238px and a 35-character line broke after every second character.
        expect(resolveStoryPreviewDockLayout({ bodyWidth: 659.6, storedWidth: STORY_PREVIEW_PANE_DEFAULT_WIDTH, scriptMinWidth: SCRIPT_MIN }))
            .toEqual({ kind: "stack" });
    });

    it("never takes more than its share of a very wide body", () => {
        expect(resolveStoryPreviewDockLayout({ bodyWidth: 2000, storedWidth: 1600, scriptMinWidth: SCRIPT_MIN }))
            .toEqual({ kind: "side", previewWidth: 1400, maxPreviewWidth: 1400 });
    });

    it("reads a stored width below the minimum as the minimum", () => {
        expect(resolveStoryPreviewDockLayout({ bodyWidth: 1180, storedWidth: 100, scriptMinWidth: SCRIPT_MIN }))
            .toMatchObject({ kind: "side", previewWidth: STORY_PREVIEW_PANE_MIN_WIDTH });
    });

    it("depends on the face the script is set in", () => {
        // A body that holds both at 14px holds only the script at 24px.
        const larger = storyScriptMinWidth({ fontSize: 24, gutterWidth: 38 });
        expect(storyPreviewDockFitsBeside(900, SCRIPT_MIN)).toBe(true);
        expect(storyPreviewDockFitsBeside(900, larger)).toBe(false);
    });
});

describe("dragging the docked preview's edge", () => {
    it("stops where the script reaches its minimum", () => {
        // Squeezed to 376px in an 860px body: a drag toward the script cannot widen it.
        expect(dragStoryPreviewDockWidth(376, -200, 376)).toBe(376);
        expect(dragStoryPreviewDockWidth(300, -200, 376.4)).toBe(376);
    });

    it("narrows it toward its own minimum and no further", () => {
        expect(dragStoryPreviewDockWidth(376, 50, 376)).toBe(326);
        expect(dragStoryPreviewDockWidth(300, 100, 376)).toBe(STORY_PREVIEW_PANE_MIN_WIDTH);
    });

    it("lands on whole pixels", () => {
        expect(dragStoryPreviewDockWidth(400, 10.6, 600)).toBe(389);
    });
});
