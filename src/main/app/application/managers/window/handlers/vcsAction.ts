import { IPCMessageType } from "@shared/types/ipc";
import { IPCEvents, IPCEventType, RequestStatus } from "@shared/types/ipcEvents";
import type { RevisionId, VcsAvailability, VcsHistoryEntry, VcsRepositoryInfo, VcsThreeWayResult } from "@shared/types/vcs";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

/**
 * Version control IPC.
 *
 * Every handler takes `projectPath` and routes to the per-project session in
 * VcsManager - Studio is one-project-one-window, so a project-less VCS call
 * would be ambiguous with two projects open.
 *
 * These are all reads. Writes (stage/commit/merge) are deliberately absent
 * until the resolve UI exists: a half-wired write surface invites a renderer to
 * commit without a conflict story. See docs/version-control.md.
 */

/**
 * Ask this before anything else. Every other handler here fails on a host with
 * no Lore native build (macOS Intel, Windows ARM64), and this is the supported
 * way to find that out - the UI branches on it instead of probing with errors.
 */
export class VcsGetAvailabilityHandler extends IPCHandler<IPCEventType.vcsGetAvailability> {
    readonly name = IPCEventType.vcsGetAvailability;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow): Promise<RequestStatus<VcsAvailability>> {
        return this.tryUse(() => window.app.getVcsManager().getAvailability());
    }
}

export class VcsIsRepositoryHandler extends IPCHandler<IPCEventType.vcsIsRepository> {
    readonly name = IPCEventType.vcsIsRepository;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath }: IPCEvents[IPCEventType.vcsIsRepository]["data"],
    ): Promise<RequestStatus<{ isRepository: boolean }>> {
        return this.tryUse(async () => ({
            isRepository: await window.app.getVcsManager().isRepository(projectPath),
        }));
    }
}

export class VcsGetInfoHandler extends IPCHandler<IPCEventType.vcsGetInfo> {
    readonly name = IPCEventType.vcsGetInfo;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath }: IPCEvents[IPCEventType.vcsGetInfo]["data"],
    ): Promise<RequestStatus<VcsRepositoryInfo>> {
        return this.tryUse(() => window.app.getVcsManager().getInfo(projectPath));
    }
}

export class VcsGetHistoryHandler extends IPCHandler<IPCEventType.vcsGetHistory> {
    readonly name = IPCEventType.vcsGetHistory;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath, limit }: IPCEvents[IPCEventType.vcsGetHistory]["data"],
    ): Promise<RequestStatus<{ entries: VcsHistoryEntry[] }>> {
        return this.tryUse(async () => ({
            entries: await window.app.getVcsManager().getHistory(projectPath, limit ?? 0),
        }));
    }
}

export class VcsReadBlobHandler extends IPCHandler<IPCEventType.vcsReadBlob> {
    readonly name = IPCEventType.vcsReadBlob;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        request: IPCEvents[IPCEventType.vcsReadBlob]["data"],
    ): Promise<RequestStatus<{ contentBase64: string }>> {
        return this.tryUse(async () => {
            const bytes = await window.app.getVcsManager().readBlob(request);
            return { contentBase64: bytes.toString("base64") };
        });
    }
}

export class VcsGetChangedPathsHandler extends IPCHandler<IPCEventType.vcsGetChangedPaths> {
    readonly name = IPCEventType.vcsGetChangedPaths;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath, from, to }: IPCEvents[IPCEventType.vcsGetChangedPaths]["data"],
    ): Promise<RequestStatus<{ paths: string[] }>> {
        return this.tryUse(async () => ({
            paths: await window.app.getVcsManager().getChangedPaths(projectPath, from, to),
        }));
    }
}

export class VcsGetThreeWayHandler extends IPCHandler<IPCEventType.vcsGetThreeWay> {
    readonly name = IPCEventType.vcsGetThreeWay;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath, mine, theirs, path }: IPCEvents[IPCEventType.vcsGetThreeWay]["data"],
    ): Promise<RequestStatus<VcsThreeWayResult>> {
        return this.tryUse(() => window.app.getVcsManager().getThreeWay(projectPath, mine, theirs, path));
    }
}

export class VcsGetMergeBaseHandler extends IPCHandler<IPCEventType.vcsGetMergeBase> {
    readonly name = IPCEventType.vcsGetMergeBase;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath, a, b }: IPCEvents[IPCEventType.vcsGetMergeBase]["data"],
    ): Promise<RequestStatus<{ base?: RevisionId }>> {
        return this.tryUse(async () => ({
            base: await window.app.getVcsManager().getMergeBase(projectPath, a, b),
        }));
    }
}
