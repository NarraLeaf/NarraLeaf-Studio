import { useCallback, useEffect, useMemo, useState } from "react";
import type { StoryAnimationIndexEntry } from "@shared/types/story";
import { Services } from "@/lib/workspace/services/services";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { useWorkspace } from "@/apps/workspace/context";

/**
 * `animationId → motion name`, for the row projection.
 *
 * A row that binds a Story Motion stores only its id, and the projection is a pure function that
 * cannot reach a service — the same split `assetName` already lives on. Without this a `/camera
 * motion` row reads just "Motion", which among several of them says nothing about which shot it is.
 *
 * Reads the in-memory animation index (already loaded, synchronous) and re-renders on change, so a
 * motion renamed in its editor updates the rows that reference it.
 */
export function useStoryMotionNames(): (animationId: string) => string | null {
  const { context, isInitialized } = useWorkspace();
  const storyService = useMemo(
    () => (context && isInitialized ? context.services.get<StoryService>(Services.Story) : null),
    [context, isInitialized]
  );
  const [entries, setEntries] = useState<StoryAnimationIndexEntry[]>([]);

  useEffect(() => {
    if (!storyService) {
      setEntries([]);
      return;
    }
    setEntries([...storyService.listAnimationAssets()]);
    return storyService.onAnimationsChanged((index) => setEntries([...index.animations]));
  }, [storyService]);

  const byId = useMemo(() => {
    const table = new Map<string, string>();
    for (const entry of entries) {
      table.set(entry.id, entry.name);
    }
    return table;
  }, [entries]);

  return useCallback((animationId: string) => byId.get(animationId) ?? null, [byId]);
}
