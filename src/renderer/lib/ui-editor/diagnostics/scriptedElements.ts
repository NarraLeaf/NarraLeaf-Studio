import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_NODE_TYPE_ELEMENT_REF } from "@shared/types/blueprint/graph";
import { readBlueprintElementRefParams } from "@/lib/ui-editor/blueprint-nodes/built-in/elementRefUtils";

/**
 * Which elements the project's blueprints change at runtime, as far as the documents can say.
 *
 * Several canvas checks judge an element by what it rests at in the editor - hidden, transparent,
 * no picture - and every one of them is wrong about an element a script changes. Tabs, viewers and
 * confirmation panels are built that way: hidden in the editor, shown by the button that opens
 * them, and given their picture by the press that opened them.
 *
 * Which node does the changing is deliberately not asked. Knowing that would take a list of every
 * node that writes visibility, opacity or a picture, and that list would fall behind the catalogue.
 * A blueprint that only reads the element costs a missed warning, which is the cheaper mistake.
 *
 * Only blueprints an owner record points at are walked: an unlisted one cannot run, so it cannot
 * change anything.
 */
export type ScriptedElements = {
    /**
     * Elements some blueprint names with an element literal. That literal is how a graph reaches a
     * widget other than its own owner, so every node that shows, fades or re-pictures another
     * element is wired from one.
     */
    named: ReadonlySet<string>;
    /**
     * Elements whose own blueprint runs something. Its nodes act on the element without naming it,
     * so this is the only trace of an image that sets its own picture. It says nothing about
     * visibility: every element with a click handler owns a blueprint, and a hidden one still
     * cannot be clicked.
     */
    runningOwnBlueprint: ReadonlySet<string>;
};

export function collectScriptedElements(blueprintDocument: BlueprintDocument | null | undefined): ScriptedElements {
    const named = new Set<string>();
    const runningOwnBlueprint = new Set<string>();
    for (const record of Object.values(blueprintDocument?.ownerRecords ?? {})) {
        const blueprint = record.blueprintId ? blueprintDocument?.blueprints?.[record.blueprintId] : undefined;
        if (!blueprint) {
            continue;
        }
        const owner = blueprint.owner;
        const ownElementId = owner.kind === "widgetMain" || owner.kind === "componentWidgetMain" ? owner.elementId : null;
        const events = Object.values(blueprint.graphs.events ?? {});
        // A script layer's handlers are functions with no nodes to read, so it is credited as running.
        if (ownElementId && events.some(layer => layer?.script || (layer?.graph?.edges?.length ?? 0) > 0)) {
            runningOwnBlueprint.add(ownElementId);
        }
        const layers = [
            ...events,
            ...Object.values(blueprint.graphs.functions ?? {}),
            ...Object.values(blueprint.graphs.macros ?? {}),
        ];
        for (const layer of layers) {
            for (const node of Object.values(layer?.graph?.nodes ?? {})) {
                if (node.type !== BLUEPRINT_NODE_TYPE_ELEMENT_REF) {
                    continue;
                }
                const ref = readBlueprintElementRefParams(node.params);
                if (ref) {
                    named.add(ref.elementId);
                }
            }
        }
    }
    return { named, runningOwnBlueprint };
}
