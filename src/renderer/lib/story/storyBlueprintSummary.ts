/**
 * What a story blueprint is called on the interface: the name an author gave it, or else what it
 * does.
 *
 * A `/blueprint` row stores only an id, and every such row used to read the same word - a scene with
 * ten of them was ten identical lines, and the inspector, the search panel and Quick Open said that
 * word again. So the row names its blueprint the way an author recognises it: by the name they gave
 * it when they gave one, and otherwise by the first thing its graph does when it runs - the function
 * it calls, or the node it starts with, in the words the blueprint editor draws on that card - with
 * the rest counted. Never an id: a node the catalogue cannot name (a plugin that is not loaded) names
 * nothing, and the row falls back to its kind.
 *
 * Pure over the document and a node reader, so the projection, the search index and Quick Open ask
 * the same question and get the same answer; the reader is what reaches the node catalogue and the
 * interface language.
 *
 * Comments in English per project convention.
 */

import type { Blueprint, BlueprintDocument, BlueprintGraphIr, BlueprintGraphNode } from "@shared/types/blueprint/document";
import { listBlueprintEventIds } from "@shared/blueprint/blueprintEventOrder";
import {
    BLUEPRINT_NODE_PARAM_FN_REF,
    BLUEPRINT_NODE_PARAMS_FN_SIGNATURE_SNAPSHOT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_CALL,
    BLUEPRINT_NODE_TYPE_FN_CALL,
} from "@shared/types/blueprint/graph";
import { isFactoryStoryBlueprintName } from "@shared/types/ui-editor/ownerLabels";
import type { UseTranslation } from "@/lib/i18n";
import { resolveBlueprintNodeTitle } from "@/lib/ui-editor/blueprint-nodes/blueprintNodeI18n";
import type { BlueprintNodeEditorCatalogEntry } from "@/lib/ui-editor/blueprint-nodes/types";
import { findBlueprintFnByRef } from "@/lib/workspace/services/ui-editor/blueprint/fnCatalog";

/** What the summary needs to know about one node. */
export type StoryBlueprintNodeFacts = {
    /** The words the node goes by, or null when it has none an author would recognise. */
    title: string | null;
    /** The ids of the exec output pins the run continues through. */
    execOutputs: readonly string[];
    /** A node that does nothing when run - a comment, a reroute - and so says nothing about the row. */
    passive: boolean;
    /** An event head: where a run starts, not something it does. */
    head: boolean;
};

/** Reads one node of `blueprint`'s graph. Null for a node the reader knows nothing about. */
export type StoryBlueprintNodeReader = (node: BlueprintGraphNode, blueprint: Blueprint) => StoryBlueprintNodeFacts | null;

/** The layer a story blueprint runs when its row is reached: the first one, as the editor opens it. */
function runLayer(blueprint: Blueprint): BlueprintGraphIr | null {
    const eventId = listBlueprintEventIds(blueprint.graphs)[0];
    return (eventId ? blueprint.graphs.events[eventId]?.graph : undefined) ?? null;
}

/**
 * The nodes a run of the blueprint passes through, in the order it reaches them: from the On Call
 * head along exec wires, breadth first, each once.
 */
function nodesInRunOrder(blueprint: Blueprint, ir: BlueprintGraphIr, read: StoryBlueprintNodeReader): { node: BlueprintGraphNode; facts: StoryBlueprintNodeFacts }[] {
    const nodes = ir.nodes ?? {};
    const facts = new Map<string, StoryBlueprintNodeFacts | null>();
    const factsOf = (nodeId: string): StoryBlueprintNodeFacts | null => {
        if (!facts.has(nodeId)) {
            const node = nodes[nodeId];
            facts.set(nodeId, node ? read(node, blueprint) : null);
        }
        return facts.get(nodeId) ?? null;
    };
    const head = Object.values(nodes).find(node => node.type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_CALL)
        ?? Object.values(nodes).find(node => factsOf(node.id)?.head);
    if (!head) {
        return [];
    }
    const order: { node: BlueprintGraphNode; facts: StoryBlueprintNodeFacts }[] = [];
    const seen = new Set<string>([head.id]);
    const queue: string[] = [head.id];
    while (queue.length > 0) {
        const nodeId = queue.shift() as string;
        const outputs = new Set(factsOf(nodeId)?.execOutputs ?? []);
        for (const edge of ir.edges ?? []) {
            if (edge.from.nodeId !== nodeId || !outputs.has(edge.from.port) || seen.has(edge.to.nodeId)) {
                continue;
            }
            seen.add(edge.to.nodeId);
            queue.push(edge.to.nodeId);
            const node = nodes[edge.to.nodeId];
            const nodeFacts = factsOf(edge.to.nodeId);
            if (node && nodeFacts && !nodeFacts.passive && !nodeFacts.head) {
                order.push({ node, facts: nodeFacts });
            }
        }
    }
    return order;
}

/**
 * What the blueprint does, as one short phrase: the first thing a run of it does, followed by how
 * many more there are (`Play Sound +2`). Null when it does nothing, or when the first thing it does
 * has no name an author would know.
 *
 * Only for a blueprint a row RUNS. A value or a condition blueprint is read for what it returns, and
 * the first node of one is its Return Value - which would name every one of them the same.
 */
export function summarizeStoryBlueprint(blueprint: Blueprint, read: StoryBlueprintNodeReader): string | null {
    const owner = blueprint.owner;
    if (owner?.kind !== "storyAction" || owner.mode === "value" || owner.mode === "condition") {
        return null;
    }
    const ir = runLayer(blueprint);
    if (!ir) {
        return null;
    }
    const steps = nodesInRunOrder(blueprint, ir, read);
    const first = steps[0]?.facts.title?.trim();
    if (!first) {
        return null;
    }
    return steps.length > 1 ? `${first} +${steps.length - 1}` : first;
}

/**
 * The name a story blueprint goes by: the one its author gave it, else what it does (see
 * {@link summarizeStoryBlueprint}). Null when it has neither - a blueprint still carrying the name it
 * was created with, whose graph does nothing yet - which the caller answers with its own word for the
 * kind.
 */
export function storyBlueprintName(document: BlueprintDocument | null | undefined, blueprintId: string, read: StoryBlueprintNodeReader): string | null {
    const blueprint = blueprintId ? document?.blueprints[blueprintId] : undefined;
    if (!blueprint || blueprint.owner?.kind !== "storyAction") {
        return null;
    }
    const authored = blueprint.name?.trim();
    if (authored && !isFactoryStoryBlueprintName(authored)) {
        return authored;
    }
    return summarizeStoryBlueprint(blueprint, read);
}

/** The slice of the node catalogue a reader needs. */
export type StoryBlueprintNodeCatalog = {
    resolveCatalogEntryForNode(type: string, params?: Record<string, unknown>): BlueprintNodeEditorCatalogEntry;
};

/**
 * A reader that names nodes the way the blueprint editor draws them: the catalogue's title in the
 * interface language, and for a `Call Fn` the function's own name - the word on that card that tells
 * one call from another.
 */
export function catalogStoryBlueprintNodeReader(
    catalog: StoryBlueprintNodeCatalog,
    document: BlueprintDocument,
    t: UseTranslation["t"],
): StoryBlueprintNodeReader {
    return node => {
        let entry: BlueprintNodeEditorCatalogEntry;
        try {
            entry = catalog.resolveCatalogEntryForNode(node.type, node.params ?? {});
        } catch {
            return null;
        }
        const execOutputs = entry.pins.filter(pin => pin.kind === "output" && pin.semantic === "exec").map(pin => pin.id);
        const passive = entry.role === "comment" || entry.role === "reroute";
        const head = entry.role === "eventHead" || entry.role === "elementEventHead";
        // A node from a plugin that is not loaded is drawn under its type id, which is not a name.
        const title = entry.unknown ? null : functionCalled(node, document) ?? resolveBlueprintNodeTitle(entry.displayName, t);
        return { title, execOutputs, passive, head };
    };
}

/** The name of the function a `Call Fn` node calls, or null for any other node or an unset call. */
function functionCalled(node: BlueprintGraphNode, document: BlueprintDocument): string | null {
    if (node.type !== BLUEPRINT_NODE_TYPE_FN_CALL) {
        return null;
    }
    const declared = findBlueprintFnByRef(document, node.params?.[BLUEPRINT_NODE_PARAM_FN_REF])?.name?.trim();
    if (declared) {
        return declared;
    }
    // The call's own snapshot outlives the function it names; it is what the card prints then too.
    // Read raw: the snapshot reader stands a generic English word in for a missing name.
    const snapshot = node.params?.[BLUEPRINT_NODE_PARAMS_FN_SIGNATURE_SNAPSHOT] as { name?: unknown } | undefined;
    return typeof snapshot?.name === "string" && snapshot.name.trim() ? snapshot.name.trim() : null;
}

/**
 * What each story blueprint of the workspace's blueprint document does, for the places that list
 * blueprints by name - Quick Open, the search index, a tab opened from either - so they name a story
 * blueprint nobody named the way its row does. Null for a blueprint that is not a story blueprint
 * run by a row, or that does nothing yet. Read at the time of asking, in the interface language.
 */
export function workspaceStoryBlueprintSummary(
    document: BlueprintDocument,
    catalog: StoryBlueprintNodeCatalog,
    t: UseTranslation["t"],
): (blueprint: Blueprint) => string | null {
    const read = catalogStoryBlueprintNodeReader(catalog, document, t);
    return blueprint => (blueprint.owner?.kind === "storyAction" ? summarizeStoryBlueprint(blueprint, read) : null);
}
