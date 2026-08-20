import { useCallback, useEffect, useMemo, useRef, type ClipboardEvent, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { AssetTransferEntry, AssetTransferManifestEntry } from "@shared/types/assetTransfer";
import type { StoryBlock, StoryBlockId, StoryScene, StorySceneId } from "@shared/types/story";
import { normalizeProjectPath } from "@shared/utils/recentProject";
import { getInterface } from "@/lib/app/bridge";
import type { Character } from "@/lib/workspace/services/character/Character";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { AssetCreateErrorCode, type Asset, type AssetsMap } from "@/lib/workspace/services/assets/types";
import type { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import type { FileSystemService } from "@/lib/workspace/services/core/FileSystem";
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
import {
    collectStoryAssetIds,
    collectStoryCharacterIds,
    collectSubtreeBlocks,
    countUnresolvedAssetSites,
    importTransferredAssets,
    isStoryPasteFromAnotherProject,
    listSerializedBlocks,
    treatForeignCharacterRefs,
    type TransferredAssetGrant,
    type TransferredAssetPort,
} from "./storyForeignPaste";
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
    /** The library a foreign paste imports into, and the one a copy offers files out of. */
    assetsService: AssetsService | null;
    /** Reads the bytes of a file a redeemed transfer granted access to. */
    fileSystemService: FileSystemService | null;
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

    /** Clone the payload's rows into the scene as one undo step. False when nothing could be written. */
    const pasteBlocks = useCallback((roots: SerializedStoryBlock[], target: StoryBlockTarget): boolean => {
        const { storyService, uuidService, storyId, sceneId } = params;
        if (!storyService || !uuidService || !storyId || !sceneId) {
            return false;
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
        return insertedRoots.length > 0;
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
        const entries = buildTransferEntries(assetsService, selectionAssetIds);
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
            ? await importTransferredAssets(port, readClipboardAssets(payload.assets), collectStoryAssetIds(blocks))
            : { imported: 0, failed: 0, frozen: false };
        if (transfer.frozen || params.isFrozen()) {
            return;
        }
        if (!pasteBlocks(treatment.roots, target)) {
            return;
        }
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
                unresolved,
            }),
            unresolved > 0 ? "warning" : "info",
        );
    }, [params, pasteBlocks]);

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
                    // Rows from this same project - or from a Studio that predates the source field,
                    // which can only be this machine - paste exactly as they always have.
                    if (!isStoryPasteFromAnotherProject(parsed, params.projectPath)) {
                        pasteBlocks(parsed.roots, anchor.target);
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
    }, [params, pasteBlocks, pasteForeignBlocks, pasteSingleLine, pastePlain, resolveAnchor]);

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
 * The files behind a set of asset ids, described for an offer.
 *
 * An id with no library record is skipped: it names an asset set, or a reference this project has
 * already lost, and either way there are no bytes to vouch for. A model bundle is skipped too - it
 * is a directory, and a redeemed grant reaches the path it names and nothing below it, so a model
 * travels as an unresolved reference (which the pasting project reports) rather than as a read that
 * finds half a character.
 */
function buildTransferEntries(assetsService: AssetsService, assetIds: readonly string[]): AssetTransferEntry[] {
    let library: AssetsMap;
    let localPathOf: (assetId: string) => string;
    try {
        library = assetsService.getAssets();
        const manager = assetsService.getLocalAssetsManager();
        localPathOf = (assetId: string) => manager.getLocalAssetPath(assetId);
    } catch {
        // The library is not open yet. Copying rows does not wait for it.
        return [];
    }
    const entries: AssetTransferEntry[] = [];
    for (const assetId of assetIds) {
        const asset = findLibraryAsset(library, assetId);
        if (!asset || asset.type === AssetType.Model) {
            continue;
        }
        entries.push({
            assetId: asset.id,
            // A record with no name would be refused, and one blank name refuses the whole manifest.
            fileName: asset.name.trim() || asset.id,
            type: asset.type,
            sourcePath: localPathOf(asset.id),
        });
    }
    return entries;
}

/**
 * The asset holding an id, whichever type it is filed under.
 *
 * Every type is searched because the content path carries no type segment: one id names one file on
 * disk, so an id an audio asset occupies is not free for an image either.
 */
function findLibraryAsset(library: AssetsMap, assetId: string): Asset | null {
    for (const type of Object.values(AssetType)) {
        const asset = library[type]?.[assetId];
        if (asset) {
            return asset;
        }
    }
    return null;
}

/**
 * The workspace, as {@link importTransferredAssets} asks about it.
 *
 * Every method answers rather than throws: an import that raised would cost the author the rows,
 * and a paste is worth more than the file it could not bring with it.
 */
function createTransferredAssetPort(
    assetsService: AssetsService,
    fileSystemService: FileSystemService,
    isFrozen: () => boolean,
): TransferredAssetPort {
    return {
        redeem: async (token: string) => {
            try {
                const status = await getInterface().assets.transfer.redeem(token);
                return status.success && status.data.available ? status.data.entries : null;
            } catch (error) {
                console.warn("[storyClipboard] could not redeem the pasted asset manifest", error);
                return null;
            }
        },
        has: (assetId: string) => {
            try {
                return Boolean(findLibraryAsset(assetsService.getAssets(), assetId));
            } catch {
                return false;
            }
        },
        read: async (sourcePath: string) => {
            try {
                const result = await fileSystemService.readRaw(sourcePath);
                return result.ok ? result.data : null;
            } catch {
                return null;
            }
        },
        create: async (entry, bytes) => {
            const type = toAssetType(entry.type);
            if (!type) {
                return "failed";
            }
            try {
                // No group: the file lands at the root of its section, the way a file created from
                // a category header does. The group it sat in over there is another project's id
                // and names nothing here.
                const created = await assetsService.createLocalAssetFromBytes(
                    type,
                    entry.fileName,
                    bytes,
                    undefined,
                    { id: entry.assetId },
                );
                if (created.success) {
                    return "created";
                }
                // An id this library turns out to hold already is the outcome the reference wanted:
                // it resolves. Nothing was written, and a second paste of the same clipboard lands
                // here rather than duplicating the file.
                return created.code === AssetCreateErrorCode.IdInUse ? "present" : "failed";
            } catch (error) {
                console.warn(`[storyClipboard] could not import "${entry.fileName}"`, error);
                return "failed";
            }
        },
        isFrozen,
    };
}

/** The `AssetType` a manifest entry names, or null when this Studio has no such type. */
function toAssetType(value: string): AssetType | null {
    return (Object.values(AssetType) as string[]).includes(value) ? value as AssetType : null;
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
 * The asset manifest off a pasted payload, or undefined when it does not describe one.
 *
 * Rebuilt entry by entry, like the name map and for the same reason. Only the ids are ever acted
 * on: what a file is called and where it lives come from the main process at redeem time, which
 * verified both against the window that offered them - nothing on the clipboard addresses a file.
 */
function readClipboardAssets(value: unknown): TransferredAssetGrant | undefined {
    if (!value || typeof value !== "object") {
        return undefined;
    }
    const { token, entries } = value as { token?: unknown; entries?: unknown };
    if (typeof token !== "string" || !token || !Array.isArray(entries)) {
        return undefined;
    }
    const declaredAssetIds: string[] = [];
    for (const entry of entries) {
        const assetId = (entry as { assetId?: unknown })?.assetId;
        if (typeof assetId === "string" && assetId) {
            declaredAssetIds.push(assetId);
        }
    }
    return { token, declaredAssetIds };
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
    if (outcome.unresolved > 0) {
        parts.push(translateN("story.crossProject.unresolved", outcome.unresolved));
    }
    return parts.join(" · ");
}
