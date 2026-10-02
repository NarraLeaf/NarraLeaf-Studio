/**
 * A layer template, compiled for one particular blueprint.
 *
 * The template text goes through the blueprint CLI's parser and compiler with the real owner
 * substituted in, so the answer to "can this template go here" is the compiler's own: a node the
 * palette would not offer on this owner (a click head on a widget that has no click) comes back as
 * `compile.out_of_scope`, and the template is not offered. Nothing here keeps its own list of which
 * template suits which widget.
 *
 * Comments in English per project convention.
 */

import type { BlueprintGraphIr, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import type { UIElement } from "@shared/types/ui-editor/document";
import { parseBlueprintText } from "@/lib/blueprint-cli/dsl/parse";
import { compileBlueprintDocument } from "@/lib/blueprint-cli/dsl/compile";
import { BLUEPRINT_OWNER_GRAMMAR } from "@/lib/blueprint-cli/dsl/ownerGrammar";
import {
    BLUEPRINT_LAYER_TEMPLATES,
    type BlueprintLayerTemplate,
    type BlueprintLayerTemplateFacts,
} from "./blueprintLayerTemplates";

export type BlueprintLayerTemplateTarget = {
    owner: BlueprintOwnerRef;
    /** The widget's type, for a widget's own blueprint; which event heads it carries depends on it. */
    widgetElementType?: string;
    /** Every element the owner can see, so element references get their type filled in. */
    uiElements?: Readonly<Record<string, UIElement>>;
    facts: BlueprintLayerTemplateFacts;
};

export type BuiltBlueprintLayerTemplate = {
    ir: BlueprintGraphIr;
    /** Nodes with a choice still left to the author, by their id in {@link ir}. */
    pendingNodeIds: string[];
};

/** The graph of `template` for this owner, or null when the template cannot go on it. */
export function buildBlueprintLayerTemplate(
    template: BlueprintLayerTemplate,
    target: BlueprintLayerTemplateTarget,
    newId: () => string,
): BuiltBlueprintLayerTemplate | null {
    if (!template.owners.includes(target.owner.kind) || template.available?.(target.facts) === false) {
        return null;
    }
    // The header only has to parse; the owner it names is replaced below by the real one, which
    // spares spelling an owner line from a ref the grammar table already describes.
    const parsed = parseBlueprintText(`blueprint "template" owner=globalMain\nevent "template"\n${template.graph(target.facts)}`);
    const blueprintAst = parsed.document.blueprints[0];
    if (!blueprintAst || parsed.diagnostics.some(diagnostic => diagnostic.severity === "error")) {
        return null;
    }
    blueprintAst.ownerKind = target.owner.kind;
    blueprintAst.ownerFields = ownerFieldsOf(target.owner);

    const compiled = compileBlueprintDocument(parsed.document, {
        resolveWidgetElementType: () => target.widgetElementType,
        resolveElementType: elementId => target.uiElements?.[elementId]?.type,
        uiElements: target.uiElements,
    });
    const refused = compiled.diagnostics.some(
        diagnostic => diagnostic.severity === "error" || diagnostic.code === "compile.out_of_scope",
    );
    const blueprint = compiled.blueprints[0];
    const layerId = blueprint?.graphs.eventIds?.[0];
    const graph = layerId ? blueprint.graphs.events[layerId]?.graph : undefined;
    if (refused || !graph) {
        return null;
    }

    // The text names nodes for the reader of the template; in a project they get ids like every
    // node the canvas makes, so two layers built from one template share none.
    const renamed = new Map<string, string>();
    const nodes: NonNullable<BlueprintGraphIr["nodes"]> = {};
    for (const [localId, node] of Object.entries(graph.nodes ?? {})) {
        const id = newId();
        renamed.set(localId, id);
        nodes[id] = { ...node, id };
    }
    const edges = (graph.edges ?? []).map(edge => ({
        from: { nodeId: renamed.get(edge.from.nodeId) ?? edge.from.nodeId, port: edge.from.port },
        to: { nodeId: renamed.get(edge.to.nodeId) ?? edge.to.nodeId, port: edge.to.port },
    }));

    const pendingNodeIds: string[] = [];
    for (const [localId, keys] of Object.entries(template.choices ?? {})) {
        const node = graph.nodes?.[localId];
        const id = renamed.get(localId);
        if (node && id && keys.some(key => isUnset(node.params?.[key]))) {
            pendingNodeIds.push(id);
        }
    }
    return { ir: { nodes, edges }, pendingNodeIds };
}

/** The templates that can go on this owner, in the order they are shown. */
export function listBlueprintLayerTemplates(target: BlueprintLayerTemplateTarget): BlueprintLayerTemplate[] {
    let counter = 0;
    const probeId = () => `probe-${(counter += 1)}`;
    return BLUEPRINT_LAYER_TEMPLATES.filter(template => buildBlueprintLayerTemplate(template, target, probeId) !== null);
}

function ownerFieldsOf(owner: BlueprintOwnerRef): Record<string, string> {
    const carried = owner as unknown as Record<string, unknown>;
    const fields: Record<string, string> = {};
    for (const field of BLUEPRINT_OWNER_GRAMMAR[owner.kind]) {
        const value = carried[field.prop];
        if (typeof value === "string" && value.length > 0) {
            fields[field.prop] = value;
        }
    }
    return fields;
}

function isUnset(value: unknown): boolean {
    return value === undefined || value === null || (typeof value === "string" && value.trim().length === 0);
}
