import { useCallback, type ClipboardEvent, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { StoryBlock, StoryBlockId, StoryScene, StorySceneId } from "@shared/types/story";
import type { Character } from "@/lib/workspace/services/character/Character";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { UuidService } from "@/lib/workspace/services/core/UuidService";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import { translate, translateN } from "@/lib/i18n";
import {
    inferPasteSeparator,
    materializePastedRows,
    planPlainPaste,
    routeStoryPaste,
} from "@/lib/story/paste/storyPasteModel";
import {
    STORY_PASTE_CONFIRM_THRESHOLD,
    type PasteSeparatorChoice,
    type PlainPasteAnchor,
} from "@/lib/story/paste/storyPasteTypes";
import { createBlockForCommand } from "./storyActionCommands";
import { filterOutSelectedDescendants, getInsertionTargetAfter } from "./storySceneBlockUtils";
import {
    cloneSerializedBlock,
    exportBlockPlainText,
    getPasteAnchorId,
    insertSerializedClone,
    isStoryClipboardPayload,
    parseDialogueLine,
    serializeBlockSubtree,
    STORY_ACTIONS_MIME,
} from "./storySceneClipboard";
import { hasShiftModifier, isTextInputActive } from "./storySceneDom";
import type {
    EditorMode,
    SerializedStoryBlock,
    StoryBlockTarget,
    StoryClipboardPayload,
    VisibleStoryRow,
} from "./storySceneEditorTypes";

/**
 * A prose paste waiting on the wizard: the text verbatim, the separator the model inferred for it, and
 * where the rows will land. Held by the controller while the modal is open; discarding it is the whole
 * of "cancel", which is why nothing here has touched the document yet.
 */
export type StoryPasteWizardRequest = {
    text: string;
    inferred: PasteSeparatorChoice;
    target: StoryBlockTarget;
};

/**
 * Where a paste lands and what shape it takes, resolved from wherever the caret is.
 *
 * `target` is built once and handed to every `insertBlock` unchanged - that is what preserves the
 * pasted order, since each insert goes *before* the same following sibling.
 */
type StoryPasteAnchor = {
    target: StoryBlockTarget;
    plain: PlainPasteAnchor;
};

export function useStorySceneClipboardHandlers(params: {
    storyService: StoryService | null;
    uuidService: UuidService | null;
    uiService: UIService | null;
    storyId: string | undefined;
    sceneId: string | undefined;
    scene: StoryScene | null;
    scenes: Record<StorySceneId, StoryScene> | undefined;
    characters: Character[];
    selectedBlockIds: Set<StoryBlockId>;
    activeBlockId: StoryBlockId | null;
    visibleRows: VisibleStoryRow[];
    editorMode: EditorMode;
    /** The open insert slot's field, so a paste aimed at it can be told from any other text input. */
    insertInputRef: RefObject<HTMLTextAreaElement | null>;
    plainPasteRequestedRef: { current: boolean };
    recordHistory: () => boolean;
    setActiveBlockId: Dispatch<SetStateAction<StoryBlockId | null>>;
    setSelectedBlockIds: Dispatch<SetStateAction<Set<StoryBlockId>>>;
    setEditorMode: Dispatch<SetStateAction<EditorMode>>;
    /** Hand a prose paste to the wizard. Nothing is written until the author confirms there. */
    requestPasteWizard: (request: StoryPasteWizardRequest) => void;
    /**
     * Stop the open insert slot's blur from committing its line.
     *
     * Anything that takes focus away from the slot - the wizard, a confirm dialog - would otherwise
     * trip the slot's blur-commit, and a half-typed `/bg for` committed as a line is an `invalid` row
     * that a production build refuses to compile. A paste may not be able to do that.
     */
    suspendInsertSlotCommit: () => void;
    /**
     * Give the slot its blur-commit back once focus is no longer being stolen. Without this the latch
     * stays down for the rest of that slot's life, and the next line the author types into it would
     * vanish on blur instead of committing.
     */
    resumeInsertSlotCommit: () => void;
}) {
    /**
     * Whether the pasted rows may take the selection and close whatever is open.
     *
     * False whenever the caret is in something the author is still typing into - a row's text, the
     * insert slot. Those two carets are the whole reason this exists: taking the selection would move
     * the highlight off the line they are writing, and closing the editor would throw away a draft
     * that is not in the document yet.
     */
    const pasteMayTakeFocus = useCallback(
        () => params.editorMode.kind !== "text" && params.editorMode.kind !== "insert",
        [params],
    );

    /**
     * Insert already-built blocks in order, under ONE history entry recorded by the caller.
     *
     * There is no batch insert API, so this is N `documentChanged` events; the single `recordHistory`
     * in front of it is what makes the whole paste one undo step. The `target` is reused unmutated,
     * which is what keeps the pasted order: every insert goes before the same following sibling.
     */
    const insertPastedBlocks = useCallback((blocks: StoryBlock[], target: StoryBlockTarget) => {
        const { storyService, storyId, sceneId } = params;
        if (!storyService || !storyId || !sceneId || blocks.length === 0) {
            return;
        }
        for (const block of blocks) {
            storyService.insertBlock(storyId, sceneId, block, target);
        }
        if (pasteMayTakeFocus()) {
            params.setActiveBlockId(blocks[0].id);
            params.setSelectedBlockIds(new Set(blocks.map(block => block.id)));
        }
    }, [params, pasteMayTakeFocus]);

    const pasteBlocks = useCallback((roots: SerializedStoryBlock[], target: StoryBlockTarget) => {
        const { storyService, uuidService, storyId, sceneId } = params;
        if (!storyService || !uuidService || !storyId || !sceneId) {
            return;
        }
        params.recordHistory();
        const insertedRoots: StoryBlockId[] = [];
        for (const root of roots) {
            const cloned = cloneSerializedBlock(root, () => uuidService.generate());
            insertSerializedClone(storyService, storyId, sceneId, cloned, target);
            insertedRoots.push(cloned.block.id);
        }
        if (insertedRoots[0] && pasteMayTakeFocus()) {
            params.setActiveBlockId(insertedRoots[0]);
            params.setSelectedBlockIds(new Set(insertedRoots));
            params.setEditorMode({ kind: "idle" });
        }
    }, [params, pasteMayTakeFocus]);

    /**
     * The one-line paste, unchanged: it still guesses a `Name: text` line against the cast.
     *
     * A single line is small enough that a wrong guess costs one edit to fix, which is the trade the
     * wizard exists to refuse for a whole chapter.
     */
    const pasteSingleLine = useCallback((text: string, target: StoryBlockTarget) => {
        const { storyService, uuidService, storyId, sceneId, characters } = params;
        if (!storyService || !uuidService || !storyId || !sceneId) {
            return;
        }
        const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        if (lines.length === 0) {
            return;
        }
        params.recordHistory();
        const blocks = lines.map(line => {
            const parsed = parseDialogueLine(line, characters);
            return parsed
                ? createBlockForCommand("dialogue", () => uuidService.generate(), parsed.text, parsed.characterId)
                : createBlockForCommand("narration", () => uuidService.generate(), line);
        });
        insertPastedBlocks(blocks, target);
    }, [insertPastedBlocks, params]);

    /**
     * The no-wizard paste: every line becomes a row shaped by whatever the caret was sitting in.
     *
     * Async only for the over-threshold confirm. The clipboard text is read out of the event before
     * this is called, so awaiting here cannot lose it.
     */
    const pastePlain = useCallback(async (text: string, anchor: StoryPasteAnchor) => {
        const { uuidService, uiService } = params;
        if (!uuidService) {
            return;
        }
        const plan = planPlainPaste(text, anchor.plain);
        if (plan.rows.length === 0) {
            return;
        }
        if (plan.rows.length > STORY_PASTE_CONFIRM_THRESHOLD) {
            if (!uiService) {
                return;
            }
            params.suspendInsertSlotCommit();
            const confirmed = await uiService.showConfirm(
                translateN("story.paste.bulkConfirm", plan.rows.length),
                translate("story.paste.bulkConfirmDetail"),
            );
            params.resumeInsertSlotCommit();
            if (!confirmed) {
                return;
            }
        }
        const { blocks } = materializePastedRows(plan, {
            generateId: () => uuidService.generate(),
            createdCharacterIds: {},
        });
        params.recordHistory();
        insertPastedBlocks(blocks, anchor.target);
    }, [insertPastedBlocks, params]);

    /**
     * Where the pasted rows go, and what a plain paste copies its shape from.
     *
     * Three carets, three answers. The insert slot is the one that matters: its rows go *below* the
     * line being typed and the line is never committed, because committing a half-typed command line
     * turns an unfinished thought into a row a production build refuses to compile.
     */
    const resolveAnchor = useCallback((): StoryPasteAnchor | null => {
        const { scene, editorMode } = params;
        if (!scene) {
            return null;
        }
        if (editorMode.kind === "insert") {
            return {
                target: editorMode.slot.target ?? getInsertionTargetAfter(scene, editorMode.slot.afterBlockId),
                plain: { kind: "none" },
            };
        }
        const afterBlockId = editorMode.kind === "text"
            ? editorMode.blockId
            : getPasteAnchorId(params.visibleRows, params.selectedBlockIds, params.activeBlockId);
        return {
            target: getInsertionTargetAfter(scene, afterBlockId),
            plain: plainAnchorFor(afterBlockId ? scene.blocks[afterBlockId] : undefined),
        };
    }, [params]);

    /**
     * The five routes, from one clipboard payload.
     *
     * Returns whether the paste was taken, so the callers that have to decide about `preventDefault`
     * (a row's text field, the insert slot) can leave the browser alone when it was not.
     */
    const routePaste = useCallback((data: DataTransfer, plainRequested: boolean): boolean => {
        const anchor = resolveAnchor();
        if (!anchor) {
            return false;
        }
        const storyBlocksPayload = data.getData(STORY_ACTIONS_MIME);
        const plainText = data.getData("text/plain");
        const route = routeStoryPaste({ storyBlocksPayload, plainText, plainRequested });
        switch (route.kind) {
            case "blocks": {
                try {
                    const parsed = JSON.parse(storyBlocksPayload) as StoryClipboardPayload;
                    if (!isStoryClipboardPayload(parsed)) {
                        return false;
                    }
                    pasteBlocks(parsed.roots, anchor.target);
                    return true;
                } catch {
                    // A payload that claims our MIME type but does not parse is not ours to paste.
                    return false;
                }
            }
            case "scriptFile":
                // A script's `#data` footer is hundreds of lines of JSON. Pasting one as prose would
                // bury the scene under its own serialization; Import Script is the one thing that
                // can actually read it.
                params.uiService?.showNotification(translate("story.paste.scriptFile"), "warning");
                return true;
            case "single":
                pasteSingleLine(plainText, anchor.target);
                return true;
            case "wizard":
                params.suspendInsertSlotCommit();
                params.requestPasteWizard({
                    text: route.text,
                    inferred: inferPasteSeparator(route.text),
                    target: anchor.target,
                });
                return true;
            case "plain":
                void pastePlain(route.text, anchor);
                return true;
            default:
                return false;
        }
    }, [params, pasteBlocks, pasteSingleLine, pastePlain, resolveAnchor]);

    const copySelectionToClipboard = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
        if (isTextInputActive()) {
            return;
        }
        const { scene, scenes, selectedBlockIds, activeBlockId, characters } = params;
        if (!scene) {
            return;
        }
        const ids = selectedBlockIds.size > 0 ? [...selectedBlockIds] : activeBlockId ? [activeBlockId] : [];
        const roots = filterOutSelectedDescendants(scene, ids);
        if (roots.length === 0) {
            return;
        }
        const payload: StoryClipboardPayload = {
            version: 1,
            kind: "narraleaf.story.actions",
            roots: roots.map(id => serializeBlockSubtree(scene, id)),
        };
        event.preventDefault();
        event.clipboardData.setData(STORY_ACTIONS_MIME, JSON.stringify(payload));
        event.clipboardData.setData("text/plain", roots.map(id => exportBlockPlainText(scene.blocks[id], characters, scenes)).join("\n"));
    }, [params]);

    /**
     * Read the `Ctrl+Shift+V` flag and clear it in the same breath.
     *
     * Cleared on EVERY paste, including the ones this editor declines, so the flag can never survive
     * into a later paste that the author did not ask to be plain.
     */
    const takePlainRequest = useCallback((event: ClipboardEvent<HTMLElement>): boolean => {
        const requested = params.plainPasteRequestedRef.current;
        params.plainPasteRequestedRef.current = false;
        return requested || hasShiftModifier(event);
    }, [params]);

    const handlePaste = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
        const plainRequested = takePlainRequest(event);
        // Every other text input inside the editor - the find bar, an inspector field, the scene name -
        // keeps the browser's own paste. The insert slot is the one exception, and only for text it
        // cannot hold: a line being typed is one line.
        const intoInsertSlot = Boolean(params.insertInputRef.current) && event.target === params.insertInputRef.current;
        if (isTextInputActive() && !intoInsertSlot) {
            return;
        }
        if (intoInsertSlot && !isMultiLine(event.clipboardData.getData("text/plain"))) {
            return;
        }
        if (routePaste(event.clipboardData, plainRequested)) {
            event.preventDefault();
        }
    }, [params, routePaste, takePlainRequest]);

    /**
     * A paste that arrived while a row's text was open for editing.
     *
     * Only ever called for multi-line text (see `RichTextInput.onMultiLinePaste`), so a word pasted
     * mid-sentence keeps the browser's own behaviour - caret, marks and the row's undo stack intact.
     */
    const handleRowTextPaste = useCallback((event: ClipboardEvent<HTMLDivElement>): boolean => {
        const plainRequested = takePlainRequest(event);
        return routePaste(event.clipboardData, plainRequested);
    }, [routePaste, takePlainRequest]);

    return { copySelectionToClipboard, handlePaste, handleRowTextPaste, insertPastedBlocks };
}

function isMultiLine(text: string): boolean {
    return /\r?\n/.test(text.trim());
}

/**
 * The shape a plain paste copies from the row the caret was in.
 *
 * A dialogue anchor carries its own speaker, so a run of lines pasted mid-conversation stays in that
 * conversation. That is deliberately the whole of the gesture's cleverness: a plain paste that started
 * guessing speakers would be the wizard with no way to correct it.
 */
function plainAnchorFor(block: StoryBlock | undefined): PlainPasteAnchor {
    if (!block) {
        return { kind: "none" };
    }
    if (block.kind === "note") {
        return { kind: "note" };
    }
    if (block.kind === "nodeAction" && block.payload.action === "dialogue") {
        return { kind: "dialogue", characterId: block.payload.characterId, speakerName: block.payload.speakerName };
    }
    if (block.kind === "nodeAction" && block.payload.action === "narration") {
        return { kind: "narration" };
    }
    return { kind: "none" };
}
