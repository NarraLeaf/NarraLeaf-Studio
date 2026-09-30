/**
 * Taking one blueprint out of a project.
 *
 * `apply` can empty a blueprint but not remove it, and `ui apply` can drop the element a blueprint
 * hangs off but, owning only the interface document, leaves the blueprint behind with an owner
 * nothing points at. This is the other half: the record goes, and so does the owner entry that
 * pointed at it.
 *
 * **Only the kinds Studio itself collects.** A widget's, a component element's and a value binding's
 * blueprint are dropped by the editor when the thing they hang off goes, so dropping one here leaves
 * the document in a shape the editor also produces. The game's blueprint and a surface's are made
 * for every project and every surface and put back when missing, and a story action's is named by a
 * story row this tool cannot see - removing one of those is refused rather than half done.
 *
 * **Nothing may still name it.** A variable another blueprint reads is spelled `bp:<id>:<variable>`
 * and a Fn another blueprint calls `fn:<id>:<fn>`, and a prop bound to a value blueprint names it by
 * id. Removing the blueprint under any of those leaves a node that reads nothing or a prop that shows
 * nothing, with no error anywhere, so each one is a refusal that says where it is.
 *
 * Comments in English per project convention.
 */

import type { Blueprint, BlueprintDocument, BlueprintOwnerRef } from "@shared/types/blueprint/document";

/** The owner kinds whose blueprint the editor drops along with the thing it hangs off. */
const REMOVABLE_OWNER_KINDS: ReadonlySet<BlueprintOwnerRef["kind"]> = new Set([
    "widgetMain",
    "componentWidgetMain",
    "widgetValue",
]);

const WHY_NOT_REMOVABLE: Partial<Record<BlueprintOwnerRef["kind"], string>> = {
    globalMain: "it is the game's own blueprint, and every project has exactly one",
    surfaceMain: "Studio gives every surface one and puts it back when it is missing",
    storyAction: "a story row runs it, and this tool cannot see story rows",
};

/** The slice of an interface element this needs: its name, and what its props are bound to. */
export type RemovalElement = {
    name?: string;
    valueBindings?: Record<string, { kind?: string; blueprintId?: string } | undefined>;
};

export type BlueprintRemovalPlan = {
    /** Owner entries that point at the blueprint and go with it. */
    ownerKeys: string[];
    /** Why it cannot be removed; empty when it can. */
    refusals: string[];
};

export function planBlueprintRemoval(
    document: BlueprintDocument,
    blueprint: Blueprint,
    elements: Readonly<Record<string, RemovalElement>>,
): BlueprintRemovalPlan {
    const refusals: string[] = [];
    const kind = blueprint.owner.kind;
    if (!REMOVABLE_OWNER_KINDS.has(kind)) {
        refusals.push(
            `"${blueprint.name}" is a ${kind} blueprint: ${WHY_NOT_REMOVABLE[kind] ?? "only a widget's, a component "
                + "element's or a value binding's blueprint is removed this way"}. Empty it with \`apply\` instead.`,
        );
    }

    for (const other of Object.values(document.blueprints)) {
        if (other.id === blueprint.id) {
            continue;
        }
        const naming = nodesNaming(other, blueprint.id);
        if (naming.length > 0) {
            refusals.push(
                `"${other.name}" still names it, in ${naming.map(node => `"${node}"`).join(", ")}: `
                    + "a variable it reads or a Fn it calls would read nothing.",
            );
        } else if (JSON.stringify(other).includes(blueprint.id)) {
            refusals.push(`"${other.name}" still names it.`);
        }
    }

    for (const [elementId, element] of Object.entries(elements)) {
        for (const [prop, binding] of Object.entries(element.valueBindings ?? {})) {
            if (binding?.kind === "blueprintValue" && binding.blueprintId === blueprint.id) {
                refusals.push(
                    `"${element.name ?? elementId}" binds ${prop} to it, and would show nothing. `
                        + "Unbind the prop with `ui apply` first.",
                );
            }
        }
    }

    const ownerKeys = Object.entries(document.ownerRecords)
        .filter(([, record]) => record.blueprintId === blueprint.id)
        .map(([key]) => key);
    return { ownerKeys, refusals };
}

/** Take the blueprint and its owner entries out. Call only with a plan that has no refusals. */
export function removeBlueprint(document: BlueprintDocument, blueprint: Blueprint, plan: BlueprintRemovalPlan): void {
    delete document.blueprints[blueprint.id];
    for (const key of plan.ownerKeys) {
        delete document.ownerRecords[key];
    }
}

/** The ids of the nodes in one blueprint whose params mention another blueprint's id. */
function nodesNaming(blueprint: Blueprint, id: string): string[] {
    const out: string[] = [];
    for (const pool of [blueprint.graphs.events, blueprint.graphs.functions, blueprint.graphs.macros]) {
        for (const entry of Object.values(pool ?? {})) {
            for (const node of Object.values(entry.graph?.nodes ?? {})) {
                if (JSON.stringify(node.params ?? {}).includes(id)) {
                    out.push(node.id);
                }
            }
        }
    }
    return out;
}
