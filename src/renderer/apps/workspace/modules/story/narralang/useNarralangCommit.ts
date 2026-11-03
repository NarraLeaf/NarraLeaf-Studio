import { useCallback, useRef } from "react";
import type { StoryDocument, StoryScene } from "@shared/types/story";
import type { TranslationKey } from "@shared/i18n";
import { printNarralangScene } from "@/lib/story/narralang/narralangPrinter";
import { reconcileNarralangScene, type NarralangParseDiagnostic } from "@/lib/story/narralang/narralangReconcile";
import type { HistoryService } from "@/lib/workspace/services/history/HistoryService";
import { storySceneHistoryScope } from "@/lib/workspace/services/history/historyScopes";
import type { LiveSessionService } from "@/lib/workspace/services/live/LiveSessionService";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import { Services } from "@/lib/workspace/services/services";
import { useWorkspace } from "../../../context";
import type { StoryCommandContext } from "../scene-editor/storyCommandValues";
import { expressionScope } from "../scene-editor/storyCommandResolution";
import { NARRALANG_HISTORY_MERGE_WINDOW_MS, narralangHistoryMergeKey, narralangSceneMoved } from "./narralangEdit";
import { narralangReferences } from "./narralangLookups";

/**
 * What happened to a buffer that was offered to the document.
 *
 * Four answers rather than a boolean because the view does something different with each, and three
 * of them are "the document did not move" for three unrelated reasons.
 */
export type NarralangCommitKind =
    /** The scene was rewritten. */
    | "committed"
    /** The text says what the scene already says - a caret move, a trailing space. */
    | "unchanged"
    /** The text does not read as a script. The document is untouched. */
    | "refused"
    /**
     * No scene, no document, the view is closed, the scene is one the script cannot write, or a
     * live session owns the story - a whole-scene rewrite is not something a session can carry.
     */
    | "unavailable";

export type NarralangCommitOutcome = {
    readonly kind: NarralangCommitKind;
    /** Lines that could not be read. Non-empty only when {@link kind} is `refused`. */
    readonly diagnostics: readonly NarralangParseDiagnostic[];
    /**
     * The script header names a scene other than this one, and the header was not obeyed.
     *
     * Reported rather than applied, and reported rather than swallowed. A script cannot rename a
     * scene this round: the name is identity that the outline and every jump elsewhere in the story
     * address, and a rename arriving as a side effect of typing would have no undo an author could
     * find. Saying nothing would be worse than either - the author would believe it had worked.
     */
    readonly renameIgnored: boolean;
};

const NOTHING: NarralangCommitOutcome = { kind: "unavailable", diagnostics: [], renameIgnored: false };

/**
 * Writing the script buffer back into the story document.
 *
 * ## The path, and why it is this one
 *
 * `StoryService.commitSceneReplacement` replaces the block tree and records the edit on the
 * scene's own undo scope. The same document change feeds Dev Mode reload, project lint and search.
 * The scene is spread so its runtime name, music, snapshots and other metadata survive the edit.
 *
 * ## One undo step per burst, not per pause
 *
 * The checkpoint carries a merge key, so consecutive commits inside
 * {@link NARRALANG_HISTORY_MERGE_WINDOW_MS} fold into one entry that keeps the *oldest* state - see
 * `mergeHistoryEntries`. Without it a debounced commit would push one whole-scene snapshot per typing
 * pause and undoing a paragraph would take a press per pause. `breakMerge` ends the group at the
 * boundaries where the author has plainly finished: leaving the editor, closing the view, or a
 * change arriving from somewhere else.
 *
 * ## Nothing is committed that does not parse
 *
 * The reconciler refuses the whole buffer when any line fails, and half-written text is the normal
 * state of a buffer someone is typing into. A refusal is therefore not an error: the document keeps
 * what it had and the caller draws the diagnostics on the lines.
 */
export function useNarralangCommit(
    scene: StoryScene | null,
    document: StoryDocument | null,
    /**
     * The tables a name typed into the script resolves against - the scene editor's own, not a second
     * set built here.
     *
     * The `/` command line already resolves `visited('天台 · 夜')` through this context, and the two
     * surfaces spell the same story: a name the row editor accepts and the script view rejects would
     * be a disagreement about what the project contains. Reusing the memo also means this costs
     * nothing - it is rebuilt when the document changes, not when a commit fires.
     */
    commandContext: StoryCommandContext,
    enabled: boolean,
): {
    /** Offer the buffer to the document. Synchronous, so the caller can mark the lines straight after. */
    commit: (text: string) => NarralangCommitOutcome;
    /** End the current undo group, so the next commit starts a fresh step. */
    breakMerge: () => void;
} {
    const { context } = useWorkspace();

    /**
     * Both callbacks read the live scene through this, not through their own dependency lists.
     *
     * A commit runs from a timer and from a blur handler, neither of which re-reads a callback that
     * React re-created in between - a stale closure here would reconcile the buffer against the scene
     * as it stood several edits ago and write that back.
     */
    const stateRef = useRef({ context, scene, document, commandContext, enabled });
    stateRef.current = { context, scene, document, commandContext, enabled };

    const commit = useCallback((text: string): NarralangCommitOutcome => {
        const state = stateRef.current;
        if (!state.enabled || !state.context || !state.scene || !state.document) {
            return NOTHING;
        }
        const { services } = state.context;

        // A session owns this story, so the buffer goes nowhere.
        //
        // `replaceScene` is not one of the operations a session carries, so a commit here would be
        // written into this machine's document and into nobody else's; the next effect the host
        // broadcasts about this scene would then find two different scenes and eject this window
        // from the room. The view is already read-only with the reason on it - this is the second
        // enforcement point, because a commit fires from a timer and from a blur handler, either of
        // which can be in flight when a session opens.
        //
        // First, before anything is read or printed: nothing below this line can change the answer,
        // and a refusal that had already walked the scene would be doing the work twice a second
        // for the whole of a session.
        if (services.get<LiveSessionService>(Services.Live).ownsStory(state.document.id)) {
            return NOTHING;
        }

        const storyService = services.get<StoryService>(Services.Story);
                // Both directions off one pass: the names this commit prints and the names it reads back are
        // the same list, so a reference the scene can be shown with is one it can be re-read with.
        const { lookups, parseLookups } = narralangReferences(services, state.document);

        // The gate, checked here and not only where the view was told about it.
        //
        // The view's `editable` comes from the debounced print, so it lags the document by up to a
        // reprint - long enough for a row with no script form to arrive from another panel between
        // the last print and this commit. Handing such a scene to the reconciler gets a placeholder
        // diagnostic back and puts it on a line, which is a worse thing for an author to read than
        // the buffer simply going quiet. One print to be sure; commits are rare enough to afford it.
        if (printNarralangScene(state.scene, lookups).issues.length > 0) {
            return NOTHING;
        }

        const result = reconcileNarralangScene({
            scene: state.scene,
            nextText: text,
            lookups,
            parseLookups,
            // Not optional in practice. `visited(…)`, `picked(…)` and a blueprint call have no other
            // source, and a name that does not resolve is a diagnostic - which refuses the whole
            // buffer, lines the author never touched included. Omitting this would mean a scene with
            // one `visited(…)` in it silently accepts no edits at all.
            expressionScope: expressionScope(state.commandContext),
        });
        if (!result.ok) {
            return { kind: "refused", diagnostics: result.diagnostics, renameIgnored: false };
        }
        const renameIgnored = result.sceneName !== null && result.sceneName !== state.scene.name;
        // Nothing moved. Committing anyway would push an undo step for a caret move and republish the
        // document to every panel that listens, which is the one cost this surface must not have.
        if (!narralangSceneMoved(state.scene, result)) {
            return { kind: "unchanged", diagnostics: [], renameIgnored };
        }

        const storyId = state.document.id;
        const sceneId = state.scene.id;
        // Spread rather than rebuilt: the service stores what it is handed, so anything left out
        // here - `runtimeName`, `bgm`, the scene's snapshots - would be dropped. The block tree is
        // all a script edit may change, and the name is deliberately not part of it.
        const committed = storyService.commitSceneReplacement(storyId, sceneId, {
            ...state.scene,
            rootBlockIds: result.rootBlockIds,
            blocks: result.blocks,
        }, {
            label: { key: "workspace.history.entry.storyEdit" as TranslationKey },
            mergeKey: narralangHistoryMergeKey(sceneId),
            mergeWindowMs: NARRALANG_HISTORY_MERGE_WINDOW_MS,
        });
        return { kind: committed ? "committed" : "unavailable", diagnostics: [], renameIgnored };
    }, []);

    const breakMerge = useCallback(() => {
        const state = stateRef.current;
        if (!state.context || !state.scene || !state.document) {
            return;
        }
        state.context.services
            .get<HistoryService>(Services.History)
            .breakMerge(storySceneHistoryScope(state.document.id, state.scene.id));
    }, []);

    return { commit, breakMerge };
}
