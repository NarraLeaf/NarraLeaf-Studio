import { IPCMessageType } from "@shared/types/ipc";
import { IPCEvents, IPCEventType, RequestStatus } from "@shared/types/ipcEvents";
import type {
    RevisionId,
    VcsAvailability,
    VcsCommitResult,
    VcsHistoryEntry,
    VcsPushResult,
    VcsRepositoryInfo,
    VcsRestoreResult,
    VcsStatus,
    VcsSyncResult,
    VcsSyncState,
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
 * Most of the writes here only ever produce a revision: {@link VcsInitRepositoryHandler},
 * {@link VcsCommitHandler} and {@link VcsCheckpointHandler}. None of them can arrive at a
 * conflict - they add to the author's own branch and never move the working tree - so none of
 * them needed a resolve UI to exist first.
 *
 * {@link VcsRestoreRevisionHandler} is the exception and the only one in this file that
 * overwrites the author's files. It still needs no resolve UI, for a reason worth stating: it
 * does not MERGE anything. It writes one revision's content over the working tree and records
 * that as a new revision, so there are never two sides to reconcile. Merge, which does have
 * two, remains deliberately absent.
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
 * the process. "Nothing has changed since the last version" comes back as a failure
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
 * Put the working tree back to one revision, and record that as a new revision.
 *
 * The one handler here that writes over the author's files, so what it promises is worth
 * restating at the boundary: a checkpoint is committed before a single byte is written and a
 * failure to take one aborts the whole operation, and no revision between the target and the
 * head is touched - `#12` restored onto a project at `#61` produces `#62`.
 *
 * Slow: two commit pipelines plus a full rewrite of the versioned tree. The renderer must leave
 * the revision view and re-read every document once this resolves, because the bytes under its
 * editors are no longer the ones it read.
 *
 * A failure answer therefore means the working tree was NOT touched - every step that can fail runs
 * before the first byte is written. The one exception is the closing commit, which cannot be
 * reported that way once the files have changed, so it comes back as a SUCCESS carrying
 * `recordFailure`; a caller that only reads `success` would tell the author nothing happened while
 * their project sits on a restored, unrecorded tree.
 */
export class VcsRestoreRevisionHandler extends IPCHandler<IPCEventType.vcsRestoreRevision> {
    readonly name = IPCEventType.vcsRestoreRevision;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath, revision, options }: IPCEvents[IPCEventType.vcsRestoreRevision]["data"],
    ): Promise<RequestStatus<VcsRestoreResult>> {
        return this.tryUse(() => window.app.getVcsManager().restoreRevision(projectPath, revision, options ?? {}));
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
        { projectPath, limit, includeDetails }: IPCEvents[IPCEventType.vcsGetHistory]["data"],
    ): Promise<RequestStatus<{ entries: VcsHistoryEntry[] }>> {
        return this.tryUse(async () => ({
            entries: await window.app.getVcsManager().getHistory(projectPath, limit ?? 0, { includeDetails }),
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

export class VcsReadRevisionDocumentsHandler extends IPCHandler<IPCEventType.vcsReadRevisionDocuments> {
    readonly name = IPCEventType.vcsReadRevisionDocuments;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath, revision, paths }: IPCEvents[IPCEventType.vcsReadRevisionDocuments]["data"],
    ): Promise<RequestStatus<{ documents: { path: string; contentBase64: string | null }[] }>> {
        return this.tryUse(async () => {
            const read = await window.app.getVcsManager().readRevisionDocuments(projectPath, revision, { paths });
            // An array rather than a record: a repository-relative path is arbitrary text
            // and `__proto__` as an object key is not something to find out about later.
            return {
                documents: [...read].map(([path, bytes]) => ({
                    path,
                    contentBase64: bytes === null ? null : bytes.toString("base64"),
                })),
            };
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

/**
 * The configured server, or null.
 *
 * A LOCAL read - it reads the repository's own config and opens no socket - which is
 * what makes it safe for a panel to ask on open. {@link VcsGetSyncStateHandler}, which
 * answers whether that server can be reached, is the one that costs time.
 */
export class VcsGetRemoteHandler extends IPCHandler<IPCEventType.vcsGetRemote> {
    readonly name = IPCEventType.vcsGetRemote;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath }: IPCEvents[IPCEventType.vcsGetRemote]["data"],
    ): Promise<RequestStatus<{ url: string | null }>> {
        return this.tryUse(async () => ({
            url: await window.app.getVcsManager().getRemote(projectPath),
        }));
    }
}

/**
 * Point the project at a server, or disconnect it with `null`.
 *
 * Deliberately does NOT contact the server: configuring and reaching are separate acts,
 * so this works offline and answers instantly. Whether anyone is there is what
 * {@link VcsGetSyncStateHandler} answers.
 */
export class VcsSetRemoteHandler extends IPCHandler<IPCEventType.vcsSetRemote> {
    readonly name = IPCEventType.vcsSetRemote;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath, url }: IPCEvents[IPCEventType.vcsSetRemote]["data"],
    ): Promise<RequestStatus<{ url: string | null }>> {
        return this.tryUse(async () => {
            await window.app.getVcsManager().setRemote(projectPath, url);
            return { url: await window.app.getVcsManager().getRemote(projectPath) };
        });
    }
}

/**
 * Where this branch stands against its server.
 *
 * **The only read on this surface that goes to the network**, and it takes up to ~2s
 * when nothing answers (measured). It must therefore never be called on project open or
 * on a timer - only because the author asked, or right after an operation that changed
 * the answer. An unreachable server is `remoteAvailable: false`, not a failure.
 */
export class VcsGetSyncStateHandler extends IPCHandler<IPCEventType.vcsGetSyncState> {
    readonly name = IPCEventType.vcsGetSyncState;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath }: IPCEvents[IPCEventType.vcsGetSyncState]["data"],
    ): Promise<RequestStatus<VcsSyncState>> {
        return this.tryUse(() => window.app.getVcsManager().getSyncState(projectPath));
    }
}

/**
 * Send this branch's revisions to the server.
 *
 * Writes nothing locally, so a failure leaves the project untouched. A diverged branch
 * comes back as a failure carrying the backend's own sentence - which names the remedy
 * (sync first) and is more useful than anything this layer could substitute.
 */
export class VcsPushHandler extends IPCHandler<IPCEventType.vcsPush> {
    readonly name = IPCEventType.vcsPush;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath }: IPCEvents[IPCEventType.vcsPush]["data"],
    ): Promise<RequestStatus<VcsPushResult>> {
        return this.tryUse(() => window.app.getVcsManager().push(projectPath));
    }
}

/**
 * Bring the server's revisions down into the working tree.
 *
 * **Writes the author's files**, so it carries the same obligation a restore does: the
 * renderer must re-read every document once this resolves, or an editor holding the
 * pre-sync version will write it straight back over what was synced.
 *
 * Refused outright when the working tree is dirty - syncing a diverged branch merges,
 * and a merge must not land on top of uncommitted work. Conflicts come back as a
 * SUCCESS carrying `conflicts`, because by then most of the tree is already written;
 * a caller that read that as a failure would leave the author believing nothing changed.
 */
export class VcsSyncHandler extends IPCHandler<IPCEventType.vcsSync> {
    readonly name = IPCEventType.vcsSync;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath }: IPCEvents[IPCEventType.vcsSync]["data"],
    ): Promise<RequestStatus<VcsSyncResult>> {
        return this.tryUse(() => window.app.getVcsManager().sync(projectPath));
    }
}

/**
 * Copy a repository from a server into a local folder.
 *
 * The one handler here that takes no `projectPath`: there is no project at the
 * destination until it finishes. The folder must be empty, and that is enforced before
 * a byte is fetched - the backend writes into whatever it is pointed at without asking.
 */
export class VcsCloneHandler extends IPCHandler<IPCEventType.vcsClone> {
    readonly name = IPCEventType.vcsClone;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { url, destination }: IPCEvents[IPCEventType.vcsClone]["data"],
    ): Promise<RequestStatus<{ root: string; branch: string; fileCount: number }>> {
        return this.tryUse(() => window.app.getVcsManager().cloneRepository(url, destination));
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
