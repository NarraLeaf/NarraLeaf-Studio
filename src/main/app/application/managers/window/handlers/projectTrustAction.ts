import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

/**
 * The renderer's window into the project-trust ledger.
 *
 * Reading is unrestricted: the answer is about a path the caller already named, and a window that
 * can ask "is this trusted" learns nothing it could not learn by watching what Studio refuses.
 *
 * **Nothing here enforces anything.** The gates that matter live in main, next to the operations
 * they refuse - a build, a preview, a spawn - because a keybinding, a second window or a stale
 * renderer can all ask regardless of what any renderer believed. What these handlers are for is
 * letting the interface stop offering what would be refused, and letting the author change their
 * mind about a project.
 */

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
        const manager = window.app.projectTrustManager;
        return this.success({
            trusted: manager.listTrusted(),
            distrusted: manager.listDistrusted(),
        });
    }
}
