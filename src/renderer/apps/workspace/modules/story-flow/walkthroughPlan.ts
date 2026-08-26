/**
 * A route from where play begins to one ending, and the decisions it takes on the way.
 *
 * Static: this reads the document and answers before anything is launched. That is the point. A
 * headed playthrough that could never arrive is a minute of an author watching nothing, so "is this
 * ending reachable at all" has to be answerable without starting a game.
 *
 * The scene graph is not derived a second time here - {@link buildSceneFlowGraph} already decides
 * which jump leads where, which arm owns it, and which rows the compiler drops - so a route this
 * plans and the map the author is looking at cannot disagree about the story's shape.
 *
 * # What a decision is
 *
 * The index a plan carries is the **compiler's** index: an option's position among the non-disabled
 * `choiceOption` children of its choice, in document order, which is exactly the order `compileChoice`
 * feeds the engine's menu. It is neither the row's position on screen nor a block id. An option a
 * `hiddenWhen` condition hides at play time is left out of the display without shifting it, so the
 * two readings differ precisely when a condition fired - and that difference is a real finding about
 * the route rather than a defect of this walk.
 *
 * # What this deliberately does not model
 *
 * Conditions. A jump under an `if` is followed as written, because the author wrote that branch and
 * this cannot know what the variables will hold when a player gets there. A route that turns out not
 * to be walkable shows up where it becomes true - at play time, as the planned option missing from
 * the menu the game reported - and that is a more useful answer than a refusal to plan.
 *
 * For the same reason the decisions are the ones the route **depends on**: the choices whose options
 * contain the jump (or the ending row) the route needs. A choice the route merely passes has no
 * decision here, because whether it is passed at all depends on conditions this cannot evaluate.
 */

import {
    listSceneIdsInDocumentOrder,
    type StoryBlock,
    type StoryBlockId,
    type StoryDocument,
    type StoryNodeActionBlock,
    type StoryNodeActionPayload,
    type StoryScene,
    type StorySceneId,
} from "@shared/types/story";
import { findStoryEnding } from "@shared/types/story/endings";
import { buildSceneFlowGraph, type SceneFlowGraph, type SceneFlowJumpRef } from "./sceneFlowModel";

/** One choice the route depends on, and which option answers it. */
export type WalkthroughDecision = {
    /** The `choice` row that asks. */
    choiceBlockId: StoryBlockId;
    /** The `choiceOption` row to take - the ending's own identity convention: the row is the thing. */
    optionBlockId: StoryBlockId;
    /** What the game's `choose` takes. See the header: the compiler's index, not the screen's. */
    optionIndex: number;
    /** The option's authored text, for the line a run logs and the finding a failure anchors on. */
    optionText: string;
    sceneId: StorySceneId;
    sceneName: string;
};

export type WalkthroughPlan = {
    /** Where the run starts. One of the scenes something in the project actually enters the story at. */
    entrySceneId: StorySceneId;
    /** Scenes the route passes, the entry first and the ending's scene last. */
    sceneIds: StorySceneId[];
    /** Every decision the route depends on, in the order a player meets them. */
    decisions: WalkthroughDecision[];
};

export type WalkthroughPlanFailure =
    /** The document has no ending with that id - it was deleted, or disabled, since it was picked. */
    | { reason: "endingMissing" }
    /** Nothing names a scene to begin at, so there is no "from" to walk from. */
    | { reason: "noEntryPoint" }
    /** No sequence of live jumps leads from any entry to the scene the ending is in. */
    | { reason: "unreachable" };

export type WalkthroughPlanResult =
    | { ok: true; plan: WalkthroughPlan }
    | { ok: false; failure: WalkthroughPlanFailure };

export type WalkthroughPlanInput = {
    /** The ending to walk to, by its row's block id. */
    endingId: string;
    /**
     * Scenes named from *outside* the document - `scanStoryEntryPoints` over the project's
     * blueprints, which is the same scan the lint rules read, so nothing can disagree about where a
     * story starts.
     *
     * The scene the author marked on the document is not passed in and does not need to be: it is
     * read here, exactly as `traceReachableScenes` reads it, so the two halves of "where does play
     * begin" cannot come apart. Ids the document does not have are dropped.
     */
    entrySceneIds: Iterable<StorySceneId>;
};

/** One hop of the walk: the jump taken, and the scene it lands in. */
type WalkthroughHop = {
    fromSceneId: StorySceneId;
    jumpBlockId: StoryBlockId;
};

export function planWalkthrough(
    document: StoryDocument,
    input: WalkthroughPlanInput,
): WalkthroughPlanResult {
    const ending = findStoryEnding(document, input.endingId);
    if (!ending) {
        return { ok: false, failure: { reason: "endingMissing" } };
    }

    // Document order, deduplicated: two blueprints naming the same scene are one place to start, and
    // a stable order is what makes the same project plan the same route twice.
    const declared = new Set(input.entrySceneIds);
    if (document.entrySceneId) {
        declared.add(document.entrySceneId);
    }
    const entrySceneIds = listSceneIdsInDocumentOrder(document).filter(sceneId => declared.has(sceneId));
    if (entrySceneIds.length === 0) {
        return { ok: false, failure: { reason: "noEntryPoint" } };
    }

    const graph = buildSceneFlowGraph(document);
    const route = findRoute(graph, entrySceneIds, ending.sceneId);
    if (!route) {
        return { ok: false, failure: { reason: "unreachable" } };
    }

    const decisions: WalkthroughDecision[] = [];
    for (const hop of route.hops) {
        const scene = document.scenes[hop.fromSceneId];
        const forHop = scene ? choiceDecisionsFor(scene, hop.jumpBlockId) : null;
        if (!forHop) {
            // An option on the route is switched off, so the compiler dropped the branch the jump
            // sits in. The map and the walk agree on that, and there is no route after all.
            return { ok: false, failure: { reason: "unreachable" } };
        }
        decisions.push(...forHop);
    }
    const endingScene = document.scenes[ending.sceneId];
    const forEnding = endingScene ? choiceDecisionsFor(endingScene, ending.endingId) : null;
    if (!forEnding) {
        return { ok: false, failure: { reason: "unreachable" } };
    }
    decisions.push(...forEnding);

    return {
        ok: true,
        plan: {
            entrySceneId: route.entrySceneId,
            sceneIds: [route.entrySceneId, ...route.hops.map(hop => sceneAfter(graph, hop))],
            decisions,
        },
    };
}

/** The scene a hop lands in. Read off the graph's own edge so the walk and the map cannot differ. */
function sceneAfter(graph: SceneFlowGraph, hop: WalkthroughHop): StorySceneId {
    const edge = graph.edges.find(candidate =>
        candidate.source === hop.fromSceneId && candidate.jumps.some(jump => jump.blockId === hop.jumpBlockId));
    return edge?.target ?? hop.fromSceneId;
}

/**
 * Breadth-first from every entry at once, so the route found is the shortest there is.
 *
 * Shortest matters for more than tidiness: every hop is scenes of dialogue a headed run has to play
 * through, and every decision on the way is one more thing a condition can invalidate. Among routes
 * of the same length the safer edge wins - see {@link outgoingHops}.
 */
function findRoute(
    graph: SceneFlowGraph,
    entrySceneIds: readonly StorySceneId[],
    targetSceneId: StorySceneId,
): { entrySceneId: StorySceneId; hops: WalkthroughHop[] } | null {
    const cameFrom = new Map<StorySceneId, WalkthroughHop>();
    const entryOf = new Map<StorySceneId, StorySceneId>();
    const queue: StorySceneId[] = [];
    for (const sceneId of entrySceneIds) {
        if (entryOf.has(sceneId)) {
            continue;
        }
        entryOf.set(sceneId, sceneId);
        queue.push(sceneId);
    }

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const sceneId = queue[cursor];
        if (sceneId === targetSceneId) {
            return { entrySceneId: entryOf.get(sceneId) ?? sceneId, hops: replay(cameFrom, sceneId) };
        }
        for (const { hop, target } of outgoingHops(graph, sceneId)) {
            if (entryOf.has(target)) {
                continue;
            }
            entryOf.set(target, entryOf.get(sceneId) ?? sceneId);
            cameFrom.set(target, hop);
            queue.push(target);
        }
    }
    return null;
}

/** Walk the arrival record back to the entry, then read it forwards. */
function replay(cameFrom: Map<StorySceneId, WalkthroughHop>, sceneId: StorySceneId): WalkthroughHop[] {
    const hops: WalkthroughHop[] = [];
    let current: StorySceneId | undefined = sceneId;
    const seen = new Set<StorySceneId>();
    while (current && !seen.has(current)) {
        seen.add(current);
        const hop: WalkthroughHop | undefined = cameFrom.get(current);
        if (!hop) {
            break;
        }
        hops.push(hop);
        current = hop.fromSceneId;
    }
    return hops.reverse();
}

/**
 * Every live jump out of one scene, safest first.
 *
 * A jump the compiler drops is not a way out at all, so disabled ones are gone. What is left is
 * ordered so that an unconditional jump beats a branched one: both reach the same scene in one hop,
 * and the unconditional one is the one that cannot be taken away by a variable's value at play time.
 * Everything else keeps the document order the map reads in.
 *
 * A returnable jump is here too, and belongs here: this walk answers "how does a run get into that
 * scene", and a call gets into it. That the run comes back afterwards is what the route does not
 * need to know - the route ends the moment the scene holding the ending is entered.
 */
function outgoingHops(
    graph: SceneFlowGraph,
    sceneId: StorySceneId,
): { hop: WalkthroughHop; target: StorySceneId }[] {
    const candidates: { hop: WalkthroughHop; target: StorySceneId; jump: SceneFlowJumpRef }[] = [];
    for (const edge of graph.edges) {
        if (edge.source !== sceneId) {
            continue;
        }
        for (const jump of edge.jumps) {
            if (jump.disabled) {
                continue;
            }
            candidates.push({
                hop: { fromSceneId: sceneId, jumpBlockId: jump.blockId },
                target: edge.target,
                jump,
            });
        }
    }
    return candidates
        .map((candidate, order) => ({ candidate, order }))
        .sort((left, right) =>
            Number(left.candidate.jump.conditional) - Number(right.candidate.jump.conditional)
            || left.order - right.order)
        .map(({ candidate }) => ({ hop: candidate.hop, target: candidate.target }));
}

/**
 * The choices standing between the top of a scene and one row inside it.
 *
 * The row's `choiceOption` ancestors, outermost first, which is the order a player answers them: an
 * option nested inside another is only offered once the outer one has been taken. `null` when a row
 * on that chain is switched off - the compiler drops the whole subtree, so the row cannot be reached
 * and there is no honest answer to give.
 */
export function choiceDecisionsFor(scene: StoryScene, targetBlockId: StoryBlockId): WalkthroughDecision[] | null {
    const decisions: WalkthroughDecision[] = [];
    const seen = new Set<StoryBlockId>();
    let node: StoryBlock | undefined = scene.blocks[targetBlockId];
    if (!node) {
        return null;
    }
    // A corrupted `parentId` cycle must not hang the picker that calls this.
    while (node && !seen.has(node.id)) {
        seen.add(node.id);
        if (node.disabled) {
            return null;
        }
        const parent: StoryBlock | undefined = node.parentId ? scene.blocks[node.parentId] : undefined;
        if (!parent) {
            break;
        }
        if (isChoiceOption(node) && isChoice(parent)) {
            const optionIndex = optionIndexOf(scene, parent, node.id);
            if (optionIndex < 0) {
                return null;
            }
            decisions.push({
                choiceBlockId: parent.id,
                optionBlockId: node.id,
                optionIndex,
                optionText: node.payload.text.value.trim(),
                sceneId: scene.id,
                sceneName: scene.name,
            });
        }
        node = parent;
    }
    return decisions.reverse();
}

/**
 * Where one option sits in the list the engine will be handed.
 *
 * The same filter and the same order `compileChoice` applies - non-disabled `choiceOption` children,
 * in `childrenIds` order - which is what makes this number the one `choose` takes. `-1` for an
 * option the compiler drops.
 */
function optionIndexOf(scene: StoryScene, choice: StoryChoiceBlock, optionBlockId: StoryBlockId): number {
    return choice.childrenIds
        .map(childId => scene.blocks[childId])
        .filter((child): child is StoryChoiceOptionBlock => isChoiceOption(child) && !child.disabled)
        .findIndex(child => child.id === optionBlockId);
}

/** The two rows a decision is made of, narrowed so the payload can be read. */
type StoryChoiceBlock = StoryNodeActionBlock & { payload: Extract<StoryNodeActionPayload, { action: "choice" }> };
type StoryChoiceOptionBlock = StoryNodeActionBlock & {
    payload: Extract<StoryNodeActionPayload, { action: "choiceOption" }>;
};

function isChoice(block: StoryBlock | undefined): block is StoryChoiceBlock {
    return block !== undefined && block.kind === "nodeAction" && block.payload.action === "choice";
}

function isChoiceOption(block: StoryBlock | undefined): block is StoryChoiceOptionBlock {
    return block !== undefined && block.kind === "nodeAction" && block.payload.action === "choiceOption";
}
