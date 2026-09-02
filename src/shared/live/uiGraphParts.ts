import { encodeCanonicalJson } from "@shared/documents/canonicalJson";
import { fnv1a64BytesHex } from "@shared/utils/contentHash";
import type {
    Blueprint,
    BlueprintDocument,
    BlueprintEventGraph,
    BlueprintFunctionGraph,
    BlueprintGraphEdge,
    BlueprintGraphIndex,
    BlueprintGraphIr,
    BlueprintGraphNode,
    BlueprintPrivateOwnerRecord,
} from "@shared/types/blueprint/document";
import type { UIGraph, UIGraphDocument, UIGraphId } from "@shared/types/ui-editor/graph";

/**
 * The blueprint document as a set of records, which is what a live session can carry of it.
 *
 * ## Why records, and how fine they are
 *
 * `editor/ui/uigraphs.json` has the same shape of seam the interface document has and the same
 * answer. Every canvas gesture reaches the document through `LocalBlueprintService`'s
 * `updateEventGraphIr(blueprintId, graphId, updater)` or `updateFunctionGraphIr(...)`, and every
 * other blueprint edit through `applyBlueprintEdit({ blueprintId }, mutator)` - and in both the
 * mutator is an opaque closure. Below them all is one door, `UIGraphService.mutateDocument`. So what
 * the owning service can say truthfully at the point every edit passes through is *which records the
 * document now holds differently*, reached by running the mutator against a copy and comparing.
 *
 * The records are as fine as the message cap requires them to be, and that is not a compromise -
 * it is the same "one record" answer applied to a nested document:
 *
 *  - **one node** - the unit an author actually edits, and the one a claim is over. The largest node
 *    in the shipped skeleton is 286 bytes.
 *  - **one graph's edge list, whole** - a connection has no identity of its own beyond its two ends,
 *    and the order of the list is read by the executor, so a delta over individual wires would have
 *    to invent both. The largest edge list in the skeleton is 10.7 KB, which fits; a graph whose
 *    wiring will not fit in one message is refused by name rather than split.
 *  - **one graph slot's shell** - its name and metadata, without the IR.
 *  - **one blueprint's shell** - name, owner, members, bindings, and the two order lists, without
 *    the graphs. 498 bytes at the largest in the skeleton, against 25 KB for the whole blueprint.
 *  - **one owner record** - which private blueprint is active for a Surface or a widget.
 *
 * ⚠ **Nothing here is a gesture**, which is what makes it exhaustive: the blueprint editor writes
 * through a dozen entry points and none of them has to know a session exists.
 */

/** One graph slot's record with its IR taken off - its id, its name, its own metadata. */
export type LiveGraphSlotShell = Omit<BlueprintEventGraph, "graph"> & Omit<BlueprintFunctionGraph, "graph">;

/**
 * A blueprint's program with the graph bodies taken off.
 *
 * A script module has no body to take off: it holds the path of a file in `scripts/`, and that file
 * is not part of this document. A session shares the reference; the file itself travels the way any
 * other file in the project does.
 */
export type LiveBlueprintProgramShell =
    | { kind: "graph"; graphs: Omit<BlueprintGraphIndex, "events" | "functions"> }
    | { kind: "scriptModule"; scriptRef: string };

/** A blueprint's record without its graphs. See the note on {@link LiveUIGraphParts}. */
export type LiveBlueprintShell = Omit<Blueprint, "program"> & { program: LiveBlueprintProgramShell };

/** What changed inside one graph slot. Every field is absent when that part of it did not move. */
export type LiveGraphSlotDelta = {
    /** The slot's own record - name and metadata - without the IR. */
    slot?: LiveGraphSlotShell;
    /** Nodes by id. `null` is "removed". */
    nodes?: Readonly<Record<string, BlueprintGraphNode | null>>;
    /**
     * Every wire in the graph, in order.
     *
     * Whole rather than as a delta, and for two reasons that both have to hold: a wire's identity is
     * its two ends, so "the same wire, changed" is not a thing that can happen; and the list's order
     * is what decides which branch of a fan-out runs first, so a machine that appended where another
     * inserted would hold a graph that runs differently while agreeing about every wire in it.
     */
    edges?: readonly BlueprintGraphEdge[];
    /** The graph's own variable table, whole. */
    variables?: Readonly<Record<string, unknown>>;
    /** The IR's metadata - which kind of slot it is, and the editor's own notes. */
    irMeta?: Readonly<Record<string, unknown>>;
};

/** Which graph slots of one blueprint changed. `null` is "the slot is gone". */
export type LiveBlueprintGraphsDelta = {
    events?: Readonly<Record<string, LiveGraphSlotDelta | null>>;
    functions?: Readonly<Record<string, LiveGraphSlotDelta | null>>;
};

/**
 * Which records the blueprint document now holds differently, and which of them are gone.
 *
 * `null` is "removed", an absent key is "unchanged" - the interface delta's rule, for its reason.
 */
export type LiveUIGraphParts = {
    /** Blueprint records without their graphs. */
    blueprints?: Readonly<Record<string, LiveBlueprintShell | null>>;
    /** The graphs of one blueprint, by blueprint id. */
    graphs?: Readonly<Record<string, LiveBlueprintGraphsDelta>>;
    /** Which private blueprint is active for an owner slot, by owner key. */
    owners?: Readonly<Record<string, BlueprintPrivateOwnerRecord | null>>;
};

/** One node, and which graph of which blueprint it is in. */
export type LiveBlueprintNodeRef = {
    blueprintId: string;
    graphId: string;
    nodeId: string;
};

/* ------------------------------------------------------------------------ diff */

/** What changed between two states of the document, or null when nothing did. */
export function diffUIGraphParts(before: UIGraphDocument, after: UIGraphDocument): LiveUIGraphParts | null {
    const parts: LiveUIGraphParts = {};
    let changed = false;

    const blueprints = diffRecordMap(
        shellsOf(before.blueprintDocument),
        shellsOf(after.blueprintDocument),
    );
    if (blueprints) {
        parts.blueprints = blueprints;
        changed = true;
    }

    const graphs: Record<string, LiveBlueprintGraphsDelta> = {};
    for (const [blueprintId, blueprint] of Object.entries(after.blueprintDocument?.blueprints ?? {})) {
        const previous = before.blueprintDocument?.blueprints?.[blueprintId];
        const delta = diffGraphs(previous, blueprint);
        if (delta) {
            graphs[blueprintId] = delta;
        }
    }
    // Nothing is emitted for a blueprint that is gone: its graphs went with it, and naming them
    // would be a second statement of a removal the blueprint record already makes.
    if (Object.keys(graphs).length > 0) {
        parts.graphs = graphs;
        changed = true;
    }

    const owners = diffRecordMap(
        before.blueprintDocument?.ownerRecords ?? {},
        after.blueprintDocument?.ownerRecords ?? {},
    );
    if (owners) {
        parts.owners = owners;
        changed = true;
    }

    return changed ? parts : null;
}

function diffGraphs(before: Blueprint | undefined, after: Blueprint): LiveBlueprintGraphsDelta | null {
    if (after.program.kind !== "graph") {
        return null;
    }
    const previous = before?.program.kind === "graph" ? before.program.graphs : undefined;
    const delta: LiveBlueprintGraphsDelta = {};
    const events = diffSlots(previous?.events ?? {}, after.program.graphs.events ?? {});
    if (events) {
        delta.events = events;
    }
    const functions = diffSlots(previous?.functions ?? {}, after.program.graphs.functions ?? {});
    if (functions) {
        delta.functions = functions;
    }
    return delta.events || delta.functions ? delta : null;
}

function diffSlots(
    before: Readonly<Record<string, BlueprintEventGraph | BlueprintFunctionGraph>>,
    after: Readonly<Record<string, BlueprintEventGraph | BlueprintFunctionGraph>>,
): Record<string, LiveGraphSlotDelta | null> | null {
    const delta: Record<string, LiveGraphSlotDelta | null> = {};
    let changed = false;
    for (const [graphId, slot] of Object.entries(after)) {
        const previous = before[graphId];
        const slotDelta = diffSlot(previous, slot);
        if (slotDelta) {
            delta[graphId] = slotDelta;
            changed = true;
        }
    }
    for (const graphId of Object.keys(before)) {
        if (!Object.prototype.hasOwnProperty.call(after, graphId)) {
            delta[graphId] = null;
            changed = true;
        }
    }
    return changed ? delta : null;
}

function diffSlot(
    before: BlueprintEventGraph | BlueprintFunctionGraph | undefined,
    after: BlueprintEventGraph | BlueprintFunctionGraph,
): LiveGraphSlotDelta | null {
    const delta: LiveGraphSlotDelta = {};
    let changed = false;

    const beforeShell = before ? shellOfSlot(before) : undefined;
    const afterShell = shellOfSlot(after);
    if (!sameJsonValue(beforeShell, afterShell)) {
        delta.slot = afterShell;
        changed = true;
    }

    const beforeIr: BlueprintGraphIr = before?.graph ?? {};
    const afterIr: BlueprintGraphIr = after.graph ?? {};
    const nodes = diffRecordMap(beforeIr.nodes ?? {}, afterIr.nodes ?? {});
    if (nodes) {
        delta.nodes = nodes;
        changed = true;
    }
    if (!sameJsonValue(beforeIr.edges ?? [], afterIr.edges ?? [])) {
        delta.edges = afterIr.edges ?? [];
        changed = true;
    }
    if (!sameJsonValue(beforeIr.variables, afterIr.variables)) {
        delta.variables = afterIr.variables ?? {};
        changed = true;
    }
    if (!sameJsonValue(beforeIr.meta, afterIr.meta)) {
        delta.irMeta = afterIr.meta ?? {};
        changed = true;
    }
    return changed ? delta : null;
}

/* ----------------------------------------------------------------------- apply */

/**
 * Write one delta into the document, in place. The one applier both roles use.
 *
 * ⚠ **The blueprint shells are written first**, because a graph delta for a blueprint that has just
 * appeared has nowhere to go until its record is there.
 */
export function applyUIGraphParts(document: UIGraphDocument, parts: LiveUIGraphParts): void {
    const blueprintDocument = document.blueprintDocument;
    if (parts.blueprints) {
        for (const [blueprintId, shell] of Object.entries(parts.blueprints)) {
            if (shell === null) {
                delete blueprintDocument.blueprints[blueprintId];
                continue;
            }
            const previous = blueprintDocument.blueprints[blueprintId];
            blueprintDocument.blueprints[blueprintId] = mergeShell(previous, shell);
        }
    }
    if (parts.graphs) {
        for (const [blueprintId, delta] of Object.entries(parts.graphs)) {
            const blueprint = blueprintDocument.blueprints[blueprintId];
            if (!blueprint || blueprint.program.kind !== "graph") {
                // A delta naming a blueprint nobody has is applied as far as it can be rather than
                // thrown: an applier that threw would leave every machine holding half a message.
                continue;
            }
            applySlots(blueprint.program.graphs.events, delta.events);
            applySlots(blueprint.program.graphs.functions, delta.functions);
        }
    }
    if (parts.owners) {
        for (const [ownerKey, record] of Object.entries(parts.owners)) {
            if (record === null) {
                delete blueprintDocument.ownerRecords[ownerKey];
            } else {
                blueprintDocument.ownerRecords[ownerKey] = record;
            }
        }
    }
}

function applySlots(
    target: Record<string, BlueprintEventGraph> | Record<string, BlueprintFunctionGraph>,
    delta: Readonly<Record<string, LiveGraphSlotDelta | null>> | undefined,
): void {
    if (!delta) {
        return;
    }
    const slots = target as Record<string, BlueprintEventGraph>;
    for (const [graphId, slotDelta] of Object.entries(delta)) {
        if (slotDelta === null) {
            delete slots[graphId];
            continue;
        }
        const existing = slots[graphId];
        const slot: BlueprintEventGraph = existing
            ? { ...existing, ...(slotDelta.slot ?? {}) }
            : { ...(slotDelta.slot ?? { id: graphId }) };
        const ir: BlueprintGraphIr = { ...(existing?.graph ?? {}) };
        if (slotDelta.nodes) {
            const nodes: Record<string, BlueprintGraphNode> = { ...(ir.nodes ?? {}) };
            for (const [nodeId, node] of Object.entries(slotDelta.nodes)) {
                if (node === null) {
                    delete nodes[nodeId];
                } else {
                    nodes[nodeId] = node;
                }
            }
            ir.nodes = nodes;
        }
        if (slotDelta.edges) {
            ir.edges = [...slotDelta.edges];
        }
        if (slotDelta.variables) {
            ir.variables = slotDelta.variables as Record<string, unknown>;
        }
        if (slotDelta.irMeta) {
            ir.meta = slotDelta.irMeta as Record<string, unknown>;
        }
        slot.graph = ir;
        slots[graphId] = slot;
    }
}

/**
 * A shell written over whatever this machine already holds, keeping the graphs.
 *
 * The graphs are not in the shell - that is the whole point of it - so writing one straight over a
 * blueprint would empty it. A blueprint that has just appeared starts with none, which is right: its
 * graphs arrive in the same delta, under {@link LiveUIGraphParts.graphs}.
 */
function mergeShell(previous: Blueprint | undefined, shell: LiveBlueprintShell): Blueprint {
    if (shell.program.kind === "scriptModule") {
        return { ...shell, program: { kind: "scriptModule", scriptRef: shell.program.scriptRef } };
    }
    const held = previous?.program.kind === "graph" ? previous.program.graphs : undefined;
    return {
        ...shell,
        program: {
            kind: "graph",
            graphs: {
                ...shell.program.graphs,
                events: held?.events ?? {},
                functions: held?.functions ?? {},
            },
        },
    };
}

/* ---------------------------------------------------------------------- claims */

/**
 * Every node a delta writes or removes, in the order it names them.
 *
 * **A claim is over a node**, for the reason it is over an interface element: a node's parameter
 * editors keep a draft in their own state and reach the document on blur, so the loser of a race
 * loses what they were typing into one. A node's position is not worth a claim by itself and does
 * not get one - what gets claimed is the record, and a drag that writes it asks for the same claim a
 * parameter edit does, which refuses only the case where somebody has that node's editor open.
 *
 * The blueprint and the graph are both in the key: node ids are not unique across a document. The
 * seeded entry nodes use fixed ids - `global.appBoot` is in every project - so a key naming the node
 * alone would have every Surface's boot node claiming every other one.
 */
export function uiGraphPartsNodes(parts: LiveUIGraphParts): readonly LiveBlueprintNodeRef[] {
    const refs: LiveBlueprintNodeRef[] = [];
    for (const [blueprintId, delta] of Object.entries(parts.graphs ?? {})) {
        for (const slots of [delta.events, delta.functions]) {
            for (const [graphId, slotDelta] of Object.entries(slots ?? {})) {
                for (const nodeId of Object.keys(slotDelta?.nodes ?? {})) {
                    refs.push({ blueprintId, graphId, nodeId });
                }
            }
        }
    }
    return refs;
}

/**
 * The blueprints a delta CHANGES rather than creates, as the state it was computed against had them.
 *
 * The interface delta's `uiPartsUpdates`, one document along and one level coarser: a blueprint is
 * what an author has open, and a graph edit landing on a blueprint somebody deleted would put the
 * whole blueprint back rather than the one node. Coarser is right here because the applier already
 * skips a delta naming a blueprint nobody has - the question worth refusing is whether the author was
 * editing something that is no longer there, and that is asked of the blueprint.
 */
export function uiGraphPartsUpdates(before: UIGraphDocument, parts: LiveUIGraphParts): readonly string[] {
    const held = before.blueprintDocument?.blueprints ?? {};
    const updates = new Set<string>();
    for (const [blueprintId, shell] of Object.entries(parts.blueprints ?? {})) {
        if (shell !== null && held[blueprintId]) {
            updates.add(blueprintId);
        }
    }
    for (const blueprintId of Object.keys(parts.graphs ?? {})) {
        if (held[blueprintId]) {
            updates.add(blueprintId);
        }
    }
    return [...updates];
}

/**
 * The same records as this delta names, as the document holds them **now**. What an inverse is built
 * out of; see the interface delta's `uiPartsBefore` for the reasoning and for why everything is
 * copied.
 *
 * ⚠ **A slot the delta is removing is captured whole**, nodes, wires and all. Going down, the
 * removal is one word; coming back up, nothing anywhere else holds what was in it.
 */
export function uiGraphPartsBefore(document: UIGraphDocument, parts: LiveUIGraphParts): LiveUIGraphParts {
    const before: LiveUIGraphParts = {};
    const held = document.blueprintDocument?.blueprints ?? {};
    if (parts.blueprints) {
        const blueprints: Record<string, LiveBlueprintShell | null> = {};
        for (const blueprintId of Object.keys(parts.blueprints)) {
            const blueprint = held[blueprintId];
            blueprints[blueprintId] = blueprint ? copy(shellOfBlueprint(blueprint)) : null;
        }
        before.blueprints = blueprints;
    }
    const graphs: Record<string, LiveBlueprintGraphsDelta> = {};
    for (const [blueprintId, delta] of Object.entries(parts.graphs ?? {})) {
        const blueprint = held[blueprintId];
        const index = blueprint?.program.kind === "graph" ? blueprint.program.graphs : undefined;
        const captured: LiveBlueprintGraphsDelta = {};
        if (delta.events) {
            captured.events = slotsBefore(index?.events ?? {}, delta.events);
        }
        if (delta.functions) {
            captured.functions = slotsBefore(index?.functions ?? {}, delta.functions);
        }
        graphs[blueprintId] = captured;
    }
    // ⚠ **A blueprint the delta is removing is captured whole, every graph in it.** A shell travels
    // without its graphs - that is the whole point of it - so an inverse built from the shell alone
    // puts an empty blueprint back under the right name, which reads as the undo having worked. And
    // a delta never names the graphs of a blueprint it is removing: saying so would be a second
    // statement of the same removal.
    for (const [blueprintId, shell] of Object.entries(parts.blueprints ?? {})) {
        if (shell !== null || graphs[blueprintId]) {
            continue;
        }
        const blueprint = held[blueprintId];
        if (blueprint?.program.kind !== "graph") {
            continue;
        }
        const captured: LiveBlueprintGraphsDelta = {};
        const events = wholeSlots(blueprint.program.graphs.events ?? {});
        const functions = wholeSlots(blueprint.program.graphs.functions ?? {});
        if (Object.keys(events).length > 0) {
            captured.events = events;
        }
        if (Object.keys(functions).length > 0) {
            captured.functions = functions;
        }
        if (captured.events || captured.functions) {
            graphs[blueprintId] = captured;
        }
    }
    if (Object.keys(graphs).length > 0) {
        before.graphs = graphs;
    }
    if (parts.owners) {
        const owners: Record<string, BlueprintPrivateOwnerRecord | null> = {};
        for (const ownerKey of Object.keys(parts.owners)) {
            owners[ownerKey] = copy(document.blueprintDocument?.ownerRecords?.[ownerKey] ?? null);
        }
        before.owners = owners;
    }
    return before;
}

/** Every slot of one index, each captured whole. What a removed blueprint's inverse carries. */
function wholeSlots(
    held: Readonly<Record<string, BlueprintEventGraph | BlueprintFunctionGraph>>,
): Record<string, LiveGraphSlotDelta | null> {
    const captured: Record<string, LiveGraphSlotDelta | null> = {};
    for (const graphId of Object.keys(held)) {
        captured[graphId] = null;
    }
    // Asked for as removals, then answered as the whole slot: `slotsBefore` reads a `null` in the
    // forward delta as "this slot is going" and keeps everything that was in it, which is exactly
    // what a blueprint that is going needs of every one of its graphs.
    return slotsBefore(held, captured);
}

function slotsBefore(
    held: Readonly<Record<string, BlueprintEventGraph | BlueprintFunctionGraph>>,
    delta: Readonly<Record<string, LiveGraphSlotDelta | null>>,
): Record<string, LiveGraphSlotDelta | null> {
    const captured: Record<string, LiveGraphSlotDelta | null> = {};
    for (const [graphId, slotDelta] of Object.entries(delta)) {
        const slot = held[graphId];
        if (!slot) {
            captured[graphId] = null;
            continue;
        }
        const ir: BlueprintGraphIr = slot.graph ?? {};
        if (slotDelta === null) {
            // The whole slot is going. Everything in it has to come back, so everything is kept.
            const nodes: Record<string, BlueprintGraphNode | null> = {};
            for (const [nodeId, node] of Object.entries(ir.nodes ?? {})) {
                nodes[nodeId] = copy(node);
            }
            // ⚠ `variables` and `meta` only where the slot had them. Writing an empty table into a
            // graph that had none would put a record back that is not the record that was there -
            // and the difference would show up as a digest disagreement between the machine that
            // undid the deletion and the machine that had never seen it.
            captured[graphId] = {
                slot: copy(shellOfSlot(slot)),
                nodes,
                edges: copy(ir.edges ?? []),
                ...(ir.variables === undefined ? {} : { variables: copy(ir.variables) }),
                ...(ir.meta === undefined ? {} : { irMeta: copy(ir.meta) }),
            };
            continue;
        }
        const capturedSlot: LiveGraphSlotDelta = {};
        if (slotDelta.slot) {
            capturedSlot.slot = copy(shellOfSlot(slot));
        }
        if (slotDelta.nodes) {
            const nodes: Record<string, BlueprintGraphNode | null> = {};
            for (const nodeId of Object.keys(slotDelta.nodes)) {
                nodes[nodeId] = copy(ir.nodes?.[nodeId] ?? null);
            }
            capturedSlot.nodes = nodes;
        }
        if (slotDelta.edges) {
            capturedSlot.edges = copy(ir.edges ?? []);
        }
        if (slotDelta.variables) {
            capturedSlot.variables = copy(ir.variables ?? {});
        }
        if (slotDelta.irMeta) {
            capturedSlot.irMeta = copy(ir.meta ?? {});
        }
        captured[graphId] = capturedSlot;
    }
    return captured;
}

/**
 * Every blueprint a delta puts back rather than removes, which is what its own precondition names.
 * The inverse's counterpart to {@link uiGraphPartsUpdates}; see the interface delta's for why no
 * document is needed.
 */
export function uiGraphPartsRestored(parts: LiveUIGraphParts): readonly string[] {
    const restored = new Set<string>();
    for (const [blueprintId, shell] of Object.entries(parts.blueprints ?? {})) {
        if (shell !== null) {
            restored.add(blueprintId);
        }
    }
    for (const blueprintId of Object.keys(parts.graphs ?? {})) {
        // ⚠ Not one the delta is about to remove. A blueprint that was not there before the
        // operation is one the inverse takes away again, and demanding it be present would refuse
        // every undo of a creation.
        if (parts.blueprints?.[blueprintId] !== null) {
            restored.add(blueprintId);
        }
    }
    return [...restored];
}

function copy<T>(value: T): T {
    return value === null || value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** Whether one blueprint is in the document a delta would be applied to. What the host asks. */
export function uiHasBlueprint(document: UIGraphDocument | null, blueprintId: string): boolean {
    return Boolean(document?.blueprintDocument?.blueprints?.[blueprintId]);
}

/* --------------------------------------------------------------------- digests */

/**
 * Which units a delta changed.
 *
 * A blueprint is the unit, and the shell covers everything a blueprint does not: the owner records,
 * the legacy graphs, and which blueprints exist at all. Answered from the delta alone, unlike the
 * interface document's - a blueprint id is on every record here, so nothing has to be resolved
 * against a tree.
 */
export function uiGraphPartsTouched(
    parts: LiveUIGraphParts,
): { blueprints: readonly string[]; shell: boolean } {
    const blueprints = new Set<string>([
        ...Object.keys(parts.blueprints ?? {}),
        ...Object.keys(parts.graphs ?? {}),
    ]);
    return {
        blueprints: [...blueprints],
        shell: Boolean(parts.blueprints || parts.owners),
    };
}

/**
 * One blueprint, whole - its record and every graph in it.
 *
 * **Absence is a value rather than no digest**, with the interface Surface's and the cast's record:
 * deleting a blueprint is a thing an operation does, and a machine that failed to apply one has to be
 * caught rather than excused.
 */
export function uiBlueprintDigest(document: UIGraphDocument | null, blueprintId: string): string {
    const blueprint = document?.blueprintDocument?.blueprints?.[blueprintId] ?? null;
    return hash(blueprint === null ? { absent: true } : { blueprint: pruneUndefined(blueprint) });
}

/**
 * Everything about the blueprint document that no blueprint covers: the owner records and the set of
 * blueprint ids.
 *
 * ⚠ `meta` is deliberately not in it. It holds when the document was last written, stamped from the
 * clock of whichever machine wrote it, so hashing it would eject every guest on every save.
 */
export function uiGraphShellDigest(document: UIGraphDocument | null): string {
    if (!document) {
        return hash({ absent: true });
    }
    return hash({
        blueprintIds: Object.keys(document.blueprintDocument?.blueprints ?? {}).sort(),
        owners: pruneUndefined(document.blueprintDocument?.ownerRecords ?? {}),
    });
}

/* --------------------------------------------------------------------- helpers */

function shellsOf(document: BlueprintDocument | undefined): Record<string, LiveBlueprintShell> {
    const shells: Record<string, LiveBlueprintShell> = {};
    for (const [blueprintId, blueprint] of Object.entries(document?.blueprints ?? {})) {
        shells[blueprintId] = shellOfBlueprint(blueprint);
    }
    return shells;
}

function shellOfBlueprint(blueprint: Blueprint): LiveBlueprintShell {
    if (blueprint.program.kind === "scriptModule") {
        return { ...blueprint, program: { kind: "scriptModule", scriptRef: blueprint.program.scriptRef } };
    }
    const { events: _events, functions: _functions, ...graphs } = blueprint.program.graphs;
    return { ...blueprint, program: { kind: "graph", graphs } };
}

function shellOfSlot(slot: BlueprintEventGraph | BlueprintFunctionGraph): LiveGraphSlotShell {
    const { graph: _graph, ...shell } = slot;
    return shell;
}

function diffRecordMap<T>(
    before: Readonly<Record<string, T>>,
    after: Readonly<Record<string, T>>,
): Record<string, T | null> | null {
    const delta: Record<string, T | null> = {};
    let changed = false;
    for (const [id, record] of Object.entries(after)) {
        if (!sameJsonValue(before[id], record)) {
            delta[id] = record;
            changed = true;
        }
    }
    for (const id of Object.keys(before)) {
        if (!Object.prototype.hasOwnProperty.call(after, id)) {
            delta[id] = null;
            changed = true;
        }
    }
    return changed ? delta : null;
}

/** Whether two values would be written to disk identically. See the interface delta's copy. */
function sameJsonValue(left: unknown, right: unknown): boolean {
    if (left === right) {
        return true;
    }
    if (left === undefined || right === undefined || left === null || right === null) {
        return false;
    }
    if (typeof left !== "object" || typeof right !== "object") {
        return false;
    }
    if (Array.isArray(left) !== Array.isArray(right)) {
        return false;
    }
    if (Array.isArray(left) && Array.isArray(right)) {
        return left.length === right.length && left.every((entry, index) => sameJsonValue(entry, right[index]));
    }
    const leftKeys = definedKeys(left as Record<string, unknown>);
    const rightKeys = definedKeys(right as Record<string, unknown>);
    if (leftKeys.length !== rightKeys.length) {
        return false;
    }
    for (const key of leftKeys) {
        if (!sameJsonValue((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key])) {
            return false;
        }
    }
    return true;
}

function definedKeys(value: Record<string, unknown>): string[] {
    return Object.keys(value).filter(key => value[key] !== undefined);
}

function pruneUndefined(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(pruneUndefined);
    }
    if (value === null || typeof value !== "object") {
        return value;
    }
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        if (entry !== undefined) {
            out[key] = pruneUndefined(entry);
        }
    }
    return out;
}

function hash(content: unknown): string {
    return fnv1a64BytesHex(new TextEncoder().encode(encodeCanonicalJson(content)));
}
