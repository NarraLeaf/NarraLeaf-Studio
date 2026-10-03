/**
 * Taking a component definition out of a project.
 *
 * `apply` replaces a component's element tree but never takes the definition away, so a component
 * nothing uses any more stayed in the library for good unless somebody deleted it in Studio. This is
 * the other half: the definition goes, with everything it owns - its elements, which live inside it,
 * and its blueprints in `uigraphs.json` together with the owner entries that point at them. Studio
 * collects those blueprints itself the next time it reconciles the two documents; doing it here leaves
 * no orphan for that pass to find, and a project closed after this edit is already in the shape Studio
 * would have left it in.
 *
 * **Only a definition nothing uses.** Studio lets an author delete a placed component after one
 * confirm, and every placement then draws nothing. That is a decision for someone looking at the
 * canvas; a command run from a script has nobody to ask, so anything still pointing at the definition
 * is a refusal that says where it is:
 *
 * - a placement of it, on any surface or inside another component;
 * - one of its own blueprints that holds anything - nodes, a script layer, members - because removing
 *   the definition would throw that work away with it, and emptying it first with `blueprint apply` is
 *   how an author says they meant to;
 * - any other blueprint, element or document-wide record that names the definition, one of its
 *   elements or one of its blueprints (an Element card pointing into the component, a variable read
 *   from one of its blueprints);
 * - any other project file that names one of those ids - the author's scripts, a story, a service
 *   table - which this module is handed as text rather than reading itself.
 *
 * Comments in English per project convention.
 */

import type { Blueprint, BlueprintDocument } from "@shared/types/blueprint/document";
import { decodeBlueprintOwnerKey } from "@shared/blueprint/ownerKey";
import {
    readUIComponentEditorSurfaceComponentId,
    readUIComponentSurfaceComponentId,
} from "@shared/types/ui-editor/componentInstanceKey";
import type { UIComponentDefinition, UIDocument, UIElement } from "@shared/types/ui-editor/document";
import { collectTree, elementPath } from "./project";

/** The code each reason a definition was not removed is reported under. */
export const REMOVE_REFUSED_CODE = "ui.remove_refused";

/** A project file other than the two interface documents, as text, by its path inside the project. */
export type ProjectTextFile = {
    path: string;
    text: string;
};

export type ComponentRemovalInput = {
    document: UIDocument;
    /** The project's blueprints; null when it has no `uigraphs.json`. */
    blueprints: BlueprintDocument | null;
    component: UIComponentDefinition;
    files?: readonly ProjectTextFile[];
};

export type ComponentRemovalPlan = {
    componentId: string;
    componentName: string;
    /** How many elements the definition holds, all of which go with it. */
    elementCount: number;
    /** The definition's own blueprints, which go with it. */
    blueprints: { id: string; name: string }[];
    /** Owner entries in `uigraphs.json` that go with them. */
    ownerKeys: string[];
    /** Why it cannot be removed; empty when it can. */
    refusals: string[];
};

/** Whether a blueprint hangs off the definition - off one of its elements, under either spelling. */
function isOwnedBy(blueprint: Blueprint, componentId: string): boolean {
    const owner = blueprint.owner as { kind: string; componentId?: string; surfaceId?: string };
    if (owner.kind === "componentWidgetMain") {
        return owner.componentId === componentId;
    }
    // A widget's or a value binding's blueprint written against the definition's own tree names it
    // by the surface the definition is drawn under. Studio does not write these today; one that
    // exists still belongs to nothing once the definition is gone.
    if (owner.kind === "widgetMain" || owner.kind === "widgetValue") {
        return readUIComponentSurfaceComponentId(owner.surfaceId) === componentId
            || readUIComponentEditorSurfaceComponentId(owner.surfaceId) === componentId;
    }
    return false;
}

/** What a blueprint holds, in words; empty when it holds nothing worth keeping. */
function describeContent(blueprint: Blueprint): string[] {
    let nodes = 0;
    let scripts = 0;
    for (const pool of [blueprint.graphs?.events, blueprint.graphs?.functions, blueprint.graphs?.macros]) {
        for (const layer of Object.values(pool ?? {})) {
            nodes += Object.keys(layer.graph?.nodes ?? {}).length;
            if ((layer as { script?: unknown }).script) {
                scripts += 1;
            }
        }
    }
    const variables = Object.keys(blueprint.members?.variables ?? {}).length;
    const functions = Object.keys(blueprint.members?.functions ?? {}).length;
    const bindings = Object.keys(blueprint.bindings ?? {}).length;
    const out: string[] = [];
    if (nodes > 0) out.push(`${nodes} node(s)`);
    if (scripts > 0) out.push(`${scripts} script layer(s)`);
    if (variables > 0) out.push(`${variables} variable(s)`);
    if (functions > 0) out.push(`${functions} Fn(s)`);
    if (bindings > 0) out.push(`${bindings} binding(s)`);
    return out;
}

/** The ids of the nodes in one blueprint whose params mention any of `needles`. */
function nodesNaming(blueprint: Blueprint, needles: readonly string[]): string[] {
    const out: string[] = [];
    for (const pool of [blueprint.graphs?.events, blueprint.graphs?.functions, blueprint.graphs?.macros]) {
        for (const layer of Object.values(pool ?? {})) {
            for (const node of Object.values(layer.graph?.nodes ?? {})) {
                const text = JSON.stringify(node.params ?? {});
                if (needles.some(needle => text.includes(needle))) {
                    out.push(node.id);
                }
            }
        }
    }
    return out;
}

function mentions(value: unknown, needles: readonly string[]): boolean {
    const text = JSON.stringify(value ?? null);
    return needles.some(needle => text.includes(needle));
}

/** The component link an element carries, linked or not: an unlinked record still names the definition. */
function linkedComponentId(element: UIElement): string | undefined {
    const link = element.extra?.componentLink as { componentId?: unknown } | undefined;
    return typeof link?.componentId === "string" ? link.componentId : undefined;
}

export function planComponentRemoval(input: ComponentRemovalInput): ComponentRemovalPlan {
    const { document, component } = input;
    const componentId = component.id;
    const refusals: string[] = [];
    const ownElementIds = Object.keys(component.elements ?? {});

    const owned = Object.values(input.blueprints?.blueprints ?? {}).filter(item => isOwnedBy(item, componentId));
    const ownedIds = owned.map(item => item.id);
    // What another record would have to contain to depend on this definition. Element ids are
    // UUIDs, so a substring hit on one is the id and not a coincidence.
    const needles = [componentId, ...ownElementIds, ...ownedIds];

    // Placements, and anything else in the document's own element map that names it.
    const visited = new Set<string>();
    for (const surface of document.surfaces) {
        for (const element of collectTree(document.elements, surface.rootElementId)) {
            visited.add(element.id);
            const where = `on "${surface.name}" as ${elementPath(document.elements, element)}`;
            if (linkedComponentId(element) === componentId) {
                refusals.push(`It is placed ${where}.`);
            } else if (mentions(element, needles)) {
                refusals.push(`The element ${where} names it.`);
            }
        }
    }
    for (const element of Object.values(document.elements)) {
        if (visited.has(element.id)) {
            continue;
        }
        // An element no surface reaches is drawn nowhere, but it is still in the document and would
        // point at nothing - so it is named rather than stepped over.
        const where = `as ${elementPath(document.elements, element)}, an element no surface holds`;
        if (linkedComponentId(element) === componentId) {
            refusals.push(`It is placed ${where}.`);
        } else if (mentions(element, needles)) {
            refusals.push(`The element ${where} names it.`);
        }
    }

    // Other definitions: a placement of this one inside them, or a record naming it.
    for (const other of document.components ?? []) {
        if (other.id === componentId) {
            continue;
        }
        const pool = other.elements ?? {};
        for (const element of Object.values(pool)) {
            const where = `inside the component "${other.name}" as ${elementPath(pool, element)}`;
            if (linkedComponentId(element) === componentId) {
                refusals.push(`It is placed ${where}.`);
            } else if (mentions(element, needles)) {
                refusals.push(`The element ${where} names it.`);
            }
        }
        if (mentions({ ...other, elements: undefined }, needles)) {
            refusals.push(`The component "${other.name}" names it.`);
        }
    }

    // Document-wide records: structs, actions, the entry pointer, the surfaces' own settings.
    for (const [key, value] of Object.entries(document)) {
        if (key !== "elements" && key !== "components" && mentions(value, needles)) {
            refusals.push(`The interface document names it in "${key}".`);
        }
    }

    // Its own blueprints go with it - but only empty ones, or the work in them goes too.
    for (const blueprint of owned) {
        const content = describeContent(blueprint);
        if (content.length > 0) {
            refusals.push(
                `Its blueprint "${blueprint.name}" is not empty: it holds ${content.join(", ")}. `
                    + "Empty it with `blueprint apply`, or take it out with `blueprint remove`, first if that work is meant to go.",
            );
        }
    }

    // Every other blueprint: an Element card pointing into the definition, a variable or Fn of one of
    // its blueprints, a value binding naming one.
    for (const other of Object.values(input.blueprints?.blueprints ?? {})) {
        if (ownedIds.includes(other.id)) {
            continue;
        }
        const naming = nodesNaming(other, needles);
        if (naming.length > 0) {
            refusals.push(`The blueprint "${other.name}" names it, in ${naming.map(node => `"${node}"`).join(", ")}.`);
        } else if (mentions({ members: other.members, bindings: other.bindings, owner: other.owner }, needles)) {
            refusals.push(`The blueprint "${other.name}" names it.`);
        }
    }

    for (const file of input.files ?? []) {
        if (needles.some(needle => file.text.includes(needle))) {
            refusals.push(`${file.path} names it.`);
        }
    }

    const ownerKeys = Object.entries(input.blueprints?.ownerRecords ?? {})
        .filter(([key, record]) => {
            if (ownedIds.includes(record.blueprintId)) {
                return true;
            }
            // An owner entry for one of its elements whose blueprint is already gone: nothing would
            // ever collect it once the definition is not there to be reconciled against.
            const owner = decodeBlueprintOwnerKey(key);
            return owner?.kind === "componentWidgetMain" && owner.componentId === componentId;
        })
        .map(([key]) => key);

    return {
        componentId,
        componentName: component.name,
        elementCount: ownElementIds.length,
        blueprints: owned.map(item => ({ id: item.id, name: item.name })),
        ownerKeys,
        refusals,
    };
}

/** Take the definition, its blueprints and their owner entries out. Call only with a plan that has no refusals. */
export function removeComponentDefinition(
    document: UIDocument,
    blueprints: BlueprintDocument | null,
    plan: ComponentRemovalPlan,
): void {
    document.components = (document.components ?? []).filter(component => component.id !== plan.componentId);
    if (!blueprints) {
        return;
    }
    for (const { id } of plan.blueprints) {
        delete blueprints.blueprints[id];
    }
    for (const key of plan.ownerKeys) {
        delete blueprints.ownerRecords[key];
    }
}

/** What a plan takes out, in one paragraph. */
export function describeComponentRemoval(plan: ComponentRemovalPlan): string {
    const blueprints = plan.blueprints.length > 0
        ? `${plan.blueprints.length} empty blueprint(s) (${plan.blueprints.map(item => `"${item.name}"`).join(", ")})`
        : "no blueprints";
    return `the component "${plan.componentName}" (${plan.componentId}): its ${plan.elementCount} element(s) and ${blueprints}`;
}
