/**
 * Which element a press, a Shift press, a marquee and a right-click pick, on a page shaped like the
 * ones authors build: a full-screen background, and a panel holding a title and two buttons, one of
 * which holds a label.
 */
import { describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import {
    filterMarqueeHitsToLevel,
    resolveMarqueeLevelParent,
    resolvePlainPressTarget,
    resolveSelectionLevelHit,
} from "./containerDrillSelection";
import { resolveContextMenuTarget } from "@/apps/workspace/modules/ui-editor/editors/useSurfaceCanvasContextMenu";
import { constrainDragToAxis } from "./useMoveableHandlers";
import { elementsChangedByHistoryStep } from "@/lib/ui-editor/commands/uiEditorSelection";

function element(id: string, type: string, parentId: string | null, childrenIds: string[] = []): UIElement {
    return { id, type, parentId, childrenIds, layout: { x: 0, y: 0, width: 100, height: 100 } } as UIElement;
}

const document: UIDocument = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    name: "Doc",
    surfaces: [
        {
            id: "page",
            name: "Page",
            host: "app",
            kind: "appSurface",
            designSize: { width: 1920, height: 1080 },
            rootElementId: "root",
        },
    ],
    elements: {
        root: element("root", "nl.root", null, ["background", "panel"]),
        background: element("background", "nl.image", "root"),
        panel: element("panel", "nl.container", "root", ["title", "start", "quit"]),
        title: element("title", "nl.text", "panel"),
        start: element("start", "nl.container", "panel", ["startLabel"]),
        startLabel: element("startLabel", "nl.text", "start"),
        quit: element("quit", "nl.container", "panel"),
    },
} as unknown as UIDocument;

function selected(...ids: string[]): UIElementSelection {
    return { editor: "ui", surfaceId: "page", elementIds: ids, primaryId: ids[ids.length - 1] };
}

describe("resolvePlainPressTarget", () => {
    it("picks the outermost frame when nothing is selected", () => {
        expect(resolvePlainPressTarget(document, "page", null, "startLabel")).toBe("panel");
    });

    it("keeps the selected container for a single press inside it", () => {
        expect(resolvePlainPressTarget(document, "page", selected("panel"), "startLabel")).toBe("panel");
    });

    it("picks the element hit beside the selection, under the same frame", () => {
        expect(resolvePlainPressTarget(document, "page", selected("title"), "quit")).toBe("quit");
    });
});

describe("resolveSelectionLevelHit (Shift)", () => {
    it("adds the sibling at the selection's level, not the deepest element hit", () => {
        // A button selected inside the panel; Shift on the other button's label adds that button.
        expect(resolveSelectionLevelHit(document, "page", selected("quit"), "startLabel")).toBe("start");
    });

    it("names the selected element itself when the press is inside it, so Shift takes it away", () => {
        expect(resolveSelectionLevelHit(document, "page", selected("start"), "startLabel")).toBe("start");
    });

    it("adds a frame when the press is nowhere near the selection's level", () => {
        expect(resolveSelectionLevelHit(document, "page", selected("title"), "background")).toBe("background");
    });

    it("stays at the top level when a top-level frame is selected", () => {
        expect(resolveSelectionLevelHit(document, "page", selected("panel"), "background")).toBe("background");
        expect(resolveSelectionLevelHit(document, "page", selected("background"), "startLabel")).toBe("panel");
    });
});

describe("marquee level", () => {
    it("picks the page's top-level elements when nothing is selected", () => {
        const level = resolveMarqueeLevelParent(document, "page", null);
        expect(level).toBe("root");
        // Everything the rectangle touched, at every depth: only the top level is kept.
        expect(
            filterMarqueeHitsToLevel(document, "page", level, ["background", "panel", "title", "start", "startLabel"]),
        ).toEqual(["background", "panel"]);
    });

    it("picks at the selection's level once inside a container", () => {
        const level = resolveMarqueeLevelParent(document, "page", selected("title"));
        expect(level).toBe("panel");
        expect(filterMarqueeHitsToLevel(document, "page", level, ["panel", "start", "startLabel", "quit"])).toEqual([
            "start",
            "quit",
        ]);
    });

    it("falls back to the outermost frames when the rectangle missed the selection's level", () => {
        expect(filterMarqueeHitsToLevel(document, "page", "panel", ["background"])).toEqual(["background"]);
        expect(filterMarqueeHitsToLevel(document, "page", "start", ["title", "quit"])).toEqual(["panel"]);
    });
});

describe("resolveContextMenuTarget", () => {
    it("acts on what a left click would select, not the deepest element", () => {
        expect(resolveContextMenuTarget(document, "page", null, "startLabel", false)).toBe("panel");
    });

    it("keeps a multiple selection when the press is inside one of its elements", () => {
        expect(resolveContextMenuTarget(document, "page", selected("start", "quit"), "startLabel", false)).toBe("start");
    });

    it("reaches the deepest element with Cmd/Ctrl", () => {
        expect(resolveContextMenuTarget(document, "page", null, "startLabel", true)).toBe("startLabel");
    });
});

describe("constrainDragToAxis (Shift while moving)", () => {
    it("keeps the axis the pointer travelled further along", () => {
        expect(constrainDragToAxis(40, 12, true)).toEqual([40, 0]);
        expect(constrainDragToAxis(-3, -25, true)).toEqual([0, -25]);
    });

    it("leaves a free move alone", () => {
        expect(constrainDragToAxis(40, 12, false)).toEqual([40, 12]);
    });
});

describe("elementsChangedByHistoryStep", () => {
    it("selects what came back and what moved, outermost only", () => {
        const after = JSON.parse(JSON.stringify(document)) as UIDocument;
        const before = JSON.parse(JSON.stringify(document)) as UIDocument;
        delete (before.elements as Record<string, unknown>).quit;
        before.elements.panel.childrenIds = ["title", "start"];
        after.elements.start.layout = { ...after.elements.start.layout, x: 40 };
        after.elements.startLabel.layout = { ...after.elements.startLabel.layout, x: 9 };
        expect(elementsChangedByHistoryStep(before, after, "page")).toEqual(["start", "quit"]);
    });

    it("leaves the selection alone when only deletions happened", () => {
        const before = JSON.parse(JSON.stringify(document)) as UIDocument;
        const after = JSON.parse(JSON.stringify(document)) as UIDocument;
        delete (after.elements as Record<string, unknown>).quit;
        after.elements.panel.childrenIds = ["title", "start"];
        expect(elementsChangedByHistoryStep(before, after, "page")).toBeNull();
    });
});
