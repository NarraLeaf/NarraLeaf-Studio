import { hasScriptLayer } from "@shared/blueprint/blueprintLayers";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import {
    collectStoryExpressionVariables,
    listSceneBlocksInDocumentOrder,
    listScenesInDocumentOrder,
    storyVariableRefKey,
    type StoryBlock,
    type StoryBlockId,
    type StoryConditionRef,
    type StoryDocument,
    type StoryScene,
    type StorySceneId,
    type StoryVariableRef,
} from "@shared/types/story";
import { collectBlueprintVariableWrites } from "@/apps/workspace/modules/story-flow/sceneFlowVariables";
import type { LintContext } from "../context";

/**
 * What the script *tests*, and what the project *writes* — the two halves a check about flags needs
 * and the two halves nothing in Studio separated before.
 *
 * `variables/unused` counts a read and a write alike: its question is whether a declaration is dead,
 * and a variable named anywhere is alive. That answer is right for that rule and useless for this
 * one, because "a condition reads it and nothing ever sets it" is precisely a variable that IS used
 * and IS broken. Both scans therefore live here rather than being folded into that one's `VariableUse`.
 *
 * # Where a guard can be
 *
 * Four `StoryConditionRef` slots, and there are only four: an `if` arm's `condition`, a `repeat`'s
 * `until`, and an option's `hiddenWhen` / `disabledWhen`. Every one of them decides whether the
 * player sees something, which is why a guard nothing can move is a piece of the game nobody reaches.
 * A dialogue line interpolating a variable is deliberately NOT a guard: it prints the default, which
 * is a legible outcome rather than a route that never opens.
 *
 * # What counts as writing one
 *
 * A `setVariable` row anywhere in the library, **including a disabled one**, plus every variable the
 * project's blueprints may assign. The disabled row is the same bargain `variables/unused` strikes:
 * a row switched off for the afternoon is still a place the author writes the variable, and a
 * complaint about it is a complaint about work in progress.
 *
 * # When these answers must not be used at all
 *
 * {@link hasUnreadableWriter} is the honest limit. A plugin's marker row is interpreted by that
 * plugin's own compile pass, and a `scriptModule` blueprint is TypeScript: neither can be read here,
 * and either could be the thing that sets the flag. A project holding one gets no findings from the
 * rules built on this file rather than a confident wrong one.
 */

/** One `StoryConditionRef` and the row that carries it. */
export type StoryGuardSite = {
    condition: StoryConditionRef;
    sceneId: StorySceneId;
    blockId: StoryBlockId;
    /** Which slot it is, so a message can say `if` rather than "a condition". */
    slot: "if" | "until" | "hiddenWhen" | "disabledWhen";
};

/**
 * Every guard in one scene, in document order.
 *
 * Disabled subtrees are pruned: a guard the compiler drops cannot gate anything a player meets, and
 * reporting one is reporting a row that is already switched off.
 */
export function collectStoryGuards(scene: StoryScene): StoryGuardSite[] {
    const guards: StoryGuardSite[] = [];
    const push = (
        condition: StoryConditionRef | undefined,
        blockId: StoryBlockId,
        slot: StoryGuardSite["slot"],
    ): void => {
        if (condition) {
            guards.push({ condition, sceneId: scene.id, blockId, slot });
        }
    };
    const blocks = listSceneBlocksInDocumentOrder(scene, { skipSubtree: block => block.disabled === true });
    for (const block of blocks) {
        if (block.kind === "control") {
            if (block.payload.control === "conditionBranch") {
                push(block.payload.condition, block.id, "if");
            } else if (block.payload.control === "repeat") {
                push(block.payload.until, block.id, "until");
            }
            continue;
        }
        if (block.kind === "nodeAction" && "hiddenWhen" in block.payload) {
            push(block.payload.hiddenWhen, block.id, "hiddenWhen");
            push(block.payload.disabledWhen, block.id, "disabledWhen");
        }
    }
    return guards;
}

/**
 * The variables one guard reads, as ref keys.
 *
 * A `blueprint` condition returns nothing — not because it reads nothing, but because what it reads
 * is inside a graph. Returning an empty list there is what makes a caller's "this guard tests only
 * variables nothing writes" test fail closed on it.
 */
export function guardVariableKeys(condition: StoryConditionRef): string[] {
    if (condition.kind === "variable") {
        return [storyVariableRefKey(condition.target)];
    }
    if (condition.kind === "expression") {
        return collectStoryExpressionVariables(condition.expression.ast).map(storyVariableRefKey);
    }
    return [];
}

/** The refs one guard reads, keeping the ref itself for a message that wants the author's name. */
export function guardVariableRefs(condition: StoryConditionRef): StoryVariableRef[] {
    if (condition.kind === "variable") {
        return [condition.target];
    }
    if (condition.kind === "expression") {
        return collectStoryExpressionVariables(condition.expression.ast);
    }
    return [];
}

/** Every variable key some `setVariable` row in this document assigns, disabled rows included. */
function documentWrittenKeys(document: StoryDocument, into: Set<string>): void {
    for (const scene of listScenesInDocumentOrder(document)) {
        if (!scene) {
            continue;
        }
        for (const block of listSceneBlocksInDocumentOrder(scene)) {
            if (block.kind === "action" && block.payload.action === "setVariable") {
                into.add(storyVariableRefKey(block.payload.target));
            }
        }
    }
}

/**
 * Every variable key anything in the project assigns.
 *
 * Project-wide, not per story: `saved` and `persistent` outlive any one document, so a flag chapter
 * two sets and chapter five tests is written even though neither story writes and reads it. A
 * per-story tally would report every cross-chapter flag in the project.
 */
export function collectWrittenVariableKeys(ctx: LintContext): Set<string> {
    const written = new Set<string>();
    for (const entry of ctx.stories) {
        documentWrittenKeys(entry.document, written);
    }
    const blueprintWrites = collectBlueprintVariableWrites(ctx.blueprintDocument, ctx.variableRegistry);
    for (const keys of blueprintWrites.byBlueprintId.values()) {
        for (const key of keys) {
            written.add(key);
        }
    }
    for (const key of blueprintWrites.ambient) {
        written.add(key);
    }
    return written;
}

/**
 * The same tally, split by the story that does the writing.
 *
 * What a range analysis needs and the flat set cannot give it: `computeVariableRanges` walks ONE
 * story's scene graph, so its answer is only about the whole project when this story is the only
 * thing that writes the counter. A `saved` flag another chapter also moves has an arrival range that
 * is true of a game nobody plays - the player arrives having played that chapter too.
 */
export function collectWrittenVariableKeysByStory(ctx: LintContext): Map<string, Set<string>> {
    const byStory = new Map<string, Set<string>>();
    for (const entry of ctx.stories) {
        const keys = new Set<string>();
        documentWrittenKeys(entry.document, keys);
        byStory.set(entry.id, keys);
    }
    return byStory;
}

/**
 * Whether the project holds something that could assign a variable without this file seeing it.
 *
 * Two shapes, and both are opaque by design rather than by omission:
 *
 *  - **A plugin marker row.** Studio never reads inside one; the owning plugin's compile pass
 *    decides what it emits, and that pass is code Studio does not run at authoring time.
 *  - **A `scriptModule` blueprint.** The program is TypeScript, not a graph, so there are no nodes
 *    to scan.
 *
 * Whole-project rather than per story or per variable. A pass that can emit an assignment can emit
 * one to anything, and narrowing the silence to the story holding the marker would still report a
 * saved flag that marker sets from the next chapter along.
 */
export function hasUnreadableWriter(ctx: LintContext): boolean {
    for (const blueprint of Object.values((ctx.blueprintDocument as BlueprintDocument | null)?.blueprints ?? {})) {
        if (blueprint && hasScriptLayer(blueprint)) {
            return true;
        }
    }
    for (const entry of ctx.stories) {
        for (const scene of listScenesInDocumentOrder(entry.document)) {
            if (!scene) {
                continue;
            }
            for (const block of listSceneBlocksInDocumentOrder(scene)) {
                if (isPluginMarker(block)) {
                    return true;
                }
            }
        }
    }
    return false;
}

function isPluginMarker(block: StoryBlock): boolean {
    return block.kind === "action" && block.payload.action === "plugin";
}
