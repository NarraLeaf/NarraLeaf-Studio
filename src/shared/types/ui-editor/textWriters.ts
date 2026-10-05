/**
 * Which blueprints write words into which interface elements while a game runs.
 *
 * Derived from the blueprint document every time it is asked, never stored: a write is a node on a
 * graph, and the graph is the only place that knows it exists. The inspector lists the writers of the
 * element it shows. The words an element holds under a writer that replaces them are its default
 * value: the game shows them, translated, until the first write lands, so they ship and are translated
 * like any other words a player reads (only words a binding answers are sample text, `textSample.ts`).
 *
 * Two shapes write a widget's words, and both are read here:
 *
 *  - **A widget's own graph.** `Set Text`, `Append Text`, `Clear Text` and `Set Label` without an
 *    element pin act on the widget whose blueprint holds them - a page widget's own blueprint, or a
 *    component definition's.
 *  - **An element reference.** The element-pin twins of those nodes act on whatever the pin is wired
 *    from: an `Element` literal, or an element event head, each of which stores the element it names.
 *    Any other route to the pin (a variable, a Fn parameter) names its element only at run time, so
 *    nothing here can say which element it is.
 *
 * Script layers are not graphs and are not read: what a script writes is decided by its code. The
 * help topic on values on a screen says so.
 *
 * Only blueprints an owner record points at are read. An unlisted blueprint is never dispatched, so
 * its writes never happen.
 *
 * Comments in English per project convention.
 */

import type { BlueprintDocument, BlueprintGraphIr } from "../blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_ELEMENT_REF,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_APPEND_TEXT,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_CLEAR_TEXT,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_ALL_PROPERTIES,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_FLUSH,
    BLUEPRINT_NODE_TYPE_TEXT_APPEND_TEXT,
    BLUEPRINT_NODE_TYPE_TEXT_CLEAR_TEXT,
    BLUEPRINT_NODE_TYPE_TEXT_SET_ALL_PROPERTIES,
    BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT,
} from "../blueprint/graph";
import { requireUITextSite, type UITextSite } from "./textSource";

/**
 * What a write does to the words already there.
 *
 * - `replace`: the words after it are the ones it wrote (or none, for `Clear Text`).
 * - `append`: the words it wrote follow the ones already there, which are therefore part of what the
 *   game shows.
 */
export type UITextWriteEffect = "replace" | "append";

/** One node type that writes a widget's words. */
export type UITextWriteNode = {
    readonly nodeType: string;
    /**
     * Which element it writes: `self` is the widget whose own blueprint holds the node, `element` is the
     * one wired to its `element` pin.
     */
    readonly target: "self" | "element";
    /** The widget whose words it writes. The prop is the widget's text site's (`textSites.ts`). */
    readonly widgetType: "nl.text" | "nl.button";
    readonly effect: UITextWriteEffect;
    /**
     * For a node that writes several properties at once: the pin carrying the words. The node writes
     * them only when the pin is given - wired, or holding a value - and leaves them as they are when it
     * is not.
     */
    readonly wordsPin?: string;
};

/** The pin an element-target write names its element on. */
const ELEMENT_PIN = "element";

/**
 * Every node type that writes a widget's words, and how.
 *
 * `Set Label` has no exported type constant: its type is assembled from the widget family's prefix
 * where the node is declared (`widgetPropertyNodes.ts`). `textWriters.test.ts` holds every type here
 * against the node registry, so a renamed node fails a test instead of dropping out of the scan.
 */
export const UI_TEXT_WRITE_NODES: readonly UITextWriteNode[] = [
    { nodeType: BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT, target: "self", widgetType: "nl.text", effect: "replace" },
    { nodeType: BLUEPRINT_NODE_TYPE_TEXT_CLEAR_TEXT, target: "self", widgetType: "nl.text", effect: "replace" },
    { nodeType: BLUEPRINT_NODE_TYPE_TEXT_APPEND_TEXT, target: "self", widgetType: "nl.text", effect: "append" },
    {
        nodeType: BLUEPRINT_NODE_TYPE_TEXT_SET_ALL_PROPERTIES,
        target: "self",
        widgetType: "nl.text",
        effect: "replace",
        wordsPin: "text",
    },
    { nodeType: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT, target: "element", widgetType: "nl.text", effect: "replace" },
    { nodeType: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_CLEAR_TEXT, target: "element", widgetType: "nl.text", effect: "replace" },
    { nodeType: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_APPEND_TEXT, target: "element", widgetType: "nl.text", effect: "append" },
    {
        nodeType: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_ALL_PROPERTIES,
        target: "element",
        widgetType: "nl.text",
        effect: "replace",
        wordsPin: "text",
    },
    { nodeType: "blueprint.button.setLabel", target: "self", widgetType: "nl.button", effect: "replace" },
    { nodeType: "blueprint.element.button.setLabel", target: "element", widgetType: "nl.button", effect: "replace" },
];

const WRITE_NODE_BY_TYPE: ReadonlyMap<string, UITextWriteNode> = new Map(
    UI_TEXT_WRITE_NODES.map(entry => [entry.nodeType, entry]),
);

/** The node types that store the element they name in their params. */
const ELEMENT_NAMING_NODE_TYPES: ReadonlySet<string> = new Set([
    BLUEPRINT_NODE_TYPE_ELEMENT_REF,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_FLUSH,
]);

/** The graphs of a blueprint, as the editor opens them. */
export type UITextWriterGraphKind = "event" | "function" | "macro";

/** One node that writes one element's words. */
export type UITextWriter = {
    blueprintId: string;
    graphKind: UITextWriterGraphKind;
    /** The graph's key in its blueprint - what the editor is told to focus. */
    graphId: string;
    nodeId: string;
    nodeType: string;
    effect: UITextWriteEffect;
    /** The prop it writes. */
    textProp: UITextSite["textProp"];
};

/** Writers by the id of the element they write. */
export type UITextWriterIndex = ReadonlyMap<string, readonly UITextWriter[]>;

export const EMPTY_UI_TEXT_WRITER_INDEX: UITextWriterIndex = new Map();

type ElementNamingNode = { type: string; params?: Record<string, unknown> };

function elementIdNamedBy(node: ElementNamingNode | undefined, widgetType: string): string | null {
    if (!node || !ELEMENT_NAMING_NODE_TYPES.has(node.type)) {
        return null;
    }
    const elementId = node.params?.elementId;
    const elementType = node.params?.elementType;
    if (typeof elementId !== "string" || !elementId.trim()) {
        return null;
    }
    // The write checks the type the reference carries before it does anything, and refuses one of
    // another widget kind - so such a wire writes nothing.
    if (typeof elementType === "string" && elementType.trim() && elementType.trim() !== widgetType) {
        return null;
    }
    return elementId.trim();
}

function collectGraphWriters(
    ir: BlueprintGraphIr,
    place: { blueprintId: string; graphKind: UITextWriterGraphKind; graphId: string; ownElementId: string | null },
    add: (elementId: string, writer: UITextWriter) => void,
): void {
    const nodes = ir.nodes ?? {};
    let incoming: Map<string, string> | null = null;
    const sourceOf = (nodeId: string, port: string): string | undefined => {
        if (!incoming) {
            incoming = new Map();
            for (const edge of ir.edges ?? []) {
                incoming.set(`${edge.to.nodeId}\u0000${edge.to.port}`, edge.from.nodeId);
            }
        }
        return incoming.get(`${nodeId}\u0000${port}`);
    };
    for (const node of Object.values(nodes)) {
        const write = WRITE_NODE_BY_TYPE.get(node.type);
        if (!write) {
            continue;
        }
        if (write.wordsPin && sourceOf(node.id, write.wordsPin) === undefined && node.params?.[write.wordsPin] === undefined) {
            continue;
        }
        let elementId: string | null;
        if (write.target === "self") {
            elementId = place.ownElementId;
        } else {
            const source = sourceOf(node.id, ELEMENT_PIN);
            elementId = source ? elementIdNamedBy(nodes[source], write.widgetType) : null;
        }
        if (!elementId) {
            continue;
        }
        add(elementId, {
            blueprintId: place.blueprintId,
            graphKind: place.graphKind,
            graphId: place.graphId,
            nodeId: node.id,
            nodeType: node.type,
            effect: write.effect,
            textProp: requireUITextSite(write.widgetType).textProp,
        });
    }
}

/**
 * Every write of a widget's words that the project's graphs hold, by the element written.
 *
 * In document order within each element: blueprints as the document lists them, then each blueprint's
 * events, functions and macros, then nodes.
 */
export function indexUITextWriters(document: Pick<BlueprintDocument, "blueprints" | "ownerRecords"> | null | undefined): UITextWriterIndex {
    if (!document) {
        return EMPTY_UI_TEXT_WRITER_INDEX;
    }
    const dispatched = new Set<string>();
    for (const record of Object.values(document.ownerRecords ?? {})) {
        if (record?.blueprintId) {
            dispatched.add(record.blueprintId);
        }
    }
    const index = new Map<string, UITextWriter[]>();
    const add = (elementId: string, writer: UITextWriter) => {
        const list = index.get(elementId);
        if (list) {
            list.push(writer);
        } else {
            index.set(elementId, [writer]);
        }
    };
    for (const blueprint of Object.values(document.blueprints ?? {})) {
        if (!dispatched.has(blueprint.id)) {
            continue;
        }
        const owner = blueprint.owner;
        const ownElementId = owner?.kind === "widgetMain" || owner?.kind === "componentWidgetMain"
            ? owner.elementId
            : null;
        const graphs = blueprint.graphs;
        const slots: readonly [UITextWriterGraphKind, Record<string, { graph?: BlueprintGraphIr }> | undefined][] = [
            ["event", graphs?.events],
            ["function", graphs?.functions],
            ["macro", graphs?.macros],
        ];
        for (const [graphKind, entries] of slots) {
            for (const [graphId, slot] of Object.entries(entries ?? {})) {
                if (slot?.graph) {
                    collectGraphWriters(slot.graph, { blueprintId: blueprint.id, graphKind, graphId, ownElementId }, add);
                }
            }
        }
    }
    return index;
}
