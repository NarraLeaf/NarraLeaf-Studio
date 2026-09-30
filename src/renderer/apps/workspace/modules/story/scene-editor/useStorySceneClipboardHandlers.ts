import { useCallback, useEffect, useMemo, useRef, type ClipboardEvent, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { AssetTransferEntry, AssetTransferManifestEntry } from "@shared/types/assetTransfer";
import type { LiveDerived } from "@shared/live/ops";
import type { StoryBlock, StoryBlockId, StoryScene, StorySceneId } from "@shared/types/story";
import { normalizeProjectPath } from "@shared/utils/recentProject";
import { getInterface } from "@/lib/app/bridge";
import type { Character } from "@/lib/workspace/services/character/Character";
import {
    buildAssetTransferEntries,
    createTransferredAssetPort,
    findLibraryAsset,
    readClipboardAssetGrant,
} from "@/lib/workspace/services/assets/assetTransferImport";
import type { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import type { FileSystemService } from "@/lib/workspace/services/core/FileSystem";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { UuidService } from "@/lib/workspace/services/core/UuidService";
import type { LocalizationService } from "@/lib/workspace/services/localization/LocalizationService";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { VoiceService } from "@/lib/workspace/services/voice/VoiceService";
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
import {
    classifyStoryPaste,
    derivedWritesFrozen,
    liveDerivedFor,
    liveSessionOnProject,
    rowsOnlyPayload,
    takeSessionRowsOnlyNotice,
} from "./storyLivePaste";
import {
    collectStoryAssetIds,
    collectStoryCharacterIds,
    collectSubtreeBlocks,
    countUnresolvedAssetSites,
    importTransferredAssets,
    listSerializedBlocks,
    treatForeignCharacterRefs,
} from "./storyForeignPaste";
import { filterOutSelectedDescendants, getInsertionTargetAfter } from "./storySceneBlockUtils";
import {
    cloneSerializedBlock,
    exportBlockPlainText,
    getPasteAnchorId,
    flattenSerializedClone,
    isStoryClipboardPayload,
    listBlockTextIds,
    parseDialogueLine,
    serializeBlockSubtree,
    STORY_ACTIONS_MIME,
} from "./storySceneClipboard";
import { hasShiftModifier, isTextInputActive } from "./storySceneDom";
import {
    collectClipboardTranslations,
    createCarriedTranslationPort,
    planCarriedTranslations,
    readProjectLocales,
    writeCarriedTranslations,
    type CarriedTranslationPlan,
    type CarriedTranslationPort,
} from "./storyTranslationTransfer";
import {
    carryVoiceWithinProject,
    createCarriedVoicePort,
    planVoiceWithinProject,
    type CarriedVoicePlan,
} from "./storyVoiceTransfer";
import type {
    EditorMode,
    SerializedStoryBlock,
    StoryBlockTarget,
    StoryClipboardPayload,
    StoryClipboardTranslations,
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
    /** The library a foreign paste imports into, and the one a copy offers files out of. */
    assetsService: AssetsService | null;
    /** Reads the bytes of a file a redeemed transfer granted access to. */
    fileSystemService: FileSystemService | null;
    /**
     * The translations a copy carries and a paste writes back. Null until the workspace is ready,
     * which costs a paste its translations and nothing else.
     */
    localizationService: LocalizationService | null;
    /**
     * The voice libraries a paste re-keys its takes into. Null until the workspace is ready, which
     * costs a paste its recordings and nothing else.
     *
     * Read at paste time rather than carried on the clipboard: a take points at a clip in this
     * project's audio library, so it is only ever worth anything to the project it came from.
     */
    voiceService: VoiceService | null;
    storyId: string | undefined;
    sceneId: string | undefined;
    scene: StoryScene | null;
    scenes: Record<StorySceneId, StoryScene> | undefined;
    characters: Character[];
    /**
     * This project's cast, as a membership test - what tells a character id that works here from
     * one minted by whichever project the rows were copied out of.
     */
    knownCharacterIds: ReadonlySet<string>;
    /** This window's project directory, and with it the identity a pasted payload is compared against. */
    projectPath: string;
    /** What this project is called, carried on the clipboard so a foreign paste can name its source. */
    projectName: string;
    /** The project's `identifier`. Travels for display; it is not an identity. */
    projectIdentifier: string;
    selectedBlockIds: Set<StoryBlockId>;
    activeBlockId: StoryBlockId | null;
    visibleRows: VisibleStoryRow[];
    editorMode: EditorMode;
    /** The open insert slot's field, so a paste aimed at it can be told from any other text input. */
    insertInputRef: RefObject<HTMLTextAreaElement | null>;
    plainPasteRequestedRef: { current: boolean };
    /**
     * Whether this window's project data is frozen, read at the moment it is asked.
     *
     * A getter rather than a value: the only caller reads it on the far side of an `await`, which is
     * exactly the window in which a freeze can land, and a captured boolean would still say "no".
     */
    isFrozen: () => boolean;
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
    /**
     * Shut the open insert slot's candidate popover.
     *
     * The popover is portalled, so it renders outside the wizard's stacking context and draws *over*
     * it - `/bg for` leaves a "No matches." panel sitting on top of the first mapping row. The slot
     * cannot close it by itself: the wizard takes focus, so the keystroke that normally clears the
     * menu never arrives.
     */
    dismissInsertChooser: () => void;
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
     * One operation for the lot: one `documentChanged`, one undo step, and inside a live session one
     * effect rather than a row-by-row run of them. The `target` is reused unmutated, which is what
     * keeps the pasted order: every insert goes before the same following sibling.
     */
    const insertPastedBlocks = useCallback((blocks: StoryBlock[], target: StoryBlockTarget) => {
        const { storyService, storyId, sceneId } = params;
        if (!storyService || !storyId || !sceneId || blocks.length === 0) {
            return;
        }
        storyService.insertBlocks(storyId, sceneId, blocks.map(block => ({ block, target })));
        if (pasteMayTakeFocus()) {
            params.setActiveBlockId(blocks[0].id);
            params.setSelectedBlockIds(new Set(blocks.map(block => block.id)));
        }
    }, [params, pasteMayTakeFocus]);

    /**
     * Mint the rows a paste will write, **without writing them**.
     *
     * Split from the insert below because of one ordering: what a paste derives is keyed by the ids
     * minted here, and inside a live session those entries have to be known before the rows are
     * handed to the room - they travel with the operation that carries the rows, and an operation
     * has left by the time it can be answered. Outside a session the two halves still run back to
     * back and nothing about the paste changes.
     *
     * The `textIds` are the renaming the clone performed, old id → new id. Every pasted line gets a
     * fresh one, so it is the only thing that can still tell which line over there became which line
     * here - which is what the translations travelling with the rows are keyed by, and what the
     * takes are found under (see `storyVoiceTransfer`).
     */
    const cloneForPaste = useCallback((
        roots: SerializedStoryBlock[],
    ): { clones: SerializedStoryBlock[]; textIds: Map<string, string> } | null => {
        const { uuidService, storyService, storyId, sceneId } = params;
        if (!storyService || !uuidService || !storyId || !sceneId || roots.length === 0) {
            return null;
        }
        const textIds = new Map<string, string>();
        const clones = roots.map(root => cloneSerializedBlock(root, () => uuidService.generate(), textIds));
        return { clones, textIds };
    }, [params]);

    /**
     * Write rows already minted into the scene, as one undo step.
     *
     * `derived` is what the paste derives - the translations and takes re-keyed onto the ids these
     * rows now carry - and it travels on the one operation the whole paste becomes. It belongs to
     * the gesture rather than to any row of it, which is what makes every machine in a session
     * write the same entries from the same message; see `StoryOpSink.handle`. Undefined outside a
     * session and for a project that is neither translated nor dubbed.
     */
    const insertClones = useCallback((
        clones: SerializedStoryBlock[],
        target: StoryBlockTarget,
        derived?: LiveDerived,
    ): boolean => {
        const { storyService, storyId, sceneId } = params;
        if (!storyService || !storyId || !sceneId || clones.length === 0) {
            return false;
        }
        params.recordHistory();
        // One list, one call, one operation: a paste is one gesture, so it is one undo step here
        // and one effect in a live session rather than a row-by-row run of either.
        const inserts = clones.flatMap(cloned => flattenSerializedClone(cloned, target));
        storyService.insertBlocks(storyId, sceneId, inserts, derived);
        const insertedRoots = clones.map(cloned => cloned.block.id);
        if (insertedRoots[0] && pasteMayTakeFocus()) {
            params.setActiveBlockId(insertedRoots[0]);
            params.setSelectedBlockIds(new Set(insertedRoots));
            params.setEditorMode({ kind: "idle" });
        }
        return insertedRoots.length > 0;
    }, [params, pasteMayTakeFocus]);

    /** Clone and write in one step: every paste that derives nothing anybody else has to compute. */
    const pasteBlocks = useCallback((
        roots: SerializedStoryBlock[],
        target: StoryBlockTarget,
    ): { textIds: Map<string, string> } | null => {
        const minted = cloneForPaste(roots);
        if (!minted || !insertClones(minted.clones, target)) {
            return null;
        }
        return { textIds: minted.textIds };
    }, [cloneForPaste, insertClones]);

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
                ? createBlockForCommand("dialogue", () => uuidService.generate(), parsed.text, { characterId: parsed.characterId })
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
            // A freeze can land while the dialog is up - the author froze the workspace on purpose,
            // by going to look at a version. Continuing would insert into the in-memory scene, the fs
            // boundary would refuse the save, and the thaw's re-read would drop the rows: a paste that
            // looked like it worked right up until the workspace came back.
            //
            // Checked BEFORE the slot's blur-commit is given back, because the freeze deliberately
            // latched it (see the controller's freeze effect) and restoring it here would undo that.
            if (params.isFrozen()) {
                return;
            }
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

    /** The rows a copy would take: the marked ones, or the focused one when nothing is marked. */
    const selectionRootIds = useMemo(() => {
        const { scene, selectedBlockIds, activeBlockId } = params;
        if (!scene) {
            return [];
        }
        const ids = selectedBlockIds.size > 0 ? [...selectedBlockIds] : activeBlockId ? [activeBlockId] : [];
        return filterOutSelectedDescendants(scene, ids);
    }, [params.scene, params.selectedBlockIds, params.activeBlockId]);

    /** Whether a copy would take anything at all - the gate on the work done ahead of the gesture. */
    const hasSelection = selectionRootIds.length > 0;

    /** The library ids those rows reference, in the order the rows name them. */
    const selectionAssetIds = useMemo(
        () => (params.scene ? collectStoryAssetIds(collectSubtreeBlocks(params.scene, selectionRootIds)) : []),
        [params.scene, selectionRootIds],
    );

    /**
     * Grants for the files the current selection would need, minted before the gesture that spends
     * them - keyed by the ids they cover, so a selection made twice costs one round trip.
     *
     * Ahead of the gesture because a `copy` event has to have written the clipboard by the time it
     * returns, and only the main process can mint the token: one IPC round trip, which no
     * synchronous handler can wait for. So the offer is made when the selection settles instead. A
     * selection whose rows reference no importable file offers nothing at all, which is nearly
     * every selection; and a copy made before an offer comes back still copies its rows, which a
     * paste treats the way it treats a source window that has since closed.
     */
    const assetOffersRef = useRef(new Map<string, { token: string; entries: AssetTransferManifestEntry[] }>());
    const assetOfferKey = selectionAssetIds.join(" ");

    useEffect(() => {
        const { assetsService } = params;
        if (!assetsService || !assetOfferKey || assetOffersRef.current.has(assetOfferKey)) {
            return;
        }
        const entries = buildAssetTransferEntries(assetsService, selectionAssetIds);
        if (entries.length === 0) {
            return;
        }
        let cancelled = false;
        void (async () => {
            let offered: { token: string } | null = null;
            try {
                const status = await getInterface().assets.transfer.offer(entries);
                offered = status.success && status.data.offered ? { token: status.data.token } : null;
            } catch (error) {
                // A refusal is data and arrives as one; this is the transport itself failing, and a
                // copy that reported it would be a dialog raised by pressing Ctrl+C.
                console.warn("[storyClipboard] could not offer the selection's assets", error);
            }
            if (cancelled || !offered) {
                return;
            }
            assetOffersRef.current.set(assetOfferKey, {
                token: offered.token,
                entries: entries.map(({ sourcePath: _path, ...manifest }) => manifest),
            });
        })();
        return () => {
            cancelled = true;
        };
    }, [assetOfferKey, params.assetsService]);

    /**
     * Read this project's translations into memory ahead of a copy.
     *
     * For the reason the asset grants are minted ahead of the gesture: a `copy` event has to have
     * written the clipboard by the time it returns, so nothing inside it can wait for a file to be
     * read. These are the localization service's own documents, so a language the author already
     * has open costs nothing here, and a project's translations are text.
     *
     * Only while there are rows a copy would take, so a scene left open with nothing selected reads
     * nothing at all.
     */
    useEffect(() => {
        const { localizationService } = params;
        if (!localizationService || !hasSelection) {
            return;
        }
        const load = () => {
            for (const locale of readProjectLocales(localizationService)) {
                if (!localizationService.getDocumentIfLoaded(locale)) {
                    // A language whose file cannot be read is one this copy carries nothing for.
                    void localizationService.loadDocument(locale).catch(() => undefined);
                }
            }
        };
        load();
        return localizationService.onConfigChanged(load);
    }, [params.localizationService, hasSelection]);

    /**
     * Write the translations that travelled with a paste, under the ids it has just minted.
     *
     * After the rows rather than before them, because the ids to write under are what pasting the
     * rows produced. Not part of the paste's undo step, and it cannot be: the scene's history scope
     * captures the scene document, and translations live in per-locale documents another service
     * owns. Undoing a paste therefore leaves these behind as orphans - the same state deleting a
     * translated row already produces, reported by `localization/orphan`.
     */
    const carryTranslations = useCallback(async (
        payload: StoryClipboardPayload,
        textIds: ReadonlyMap<string, string>,
    ): Promise<{ written: number; droppedLocales: number; frozen: boolean }> => {
        const { localizationService } = params;
        const nothing = { written: 0, droppedLocales: 0, frozen: false };
        if (!localizationService || !payload.translations) {
            return nothing;
        }
        const plan = planCarriedTranslations(
            payload.translations,
            textIds,
            new Set(readProjectLocales(localizationService)),
        );
        if (plan.carried === 0) {
            return { ...nothing, droppedLocales: plan.droppedLocales };
        }
        const outcome = await writeCarriedTranslations(
            createCarriedTranslationPort(localizationService, params.isFrozen),
            plan,
        );
        return { ...outcome, droppedLocales: plan.droppedLocales };
    }, [params]);

    /**
     * Carry the takes of the pasted lines onto the ids the paste minted.
     *
     * Nothing about this comes off the clipboard: the takes are read out of this project's own voice
     * libraries under the ids the lines had before the paste renamed them, which the renaming map
     * still holds. A take is an id into this project's audio library and nothing at all anywhere
     * else, so that is also the whole of why a foreign paste does not call this.
     *
     * Not part of the paste's undo step, for the reason the translations are not: takes live in
     * per-language documents another service owns.
     */
    const carryVoice = useCallback(async (textIds: ReadonlyMap<string, string>): Promise<void> => {
        const { voiceService } = params;
        if (!voiceService || textIds.size === 0) {
            return;
        }
        try {
            await carryVoiceWithinProject(voiceService, params.isFrozen, [...textIds.keys()], textIds);
        } catch (error) {
            // The rows are pasted either way, and a recording that could not follow them is one
            // re-link in the voice table - not something to raise a dialog over a Ctrl+V for.
            console.warn("[storyClipboard] could not carry the takes for the pasted rows", error);
        }
    }, [params]);

    /**
     * The translations and takes of a paste inside a live session, as entries every machine writes.
     *
     * The same two sets the ordinary paste writes, assembled instead of written: the translations
     * that travelled on the clipboard, re-keyed onto the ids this paste minted, and the takes read
     * out of this project's own voice libraries under the ids the lines had before it renamed them.
     * The entries themselves - not the ids to look them up under - because the copier read them out
     * of its own memory at the moment of copying, and no other machine has that memory.
     *
     * **Read and handed over; nothing is written here.** The entries go out with the operation that
     * carries the rows and come back as an effect, and every machine in the room - this one included
     * - writes them through the one applier that applies an effect. A paster that wrote from memory
     * as well would be a second implementation for the libraries to disagree through, and it would
     * be the implementation that skips the field-by-field reading the wire value gets.
     */
    const sessionDerivedFor = useCallback(async (
        payload: StoryClipboardPayload,
        textIds: ReadonlyMap<string, string>,
    ): Promise<LiveDerived | undefined> => {
        const { localizationService, voiceService, projectPath } = params;
        // A session freezes everything but its story document, so the ordinary freeze answer would
        // stop these before they were even read. This is the question the write boundary asks.
        const frozen = () => derivedWritesFrozen(projectPath);
        const voicePort = voiceService ? createCarriedVoicePort(voiceService, frozen) : null;
        try {
            const translations = localizationService
                ? planCarriedTranslations(
                    payload.translations,
                    textIds,
                    new Set(readProjectLocales(localizationService)),
                )
                : EMPTY_TRANSLATION_PLAN;
            const voice = voiceService && voicePort
                ? (await planVoiceWithinProject(voiceService, voicePort, [...textIds.keys()], textIds)).plan
                : EMPTY_VOICE_PLAN;
            return liveDerivedFor(translations, voice);
        } catch (error) {
            // The rows are pasted either way, and a translation or a recording that could not follow
            // them is one re-link - not something to raise a dialog over a Ctrl+V for.
            console.warn("[storyClipboard] could not derive the pasted rows' translations and takes", error);
            return undefined;
        }
    }, [params]);

    /**
     * Rows from outside, pasted into a project a live session is open on: **the rows and nothing
     * else.**
     *
     * Not conservatism. A translation on the clipboard, the bytes of another project's files and a
     * take in another project's audio library all exist on this machine only, so no effect can carry
     * the rest of the room to the same result - and a library written here and nowhere else is the
     * divergence the whole session is arranged to avoid.
     *
     * The rows land holding references that resolve to nothing. Nothing here says so, and nothing
     * here should: `assets/missing` and its neighbours report every site with a jump to the row and
     * refuse a build, which is a better report than a count in a toast. The one thing said is what
     * an author cannot find out any other way - that this paste left things behind - and it is said
     * once for the session.
     */
    const pasteRowsOnly = useCallback((
        payload: StoryClipboardPayload,
        target: StoryBlockTarget,
        session: string,
    ) => {
        const rows = rowsOnlyPayload(payload);
        const treatment = treatForeignCharacterRefs(rows.roots, {
            knownCharacterIds: params.knownCharacterIds,
            characterNames: readClipboardCharacterNames(rows.characterNames),
        });
        if (!pasteBlocks(treatment.roots, target)) {
            return;
        }
        if (takeSessionRowsOnlyNotice(session)) {
            params.uiService?.showNotification(translate("story.paste.sessionRowsOnly"), "info");
        }
    }, [params, pasteBlocks]);

    /**
     * A paste of rows written by another project.
     *
     * Asynchronous because the files those rows reference are imported first: the rows are pasted
     * verbatim under the ids they already carry, so an asset that arrives before them makes its row
     * resolve on the spot rather than after a second gesture. The freeze is re-read after every
     * await for the reason the bulk plain paste gives - rows written into a frozen workspace reach
     * the in-memory scene, are refused at the file-system boundary, and are gone again at the thaw.
     *
     * The imported files are not part of the undo entry, for the same reason the wizard's created
     * characters are not part of its own: they are what the rows point at, and one press of undo
     * takes back the rows.
     *
     * Takes do not come across at all. A take names a clip in the audio library of the project that
     * recorded it, and this window can neither read that library nor be handed the clip - the
     * transfer offer covers the files the rows themselves name, and a take's audio is not one of
     * them. Rows arrive unvoiced, and nothing here can say they used to be otherwise, because
     * nothing on the clipboard says so.
     */
    const pasteForeignBlocks = useCallback(async (payload: StoryClipboardPayload, target: StoryBlockTarget) => {
        const { assetsService, fileSystemService } = params;
        const treatment = treatForeignCharacterRefs(payload.roots, {
            knownCharacterIds: params.knownCharacterIds,
            characterNames: readClipboardCharacterNames(payload.characterNames),
        });
        const blocks = listSerializedBlocks(treatment.roots);
        const port = assetsService && fileSystemService
            ? createTransferredAssetPort(assetsService, fileSystemService, params.isFrozen)
            : null;
        const transfer = port
            ? await importTransferredAssets(port, readClipboardAssetGrant(payload.assets), collectStoryAssetIds(blocks))
            : { imported: 0, failed: 0, frozen: false };
        if (transfer.frozen || params.isFrozen()) {
            return;
        }
        const pasted = pasteBlocks(treatment.roots, target);
        if (!pasted) {
            return;
        }
        const translations = await carryTranslations(payload, pasted.textIds);
        // What this window can say still needs the author: a character id nothing here answers to,
        // and a file that did not come across. Every other kind of foreign id is kept verbatim and
        // reported per site by the project lint, which is the report that can jump to the row.
        const unresolved = treatment.unresolvedCharacterRows
            + countUnresolvedAssetSites(blocks, assetId => port?.has(assetId) ?? false);
        params.uiService?.showNotification(
            describeForeignPaste({
                rows: blocks.length,
                project: readClipboardProjectName(payload.source?.name),
                degradedSpeakers: treatment.degradedSpeakers,
                imported: transfer.imported,
                translations: translations.written,
                droppedTranslations: translations.droppedLocales,
                unresolved,
            }),
            unresolved > 0 ? "warning" : "info",
        );
    }, [carryTranslations, params, pasteBlocks]);

    /**
     * The translations and the takes of rows pasted back into the project they were copied from.
     *
     * Silent when it works, which is the ordinary case: the rows are where they were written and
     * every language they carry is still here, so there is nothing an author needs telling. The one
     * thing worth a word is a language removed between the copy and the paste - those translations
     * have nowhere to go, and saying nothing would let the author believe they came across.
     *
     * Translations first, then takes: a take is a recording of the line as the actor for that
     * language reads it, which is the translation where there is one, so a take that landed first
     * would read as stale until its translation caught up.
     *
     * Outside a live session only. Inside one the same two sets travel with the rows instead of
     * being written from here, and are written by whatever applies the effect - see
     * {@link sessionDerivedFor} and the session branch of {@link routePaste}.
     */
    const pasteOwnUnits = useCallback(async (
        payload: StoryClipboardPayload,
        textIds: ReadonlyMap<string, string>,
    ) => {
        const { droppedLocales } = await carryTranslations(payload, textIds);
        if (droppedLocales > 0) {
            params.uiService?.showNotification(
                translateN("story.paste.translationsDropped", droppedLocales),
                "info",
            );
        }
        await carryVoice(textIds);
    }, [carryTranslations, carryVoice, params]);

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
                    const parsed: unknown = JSON.parse(storyBlocksPayload);
                    if (!isStoryClipboardPayload(parsed)) {
                        return false;
                    }
                    const session = liveSessionOnProject(params.projectPath);
                    // Rows from this same project - or from a Studio that predates the source field,
                    // which can only be this machine - paste exactly as they always have.
                    if (classifyStoryPaste(parsed, params.projectPath) === "own") {
                        if (session !== null) {
                            // ⚠ Minted, then derived, then written - in that order and not the
                            // obvious one. What this paste derives is keyed by the ids it mints, and
                            // it has to be known BEFORE the rows are handed to the room: the entries
                            // travel with the operation that carries them, and an operation cannot
                            // be added to once it has gone. The rows therefore appear a beat later
                            // inside a session than outside one, which is the price of everybody
                            // else getting the same translations from the same message.
                            const minted = cloneForPaste(parsed.roots);
                            if (minted) {
                                void sessionDerivedFor(parsed, minted.textIds).then(derived => {
                                    insertClones(minted.clones, anchor.target, derived);
                                });
                            }
                            return true;
                        }
                        const pasted = pasteBlocks(parsed.roots, anchor.target);
                        if (pasted) {
                            void pasteOwnUnits(parsed, pasted.textIds);
                        }
                        return true;
                    }
                    if (session !== null) {
                        // Nothing the rest of the room could derive travels with these, so nothing
                        // does. Outside a session the ordinary cross-project paste is unchanged.
                        pasteRowsOnly(parsed, anchor.target, session);
                        return true;
                    }
                    void pasteForeignBlocks(parsed, anchor.target);
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
                // Before the modal mounts, so nothing of the slot's is left drawing above it.
                params.dismissInsertChooser();
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
    }, [params, pasteBlocks, pasteForeignBlocks, pasteOwnUnits, pasteRowsOnly, pasteSingleLine, pastePlain, resolveAnchor]);

    const copySelectionToClipboard = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
        if (isTextInputActive()) {
            return;
        }
        const { scene, scenes, characters } = params;
        if (!scene) {
            return;
        }
        const roots = selectionRootIds;
        if (roots.length === 0) {
            return;
        }
        const assets = assetOffersRef.current.get(assetOfferKey);
        const translations = collectCopiedTranslations(params.localizationService, scene, roots);
        const payload: StoryClipboardPayload = {
            version: 2,
            kind: "narraleaf.story.actions",
            roots: roots.map(id => serializeBlockSubtree(scene, id)),
            source: {
                path: normalizeProjectPath(params.projectPath),
                identifier: params.projectIdentifier,
                name: params.projectName,
            },
            characterNames: collectCopiedCharacterNames(scene, roots, characters),
            // Absent rather than empty when there is no grant: the field means "these files can be
            // fetched", and an empty one would say that about nothing.
            ...(assets ? { assets } : {}),
            // Absent for the same reason when none of the copied lines is translated.
            ...(translations ? { translations } : {}),
        };
        event.preventDefault();
        event.clipboardData.setData(STORY_ACTIONS_MIME, JSON.stringify(payload));
        event.clipboardData.setData("text/plain", roots.map(id => exportBlockPlainText(scene.blocks[id], characters, scenes)).join("\n"));
    }, [assetOfferKey, params, selectionRootIds]);

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
 * What a paste derives when the workspace has no service to derive it from.
 *
 * Stated rather than left to a null check at each use, so a paste inside a session assembles one
 * shape whether the localization and voice services are up yet or not - a window still starting
 * costs a paste its translations and its takes, and nothing else.
 */
const EMPTY_TRANSLATION_PLAN: CarriedTranslationPlan = { writes: [], carried: 0, droppedLocales: 0 };
const EMPTY_VOICE_PLAN: CarriedVoicePlan = { writes: [], carried: 0 };

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

/**
 * The languages this project declares, its source language included.
 *
 * The source language is in the list because its document may hold units too - nothing stops an
 * author translating a line into the language it is written in - and a copy that skipped it would
 * lose exactly those.
 */
/**
 * What every language of this project says about the lines being copied.
 *
 * Read from the documents already in memory (see the preload effect): a `copy` event cannot wait
 * for a file, so a language that has not been read by the time the gesture happens carries nothing
 * rather than delaying it.
 */
function collectCopiedTranslations(
    service: LocalizationService | null,
    scene: StoryScene,
    rootIds: readonly StoryBlockId[],
): StoryClipboardTranslations | undefined {
    if (!service) {
        return undefined;
    }
    const textIds = listBlockTextIds(collectSubtreeBlocks(scene, rootIds));
    if (textIds.length === 0) {
        return undefined;
    }
    return collectClipboardTranslations(
        textIds,
        readProjectLocales(service),
        locale => service.getDocumentIfLoaded(locale)?.units,
    );
}

/**
 * The names to carry for the characters the copied rows speak as.
 *
 * Only the characters those rows actually name, and only their names - a paste has no use for
 * anything else about them, and a wider table would describe a project to whoever pasted it.
 */
function collectCopiedCharacterNames(
    scene: StoryScene,
    rootIds: readonly StoryBlockId[],
    characters: readonly Character[],
): Record<string, string> {
    const names: Record<string, string> = {};
    for (const characterId of collectStoryCharacterIds(collectSubtreeBlocks(scene, rootIds))) {
        const name = characters.find(character => character.profile.getId() === characterId)?.profile.getName().trim();
        if (name) {
            names[characterId] = name;
        }
    }
    return names;
}

/**
 * The name map off a pasted payload.
 *
 * Rebuilt entry by entry rather than trusted, because it was written by another process: what
 * arrives is JSON of whatever shape, and one value of the wrong type would otherwise be written
 * into a row as a speaker.
 */
function readClipboardCharacterNames(value: unknown): Record<string, string> {
    if (!value || typeof value !== "object") {
        return {};
    }
    const names: Record<string, string> = {};
    for (const [characterId, name] of Object.entries(value as Record<string, unknown>)) {
        if (typeof name === "string" && name.trim()) {
            names[characterId] = name;
        }
    }
    return names;
}

/**
 * The source project's name, when it is one a notification can carry.
 *
 * A payload written by another process says what it likes about itself, so a name that is blank or
 * longer than a line is dropped rather than shortened - the paste then reports its counts without
 * naming where they came from, which is true either way.
 */
function readClipboardProjectName(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }
    const name = value.trim();
    return name && name.length <= CLIPBOARD_PROJECT_NAME_LIMIT ? name : null;
}

const CLIPBOARD_PROJECT_NAME_LIMIT = 64;

/** What a foreign paste did, as one line of counts. Anything that came to nothing is left out. */
function describeForeignPaste(outcome: {
    rows: number;
    project: string | null;
    degradedSpeakers: number;
    imported: number;
    translations: number;
    droppedTranslations: number;
    unresolved: number;
}): string {
    const parts = [
        outcome.project
            ? translateN("story.crossProject.pastedFrom", outcome.rows, { project: outcome.project })
            : translateN("story.crossProject.pasted", outcome.rows),
    ];
    if (outcome.degradedSpeakers > 0) {
        parts.push(translateN("story.crossProject.speakerNames", outcome.degradedSpeakers));
    }
    if (outcome.imported > 0) {
        parts.push(translateN("story.crossProject.imported", outcome.imported));
    }
    if (outcome.translations > 0) {
        parts.push(translateN("story.paste.translationsCarried", outcome.translations));
    }
    if (outcome.droppedTranslations > 0) {
        parts.push(translateN("story.paste.translationsDropped", outcome.droppedTranslations));
    }
    if (outcome.unresolved > 0) {
        parts.push(translateN("story.crossProject.unresolved", outcome.unresolved));
    }
    return parts.join(" · ");
}
