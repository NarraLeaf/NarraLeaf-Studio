import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { WindowAppType } from "@shared/types/window";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

/**
 * The renderer's window into the project-trust ledger.
 *
 * Reading is unrestricted: the answer is about a path the caller already named, and a window that
 * can ask "is this trusted" learns nothing it could not learn by watching what Studio refuses.
 *
 * Changing it is not. A grant is the one message that turns a distrusted project into a trusted one,
 * and the workspace window is where that project's content is shown - and, once trusted, where its
 * code runs. A grant accepted from there would let the thing being judged answer the question, so
 * the three handlers that change or enumerate the ledger take orders from the Settings window only:
 * it opens no project, loads nothing a project supplied, and is the page the status bar sends the
 * author to. Any other window is refused and the refusal is logged with the window that asked.
 *
 * **Nothing here enforces anything.** The gates that matter live in main, next to the operations
 * they refuse - a build, a preview, a spawn - because a keybinding, a second window or a stale
 * renderer can all ask regardless of what any renderer believed. What these handlers are for is
 * letting the interface stop offering what would be refused, and letting the author change their
 * mind about a project.
 */

/**
 * The refusal every writer below gives a window that is not Settings, or null for one that is.
 *
 * Logged as a warning rather than silently failed: nothing in Studio's own interface sends one of
 * these from anywhere else, so a refusal here is either a bug or somebody asking on the author's
 * behalf, and both deserve a line in the log that names the window.
 */
function refuseOutsideSettings(window: AppWindow, action: string): Error | null {
    const windowType = window.getWindowType();
    if (windowType === WindowAppType.Settings) {
        return null;
    }
    window.app.logger.warn(`[Trust] Refused to ${action} for a ${windowType} window`);
    return new Error(`Project trust is managed from Settings; a ${windowType} window cannot ${action}.`);
}

export class ProjectTrustQueryHandler extends IPCHandler<IPCEventType.projectTrustQuery> {
    readonly name = IPCEventType.projectTrustQuery;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath }: IPCEvents[IPCEventType.projectTrustQuery]["data"],
    ): Promise<RequestStatus<IPCEvents[IPCEventType.projectTrustQuery]["response"]>> {
        const manager = window.app.projectTrustManager;
        return this.success({
            trusted: manager.isTrusted(projectPath),
            record: manager.getRecord(projectPath) ?? null,
        });
    }
}

export class ProjectTrustGrantHandler extends IPCHandler<IPCEventType.projectTrustGrant> {
    readonly name = IPCEventType.projectTrustGrant;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath }: IPCEvents[IPCEventType.projectTrustGrant]["data"],
    ): Promise<RequestStatus<IPCEvents[IPCEventType.projectTrustGrant]["response"]>> {
        const refused = refuseOutsideSettings(window, "grant trust");
        if (refused) {
            return this.failed(refused);
        }
        const changed = window.app.projectTrustManager.grantTrust(projectPath, new Date().toISOString());
        if (changed) {
            window.app.logger.info("[Trust] Author vouched for", projectPath);
        }
        return this.success({ changed });
    }
}

export class ProjectTrustRevokeHandler extends IPCHandler<IPCEventType.projectTrustRevoke> {
    readonly name = IPCEventType.projectTrustRevoke;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath }: IPCEvents[IPCEventType.projectTrustRevoke]["data"],
    ): Promise<RequestStatus<IPCEvents[IPCEventType.projectTrustRevoke]["response"]>> {
        const refused = refuseOutsideSettings(window, "withdraw trust");
        if (refused) {
            return this.failed(refused);
        }
        const changed = window.app.projectTrustManager.revokeTrust(projectPath);
        if (changed) {
            window.app.logger.info("[Trust] Grant withdrawn for", projectPath);
        }
        return this.success({ changed });
    }
}

export class ProjectTrustListHandler extends IPCHandler<IPCEventType.projectTrustList> {
    readonly name = IPCEventType.projectTrustList;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
    ): Promise<RequestStatus<IPCEvents[IPCEventType.projectTrustList]["response"]>> {
        // The list is every project that ever arrived from outside, by path. Only the settings page
        // shows it, and a workspace has no reason to read other projects' rows.
        const refused = refuseOutsideSettings(window, "list the trust ledger");
        if (refused) {
            return this.failed(refused);
        }
        const manager = window.app.projectTrustManager;
        return this.success({
            trusted: manager.listTrusted(),
            distrusted: manager.listDistrusted(),
        });
    }
}
