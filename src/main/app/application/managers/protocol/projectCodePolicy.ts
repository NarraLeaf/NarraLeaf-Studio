import type { BaseApp } from "../../baseApp";
import { windowProjectPath } from "../../utils/windowProject";
import type { ProjectCodePolicy } from "./executableContent";

/**
 * The project-trust answer for a grant's window.
 *
 * The one place the protocol layer meets the ledger. A grant remembers the webContents it was minted
 * for; that window has a project, or none; the ledger says whether that project may cause effects.
 * Each step that fails answers no - a window that is gone, or one that has no project - so a mistake
 * anywhere along the chain refuses code rather than admits it. A window with no project never
 * legitimately fetches code through a file grant: the launcher, the settings and the wizard declare
 * no file system access at all, and Studio's own bundles and plugin entries reach every window
 * through hosts of their own rather than through `app://fs/`.
 */
export function createProjectCodePolicy(
    app: Pick<BaseApp, "windowManager" | "projectTrustManager">,
): ProjectCodePolicy {
    return {
        mayRunProjectCode(ownerWebContentsId) {
            if (ownerWebContentsId === undefined) {
                return false;
            }
            const window = app.windowManager.getWindowByWebContentsId(ownerWebContentsId);
            if (!window) {
                return false;
            }
            const projectPath = windowProjectPath(window);
            return projectPath !== null && app.projectTrustManager.isTrusted(projectPath);
        },
    };
}
