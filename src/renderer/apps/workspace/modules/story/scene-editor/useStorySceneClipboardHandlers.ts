import { useCallback, type ClipboardEvent, type Dispatch, type SetStateAction } from "react";
import type { StoryBlockId, StoryScene } from "@shared/types/story";
import type { Character } from "@/lib/workspace/services/character/Character";
import type { UuidService } from "@/lib/workspace/services/core/UuidService";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
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
import type { EditorMode, SerializedStoryBlock, StoryClipboardPayload, VisibleStoryRow } from "./storySceneEditorTypes";

export function useStorySceneClipboardHandlers(params: {
    storyService: StoryService | null;
    uuidService: UuidService | null;
    storyId: string | undefined;
    sceneId: string | undefined;
    scene: StoryScene | null;
    characters: Character[];
    selectedBlockIds: Set<StoryBlockId>;
    activeBlockId: StoryBlockId | null;
    visibleRows: VisibleStoryRow[];
    plainPasteRequestedRef: { current: boolean };
    recordHistory: () => boolean;
    setActiveBlockId: Dispatch<SetStateAction<StoryBlockId | null>>;
    setSelectedBlockIds: Dispatch<SetStateAction<Set<StoryBlockId>>>;
    setEditorMode: Dispatch<SetStateAction<EditorMode>>;
    setStatusText: Dispatch<SetStateAction<string>>;
}) {
    const pasteBlocks = useCallback((roots: SerializedStoryBlock[], afterBlockId: StoryBlockId | null) => {
        const { storyService, uuidService, storyId, sceneId, scene } = params;
        if (!storyService || !uuidService || !storyId || !sceneId || !scene) {
            return;
        }
        params.recordHistory();
        const insertionTarget = getInsertionTargetAfter(scene, afterBlockId);
        const insertedRoots: StoryBlockId[] = [];
        for (const root of roots) {
            const cloned = cloneSerializedBlock(root, () => uuidService.generate());
            insertSerializedClone(storyService, storyId, sceneId, cloned, insertionTarget);
            insertedRoots.push(cloned.block.id);
        }
        if (insertedRoots[0]) {
            params.setActiveBlockId(insertedRoots[0]);
            params.setSelectedBlockIds(new Set(insertedRoots));
        }
        params.setEditorMode({ kind: "idle" });
        params.setStatusText(`Pasted ${insertedRoots.length} raw action row${insertedRoots.length === 1 ? "" : "s"}.`);
    }, [params]);

    const pastePlainText = useCallback((text: string, afterBlockId: StoryBlockId | null, mode: "smart" | "plain") => {
        const { storyService, uuidService, storyId, sceneId, scene, characters } = params;
        if (!storyService || !uuidService || !storyId || !sceneId || !scene) {
            return;
        }
        const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        if (lines.length === 0) {
            return;
        }
        params.recordHistory();
        const insertionTarget = getInsertionTargetAfter(scene, afterBlockId);
        const insertedIds: StoryBlockId[] = [];
        for (const line of lines) {
            const parsed = mode === "smart" ? parseDialogueLine(line, characters) : null;
            const block = parsed
                ? createBlockForCommand("dialogue", () => uuidService.generate(), parsed.text, parsed.characterId)
                : createBlockForCommand("narration", () => uuidService.generate(), line);
            storyService.insertBlock(storyId, sceneId, block, insertionTarget);
            insertedIds.push(block.id);
        }
        if (insertedIds[0]) {
            params.setActiveBlockId(insertedIds[0]);
            params.setSelectedBlockIds(new Set(insertedIds));
            params.setStatusText(
                mode === "smart"
                    ? `Pasted ${insertedIds.length} line${insertedIds.length === 1 ? "" : "s"} with dialogue detection.`
                    : `Pasted ${insertedIds.length} narration line${insertedIds.length === 1 ? "" : "s"}.`,
            );
        }
    }, [params]);

    const copySelectionToClipboard = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
        if (isTextInputActive()) {
            return;
        }
        const { scene, selectedBlockIds, activeBlockId, characters } = params;
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
        event.clipboardData.setData("text/plain", roots.map(id => exportBlockPlainText(scene.blocks[id], characters)).join("\n"));
        params.setStatusText(`Copied ${roots.length} raw action row${roots.length === 1 ? "" : "s"}.`);
    }, [params]);

    const handlePaste = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
        if (isTextInputActive()) {
            return;
        }
        const afterBlockId = getPasteAnchorId(params.visibleRows, params.selectedBlockIds, params.activeBlockId);
        const rawPayload = event.clipboardData.getData(STORY_ACTIONS_MIME);
        if (rawPayload) {
            try {
                const parsed = JSON.parse(rawPayload) as StoryClipboardPayload;
                if (isStoryClipboardPayload(parsed)) {
                    event.preventDefault();
                    pasteBlocks(parsed.roots, afterBlockId);
                    return;
                }
            } catch {
                params.setStatusText("Ignored invalid story clipboard payload.");
            }
        }
        const text = event.clipboardData.getData("text/plain");
        if (text.trim()) {
            event.preventDefault();
            const pasteMode = params.plainPasteRequestedRef.current || hasShiftModifier(event) ? "plain" : "smart";
            params.plainPasteRequestedRef.current = false;
            pastePlainText(text, afterBlockId, pasteMode);
        }
    }, [params, pasteBlocks, pastePlainText]);

    return { copySelectionToClipboard, handlePaste };
}
