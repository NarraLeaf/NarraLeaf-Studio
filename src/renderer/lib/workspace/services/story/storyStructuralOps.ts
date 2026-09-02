import {
    declaredStageObject,
    isStoryDeclarationBlock,
    listSceneBlocksInDocumentOrder,
    listScenesInDocumentOrder,
    listSceneLabels,
    stageObjectReference,
    type StageObjectDeclaration,
    listSceneIdsInDocumentOrder,
    type StoryBlock,
    type StoryBlockId,
    type StoryChapterId,
    type StoryDocument,
    type StoryScene,
    type StorySceneId,
} from "@shared/types/story";

/**
 * The three operations that reshape a story rather than a row: move rows to another scene, split a
 * scene in two, merge two scenes into one.
 *
 * They live here, as functions over a `StoryDocument`, for the reason the rest of `storyModel`
 * does: each one has to leave the document consistent in *one* step, and a step spread over the
 * service's public mutators would publish half-finished documents to the editor between calls.
 * `StoryService` wraps each of these in a single `mutateDocument`, so what the editor and the disk
 * see is the finished shape.
 *
 * # Row identity survives all three
 *
 * Blocks are re-homed, never re-created: ids, `textId`s and every reference that names them (jump
 * targets, labels, deep links, translation units, voice takes) keep working because nothing about
 * them changes. That is the difference between these and copy/paste, which mints fresh ids by
 * design.
 *
 * # Scene identity survives too
 *
 * A split keeps the original scene and adds one; a merge keeps one of the pair and drops the other.
 * No operation renumbers or re-creates a scene that already existed, because a scene id is the
 * reference other documents hold (see `story-scene-identity-never-changes`).
 */

export type StoryBlockPlacement = {
    parentId: StoryBlockId | null;
    beforeBlockId?: StoryBlockId | null;
};

// ---------------------------------------------------------------------------
// Moving rows to another scene
// ---------------------------------------------------------------------------

/**
 * Re-home a selection of rows into another scene, subtrees and all, keeping every id.
 *
 * The blocks arrive in the order given, each inserted in front of the same anchor, which is how a
 * multi-row selection keeps its reading order. Callers pass roots only: a row whose ancestor is
 * also moving travels inside that ancestor's subtree and must not be listed again.
 *
 * Returns the number of rows moved, counting the subtrees - the figure a notification reports.
 */
export function moveBlocksToScene(
    document: StoryDocument,
    sourceSceneId: StorySceneId,
    targetSceneId: StorySceneId,
    blockIds: readonly StoryBlockId[],
    placement: StoryBlockPlacement,
): number {
    const source = document.scenes[sourceSceneId];
    const target = document.scenes[targetSceneId];
    if (!source || !target || source === target) {
        return 0;
    }
    const roots = blockIds.filter(id => Boolean(source.blocks[id]));
    if (roots.length === 0) {
        return 0;
    }
    if (placement.parentId && !target.blocks[placement.parentId]) {
        return 0;
    }
    let moved = 0;
    for (const rootId of roots) {
        const subtree = subtreeIds(source, rootId);
        const root = source.blocks[rootId];
        detachFromParent(source, root);
        for (const id of subtree) {
            const block = source.blocks[id];
            if (!block) {
                continue;
            }
            delete source.blocks[id];
            target.blocks[id] = block;
            moved += 1;
        }
        root.parentId = placement.parentId;
        const siblings = placement.parentId
            ? target.blocks[placement.parentId].childrenIds
            : target.rootBlockIds;
        insertBefore(siblings, rootId, placement.beforeBlockId ?? null);
    }
    return moved;
}

// ---------------------------------------------------------------------------
// Splitting a scene
// ---------------------------------------------------------------------------

/** Something one half of a split would need from the other half, named as the author knows it. */
export type StorySceneCutTie = {
    /** Which kind of thing spans the cut; picks the sentence that lists it. */
    kind: "stageObject" | "label" | "variable";
    /**
     * The registry key, for a caller that can name it better than this module can.
     *
     * A character's stage key is its id, and its name lives in the cast rather than in the story
     * document - so the editor resolves that one before it prints the list. Everything else keys on
     * something the author typed, and `label` is already it.
     */
    name: string;
    /** What the author would look for: an object's stage name, a label, a variable's name. */
    label: string;
};

export type StorySceneSplitPlan = {
    /** Rows from the cut to the end of the scene, in document order. Never empty. */
    movingRootIds: StoryBlockId[];
    /**
     * Whether the first half would stop the game where it now ends.
     *
     * The engine has no scene successor: play runs off the last row and the action stack drains,
     * which ends the run. So a split that leaves the first half without an exit needs one written,
     * or the second half becomes unreachable and the story ends early.
     */
    needsJump: boolean;
    /**
     * What the two halves still share. Non-empty means the split is refused.
     *
     * A scene is where the engine keeps the stage, the labels and the scene-scoped variables, and a
     * jump between scenes empties all three: the stage is unloaded, `/goto` cannot leave a scene,
     * and `Scene.local` is re-initialised on entry. So a row after the cut that names something
     * introduced before it would still be there - and would name nothing. Refusing is what makes
     * "split" a safe operation: it either leaves playback exactly as it was, or it says which rows
     * have to move first.
     */
    ties: StorySceneCutTie[];
};

/**
 * What splitting a scene at `atBlockId` would do, or null when there is nothing to split.
 *
 * The cut is only offered at the top level: a row nested inside a container belongs to that
 * container's structure, and taking half a condition's branches into another scene is not a split
 * of anything the author can name.
 */
export function planSceneSplit(scene: StoryScene, atBlockId: StoryBlockId): StorySceneSplitPlan | null {
    const index = scene.rootBlockIds.indexOf(atBlockId);
    if (index < 0) {
        return null;
    }
    const movingRootIds = scene.rootBlockIds.slice(index);
    if (movingRootIds.length === 0) {
        return null;
    }
    const staying = scene.rootBlockIds.slice(0, index);
    return {
        movingRootIds,
        needsJump: !endsWithTransfer(scene, staying),
        ties: collectCutTies(scene, staying, movingRootIds),
    };
}

/**
 * Everything the rows after the cut would still be asking the rows before it for.
 *
 * Only that direction. A row before the cut that names something declared after it is already
 * wrong today - the compiler reports a forward reference - so a split does not make it worse, and
 * refusing on it would refuse a split that fixes nothing.
 */
function collectCutTies(
    scene: StoryScene,
    stayingRootIds: readonly StoryBlockId[],
    movingRootIds: readonly StoryBlockId[],
): StorySceneCutTie[] {
    const staying = blocksUnder(scene, stayingRootIds);
    const moving = blocksUnder(scene, movingRootIds);
    const ties: StorySceneCutTie[] = [];
    const seen = new Set<string>();
    const add = (kind: StorySceneCutTie["kind"], name: string, label: string) => {
        const key = `${kind}:${name}`;
        if (!seen.has(key)) {
            seen.add(key);
            ties.push({ kind, name, label });
        }
    };

    const declaredBefore = new Map<string, StageObjectDeclaration>();
    for (const block of staying) {
        const declaration = declaredStageObject(block);
        if (declaration) {
            declaredBefore.set(`${declaration.kind}:${declaration.name}`, declaration);
        }
    }
    const labelsBefore = new Set(listSceneLabels(scene)
        .filter(label => staying.some(block => block.id === label.blockId))
        .map(label => label.name));
    const variablesBefore = staying
        .filter(isStoryDeclarationBlock)
        .filter(block => block.payload.scope === "scene")
        .map(block => ({ id: block.id, name: block.payload.name }));

    for (const block of moving) {
        const reference = stageObjectReference(scene, block);
        for (const kind of reference?.kinds ?? []) {
            const declaration = declaredBefore.get(`${kind}:${reference!.name}`);
            if (declaration) {
                add("stageObject", declaration.name, declaration.label);
            }
        }
        if (block.kind === "control" && block.payload.control === "goto" && labelsBefore.has(block.payload.targetLabel)) {
            add("label", block.payload.targetLabel, block.payload.targetLabel);
        }
        for (const variable of variablesBefore) {
            // The block id doubles as the variable id (schema v6), so the id appearing anywhere in
            // a payload is that variable and nothing else.
            if (containsString(block.payload, variable.id)) {
                add("variable", variable.id, variable.name);
            }
        }
    }
    return ties;
}

/** Every block in the given roots' subtrees, roots included. */
function blocksUnder(scene: StoryScene, rootIds: readonly StoryBlockId[]): StoryBlock[] {
    const blocks: StoryBlock[] = [];
    for (const rootId of rootIds) {
        for (const id of subtreeIds(scene, rootId)) {
            const block = scene.blocks[id];
            if (block) {
                blocks.push(block);
            }
        }
    }
    return blocks;
}

/**
 * Whether a list of top-level rows hands control somewhere the engine can follow.
 *
 * Only the last live row decides it, and only the shapes that unconditionally leave count: a jump,
 * a `/goto`, an ending or a quit. A conditional exit is not an exit - the branch that does not take
 * it still runs off the end.
 */
function endsWithTransfer(scene: StoryScene, rootIds: readonly StoryBlockId[]): boolean {
    for (let index = rootIds.length - 1; index >= 0; index -= 1) {
        const block = scene.blocks[rootIds[index]];
        if (!block || block.disabled) {
            continue;
        }
        if (block.kind === "jump") {
            return true;
        }
        if (block.kind === "control") {
            const control = block.payload.control;
            return control === "goto" || control === "ending" || control === "quit";
        }
        return false;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Merging two scenes
// ---------------------------------------------------------------------------

/**
 * One place that names the scene a merge would drop, in the terms the author would look for it.
 *
 * Shaped for the sentence rather than carrying a pre-built one: a row is named by its scene and its
 * position, and how those two read is the interface layer's business, not this module's.
 */
export type StorySceneReferrer =
    /** A `/jump` row somewhere in the story. `row` is its one-based position among its scene's rows. */
    | { kind: "jump"; sceneName: string; row: number }
    /** The story's own entry pointer. */
    | { kind: "entryScene" }
    /** A blueprint graph that holds the scene id. */
    | { kind: "blueprint"; name: string };

export type StorySceneMergePlan = {
    /** The scene that keeps its id and receives the rows. */
    survivingSceneId: StorySceneId;
    /** The scene whose rows move out and which is then deleted. */
    mergedSceneId: StorySceneId;
    /** How many top-level rows travel. */
    movingRootCount: number;
    /** The surviving scene's trailing jump into the merged scene, which the merge drops. */
    droppedJumpBlockId: StoryBlockId | null;
    /** Everything that still names the scene. Non-empty means the merge is refused. */
    blockers: StorySceneReferrer[];
};

/**
 * What merging `mergedSceneId` into `survivingSceneId` would do.
 *
 * The surviving scene is always the earlier of the pair, so "merge with next" and "merge into
 * previous" are the same operation named from either end and the result does not depend on which
 * one the author reached for.
 *
 * **Anything else that names the merged scene refuses the merge.** The tempting alternative is to
 * re-point those jumps at the surviving scene, and it is wrong: a jump into the merged scene used to
 * start at its first row, and after a merge the surviving scene's own rows come first - so the jump
 * still resolves, still builds, and plays something else. There is no cross-scene label to land on,
 * so nothing can express the old meaning. A refusal naming the rows is the only honest answer; the
 * author moves or re-points them and merges again.
 *
 * The one exception is the surviving scene's trailing jump into the merged scene, which is the row a
 * split wrote to keep playback going and which the merge takes back out.
 *
 * `externalReferrers` is what the caller found outside the story document - blueprint graphs name
 * scenes by id and cannot be re-pointed from here at all.
 */
export function planSceneMerge(
    document: StoryDocument,
    survivingSceneId: StorySceneId,
    mergedSceneId: StorySceneId,
    externalReferrers: readonly StorySceneReferrer[] = [],
): StorySceneMergePlan | null {
    const surviving = document.scenes[survivingSceneId];
    const merged = document.scenes[mergedSceneId];
    if (!surviving || !merged || surviving === merged) {
        return null;
    }
    const droppedJumpBlockId = trailingJumpTo(surviving, mergedSceneId);
    const blockers: StorySceneReferrer[] = [];
    // Document order, so the list reads the way the outline does rather than the way the scene table
    // happens to be keyed.
    for (const scene of listScenesInDocumentOrder(document)) {
        scene.rootBlockIds.forEach((blockId, index) => {
            const block = scene.blocks[blockId];
            if (block?.kind !== "jump" || block.payload.targetSceneId !== mergedSceneId) {
                return;
            }
            if (block.id === droppedJumpBlockId) {
                return;
            }
            blockers.push({ kind: "jump", sceneName: scene.name, row: index + 1 });
        });
    }
    if (document.entrySceneId === mergedSceneId) {
        blockers.push({ kind: "entryScene" });
    }
    return {
        survivingSceneId,
        mergedSceneId,
        movingRootCount: merged.rootBlockIds.length,
        droppedJumpBlockId,
        blockers: [...blockers, ...externalReferrers],
    };
}

/**
 * The surviving scene's last row when it is a jump into the scene about to be merged in.
 *
 * This is the row a split wrote to keep playback going, so a merge that puts the two halves back
 * together has to take it out again - left in place it would jump the scene to its own middle.
 */
function trailingJumpTo(scene: StoryScene, targetSceneId: StorySceneId): StoryBlockId | null {
    for (let index = scene.rootBlockIds.length - 1; index >= 0; index -= 1) {
        const block = scene.blocks[scene.rootBlockIds[index]];
        if (!block || block.disabled) {
            continue;
        }
        return block.kind === "jump" && block.payload.targetSceneId === targetSceneId ? block.id : null;
    }
    return null;
}

/** Apply a merge plan. The merged scene is emptied and removed; the caller deletes nothing else. */
export function applySceneMerge(document: StoryDocument, plan: StorySceneMergePlan): void {
    const surviving = document.scenes[plan.survivingSceneId];
    const merged = document.scenes[plan.mergedSceneId];
    if (!surviving || !merged || plan.blockers.length > 0) {
        return;
    }
    if (plan.droppedJumpBlockId) {
        const jump = surviving.blocks[plan.droppedJumpBlockId];
        if (jump) {
            detachFromParent(surviving, jump);
            delete surviving.blocks[plan.droppedJumpBlockId];
        }
    }
    moveBlocksToScene(document, plan.mergedSceneId, plan.survivingSceneId, [...merged.rootBlockIds], {
        parentId: null,
        beforeBlockId: null,
    });
    // Snapshots name rows by block id, so the ones taken in the merged scene still describe rows
    // that now live in the surviving one and travel with them.
    if (merged.sceneSnapshots?.length) {
        surviving.sceneSnapshots = [...(surviving.sceneSnapshots ?? []), ...merged.sceneSnapshots];
    }
    delete document.scenes[plan.mergedSceneId];
    for (const chapter of document.chapters) {
        chapter.sceneIds = chapter.sceneIds.filter(id => id !== plan.mergedSceneId);
    }
    if (document.unassignedSceneIds) {
        document.unassignedSceneIds = document.unassignedSceneIds.filter(id => id !== plan.mergedSceneId);
    }
}

/**
 * Blueprints that name a scene, found by looking for its id anywhere in their program.
 *
 * A value scan rather than a walk of the node catalogue's scene-typed params. The catalogue lives
 * behind the editor's node registry, and a merge asking it would drag the whole blueprint editor
 * into the story editor's import graph for one question. A scene id is a generated identifier, so a
 * string equal to it in a graph is that reference and nothing else - and the scan cannot go stale
 * when a node type with a new scene-typed param is added, which the catalogue walk can.
 */
export function findSceneReferrersInBlueprints(
    blueprints: { blueprints: Record<string, { name: string; program: unknown }> } | null | undefined,
    sceneId: StorySceneId,
): StorySceneReferrer[] {
    const referrers: StorySceneReferrer[] = [];
    for (const blueprint of Object.values(blueprints?.blueprints ?? {})) {
        if (containsString(blueprint.program, sceneId)) {
            referrers.push({ kind: "blueprint", name: blueprint.name });
        }
    }
    return referrers;
}

function containsString(value: unknown, needle: string): boolean {
    if (typeof value === "string") {
        return value === needle;
    }
    if (Array.isArray(value)) {
        return value.some(item => containsString(item, needle));
    }
    if (value && typeof value === "object") {
        return Object.values(value).some(item => containsString(item, needle));
    }
    return false;
}

// ---------------------------------------------------------------------------
// Scene neighbours
// ---------------------------------------------------------------------------

/** The scene before and after this one in document order - what "merge with next" needs to exist. */
export function sceneNeighbours(
    document: StoryDocument,
    sceneId: StorySceneId,
): { previousSceneId: StorySceneId | null; nextSceneId: StorySceneId | null } {
    const order = listSceneIdsInDocumentOrder(document);
    const index = order.indexOf(sceneId);
    if (index < 0) {
        return { previousSceneId: null, nextSceneId: null };
    }
    return {
        previousSceneId: order[index - 1] ?? null,
        nextSceneId: order[index + 1] ?? null,
    };
}

/** The chapter a scene sits in, so a scene made beside it lands in the same one. */
export function chapterOfScene(document: StoryDocument, sceneId: StorySceneId): StoryChapterId | null {
    return document.chapters.find(chapter => chapter.sceneIds.includes(sceneId))?.id ?? null;
}

/** Every block in the scene, in reading order - what a bulk row operation walks. */
export function sceneBlocksInOrder(scene: StoryScene): StoryBlock[] {
    return listSceneBlocksInDocumentOrder(scene);
}

// ---------------------------------------------------------------------------
// Shared list surgery
// ---------------------------------------------------------------------------

function subtreeIds(scene: StoryScene, rootId: StoryBlockId): StoryBlockId[] {
    const ids: StoryBlockId[] = [];
    const visit = (id: StoryBlockId) => {
        if (ids.includes(id)) {
            return;
        }
        ids.push(id);
        scene.blocks[id]?.childrenIds.forEach(visit);
    };
    visit(rootId);
    return ids;
}

function detachFromParent(scene: StoryScene, block: StoryBlock): void {
    const siblings = block.parentId ? scene.blocks[block.parentId]?.childrenIds : scene.rootBlockIds;
    if (!siblings) {
        return;
    }
    const index = siblings.indexOf(block.id);
    if (index >= 0) {
        siblings.splice(index, 1);
    }
}

function insertBefore(ids: StoryBlockId[], id: StoryBlockId, beforeId: StoryBlockId | null): void {
    const index = beforeId ? ids.indexOf(beforeId) : -1;
    if (index < 0) {
        ids.push(id);
        return;
    }
    ids.splice(index, 0, id);
}
