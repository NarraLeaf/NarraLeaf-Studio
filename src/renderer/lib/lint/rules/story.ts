import { collectCutPoints } from "@shared/story/appTagFold";
import {
    reachableSceneIds,
    blueprintDocumentGraphCarriers,
    scanProjectStoryEntryPoints,
    type StoryEntryPointScan,
} from "@shared/story/storyReachability";
import { isBuiltinAppTagId } from "@shared/types/appTag";
import {
    collectAppTagComparisonNames,
    danglingStageObjectRefs,
    duplicateSceneLabels,
    duplicateStageObjectDeclarations,
    duplicateStoryEndingNames,
    isPlayableStoryTransitionKind,
    listSceneBlocksInDocumentOrder,
    listSceneIdsInDocumentOrder,
    listSceneLabels,
    listScenesInDocumentOrder,
    listStoryEndings,
    revealableStageObjectDeclarations,
    sceneLabelNames,
    shownStageObjectKeys,
    storyTransitionKindOf,
    type StageObjectReference,
    type StoryBlock,
    type StoryBlockId,
    type StoryDocument,
    type StoryActionPayload,
    type StoryExpr,
    type StoryInlineEvent,
    type StoryScene,
    type StorySceneId,
    type StoryTransitionRef,
} from "@shared/types/story";
import {
    BLUEPRINT_NODE_TYPE_GAME_QUIT,
    BLUEPRINT_NODE_TYPE_GAME_START_STORY,
} from "@shared/types/blueprint/graph";
import type { TranslationKey } from "@shared/i18n/catalog";
import { computeStoryStageSnapshot } from "@/lib/ui-editor/runtime/game/storyStageSnapshot";
import { collectInvalidBlocks } from "../../workspace/services/story/storyModel";
import type { SearchJumpTarget } from "../../workspace/services/search/searchIndexModel";
import type { LintCharacterEntry, LintContext, LintStoryEntry } from "../context";
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

export type SceneCursor = { entry: LintStoryEntry; scene: StoryScene };

/**
 * Every scene of every story, in authoring order.
 *
 * Exported because `portability/vfx-alpha` walks rows too, and the three traversal facts above are
 * the sort of thing a second copy gets subtly wrong - a rule that forgot `skipSubtree` would report
 * rows the runtime never reaches.
 */
export function* eachScene(ctx: LintContext): Generator<SceneCursor> {
    for (const entry of ctx.stories) {
        for (const scene of listScenesInDocumentOrder(entry.document)) {
            if (scene) {
                yield { entry, scene };
            }
        }
    }
}

/** The blocks the runtime will actually see: a disabled row takes its whole subtree with it. */
export function liveBlocks(scene: StoryScene): StoryBlock[] {
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

/**
 * Whether this row ends playback - an `/ending` or a `/quit`.
 *
 * The same pair `endsPlayback` uses in the compiler, and it has to be the same pair: this is what
 * `story/rows-after-ending` reads, and the rows it reports are exactly the ones that compile away.
 */
function isPlaybackEndRow(block: StoryBlock): boolean {
    return block.kind === "control" && (block.payload.control === "ending" || block.payload.control === "quit");
}

/**
 * Every sibling list in a scene: its root rows, then each container's children.
 *
 * A list is the unit a compile walks in order, so it is the unit "the rows after this one" means -
 * which is exactly what `story/rows-after-ending` is about, and why this is a walk of lists rather
 * than of blocks.
 */
function listsOfScene(scene: StoryScene): StoryBlockId[][] {
    const lists: StoryBlockId[][] = [scene.rootBlockIds];
    for (const block of Object.values(scene.blocks)) {
        if (block.childrenIds.length > 0) {
            lists.push(block.childrenIds);
        }
    }
    return lists;
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

export function storyLocation(entry: LintStoryEntry, scene: StoryScene, blockId?: StoryBlockId): LintLocation {
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

export function blockTarget(entry: LintStoryEntry, scene: StoryScene, blockId: StoryBlockId): SearchJumpTarget {
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
 * The project's character for an id, or undefined when the project has no character with it.
 *
 * The single answer to "does this reference resolve", asked by the two rules that need it from
 * opposite ends: {@link stageObjectLabel} asks so it can print the name an author would recognise,
 * and `story/character-missing` asks because a miss is the whole finding. A second copy of the
 * lookup would let the rule that stops a build disagree with the word the report prints.
 *
 * Deliberately returns the entry rather than its name: a character whose name is blank still exists,
 * and a lookup that answered with the name alone would report it as missing.
 */
function findProjectCharacter(ctx: LintContext, characterId: string): LintCharacterEntry | undefined {
    return ctx.characters.find(character => character.id === characterId);
}

/**
 * The reveal-time event tokens a row carries.
 *
 * Read off the payload's text segment by name rather than by walking the payload structurally,
 * because `event` is not a rare word in this schema and a loose scan would collect things that are
 * not tokens at all. Four payloads hold a segment and the choice is the one that calls it `prompt`;
 * a note is not among them, since an editor note reaches no player and its tokens never fire.
 */
function inlineEventRuns(block: StoryBlock): { event: StoryInlineEvent }[] {
    if (block.kind !== "nodeAction") {
        return [];
    }
    const payload = block.payload;
    const segment = payload.action === "choice" ? payload.prompt : payload.text;
    return (segment?.rich ?? []).filter((run): run is { event: StoryInlineEvent } => "event" in run);
}

/**
 * Whether a row names a character id the project has nothing for. See `story/character-missing`,
 * which states which of the three character-id sites are read and why the dialogue speaker is not.
 *
 * A blank id is not a miss. A character row that carries none addresses its portrait by stage name
 * instead, which is an ordinary row and already `story/stage-object-missing`'s question: there is no
 * reference to the character list to resolve, so there is nothing here to resolve it against.
 */
function namesMissingCharacter(ctx: LintContext, block: StoryBlock): boolean {
    const named: string[] = [];
    const collect = (id: string | undefined): void => {
        const trimmed = id?.trim();
        if (trimmed) {
            named.push(trimmed);
        }
    };
    if (block.kind === "action" && block.payload.action === "character") {
        collect(block.payload.characterId);
    }
    for (const run of inlineEventRuns(block)) {
        collect(run.event.expression?.characterId);
    }
    return named.some(id => !findProjectCharacter(ctx, id));
}

/**
 * The word to print for a stage object the scene never creates.
 *
 * The reference's LABEL, never its key: an unnamed sound keys on its asset id, and a UUID in a
 * report is a word nobody can search a project for.
 *
 * A character is the one kind whose label is not in the document either. It has no stage name until
 * an author types one, so it keys on its `characterId` and its label falls back to a placeholder -
 * while the name an author would recognise sits in the project's character list. Resolving it is the
 * only reason this rule reads anything outside the story, and it matters here more than anywhere:
 * a character is the most common subject in a script, and this rule stops a build.
 */
function stageObjectLabel(ctx: LintContext, reference: StageObjectReference): string {
    if (reference.subject === "character") {
        const name = findProjectCharacter(ctx, reference.name)?.name.trim();
        if (name) {
            return name;
        }
    }
    return reference.label;
}

/**
 * The sentence for a missing stage object, picked by what the row acts on.
 *
 * One shape, one varying clause, the way `blueprint/reference-missing` already names each kind it
 * can resolve. Half of what a report is for is the remedy, and a character has a different one:
 * nothing creates a character, an author brings it on stage. The story compiler states the same two
 * remedies on `reportMissingStageObject`, so a preview and a build give one answer.
 */
function stageObjectMessageKey(reference: StageObjectReference): TranslationKey {
    return reference.subject === "character"
        ? "lint.rule.storyStageObjectMissing.messageCharacter"
        : "lint.rule.storyStageObjectMissing.message";
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
/**
 * Blueprints that take the run away from the story that called them.
 *
 * `Start Game` moves the player into another story - or another scene of this one - and `Quit Game`
 * ends the run; either way the rows after the `/blueprint` that reached one never play. A project
 * whose routes are separate stories hands off exactly this way, because a `/jump` cannot leave the
 * document it is written in, so without this every route's last scene reads as a path that runs out.
 *
 * Read one blueprint deep, deliberately. A handoff written behind a function call is still reported,
 * which is a false positive rather than a missed defect - the opposite mistake would be to guess at
 * a chain and stay silent about a scene that really does stop.
 *
 * Walked through the carrier generator rather than `listBlueprintGraphSites`, for the same reason
 * the entry scan is: a story action's blueprint is reached by the id the row carries, not by an
 * owner record, so honouring that record here would answer "this row hands nothing on" for exactly
 * the rows this exists for.
 */
function collectHandoffBlueprintIds(ctx: LintContext): ReadonlySet<string> {
    const handoff = new Set<string>();
    for (const carrier of blueprintDocumentGraphCarriers(ctx.blueprintDocument)) {
        for (const node of Object.values(carrier.graph.nodes ?? {})) {
            if (node.type === BLUEPRINT_NODE_TYPE_GAME_START_STORY || node.type === BLUEPRINT_NODE_TYPE_GAME_QUIT) {
                handoff.add(carrier.blueprintId);
                break;
            }
        }
    }
    return handoff;
}

/** Whether this row is a `/blueprint` that hands the run to another story, or ends it. */
function isHandoffRow(block: StoryBlock, handoff: ReadonlySet<string>): boolean {
    return block.kind === "action"
        && block.payload.action === "blueprint"
        && handoff.has(block.payload.blueprintId);
}

function blockTerminates(
    scene: StoryScene,
    block: StoryBlock,
    seen: Set<StoryBlockId>,
    handoff: ReadonlySet<string>,
): boolean {
    if (seen.has(block.id)) {
        // Only a corrupt `childrenIds` cycle reaches here; a hang would be worse than a missed warning.
        return true;
    }
    seen.add(block.id);

    if (block.kind === "jump") {
        // A returnable jump is not where the scene stops: control comes back to the row after it,
        // so what terminates this scene is whatever follows.
        return !block.payload.returnable;
    }
    if (isHandoffRow(block, handoff)) {
        return true;
    }
    if (block.kind === "control") {
        if (block.payload.control === "goto") {
            return true;
        }
        // The one row that ends the story rather than handing it on. Terminating in the sense this
        // walk means it - the scene runs no further - which is why it belongs beside `goto` and not
        // in the transfer scan below: an ending hands control to nothing at all.
        if (block.payload.control === "ending") {
            return true;
        }
        // A quit ends the run rather than the story, but for this walk they are the same: the scene
        // runs no further, and control is not handed to another scene either.
        if (block.payload.control === "quit") {
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
            return hasElse && branches.every(branch => tailTerminates(scene, branch, seen, handoff));
        }
        // sequence / parallel / race / repeat are ordering, not choosing: the tail is the exit.
        return tailTerminates(scene, block, seen, handoff);
    }
    if (block.kind === "nodeAction" && block.payload.action === "choice") {
        const options = liveChildren(scene, block).filter(
            child => child.kind === "nodeAction" && child.payload.action === "choiceOption",
        );
        return options.length > 0 && options.every(option => tailTerminates(scene, option, seen, handoff));
    }
    return false;
}

/** Whether the last live child of a container terminates. A container with no live child does not. */
function tailTerminates(
    scene: StoryScene,
    block: StoryBlock,
    seen: Set<StoryBlockId>,
    handoff: ReadonlySet<string>,
): boolean {
    const children = liveChildren(scene, block);
    const last = children[children.length - 1];
    return last ? blockTerminates(scene, last, seen, handoff) : false;
}

/**
 * Whether the scene hands control on anywhere at all - a jump or a `/goto`, at any depth, on any
 * path. This is what separates "an ending" from "a forgotten branch"; see `story/dead-end`.
 *
 * A returnable jump does not count. The run leaves and comes straight back, so a scene whose only
 * jump is one of those has handed nothing on: it still stops where its rows stop.
 */
function hasOutgoingTransfer(scene: StoryScene, handoff: ReadonlySet<string>): boolean {
    return liveBlocks(scene).some(block =>
        (block.kind === "jump" && !block.payload.returnable)
        || gotoTarget(block) !== null
        || isHandoffRow(block, handoff));
}

/**
 * Every scene some returnable jump names, across the whole document.
 *
 * A called scene running off its end is a return, not a place the story stops - which is what
 * `story/dead-end` has to know before it reads the scene's last row. Collected per document rather
 * than per scene, because the call that reaches a scene can be written anywhere in the story.
 */
function collectCalledSceneIds(document: StoryDocument): Set<StorySceneId> {
    const called = new Set<StorySceneId>();
    for (const sceneId of listSceneIdsInDocumentOrder(document)) {
        const scene = document.scenes[sceneId];
        if (!scene) {
            continue;
        }
        for (const block of liveBlocks(scene)) {
            if (block.kind === "jump" && block.payload.returnable && block.payload.targetSceneId) {
                called.add(block.payload.targetSceneId);
            }
        }
    }
    return called;
}

/**
 * Where play can begin: the scene an author marked as a story's entry ("Set Entry Scene" in the
 * story panel) and every scene a blueprint's `Start Game` node names.
 *
 * The whole of it is {@link scanProjectStoryEntryPoints}, which is shared rather than local because
 * the `reachable-endings` test asks the same question - and a report that disagreed with a check
 * about where play begins would tell an author a scene is orphaned while another surface walks
 * straight through it.
 */
function collectEntryPoints(ctx: LintContext): StoryEntryPointScan {
    return scanProjectStoryEntryPoints(ctx.stories, ctx.blueprintDocument);
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
                        messageParams: { label: target },
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
                        messageParams: { label: duplicate.name },
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
                        messageParams: { label: label.name },
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
         * **The transfer precondition is a fallback, and it used to be the whole rule.** The story
         * action union had no end-of-game row, so a story's *final* scene was structurally identical
         * to a forgotten dead end: both simply stopped. Reporting every one of them is a rule an
         * author switches off in the first five minutes, and a rule that is off finds nothing at all
         * - so a scene with no jump and no `/goto` anywhere in it was read as a deliberate terminal
         * scene and stayed silent, at the cost of never reporting a wholly unfinished one.
         *
         * `/ending` is what removes the ambiguity, and this rule gets sharper exactly as far as a
         * project uses it. A scene ending in one terminates (see {@link blockTerminates}), so a
         * marked ending is silent by the ordinary path rather than by the fallback. And once a story
         * declares an ending anywhere, "no transfer" stops meaning "deliberate": the author has an
         * unambiguous way to say where the story stops, so a tail that neither hands control on nor
         * reaches an ending is a path that runs out, which is the finding this rule wanted to make
         * all along.
         *
         * A story with no `/ending` row keeps the old bargain exactly - the same scenes are reported
         * and the same ones are not - so adopting endings is what changes an existing project's
         * report, not upgrading Studio.
         */
        run(ctx) {
            const findings: LintFinding[] = [];
            const handoff = collectHandoffBlueprintIds(ctx);
            const calledByStoryId = new Map<string, Set<StorySceneId>>();
            for (const { entry, scene } of eachScene(ctx)) {
                const declaresEndings = listStoryEndings(entry.document).length > 0;
                let called = calledByStoryId.get(entry.id);
                if (!called) {
                    called = collectCalledSceneIds(entry.document);
                    calledByStoryId.set(entry.id, called);
                }
                if (called.has(scene.id)) {
                    // Something jumps here and expects to come back, so running off the end is that
                    // return rather than a path that stops. Exempted for the whole scene rather than
                    // per path: which of its rows a caller reaches is not a property of this scene.
                    continue;
                }
                const roots = liveRootBlocks(scene);
                const last = roots[roots.length - 1];
                if (!last) {
                    // `story/empty-scene` owns a scene with nothing live in it.
                    continue;
                }
                if (blockTerminates(scene, last, new Set(), handoff)) {
                    continue;
                }
                if (!declaresEndings && !hasOutgoingTransfer(scene, handoff)) {
                    // A deliberate ending, not a dead end - as far as a story that names none of its
                    // endings can be read.
                    continue;
                }
                findings.push({
                    ruleId: "story/dead-end",
                    messageKey: "lint.rule.storyDeadEnd.message",
                    location: storyLocation(entry, scene, last.id),
                    target: blockTarget(entry, scene, last.id),
                });
            }
            return findings;
        },
    },
    {
        id: "story/call-cycle",
        category: "story",
        defaultSeverity: "error",
        slug: "storyCallCycle",
        /**
         * A returnable jump that can lead back into the scene it was written in.
         *
         * `error`, and the reason is what the build produces rather than what the author meant: a
         * scene suspended by a call is still on stage, holding its layers, its sprites and its
         * scene-local variables, so there is nowhere to put a second copy of it. The engine refuses
         * the call outright, which means play stops on that row. A story that ships with one is a
         * story with a crash in it.
         *
         * Only returnable jumps form the graph. A plain jump unloads what it leaves, so a scene
         * reached through one is not on the call stack and reaching it again is ordinary looping -
         * which the flow map already draws and `story/dead-end` already reads.
         */
        run(ctx) {
            const findings: LintFinding[] = [];
            for (const entry of ctx.stories) {
                const document = entry.document;
                // The call graph, live rows only: a switched-off jump is a row the compiler drops,
                // so a cycle that exists only through one cannot happen at run time.
                type CallEdge = { targetSceneId: StorySceneId; scene: StoryScene; blockId: StoryBlockId };
                const callsBySceneId = new Map<StorySceneId, CallEdge[]>();
                for (const sceneId of listSceneIdsInDocumentOrder(document)) {
                    const scene = document.scenes[sceneId];
                    if (!scene) {
                        continue;
                    }
                    const calls: CallEdge[] = [];
                    for (const block of liveBlocks(scene)) {
                        if (block.kind !== "jump" || !block.payload.returnable) {
                            continue;
                        }
                        const targetSceneId = block.payload.targetSceneId;
                        if (!targetSceneId || !document.scenes[targetSceneId]) {
                            // `story/jump-missing` owns a jump that names nothing.
                            continue;
                        }
                        calls.push({ targetSceneId, scene, blockId: block.id });
                    }
                    if (calls.length > 0) {
                        callsBySceneId.set(sceneId, calls);
                    }
                }

                // Depth-first, reporting the call that closes the loop rather than every row on it:
                // that is the one row the author has to change, and the rest of the chain is
                // legitimate on its own.
                const state = new Map<StorySceneId, "open" | "done">();
                const reported = new Set<StoryBlockId>();
                const visit = (sceneId: StorySceneId): void => {
                    state.set(sceneId, "open");
                    for (const call of callsBySceneId.get(sceneId) ?? []) {
                        const mark = state.get(call.targetSceneId);
                        if (mark === "open") {
                            if (!reported.has(call.blockId)) {
                                reported.add(call.blockId);
                                findings.push({
                                    ruleId: "story/call-cycle",
                                    messageKey: "lint.rule.storyCallCycle.message",
                                    location: storyLocation(entry, call.scene, call.blockId),
                                    target: blockTarget(entry, call.scene, call.blockId),
                                });
                            }
                            continue;
                        }
                        if (mark !== "done") {
                            visit(call.targetSceneId);
                        }
                    }
                    state.set(sceneId, "done");
                };
                for (const sceneId of listSceneIdsInDocumentOrder(document)) {
                    if (!state.has(sceneId)) {
                        visit(sceneId);
                    }
                }
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
            const { byStory, undecidable } = collectEntryPoints(ctx);
            // Guard (mandatory): a rule that flags every scene because it could not find the entry is
            // worse than no rule. A wired `Start Game` target silences the rule project-wide, and a
            // story with no entry of its own is skipped rather than declared entirely unreachable.
            if (undecidable.length > 0 || byStory.size === 0) {
                return [];
            }

            const findings: LintFinding[] = [];
            for (const entry of ctx.stories) {
                const entrySceneIds = byStory.get(entry.id);
                if (!entrySceneIds || entrySceneIds.size === 0) {
                    continue;
                }
                // `none`, not the document-order fallback the build sweep takes: the entries above
                // are the whole claim this rule makes, and guessing at a story with no marked entry
                // would declare every scene but the first one unreachable.
                const reachable = reachableSceneIds(entry.document, { entrySceneIds, fallback: "none" });
                for (const scene of listScenesInDocumentOrder(entry.document)) {
                    if (!scene || reachable.has(scene.id)) {
                        continue;
                    }
                    findings.push({
                        ruleId: "story/unreachable-scene",
                        messageKey: "lint.rule.storyUnreachableScene.message",
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
                    location: storyLocation(entry, scene),
                    target: sceneTarget(entry, scene),
                });
            }
            return findings;
        },
    },
    {
        /**
         * `AppTag == "Demo"` where the project has no variant called `Demo`.
         *
         * A warning rather than an error, and never a build gate: the comparison is perfectly
         * well-formed and folds to a constant `false`, so nothing is broken - what it means is that
         * the content behind it ships in no build at all. Deleting a variant on purpose is an
         * ordinary thing to do, and it must not lock the author out of every build until they have
         * been through every row that named it.
         *
         * Names are compared exactly, case included, because that is what the fold does.
         */
        id: "story/app-tag-unknown",
        category: "story",
        defaultSeverity: "warning",
        slug: "storyAppTagUnknown",
        run(ctx) {
            const findings: LintFinding[] = [];
            const known = new Set(ctx.appTags.map(tag => tag.name));
            for (const { entry, scene } of eachScene(ctx)) {
                for (const block of liveBlocks(scene)) {
                    for (const name of appTagNamesNamedByBlock(block)) {
                        if (known.has(name)) {
                            continue;
                        }
                        findings.push({
                            ruleId: "story/app-tag-unknown",
                            messageKey: "lint.rule.storyAppTagUnknown.message",
                            messageParams: { name },
                            location: storyLocation(entry, scene, block.id),
                            target: blockTarget(entry, scene, block.id),
                        });
                    }
                }
            }
            return findings;
        },
    },
    {
        /**
         * Cut points written in the script while the project has no variant that could honour one.
         *
         * The `/cut` command is only offered where a variant exists, so this is what deleting the
         * last variant leaves behind: the rows stay written and stop taking effect, which is
         * deliberate - deleting a variant must not sweep the author's script - and the deletion
         * confirmation says so at the time. This is the reminder afterwards, when it has been
         * forgotten and the rows read as endings that end nothing.
         *
         * A warning, and never a build gate: the rows are inert, so nothing they can do is wrong.
         * The remedy is either half of what the confirmation described - add a variant back, or
         * delete the rows - and the finding lands on the row so the second one is a click away.
         */
        id: "story/cut-point-orphan",
        category: "story",
        defaultSeverity: "warning",
        slug: "storyCutPointOrphan",
        run(ctx) {
            // The release variant is always in the list and can never be cut to, so a project with
            // nothing else has no variant a cut point could name.
            if (ctx.appTags.some(tag => !isBuiltinAppTagId(tag.id))) {
                return [];
            }
            const findings: LintFinding[] = [];
            for (const entry of ctx.stories) {
                for (const cut of collectCutPoints(entry.document)) {
                    const scene = entry.document.scenes[cut.sceneId];
                    if (!scene) {
                        continue;
                    }
                    findings.push({
                        ruleId: "story/cut-point-orphan",
                        messageKey: "lint.rule.storyCutPointOrphan.message",
                        location: storyLocation(entry, scene, cut.blockId),
                        target: blockTarget(entry, scene, cut.blockId),
                    });
                }
            }
            return findings;
        },
    },
    {
        /**
         * A cut point in a scene nothing can reach.
         *
         * The row will never run, so the variant it names ships the whole story with an ending the
         * author believes is in it. Different from `story/unreachable-scene`, which reports the
         * scene: this one is worth saying separately because an unreachable scene is often a draft
         * an author is deliberately parking, while a cut point inside one is a build decision that
         * has quietly stopped applying.
         *
         * Shares that rule's guard exactly, and must: entry points that cannot be read make every
         * scene look unreachable, and a rule that flagged every cut point in the project because it
         * could not find the entry is a rule an author switches off in the first five minutes.
         */
        id: "story/cut-point-unreachable",
        category: "story",
        defaultSeverity: "warning",
        slug: "storyCutPointUnreachable",
        run(ctx) {
            const { byStory, undecidable } = collectEntryPoints(ctx);
            if (undecidable.length > 0 || byStory.size === 0) {
                return [];
            }
            const findings: LintFinding[] = [];
            for (const entry of ctx.stories) {
                const entrySceneIds = byStory.get(entry.id);
                if (!entrySceneIds || entrySceneIds.size === 0) {
                    continue;
                }
                // `none`, the same policy `story/unreachable-scene` takes and for the same reason:
                // the entries above are the whole claim, and guessing at a story with no marked
                // entry would call every scene but the first one unreachable.
                const reachable = reachableSceneIds(entry.document, { entrySceneIds, fallback: "none" });
                for (const cut of collectCutPoints(entry.document)) {
                    const scene = entry.document.scenes[cut.sceneId];
                    if (!scene || reachable.has(cut.sceneId)) {
                        continue;
                    }
                    findings.push({
                        ruleId: "story/cut-point-unreachable",
                        messageKey: "lint.rule.storyCutPointUnreachable.message",
                        location: storyLocation(entry, scene, cut.blockId),
                        target: blockTarget(entry, scene, cut.blockId),
                    });
                }
            }
            return findings;
        },
    },
    {
        /**
         * A row written after an `/ending` or a `/quit` in the same list.
         *
         * It never plays. The engine has no way to be stopped mid-story, so the compiler drops
         * everything after either of them in the list that holds it - which is correct, and
         * completely invisible on the page. This rule is what makes it visible.
         *
         * Anchored on the FIRST such row rather than on the ending, and one finding per list: the
         * rows are the surprise, and repeating the same sentence for each of twelve of them buries
         * the report.
         *
         * Deliberately narrow. A row after the `if` that contains an ending is not reported, because
         * whether it plays depends on which arm ran - that is a live path, not a dead one.
         */
        id: "story/rows-after-ending",
        category: "story",
        defaultSeverity: "warning",
        slug: "storyRowsAfterEnding",
        run(ctx) {
            const findings: LintFinding[] = [];
            for (const { entry, scene } of eachScene(ctx)) {
                for (const listIds of listsOfScene(scene)) {
                    const live = listIds
                        .map(id => scene.blocks[id])
                        .filter((block): block is StoryBlock => Boolean(block) && !block!.disabled);
                    const at = live.findIndex(isPlaybackEndRow);
                    const orphan = at >= 0 ? live[at + 1] : undefined;
                    if (!orphan) {
                        continue;
                    }
                    findings.push({
                        ruleId: "story/rows-after-ending",
                        messageKey: "lint.rule.storyRowsAfterEnding.message",
                        location: storyLocation(entry, scene, orphan.id),
                        target: blockTarget(entry, scene, orphan.id),
                    });
                }
            }
            return findings;
        },
    },
    {
        /**
         * A `/quit` row with no page, or with one this project no longer has.
         *
         * An error rather than a warning, and the reason is what ships: the row is the only way out
         * of the scene that holds it - everything after it in the same list is dropped at compile
         * time - so a quit that cannot land leaves the player on a last frame with no story behind
         * it and nothing to touch. There is no degraded behaviour to fall back on the way a missing
         * ending page has one (the last frame is a *choice* an ending may make); here it is simply
         * a run that cannot be left.
         *
         * The two cases are one rule because they are one question and one fix - point the row at a
         * page - and their messages differ only in whether there is a name to report.
         */
        id: "story/quit-page-missing",
        category: "story",
        defaultSeverity: "error",
        slug: "storyQuitPageMissing",
        run(ctx) {
            const findings: LintFinding[] = [];
            // Null when the project's interface document could not be read at all. Every page would
            // then look deleted, and a rule that fails the build for every quit row in the project
            // because it could not open one file is worse than the defect it is looking for.
            const surfaces = ctx.uiDocument
                ? new Set(ctx.uiDocument.surfaces.map(surface => surface.id))
                : null;
            for (const { entry, scene } of eachScene(ctx)) {
                for (const block of liveBlocks(scene)) {
                    if (block.kind !== "control" || block.payload.control !== "quit") {
                        continue;
                    }
                    const surfaceId = block.payload.surfaceId.trim();
                    if (surfaceId && (!surfaces || surfaces.has(surfaceId))) {
                        continue;
                    }
                    findings.push({
                        ruleId: "story/quit-page-missing",
                        messageKey: surfaceId
                            ? "lint.rule.storyQuitPageMissing.deleted"
                            : "lint.rule.storyQuitPageMissing.message",
                        ...(surfaceId ? { messageParams: { page: surfaceId } } : {}),
                        location: storyLocation(entry, scene, block.id),
                        target: blockTarget(entry, scene, block.id),
                    });
                }
            }
            return findings;
        },
    },
    {
        /**
         * Two endings called the same thing.
         *
         * Not a defect - nothing breaks, and both endings keep their own identity, because every
         * record and every reference keys on the row's id rather than on this name. It is reported
         * because the name is the one part a *player* sees: an endings screen listing "Bad End"
         * twice cannot say which of them is still missing.
         *
         * Anchored on the later row, which is the one to rename; the first keeps the name.
         */
        id: "story/ending-name-duplicate",
        category: "story",
        defaultSeverity: "info",
        slug: "storyEndingNameDuplicate",
        run(ctx) {
            const findings: LintFinding[] = [];
            for (const entry of ctx.stories) {
                for (const ending of duplicateStoryEndingNames(entry.document)) {
                    const scene = entry.document.scenes[ending.sceneId];
                    if (!scene) {
                        continue;
                    }
                    findings.push({
                        ruleId: "story/ending-name-duplicate",
                        messageKey: "lint.rule.storyEndingNameDuplicate.message",
                        messageParams: { name: ending.name },
                        location: storyLocation(entry, scene, ending.endingId),
                        target: blockTarget(entry, scene, ending.endingId),
                    });
                }
            }
            return findings;
        },
    },
    {
        /**
         * A row acting on a stage object no row in its scene creates.
         *
         * `error`, and the only lint rule whose verdict is computed somewhere else on purpose. The
         * story compiler asks the same question of the same row while building a preview and reports
         * the same miss - but a compile diagnostic reaches the Story console and stops nothing, and
         * an image that never appears is exactly the kind of thing that ships. So the judgement lives
         * in `@shared/types/story/stageObjects` and both callers read it: this rule is the half that
         * refuses a build, `reportMissingStageObject` is the half an author sees while writing.
         *
         * Anything that reading can settle differently is settled the quiet way. The scene is read
         * whole, so a `/show` written above its `create` row is not a finding here even though the
         * compiler's in-order walk reports it; the reserved music channel is exempt, because a
         * `/bgm` in an earlier scene is still playing in this one and no single scene can see that.
         */
        id: "story/stage-object-missing",
        category: "story",
        defaultSeverity: "error",
        slug: "storyStageObjectMissing",
        run(ctx) {
            const findings: LintFinding[] = [];
            for (const { entry, scene } of eachScene(ctx)) {
                for (const reference of danglingStageObjectRefs(scene)) {
                    findings.push({
                        ruleId: "story/stage-object-missing",
                        messageKey: stageObjectMessageKey(reference),
                        messageParams: { object: stageObjectLabel(ctx, reference) },
                        location: storyLocation(entry, scene, reference.blockId),
                        target: blockTarget(entry, scene, reference.blockId),
                    });
                }
            }
            return findings;
        },
    },
    {
        /**
         * Something declared and never shown.
         *
         * A `create` row names an object, sources it and poses it, and leaves it invisible - `/show`
         * is what reveals it. So a declaration nothing ever shows is an object the player never sees,
         * and the row that made it did nothing at all.
         *
         * `warning`, not error, on the criterion the whole set follows: an author part-way through a
         * scene has declarations they have not shown yet, and refusing a build for a draft is how a
         * rule gets switched off. What makes it worth reporting anyway is that this is the failure
         * mode of documents written before the split, where `create` DID reveal - every one of those
         * rows now declares and stops there, and nothing else in the project says so.
         *
         * Two spans, because the objects have two lifetimes. An image, a text or a video belongs to
         * its scene and can only be shown inside it. An ambience overlay is game-level - rain started
         * in one scene is still falling in the next - so its reveal may be in any scene, and reading
         * one scene at a time would report every overlay declared in a prologue and shown later.
         */
        id: "story/declared-never-shown",
        category: "story",
        defaultSeverity: "warning",
        slug: "storyDeclaredNeverShown",
        run(ctx) {
            const findings: LintFinding[] = [];
            for (const entry of ctx.stories) {
                const scenes = listScenesInDocumentOrder(entry.document);
                const shownByScene = new Map<string, ReadonlySet<string>>();
                const shownAnywhere = new Set<string>();
                for (const scene of scenes) {
                    const shown = shownStageObjectKeys(scene);
                    shownByScene.set(scene.id, shown);
                    for (const key of shown) {
                        shownAnywhere.add(key);
                    }
                }
                for (const scene of scenes) {
                    for (const declaration of revealableStageObjectDeclarations(scene)) {
                        const key = `${declaration.kind}:${declaration.name}`;
                        const shown = declaration.kind === "vfx"
                            ? shownAnywhere.has(key)
                            : shownByScene.get(scene.id)?.has(key) === true;
                        if (shown) {
                            continue;
                        }
                        findings.push({
                            ruleId: "story/declared-never-shown",
                            messageKey: "lint.rule.storyDeclaredNeverShown.message",
                            messageParams: { object: declaration.label },
                            location: storyLocation(entry, scene, declaration.blockId),
                            target: blockTarget(entry, scene, declaration.blockId),
                        });
                    }
                }
            }
            return findings;
        },
    },
    {
        /**
         * Two rows creating one stage name.
         *
         * `warning`, and deliberately not an error. The object exists and the engine's behaviour is
         * settled - the constructors are get-or-create, so the second row hands back the first row's
         * object and its own asset or text goes nowhere. What cannot be settled is the intent: an
         * author writing two rows may have meant two objects and misspelled the second name, or may
         * have meant to re-dress the first. `diagnostic()` in the story compiler states the rule this
         * follows - error is for what a reading can PROVE the document does not contain, warning for
         * what it cannot settle by itself - and which of two intents was meant is not provable.
         */
        id: "story/stage-object-duplicate",
        category: "story",
        defaultSeverity: "warning",
        slug: "storyStageObjectDuplicate",
        run(ctx) {
            const findings: LintFinding[] = [];
            for (const { entry, scene } of eachScene(ctx)) {
                // The first declaration stands, so the scan anchors the later rows - the same
                // anchoring `story/label-duplicate` uses, and for the same reason.
                for (const duplicate of duplicateStageObjectDeclarations(scene)) {
                    findings.push({
                        ruleId: "story/stage-object-duplicate",
                        messageKey: "lint.rule.storyStageObjectDuplicate.message",
                        messageParams: { object: duplicate.label },
                        location: storyLocation(entry, scene, duplicate.blockId),
                        target: blockTarget(entry, scene, duplicate.blockId),
                    });
                }
            }
            return findings;
        },
    },
    {
        /**
         * A row naming a character the project does not have.
         *
         * `error`, because every remaining reading of the row is a wrong one. The story compiler's
         * `getCharacter` falls back to a placeholder name so a preview still runs, and a portrait
         * lookup against an id nothing answers to simply finds nothing - so what an unresolved id
         * ships as is a speaker labelled with a word the author never wrote, or a character who
         * never appears. Neither says anything about itself on screen.
         *
         * A character id is stored in three places and this rule reads two of them:
         *
         *  - A **character action** (`/show`, `/hide`, `/face`, `/setname`, the puppet channels) has
         *    no field beside the id saying who the row is about, so an id that resolves to nothing
         *    leaves the row addressing nobody.
         *  - An **inline expression event** - the reveal-time portrait switch a line can carry - is
         *    the same case one level down: the token stores an id alone.
         *  - A **dialogue row's speaker is deliberately out of scope.** A speaker with no character
         *    record behind it is a first-class shippable state rather than a defect: NarraLeaf's
         *    dialogue box displays whatever name its `Character` carries, which is why the payload
         *    has a `speakerName` field and why an unresolved speaker degrades to it. Reporting that
         *    here would call a working line broken. An inline event inside such a row is still
         *    reported, because it has no bare-name arm to degrade to.
         *
         * An id is the only thing a miss leaves behind, and an id is a UUID, so the sentence names
         * no subject: printing the stored id would put a word in a report that nobody can search a
         * project for. The row itself is the answer, and the finding carries the jump to it.
         */
        id: "story/character-missing",
        category: "story",
        defaultSeverity: "error",
        slug: "storyCharacterMissing",
        run(ctx) {
            const findings: LintFinding[] = [];
            for (const { entry, scene } of eachScene(ctx)) {
                for (const block of liveBlocks(scene)) {
                    if (!namesMissingCharacter(ctx, block)) {
                        continue;
                    }
                    findings.push({
                        ruleId: "story/character-missing",
                        messageKey: "lint.rule.storyCharacterMissing.message",
                        location: storyLocation(entry, scene, block.id),
                        target: blockTarget(entry, scene, block.id),
                    });
                }
            }
            return findings;
        },
    },
    {
        /**
         * A row naming a transition this build will not play.
         *
         * `error`, and the same arrangement as `story/stage-object-missing`, for the same reason:
         * the story compiler reaches the same verdict on the same row while building a preview, but
         * a compile diagnostic reaches the Story console and stops nothing. A change that lands as a
         * cut instead of the transition the author chose looks deliberate on screen and says nothing
         * about itself, which is exactly the kind of thing that ships.
         *
         * The two halves reach that verdict by different roads and still cannot disagree.
         * `createTransition` decides by its `switch`, which TypeScript holds exhaustive over the
         * union; this rule decides by `isPlayableStoryTransitionKind`, which reads the tuple that
         * union is derived from. A kind added to one is a compile error in the other.
         *
         * What reaches it is a stored `kind` this build has no engine for: a document written by a
         * newer Studio, one carrying a kind that has since been retired, or the `custom` escape
         * hatch, which the union has always allowed and nothing has ever built. No Studio surface
         * can produce one - the inspector offers only kinds it knows and the script language cannot
         * name one at all - so a clean project never sees this rule, and a project that does see it
         * has a row whose transition is genuinely gone.
         */
        id: "story/transition-unavailable",
        category: "story",
        defaultSeverity: "error",
        slug: "storyTransitionUnavailable",
        run(ctx) {
            const findings: LintFinding[] = [];
            for (const { entry, scene } of eachScene(ctx)) {
                for (const block of liveBlocks(scene)) {
                    const kind = transitionKindNamedByBlock(block);
                    if (kind === null || isPlayableStoryTransitionKind(kind)) {
                        continue;
                    }
                    findings.push({
                        ruleId: "story/transition-unavailable",
                        messageKey: "lint.rule.storyTransitionUnavailable.message",
                        messageParams: { transition: kind },
                        location: storyLocation(entry, scene, block.id),
                        target: blockTarget(entry, scene, block.id),
                    });
                }
            }
            return findings;
        },
    },
    {
        /**
         * A row changing the background to the picture the stage is already showing.
         *
         * The player watches the transition run its full length and the frame is the same at both
         * ends of it - a scene that opens on its own default background and then dissolves through
         * black back to that same background sits there for a second doing nothing. The row reads
         * perfectly well: it names a background and a transition, and neither the row nor the
         * inspector says what the stage held a moment earlier, so there is nowhere on the interface
         * this is visible.
         *
         * `warning`. The player really does see it, and it is time nobody chose to spend, but the
         * game that ships is still the game the row describes - the picture the author named is the
         * picture on screen when the transition ends. That falls short of the `error` clause
         * ("severely different from what was authored"), which is where a missing image or a
         * transition this build cannot play sits.
         *
         * What is already on screen comes from {@link computeStoryStageSnapshot} - the walk Dev
         * Mode, the scene preview and a row-precise `launch` all use to pre-pose the stage. Nothing
         * here re-derives it: the snapshot stops immediately before the target row, and its `null`
         * background composes with `defaultBackgroundAssetId` exactly the way the story compiler
         * composes the two ("snapshot background wins; otherwise the scene's default initial
         * background"). So the state this rule calls "already showing" is the very frame Studio
         * would put on stage if the author pressed play on that row.
         *
         * Three things it deliberately stays quiet about, because a rule that fires on work in
         * progress gets switched off:
         *
         *  - **A cut.** A row with no transition, one that names `none`, one with a zero duration,
         *    and one whose transition this build cannot play, all land instantly. Re-stating the
         *    background costs nothing then, and it is how an author pins the background down at a
         *    scene entered from several places.
         *  - **A background that has been posed or graded.** A `/transform` on the background or on
         *    the background layer leaves something other than the plain picture on screen - faded
         *    out, masked, darkened - so a transition back to it has a change to play after all.
         *  - **A row that names neither an image nor a colour.** There is no background for it to
         *    be the same as.
         */
        id: "story/background-unchanged",
        category: "story",
        defaultSeverity: "warning",
        slug: "storyBackgroundUnchanged",
        run(ctx) {
            const findings: LintFinding[] = [];
            for (const { entry, scene } of eachScene(ctx)) {
                /**
                 * Every background that could be on screen anywhere in this scene, as the walk goes
                 * past: the scene's own default, plus each one a row before this point puts up.
                 *
                 * A gate, not an answer. Each snapshot below costs a walk from the scene's first row,
                 * so asking for one per background row is quadratic in a scene's background rows -
                 * measured at 80 walks crossing 21,044 rows on a 4,026-row project, which made this
                 * the most expensive rule in the story set by four times over. Anything the walk can
                 * have executed before a row precedes that row in document order, so this set is a
                 * superset of what may be showing there and a row naming something outside it cannot
                 * be a finding. It halved the work on that project (34 walks, 9,746 rows) and it
                 * cannot change a verdict: what IS showing still comes from the walk alone.
                 */
                const mayBeShowing = new Set<string>();
                const showingKey = (background: BackgroundOnStage): string =>
                    "assetId" in background ? `asset:${background.assetId}` : `color:${background.color.toLowerCase()}`;
                const sceneDefault = backgroundOf(scene.defaultBackgroundAssetId, undefined);
                if (sceneDefault) {
                    mayBeShowing.add(showingKey(sceneDefault));
                }
                for (const block of liveBlocks(scene)) {
                    if (block.kind !== "action" || block.payload.action !== "setBackground") {
                        continue;
                    }
                    const wanted = backgroundNamedByRow(block.payload);
                    if (!wanted) {
                        continue;
                    }
                    const couldAlreadyBeShowing = mayBeShowing.has(showingKey(wanted));
                    // After the test and before the walk: this row's own picture is on screen for the
                    // rows below it, not for itself.
                    mayBeShowing.add(showingKey(wanted));
                    if (!couldAlreadyBeShowing || transitionVisibleMs(block.payload.transition) <= 0) {
                        continue;
                    }
                    // No cast: this rule reads the background and nothing else, and a character's
                    // entrance defaults cannot reach a background prop.
                    const snapshot = computeStoryStageSnapshot({
                        document: entry.document,
                        sceneId: scene.id,
                        targetBlockId: block.id,
                    });
                    if (Object.keys(snapshot.backgroundProps).length > 0
                        || Object.keys(snapshot.backgroundEffects).length > 0
                        || Object.keys(snapshot.builtinLayerProps.backgroundLayer).length > 0) {
                        continue;
                    }
                    const showing = snapshot.background
                        ? backgroundOf(snapshot.background.assetId, snapshot.background.color)
                        : sceneDefault;
                    if (!showing || !sameBackground(showing, wanted)) {
                        continue;
                    }
                    findings.push({
                        ruleId: "story/background-unchanged",
                        messageKey: "lint.rule.storyBackgroundUnchanged.message",
                        location: storyLocation(entry, scene, block.id),
                        target: blockTarget(entry, scene, block.id),
                    });
                }
            }
            return findings;
        },
    },
];

/** Either half of what a background can be. Asset and colour never compare equal. */
type BackgroundOnStage = { assetId: string } | { color: string };

/** One of the two arms, or null when neither field carries anything. */
function backgroundOf(assetId: string | undefined, color: string | undefined): BackgroundOnStage | null {
    const asset = assetId?.trim();
    if (asset) {
        return { assetId: asset };
    }
    const paint = color?.trim();
    return paint ? { color: paint } : null;
}

/** What a `setBackground` row puts up, read the way the snapshot walker reads it: asset before colour. */
function backgroundNamedByRow(payload: Extract<StoryActionPayload, { action: "setBackground" }>): BackgroundOnStage | null {
    return backgroundOf(payload.assetId, payload.color);
}

/**
 * Whether two backgrounds are the same picture.
 *
 * Colours are compared case-insensitively because `#FFF` and `#fff` are one colour and both spellings
 * reach the document - the inspector's picker writes lower case, a pasted value keeps whatever it had.
 * Asset ids are not: they are ids, and two that differ in case are two assets.
 */
function sameBackground(a: BackgroundOnStage, b: BackgroundOnStage): boolean {
    if ("assetId" in a && "assetId" in b) {
        return a.assetId === b.assetId;
    }
    if ("color" in a && "color" in b) {
        return a.color.toLowerCase() === b.color.toLowerCase();
    }
    return false;
}

/**
 * How long the transition a row names occupies the screen, in milliseconds. `0` means a cut.
 *
 * Read exactly the way `createTransition` reads it, because the answer has to be the compiler's:
 * the kind through {@link storyTransitionKindOf} (an absent or blank one is the author asking for a
 * cut, not a transition this build lost), and the duration through the same `?? 300` default, so a
 * row that states a kind and no duration is correctly read as three tenths of a second rather than
 * as nothing.
 *
 * `holdMs` adds nothing to the total: a hold is split off the two moving halves rather than added to
 * them, so `{durationMs: 4000, holdMs: 2000}` still occupies four seconds.
 *
 * Two kinds are cuts however they are written. One this build cannot play is downgraded to a cut and
 * already belongs to `story/transition-unavailable`; a `ruleReveal` with no rule image is downgraded
 * the same way, by the compiler, on the row that forgot the picture.
 */
function transitionVisibleMs(transition: StoryTransitionRef | undefined): number {
    if (!transition) {
        return 0;
    }
    const kind = storyTransitionKindOf(transition);
    if (kind === "none" || !isPlayableStoryTransitionKind(kind)) {
        return 0;
    }
    if (kind === "ruleReveal" && !transition.ruleAssetId) {
        return 0;
    }
    return Math.max(0, transition.durationMs ?? 300);
}

/**
 * The transition kind a row names, or `null` for a row that names none.
 *
 * Read off `payload.transition` by name, unlike {@link appTagNamesNamedByBlock} below, which walks
 * its payload structurally. `kind` is one of the most reused words in this schema - a layer
 * reference, a displayable target and the row itself each carry one - so a structural scan for
 * `kind` would report layers as transitions. Every payload that holds a `StoryTransitionRef` calls
 * the field `transition` (`setBackground`, `character`, `displayable`, and a jump's), so the field
 * name is the precise test and the structural one is the loose one.
 *
 * The `kind` must be a string, not merely present: the NVL panel's `transition` is a transform ref,
 * which has no `kind` at all, and is not this rule's business. Neither is a transition ref whose own
 * `kind` is missing or blank - {@link storyTransitionKindOf} reads that as `none`, the compiler
 * reads it the same way, and a cut a row asked for is not a transition it failed to get.
 */
function transitionKindNamedByBlock(block: StoryBlock): string | null {
    const transition = (block.payload as { transition?: unknown }).transition;
    if (!transition || typeof transition !== "object") {
        return null;
    }
    const kind = storyTransitionKindOf(transition as { kind?: unknown });
    return kind === "none" ? null : kind;
}

/**
 * Every variant name one row compares `AppTag` against.
 *
 * The payload is walked structurally rather than field by field, for the reason the fold does the
 * same: an expression sits in a branch condition, a choice option's two conditions, a loop's
 * `until`, an assignment and an inline interpolation, and a list of those would be one edit behind
 * the next schema version. A row that names the same variant twice reports it once.
 */
function appTagNamesNamedByBlock(block: StoryBlock): string[] {
    const found: string[] = [];
    const seen = new Set<string>();
    const walk = (value: unknown, visited: Set<object>): void => {
        if (!value || typeof value !== "object") {
            return;
        }
        const expression = value as { source?: unknown; ast?: unknown };
        if (typeof expression.source === "string" && expression.ast && typeof expression.ast === "object") {
            for (const name of collectAppTagComparisonNames(expression.ast as StoryExpr)) {
                if (!seen.has(name)) {
                    seen.add(name);
                    found.push(name);
                }
            }
            return;
        }
        if (visited.has(value)) {
            return;
        }
        visited.add(value);
        for (const child of Array.isArray(value) ? value : Object.values(value)) {
            walk(child, visited);
        }
    };
    walk(block.payload, new Set<object>());
    return found;
}
