/**
 * The keys that move the dialogue box on move the NVL page on too, when the engine draws that page.
 *
 * A story reads on with the keys because the project's dialogue box answers an action - the starter
 * project's Advance, bound to a click, Space and Enter - with `Next`, and the stage hands the box its
 * keys while the story is on screen (see `keyboardOwner`). An NVL passage takes the dialogue box off
 * the stage. A project that draws its own NVL page puts a surface there in its place, which answers
 * its own actions the same way; a project that does not - the starter among them - gets the engine's
 * page, which is not a surface and answers no action. It does read on with a click, because the
 * engine listens for clicks on the stage itself. It did not read on with a key: the engine's own
 * advance key is turned off in every game so that the project's actions decide what a key does (see
 * `createNlrGameWithGameUi`), and nothing took its place. A reader who had pressed Space through the
 * whole of a scene found it stop working the moment the scene went NVL.
 *
 * So while the engine's NVL page is up, it stands in for the dialogue box: a key bound to an action
 * the dialogue box answers with `Next` moves the page on, exactly as that key would have moved the box
 * on a line earlier. Which actions those are is read from the box's own graphs rather than assumed,
 * so an author who takes Enter off Advance, or answers Advance with something else, finds NVL doing
 * what the box does - and a project that answers Escape on the box with Hide does not have Escape
 * read on.
 *
 * Read from the graphs: an action head from which `Next` can be reached along the graph's edges. A
 * branch that only sometimes reaches `Next` counts, because pressing the key in ADV sometimes reads on
 * too. A script layer is not read - nothing can say what a file does without running it.
 *
 * Comments in English per project convention.
 */

import type { BlueprintDocument, BlueprintGraphIr } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_PARAM_INPUT_ACTION_ID,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION,
    BLUEPRINT_NODE_TYPE_GAME_NEXT,
} from "@shared/types/blueprint/graph";
import type { UIDocument, UIStageSlotId, UIStageSurface } from "@shared/types/ui-editor/document";

/** The stage's keyboard targets, as far as this module needs them. */
type StageKeyboardTarget = { surface: { kind: string; mount?: unknown } };

function slotSurface(document: UIDocument, slotId: UIStageSlotId): UIStageSurface | null {
    return document.surfaces.find((surface): surface is UIStageSurface =>
        surface.kind === "stageSurface" && surface.mount.slotId === slotId) ?? null;
}

/** Whether `Next` runs somewhere downstream of `headId`, following the graph's edges. */
function reachesNext(graph: BlueprintGraphIr, headId: string): boolean {
    const nodes = graph.nodes ?? {};
    const edges = graph.edges ?? [];
    const seen = new Set<string>();
    const queue = [headId];
    while (queue.length > 0) {
        const nodeId = queue.shift()!;
        if (seen.has(nodeId)) {
            continue;
        }
        seen.add(nodeId);
        if (nodes[nodeId]?.type === BLUEPRINT_NODE_TYPE_GAME_NEXT) {
            return true;
        }
        for (const edge of edges) {
            if (edge.from.nodeId === nodeId && nodes[edge.to.nodeId]) {
                queue.push(edge.to.nodeId);
            }
        }
    }
    return false;
}

/**
 * The actions the project's dialogue box answers by reading on: enabled on the dialogue slot surface,
 * and answered there by a graph that reaches `Next`. Empty when the project has no dialogue surface.
 */
export function resolveDialogueAdvanceActionIds(
    document: UIDocument,
    blueprintDocument: BlueprintDocument,
): ReadonlySet<string> {
    const dialogue = slotSurface(document, "dialog");
    const enabled = new Set((dialogue?.actions ?? []).map(enablement => enablement.actionId));
    const answered = new Set<string>();
    if (!dialogue || enabled.size === 0) {
        return answered;
    }
    for (const blueprint of Object.values(blueprintDocument.blueprints ?? {})) {
        if (blueprint.owner.kind !== "surfaceMain" || blueprint.owner.surfaceId !== dialogue.id) {
            continue;
        }
        for (const layer of Object.values(blueprint.graphs?.events ?? {})) {
            const graph = layer.graph;
            if (!graph) {
                continue;
            }
            for (const node of Object.values(graph.nodes ?? {})) {
                if (node.type !== BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION) {
                    continue;
                }
                const actionId = String(node.params?.[BLUEPRINT_NODE_PARAM_INPUT_ACTION_ID] ?? "").trim();
                if (enabled.has(actionId) && !answered.has(actionId) && reachesNext(graph, node.id)) {
                    answered.add(actionId);
                }
            }
        }
    }
    return answered;
}

/** Whether the project draws its NVL page itself, which then answers its own keys. */
export function projectDrawsNvlPage(document: UIDocument): boolean {
    return slotSurface(document, "nvl") !== null;
}

/** What the stage's keyboard owner carries for the engine's NVL page while it is up. */
export type EngineNvlKeys = {
    /** The actions whose keys read on: the dialogue box's, see {@link resolveDialogueAdvanceActionIds}. */
    actionIds: ReadonlySet<string>;
    /** Read on, as a click on the stage does. */
    advance: () => Promise<void> | void;
};

/**
 * The engine's NVL page as a keyboard target right now, or null when it is not one.
 *
 * It is one while the story is in NVL, the project draws no NVL page of its own, and nothing on the
 * stage is answering the keys for the dialogue - no dialogue box and no NVL surface among the stage's
 * keyboard targets. That last check keeps one press from reading on twice: should the box still be
 * registered for the instant a passage turns NVL, the box's own `Next` is the one that runs.
 */
export function resolveEngineNvlKeys(input: {
    nvlActive: boolean;
    projectDrawsNvlPage: boolean;
    stage: readonly StageKeyboardTarget[];
    actionIds: ReadonlySet<string>;
    advance: () => Promise<void> | void;
}): EngineNvlKeys | null {
    if (!input.nvlActive || input.projectDrawsNvlPage || input.actionIds.size === 0) {
        return null;
    }
    const dialogueOnStage = input.stage.some(({ surface }) => {
        const slotId = (surface.mount as { slotId?: unknown } | undefined)?.slotId;
        return surface.kind === "stageSurface" && (slotId === "dialog" || slotId === "nvl");
    });
    return dialogueOnStage ? null : { actionIds: input.actionIds, advance: input.advance };
}
