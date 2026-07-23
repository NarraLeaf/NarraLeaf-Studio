import { useCallback, useSyncExternalStore } from "react";
import type { StoryBlock, StoryBlockId, StoryDocument, StorySceneId } from "@shared/types/story";
import type { Character } from "@/lib/workspace/services/character/Character";

export const STORY_INSPECTOR_PANEL_ID = "narraleaf-studio:story-inspector";

export type StoryInspectorPanelPayload = {
    tabId: string;
    storyId: string;
    sceneId: string;
    storyName?: string;
    sceneName?: string;
};

/**
 * The live inspector context for one editor tab: the block whose fields the right-panel inspector
 * renders, plus the controller callbacks that edit it. Published by the tab, read by the (globally
 * registered) inspector panel — which lives outside the tab's React subtree and so cannot reach the
 * controller by props. `null` means nothing inspectable is open, and the panel shows its empty state.
 */
export type StoryInspectorBridgeState = {
    block: StoryBlock;
    document: StoryDocument;
    sceneId: StorySceneId;
    characters: Character[];
    onUpdatePayload: (payload: StoryBlock["payload"]) => void;
    onClose: () => void;
    onSetDialogueCharacter: (characterId: string | undefined) => void;
    generateTextId: () => string;
    onCreateLayer: (beforeBlockId: StoryBlockId) => string | null;
};

const states = new Map<string, StoryInspectorBridgeState>();
const listeners = new Map<string, Set<() => void>>();

function emit(tabId: string): void {
    const set = listeners.get(tabId);
    if (!set) {
        return;
    }
    for (const listener of set) {
        listener();
    }
}

/** Publish (or clear, with `null`) a tab's inspector context. Idempotent when the value is unchanged. */
export function publishStoryInspectorState(tabId: string, state: StoryInspectorBridgeState | null): void {
    const current = states.get(tabId) ?? null;
    if (current === state) {
        return;
    }
    if (state) {
        states.set(tabId, state);
    } else {
        states.delete(tabId);
    }
    emit(tabId);
}

export function useStoryInspectorState(tabId: string | undefined): StoryInspectorBridgeState | null {
    const subscribe = useCallback((onChange: () => void) => {
        if (!tabId) {
            return () => {};
        }
        let set = listeners.get(tabId);
        if (!set) {
            set = new Set();
            listeners.set(tabId, set);
        }
        set.add(onChange);
        return () => {
            const current = listeners.get(tabId);
            if (!current) {
                return;
            }
            current.delete(onChange);
            if (current.size === 0) {
                listeners.delete(tabId);
            }
        };
    }, [tabId]);

    const getSnapshot = useCallback(() => (tabId ? states.get(tabId) ?? null : null), [tabId]);

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
