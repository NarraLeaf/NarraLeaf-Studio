import { getProjectWriteFreeze } from "@/lib/app/writeFreeze";
import { Services, type WorkspaceContext } from "../services";
import type { ProjectDependencyService } from "./ProjectDependencyService";

/**
 * Refresh the plugin dependency table before a run.
 *
 * Which plugin runtime entries go into the pack is decided from that table (see
 * `selectProjectRuntimePlugins`), so the first run after an author added the row that USES a plugin -
 * a plugin blueprint node, a plugin story action - has to see that row, or it runs a game the plugin
 * is not in and the feature simply does not happen.
 *
 * Called from the launch itself (`DevModeService.launch`, `PreviewService.launch`) rather than from
 * the controls that start one. It used to live in the top bar's Run button alone, so a story row's
 * play control and the canvas's launch button started Dev Mode on a stale table: the session left
 * out a plugin the story had just started using and said so in a banner, asking the author to
 * rescan by hand.
 *
 * Best-effort and awaited: a scan failure must not stop the author running their game, but a run
 * that starts before the scan lands would pack the stale answer. Skipped on a frozen workspace -
 * nobody asked for this write, and it is bookkeeping rather than the thing being run.
 *
 * An automatic scan: a plugin Studio holds back from the project for its version stays held through
 * any number of runs, until the author presses Rescan.
 */
export async function refreshDependenciesForRun(context: WorkspaceContext): Promise<void> {
    if (getProjectWriteFreeze() !== null) {
        return;
    }
    try {
        await context.services
            .get<ProjectDependencyService>(Services.ProjectDependency)
            .rescanAndPersist("automatic");
    } catch (error) {
        console.warn("[run] plugin dependency rescan failed", error);
    }
}
