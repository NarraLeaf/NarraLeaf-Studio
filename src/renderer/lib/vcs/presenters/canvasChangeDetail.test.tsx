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

function uigraphs(nodes: BlueprintGraphNode[], blueprintName = "Main menu"): UIGraphDocument {
    const one: Blueprint = {
        id: "bp-1",
        name: blueprintName,
        owner: { kind: "globalMain" },
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
    };
    return {
        schemaVersion: UI_GRAPH_DOCUMENT_SCHEMA_VERSION,
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
// Going the other way: from a row to the node
// ---------------------------------------------------------------------------

/**
 * The list under the canvas as a way back onto it.
 *
 * The one thing jsdom cannot answer is whether the card ends up where a person would call the
 * middle - but every number that decides it is in the markup, so "the card the row named is centred
 * in the frame" reduces to arithmetic on two inline styles. The graph is laid out wide on purpose:
 * fitted into half a pane it draws at about a tenth of size, which is the state this exists for.
 */
describe("going from a row to the node it names", () => {
    const wideSides = () => {
        const base = uigraphs([graphNode("n-a", 0, 0), graphNode("n-b", 2000, 0)]);
        const head = uigraphs([graphNode("n-a", 0, 0), graphNode("n-b", 2600, 300), graphNode("n-c", 4000, 0)]);
        sideDocuments.set("before", base);
        sideDocuments.set("after", head);
        return render(<ChangeDetailHost entry={graphEntry(base, head)} sides={SIDES} />);
    };

    /** Every row of the list that offers to go and look. */
    const revealRows = (container: HTMLElement): HTMLElement[] =>
        [...container.querySelectorAll<HTMLElement>("button[data-change-row]")];

    const centreOf = (element: HTMLElement): [number, number] => [
        Number.parseFloat(element.style.left) + Number.parseFloat(element.style.width) / 2,
        Number.parseFloat(element.style.top) + Number.parseFloat(element.style.height) / 2,
    ];

    /**
     * Within a pixel, which is as exact as this can be said.
     *
     * Cards are snapped to whole pixels before they are drawn - a border half over a pixel is a
     * grey border - so the middle of a card of odd height is half a pixel off the middle of the
     * frame. Asking for more than this would be asking the canvas to stop rounding.
     */
    const isCentred = (value: number, middle: number): void => {
        expect(Math.abs(value - middle)).toBeLessThanOrEqual(1);
    };

    it("names the change on the row rather than repeating one command down the list", () => {
        const { container } = wideSides();
        const labels = revealRows(container).map(row => row.getAttribute("aria-label") ?? "");

        expect(labels.length).toBeGreaterThan(1);
        expect(labels.every(label => label.startsWith("documentDiff.canvas.markLabel"))).toBe(true);
        expect(new Set(labels).size).toBe(labels.length);
    });

    it("puts the card the row is about in the middle of every column that has it", () => {
        const { container } = wideSides();
        const added = revealRows(container).find(
            row => (row.getAttribute("aria-label") ?? "").includes("documentDiff.uiGraphs.nodeAdded"),
        );
        expect(added).toBeTruthy();

        fireEvent.click(added!);

        // The added node is the only one wearing that tone, and it is only on the newer side - so
        // exactly one column has a card to centre.
        const marked = [...container.querySelectorAll<HTMLElement>('[data-change-mask="added"]')];
        expect(marked).toHaveLength(1);

        const card = marked[0]!.parentElement!;
        const canvas = card.parentElement as HTMLElement;
        const [x, y] = centreOf(card);
        isCentred(x, Number.parseFloat(canvas.style.width) / 2);
        isCentred(y, Number.parseFloat(canvas.style.height) / 2);
    });

    it("holds both places a dragged node is in, rather than centring one and losing the other", () => {
        const { container } = wideSides();
        const moved = revealRows(container).find(
            row => (row.getAttribute("aria-label") ?? "").includes("documentDiff.uiGraphs.nodeMoved"),
        );
        expect(moved).toBeTruthy();

        fireEvent.click(moved!);

        // One card in each column, at the two coordinates the one shared transform draws them at.
        const cards = [...container.querySelectorAll<HTMLElement>('[data-change-mask="moved"]')]
            .map(mark => mark.parentElement!);
        expect(cards).toHaveLength(2);

        const canvas = cards[0]!.parentElement as HTMLElement;
        const frame = [
            Number.parseFloat(canvas.style.width),
            Number.parseFloat(canvas.style.height),
        ];
        for (const card of cards) {
            const [x, y] = centreOf(card);
            expect(x).toBeGreaterThan(0);
            expect(x).toBeLessThan(frame[0]!);
            expect(y).toBeGreaterThan(0);
            expect(y).toBeLessThan(frame[1]!);
        }

        // And the pair is centred, which is what makes the move the thing on screen.
        const centres = cards.map(centreOf);
        isCentred((centres[0]![0] + centres[1]![0]) / 2, frame[0]! / 2);
        isCentred((centres[0]![1] + centres[1]![1]) / 2, frame[1]! / 2);
    });

    it("keeps every other row, because they are what the author is stepping through", () => {
        const { container } = wideSides();
        const rows = revealRows(container);
        const first = rows[0]!;

        fireEvent.click(first);

        // A mark click narrows the list to its one change. A row click must not: the rows are the
        // thing being used, and taking them away leaves one row and a button to get them back.
        expect(container.textContent).not.toContain("documentDiff.canvas.oneChange");
        expect(revealRows(container)).toHaveLength(rows.length);
        expect(revealRows(container)[0]!.className).toContain("bg-fill");
    });

    it("leaves a change the canvas never drew as text", () => {
        const base = uigraphs([graphNode("n-a", 0, 0)], "Main menu");
        const head = uigraphs([graphNode("n-a", 0, 0), graphNode("n-c", 4000, 0)], "Title screen");
        sideDocuments.set("before", base);
        sideDocuments.set("after", head);

        const { container } = render(<ChangeDetailHost entry={graphEntry(base, head)} sides={SIDES} />);

        // The blueprint's own name is a row here and a mark nowhere - it belongs to no card, and a
        // row that looked clickable would promise a place to go that does not exist.
        const rows = [...container.querySelectorAll<HTMLElement>("[data-change-row]")];
        const inert = rows.filter(row => row.tagName === "DIV");
        expect(inert.length).toBeGreaterThan(0);
        expect(inert.some(row => (row.textContent ?? "").includes("documentDiff.uiGraphs.blueprint"))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Moving the blueprint canvas
// ---------------------------------------------------------------------------

/**
 * What is left of pan and zoom once layout is taken away.
 *
 * The gesture itself is not here and cannot be: with every rect zero, "the picture followed the
 * pointer" is not a question jsdom can answer, and the anchor a wheel zooms about is read off a
 * rect. What is here is the arithmetic the gesture drives, which is where the two column canvases
 * would come apart if they were ever going to - every card is positioned from a number this
 * component computed, and those numbers are in the markup.
 */
describe("dragging and magnifying the blueprint canvas", () => {
    const canvases = (container: HTMLElement): HTMLElement[] =>
        [...container.querySelectorAll<HTMLElement>("[data-graph-canvas]")];

    /** Every node card of one column, as the geometry the component gave it. */
    const cards = (canvas: HTMLElement): string[] =>
        [...canvas.querySelectorAll<HTMLElement>(":scope > div")].map(
            card => `${card.style.left}|${card.style.top}|${card.style.width}|${card.style.height}`,
        );

    /** How far each card of one column travelled between two readings of it. */
    const offsets = (from: string[], to: string[]): string[] =>
        from.map((was, index) => {
            const [left, top] = was.split("|");
            const [now, nowTop] = (to[index] ?? "").split("|");
            return `${Number.parseFloat(now!) - Number.parseFloat(left!)}`
                + `|${Number.parseFloat(nowTop!) - Number.parseFloat(top!)}`;
        });

    const twoSides = () => {
        const base = uigraphs([graphNode("n-a", 0, 0), graphNode("n-b", 400, 0)]);
        const head = uigraphs([graphNode("n-a", 0, 0), graphNode("n-b", 400, 200), graphNode("n-c", 800, 0)]);
        sideDocuments.set("before", base);
        sideDocuments.set("after", head);
        return render(<ChangeDetailHost entry={graphEntry(base, head)} sides={SIDES} />);
    };

    it("zooms both columns by the same amount from a wheel over either of them", () => {
        const { container } = twoSides();
        const [before, after] = canvases(container);
        expect(before && after).toBeTruthy();

        // `n-a` is at the same coordinates in both versions, and the shared viewport is what puts
        // it in the same place twice.
        expect(cards(before!)[0]).toBe(cards(after!)[0]);
        const wasFitted = cards(before!);

        fireEvent.wheel(before!, { deltaY: -100, ctrlKey: true });

        expect(cards(before!)[0]).not.toBe(wasFitted[0]);
        // The wheel happened over the old version's column; the new version's moved with it.
        expect(cards(before!)[0]).toBe(cards(after!)[0]);
    });

    it("drags both columns together from the background of either", () => {
        const { container } = twoSides();
        const [before, after] = canvases(container);
        const start = [cards(before!), cards(after!)];

        fireEvent.pointerDown(before!, { button: 0, pointerId: 7, clientX: 40, clientY: 20 });
        fireEvent.pointerMove(window, { pointerId: 7, clientX: 65, clientY: 5 });
        fireEvent.pointerUp(window, { pointerId: 7 });

        const moved = [cards(before!), cards(after!)];
        expect(moved[0]).not.toEqual(start[0]);
        // One pull, one distance, every card of both columns - so a node nobody touched is still
        // opposite itself. The two sides hold a different number of nodes, which is why this is a
        // set of travels rather than a list of them.
        expect(new Set([
            ...offsets(start[0]!, moved[0]!),
            ...offsets(start[1]!, moved[1]!),
        ])).toEqual(new Set(["25|-15"]));
    });

    it("leaves a wheel with no modifier to the pane the canvas is scrolled inside", () => {
        const { container } = twoSides();
        const [before] = canvases(container);
        const wasFitted = cards(before!);

        fireEvent.wheel(before!, { deltaY: -100 });

        expect(cards(before!)).toEqual(wasFitted);
    });

    it("offers the whole graph back, and only once there is something to come back from", () => {
        const { container } = twoSides();
        const [before, after] = canvases(container);
        const fitted = [cards(before!), cards(after!)];

        const fit = () => container.querySelector<HTMLButtonElement>("[data-graph-fit]")!;
        expect(fit().disabled).toBe(true);

        fireEvent.wheel(before!, { deltaY: -100, ctrlKey: true });
        expect(fit().disabled).toBe(false);

        fireEvent.click(fit());
        expect([cards(before!), cards(after!)]).toEqual(fitted);
        expect(fit().disabled).toBe(true);
    });

    /**
     * The count is the one thing this pane is trusted for, and a view is not a filter: a node
     * dragged off the visible part of the frame is out of sight, never out of the tally.
     */
    it("marks the same changes at every zoom", () => {
        const { container } = twoSides();
        const [before] = canvases(container);
        const marked = marks(container).length;

        fireEvent.wheel(before!, { deltaY: -100, ctrlKey: true });

        expect(marks(container)).toHaveLength(marked);
        expect(container.textContent).not.toContain("documentDiff.canvas.notMarked");
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
