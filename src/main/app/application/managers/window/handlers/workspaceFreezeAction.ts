import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { forgetWorkspaceFreeze, reportWorkspaceFreeze } from "../../../utils/workspaceFreeze";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

/**
 * Windows whose close is already wired to forget their project's freeze.
 *
 * Weak, and outside the handler, because handlers are stateless singletons routed by sender. Without
 * the dedupe every freeze/thaw would add another listener to the same window's emitter, and eleven
 * toggles would earn a MaxListenersExceededWarning for eleven copies of one idempotent delete.
 */
const closeWatched = new WeakSet<AppWindow>();

/**
 * The workspace reporting whether its project data is frozen. See
 * `application/utils/workspaceFreeze` for why main keeps this at all.
 *
 * The project comes from the window's own props rather than the payload: Studio is one project per
 * window, so the window is the authority on which project this is, and a stale or malformed report
 * then cannot freeze the project in the window next to it.
 */
export class WorkspaceReportWriteFreezeHandler extends IPCHandler<IPCEventType.workspaceReportWriteFreeze> {
    readonly name = IPCEventType.workspaceReportWriteFreeze;
    readonly type = IPCMessageType.message;

    public handle(
        window: AppWindow,
        { reason, revision }: IPCEvents[IPCEventType.workspaceReportWriteFreeze]["data"],
    ): RequestStatus<never> {
        const projectPath = window.getProps()?.projectPath;
        if (typeof projectPath !== "string" || projectPath.length === 0) {
            // Only a workspace window has a project; anything else has nothing to record.
            return this.success(void 0 as never);
        }
        reportWorkspaceFreeze(projectPath, reason, revision);
        this.forgetWhenClosed(window, projectPath);
        return this.success(void 0 as never);
    }

    /**
     * Drop the record once the window is actually gone, or a project reopened later would inherit a
     * freeze nobody can see or clear.
     *
     * `"closed"` rather than `AppWindow.onClose`: `onClose` fires on the close *request*, which a
     * workspace's close guard routinely cancels (the confirmation sheet, a launcher that failed to
     * come back). Forgetting there would leave main believing a still-frozen workspace was writable
     * - the exact failure this whole record exists to close.
     */
    private forgetWhenClosed(window: AppWindow, projectPath: string): void {
        if (closeWatched.has(window)) {
            return;
        }
        closeWatched.add(window);
        window.onEvent("closed", () => {
            forgetWorkspaceFreeze(projectPath);
        });
    }
}
