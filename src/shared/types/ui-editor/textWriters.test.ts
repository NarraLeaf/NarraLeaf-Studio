import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Blueprint, BlueprintDocument, BlueprintGraphIr, BlueprintOwnerRef } from "../blueprint/document";
import { encodeBlueprintOwnerKey } from "../../blueprint/ownerKey";
import {
    BLUEPRINT_NODE_TYPE_ELEMENT_REF,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_APPEND_TEXT,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_ALL_PROPERTIES,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_TEXT_CLEAR_TEXT,
    BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT,
} from "../blueprint/graph";
import type { UIDocument } from "./document";
import { indexUITextWriters } from "./textWriters";

/**
 * The writer scan: which graphs write which element's words, read off the blueprint document the way
 * the game would run it.
 */

const PAGE = "page-1";
const COMPONENT = "component-1";

let nextBlueprint = 0;

function blueprint(owner: BlueprintOwnerRef, layers: { events?: Record<string, BlueprintGraphIr>; functions?: Record<string, BlueprintGraphIr> }): Blueprint {
    nextBlueprint += 1;
    return {
        id: `bp-${nextBlueprint}`,
        name: `Blueprint ${nextBlueprint}`,
        owner,
        graphs: {
            events: Object.fromEntries(Object.entries(layers.events ?? {}).map(([id, graph]) => [id, { id, graph }])),
            functions: Object.fromEntries(Object.entries(layers.functions ?? {}).map(([id, graph]) => [id, { id, graph }])),
        },
    };
}

/** A document whose every blueprint is dispatched (its owner record points at it), unless listed in `unlisted`. */
function documentOf(blueprints: Blueprint[], unlisted: Blueprint[] = []): BlueprintDocument {
    return {
        schemaVersion: 1 as BlueprintDocument["schemaVersion"],
        blueprints: Object.fromEntries([...blueprints, ...unlisted].map(entry => [entry.id, entry])),
        ownerRecords: Object.fromEntries(blueprints.map(entry => [encodeBlueprintOwnerKey(entry.owner), { blueprintId: entry.id }])),
    };
}

/** An `Element` literal naming `elementId`, wired into `writer`'s element pin. */
function refWrite(writerType: string, elementId: string, options: { elementType?: string; params?: Record<string, unknown>; surfaceId?: string } = {}): BlueprintGraphIr {
    return {
        nodes: {
            head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT },
            ref: {
                id: "ref",
                type: BLUEPRINT_NODE_TYPE_ELEMENT_REF,
                params: { surfaceId: options.surfaceId ?? PAGE, elementId, elementType: options.elementType ?? "nl.text" },
            },
            write: { id: "write", type: writerType, params: options.params },
        },
        edges: [
            { from: { nodeId: "head", port: "next" }, to: { nodeId: "write", port: "in" } },
            { from: { nodeId: "ref", port: "element" }, to: { nodeId: "write", port: "element" } },
        ],
    };
}

function selfWrite(writerType: string): BlueprintGraphIr {
    return {
        nodes: {
            head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT },
            write: { id: "write", type: writerType },
        },
        edges: [{ from: { nodeId: "head", port: "next" }, to: { nodeId: "write", port: "in" } }],
    };
}

describe("indexUITextWriters", () => {
    it("finds a page's own graph writing into one of its elements through an element reference", () => {
        const page = blueprint({ kind: "surfaceMain", surfaceId: PAGE }, { events: { open: refWrite(BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT, "title") } });
        const index = indexUITextWriters(documentOf([page]));

        expect(index.get("title")).toEqual([{
            blueprintId: page.id,
            graphKind: "event",
            graphId: "open",
            nodeId: "write",
            nodeType: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT,
            effect: "replace",
            textProp: "text",
        }]);
        expect([...index.keys()]).toEqual(["title"]);
    });

    it("finds a component's own graph writing into an element of the component", () => {
        // The shape of the shipped save slot: the definition's blueprint fills the slot's fields.
        const slot = blueprint(
            { kind: "componentWidgetMain", componentId: COMPONENT, elementId: "hit-area" },
            {
                functions: {
                    refresh: {
                        nodes: {
                            place: { id: "place", type: BLUEPRINT_NODE_TYPE_ELEMENT_REF, params: { surfaceId: `component:${COMPONENT}`, elementId: "place", elementType: "nl.text" } },
                            setPlace: { id: "setPlace", type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT },
                            clearPlace: { id: "clearPlace", type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT, params: { text: "" } },
                            place2: { id: "place2", type: BLUEPRINT_NODE_TYPE_ELEMENT_REF, params: { surfaceId: `component:${COMPONENT}`, elementId: "place", elementType: "nl.text" } },
                        },
                        edges: [
                            { from: { nodeId: "place", port: "element" }, to: { nodeId: "setPlace", port: "element" } },
                            { from: { nodeId: "place2", port: "element" }, to: { nodeId: "clearPlace", port: "element" } },
                        ],
                    },
                },
            },
        );
        const index = indexUITextWriters(documentOf([slot]));

        expect(index.get("place")?.map(writer => [writer.blueprintId, writer.graphKind, writer.graphId, writer.nodeId])).toEqual([
            [slot.id, "function", "refresh", "setPlace"],
            [slot.id, "function", "refresh", "clearPlace"],
        ]);
        // The blueprint's own element is not written: every write here names another one.
        expect(index.has("hit-area")).toBe(false);
    });

    it("finds a widget's own graph writing into itself, with no element pin", () => {
        const own = blueprint({ kind: "widgetMain", surfaceId: PAGE, elementId: "counter" }, { events: { init: selfWrite(BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT) } });
        const ownLabel = blueprint({ kind: "widgetMain", surfaceId: PAGE, elementId: "toggle" }, { events: { click: selfWrite("blueprint.button.setLabel") } });
        const ownInComponent = blueprint(
            { kind: "componentWidgetMain", componentId: COMPONENT, elementId: "value" },
            { events: { init: selfWrite(BLUEPRINT_NODE_TYPE_TEXT_CLEAR_TEXT) } },
        );
        const index = indexUITextWriters(documentOf([own, ownLabel, ownInComponent]));

        expect(index.get("counter")?.map(writer => [writer.nodeType, writer.textProp, writer.effect])).toEqual([
            [BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT, "text", "replace"],
        ]);
        expect(index.get("toggle")?.map(writer => [writer.nodeType, writer.textProp])).toEqual([["blueprint.button.setLabel", "label"]]);
        expect(index.get("value")?.map(writer => writer.nodeType)).toEqual([BLUEPRINT_NODE_TYPE_TEXT_CLEAR_TEXT]);
    });

    it("ignores a self write in a graph that belongs to no widget", () => {
        const page = blueprint({ kind: "surfaceMain", surfaceId: PAGE }, { events: { open: selfWrite(BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT) } });
        expect(indexUITextWriters(documentOf([page])).size).toBe(0);
    });

    it("reads another widget's graph writing into an element, the shape of a slider and its readout", () => {
        const slider = blueprint(
            { kind: "widgetMain", surfaceId: PAGE, elementId: "volume-slider" },
            { events: { change: refWrite(BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT, "volume-readout") } },
        );
        const index = indexUITextWriters(documentOf([slider]));
        expect(index.get("volume-readout")).toHaveLength(1);
        expect(index.has("volume-slider")).toBe(false);
    });

    it("says an append keeps the words already there", () => {
        const page = blueprint({ kind: "surfaceMain", surfaceId: PAGE }, { events: { open: refWrite(BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_APPEND_TEXT, "log") } });
        expect(indexUITextWriters(documentOf([page])).get("log")?.[0].effect).toBe("append");
    });

    it("counts Set All Properties only when it is given words", () => {
        const withoutWords = blueprint({ kind: "surfaceMain", surfaceId: PAGE }, { events: { a: refWrite(BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_ALL_PROPERTIES, "styled") } });
        const withWords = blueprint(
            { kind: "surfaceMain", surfaceId: "page-2" },
            { events: { a: refWrite(BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_ALL_PROPERTIES, "worded", { params: { text: "Hello" } }) } },
        );
        const index = indexUITextWriters(documentOf([withoutWords, withWords]));
        expect(index.has("styled")).toBe(false);
        expect(index.get("worded")).toHaveLength(1);
    });

    it("follows an element event head as the source of the element", () => {
        const page = blueprint({ kind: "surfaceMain", surfaceId: PAGE }, {
            events: {
                click: {
                    nodes: {
                        head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK, params: { surfaceId: PAGE, elementId: "badge", elementType: "nl.text" } },
                        write: { id: "write", type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT },
                    },
                    edges: [
                        { from: { nodeId: "head", port: "next" }, to: { nodeId: "write", port: "in" } },
                        { from: { nodeId: "head", port: "element" }, to: { nodeId: "write", port: "element" } },
                    ],
                },
            },
        });
        expect(indexUITextWriters(documentOf([page])).get("badge")).toHaveLength(1);
    });

    it("skips what never writes: a reference of another widget kind, an unwired pin, an unlisted blueprint", () => {
        const wrongKind = blueprint({ kind: "surfaceMain", surfaceId: PAGE }, {
            events: { a: refWrite(BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT, "picture", { elementType: "nl.image" }) },
        });
        const unwired = blueprint({ kind: "surfaceMain", surfaceId: "page-2" }, { events: { a: selfWrite(BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT) } });
        const orphan = blueprint({ kind: "surfaceMain", surfaceId: "page-3" }, { events: { a: refWrite(BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT, "ghost") } });
        expect(indexUITextWriters(documentOf([wrongKind, unwired], [orphan])).size).toBe(0);
        expect(indexUITextWriters(null).size).toBe(0);
    });

    it("finds the shipped skeleton's writers: thirteen elements, twenty-nine writes", () => {
        // The counts the interface text survey measured on all three skeletons. A scan that misses a
        // shape the template uses drops below them.
        const root = path.resolve(__dirname, "../../../../resources/templates/skeleton");
        for (const variant of ["content", "content.zh", "content.ja"]) {
            const graphs = JSON.parse(fs.readFileSync(path.join(root, variant, "editor/ui/uigraphs.json"), "utf8")) as { blueprintDocument: BlueprintDocument };
            const uidoc = JSON.parse(fs.readFileSync(path.join(root, variant, "editor/ui/uidoc.json"), "utf8")) as UIDocument;
            const index = indexUITextWriters(graphs.blueprintDocument);
            const elementIds = new Set([
                ...Object.keys(uidoc.elements),
                ...(uidoc.components ?? []).flatMap(component => Object.keys(component.elements)),
            ]);
            expect([...index.keys()].every(id => elementIds.has(id))).toBe(true);
            expect(index.size).toBe(13);
            expect([...index.values()].reduce((sum, writers) => sum + writers.length, 0)).toBe(29);
        }
    });
});
