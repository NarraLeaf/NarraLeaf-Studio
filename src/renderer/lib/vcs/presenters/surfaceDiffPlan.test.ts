import { describe, expect, it } from "vitest";
import { countDocumentChanges, type DocumentChange } from "@shared/documents/diff";
import { uiDocumentSpec } from "@shared/documents/specs";
import {
    UI_DOCUMENT_SCHEMA_VERSION,
    type UIComponentDefinition,
    type UIDocument,
    type UIElement,
    type UISurface,
} from "@shared/types/ui-editor/document";
import { changeLeafCount, changeMaskTone, maskColumns } from "./changeMask";
import {
    accountedChanges,
    buildSurfaceDiffPlan,
    sharedSurfaceScale,
    surfaceMaskTarget,
} from "./surfaceDiffPlan";

/**
 * What the interface canvas decides before it draws anything.
 *
 * Driven by the REAL spec's diff over two real documents rather than by hand-written change rows,
 * because the thing most likely to break this surface is not the arithmetic here - it is the
 * addressing drifting on the other side of the process boundary. A hand-written `["surfaces", …]`
 * would keep passing after the spec stopped producing that shape, and the author would get marks
 * over the wrong elements with every test green.
 *
 * **jsdom does no layout**, so where a mark lands on screen is not testable here and is not tested
 * here: `getBoundingClientRect` answers zero for everything. What IS pinned is everything a person
 * looking at the screen cannot check - that no change is dropped, that the counts add up, that the
 * page opened on is the one with the most on it, and that a removal is only drawn on the old side.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function element(id: string, name: string, overrides: Partial<UIElement> = {}): UIElement {
    return {
        id,
        type: "nl.container",
        name,
        parentId: null,
        childrenIds: [],
        layout: { x: 0, y: 0, width: 100, height: 40 },
        ...overrides,
    };
}

function surface(id: string, name: string, rootElementId: string, width = 1920, height = 1080): UISurface {
    return {
        id,
        name,
        host: "app",
        kind: "appSurface",
        designSize: { width, height },
        rootElementId,
    };
}

function uidoc(
    surfaces: UISurface[],
    elements: UIElement[],
    components: UIComponentDefinition[] = [],
    name = "Interface",
): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "ui-1",
        name,
        surfaces,
        components,
        elements: Object.fromEntries(elements.map(one => [one.id, one])),
    } as UIDocument;
}

const COMPONENT: UIComponentDefinition = {
    id: "comp-1",
    name: "Save slot",
    rootElementId: "ce-root",
    elements: { "ce-root": element("ce-root", "Slot root") },
};

/** Two pages: `Title` with three buttons on it, `Options` with one. */
function baseDocument(): UIDocument {
    return uidoc(
        [surface("surf-title", "Title", "root-title"), surface("surf-options", "Options", "root-options")],
        [
            element("root-title", "Root", { type: "nl.root", childrenIds: ["el-play", "el-quit", "el-exit"] }),
            element("el-play", "Play", { parentId: "root-title" }),
            element("el-quit", "Quit", { parentId: "root-title" }),
            element("el-exit", "Exit", { parentId: "root-title" }),
            element("root-options", "Root", { type: "nl.root", childrenIds: ["el-volume"] }),
            element("el-volume", "Volume", { parentId: "root-options" }),
        ],
        [COMPONENT],
    );
}

/**
 * One edit of each kind the canvas has to draw, spread over both pages.
 *
 * Title: an element added, one removed, two swapped under their parent, and the page's own design
 * size changed. Options: one element's layout edited. Outside every page: the document's name, and
 * an element inside the component definition.
 */
function headDocument(): UIDocument {
    return uidoc(
        [
            surface("surf-title", "Title", "root-title", 1280, 720),
            surface("surf-options", "Options", "root-options"),
        ],
        [
            element("root-title", "Root", { type: "nl.root", childrenIds: ["el-quit", "el-play", "el-load"] }),
            element("el-play", "Play", { parentId: "root-title" }),
            element("el-quit", "Quit", { parentId: "root-title" }),
            element("el-load", "Load", { parentId: "root-title" }),
            element("root-options", "Root", { type: "nl.root", childrenIds: ["el-volume"] }),
            element("el-volume", "Volume", { parentId: "root-options", layout: { x: 8, y: 8, width: 100, height: 40 } }),
        ],
        [{ ...COMPONENT, elements: { "ce-root": element("ce-root", "Slot root", { layout: { x: 4, y: 0, width: 100, height: 40 } }) } }],
        "Interface v2",
    );
}

function planOf(base: UIDocument, head: UIDocument) {
    const diff = uiDocumentSpec.diff!(base, head, { limit: 200 });
    return { diff, plan: buildSurfaceDiffPlan(diff.changes, base, head) };
}

/** The mark about one element, by the element's id. */
function maskFor(plan: ReturnType<typeof planOf>["plan"], elementId: string) {
    return plan.masks.find(mask => mask.target.kind === "element" && mask.target.elementId === elementId);
}

// ---------------------------------------------------------------------------
// The invariant the surface is trusted for
// ---------------------------------------------------------------------------

describe("every change is either marked or named", () => {
    it("accounts for every row and every leaf the diff produced", () => {
        const { diff, plan } = planOf(baseDocument(), headDocument());

        expect(diff.changes.length).toBeGreaterThan(4);
        expect(accountedChanges(plan)).toEqual({
            rows: diff.changes.length,
            leaves: countDocumentChanges(diff.changes),
        });
        // And the leaf count is the number the index shows beside the file, which is what makes
        // "12 changes" and what is on the canvas the same claim.
        expect(accountedChanges(plan).leaves).toBe(diff.total);
    });

    it("keeps the two lists disjoint - nothing is both marked and excused", () => {
        const { plan } = planOf(baseDocument(), headDocument());
        const marked = plan.masks.map(mask => mask.index);
        const excused = plan.offCanvas.map(entry => entry.index);

        expect(new Set([...marked, ...excused]).size).toBe(marked.length + excused.length);
    });

    it("names why each unmarkable change cannot be drawn", () => {
        const { plan } = planOf(baseDocument(), headDocument());
        const reasons = Object.fromEntries(
            plan.offCanvas.map(entry => [entry.change.path.join("/"), entry.reason]),
        );

        expect(reasons).toEqual({
            name: "document",
            "components/comp-1/elements/ce-root": "component",
        });
    });
});

// ---------------------------------------------------------------------------
// Which mark, and on which side
// ---------------------------------------------------------------------------

describe("what each mark says", () => {
    it("marks an added element green, a removed one red and an edited one amber", () => {
        const { plan } = planOf(baseDocument(), headDocument());

        expect(maskFor(plan, "el-load")?.tone).toBe("added");
        expect(maskFor(plan, "el-exit")?.tone).toBe("removed");
        expect(maskFor(plan, "el-volume")?.tone).toBe("changed");
    });

    /**
     * The distinction the whole four-tone scheme exists for: an element that only travelled did not
     * change what the game does, and must not compete with one whose properties were edited.
     */
    it("marks an element that was only re-ordered with the weakest tone", () => {
        const { plan } = planOf(baseDocument(), headDocument());

        expect(maskFor(plan, "root-title")?.tone).toBe("moved");
    });

    it("draws a removal only on the old side and an addition only on the new one", () => {
        const { plan } = planOf(baseDocument(), headDocument());

        expect(maskColumns("removed")).toEqual({ onBase: true, onHead: false });
        expect(maskFor(plan, "el-exit")).toMatchObject({ onBase: true, onHead: false });
        expect(maskFor(plan, "el-load")).toMatchObject({ onBase: false, onHead: true });
        expect(maskFor(plan, "el-volume")).toMatchObject({ onBase: true, onHead: true });
    });

    it("marks a page's own change on the page rather than on anything inside it", () => {
        const { plan } = planOf(baseDocument(), headDocument());
        const frame = plan.masks.find(mask => mask.target.kind === "surface");

        expect(frame?.target).toEqual({ kind: "surface", surfaceId: "surf-title" });
        expect(frame?.tone).toBe("changed");
    });
});

describe("the tone of a group", () => {
    const group = (children: DocumentChange[], truncated?: number): DocumentChange => ({
        path: ["surfaces", "s", "elements", "e"],
        kind: "changed",
        label: { key: "x" },
        children,
        ...(truncated === undefined ? {} : { truncated }),
    });
    const leaf = (kind: DocumentChange["kind"]): DocumentChange => ({
        path: ["surfaces", "s", "elements", "e", "p"],
        kind,
        label: { key: "x" },
    });

    it("is the weakest tone only when every leaf is a relocation", () => {
        expect(changeMaskTone(group([leaf("moved"), leaf("moved")]))).toBe("moved");
        expect(changeMaskTone(group([leaf("moved"), leaf("changed")]))).toBe("changed");
    });

    /**
     * A group that dropped children cannot be judged by the ones that survived: the dropped ones
     * are unknown, and reading "all I can see is a move" as "nothing but a move" would draw the
     * faintest mark over a node whose parameters changed.
     */
    it("never downgrades a group whose children were truncated", () => {
        expect(changeMaskTone(group([leaf("moved")], 3))).toBe("changed");
    });

    it("counts a group as its children, including the ones it dropped", () => {
        expect(changeLeafCount(group([leaf("moved"), leaf("changed")], 3))).toBe(5);
        expect(changeLeafCount(leaf("changed"))).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Which page, and at what size
// ---------------------------------------------------------------------------

describe("which page the canvas opens on", () => {
    it("opens on the page with the most changes", () => {
        const { plan } = planOf(baseDocument(), headDocument());

        expect(plan.defaultSurfaceId).toBe("surf-title");
        expect(plan.surfaces.map(option => [option.id, option.changes])).toEqual([
            ["surf-title", 4],
            ["surf-options", 1],
        ]);
    });

    it("opens on the first page rather than on nothing when no page changed", () => {
        const base = baseDocument();
        const { plan } = planOf(base, uidoc(base.surfaces, Object.values(base.elements), base.components, "Renamed"));

        expect(plan.masks).toEqual([]);
        expect(plan.defaultSurfaceId).toBe("surf-title");
    });

    it("still lists a page that only one side has, and says which", () => {
        const base = baseDocument();
        const head = uidoc(
            base.surfaces.filter(one => one.id !== "surf-options"),
            Object.values(base.elements).filter(one => !one.id.includes("options") && one.id !== "el-volume"),
            base.components,
        );
        const { plan } = planOf(base, head);
        const gone = plan.surfaces.find(option => option.id === "surf-options");

        expect(gone).toMatchObject({ inBase: true, inHead: false });
        // One row for the whole page, with its elements folded into it - so the canvas draws one
        // frame-wide mark rather than one per element that went with it.
        expect(plan.masks.filter(mask => mask.target.surfaceId === "surf-options")).toHaveLength(1);
    });

    it("carries each side's own design size, so a page that was resized is two boxes", () => {
        const { plan } = planOf(baseDocument(), headDocument());
        const title = plan.surfaces.find(option => option.id === "surf-title");

        expect(title?.baseSize).toEqual({ width: 1920, height: 1080 });
        expect(title?.headSize).toEqual({ width: 1280, height: 720 });
    });
});

describe("the scale both columns share", () => {
    it("is taken from the larger side, so the smaller page is drawn smaller", () => {
        const scale = sharedSurfaceScale(
            [{ width: 1920, height: 1080 }, { width: 960, height: 540 }],
            { width: 480, height: 1000 },
        );

        expect(scale).toBeCloseTo(480 / 1920);
        // The point of sharing it: at this scale the 960-wide page is 240px and the 1920-wide one
        // is 480px. Fitted separately they would both be 480 and the resize would be invisible.
        expect(960 * scale).toBeCloseTo(240);
    });

    it("is bounded by the height as well as the width", () => {
        expect(sharedSurfaceScale([{ width: 100, height: 1000 }], { width: 500, height: 250 }))
            .toBeCloseTo(0.25);
    });

    it("never magnifies a page past its own size", () => {
        expect(sharedSurfaceScale([{ width: 100, height: 100 }], { width: 900, height: 900 })).toBe(1);
    });

    it("answers 1 for a pane that has not been measured yet", () => {
        expect(sharedSurfaceScale([{ width: 1920, height: 1080 }], { width: 0, height: 0 })).toBe(1);
        expect(sharedSurfaceScale([null, null], { width: 500, height: 500 })).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Addressing
// ---------------------------------------------------------------------------

describe("reading a path", () => {
    it("tells an element apart from the page it is on by length alone", () => {
        expect(surfaceMaskTarget(["surfaces", "s1"])).toEqual({ kind: "surface", surfaceId: "s1" });
        expect(surfaceMaskTarget(["surfaces", "s1", "designSize"])).toEqual({ kind: "surface", surfaceId: "s1" });
        expect(surfaceMaskTarget(["surfaces", "s1", "elements", "e1"]))
            .toEqual({ kind: "element", surfaceId: "s1", elementId: "e1" });
        expect(surfaceMaskTarget(["surfaces", "s1", "elements", "e1", "layout"]))
            .toEqual({ kind: "element", surfaceId: "s1", elementId: "e1" });
    });

    it("refuses everything that is not on a page", () => {
        expect(surfaceMaskTarget(["name"])).toBeNull();
        expect(surfaceMaskTarget(["elements", "e1"])).toBeNull();
        expect(surfaceMaskTarget(["components", "c1", "elements", "e1"])).toBeNull();
        expect(surfaceMaskTarget([])).toBeNull();
    });
});
