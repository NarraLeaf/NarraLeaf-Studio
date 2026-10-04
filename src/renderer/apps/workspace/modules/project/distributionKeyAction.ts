/**
 * Minting the project's distribution key from the interface.
 *
 * One implementation behind every control that offers it - the Create/Replace button on
 * Project ▸ Project and the Create button beside the build dialog's notice - so the two cannot come
 * to differ about when to ask first or how a failure is reported. The value itself is produced by
 * the host process through {@link ProjectService.rotateDistributionKey}; this only decides what the
 * author is asked and told around it.
 */

import { translate } from "@/lib/i18n";
import type { ProjectConfig } from "@/lib/workspace/project/project";
import type { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import type { UIService } from "@/lib/workspace/services/core/UIService";

/**
 * Create the key, or replace the one the project has.
 *
 * Asks first only when there is something to lose. The first mint changes nothing that exists yet,
 * and a confirmation on it would teach the author to click through the one that matters: replacing
 * a key stops every build already shipped under it from accepting a patch made afterwards.
 *
 * Answers with the manifest as written, or null when the author declined or the mint failed - a
 * failure has already been put in front of them by then.
 */
export async function rotateDistributionKey(
    projectService: ProjectService,
    uiService: UIService | null,
): Promise<ProjectConfig | null> {
    if (projectService.getDistributionConfiguration() && uiService) {
        const confirmed = await uiService.dialogs.confirmDestructive(
            translate("project.distribution.replaceConfirm"),
            translate("project.distribution.replaceConfirmDetail"),
            translate("project.distribution.replaceAction"),
        );
        if (!confirmed) {
            return null;
        }
    }
    try {
        return await projectService.rotateDistributionKey();
    } catch (error) {
        uiService?.showNotification(error instanceof Error ? error.message : String(error), "error");
        return null;
    }
}
