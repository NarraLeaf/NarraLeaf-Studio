import { BLUEPRINT_NODE_TYPE_GAME_START_STORY } from "@shared/types/blueprint/graph";
import type { BlueprintDocument, BlueprintGraphNode } from "@shared/types/blueprint/document";
import {
    duplicateSceneLabels,
    listSceneBlocksInDocumentOrder,
    listSceneLabels,
    listScenesInDocumentOrder,
    sceneLabelNames,
    type StoryBlock,
    type StoryBlockId,
    type StoryScene,
    type StorySceneId,
} from "@shared/types/story";
import { collectInvalidBlocks } from "../../workspace/services/story/storyModel";
import type { SearchJumpTarget } from "../../workspace/services/search/searchIndexModel";
import type { LintContext, LintStoryEntry } from "../context";
import type { LintFinding, LintLocation, LintRule } from "../types";

/**
 * `story` - the shape of the script itself: can it be compiled, and does every route it names
 * actually exist.
 *
 * `story/invalid-command` deliberately *calls* `collectInvalidBlocks()` rather than reimplementing
 * it (ruling R4): the build gate keeps its own unconditional call, and a palette run reports the
 * same blocks through the same function. Two implementations of "is this row valid" is exactly the
 * bug this rule exists to catch.
 *
 * Three traversal facts every rule here obeys:
 *
 *  - **Order comes from the declared arrays, never from a record's keys.** Scenes read through
 *    `listScenesInDocumentOrder`, blocks through `listSceneBlocksInDocumentOrder` - the canonical
 *    serializer sorts keys by UUID, so `Object.values` is authoring order only by accident.
 *  - **A disabled row is authored-but-off and never produces a finding.** Disabling a container
 *    takes its whole subtree out of the runtime, so `skipSubtree` prunes rather than filters.
 *  - **Every finding that can name a row carries a `SearchJumpTarget`**, so the report tab's
 *    click-to-jump is the existing `jumpToSearchTarget()` and not new navigation code.
 */

type SceneCursor = { entry: LintStoryEntry; scene: StoryScene };

/** Every scene of every story, in authoring order. */
function* eachScene(ctx: LintContext): Generator<SceneCursor> {
    for (const entry of ctx.stories) {
        for (const scene of listScenesInDocumentOrder(entry.document)) {
            if (scene) {
                yield { entry, scene };
            }
        }
    }
}

/** The blocks the runtime will actually see: a disabled row takes its whole subtree with it. */
function liveBlocks(scene: StoryScene): StoryBlock[] {
    return listSceneBlocksInDocumentOrder(scene, { skipSubtree: block => Boolean(block.disabled) });
}

/** Direct children that are still live. The parent is assumed live, so no ancestor walk is needed. */
function liveChildren(scene: StoryScene, block: StoryBlock): StoryBlock[] {
    const children: StoryBlock[] = [];
    for (const childId of block.childrenIds) {
        const child = scene.blocks[childId];
        if (child && !child.disabled) {
            children.push(child);
        }
    }
    return children;
}

/** The live root-level rows of a scene, in authoring order. */
function liveRootBlocks(scene: StoryScene): StoryBlock[] {
    const blocks: StoryBlock[] = [];
    for (const rootId of scene.rootBlockIds) {
        const block = scene.blocks[rootId];
        if (block && !block.disabled) {
            blocks.push(block);
        }
    }
    return blocks;
}

/** The trimmed label a `/goto` addresses, or null when the row is not a goto. Trimmed like the compiler. */
function gotoTarget(block: StoryBlock): string | null {
    return block.kind === "control" && block.payload.control === "goto" ? block.payload.targetLabel.trim() : null;
}

function storyLocation(entry: LintStoryEntry, scene: StoryScene, blockId?: StoryBlockId): LintLocation {
    return {
        kind: "story",
        storyId: entry.id,
        storyName: entry.name,
        sceneId: scene.id,
        sceneName: scene.name,
        ...(blockId ? { blockId } : {}),
    };
}

function sceneTarget(entry: LintStoryEntry, scene: StoryScene): SearchJumpTarget {
    return { kind: "storyScene", storyId: entry.id, sceneId: scene.id, storyName: entry.name, sceneName: scene.name };
}

function blockTarget(entry: LintStoryEntry, scene: StoryScene, blockId: StoryBlockId): SearchJumpTarget {
    return {
        kind: "storyBlock",
        storyId: entry.id,
        sceneId: scene.id,
        blockId,
        storyName: entry.name,
        sceneName: scene.name,
    };
}

/**
 * Whether control provably leaves the scene at this row.
 *
 * A jump and a `/goto` are the two rows that move the play head themselves. The story action union
 * has no end-of-game action (quitting is a blueprint node, `blueprint.game.quit`, not a script row),
 * so those two are the whole vocabulary of "this scene hands off".
 *
 * Containers recurse, which is the one place this is deliberately more forgiving than "the last row
 * is a jump": a scene that ends in a choice whose every option jumps, or in an if/else whose every
 * arm jumps, does not run off the end - and those are the two shapes almost every branching scene
 * ends in. Recursing only ever *suppresses* a warning, so the cost of the extra reach is bounded.
 */
function blockTerminates(scene: StoryScene, block: StoryBlock, seen: Set<StoryBlockId>): boolean {
    if (seen.has(block.id)) {
        // Only a corrupt `childrenIds` cycle reaches here; a hang would be worse than a missed warning.
        return true;
    }
    seen.add(block.id);

    if (block.kind === "jump") {
        return true;
    }
    if (block.kind === "control") {
        if (block.payload.control === "goto") {
            return true;
        }
        if (block.payload.control === "condition") {
            const branches = liveChildren(scene, block).filter(
                child => child.kind === "control" && child.payload.control === "conditionBranch",
            );
            // Without an `else` arm, "no branch matched" falls straight through to the end of the scene.
            const hasElse = branches.some(
                child => child.kind === "control" && child.payload.control === "conditionBranch" && child.payload.branch === "else",
            );
            return hasElse && branches.every(branch => tailTerminates(scene, branch, seen));
        }
        // sequence / parallel / race / repeat are ordering, not choosing: the tail is the exit.
        return tailTerminates(scene, block, seen);
    }
    if (block.kind === "nodeAction" && block.payload.action === "choice") {
        const options = liveChildren(scene, block).filter(
            child => child.kind === "nodeAction" && child.payload.action === "choiceOption",
        );
        return options.length > 0 && options.every(option => tailTerminates(scene, option, seen));
    }
    return false;
}

/** Whether the last live child of a container terminates. A container with no live child does not. */
function tailTerminates(scene: StoryScene, block: StoryBlock, seen: Set<StoryBlockId>): boolean {
    const children = liveChildren(scene, block);
    const last = children[children.length - 1];
    return last ? blockTerminates(scene, last, seen) : false;
}

/**
 * Whether the scene hands control on anywhere at all - a jump or a `/goto`, at any depth, on any
 * path. This is what separates "an ending" from "a forgotten branch"; see `story/dead-end`.
 */
function hasOutgoingTransfer(scene: StoryScene): boolean {
    return liveBlocks(scene).some(block => block.kind === "jump" || gotoTarget(block) !== null);
}

/** Every graph node of a blueprint document, across events, functions and macros. */
function* eachBlueprintNode(document: BlueprintDocument | null): Generator<BlueprintGraphNode> {
    if (!document) {
        return;
    }
    for (const blueprint of Object.values(document.blueprints ?? {})) {
        if (blueprint?.program?.kind !== "graph") {
            continue;
        }
        const graphs = blueprint.program.graphs;
        const carriers = [
            ...Object.values(graphs.events ?? {}),
            ...Object.values(graphs.functions ?? {}),
            ...Object.values(graphs.macros ?? {}),
        ];
        for (const carrier of carriers) {
            for (const node of Object.values(carrier?.graph?.nodes ?? {})) {
                if (node) {
                    yield node;
                }
            }
        }
    }
}

function stringParam(node: BlueprintGraphNode, key: string): string {
    const value = node.params?.[key];
    return typeof value === "string" ? value.trim() : "";
}

type EntryPointScan = {
    /** Scene ids the project can start at, per story id. Only scenes that exist. */
    byStory: Map<string, Set<StorySceneId>>;
    /**
     * A `Start Game` node whose target is wired rather than picked - a data-driven launcher. Which
     * scene it starts is only knowable at runtime, so no reachability claim can be made at all.
     */
    indeterminate: boolean;
};

/**
 * Where play can begin.
 *
 * Two sources, and both are real author intent rather than a guess: the scene an author marked as a
 * story's entry (`StoryDocument.entrySceneId`, the "Set Entry Scene" action in the story panel), and
 * every scene a blueprint's `Start Game` node names. Nothing else is an entry - in particular "the
 * first scene in document order" is NOT assumed, because a project that simply never marked an entry
 * would then have every scene but one declared unreachable.
 */
function collectEntryPoints(ctx: LintContext): EntryPointScan {
    const byStory = new Map<string, Set<StorySceneId>>();
    let indeterminate = false;

    const add = (storyId: string, sceneId: StorySceneId) => {
        const entry = ctx.stories.find(story => story.id === storyId);
        if (!entry || !entry.document.scenes[sceneId]) {
            return;
        }
        const set = byStory.get(storyId);
        if (set) {
            set.add(sceneId);
        } else {
            byStory.set(storyId, new Set([sceneId]));
        }
    };

    for (const node of eachBlueprintNode(ctx.blueprintDocument)) {
        if (node.type !== BLUEPRINT_NODE_TYPE_GAME_START_STORY) {
            continue;
        }
        const storyId = stringParam(node, "storyId");
        const sceneId = stringParam(node, "sceneId");
        if (!storyId || !sceneId) {
            indeterminate = true;
            continue;
        }
        add(storyId, sceneId);
    }

    for (const entry of ctx.stories) {
        const entrySceneId = entry.document.entrySceneId;
        if (entrySceneId && entry.document.scenes[entrySceneId]) {
            add(entry.id, entrySceneId);
        }
    }

    return { byStory, indeterminate };
}

/** The scenes reachable from a set of entry scenes by following live jumps. */
function reachableScenes(entry: LintStoryEntry, entrySceneIds: ReadonlySet<StorySceneId>): Set<StorySceneId> {
    const reachable = new Set<StorySceneId>(entrySceneIds);
    const queue = [...entrySceneIds];
    for (let cursor = 0; cursor < queue.length; cursor++) {
        const scene = entry.document.scenes[queue[cursor]];
        if (!scene) {
            continue;
        }
        for (const block of liveBlocks(scene)) {
            if (block.kind !== "jump") {
                continue;
            }
            const target = block.payload.targetSceneId;
            if (!target || !entry.document.scenes[target] || reachable.has(target)) {
                continue;
            }
            reachable.add(target);
            queue.push(target);
        }
    }
    return reachable;
}

export const STORY_LINT_RULES: readonly LintRule[] = [
    {
        id: "story/invalid-command",
        category: "story",
        defaultSeverity: "error",
        slug: "storyInvalidCommand",
        run(ctx) {
            const findings: LintFinding[] = [];
            for (const entry of ctx.stories) {
                for (const ref of collectInvalidBlocks(entry.document)) {
                    findings.push({
                        ruleId: "story/invalid-command",
                        messageKey: "lint.rule.storyInvalidCommand.message",
                        messageParams: { scene: ref.sceneName },
                        location: {
                            kind: "story",
                            storyId: entry.id,
                            storyName: entry.name,
                            sceneId: ref.sceneId,
                            sceneName: ref.sceneName,
                            blockId: ref.blockId,
                        },
                        target: {
                            kind: "storyBlock",
                            storyId: entry.id,
                            sceneId: ref.sceneId,
                            blockId: ref.blockId,
                            storyName: entry.name,
                            sceneName: ref.sceneName,
                        },
                    });
                }
            }
            return findings;
        },
    },
    {
        id: "story/goto-missing",
        category: "story",
        defaultSeverity: "error",
        slug: "storyGotoMissing",
        run(ctx) {
            const findings: LintFinding[] = [];
            for (const { entry, scene } of eachScene(ctx)) {
                // Scene-scoped and matched EXACTLY, case included - the engine resolves a jump against
                // a plain Map of declared names, so a label declared in another scene is not a match.
                const declared = new Set(sceneLabelNames(scene));
                for (const block of liveBlocks(scene)) {
                    const target = gotoTarget(block);
                    if (target === null || declared.has(target)) {
                        continue;
                    }
                    findings.push({
                        ruleId: "story/goto-missing",
                        messageKey: "lint.rule.storyGotoMissing.message",
                        messageParams: { scene: scene.name, label: target },
                        location: storyLocation(entry, scene, block.id),
                        target: blockTarget(entry, scene, block.id),
                    });
                }
            }
            return findings;
        },
    },
    {
        id: "story/label-duplicate",
        category: "story",
        defaultSeverity: "warning",
        slug: "storyLabelDuplicate",
        run(ctx) {
            const findings: LintFinding[] = [];
            for (const { entry, scene } of eachScene(ctx)) {
                // The first declaration is the one the engine keeps, so the scan anchors the later rows.
                for (const duplicate of duplicateSceneLabels(scene)) {
                    findings.push({
                        ruleId: "story/label-duplicate",
                        messageKey: "lint.rule.storyLabelDuplicate.message",
                        messageParams: { scene: scene.name, label: duplicate.name },
                        location: storyLocation(entry, scene, duplicate.blockId),
                        target: blockTarget(entry, scene, duplicate.blockId),
                    });
                }
            }
            return findings;
        },
    },
    {
        id: "story/label-unused",
        category: "story",
        defaultSeverity: "info",
        slug: "storyLabelUnused",
        run(ctx) {
            const findings: LintFinding[] = [];
            for (const { entry, scene } of eachScene(ctx)) {
                const addressed = new Set<string>();
                for (const block of liveBlocks(scene)) {
                    const target = gotoTarget(block);
                    if (target) {
                        addressed.add(target);
                    }
                }
                // One finding per NAME, on its first declaration: a name declared twice and used never
                // is one unused label, and `story/label-duplicate` already owns the second row.
                const reported = new Set<string>();
                for (const label of listSceneLabels(scene)) {
                    if (addressed.has(label.name) || reported.has(label.name)) {
                        continue;
                    }
                    reported.add(label.name);
                    findings.push({
                        ruleId: "story/label-unused",
                        messageKey: "lint.rule.storyLabelUnused.message",
                        messageParams: { label: label.name, scene: scene.name },
                        location: storyLocation(entry, scene, label.blockId),
                        target: blockTarget(entry, scene, label.blockId),
                    });
                }
            }
            return findings;
        },
    },
    {
        id: "story/jump-missing",
        category: "story",
        defaultSeverity: "error",
        slug: "storyJumpMissing",
        run(ctx) {
            const findings: LintFinding[] = [];
            for (const { entry, scene } of eachScene(ctx)) {
                for (const block of liveBlocks(scene)) {
                    if (block.kind !== "jump") {
                        continue;
                    }
                    // A jump never crosses stories: the compiler resolves `targetSceneId` against the
                    // one document's `scenes`, and the picker only ever offers scenes from it. So a
                    // target that happens to name a scene in ANOTHER story is still a broken jump.
                    const target = block.payload.targetSceneId;
                    if (target && entry.document.scenes[target]) {
                        continue;
                    }
                    findings.push({
                        ruleId: "story/jump-missing",
                        messageKey: "lint.rule.storyJumpMissing.message",
                        messageParams: { scene: scene.name },
                        location: storyLocation(entry, scene, block.id),
                        target: blockTarget(entry, scene, block.id),
                    });
                }
            }
            return findings;
        },
    },
    {
        id: "story/empty-choice",
        category: "story",
        defaultSeverity: "error",
        slug: "storyEmptyChoice",
        run(ctx) {
            const findings: LintFinding[] = [];
            for (const { entry, scene } of eachScene(ctx)) {
                for (const block of liveBlocks(scene)) {
                    if (block.kind !== "nodeAction" || block.payload.action !== "choice") {
                        continue;
                    }
                    const options = liveChildren(scene, block).filter(
                        child => child.kind === "nodeAction" && child.payload.action === "choiceOption",
                    );
                    if (options.length === 0) {
                        findings.push({
                            ruleId: "story/empty-choice",
                            messageKey: "lint.rule.storyEmptyChoice.message",
                            messageParams: { scene: scene.name },
                            location: storyLocation(entry, scene, block.id),
                            target: blockTarget(entry, scene, block.id),
                        });
                        continue;
                    }
                    for (const option of options) {
                        if (option.kind !== "nodeAction" || option.payload.action !== "choiceOption") {
                            continue;
                        }
                        const text = option.payload.text;
                        // An option whose whole label is an inline value (`{playerName}`) projects to an
                        // empty `value` - the plain projection drops interpolation runs - and is not empty.
                        const hasText =
                            text.value.trim().length > 0
                            || (text.rich ?? []).some(run => "interpolation" in run);
                        if (hasText) {
                            continue;
                        }
                        findings.push({
                            ruleId: "story/empty-choice",
                            messageKey: "lint.rule.storyEmptyChoice.messageEmptyOption",
                            messageParams: { scene: scene.name },
                            location: storyLocation(entry, scene, option.id),
                            target: blockTarget(entry, scene, option.id),
                        });
                    }
                }
            }
            return findings;
        },
    },
    {
        id: "story/dead-end",
        category: "story",
        defaultSeverity: "warning",
        slug: "storyDeadEnd",
        /**
         * A scene that transfers control on some paths and falls off the end on another.
         *
         * **Why the transfer precondition, and not just "the tail does not terminate".** The story
         * action union has no end-of-game row - quitting is the blueprint node `blueprint.game.quit` -
         * so a story's *final* scene is structurally identical to a forgotten dead end: both simply
         * stop. Without this guard the rule fires on every correct ending in every project, which is
         * a rule an author switches off in the first five minutes, and a rule that is off finds
         * nothing at all.
         *
         * So a scene with no jump and no `/goto` anywhere in it is read as a deliberate terminal
         * scene and stays silent. A scene that *does* hand control on somewhere, yet still has a tail
         * running off the end, is the forgotten branch worth a warning - the author has already
         * demonstrated in this very scene that leaving is what they meant to do.
         *
         * **The trade-off, accepted deliberately:** a wholly unfinished scene - one nothing leaves
         * and nothing follows - is not reported here. That case is covered from the other side by
         * `story/unreachable-scene` (nothing can get to what it should have led to) and, in the end,
         * by review. Reporting it would cost every legitimate ending in the project, which is the
         * more expensive of the two mistakes.
         */
        run(ctx) {
            const findings: LintFinding[] = [];
            for (const { entry, scene } of eachScene(ctx)) {
                const roots = liveRootBlocks(scene);
                const last = roots[roots.length - 1];
                if (!last) {
                    // `story/empty-scene` owns a scene with nothing live in it.
                    continue;
                }
                if (blockTerminates(scene, last, new Set())) {
                    continue;
                }
                if (!hasOutgoingTransfer(scene)) {
                    // A deliberate ending, not a dead end.
                    continue;
                }
                findings.push({
                    ruleId: "story/dead-end",
                    messageKey: "lint.rule.storyDeadEnd.message",
                    messageParams: { scene: scene.name },
                    location: storyLocation(entry, scene, last.id),
                    target: blockTarget(entry, scene, last.id),
                });
            }
            return findings;
        },
    },
    {
        id: "story/unreachable-scene",
        category: "story",
        defaultSeverity: "warning",
        slug: "storyUnreachableScene",
        run(ctx) {
            const { byStory, indeterminate } = collectEntryPoints(ctx);
            // Guard (mandatory): a rule that flags every scene because it could not find the entry is
            // worse than no rule. A wired `Start Game` target silences the rule project-wide, and a
            // story with no entry of its own is skipped rather than declared entirely unreachable.
            if (indeterminate || byStory.size === 0) {
                return [];
            }

            const findings: LintFinding[] = [];
            for (const entry of ctx.stories) {
                const entrySceneIds = byStory.get(entry.id);
                if (!entrySceneIds || entrySceneIds.size === 0) {
                    continue;
                }
                const reachable = reachableScenes(entry, entrySceneIds);
                for (const scene of listScenesInDocumentOrder(entry.document)) {
                    if (!scene || reachable.has(scene.id)) {
                        continue;
                    }
                    findings.push({
                        ruleId: "story/unreachable-scene",
                        messageKey: "lint.rule.storyUnreachableScene.message",
                        messageParams: { scene: scene.name },
                        location: storyLocation(entry, scene),
                        target: sceneTarget(entry, scene),
                    });
                }
            }
            return findings;
        },
    },
    {
        id: "story/empty-scene",
        category: "story",
        defaultSeverity: "info",
        slug: "storyEmptyScene",
        run(ctx) {
            const findings: LintFinding[] = [];
            for (const { entry, scene } of eachScene(ctx)) {
                if (liveBlocks(scene).length > 0) {
                    continue;
                }
                findings.push({
                    ruleId: "story/empty-scene",
                    messageKey: "lint.rule.storyEmptyScene.message",
                    messageParams: { scene: scene.name },
                    location: storyLocation(entry, scene),
                    target: sceneTarget(entry, scene),
                });
            }
            return findings;
        },
    },
];
