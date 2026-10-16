import type { StoryBlock, StoryBlockId, StoryDocument, StoryId, StorySceneId, StoryTextSegment } from "@shared/types/story";
import {
    getSegmentSlot,
    replaceRangesInSegment,
    segmentPlainText,
} from "@/apps/workspace/modules/story/scene-editor/storyFindReplace";
import type { PluralKey } from "@shared/i18n";
import { getProjectWriteFreeze } from "@/lib/app/writeFreeze";
import { i18nStore, translateN } from "@/lib/i18n";
import { Services, type WorkspaceContext } from "../services";
import type { UIService } from "../core/UIService";
import { StoryService } from "../story/StoryService";
import { HistoryService, type HistoryGroupStep } from "../history/HistoryService";
import type { HistoryLabel, HistoryScopeId } from "../history/historyModel";
import { searchReplaceHistoryScope, storySceneHistoryScope } from "../history/historyScopes";
import { SearchService } from "./SearchService";
import { passesFilters, type SearchFilters } from "./searchIndexModel";
import type { CompiledMatcher } from "./textMatcher";

/**
 * Project-wide replace across story prose: what it would do, and then doing it.
 *
 * # Two phases, and the split is the whole design
 *
 * The author's decision was that a replace spanning six scenes either lands completely or changes
 * nothing. There is no half-applied state to explain, no "14 of 18 rewritten" to reason about, and
 * nothing to reconcile if the seventh scene turns out to have been deleted a moment ago.
 *
 * That is only achievable if every way this can fail happens **before the first write**, so
 * {@link planStoryReplace} is pure - it resolves every block, builds every rewritten segment, and
 * reports what it could not do - and {@link applyStoryReplace} only writes. A plan that carries any
 * failure is refused whole; a plan that carries none cannot fail part-way, because the only work
 * left is handing finished segments to the story service.
 *
 * # Candidates from the index, rewrites from the document
 *
 * Which blocks to consider comes from the search index, because that is where `scene:` and
 * `speaker:` already mean something and where "every storyText entry in the project" is one array
 * rather than a walk of every scene of every story. What gets written is derived from the **live**
 * `StoryDocument`: the index is rebuilt on a 300ms debounce, so its copy of a line can be a third of
 * a second behind the author's last keystroke, and rewriting from it would quietly revert whatever
 * they typed in between.
 *
 * # Only prose
 *
 * `storyText` entries and nothing else. Scene names, story names, character names, asset names,
 * variable names and localization keys are identifiers - things point at them - and a find/replace
 * that renamed them would be a refactor wearing a text edit's clothes. The skeleton template has a
 * scene called "Corridor" and lines that say "corridor"; the lines change and the scene does not.
 */

export type StoryReplaceFailureReason =
    /** The story document is not loaded (or would not load) any more. */
    | "storyMissing"
    /** The scene was deleted between the index build and now. */
    | "sceneMissing"
    /** The block was deleted between the index build and now. */
    | "blockMissing"
    /** The block is still there but no longer carries text (its action was changed). */
    | "noTextSegment"
    /** The rich-run splice threw - a malformed run list, which must never reach a write. */
    | "rewriteFailed";

export interface StoryReplaceFailure {
    reason: StoryReplaceFailureReason;
    storyId: StoryId;
    sceneId: StorySceneId;
    blockId: StoryBlockId;
}

/** One block's rewrite, as segments rather than payloads - see {@link applyStoryReplace}. */
export interface StoryReplaceEdit {
    storyId: StoryId;
    sceneId: StorySceneId;
    blockId: StoryBlockId;
    before: StoryTextSegment;
    after: StoryTextSegment;
    /** Hits inside this one block. A line containing the query twice contributes two. */
    occurrences: number;
}

export interface ReplacePlan {
    edits: readonly StoryReplaceEdit[];
    /**
     * Hits, not rows. This is the number the button shows, because "replace all 14" has to mean the
     * fourteen things that will change and not the eleven rows they are spread over.
     */
    occurrences: number;
    blockCount: number;
    sceneCount: number;
    storyCount: number;
    /** Everything phase 1 could not resolve. Non-empty means {@link applicable} is false. */
    failures: readonly StoryReplaceFailure[];
    /** Whether {@link applyStoryReplace} will write this plan. */
    applicable: boolean;
}

export interface StoryReplaceRequest {
    /** Compiled once by the caller, per (query, options) change - never per candidate. */
    matcher: CompiledMatcher;
    /** Literal in plain mode; a template expanded per hit (`$1`, `$&`) in regex mode. */
    replacement: string;
    /** Narrows the candidate set exactly as the query path narrows results. */
    filters?: SearchFilters;
}

const EMPTY_PLAN: ReplacePlan = {
    edits: [],
    occurrences: 0,
    blockCount: 0,
    sceneCount: 0,
    storyCount: 0,
    failures: [],
    applicable: false,
};

/**
 * Phase 1: work out every rewrite, and every reason there might not be one. Writes nothing.
 *
 * A candidate that no longer matches is **not** a failure - it is the ordinary consequence of the
 * index lagging an edit, and skipping it is the correct answer. A candidate whose block, scene or
 * story has gone, or whose text cannot be spliced, is a failure: the plan then describes work that
 * cannot be completed, and completing part of it is the outcome the author ruled out.
 */
export function planStoryReplace(ctx: WorkspaceContext, request: StoryReplaceRequest): ReplacePlan {
    const { matcher, replacement, filters } = request;
    if (matcher.error) {
        return EMPTY_PLAN;
    }

    const searchService = ctx.services.get<SearchService>(Services.Search);
    const storyService = ctx.services.get<StoryService>(Services.Story);

    const edits: StoryReplaceEdit[] = [];
    const failures: StoryReplaceFailure[] = [];
    // One lookup per story rather than one per candidate; a chapter is hundreds of entries deep.
    const documents = new Map<StoryId, StoryDocument | null>();
    const scenes = new Set<string>();
    const stories = new Set<StoryId>();
    let occurrences = 0;

    for (const entry of searchService.listEntries()) {
        if (entry.group !== "storyText" || entry.target.kind !== "storyBlock") {
            continue;
        }
        if (filters && !passesFilters(entry, filters)) {
            continue;
        }
        // The index's copy is stale by up to a debounce, which is fine for *choosing* candidates and
        // never used for the rewrite itself. It is also the cheap half of the sweep: one test per
        // entry against a string that is already in memory.
        if (!matcher.test(entry.text)) {
            continue;
        }

        const { storyId, sceneId, blockId } = entry.target;
        const document = resolveDocument(storyService, documents, storyId);
        if (!document) {
            failures.push({ reason: "storyMissing", storyId, sceneId, blockId });
            continue;
        }
        const scene = document.scenes[sceneId];
        if (!scene) {
            failures.push({ reason: "sceneMissing", storyId, sceneId, blockId });
            continue;
        }
        const block = scene.blocks[blockId];
        if (!block) {
            failures.push({ reason: "blockMissing", storyId, sceneId, blockId });
            continue;
        }
        const slot = getSegmentSlot(block);
        if (!slot) {
            failures.push({ reason: "noTextSegment", storyId, sceneId, blockId });
            continue;
        }

        const plain = segmentPlainText(slot.segment);
        const ranges = matcher.findRanges(plain);
        if (ranges.length === 0) {
            // The index said this line matched and the live line does not: the author edited it
            // since. Nothing to do, and nothing wrong.
            continue;
        }

        let after: StoryTextSegment;
        try {
            after = replaceRangesInSegment(slot.segment, ranges, range =>
                matcher.expand(plain, range, replacement),
            );
        } catch (error) {
            console.warn(`[storyReplace] Could not rewrite ${storyId}/${sceneId}/${blockId}:`, error);
            failures.push({ reason: "rewriteFailed", storyId, sceneId, blockId });
            continue;
        }

        edits.push({ storyId, sceneId, blockId, before: slot.segment, after, occurrences: ranges.length });
        occurrences += ranges.length;
        scenes.add(`${storyId}/${sceneId}`);
        stories.add(storyId);
    }

    return {
        edits,
        occurrences,
        blockCount: edits.length,
        sceneCount: scenes.size,
        storyCount: stories.size,
        failures,
        applicable: failures.length === 0 && edits.length > 0,
    };
}

/**
 * The plan for one of its edits, so a single row can be replaced on its own.
 *
 * A per-row replace is its own complete operation - one block, all of it or none - so it stays
 * available even when the sweep it was planned alongside is not.
 */
export function planForEdit(edit: StoryReplaceEdit): ReplacePlan {
    return {
        edits: [edit],
        occurrences: edit.occurrences,
        blockCount: 1,
        sceneCount: 1,
        storyCount: 1,
        failures: [],
        applicable: true,
    };
}

/**
 * Phase 2: write the plan, as one batch per story, one undo step on each scene it touched, and one
 * step in the Search panel that takes those back together.
 *
 * Returns whether anything was written. False covers a plan phase 1 refused, an empty plan, and a
 * frozen workspace - in all of them nothing is written and no history is recorded, which is the
 * point: an undo entry for a write that did not happen is a press that silently rewrites the
 * document to a state it was never in.
 *
 * # Why the scene's stack, and not the project's
 *
 * Every other edit to a scene's text lives on that scene's stack, and most of its entries are
 * snapshots of the whole scene. A replace recorded anywhere else is undone out of order with them:
 * the author pastes rows, replaces a word across the project, presses Ctrl+Z in the scene, and the
 * paste's snapshot - taken before the replace - puts the old word back in that scene along with
 * removing the rows, while the replace's own step still sits on another stack waiting to "undo" a
 * change that is already gone. Recorded in the scene, the replace is simply the newest step there:
 * Ctrl+Z in the scene takes back exactly the replace, and the next one takes back the paste.
 *
 * # And the Search panel's step on top
 *
 * Ctrl+Z in the Search panel takes the whole replace back at once, as it did when the replace was
 * one project step. It does so through the scene steps above (`HistoryService.pushGroup`): a scene
 * whose newest step is still the replace has that step taken, exactly as Ctrl+Z in the scene would;
 * a scene edited since keeps the replace, and the author is told which, because taking it back there
 * would undo out of order with the later edit.
 */
export function applyStoryReplace(ctx: WorkspaceContext, plan: ReplacePlan, label: HistoryLabel): boolean {
    if (!plan.applicable || plan.edits.length === 0) {
        return false;
    }
    if (getProjectWriteFreeze()) {
        return false;
    }

    const storyService = ctx.services.get<StoryService>(Services.Story);
    const historyService = ctx.services.get<HistoryService>(Services.History);

    const written = writeSegments(storyService, plan.edits, "after");
    if (written.length === 0) {
        return false;
    }

    /**
     * A command entry per scene, not a snapshot: the scene editor need not be open, so there may be
     * no registered scope to capture through. Both directions re-derive from whatever is live at the
     * moment they run - see {@link writeSegments} - so taking the step back after an unrelated edit
     * to another row of the scene still puts back only the text this replace touched.
     */
    const scenes = new Map<HistoryScopeId, { storyId: StoryId; sceneId: StorySceneId }>();
    const members = groupByScene(written).map(sceneEdits => {
        const { storyId, sceneId } = sceneEdits[0];
        const scopeId = storySceneHistoryScope(storyId, sceneId);
        scenes.set(scopeId, { storyId, sceneId });
        return {
            scopeId,
            label,
            undo: () => {
                writeSegments(storyService, sceneEdits, "before");
            },
            redo: () => {
                writeSegments(storyService, sceneEdits, "after");
            },
        };
    });
    historyService.pushGroup(searchReplaceHistoryScope(), {
        label,
        members,
        onStep: step => reportSkippedScenes(ctx, step, scenes),
    });
    return true;
}

/**
 * Tell the author which scenes a Search panel undo or redo left as they were.
 *
 * Info, not a warning: the author did nothing wrong by editing a scene after replacing in it. A
 * scene that has since been deleted is not named - there is nothing left in it to take back.
 */
function reportSkippedScenes(
    ctx: WorkspaceContext,
    step: HistoryGroupStep,
    scenes: ReadonlyMap<HistoryScopeId, { storyId: StoryId; sceneId: StorySceneId }>,
): void {
    if (step.skipped.length === 0) {
        return;
    }
    const storyService = ctx.services.get<StoryService>(Services.Story);
    const documents = new Map<StoryId, StoryDocument | null>();
    const names: string[] = [];
    for (const scopeId of step.skipped) {
        const scene = scenes.get(scopeId);
        const name = scene ? resolveDocument(storyService, documents, scene.storyId)?.scenes[scene.sceneId]?.name : undefined;
        if (name !== undefined) {
            names.push(name);
        }
    }
    if (names.length === 0) {
        return;
    }
    const message = translateN(
        step.direction === "undo"
            ? "workspace.shell.search.undoSkipped" as PluralKey
            : "workspace.shell.search.redoSkipped" as PluralKey,
        names.length,
    );
    ctx.services.get<UIService>(Services.UI).showNotification(message, "info", {
        detail: i18nStore.getTranslator().formatList(names),
    });
}

/** The edits of each scene together, in the order the scenes first appear. */
function groupByScene(edits: readonly StoryReplaceEdit[]): StoryReplaceEdit[][] {
    const byScene = new Map<string, StoryReplaceEdit[]>();
    for (const edit of edits) {
        const key = `${edit.storyId}\u0000${edit.sceneId}`;
        const bucket = byScene.get(key);
        if (bucket) {
            bucket.push(edit);
        } else {
            byScene.set(key, [edit]);
        }
    }
    return [...byScene.values()];
}

/**
 * Put one side of every edit back into the live document, batched per story. Returns the edits
 * whose block was there to write.
 *
 * **The payload is rebuilt from the block as it stands, never replayed.** A payload holds more than
 * its text - a dialogue line's speaker, its voice take, its pause configuration - and any of that
 * may have been changed since the replace ran. Storing whole payloads and writing them back would
 * undo the replacement *and* silently revert those, which is the failure an author would never
 * connect to the button they pressed. Only the segment travels; everything else is read fresh.
 *
 * A block that has gone by the time undo runs is skipped rather than fatal. Undo is the author's
 * escape hatch, and an escape hatch that refuses because one of forty rows was deleted is not one.
 */
function writeSegments(
    storyService: StoryService,
    edits: readonly StoryReplaceEdit[],
    side: "before" | "after",
): StoryReplaceEdit[] {
    const byStory = new Map<StoryId, { sceneId: StorySceneId; blockId: StoryBlockId; payload: StoryBlock["payload"] }[]>();
    const documents = new Map<StoryId, StoryDocument | null>();
    const written: StoryReplaceEdit[] = [];

    for (const edit of edits) {
        const document = resolveDocument(storyService, documents, edit.storyId);
        const block = document?.scenes[edit.sceneId]?.blocks[edit.blockId];
        const slot = block ? getSegmentSlot(block) : null;
        if (!slot) {
            continue;
        }
        const payload = slot.withSegment(side === "before" ? edit.before : edit.after).payload;
        const bucket = byStory.get(edit.storyId);
        const item = { sceneId: edit.sceneId, blockId: edit.blockId, payload };
        if (bucket) {
            bucket.push(item);
        } else {
            byStory.set(edit.storyId, [item]);
        }
        written.push(edit);
    }

    // One mutation per story, so the story editor repaints once for the sweep instead of once a row.
    for (const [storyId, storyEdits] of byStory) {
        storyService.updateBlocks(storyId, storyEdits);
    }
    const skipped = edits.length - written.length;
    if (skipped > 0) {
        console.warn(`[storyReplace] ${skipped} of ${edits.length} blocks were gone; wrote the other ${written.length}.`);
    }
    return written;
}

function resolveDocument(
    storyService: StoryService,
    cache: Map<StoryId, StoryDocument | null>,
    storyId: StoryId,
): StoryDocument | null {
    if (cache.has(storyId)) {
        return cache.get(storyId) ?? null;
    }
    let document: StoryDocument | null;
    try {
        document = storyService.getStoryDocument(storyId);
    } catch {
        document = null;
    }
    cache.set(storyId, document);
    return document;
}
