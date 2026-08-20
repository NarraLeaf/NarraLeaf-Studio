import type { BlueprintGraphIr } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_ELEMENT_REF,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_FLUSH,
} from "@shared/types/blueprint/graph";
import type { BlueprintElementRef } from "@shared/types/blueprint/valueTypes";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { readBlueprintElementRefParams } from "@/lib/ui-editor/blueprint-nodes/built-in/elementRefUtils";

/**
 * The graph nodes that name a widget, and what counts as naming one that exists.
 *
 * Three node types store a `{surfaceId, elementId, elementType}` triple in their params: the
 * element literal, and the two element event heads. Every other route to a widget is an edge from
 * one of those, so this is the whole set of places a widget id is written down in a graph.
 *
 * Collected here rather than in each caller because two of them have to agree: the lint rule that
 * reports a binding to a widget the project does not have, and the paste that counts how many of
 * them a fragment from another project arrived with. Two answers to "does this reference resolve"
 * would be a notification that disagrees with the report the author is sent to.
 */

/** One node in a graph that names a widget. */
export type BlueprintElementRefSite = {
    nodeId: string;
    ref: BlueprintElementRef;
};

/** Whether a node of this type stores a widget reference in its params. */
export function isBlueprintElementRefNodeType(type: string): boolean {
    return (
        type === BLUEPRINT_NODE_TYPE_ELEMENT_REF ||
        type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_FLUSH ||
        type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK
    );
}

/**
 * Every widget reference a graph carries.
 *
 * A node whose triple is incomplete is skipped: `readBlueprintElementRefParams` answers only when
 * all three parts are set, and a half-filled one is a node the author has not finished binding
 * rather than a binding that is broken.
 */
export function listBlueprintElementRefSites(ir: BlueprintGraphIr): BlueprintElementRefSite[] {
    const sites: BlueprintElementRefSite[] = [];
    for (const node of Object.values(ir.nodes ?? {})) {
        if (!isBlueprintElementRefNodeType(node.type)) {
            continue;
        }
        const ref = readBlueprintElementRefParams(node.params);
        if (ref) {
            sites.push({ nodeId: node.id, ref });
        }
    }
    return sites;
}

/**
 * Every element id the project has, wherever it lives.
 *
 * **Both tables, and that is load-bearing.** A component definition keeps its elements in its own
 * `elements` record and not in the document's, so a set built from `document.elements` alone would
 * call every binding inside a component's blueprint broken - a check that fires on correct graphs,
 * which is worse than not checking at all.
 *
 * The surface a reference names is deliberately not part of the key. A widget id is unique across
 * the document, the binding gesture writes the surface it was picked on, and a reference whose
 * element exists under a surface id that has since changed is a *stale* wire rather than a missing
 * one - a different sentence, and one that would send the author looking for a widget they can
 * still see on the page.
 */
export function collectProjectElementIds(document: UIDocument): ReadonlySet<string> {
    const ids = new Set<string>(Object.keys(document.elements ?? {}));
    for (const component of document.components ?? []) {
        for (const elementId of Object.keys(component.elements ?? {})) {
            ids.add(elementId);
        }
    }
    return ids;
}
