import { useEffect, useState } from "react";
import type { WorkspaceContext } from "@/lib/workspace/services/services";
import { Services } from "@/lib/workspace/services/services";
import type { WorkspaceReloadService } from "@/lib/workspace/services/core/WorkspaceReloadService";

/**
 * How many times this workspace has re-read the working tree from disk.
 *
 * Meant to be part of a React `key`. After a reload an open editor tab can be pointing at a scene,
 * graph or asset the re-read tree no longer contains - not hypothetically: a scene created while the
 * workspace was frozen never reached disk, so it is gone the moment the tree is re-read, and its tab
 * is still open. Remounting the tab makes it re-run the load it already has and land in the "not
 * found" state it already renders, which is far cheaper and far harder to get wrong than teaching one
 * resolver about every tab kind.
 *
 * Returns 0 when there is no reload service to ask (an unmounted-from-context render path); a
 * constant key is exactly right in that case, because nothing has been reloaded.
 */
export function useWorkspaceReloadGeneration(context: WorkspaceContext | null): number {
  const reloadService = (() => {
    try {
      return context
        ? context.services.get<WorkspaceReloadService>(Services.WorkspaceReload)
        : null;
    } catch {
      return null;
    }
  })();
  const [generation, setGeneration] = useState(() => reloadService?.getGeneration() ?? 0);

  useEffect(() => {
    if (!reloadService) {
      return;
    }
    // Read once on subscribe as well: a reload that finished between the first render and this
    // effect would otherwise leave the tabs keyed on a generation that is already behind.
    setGeneration(reloadService.getGeneration());
    return reloadService.onReloaded(() => setGeneration(reloadService.getGeneration()));
  }, [reloadService]);

  return generation;
}
