import { useEffect } from "react";
import { getInterface } from "@/lib/app/bridge";
import { useWorkspace } from "@/apps/workspace/context";
import { useRegistry } from "@/apps/workspace/registry";
import { Services } from "@/lib/workspace/services/services";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { getStorySceneName } from "@/lib/story/storyRowProjection";
import type { StoryDocument } from "@shared/types/story";
import { createStorySceneEditorTab } from "./openStorySceneEditorTab";

/**
 * "Open this row in Studio", from the Dev Mode error banner: opens the scene editor on the row that
 * failed and deep-links to it.
 *
 * The sibling of `StoryRowHighlightBridge`, and deliberately the loud one. That bridge follows the
 * play head and must never open a tab; this one runs only because the author clicked a located
 * error, so opening the tab IS the request. Both exist because the two behaviours cannot share a
 * channel without one of them being wrong.
 *
 * The deep link is the scene editor's own `activeBlockId` — the same affordance search jumps ride,
 * so an error lands the author exactly where a search hit would, and re-opening an already-open tab
 * replaces its payload and re-fires the link.
 */
export function DevModeStoryRowOpenBridge(): null {
  const { openEditorTab } = useRegistry();
  const { context } = useWorkspace();

  useEffect(() => {
    const token = getInterface().devMode.onStoryRowOpen(({ storyId, sceneId, blockId }) => {
      // Resolved against the live document, not taken on trust: Dev Mode is running a bundle
      // that was compiled at some point in the past, so the scene it names can have been
      // renamed or deleted since. A missing scene is dropped rather than opened — `getStorySceneName`
      // would happily title the tab "Unknown scene", and a tab pointing at nothing helps nobody.
      // The name, never the id: a tab titled with a UUID is one the author cannot tell apart.
      let document: StoryDocument | undefined;
      try {
        document = context?.services.get<StoryService>(Services.Story).getStoryDocument(storyId);
      } catch {
        document = undefined;
      }
      if (!document?.scenes[sceneId]) {
        return;
      }
      openEditorTab(
        createStorySceneEditorTab(
          { storyId, sceneId, activeBlockId: blockId },
          getStorySceneName(document.scenes, sceneId)
        )
      );
    });
    return () => token.cancel();
  }, [openEditorTab, context]);

  return null;
}
