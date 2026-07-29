import { IPCMessageType } from "@shared/types/ipc";
import { IPCEvents, IPCEventType, RequestStatus } from "@shared/types/ipcEvents";
import type {
    RevisionId,
    VcsAvailability,
    VcsCommitResult,
    VcsHistoryEntry,
    VcsRepositoryInfo,
    VcsStatus,
    VcsThreeWayResult,
} from "@shared/types/vcs";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

/**
 * Version control IPC.
 *
 * Every handler takes `projectPath` and routes to the per-project session in
 * VcsManager - Studio is one-project-one-window, so a project-less VCS call
 * would be ambiguous with two projects open.
 *
 * The writes here are the ones that only ever produce a revision:
 * {@link VcsInitRepositoryHandler}, {@link VcsCommitHandler} and
 * {@link VcsCheckpointHandler}. None of them can arrive at a conflict - they add to the
 * author's own branch and never move the working tree - so none of them needs a resolve
 * UI to exist first. Merge and restore, which do move it, remain deliberately absent.
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

/**
 * Put a project under version control.
 *
 * Never called on Studio's behalf, only on the author's: it writes `.lore/` into their
 * project directory and takes an exclusive lock on it, and Lore's lock blocks rather
 * than fails, so a repository created without asking would hang their own `lore` CLI
 * with nothing anywhere to explain why.
 */
export class VcsInitRepositoryHandler extends IPCHandler<IPCEventType.vcsInitRepository> {
    readonly name = IPCEventType.vcsInitRepository;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath, options }: IPCEvents[IPCEventType.vcsInitRepository]["data"],
    ): Promise<RequestStatus<VcsRepositoryInfo>> {
        return this.tryUse(() => window.app.getVcsManager().initRepository(projectPath, options ?? {}));
    }
}

/**
 * Record the working tree as a new revision.
 *
 * Long, and the failure has to reach the author: this settles the window's auto-save
 * debt, stages the whole project, commits, and forces Lore's stores to disk before
 * answering, because a commit reported before that flush is one that may not survive
 * the process. "Nothing has changed since the last revision" comes back as a failure
 * too - it is the answer, phrased so the author can read it.
 */
export class VcsCommitHandler extends IPCHandler<IPCEventType.vcsCommit> {
    readonly name = IPCEventType.vcsCommit;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath, options }: IPCEvents[IPCEventType.vcsCommit]["data"],
    ): Promise<RequestStatus<VcsCommitResult>> {
        return this.tryUse(() => window.app.getVcsManager().commit(projectPath, options ?? {}));
    }
}

/**
 * Record a checkpoint, or report that there was nothing to record.
 *
 * `revision: null` covers the three cases an automatic operation must treat as normal -
 * no repository, no backend, nothing changed - and is deliberately a success: the
 * renderer's interval scheduler calls this, and a failure per interval on a project
 * that is not under version control would be noise forever.
 */
export class VcsCheckpointHandler extends IPCHandler<IPCEventType.vcsCheckpoint> {
    readonly name = IPCEventType.vcsCheckpoint;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath, reason }: IPCEvents[IPCEventType.vcsCheckpoint]["data"],
    ): Promise<RequestStatus<{ revision: VcsCommitResult | null }>> {
        return this.tryUse(async () => ({
            revision: await window.app.getVcsManager().checkpoint(projectPath, reason),
        }));
    }
}

/**
 * What changed in the working tree since the last commit.
 *
 * Answering this runs a scan, and a scan is not a pure read: discovering a NEW
 * DIRECTORY records it into the repository's staged state, after which deleting that
 * directory is reported as a deletion for the rest of the session even though it was
 * never committed. So this must only run when someone asks for it - a renderer that
 * polls it on a timer fabricates deletions between two ticks and the author commits
 * the removal of something that never existed.
 */
export class VcsGetStatusHandler extends IPCHandler<IPCEventType.vcsGetStatus> {
    readonly name = IPCEventType.vcsGetStatus;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath }: IPCEvents[IPCEventType.vcsGetStatus]["data"],
    ): Promise<RequestStatus<VcsStatus>> {
        return this.tryUse(() => window.app.getVcsManager().getStatus(projectPath));
    }
}

export class VcsGetHistoryHandler extends IPCHandler<IPCEventType.vcsGetHistory> {
    readonly name = IPCEventType.vcsGetHistory;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath, limit, includeKinds }: IPCEvents[IPCEventType.vcsGetHistory]["data"],
    ): Promise<RequestStatus<{ entries: VcsHistoryEntry[] }>> {
        return this.tryUse(async () => ({
            entries: await window.app.getVcsManager().getHistory(projectPath, limit ?? 0, { includeKinds }),
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
