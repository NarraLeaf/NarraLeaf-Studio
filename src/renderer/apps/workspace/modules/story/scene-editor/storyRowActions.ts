import { createContext, useContext } from "react";
import type { MouseEvent } from "react";
import type { StoryBlock, StoryBlockId, StoryRichRun } from "@shared/types/story";
import type { StoryStagePlacement } from "./storySceneEditorTypes";

/**
 * Everything a story row can *do*, as one object that never changes identity.
 *
 * Rows used to receive ~25 callbacks as props, every one of them an arrow function built inside the
 * tab's `visibleRows.map(...)`. That made `React.memo` on the row worthless before it was even tried:
 * each render handed every row a fresh set of props, so every row re-rendered on every state change —
 * a measured 100ms long task per keystroke and per click on a 400-row scene, growing linearly with the
 * scene.
 *
 * Moving them here turns the per-row half of each callback into an argument (`blockId`) and lets the
 * tab publish one memo-stable object through context. What is left on the row's props is data, and
 * data compares cheaply — so a selection change now re-renders the two rows whose `selected` flipped
 * instead of the whole document.
 *
 * The stability requirement is absolute: this object is read through context, and a context value that
 * changes identity re-renders every consumer regardless of `memo`. The provider therefore builds it
 * once and reads the current closures from a ref (see `useStoryRowActionsValue`), rather than listing
 * them as dependencies.
 */
export type StoryRowActions = {
    select: (blockId: StoryBlockId, event: MouseEvent) => void;
    contextMenu: (blockId: StoryBlockId, event: MouseEvent) => void;
    mouseDown: (blockId: StoryBlockId, event: MouseEvent) => void;
    /** Pointer entered the row — extends an in-progress drag selection. */
    mouseEnter: (blockId: StoryBlockId) => void;
    toggleCollapsed: (blockId: StoryBlockId) => void;
    /** Open this row's text for in-place editing (no-op on a row that carries none). */
    startTextEdit: (blockId: StoryBlockId) => void;
    editRichChange: (blockId: StoryBlockId, value: string, runs: StoryRichRun[]) => void;
    commitTextEdit: () => void;
    exitTextEdit: () => void;
    /** Enter while editing: commit and open a continuation row. */
    continueRow: () => void;
    arrowOut: (direction: "up" | "down" | "left" | "right", caretX: number | null) => void;
    goalColumnInvalidated: () => void;
    backspaceAtEmptyStart: () => void;
    undoBeyondRow: () => void;
    redoBeyondRow: () => void;
    /** Activate a non-text row: opens its inspector, or runs its card-less op. */
    openInspector: (blockId: StoryBlockId) => void;
    updatePayload: (blockId: StoryBlockId, payload: StoryBlock["payload"]) => void;
    setDialogueCharacter: (blockId: StoryBlockId, characterId: string | undefined) => void;
    /**
     * Set the dialogue group's placement. `sourceId` is the row's own resolved appearance source —
     * the row knows it, the tab does not, so it stays an argument rather than a lookup.
     */
    setPosition: (blockId: StoryBlockId, position: StoryStagePlacement, sourceId: StoryBlockId | null) => void;
    setSpeaker: (blockId: StoryBlockId, speaker: { characterId: string } | { speakerName: string } | null) => void;
    createCharacter: (blockId: StoryBlockId, name: string) => void;
    insertAfter: (blockId: StoryBlockId) => void;
    deleteRow: (blockId: StoryBlockId) => void;
    /** Insert a fresh child at the end of a container. */
    addInside: (parentId: StoryBlockId) => void;
    addBranch: (conditionId: StoryBlockId, branch: "if" | "elseIf" | "else") => void;
    playFromRow: (blockId: StoryBlockId) => void;
    toggleLens: (blockId: StoryBlockId) => void;
};

/**
 * A row rendered without a provider is inert rather than broken — every action is a no-op. Rows appear
 * in tests and in isolated previews, and a thrown "missing provider" there would be noise, not a bug.
 */
const NOOP_ACTIONS: StoryRowActions = {
    select: () => {},
    contextMenu: () => {},
    mouseDown: () => {},
    mouseEnter: () => {},
    toggleCollapsed: () => {},
    startTextEdit: () => {},
    editRichChange: () => {},
    commitTextEdit: () => {},
    exitTextEdit: () => {},
    continueRow: () => {},
    arrowOut: () => {},
    goalColumnInvalidated: () => {},
    backspaceAtEmptyStart: () => {},
    undoBeyondRow: () => {},
    redoBeyondRow: () => {},
    openInspector: () => {},
    updatePayload: () => {},
    setDialogueCharacter: () => {},
    setPosition: () => {},
    setSpeaker: () => {},
    createCharacter: () => {},
    insertAfter: () => {},
    deleteRow: () => {},
    addInside: () => {},
    addBranch: () => {},
    playFromRow: () => {},
    toggleLens: () => {},
};

export const StoryRowActionsContext = createContext<StoryRowActions>(NOOP_ACTIONS);

export function useStoryRowActions(): StoryRowActions {
    return useContext(StoryRowActionsContext);
}
