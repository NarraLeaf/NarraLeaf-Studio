// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DocumentDiffEntry } from "@shared/documents/diff";
import { uiDocumentSpec, uiGraphsSpec } from "@shared/documents/specs";
import {
    UI_DOCUMENT_SCHEMA_VERSION,
    type UIDocument,
    type UIElement,
} from "@shared/types/ui-editor/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import type { Blueprint, BlueprintGraphNode } from "@shared/types/blueprint/document";
import { UI_GRAPH_DOCUMENT_SCHEMA_VERSION, type UIGraphDocument } from "@shared/types/ui-editor/graph";
import { ChangeDetailHost } from "./ChangeDetailHost";

/**
 * The two mask canvases as structures, which is as far as a test can honestly go.
 *
 * **jsdom does no layout.** Every `getBoundingClientRect` is zero and no element has a width, so
 * whether a mark lands ON the element it is about is not knowable here and is not claimed here - it
 * is on the list of things only a person looking at the screen can check. What is pinned is
 * everything else: that the right presenter is chosen, that the number of marks equals the number of
 * changes the canvas said it would mark, that a change the page has no handle on is counted out loud
 * rather than dropped, that clicking a mark narrows the list, and that the list of rows survives
 * every failure the canvas can have.
 *
 * The page renderer is stubbed. Drawing a real Surface needs a workspace, an asset service and the
 * whole widget module registry; what this test needs from it is the one thing the mask layer reads -
 * `data-ui-element-id` on the elements it drew - and a stub that emits exactly the ids it was asked
 * to is a sharper instrument, because it can also emit FEWER.
 */

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        t: (key: string, params?: Record<string, unknown>) =>
            (params ? `${key}(${Object.values(params).join(",")})` : key),
        has: () => false,
        tn: (key: string, count: number) => `${key}(${count})`,
        locale: "en",
    }),
}));

/** Which element ids the stubbed page draws. Empty means "every element the document has". */
const drawnElements = vi.hoisted(() => ({ only: null as string[] | null }));

vi.mock("@/lib/ui-editor/runtime/surface/GameSurfaceRenderer", () => ({
    GameSurfaceRenderer: ({ document, surface }: { document: UIDocument; surface: { id: string } }) => (
        <div data-testid={`surface:${surface.id}`}>
            {Object.keys(document.elements ?? {})
                .filter(id => drawnElements.only === null || drawnElements.only.includes(id))
                .map(id => <div key={id} data-ui-element-id={id} />)}
        </div>
    ),
}));

// The widget renderer table, which pulls in every built-in widget module. Not what is under test,
// and its absence changes nothing the stub above does.
vi.mock("@/lib/ui-editor/runtime/builtin", () => ({ BuiltinElementRenderers: [] }));

vi.mock("@/lib/ui-editor/behavior-graph/nodeEditorCatalog", () => ({
    getBlueprintNodeEditorCatalogEntry: (type: string) => ({ displayName: `title:${type}` }),
}));
vi.mock("@/apps/workspace/modules/blueprint-lite/blueprintNodeI18n", () => ({
    resolveBlueprintNodeTitle: (name: string) => name,
    resolveBlueprintLabel: (name: string) => name,
}));

/** Both sides, by side. Set per test; `useSideDocument` is what the presenters read. */
const sideDocuments = vi.hoisted(() => new Map<string, unknown>());
vi.mock("./sideDocument", () => ({
    useSideDocument: (side: { at: string } | null) => {
        if (!side) return { status: "absent", document: null, error: null };
        const key = side.at === "revision" ? "before" : "after";
        const held = sideDocuments.get(key);
        return held === undefined
            ? { status: "unreadable", document: null, error: "not an interface document" }
            : { status: "ready", document: held, error: null };
    },
}));

const SIDES = { before: { at: "revision" as const, revision: "r1" }, after: { at: "working-tree" as const } };

/**
 * jsdom gives every element a zero width and has no resize observer, and the canvas draws nothing
 * until it has been measured - so both are supplied. The number is arbitrary; what matters is that
 * it is not zero.
 */
beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 900 });
    vi.stubGlobal("ResizeObserver", class {
        observe() {}
        unobserve() {}
        disconnect() {}
    });
});

afterEach(() => {
    cleanup();
    sideDocuments.clear();
    drawnElements.only = null;
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function element(id: string, overrides: Partial<UIElement> = {}): UIElement {
    return {
        id,
        type: "nl.container",
        name: id,
        parentId: null,
        childrenIds: [],
        layout: { x: 0, y: 0, width: 100, height: 40 },
        ...overrides,
    };
}

function uidoc(elements: UIElement[], name = "Interface"): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "ui-1",
        name,
        surfaces: [{
            id: "surf-1",
            name: "Title",
            host: "app",
            kind: "appSurface",
            designSize: { width: 1920, height: 1080 },
            rootElementId: "root",
        }],
        components: [],
        elements: Object.fromEntries(elements.map(one => [one.id, one])),
    } as UIDocument;
}

const UI_BASE = () => uidoc([
    element("root", { type: "nl.root", childrenIds: ["el-play", "el-quit", "el-exit"] }),
    element("el-play", { parentId: "root" }),
    element("el-quit", { parentId: "root" }),
    element("el-exit", { parentId: "root" }),
]);

/**
 * One of each, all on one page: `el-exit` gone, `el-load` arrived, `el-play` edited, and the two
 * that stayed swapped under their parent - so the four tones are all reachable.
 */
const UI_HEAD = () => uidoc([
    element("root", { type: "nl.root", childrenIds: ["el-quit", "el-play", "el-load"] }),
    element("el-play", { parentId: "root", layout: { x: 20, y: 0, width: 100, height: 40 } }),
    element("el-quit", { parentId: "root" }),
    element("el-load", { parentId: "root" }),
]);

function uiEntry(base: UIDocument, head: UIDocument): DocumentDiffEntry {
    const diff = uiDocumentSpec.diff!(base, head, { limit: 200 });
    return { path: "editor/ui/uidoc.json", kind: "changed", documentKind: "ui-document", diff };
}

function graphNode(id: string, x: number, y: number): BlueprintGraphNode {
    return { id, type: `type.${id}`, params: {}, meta: { editorLayout: { x, y } } };
}

function uigraphs(nodes: BlueprintGraphNode[]): UIGraphDocument {
    const one: Blueprint = {
        id: "bp-1",
        name: "Main menu",
        owner: { kind: "globalMain" },
        frontend: "visual",
        programKind: "graph",
        program: {
            kind: "graph",
            graphs: {
                eventIds: ["ev-1"],
                events: {
                    "ev-1": {
                        id: "ev-1",
                        name: "On click",
                        graph: { nodes: Object.fromEntries(nodes.map(node => [node.id, node])), edges: [] },
                    },
                },
                functionIds: [],
                functions: {},
            },
        },
    };
    return {
        schemaVersion: UI_GRAPH_DOCUMENT_SCHEMA_VERSION,
        graphs: {},
        blueprintDocument: {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            blueprints: { "bp-1": one },
            ownerRecords: {},
        },
    };
}

function graphEntry(base: UIGraphDocument, head: UIGraphDocument): DocumentDiffEntry {
    const diff = uiGraphsSpec.diff!(base, head, { limit: 200 });
    return { path: "editor/ui/uigraphs.json", kind: "changed", documentKind: "ui-graphs", diff };
}

const marks = (container: HTMLElement): HTMLElement[] =>
    [...container.querySelectorAll<HTMLElement>("[data-change-mask]")];

const presenterOf = (container: HTMLElement): string | null =>
    container.querySelector("[data-change-presenter]")?.getAttribute("data-change-presenter") ?? null;

// ---------------------------------------------------------------------------
// Which presenter
// ---------------------------------------------------------------------------

describe("which presenter draws an interface document", () => {
    it("hands the interface and the blueprints to their own canvases", () => {
        sideDocuments.set("before", UI_BASE());
        sideDocuments.set("after", UI_HEAD());
        const ui = render(<ChangeDetailHost entry={uiEntry(UI_BASE(), UI_HEAD())} sides={SIDES} />);
        expect(presenterOf(ui.container)).toBe("ui-document");
        cleanup();

        sideDocuments.set("before", uigraphs([graphNode("n-a", 0, 0)]));
        sideDocuments.set("after", uigraphs([graphNode("n-a", 40, 0)]));
        const graphs = render(
            <ChangeDetailHost
                entry={graphEntry(uigraphs([graphNode("n-a", 0, 0)]), uigraphs([graphNode("n-a", 40, 0)]))}
                sides={SIDES}
            />,
        );
        expect(presenterOf(graphs.container)).toBe("ui-graphs");
    });

    it("leaves a document of any other format to the generic list", () => {
        const { container } = render(
            <ChangeDetailHost entry={{ ...uiEntry(UI_BASE(), UI_HEAD()), documentKind: "story" }} sides={SIDES} />,
        );

        expect(presenterOf(container)).toBe("generic");
    });
});

// ---------------------------------------------------------------------------
// The count an author trusts
// ---------------------------------------------------------------------------

describe("marks on the interface canvas", () => {
    it("draws one mark per change, on the side that version has it", () => {
        sideDocuments.set("before", UI_BASE());
        sideDocuments.set("after", UI_HEAD());

        const { container } = render(<ChangeDetailHost entry={uiEntry(UI_BASE(), UI_HEAD())} sides={SIDES} />);

        // `el-exit` went (old side only), `el-load` arrived (new side only), `el-play` was edited
        // (both), and their parent re-ordered its children (both): six marks over four changes.
        const byIndex = new Map<string, number>();
        for (const mark of marks(container)) {
            const index = mark.getAttribute("data-change-index") ?? "";
            byIndex.set(index, (byIndex.get(index) ?? 0) + 1);
        }
        expect(byIndex.size).toBe(4);
        expect([...byIndex.values()].sort()).toEqual([1, 1, 2, 2]);
        expect(marks(container)).toHaveLength(6);
    });

    it("gives an added element the added tone and a removed one the removed tone", () => {
        sideDocuments.set("before", UI_BASE());
        sideDocuments.set("after", UI_HEAD());

        const { container } = render(<ChangeDetailHost entry={uiEntry(UI_BASE(), UI_HEAD())} sides={SIDES} />);
        const tones = new Set(marks(container).map(mark => mark.getAttribute("data-change-mask")));

        expect(tones).toEqual(new Set(["added", "removed", "changed", "moved"]));
    });

    /**
     * The failure this whole line exists for: content inside a component instance carries no id, so
     * a canvas CAN be asked to mark something it has no handle on. Nine marks and silence about the
     * other three reads as a complete answer.
     */
    it("counts a change it could not place instead of dropping it", () => {
        sideDocuments.set("before", UI_BASE());
        sideDocuments.set("after", UI_HEAD());
        drawnElements.only = ["root"];

        const { container } = render(<ChangeDetailHost entry={uiEntry(UI_BASE(), UI_HEAD())} sides={SIDES} />);

        expect(marks(container)).toHaveLength(2);
        expect(container.textContent).toContain("documentDiff.canvas.unplaced");
        expect(container.textContent).toContain("documentDiff.canvas.notMarked");
    });

    it("narrows the list to one change when a mark is clicked, and back again", () => {
        sideDocuments.set("before", UI_BASE());
        sideDocuments.set("after", UI_HEAD());

        const { container, getByText } = render(
            <ChangeDetailHost entry={uiEntry(UI_BASE(), UI_HEAD())} sides={SIDES} />,
        );
        expect(container.textContent).toContain("documentDiff.uiDocument.elementRemoved");
        expect(container.textContent).toContain("documentDiff.uiDocument.elementAdded");

        fireEvent.click(container.querySelector<HTMLElement>('[data-change-mask="removed"]')!);

        // The list under the canvas is now that one change, and only it - which is as close to
        // "take me to this row" as this pane can get, the index beside it being one line per file.
        expect(container.textContent).toContain("documentDiff.canvas.oneChange");
        expect(container.textContent).toContain("documentDiff.uiDocument.elementRemoved");
        expect(container.textContent).not.toContain("documentDiff.uiDocument.elementAdded");

        fireEvent.click(getByText("documentDiff.canvas.showAll"));
        expect(container.textContent).not.toContain("documentDiff.canvas.oneChange");
        expect(container.textContent).toContain("documentDiff.uiDocument.elementAdded");
    });
});

describe("marks on the blueprint canvas", () => {
    it("draws a mark per changed node, positioned from the file rather than measured", () => {
        const base = uigraphs([graphNode("n-a", 0, 0), graphNode("n-b", 400, 0)]);
        const head = uigraphs([graphNode("n-a", 0, 0), graphNode("n-b", 400, 200), graphNode("n-c", 800, 0)]);
        sideDocuments.set("before", base);
        sideDocuments.set("after", head);

        const { container } = render(<ChangeDetailHost entry={graphEntry(base, head)} sides={SIDES} />);
        const tones = marks(container).map(mark => mark.getAttribute("data-change-mask"));

        // `n-b` was dragged (both sides), `n-c` is new (one side).
        expect(tones.filter(tone => tone === "moved")).toHaveLength(2);
        expect(tones.filter(tone => tone === "added")).toHaveLength(1);
        expect(container.textContent).toContain("documentDiff.canvas.legend.moved");
    });
});

// ---------------------------------------------------------------------------
// When the canvas cannot draw
// ---------------------------------------------------------------------------

describe("when a version cannot be read", () => {
    it("says so and still draws the list of rows", () => {
        // Neither side registered: the mocked hook answers `unreadable`, which is what a document
        // the spec refuses looks like.
        const { container } = render(<ChangeDetailHost entry={uiEntry(UI_BASE(), UI_HEAD())} sides={SIDES} />);

        expect(container.textContent).toContain("documentDiff.canvas.unreadable");
        expect(marks(container)).toHaveLength(0);
        // The rows are the floor under every canvas failure: the element that changed is still named.
        expect(container.textContent).toContain("documentDiff.uiDocument.elementRemoved");
    });

    it("draws the one version it has when the other side does not hold the file", () => {
        sideDocuments.set("after", UI_HEAD());
        const entry: DocumentDiffEntry = { ...uiEntry(UI_BASE(), UI_HEAD()), kind: "added" };

        const { container } = render(<ChangeDetailHost entry={entry} sides={SIDES} />);

        expect(container.querySelectorAll("[data-testid^=surface]")).toHaveLength(1);
        expect(container.textContent).not.toContain("documentDiff.canvas.unreadable");
    });
});
