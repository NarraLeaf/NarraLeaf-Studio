import { describe, expect, it } from "vitest";
import type { StoryDocument, StoryScene } from "@shared/types/story";
import {
    buildOutlineRows,
    isOutlineDropAllowed,
    outlineChapterGapForRow,
    outlineGapAnchor,
    outlineGapForRow,
    outlineHalfFromPointer,
    resolveChapterDropAtGap,
    resolveSceneDropAtGap,
} from "./storyOutlineDnd";

function scene(id: string): StoryScene {
    return { id, name: id, runtimeName: id, blocks: {}, rootBlockIds: [] } as unknown as StoryScene;
}

/** Three chapters: `c1` holds s1..s3, `c2` holds s4, `c3` is empty. */
function document(): StoryDocument {
    return {
        schemaVersion: 12,
        id: "story-1",
        name: "Story",
        chapters: [
            { id: "c1", name: "One", sceneIds: ["s1", "s2", "s3"] },
            { id: "c2", name: "Two", sceneIds: ["s4"] },
            { id: "c3", name: "Three", sceneIds: [] },
        ],
        scenes: { s1: scene("s1"), s2: scene("s2"), s3: scene("s3"), s4: scene("s4") },
    } as unknown as StoryDocument;
}

const ALL_OPEN = new Set(["c1", "c2", "c3"]);

/**
 * Rows with every chapter expanded, which is the outline's own default:
 *
 * ```
 * 0 c1   1 s1   2 s2   3 s3   4 c2   5 s4   6 c3
 * ```
 *
 * so the gaps are 0..7.
 */
const rows = () => buildOutlineRows(document(), ALL_OPEN);

describe("buildOutlineRows", () => {
    it("lists the rows in the order the outline draws them", () => {
        expect(rows().map(row => (row.kind === "chapter" ? row.chapterId : row.sceneId)))
            .toEqual(["c1", "s1", "s2", "s3", "c2", "s4", "c3"]);
    });

    it("leaves out the scenes of a collapsed chapter, which are not on screen to aim at", () => {
        const collapsed = buildOutlineRows(document(), new Set(["c2", "c3"]));
        expect(collapsed.map(row => (row.kind === "chapter" ? row.chapterId : row.sceneId)))
            .toEqual(["c1", "c2", "s4", "c3"]);
    });
});

describe("outlineGapForRow / outlineHalfFromPointer", () => {
    it("makes the bottom of one row and the top of the next the same gap", () => {
        const rect = { top: 100, height: 20 };
        expect(outlineHalfFromPointer(104, rect)).toBe("top");
        expect(outlineHalfFromPointer(116, rect)).toBe("bottom");
        // Row 3's bottom half and row 4's top half both aim at gap 4 - one gap, one answer.
        expect(outlineGapForRow(3, "bottom")).toBe(4);
        expect(outlineGapForRow(4, "top")).toBe(4);
    });
});

describe("outlineGapAnchor", () => {
    it("draws every gap in exactly one place", () => {
        expect(outlineGapAnchor(7, 0)).toEqual({ rowIndex: 0, edge: "before" });
        expect(outlineGapAnchor(7, 4)).toEqual({ rowIndex: 4, edge: "before" });
        // The last gap is the only one drawn on a row's bottom edge; there is no row below it.
        expect(outlineGapAnchor(7, 7)).toEqual({ rowIndex: 6, edge: "after" });
        expect(outlineGapAnchor(7, 8)).toBeNull();
        expect(outlineGapAnchor(0, 0)).toBeNull();
    });
});

describe("outlineChapterGapForRow", () => {
    it("gives a heading's halves the two ends of its whole block", () => {
        const r = rows();
        expect(outlineChapterGapForRow(r, 0, "top")).toBe(0);
        // c1's block is rows 0..3, so its far end is gap 4 - the gap above c2's heading.
        expect(outlineChapterGapForRow(r, 0, "bottom")).toBe(4);
        expect(outlineChapterGapForRow(r, 4, "bottom")).toBe(6);
        expect(outlineChapterGapForRow(r, 6, "bottom")).toBe(7);
    });

    it("answers for headings only", () => {
        expect(outlineChapterGapForRow(rows(), 2, "top")).toBeNull();
    });
});

describe("resolveSceneDropAtGap", () => {
    it("puts a scene in the gap above the scene it is dropped over", () => {
        expect(resolveSceneDropAtGap(document(), rows(), "s3", 1))
            .toEqual({ chapterId: "c1", beforeSceneId: "s1" });
    });

    it("reads the anchor off the chapter with the dragged scene already taken out", () => {
        // Gap 3 is above s3. Dropping s1 there must land it between s2 and s3 - read off the list as
        // drawn, "before s3" would be index 2, which is where s3 is only while s1 is still in front.
        expect(resolveSceneDropAtGap(document(), rows(), "s1", 3))
            .toEqual({ chapterId: "c1", beforeSceneId: "s3" });
    });

    it("treats the gap above a heading as the end of the chapter above it", () => {
        // Gap 4 sits between c1's last scene and c2's heading: the end of c1.
        expect(resolveSceneDropAtGap(document(), rows(), "s4", 4))
            .toEqual({ chapterId: "c1", beforeSceneId: null });
    });

    it("files a scene in a collapsed chapter through the gap under its heading", () => {
        const collapsed = buildOutlineRows(document(), new Set(["c1"]));
        // Rows: 0 c1, 1 s1, 2 s2, 3 s3, 4 c2, 5 c3. Gap 5 is under c2's heading.
        expect(resolveSceneDropAtGap(document(), collapsed, "s1", 5))
            .toEqual({ chapterId: "c2", beforeSceneId: null });
    });

    it("takes an empty chapter through the gap under its heading", () => {
        expect(resolveSceneDropAtGap(document(), rows(), "s1", 7))
            .toEqual({ chapterId: "c3", beforeSceneId: null });
    });

    it("refuses the gap above the first heading, where no chapter can hold it", () => {
        expect(resolveSceneDropAtGap(document(), rows(), "s1", 0)).toBeNull();
    });

    it("refuses the two gaps the scene already sits between", () => {
        const doc = document();
        const r = rows();
        // s2 is row 2, so gaps 2 and 3 are the ones it came out of.
        expect(resolveSceneDropAtGap(doc, r, "s2", 2)).toBeNull();
        expect(resolveSceneDropAtGap(doc, r, "s2", 3)).toBeNull();
        // And the gap two rows up is a real move.
        expect(resolveSceneDropAtGap(doc, r, "s2", 1)).toEqual({ chapterId: "c1", beforeSceneId: "s1" });
    });

    it("refuses a scene the document does not have", () => {
        expect(resolveSceneDropAtGap(document(), rows(), "nope", 1)).toBeNull();
    });
});

describe("resolveChapterDropAtGap", () => {
    it("moves a chapter to the gap above another heading", () => {
        expect(resolveChapterDropAtGap(document(), rows(), "c3", 0)).toEqual({ beforeChapterId: "c1" });
    });

    it("appends at the gap past the last row", () => {
        expect(resolveChapterDropAtGap(document(), rows(), "c1", 7)).toEqual({ beforeChapterId: null });
    });

    it("refuses every gap between the scenes of a chapter", () => {
        const doc = document();
        const r = rows();
        for (const gap of [1, 2, 3, 5]) {
            expect(resolveChapterDropAtGap(doc, r, "c3", gap)).toBeNull();
        }
    });

    it("refuses the gaps the chapter already sits between", () => {
        const doc = document();
        const r = rows();
        // c2's block is rows 4..5, so gap 4 is above it and gap 6 is below it.
        expect(resolveChapterDropAtGap(doc, r, "c2", 4)).toBeNull();
        expect(resolveChapterDropAtGap(doc, r, "c2", 6)).toBeNull();
        expect(resolveChapterDropAtGap(doc, r, "c2", 0)).toEqual({ beforeChapterId: "c1" });
    });
});

describe("isOutlineDropAllowed", () => {
    it("lights a gap only where the drop it would perform changes something", () => {
        const doc = document();
        const r = rows();
        expect(isOutlineDropAllowed(doc, r, { kind: "scene", sceneId: "s1" }, 5)).toBe(true);
        expect(isOutlineDropAllowed(doc, r, { kind: "scene", sceneId: "s1" }, 1)).toBe(false);
        expect(isOutlineDropAllowed(doc, r, { kind: "chapter", chapterId: "c1" }, 6)).toBe(true);
        expect(isOutlineDropAllowed(doc, r, { kind: "chapter", chapterId: "c1" }, 2)).toBe(false);
    });
});
