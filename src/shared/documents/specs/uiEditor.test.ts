import {describe, expect, it} from "vitest";
import {countDocumentChanges, DocumentChange} from "@shared/documents/diff";
import {resolveDocumentSpecForPath} from "@shared/documents/registry";
import {
    UI_DOCUMENT_PATH,
    UI_GRAPHS_DOCUMENT_PATH,
    uiDocumentSpec,
    uiGraphsSpec,
} from "@shared/documents/specs";
import {DocumentCorruptError, DocumentParseContext} from "@shared/documents/types";
import type {Blueprint, BlueprintGraphEdge, BlueprintGraphNode} from "@shared/types/blueprint/document";
import {BLUEPRINT_DOCUMENT_SCHEMA_VERSION} from "@shared/types/blueprint/schema";
import {
    UI_DOCUMENT_SCHEMA_VERSION,
    type UIComponentDefinition,
    type UIDocument,
    type UIElement,
    type UISurface,
} from "@shared/types/ui-editor/document";
import {UI_GRAPH_DOCUMENT_SCHEMA_VERSION, type UIGraphDocument} from "@shared/types/ui-editor/graph";

/**
 * The two biggest documents in a project, and the two whose structural diff says least.
 *
 * What is pinned here is mostly the ADDRESSING. These change lists feed a surface that draws a mask
 * over the element or node that changed, and it finds the thing to draw on by reading `path` - so a
 * path shape that drifts does not produce a worse list, it produces a mask over the wrong element.
 * Every `path` assertion below is therefore verbatim rather than a `toMatchObject`.
 */

function contextFor(path: string, kind: "ui-document" | "ui-graphs", text: string): DocumentParseContext {
    return {
        path,
        corrupt(reason: string): never {
            throw new DocumentCorruptError({kind, path, reason, text});
        },
    };
}

const UIDOC = "editor/ui/uidoc.json";
const UIGRAPHS = "editor/ui/uigraphs.json";

function parseUiDocument(value: unknown): UIDocument {
    return uiDocumentSpec.parse(value, contextFor(UIDOC, "ui-document", JSON.stringify(value)));
}

function parseUiGraphs(value: unknown): UIGraphDocument {
    return uiGraphsSpec.parse(value, contextFor(UIGRAPHS, "ui-graphs", JSON.stringify(value)));
}

/**
 * The same document, written out with every object's keys in the opposite order.
 *
 * Which is what a re-save through a different code path produces, and what the whole tier exists to
 * be silent about: key order is not information, and a diff that reports it turns "somebody opened
 * the file" into a change list.
 */
function reserialized<T>(value: T): T {
    const rekey = (input: unknown): unknown => {
        if (Array.isArray(input)) {
            return input.map(rekey);
        }
        if (input !== null && typeof input === "object") {
            const out: Record<string, unknown> = {};
            for (const key of Object.keys(input).reverse()) {
                out[key] = rekey((input as Record<string, unknown>)[key]);
            }
            return out;
        }
        return input;
    };
    return JSON.parse(JSON.stringify(rekey(value))) as T;
}

/** Every path in a change list, groups and leaves alike. */
function paths(changes: readonly DocumentChange[]): string[][] {
    return changes.flatMap(change => [[...change.path], ...paths(change.children ?? [])]);
}

function subjects(changes: readonly DocumentChange[]): (string | undefined)[] {
    return changes.flatMap(change => [change.subject, ...subjects(change.children ?? [])]);
}

// ---------------------------------------------------------------------------
// ui-document
// ---------------------------------------------------------------------------

function element(id: string, name: string, overrides: Partial<UIElement> = {}): UIElement {
    return {
        id,
        type: "nl.container",
        name,
        parentId: null,
        childrenIds: [],
        layout: {x: 0, y: 0, width: 100, height: 40},
        ...overrides,
    };
}

function surface(id: string, name: string, rootElementId: string): UISurface {
    return {
        id,
        name,
        host: "app",
        kind: "appSurface",
        designSize: {width: 1920, height: 1080},
        rootElementId,
    };
}

function uidoc(
    surfaces: UISurface[],
    elements: UIElement[],
    components: UIComponentDefinition[] = [],
): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "ui-1",
        name: "Interface",
        surfaces,
        components,
        elements: Object.fromEntries(elements.map(one => [one.id, one])),
    };
}

/** One Surface whose root holds `Zebra` and then `Ant`, in that order on the canvas. */
function twoElementDocument(): UIDocument {
    return uidoc(
        [surface("surf-1", "Title", "el-root")],
        [
            element("el-root", "Root", {type: "nl.root", childrenIds: ["el-z", "el-a"]}),
            element("el-z", "Zebra", {parentId: "el-root"}),
            element("el-a", "Ant", {parentId: "el-root"}),
        ],
    );
}

function diffUi(base: UIDocument, head: UIDocument, limit = 200) {
    return uiDocumentSpec.diff!(base, head, {limit});
}

describe("ui-document spec: reading", () => {
    it("claims the interface document's path", () => {
        expect(resolveDocumentSpecForPath(UIDOC)).toEqual({spec: uiDocumentSpec, parameters: {}});
        expect(uiDocumentSpec.pathFor()).toBe(UIDOC);
        expect(UI_DOCUMENT_PATH).toBe(UIDOC);
    });

    it("refuses a document a newer Studio wrote", () => {
        expect(() => parseUiDocument({...uidoc([], []), schemaVersion: UI_DOCUMENT_SCHEMA_VERSION + 1}))
            .toThrow(/newer version of Studio/);
    });

    it("refuses surfaces, components or elements of the wrong shape", () => {
        expect(() => parseUiDocument({...uidoc([], []), surfaces: {}})).toThrow(/"surfaces" must be an array/);
        expect(() => parseUiDocument({...uidoc([], []), components: 7})).toThrow(/"components" must be an array/);
        expect(() => parseUiDocument({...uidoc([], []), elements: []})).toThrow(/"elements"/);
    });

    /**
     * The deliberate limit of this spec, pinned so it cannot be quietly removed: `parse` does not run
     * the eleven-version interface migration, so writing a document back would save an unmigrated one
     * under the current schema version.
     */
    it("refuses to serialize, naming why", () => {
        expect(() => uiDocumentSpec.serialize(uidoc([], []))).toThrow(/read-only/);
        expect(() => uiDocumentSpec.serialize(uidoc([], []))).toThrow(/UIDocumentService/);
    });

    it("counts surfaces, components and elements, component elements included", () => {
        const component: UIComponentDefinition = {
            id: "comp-1",
            name: "Save slot",
            rootElementId: "ce-root",
            elements: {"ce-root": element("ce-root", "Root")},
        };
        const summary = uiDocumentSpec.summarize(uidoc(
            [surface("surf-1", "Title", "el-root")],
            [element("el-root", "Root"), element("el-a", "Ant")],
            [component],
        ));

        expect(summary.title).toBe("Interface");
        expect(summary.counts).toEqual([
            {key: "uiSurfaces", value: 1},
            {key: "uiComponents", value: 1},
            {key: "uiElements", value: 3},
        ]);
    });
});

describe("ui-document spec: diff", () => {
    /**
     * The one this whole tier exists for. A document written out with its keys in another order is
     * the same interface, and the structural tier - which is what this file falls back to without a
     * spec - cannot say so about a document that is nothing but generated ids.
     */
    it("says nothing at all about a pure re-serialization", () => {
        const document = twoElementDocument();

        expect(diffUi(document, reserialized(document)))
            .toMatchObject({changes: [], total: 0, complete: true, tier: "semantic"});
    });

    it("addresses an added element by its Surface and its id", () => {
        const base = twoElementDocument();
        const head = uidoc(
            [surface("surf-1", "Title", "el-root")],
            [
                element("el-root", "Root", {type: "nl.root", childrenIds: ["el-z", "el-a", "el-new"]}),
                element("el-z", "Zebra", {parentId: "el-root"}),
                element("el-a", "Ant", {parentId: "el-root"}),
                element("el-new", "Continue", {parentId: "el-root"}),
            ],
        );

        const result = diffUi(base, head);

        expect(result.changes.map(change => [change.kind, change.path])).toEqual([
            // The parent's own row comes first: it sits above the new element in the tree.
            ["changed", ["surfaces", "surf-1", "elements", "el-root"]],
            ["added", ["surfaces", "surf-1", "elements", "el-new"]],
        ]);
        expect(result.changes[1].subject).toBe("Continue");
    });

    it("addresses a removed element where it used to be", () => {
        const head = uidoc(
            [surface("surf-1", "Title", "el-root")],
            [
                element("el-root", "Root", {type: "nl.root", childrenIds: ["el-z"]}),
                element("el-z", "Zebra", {parentId: "el-root"}),
            ],
        );

        const removed = diffUi(twoElementDocument(), head).changes.find(change => change.kind === "removed");

        expect(removed?.path).toEqual(["surfaces", "surf-1", "elements", "el-a"]);
        expect(removed?.subject).toBe("Ant");
    });

    /**
     * One element with five edits is ONE mask with five reasons in it. Five top-level rows would be
     * five masks over one element, which is what `DocumentChange.children`'s single level is for.
     */
    it("puts five edits to one element under one group, not five rows", () => {
        const base = twoElementDocument();
        const head = uidoc(
            [surface("surf-1", "Title", "el-root")],
            [
                element("el-root", "Root", {type: "nl.root", childrenIds: ["el-z", "el-a"]}),
                element("el-z", "Zebra", {parentId: "el-root"}),
                element("el-a", "Anteater", {
                    parentId: "el-root",
                    layout: {x: 40, y: 8, width: 100, height: 40},
                    style: {color: "nlbrand:text.primary"},
                    props: {text: "Continue"},
                    behavior: {events: {click: {kind: "noop"}}},
                }),
            ],
        );

        const result = diffUi(base, head);

        expect(result.changes).toHaveLength(1);
        expect(result.changes[0].path).toEqual(["surfaces", "surf-1", "elements", "el-a"]);
        expect(result.changes[0].subject).toBe("Anteater");
        expect(result.changes[0].children!.map(child => child.path)).toEqual([
            ["surfaces", "surf-1", "elements", "el-a", "name"],
            ["surfaces", "surf-1", "elements", "el-a", "layout"],
            ["surfaces", "surf-1", "elements", "el-a", "style"],
            ["surfaces", "surf-1", "elements", "el-a", "props"],
            ["surfaces", "surf-1", "elements", "el-a", "behavior"],
        ]);
        expect(result.total).toBe(5);
    });

    it("tells a re-parented element from an edited one", () => {
        const base = twoElementDocument();
        const head = uidoc(
            [surface("surf-1", "Title", "el-root")],
            [
                element("el-root", "Root", {type: "nl.root", childrenIds: ["el-z"]}),
                element("el-z", "Zebra", {parentId: "el-root", childrenIds: ["el-a"]}),
                element("el-a", "Ant", {parentId: "el-z"}),
            ],
        );

        const moved = diffUi(base, head).changes
            .flatMap(change => change.children ?? [])
            .filter(child => child.kind === "moved");

        expect(moved.map(child => [child.path, child.label.key])).toEqual([
            [["surfaces", "surf-1", "elements", "el-root", "childrenIds"], "documentDiff.uiDocument.elementOrder"],
            [["surfaces", "surf-1", "elements", "el-z", "childrenIds"], "documentDiff.uiDocument.elementOrder"],
            [["surfaces", "surf-1", "elements", "el-a", "parentId"], "documentDiff.uiDocument.elementMoved"],
        ]);
    });

    /**
     * Adding a Surface adds its whole subtree to the flat element map. Reporting those beside "a
     * Surface was added" would describe one act twenty-one times, so the count goes in the label.
     */
    it("reports a whole new Surface as one row rather than a row per element in it", () => {
        const head = uidoc(
            [surface("surf-1", "Title", "el-root"), surface("surf-2", "Settings", "el-root2")],
            [
                element("el-root", "Root", {type: "nl.root", childrenIds: ["el-z", "el-a"]}),
                element("el-z", "Zebra", {parentId: "el-root"}),
                element("el-a", "Ant", {parentId: "el-root"}),
                element("el-root2", "Root", {type: "nl.root", childrenIds: ["el-b"]}),
                element("el-b", "Back", {parentId: "el-root2"}),
            ],
        );

        const result = diffUi(twoElementDocument(), head);

        expect(result.changes).toHaveLength(1);
        expect(result.changes[0]).toMatchObject({
            kind: "added",
            path: ["surfaces", "surf-2"],
            subject: "Settings",
            label: {key: "documentDiff.uiDocument.surfaceAdded", params: {elements: 2}},
        });
        expect(result.changes[0].children).toBeUndefined();
    });

    it("addresses a component's own elements under the component", () => {
        const define = (name: string): UIComponentDefinition => ({
            id: "comp-1",
            name: "Save slot",
            rootElementId: "ce-root",
            elements: {
                "ce-root": element("ce-root", "Root", {type: "nl.root", childrenIds: ["ce-label"]}),
                "ce-label": element("ce-label", name, {parentId: "ce-root"}),
            },
        });

        const result = diffUi(
            uidoc([], [], [define("Slot")]),
            uidoc([], [], [define("Empty slot")]),
        );

        expect(result.changes.map(change => change.path)).toEqual([
            ["components", "comp-1", "elements", "ce-label"],
        ]);
        expect(result.changes[0].children!.map(child => child.path)).toEqual([
            ["components", "comp-1", "elements", "ce-label", "name"],
        ]);
    });

    /** An element no Surface root reaches keeps the flat address, rather than being given an owner. */
    it("falls back to the flat address for an element under no root", () => {
        const orphaned = (name: string): UIDocument => uidoc(
            [surface("surf-1", "Title", "el-root")],
            [element("el-root", "Root", {type: "nl.root"}), element("el-loose", name)],
        );

        expect(diffUi(orphaned("Loose"), orphaned("Adrift")).changes.map(change => change.path))
            .toEqual([["elements", "el-loose"]]);
    });

    /**
     * Ordered by the tree and NOT by id, and ordered before anything is truncated - the discipline
     * `buildDocumentDiff` documents. `el-a` sorts first by id and second on the canvas, so a list
     * built in key order and cut to the budget would keep the wrong one and look confident doing it.
     */
    it("orders by the tree before it truncates, not by the generated id", () => {
        const base = twoElementDocument();
        const head = uidoc(
            [surface("surf-1", "Title", "el-root")],
            [
                element("el-root", "Root", {type: "nl.root", childrenIds: ["el-z", "el-a"]}),
                element("el-z", "Zebra", {parentId: "el-root", props: {text: "one"}}),
                element("el-a", "Ant", {parentId: "el-root", props: {text: "two"}}),
            ],
        );

        expect(diffUi(base, head).changes.map(change => change.subject)).toEqual(["Zebra", "Ant"]);

        const truncated = diffUi(base, head, 1);
        expect(truncated.changes.map(change => change.subject)).toEqual(["Zebra"]);
        expect(truncated.total).toBe(2);
        expect(truncated.complete).toBe(false);
        expect(countDocumentChanges([...truncated.changes])).toBe(1);
    });

    /** `subject` is the author's own text. An id is Studio's, and printing one reads as theirs. */
    it("never puts a generated id in a subject", () => {
        const nameless = (width: number): UIDocument => ({
            ...uidoc(
                [{...surface("surf-1", "", "el-root"), designSize: {width, height: 1080}}],
                [element("el-root", "", {type: "nl.root", childrenIds: ["el-z"]}), element("el-z", "", {parentId: "el-root"})],
            ),
            name: "",
        });

        const result = diffUi(nameless(1920), {
            ...nameless(1280),
            elements: {
                ...nameless(1280).elements,
                "el-z": element("el-z", "", {parentId: "el-root", props: {text: "hi"}}),
            },
        });

        expect(result.changes.length).toBeGreaterThan(0);
        expect(subjects(result.changes).every(subject => subject === undefined)).toBe(true);
    });

    it("names the design size with all four numbers, or not at all", () => {
        const sized = (designSize: unknown): UIDocument => uidoc(
            [{...surface("surf-1", "Title", "el-root"), designSize} as UISurface],
            [element("el-root", "Root", {type: "nl.root"})],
        );

        expect(diffUi(sized({width: 1920, height: 1080}), sized({width: 1280, height: 720}))
            .changes[0].children![0]).toMatchObject({
            path: ["surfaces", "surf-1", "designSize"],
            label: {
                key: "documentDiff.uiDocument.surfaceDesignSize",
                params: {fromWidth: 1920, fromHeight: 1080, toWidth: 1280, toHeight: 720},
            },
        });
        // A half-written size falls back rather than rendering `{fromWidth}` at the author.
        expect(diffUi(sized({width: 1920}), sized({width: 1280, height: 720}))
            .changes[0].children![0].label.key).toBe("documentDiff.uiDocument.surfaceField");
    });

    it("never throws on a malformed document, and says less instead", () => {
        expect(() => diffUi({} as UIDocument, {surfaces: null, elements: 7} as unknown as UIDocument)).not.toThrow();
        expect(diffUi({} as UIDocument, {} as UIDocument).changes).toEqual([]);
        // A cycle in the tree is not reachable through the editor and is reachable through a
        // repository; the walk has to end either way.
        const cyclic = uidoc(
            [surface("surf-1", "Title", "el-root")],
            [
                element("el-root", "Root", {type: "nl.root", childrenIds: ["el-z"]}),
                element("el-z", "Zebra", {parentId: "el-root", childrenIds: ["el-root"]}),
            ],
        );
        expect(() => diffUi(cyclic, reserialized(cyclic))).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// ui-graphs
// ---------------------------------------------------------------------------

function node(id: string, type: string, overrides: Partial<BlueprintGraphNode> = {}): BlueprintGraphNode {
    return {id, type, params: {}, meta: {editorLayout: {x: 80, y: 120}}, ...overrides};
}

function blueprint(
    id: string,
    name: string,
    nodes: BlueprintGraphNode[],
    edges: BlueprintGraphEdge[] = [],
): Blueprint {
    return {
        id,
        name,
        owner: {kind: "globalMain"},
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
                        graph: {nodes: Object.fromEntries(nodes.map(one => [one.id, one])), edges},
                    },
                },
                functionIds: [],
                functions: {},
            },
        },
    };
}

function uigraphs(...blueprints: Blueprint[]): UIGraphDocument {
    return {
        schemaVersion: UI_GRAPH_DOCUMENT_SCHEMA_VERSION,
        graphs: {},
        blueprintDocument: {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            blueprints: Object.fromEntries(blueprints.map(one => [one.id, one])),
            ownerRecords: {},
        },
    };
}

const WIRED = (): Blueprint => blueprint(
    "bp-1",
    "Main menu",
    [node("n-head", "blueprint.event.head.click"), node("n-log", "blueprint.debug.log", {meta: {editorLayout: {x: 400, y: 120}}})],
    [{from: {nodeId: "n-head", port: "then"}, to: {nodeId: "n-log", port: "in"}}],
);

function diffGraphs(base: UIGraphDocument, head: UIGraphDocument, limit = 200) {
    return uiGraphsSpec.diff!(base, head, {limit});
}

/** Every node in the fixture's one event graph, rebuilt with `mutate` applied. */
function withNodes(source: Blueprint, mutate: (nodes: Record<string, BlueprintGraphNode>) => void): Blueprint {
    const clone = structuredClone(source);
    const graphs = clone.program.kind === "graph" ? clone.program.graphs : undefined;
    mutate((graphs?.events["ev-1"].graph?.nodes ?? {}) as Record<string, BlueprintGraphNode>);
    return clone;
}

describe("ui-graphs spec: reading", () => {
    it("claims the blueprint document's path", () => {
        expect(resolveDocumentSpecForPath(UIGRAPHS)).toEqual({spec: uiGraphsSpec, parameters: {}});
        expect(uiGraphsSpec.pathFor()).toBe(UIGRAPHS);
        expect(UI_GRAPHS_DOCUMENT_PATH).toBe(UIGRAPHS);
    });

    it("refuses a document a newer Studio wrote, or one shaped wrongly", () => {
        expect(() => parseUiGraphs({...uigraphs(), schemaVersion: UI_GRAPH_DOCUMENT_SCHEMA_VERSION + 1}))
            .toThrow(/newer version of Studio/);
        expect(() => parseUiGraphs({...uigraphs(), graphs: []})).toThrow(/"graphs"/);
        expect(() => parseUiGraphs({...uigraphs(), blueprintDocument: []}))
            .toThrow(/"blueprintDocument" must be an object/);
        expect(() => parseUiGraphs({...uigraphs(), blueprintDocument: {blueprints: []}})).toThrow(/"blueprints"/);
    });

    it("refuses to serialize, naming why", () => {
        expect(() => uiGraphsSpec.serialize(uigraphs())).toThrow(/read-only/);
        expect(() => uiGraphsSpec.serialize(uigraphs())).toThrow(/UIGraphService/);
    });

    it("counts blueprints and the nodes across every graph", () => {
        expect(uiGraphsSpec.summarize(uigraphs(WIRED())).counts).toEqual([
            {key: "uiBlueprints", value: 1},
            {key: "uiGraphNodes", value: 2},
        ]);
        expect(uiGraphsSpec.summarize({} as UIGraphDocument).counts).toEqual([
            {key: "uiBlueprints", value: 0},
            {key: "uiGraphNodes", value: 0},
        ]);
    });
});

describe("ui-graphs spec: diff", () => {
    it("says nothing at all about a pure re-serialization", () => {
        const document = uigraphs(WIRED());

        expect(diffGraphs(document, reserialized(document)))
            .toMatchObject({changes: [], total: 0, complete: true, tier: "semantic"});
    });

    /**
     * The distinction this spec is shaped around. Dragging a node changes nothing the player sees;
     * editing a parameter changes what the game does. They are separate leaves, with separate paths
     * AND separate kinds, so a consumer can tell them apart whichever it reads.
     */
    it("tells a node dragged across the canvas from a node whose values changed", () => {
        const base = uigraphs(WIRED());
        const head = uigraphs(withNodes(WIRED(), nodes => {
            nodes["n-head"].meta = {editorLayout: {x: 600, y: 300}};
            nodes["n-log"].params = {message: "hello"};
        }));

        const result = diffGraphs(base, head);
        const leaves = result.changes.flatMap(change => change.children ?? []);

        // `n-head` was dragged to y=300 and so is listed below `n-log`, which is where it now sits.
        expect(leaves.map(leaf => [leaf.kind, leaf.path, leaf.label.key])).toEqual([
            [
                "changed",
                ["blueprints", "bp-1", "events", "ev-1", "nodes", "n-log", "params"],
                "documentDiff.uiGraphs.nodeParams",
            ],
            [
                "moved",
                ["blueprints", "bp-1", "events", "ev-1", "nodes", "n-head", "editorLayout"],
                "documentDiff.uiGraphs.nodeMoved",
            ],
        ]);
        // And a drag alone leaves nothing else behind: `meta` is compared with the position taken
        // out of both sides, so it does not report the same drag a second time.
        expect(leaves.filter(leaf => leaf.label.key === "documentDiff.uiGraphs.nodeField")).toEqual([]);
    });

    it("addresses an added node and its wires by graph and id", () => {
        const base = uigraphs(WIRED());
        const head = uigraphs(blueprint(
            "bp-1",
            "Main menu",
            [
                node("n-head", "blueprint.event.head.click"),
                node("n-log", "blueprint.debug.log", {meta: {editorLayout: {x: 400, y: 120}}}),
                node("n-wait", "blueprint.flow.delay", {meta: {editorLayout: {x: 250, y: 120}}}),
            ],
            [{from: {nodeId: "n-head", port: "then"}, to: {nodeId: "n-log", port: "in"}}],
        ));

        expect(paths(diffGraphs(base, head).changes)).toEqual([
            ["blueprints", "bp-1", "events", "ev-1", "nodes", "n-wait"],
        ]);
    });

    /**
     * Deleting a node deletes every wire touching it. Six connection rows beside "a node was
     * removed" describe one act seven times, so edges are compared over the nodes both sides hold.
     */
    it("reports a rewire but not the wires a deleted node took with it", () => {
        const three = (edges: BlueprintGraphEdge[]): UIGraphDocument => uigraphs(blueprint(
            "bp-1",
            "Main menu",
            [
                node("n-head", "blueprint.event.head.click"),
                node("n-log", "blueprint.debug.log", {meta: {editorLayout: {x: 400, y: 120}}}),
                node("n-wait", "blueprint.flow.delay", {meta: {editorLayout: {x: 250, y: 120}}}),
            ],
            edges,
        ));
        const wire = (from: string, to: string): BlueprintGraphEdge =>
            ({from: {nodeId: from, port: "then"}, to: {nodeId: to, port: "in"}});

        const rewired = diffGraphs(three([wire("n-head", "n-log")]), three([wire("n-head", "n-wait")]));
        expect(rewired.changes.map(change => [change.kind, change.path])).toEqual([
            ["removed", ["blueprints", "bp-1", "events", "ev-1", "edges", "n-head:then->n-log:in"]],
            ["added", ["blueprints", "bp-1", "events", "ev-1", "edges", "n-head:then->n-wait:in"]],
        ]);

        // The same graph with `n-log` deleted: one row about the node, and nothing about its wire.
        const deleted = diffGraphs(three([wire("n-head", "n-log")]), uigraphs(blueprint(
            "bp-1",
            "Main menu",
            [
                node("n-head", "blueprint.event.head.click"),
                node("n-wait", "blueprint.flow.delay", {meta: {editorLayout: {x: 250, y: 120}}}),
            ],
            [],
        )));
        expect(deleted.changes.map(change => [change.kind, change.path])).toEqual([
            ["removed", ["blueprints", "bp-1", "events", "ev-1", "nodes", "n-log"]],
        ]);
    });

    it("reports a whole new blueprint as one row, with its size in the label", () => {
        const result = diffGraphs(uigraphs(), uigraphs(WIRED()));

        expect(result.changes).toHaveLength(1);
        expect(result.changes[0]).toMatchObject({
            kind: "added",
            path: ["blueprints", "bp-1"],
            subject: "Main menu",
            label: {key: "documentDiff.uiGraphs.blueprintAdded", params: {nodes: 2}},
        });
    });

    it("reads the older root-level graph record on the same terms", () => {
        const legacy = (x: number): UIGraphDocument => ({
            ...uigraphs(),
            graphs: {
                "g-1": {
                    id: "g-1",
                    name: "Legacy",
                    entries: {},
                    nodes: {"n-1": {id: "n-1", type: "old.node", meta: {editorLayout: {x, y: 0}}}},
                    edges: [],
                },
            },
        });

        expect(paths(diffGraphs(legacy(0), legacy(90)).changes)).toEqual([
            ["graphs", "g-1", "nodes", "n-1"],
            ["graphs", "g-1", "nodes", "n-1", "editorLayout"],
        ]);
    });

    /** By the name the author gave the blueprint, and before anything is cut to the budget. */
    it("orders by the author's own name before it truncates", () => {
        const head = uigraphs(...["yak", "ant", "cow", "bee"].map((name, index) =>
            blueprint(`bp-${index}`, name, [node(`n-${index}`, "blueprint.debug.log")])));

        const result = diffGraphs(uigraphs(), head, 2);

        expect(result.total).toBe(4);
        expect(result.complete).toBe(false);
        expect(result.changes.map(change => change.subject)).toEqual(["ant", "bee"]);
    });

    /** A node has no field an author names it in, so it gets no `subject` rather than an id. */
    it("never puts a generated id in a subject", () => {
        const result = diffGraphs(uigraphs(WIRED()), uigraphs(withNodes(WIRED(), nodes => {
            nodes["n-log"].params = {message: "hello"};
        })));

        expect(result.changes.map(change => change.subject)).toEqual([undefined]);
        expect(subjects(result.changes).every(subject => subject === undefined)).toBe(true);
    });

    it("never throws on a malformed document, and says less instead", () => {
        expect(() => diffGraphs({} as UIGraphDocument, {graphs: 7} as unknown as UIGraphDocument)).not.toThrow();
        expect(() => diffGraphs(
            {blueprintDocument: {blueprints: {"bp-1": 5}}} as unknown as UIGraphDocument,
            {blueprintDocument: {blueprints: {"bp-1": {id: "bp-1", program: null}}}} as unknown as UIGraphDocument,
        )).not.toThrow();
        expect(diffGraphs({} as UIGraphDocument, {} as UIGraphDocument).changes).toEqual([]);
    });
});
