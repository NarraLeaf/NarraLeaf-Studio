import { useCallback } from "react";
import { getInterface } from "@/lib/app/bridge";
import { useTranslation } from "@/lib/i18n";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import { Services } from "@/lib/workspace/services/services";
import { asProjectOpenRefusal, projectOpenRefusalDetailKey } from "@shared/utils/projectOpenRefusal";
import { useWorkspace } from "../context";

// The list itself is shared with the launcher - same history, same live subscription.
export { useRecentProjectIcons, useRecentProjects, useRemoveRecentProject } from "@/lib/app/hooks/useRecentProjects";

type OpenRecentOptions = {
    /** Close the current window once the target opens - a "switch in this window". */
    replaceCurrentWindow?: boolean;
};

/**
 * Say why main refused to open a project from this workspace, if that is what the failure was.
 *
 * A remembered project the launcher would stop at its gate - a folder that is gone, or a team
 * project this machine has signed out of - is refused from a workspace (`requireOpenableFromWorkspace`
 * in main), because the choices the launcher offers for it are not on offer here. The notice names
 * the reason and sends the author to the launcher. Answers whether the failure was one of those.
 */
export function useNotifyProjectOpenRefusal(): (code: unknown) => boolean {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    return useCallback((code: unknown) => {
        const refusal = asProjectOpenRefusal(code);
        if (refusal === null) return false;
        context?.services.get<UIService>(Services.UI).notifications.warning(
            t("workspace.shell.projectSwitcher.unavailable.refused"),
            t(projectOpenRefusalDetailKey(refusal)),
        );
        return true;
    }, [context, t]);
}

/**
 * Open a project from the recent list. Focuses an already-open window instead of duplicating it
 * (see the main-process `App.openProject`), so one project stays one window however it was
 * reached. Rejections are swallowed after logging - a failed open should never take down the
 * surface that triggered it - except a refusal, which is said (see {@link useNotifyProjectOpenRefusal}).
 *
 * Left off - what the title-bar switcher and the launcher both want - the calling window stays and
 * the project opens in one of its own.
 *
 * `replaceCurrentWindow` makes it a switch instead: the calling window is retired once the target
 * project is on screen (flushed and check-pointed first, and never if the project failed to load).
 * Only File ▸ Open Recent asks for that now.
 */
export function useOpenRecentProject(): (projectPath: string, options?: OpenRecentOptions) => Promise<void> {
    const notifyRefusal = useNotifyProjectOpenRefusal();
    return useCallback(async (projectPath: string, options?: OpenRecentOptions) => {
        try {
            const result = await getInterface().workspace.openRecent(projectPath, options?.replaceCurrentWindow);
            if (!result.success && !notifyRefusal(result.code)) {
                console.error("[recent] Failed to open recent project:", result.error);
            }
        } catch (error) {
            console.error("[recent] Failed to open recent project:", error);
        }
    }, [notifyRefusal]);
}
