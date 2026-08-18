import { useCallback, useSyncExternalStore } from "react";
import type {
  StoryBlock,
  StoryBlockId,
  StoryDocument,
  StoryId,
  StoryScene,
  StorySceneId,
  StorySceneUpdate
} from "@shared/types/story";
import type { Character } from "@/lib/workspace/services/character/Character";

/**
 * The live inspector context for one editor tab: what the right rail renders and the controller
 * callbacks that edit it. Published by the tab, read by the properties panel — which lives outside the
 * tab's React subtree and so cannot reach the controller by props.
 *
 * This is a transport, not a switch. It says what the subject *is*; whether the rail shows it is
 * decided by the app-wide selection (`storySelection.ts`), which the same tab publishes. The bridge
 * used to double as the panel's visibility mechanism — that is what made the rail jump to unrelated
 * panels and go stale on the previously inspected row.
 *
 * `block` is null when no row is focused: the scene is then the subject, and the panel renders the
 * scene's own fields. `null` for the whole state means this tab has nothing to show (not mounted, not
 * active, or still loading).
 */
export type StoryInspectorBridgeState = {
  storyId: StoryId;
  sceneId: StorySceneId;
  scene: StoryScene;
  document: StoryDocument;
  characters: Character[];
  /** The focused row, or null when the scene itself is the subject. */
  block: StoryBlock | null;
  onUpdatePayload: (payload: StoryBlock["payload"]) => void;
  onClose: () => void;
  onSetDialogueCharacter: (characterId: string | undefined) => void;
  generateTextId: () => string;
  onCreateLayer: (beforeBlockId: StoryBlockId) => string | null;
  /**
   * The one write path for the scene's own metadata — the controller's `updateSceneMetadata`, which
   * is also what the inline scene header card commits through. Two surfaces, one commit, so undo
   * stays a single step whichever one the edit came from.
   */
  onUpdateScene: (patch: StorySceneUpdate) => boolean;
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
export function publishStoryInspectorState(
  tabId: string,
  state: StoryInspectorBridgeState | null
): void {
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

export function useStoryInspectorState(
  tabId: string | undefined
): StoryInspectorBridgeState | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
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
    },
    [tabId]
  );

  const getSnapshot = useCallback(() => (tabId ? (states.get(tabId) ?? null) : null), [tabId]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
