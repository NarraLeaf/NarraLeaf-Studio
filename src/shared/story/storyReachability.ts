import type {
    Blueprint,
    BlueprintDocument,
    BlueprintGraphIr,
    BlueprintGraphNode,
} from "@shared/types/blueprint/document";
import { BLUEPRINT_NODE_TYPE_GAME_START_STORY } from "@shared/types/blueprint/graph";
import {
    listSceneBlocksInDocumentOrder,
    listSceneIdsInDocumentOrder,
    type StoryDocument,
    type StorySceneId,
} from "@shared/types/story";

/**
 * Which scenes a story can reach, and where play can begin. One implementation of each, for every
 * process that asks.
 *
 * This lives in `shared` because the two callers that matter are in different processes and their
 * answers have to be the same answer. The main process asks {@link scanStoryEntryPoints} which
 * scenes a variant's package may drop; the renderer asks it whether to tell the author a scene is
 * unreachable - and soon whether a build may start at all. A refusal that disagreed with a removal
 * would be worse than either: the author would be told the story is whole while the package on disk
 * had a hole in it, or told a scene is orphaned while the build kept shipping it.
 *
 * # The walk
 *
 * A `jump` row's `targetSceneId` is the only edge. It is the only construct in a story document that
 * names a scene, and a `/goto` addresses a label inside the scene it is already in.
 *
 * A disabled subtree is not walked. The compiler drops a disabled row before it emits anything, so
 * such a jump provably cannot run - following it would mark a scene reachable through an edge no
 * player can take.
 *
 * A target the document does not have is not followed and never enters the set. Callers use the
 * result to decide what to delete and what to report, and a phantom id in it would mean both.
 *
 * # Where play begins
 *
 * Two sources, and both are author intent rather than a guess: the scene an author marked as a
 * story's entry (`StoryDocument.entrySceneId`), and every scene a blueprint's `Start Story` node
 * names. What happens when neither exists is the caller's to decide - see {@link StoryEntryFallback},
 * where the two policies are spelled out and why they differ.
 */

/**
 * One graph in one blueprint, flattened so callers with different blueprint containers agree.
 *
 * The main process holds loaded `Blueprint` objects (a project's own plus every shared blueprint
 * asset), lint holds a `BlueprintDocument`. Flattening both to this shape is what lets one scan read
 * both without either keeping a walk of its own.
 */
export type BlueprintGraphCarrier = {
    blueprintId: string;
    blueprintName?: string;
    graphKind: "event" | "function" | "macro";
    graphId: string;
    graph: BlueprintGraphIr;
};

/** One `Start Story` node whose target the build cannot read. */
export type UndecidableStoryEntry = {
    blueprintId: string;
    blueprintName?: string;
    graphKind: "event" | "function" | "macro";
    graphId: string;
    nodeId: string;
    /** Which of the node's targets could not be read. */
    missing: ("storyId" | "sceneId")[];
};

export type StoryEntryPointScan = {
    /** Scene ids play can begin at, per story id. Only scenes the story actually has. */
    byStory: Map<string, Set<StorySceneId>>;
    /** Empty when every entry could be read. Non-empty means no reachability claim can be made. */
    undecidable: UndecidableStoryEntry[];
};

/**
 * Where a story is entered when nothing names a scene.
 *
 * The two values are the two policies in the product, and they are not interchangeable. Both honour
 * `StoryDocument.entrySceneId` when it names a scene the document has; they differ only in what an
 * unmarked story means.
 */
export type StoryEntryFallback =
    /**
     * The first scene in document order, which is what the game boots - the same fallback
     * `resolveDefaultLaunchScene` takes at startup. A build sweep has to assume it: a project that
     * never marked an entry would otherwise have its opening scene swept out of the package.
     */
    | "documentOrder"
    /**
     * Nothing. A project that never marked an entry then makes no claim at all, which is what a
     * report wants: a rule that flagged every scene in the story because it could not find the entry
     * is worse than no rule, and an author switches it off in the first five minutes.
     */
    | "none";

/** The two `Start Story` targets that decide which scene play begins at. */
const START_STORY_TARGET_PINS = ["storyId", "sceneId"] as const;

/**
 * Every scene a `Start Story` node can begin play at, and every node whose target cannot be read.
 *
 * `storyHasScene` filters as the scan goes, so `byStory` only ever holds scenes that exist. Callers
 * that have not read the story documents yet pass a predicate that accepts everything; the seed
 * filter in {@link reachableSceneIds} drops a phantom id later anyway.
 *
 * **A target is undecidable when the param is blank OR the pin is wired.** The param is the
 * inspector's picker and the pin is a value only the running game has, and at execution time the pin
 * wins (see `resolveStartStoryTarget`). So a node carrying a stale picked scene *and* a wired
 * `sceneId` starts a scene this scan cannot name, however confident the stored param looks - which
 * is exactly the shape a data-driven launcher has, a recollection list that replays whichever row
 * the player clicked.
 */
export function scanStoryEntryPoints(
    carriers: Iterable<BlueprintGraphCarrier>,
    storyHasScene: (storyId: string, sceneId: string) => boolean,
): StoryEntryPointScan {
    const byStory = new Map<string, Set<StorySceneId>>();
    const undecidable: UndecidableStoryEntry[] = [];

    for (const carrier of carriers) {
        for (const node of Object.values(carrier.graph.nodes ?? {})) {
            if (!node || node.type !== BLUEPRINT_NODE_TYPE_GAME_START_STORY) {
                continue;
            }
            const missing = START_STORY_TARGET_PINS.filter(pin => !isTargetDecided(carrier.graph, node, pin));
            if (missing.length > 0) {
                undecidable.push({
                    blueprintId: carrier.blueprintId,
                    ...(carrier.blueprintName === undefined ? {} : { blueprintName: carrier.blueprintName }),
                    graphKind: carrier.graphKind,
                    graphId: carrier.graphId,
                    nodeId: node.id,
                    missing: [...missing],
                });
                continue;
            }
            const storyId = nodeStringParam(node, "storyId");
            const sceneId = nodeStringParam(node, "sceneId");
            if (!storyHasScene(storyId, sceneId)) {
                continue;
            }
            const scenes = byStory.get(storyId);
            if (scenes) {
                scenes.add(sceneId);
            } else {
                byStory.set(storyId, new Set([sceneId]));
            }
        }
    }

    return { byStory, undecidable };
}

/**
 * Every scene the story can be in, from the scenes it can be entered at outwards.
 *
 * Conservative in exactly one direction, because the two mistakes are not comparable: keeping an
 * unreachable scene costs bytes, while dropping a reachable one ships a game that stops dead when a
 * player walks into the gap. So this follows only edges it can read, and a caller that cannot read
 * every way into a scene must not ask at all.
 */
export function reachableSceneIds(
    document: StoryDocument,
    options: { entrySceneIds?: Iterable<StorySceneId>; fallback: StoryEntryFallback },
): Set<StorySceneId> {
    const reachable = new Set<StorySceneId>();
    const queue: StorySceneId[] = [];
    // Seeds are filtered like edges are: a caller that names a scene of another story - or one this
    // variant has already cut - must not put an id in the result that the document cannot back.
    const enter = (sceneId: StorySceneId | undefined): void => {
        if (!sceneId || reachable.has(sceneId) || !document.scenes?.[sceneId]) {
            return;
        }
        reachable.add(sceneId);
        queue.push(sceneId);
    };

    if (document.entrySceneId && document.scenes?.[document.entrySceneId]) {
        enter(document.entrySceneId);
    } else if (options.fallback === "documentOrder") {
        enter(listSceneIdsInDocumentOrder(document)[0]);
    }
    for (const sceneId of options.entrySceneIds ?? []) {
        enter(sceneId);
    }

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const scene = document.scenes[queue[cursor]];
        const blocks = listSceneBlocksInDocumentOrder(scene, { skipSubtree: block => Boolean(block.disabled) });
        for (const block of blocks) {
            if (block.kind === "jump") {
                enter(block.payload.targetSceneId);
            }
        }
    }
    return reachable;
}

/** Every graph a loaded blueprint carries, as carriers. */
export function* blueprintGraphCarriers(blueprints: Iterable<Blueprint>): Generator<BlueprintGraphCarrier> {
    for (const blueprint of blueprints) {
        yield* carriersOf(blueprint);
    }
}

/**
 * Every graph a blueprint document carries, as carriers.
 *
 * **Every blueprint in the record, owner records ignored** - deliberately unlike
 * `listBlueprintGraphSites`, which skips a blueprint no owner record points at. That skip is right
 * for a report: an unlisted blueprint cannot be dispatched, so a finding against it would be a
 * defect the player can never meet, and the row would not navigate anywhere either.
 *
 * The entry scan has never made that assumption and must not start now. It answers "can this scene
 * be started", and the cost of the two mistakes is lopsided: reading one entry too many keeps a
 * scene that could have been dropped, while missing one drops a scene something still starts. An
 * owner record is also a renderer-side dispatch detail, and the main process reads loaded
 * blueprints where no such record travels - so honouring it here would make the two processes
 * disagree about the same project.
 */
export function* blueprintDocumentGraphCarriers(
    document: BlueprintDocument | null | undefined,
): Generator<BlueprintGraphCarrier> {
    for (const blueprint of Object.values(document?.blueprints ?? {})) {
        if (blueprint) {
            yield* carriersOf(blueprint);
        }
    }
}

function* carriersOf(blueprint: Blueprint): Generator<BlueprintGraphCarrier> {
    if (blueprint.program?.kind !== "graph") {
        return;
    }
    const graphs = blueprint.program.graphs;
    // Macros are walked though nothing populates `graphs.macros` today: a node buried in one would
    // ship exactly like a node on an event, and costing nothing while the record is empty is the
    // cheapest way to not be the walker that forgot.
    const slots: readonly { graphKind: BlueprintGraphCarrier["graphKind"]; entries: Record<string, { graph?: BlueprintGraphIr } | undefined> }[] = [
        { graphKind: "event", entries: graphs.events ?? {} },
        { graphKind: "function", entries: graphs.functions ?? {} },
        { graphKind: "macro", entries: graphs.macros ?? {} },
    ];
    for (const { graphKind, entries } of slots) {
        for (const [graphId, slot] of Object.entries(entries)) {
            yield {
                blueprintId: blueprint.id,
                ...(blueprint.name === undefined ? {} : { blueprintName: blueprint.name }),
                graphKind,
                graphId,
                graph: slot?.graph ?? {},
            };
        }
    }
}

/** A target is decided only when a non-blank param is the value the running game will use. */
function isTargetDecided(graph: BlueprintGraphIr, node: BlueprintGraphNode, pinId: string): boolean {
    if (!nodeStringParam(node, pinId)) {
        return false;
    }
    return !(graph.edges ?? []).some(edge => edge.to.nodeId === node.id && edge.to.port === pinId);
}

function nodeStringParam(node: BlueprintGraphNode, key: string): string {
    const value = node.params?.[key];
    return typeof value === "string" ? value.trim() : "";
}
