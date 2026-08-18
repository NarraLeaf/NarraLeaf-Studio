import type { Workspace } from "@/lib/workspace/workspace";
import { flushPendingSaves } from "@/lib/workspace/services/autosave/flushPendingSaves";

/**
 * Persist editor-side project state to disk before Dev Mode or Preview reads project files.
 *
 * Delegates to the one full-coverage flush. The hand-written list this used to carry named four
 * stores and missed three (localization, voice, the variable registry), so every Dev Mode launch
 * compiled whatever those three happened to have on disk from an earlier session - the newly typed
 * translations were still sitting in a debounce timer.
 */
export async function flushUIDocAndGraphIfDirty(workspace: Workspace): Promise<void> {
  await flushPendingSaves(workspace.getContext());
}
