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
    type StoryBlockId,
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
 * player can take. One caller wants the other reading and says so: the story flow map draws what the
 * author wrote, disabled rows included, and `includeDisabled` is how it asks. It is a parameter
 * rather than a second implementation because these two answers must be able to differ *only* here.
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
 *
 * A node names its scene either on itself (the picker) or through its pins, from a value the graph
 * hands it - a recollection list replays whichever row the player clicked. This module reads only
 * the first. A caller that can follow a wired value to where the project wrote it down passes a
 * {@link StartStoryTargetReader}; without one, every such node is undecidable.
 */

/**
 * One graph in one blueprint, flattened so callers with different blueprint containers agree.
 *
 * The main process holds loaded `Blueprint` objects, lint holds a `BlueprintDocument`. Flattening
 * both to this shape is what lets one scan read both without either keeping a walk of its own.
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

/**
 * One `Start Story` node that named a scene, kept so a caller can say *which* node put a scene in.
 *
 * Beside {@link StoryEntryPointScan.byStory} rather than folded into it, because the two questions
 * have different shapes: deciding what to keep wants a set, and explaining what was kept wants every
 * node that named it - two nodes can name the same scene, and a report that showed one of them would
 * be pointing at an arbitrary half of the reason.
 */
export type StoryEntrySite = {
    storyId: string;
    sceneId: StorySceneId;
    blueprintId: string;
    blueprintName?: string;
    graphKind: "event" | "function" | "macro";
    graphId: string;
    nodeId: string;
};

export type StoryEntryPointScan = {
    /** Scene ids play can begin at, per story id. Only scenes the story actually has. */
    byStory: Map<string, Set<StorySceneId>>;
    /** Every node behind an entry in {@link byStory}, in scan order. */
    sites: StoryEntrySite[];
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

/** One `Start Story` node, by where it sits. */
export type StartStoryNodeRef = {
    blueprintId: string;
    graphKind: "event" | "function" | "macro";
    graphId: string;
    nodeId: string;
};

/** A stable key for {@link StartStoryNodeRef}, for callers that keep answers per node. */
export function startStoryNodeKey(ref: StartStoryNodeRef): string {
    // A separator no id can contain, so two different nodes cannot collide into one key.
    return [ref.blueprintId, ref.graphKind, ref.graphId, ref.nodeId].join("\u0000");
}

/**
 * Every story and every scene a node's two targets can hold when it runs, each read from where the
 * project writes it down.
 *
 * Two independent lists rather than pairs: the node takes one value from each, and the scan pairs
 * them against the documents. A scene id only one story has pairs with that story alone, so the
 * cross product costs nothing in precision.
 */
export type StartStoryTargetReading = {
    storyIds: readonly string[];
    sceneIds: readonly string[];
};

/**
 * Reads the targets of a node whose picker does not settle them - a blank param, or a wired pin.
 *
 * Answers null when the value cannot be read: it is put together while the game runs, or it comes
 * from somewhere the reader does not follow. The node is then undecidable, exactly as it is when no
 * reader is passed at all - a reader can only ever settle a node, never unsettle one.
 */
export type StartStoryTargetReader = (node: StartStoryNodeRef) => StartStoryTargetReading | null;

/**
 * Every scene a `Start Story` node can begin play at, and every node whose target cannot be read.
 *
 * `storyHasScene` filters as the scan goes, so `byStory` only ever holds scenes that exist. Callers
 * that have not read the story documents yet pass a predicate that accepts everything; the seed
 * filter in {@link reachableSceneIds} drops a phantom id later anyway.
 *
 * **Without a reader, a target is undecidable when the param is blank OR the pin is wired.** The
 * param is the inspector's picker and the pin is a value only the running game has, and at execution
 * time a non-empty pin wins (see `resolveStartStoryTarget`). So a node carrying a stale picked scene
 * *and* a wired `sceneId` starts a scene the picker cannot name, however confident the stored param
 * looks - which is exactly the shape a data-driven launcher has, a recollection list that replays
 * whichever row the player clicked.
 *
 * **With a reader**, such a node is asked about instead, and every pairing of a story and a scene it
 * answers that a document has becomes an entry. The build sweep passes none: what it removes from a
 * package is decided in the main process, which holds loaded blueprints and nothing to follow a
 * wired value through, and the renderer's answer about the same package has to be the same answer.
 */
export function scanStoryEntryPoints(
    carriers: Iterable<BlueprintGraphCarrier>,
    storyHasScene: (storyId: string, sceneId: string) => boolean,
    readTarget?: StartStoryTargetReader,
): StoryEntryPointScan {
    const byStory = new Map<string, Set<StorySceneId>>();
    const sites: StoryEntrySite[] = [];
    const undecidable: UndecidableStoryEntry[] = [];

    const enter = (carrier: BlueprintGraphCarrier, nodeId: string, storyId: string, sceneId: string): void => {
        if (!storyHasScene(storyId, sceneId)) {
            return;
        }
        const scenes = byStory.get(storyId);
        if (scenes) {
            scenes.add(sceneId);
        } else {
            byStory.set(storyId, new Set([sceneId]));
        }
        sites.push({
            storyId,
            sceneId,
            blueprintId: carrier.blueprintId,
            ...(carrier.blueprintName === undefined ? {} : { blueprintName: carrier.blueprintName }),
            graphKind: carrier.graphKind,
            graphId: carrier.graphId,
            nodeId,
        });
    };

    for (const carrier of carriers) {
        for (const node of Object.values(carrier.graph.nodes ?? {})) {
            if (!node || node.type !== BLUEPRINT_NODE_TYPE_GAME_START_STORY) {
                continue;
            }
            const missing = START_STORY_TARGET_PINS.filter(pin => !isTargetDecided(carrier.graph, node, pin));
            if (missing.length === 0) {
                enter(carrier, node.id, nodeStringParam(node, "storyId"), nodeStringParam(node, "sceneId"));
                continue;
            }
            const reading = readTarget?.({
                blueprintId: carrier.blueprintId,
                graphKind: carrier.graphKind,
                graphId: carrier.graphId,
                nodeId: node.id,
            });
            if (!reading) {
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
            // Deduplicated first: a list whose rows all replay the same story would otherwise walk
            // the same pairing once per row.
            for (const storyId of new Set(reading.storyIds.map(id => id.trim()).filter(Boolean))) {
                for (const sceneId of new Set(reading.sceneIds.map(id => id.trim()).filter(Boolean))) {
                    enter(carrier, node.id, storyId, sceneId);
                }
            }
        }
    }

    return { byStory, sites, undecidable };
}

/**
 * Where play can begin in a whole project: each story's own `entrySceneId`, plus every scene a
 * blueprint's `Start Story` node names.
 *
 * Both halves are author intent rather than a guess, and "the first scene in document order" is
 * deliberately not among them - a project that simply never marked an entry would then have every
 * scene but one declared unreachable. A caller that wants that fallback asks for it by name; see
 * {@link StoryEntryFallback}.
 *
 * One function because the callers that ask must not be able to disagree. The project report tells
 * an author a scene is unreachable, the `reachable-endings` test tells them a path never finishes,
 * and a build sweep decides what to ship: two of those finding different entry points would mean
 * one of them is describing a project nobody has.
 *
 * `undecidable` is what a caller has to look at first. A `Start Story` node whose target only the
 * running game knows means no reachability claim can be made at all, and a check that reported
 * everything as unreachable because it could not find the entry is one an author switches off.
 * `readTarget` is how a caller that can follow a wired target settles such a node; see
 * {@link scanStoryEntryPoints}.
 */
export function scanProjectStoryEntryPoints(
    stories: readonly { id: string; document: StoryDocument }[],
    blueprintDocument: BlueprintDocument | null | undefined,
    readTarget?: StartStoryTargetReader,
): StoryEntryPointScan {
    const scan = scanStoryEntryPoints(
        blueprintDocumentGraphCarriers(blueprintDocument),
        (storyId, sceneId) => Boolean(stories.find(story => story.id === storyId)?.document.scenes[sceneId]),
        readTarget,
    );
    for (const entry of stories) {
        const entrySceneId = entry.document.entrySceneId;
        if (!entrySceneId || !entry.document.scenes[entrySceneId]) {
            continue;
        }
        const scenes = scan.byStory.get(entry.id);
        if (scenes) {
            scenes.add(entrySceneId);
        } else {
            scan.byStory.set(entry.id, new Set([entrySceneId]));
        }
    }
    return scan;
}

/** Why one scene is in the answer. The first reason the walk found, which is the shortest one. */
export type StorySceneReach =
    /** The scene the author marked as the story's entry. */
    | { kind: "entryScene" }
    /** The first scene in document order - what the game boots when nothing is marked. */
    | { kind: "documentOrder" }
    /** Named from outside the document. Which node named it is the caller's to say; see {@link StoryEntrySite}. */
    | { kind: "external" }
    /** A jump the runtime can take, from a scene that is itself in the answer. */
    | { kind: "jump"; fromSceneId: StorySceneId; blockId: StoryBlockId };

/**
 * Every scene the story can be in, and why each one is in.
 *
 * One walk answers both, deliberately. What a build keeps and what a report says it kept have to be
 * the same set for the same stated reasons; computing the explanation separately would let a package
 * drop a scene the console had just finished justifying.
 *
 * The reason recorded is the first one the walk finds, which is the shortest route in - a scene
 * reached from the entry in two hops and also named by a `Start Story` node reports the hop it was
 * discovered by. Every reason it records is a live route, so any of them answers "why is this here".
 *
 * Conservative in exactly one direction, because the two mistakes are not comparable: keeping an
 * unreachable scene costs bytes, while dropping a reachable one ships a game that stops dead when a
 * player walks into the gap. So this follows only edges it can read, and a caller that cannot read
 * every way into a scene must not ask at all.
 */
export function traceReachableScenes(
    document: StoryDocument,
    options: {
        entrySceneIds?: Iterable<StorySceneId>;
        fallback: StoryEntryFallback;
        /**
         * Follow jumps the compiler would drop.
         *
         * Off for everything that decides what ships or what to report as orphaned - a disabled row
         * cannot run, so a scene only it reaches is not reachable. On for the story flow map, which
         * is a drawing of the document rather than a prediction about the package: an author who
         * disabled a jump for the afternoon has not deleted the branch, and a map that greyed out
         * half the story the moment they did would be answering a question nobody asked.
         */
        includeDisabled?: boolean;
    },
): Map<StorySceneId, StorySceneReach> {
    const reached = new Map<StorySceneId, StorySceneReach>();
    const queue: StorySceneId[] = [];
    // Seeds are filtered like edges are: a caller that names a scene of another story - or one this
    // variant has already cut - must not put an id in the result that the document cannot back.
    const enter = (sceneId: StorySceneId | undefined, reach: StorySceneReach): void => {
        if (!sceneId || reached.has(sceneId) || !document.scenes?.[sceneId]) {
            return;
        }
        reached.set(sceneId, reach);
        queue.push(sceneId);
    };

    if (document.entrySceneId && document.scenes?.[document.entrySceneId]) {
        enter(document.entrySceneId, { kind: "entryScene" });
    } else if (options.fallback === "documentOrder") {
        enter(listSceneIdsInDocumentOrder(document)[0], { kind: "documentOrder" });
    }
    for (const sceneId of options.entrySceneIds ?? []) {
        enter(sceneId, { kind: "external" });
    }

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const fromSceneId = queue[cursor];
        const scene = document.scenes[fromSceneId];
        const blocks = options.includeDisabled
            ? listSceneBlocksInDocumentOrder(scene)
            : listSceneBlocksInDocumentOrder(scene, { skipSubtree: block => Boolean(block.disabled) });
        for (const block of blocks) {
            if (block.kind === "jump") {
                enter(block.payload.targetSceneId, { kind: "jump", fromSceneId, blockId: block.id });
            }
        }
    }
    return reached;
}

/** {@link traceReachableScenes} without the reasons, for callers that only decide keep or drop. */
export function reachableSceneIds(
    document: StoryDocument,
    options: {
        entrySceneIds?: Iterable<StorySceneId>;
        fallback: StoryEntryFallback;
        includeDisabled?: boolean;
    },
): Set<StorySceneId> {
    return new Set(traceReachableScenes(document, options).keys());
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
    const graphs = blueprint.graphs;
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
            // A script layer has no graph to scan: what it starts is in the author's own file,
            // which is why a blueprint holding one stops the scene sweep outright rather than being
            // read as a layer that starts nothing.
            if ((slot as { script?: unknown } | undefined)?.script) {
                continue;
            }
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
