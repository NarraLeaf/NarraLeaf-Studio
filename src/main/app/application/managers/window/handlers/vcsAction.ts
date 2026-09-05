import { IPCMessageType } from "@shared/types/ipc";
import { IPCEvents, IPCEventType, RequestStatus } from "@shared/types/ipcEvents";
import type {
    RevisionId,
    VcsAvailability,
    VcsCommitResult,
    VcsHistoryEntry,
    VcsMergeCompletion,
    VcsMergeDocument,
    VcsMergeResolveResult,
    VcsMergeState,
    VcsPushResult,
    VcsRepositoryInfo,
    VcsRestoreResult,
    VcsRevisionDiffResult,
    VcsAddServerOutcome,
    VcsLocalRepository,
    VcsServerProbe,
    VcsPasswordSignInOutcome,
    VcsPublishOutcome,
    VcsServerSession,
    VcsSignInOutcome,
    VcsSignInProblem,
    VcsStatus,
    VcsSyncResult,
    VcsSyncState,
    VcsThreeWayResult,
    VcsWorkingFileRead,
    VcsWorkingTreeDiffResult,
} from "@shared/types/vcs";
import { readLocalRepository } from "../../vcs/localRepositories";
import { WorkingFileRefusedError } from "../../vcs/workingFile";
import { requireWindowProject } from "../../../utils/windowProject";
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
 * {@link VcsRestoreRevisionHandler} is one exception: it overwrites the author's files. It
 * still needs no resolve UI, for a reason worth stating - it does not MERGE anything. It
 * writes one revision's content over the working tree and records that as a new revision, so
 * there are never two sides to reconcile.
 *
 * The merge handlers at the bottom are the other exception, and they are the first thing here
 * that reckons with two sides at once. All but one of them deliberately do NOT commit: settling a
 * path leaves the merge open, which is what lets an author decide one file and look at the result
 * before deciding the next. {@link VcsCompleteMergeHandler} is the one that closes it, and it does
 * both halves at once precisely so that nothing else can commit in between.
 *
 * # Which project a request may be about
 *
 * The handlers that overwrite the working tree out of history take their project from the window
 * with {@link requireWindowProject}: {@link VcsRestoreRevisionHandler}, {@link VcsSyncHandler}, and
 * the four merge handlers that put bytes on disk - {@link VcsResolveConflictsHandler},
 * {@link VcsCompleteMergeHandler}, {@link VcsRestartConflictsHandler} and
 * {@link VcsAbortMergeHandler}. What they have in common is the reason: each replaces the author's
 * current files with content out of history, and there is no undo for that - the previous bytes
 * were never committed, so nothing holds them. A payload naming another project therefore does not
 * merely act on the wrong project, it destroys work in it.
 *
 * {@link VcsPushHandler} and {@link VcsSignInHandler} take theirs from the window too, on the
 * weaker ground that their only caller is the workspace's own version rail and it has never had
 * another project to name.
 *
 * # The assertion does NOT close the handlers that talk to a server
 *
 * `sync`, `push`, `signIn` and {@link VcsPublishProjectHandler} send a project, or an account's
 * credentials, somewhere else. Which project is one of two things a caller picks there, and the
 * other one - where it goes - is bounded nowhere:
 *
 *  - `remoteOrigin` is a payload field of {@link VcsPublishProjectHandler}, never compared with the
 *    remote the project's own `.lore/config.toml` names. Publishing then REWRITES that file, and
 *    every later push and sync reads the address out of it, so one call moves where a project
 *    reports to from then on.
 *  - A session and its token are held per server origin and belong to the account, not to a
 *    project. Any project pointed at the same origin borrows them, and `withServerSession` replays
 *    the stored token, so a push succeeds against a server nobody signed in to from this window.
 *  - {@link VcsSignInHandler}'s `authUrl` is a payload field that OVERRIDES the address the token
 *    itself carries, and the token is presented to whatever host it names. Which project the path
 *    resolves to has no bearing on that.
 *  - None of the four is in `DISTRUSTED_OPERATIONS`, and none consults the window's file-system
 *    grant.
 *
 * So this family is not closed and nothing here should be read as saying it is. Closing it needs a
 * decision about what a server session is scoped to, which is a larger question than any handler.
 *
 * Two groups are deliberately still open, and they are different problems rather than one backlog:
 *
 *  - The reads, and the handlers that only add a revision. Naming another project there is still
 *    wrong, but it discloses or adds rather than destroys.
 *  - {@link VcsInitRepositoryHandler} and {@link VcsPublishProjectHandler}, which must never be
 *    guarded this way at all: the project wizard legitimately names a directory that is no window's
 *    project, and the launcher's server tab publishes a project the wizard has just made for it,
 *    from a window with no project of its own. Both want a gate on where the request may reach,
 *    which is not the question this one answers.
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
        // The window's project, not the payload's. This is the sharpest of the writers: a whole
        // versioned tree is rewritten from a revision the caller picks, and the checkpoint taken
        // first only protects what was committed - anything the author had not committed in the
        // named project is gone, in a window that never showed them any of it happening.
        return this.tryUse(() => window.app.getVcsManager()
            .restoreRevision(requireWindowProject(window, projectPath), revision, options ?? {}));
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

/**
 * The working tree's side of a comparison.
 *
 * Two shapes of answer, and the split is the contract rather than convenience. A file that is too
 * large to draw comes back as `refusal`, because a project holding one is ordinary and the surface
 * has a sentence for it. A path that escapes the project or sits outside version control comes
 * back as a FAILURE, because no comparison can name one - asking for it means a caller built a
 * path it should not have, and turning that into a tidy "not shown" would hide it forever.
 *
 * The project is the window's, not the payload's, and that is what keeps the reader narrow. The
 * guards in `workingFile.ts` all judge the *relative* half - no `..`, nothing absolute, nothing
 * outside version control, nothing over the ceiling - and they are all relative to a root the
 * caller used to supply. A renderer naming any root therefore had a general file reader: no
 * session was opened, the root was never required to be a repository, and the window's own
 * filesystem grant was never consulted. Bounding the root to this window's project turns it back
 * into what it is documented as - one file of this project's working tree.
 */
export class VcsReadWorkingFileHandler extends IPCHandler<IPCEventType.vcsReadWorkingFile> {
    readonly name = IPCEventType.vcsReadWorkingFile;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        request: IPCEvents[IPCEventType.vcsReadWorkingFile]["data"],
    ): Promise<RequestStatus<VcsWorkingFileRead>> {
        return this.tryUse(async () => {
            try {
                const bytes = await window.app.getVcsManager().readWorkingFile({
                    ...request,
                    projectPath: requireWindowProject(window, request.projectPath),
                });
                return { contentBase64: bytes.toString("base64") };
            } catch (error) {
                if (error instanceof WorkingFileRefusedError && error.refusal === "tooLarge") {
                    return { contentBase64: null, refusal: "tooLarge" as const };
                }
                throw error;
            }
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

/**
 * What changed between two revisions, document by document.
 *
 * The expensive half of this is bounded rather than paged: at most 200 changes per document,
 * documents over 8MiB reported by size alone, and past 2000 changed paths nothing is read at all.
 * Every one of those shows up in the answer as `complete: false`, which a caller must draw - a
 * truncated list presented as a whole one is worse than no list, because the author acts on it.
 *
 * Answered from a per-session cache when the same pair has been asked before. Sound only because
 * revisions are immutable; the working-tree comparison below shares none of it.
 */
export class VcsDiffRevisionsHandler extends IPCHandler<IPCEventType.vcsDiffRevisions> {
    readonly name = IPCEventType.vcsDiffRevisions;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath, from, to }: IPCEvents[IPCEventType.vcsDiffRevisions]["data"],
    ): Promise<RequestStatus<VcsRevisionDiffResult>> {
        return this.tryUse(() => window.app.getVcsManager().diffRevisions(projectPath, from, to));
    }
}

/**
 * What the author has changed since the last version.
 *
 * Two properties the caller has to respect, both of them the same rule from opposite sides:
 * **nothing caches this** - the working tree is different by the time the answer arrives - and
 * **nothing may poll it**, because the status read underneath scans, and a scan that discovers a
 * new directory records it into staged state, after which removing that directory reads as a
 * deletion for the rest of the session (docs §4.17).
 */
export class VcsDiffWorkingTreeHandler extends IPCHandler<IPCEventType.vcsDiffWorkingTree> {
    readonly name = IPCEventType.vcsDiffWorkingTree;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath }: IPCEvents[IPCEventType.vcsDiffWorkingTree]["data"],
    ): Promise<RequestStatus<VcsWorkingTreeDiffResult>> {
        return this.tryUse(() => window.app.getVcsManager().diffWorkingTree(projectPath));
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
 * Who this installation is signed in to this project's server as.
 *
 * A LOCAL read, and one that asks two stores rather than one: Studio's record of the
 * account, and the backend's own store of the token behind it. A record with nothing
 * behind it answers null, because "signed in as Ada" over a connection that will be
 * refused is worse than saying nobody is.
 */
export class VcsGetServerSessionHandler extends IPCHandler<IPCEventType.vcsGetServerSession> {
    readonly name = IPCEventType.vcsGetServerSession;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath }: IPCEvents[IPCEventType.vcsGetServerSession]["data"],
    ): Promise<RequestStatus<{ session: VcsServerSession | null }>> {
        return this.tryUse(async () => ({
            session: await window.app.getVcsManager().getServerSession(projectPath),
        }));
    }
}

/**
 * Present a token to this project's server.
 *
 * **The token crosses this boundary once, inbound.** It is handed to the backend's own
 * per-user store and is not written to Studio's state, not logged and not returned - so
 * nothing that reads a log or an exported profile later has it.
 *
 * Failures carry a coded problem alongside the message: the backend answers an untrusted
 * certificate, a silent port, an unresolvable name and an endpoint speaking plain HTTP
 * with one identical sentence, and the interface has to tell an author which of those
 * four they are looking at.
 *
 * The project is the window's rather than the payload's, and that bounds one small thing: whose
 * `.lore/config.toml` is read for the server to sign in to. It does not bound where the token is
 * sent - `authUrl` overrides the address the token itself names - nor whose session is written,
 * because a session belongs to the account and to a server origin rather than to a project. See
 * the note at the top of this file before reading the assertion as a closed door.
 */
export class VcsSignInHandler extends IPCHandler<IPCEventType.vcsSignIn> {
    readonly name = IPCEventType.vcsSignIn;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath, authUrl, token }: IPCEvents[IPCEventType.vcsSignIn]["data"],
    ): Promise<RequestStatus<VcsSignInOutcome>> {
        return this.tryUse(async () => {
            // Outside the try, so that a refusal stays a failed call. Inside it, a mismatch would
            // be one more thing the catch below has to tell from a transport problem, and the
            // panel would be asked to draw a sentence for something no author can act on.
            const own = requireWindowProject(window, projectPath);
            try {
                const result = await window.app.getVcsManager().signIn(own, { authUrl, token });
                return { ok: true as const, ...result };
            } catch (error) {
                // A refused sign-in travels as a successful call carrying a refusal, not as a
                // failed one: the message is thrown away by the layers between here and the
                // panel, and the CODE is the only thing that lets the panel say which of four
                // identical-looking transport failures this was.
                const problem = (error as { problem?: unknown }).problem;
                if (!problem) throw error;
                return { ok: false as const, problem: problem as VcsSignInProblem };
            }
        });
    }
}

/**
 * Put a server's certificate authority into this account's trust store.
 *
 * The only handler here that changes anything outside a project, and the manager checks
 * the path against Studio's own directory before running anything - see
 * `VcsManager.trustAuthority`. A refusal by the operating system comes back as
 * `installed: false` with whatever it printed, because those refusals say something
 * specific and a bare failure would leave the author with "it did not work".
 */
export class VcsTrustAuthorityHandler extends IPCHandler<IPCEventType.vcsTrustAuthority> {
    readonly name = IPCEventType.vcsTrustAuthority;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { certificatePath }: IPCEvents[IPCEventType.vcsTrustAuthority]["data"],
    ): Promise<RequestStatus<{ installed: boolean; output: string }>> {
        return this.tryUse(() => window.app.getVcsManager().trustAuthority(certificatePath));
    }
}

/** Clear the stored token and Studio's record of whose it was. Local; contacts nothing. */
export class VcsSignOutHandler extends IPCHandler<IPCEventType.vcsSignOut> {
    readonly name = IPCEventType.vcsSignOut;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath }: IPCEvents[IPCEventType.vcsSignOut]["data"],
    ): Promise<RequestStatus<{ session: null }>> {
        return this.tryUse(async () => {
            await window.app.getVcsManager().signOut(projectPath);
            return { session: null };
        });
    }
}

/**
 * Ask an address what is behind it, before anything has been added.
 *
 * Goes to the network, and is where adding a server starts: an author is given one address
 * and everything else is read off the server. Takes no project, and nothing is stored - what
 * comes back is what they are then shown and, in one of the four cases, asked about.
 *
 * A server that cannot be reached is a successful call carrying that, not a failed one. All
 * four answers are things the wizard draws, and a rejection would leave it with a sentence
 * where it needs to know which of the four it is looking at.
 */
export class VcsProbeServerHandler extends IPCHandler<IPCEventType.vcsProbeServer> {
    readonly name = IPCEventType.vcsProbeServer;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { address }: IPCEvents[IPCEventType.vcsProbeServer]["data"],
    ): Promise<RequestStatus<VcsServerProbe>> {
        return this.tryUse(() => window.app.getVcsManager().probeServer(address));
    }
}

/**
 * Every server this installation is signed in to.
 *
 * Takes no project, which is the point: Settings manages servers with nothing open, and
 * a session was never a property of a repository in the first place.
 */
export class VcsListServersHandler extends IPCHandler<IPCEventType.vcsListServers> {
    readonly name = IPCEventType.vcsListServers;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow): Promise<RequestStatus<{ servers: VcsServerSession[] }>> {
        return this.tryUse(async () => ({ servers: window.app.getVcsManager().listServers() }));
    }
}

/**
 * Exchange a username and a password for a token.
 *
 * The only call in this file that names an address instead of a `remoteOrigin`, because
 * it is made before this installation has a record of that server - obtaining the token
 * is what creates one. Everything after it is the sign-in that already existed.
 *
 * **The password crosses this boundary once and is kept by nothing on either side of it.**
 */
export class VcsSignInWithPasswordHandler extends IPCHandler<IPCEventType.vcsSignInWithPassword> {
    readonly name = IPCEventType.vcsSignInWithPassword;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { authUrl, username, password }: IPCEvents[IPCEventType.vcsSignInWithPassword]["data"],
    ): Promise<RequestStatus<VcsPasswordSignInOutcome>> {
        return this.tryUse(async () =>
            window.app.getVcsManager().signInWithPassword(authUrl, username, password));
    }
}

/**
 * Which repositories this machine already holds.
 *
 * Takes no project, like listing the servers does not: the question is asked of the whole
 * installation, once, so that a list of a server's projects can say which of them are
 * already here.
 *
 * **Two plain file reads per project and nothing else.** Lore's repository lock is
 * exclusive and blocking - opening a store another process holds never returns, and
 * every later call on that project queues behind it - so a sweep like this one is
 * precisely the call that must not open anything. It is also why this does not go
 * through `VcsManager`: there is no session to want, and a host with no Lore build can
 * still answer it.
 */
export class VcsListLocalRepositoriesHandler extends IPCHandler<IPCEventType.vcsListLocalRepositories> {
    readonly name = IPCEventType.vcsListLocalRepositories;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow): Promise<RequestStatus<{ repositories: VcsLocalRepository[] }>> {
        return this.tryUse(async () => ({
            repositories: window.app.globalState.recentlyOpened.list().map(readLocalRepository),
        }));
    }
}

/**
 * Put a project on to a server, in the three steps that make it reachable.
 *
 * **Deliberately not bounded to the window's project**, unlike the three handlers next to it.
 * Making a project on a server starts in the launcher: its server tab has the wizard write the
 * project on this disk and then sends it, from a window that has no project of its own. An
 * assertion here would refuse that, which is the whole of one of the two ways a project reaches a
 * server.
 *
 * So this is left open knowingly, and it is the widest of the four: as well as naming the project,
 * a caller names `remoteOrigin` freely, and step three rewrites that project's own
 * `.lore/config.toml` to point at it. What it wants is a gate on the destination and on which
 * account credential may be spent, not on which project - see the note at the top of this file.
 */
export class VcsPublishProjectHandler extends IPCHandler<IPCEventType.vcsPublishProject> {
    readonly name = IPCEventType.vcsPublishProject;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath, remoteOrigin, name }: IPCEvents[IPCEventType.vcsPublishProject]["data"],
    ): Promise<RequestStatus<VcsPublishOutcome>> {
        return this.tryUse(() =>
            window.app.getVcsManager().publishProject(projectPath, remoteOrigin, name));
    }
}

/** Sign in to the server a token names. */
export class VcsAddServerHandler extends IPCHandler<IPCEventType.vcsAddServer> {
    readonly name = IPCEventType.vcsAddServer;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { authUrl, remoteUrl, token, description }: IPCEvents[IPCEventType.vcsAddServer]["data"],
    ): Promise<RequestStatus<VcsAddServerOutcome>> {
        return this.tryUse(async () => {
            try {
                const result = await window.app.getVcsManager()
                    .addServer({ authUrl, remoteUrl, token, ...(description ? { description } : {}) });
                return { ok: true as const, ...result };
            } catch (error) {
                // Same bargain as signing in from a project: a refusal is an answer the
                // panel puts a sentence to, and only the code survives the trip.
                const problem = (error as { problem?: unknown }).problem;
                if (!problem) throw error;
                return { ok: false as const, problem: problem as VcsSignInProblem };
            }
        });
    }
}

/**
 * Ask one server what it is now, and record the answer.
 *
 * Goes to the network, and is the only call that changes a stored session without a token
 * in hand: what it writes is the server's own account of itself, never the account or the
 * addresses. A server that does not answer leaves its record as it was, so this is safe to
 * offer against a machine that may be off.
 */
export class VcsRefreshServerHandler extends IPCHandler<IPCEventType.vcsRefreshServer> {
    readonly name = IPCEventType.vcsRefreshServer;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { remoteOrigin }: IPCEvents[IPCEventType.vcsRefreshServer]["data"],
    ): Promise<RequestStatus<{ servers: VcsServerSession[] }>> {
        return this.tryUse(async () => ({
            servers: await window.app.getVcsManager().refreshServer(remoteOrigin),
        }));
    }
}

/** Take a server off this machine. */
export class VcsForgetServerHandler extends IPCHandler<IPCEventType.vcsForgetServer> {
    readonly name = IPCEventType.vcsForgetServer;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { remoteOrigin }: IPCEvents[IPCEventType.vcsForgetServer]["data"],
    ): Promise<RequestStatus<{ servers: VcsServerSession[] }>> {
        return this.tryUse(async () => {
            // The session goes first, and here rather than inside the manager: a client
            // holding a token that has just been deleted would go on reconnecting with
            // it until something else closed it. Ending it before the record goes means
            // there is never a moment where Studio is signed in to a server it has
            // forgotten.
            window.app.getTeamManager().forget(remoteOrigin);
            return { servers: await window.app.getVcsManager().forgetServer(remoteOrigin) };
        });
    }
}

/**
 * Send this branch's revisions to the server.
 *
 * Writes nothing locally, so a failure leaves the project untouched. A diverged branch
 * comes back as a failure carrying the backend's own sentence - which names the remedy
 * (sync first) and is more useful than anything this layer could substitute.
 *
 * The project is the window's rather than the payload's, which bounds whose revisions are
 * uploaded and nothing else. Where they go is read off that project's own `.lore/config.toml`,
 * and the credential used is the account's for that origin - see the note at the top of this file.
 */
export class VcsPushHandler extends IPCHandler<IPCEventType.vcsPush> {
    readonly name = IPCEventType.vcsPush;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath }: IPCEvents[IPCEventType.vcsPush]["data"],
    ): Promise<RequestStatus<VcsPushResult>> {
        return this.tryUse(() =>
            window.app.getVcsManager().push(requireWindowProject(window, projectPath)));
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
 *
 * The project is the window's rather than the payload's, and it belongs with the restore and the
 * merge writers for their reason: files on disk are replaced with content out of history and
 * nothing holds what was there. It reaches further than they do first, because the flush of
 * pending saves that opens it settles the auto-save debt of whatever window has that project open.
 *
 * That bounds which project is written. It does not bound which server the revisions come FROM -
 * that address is read off the project's `.lore/config.toml`, which publishing rewrites. See the
 * note at the top of this file.
 */
export class VcsSyncHandler extends IPCHandler<IPCEventType.vcsSync> {
    readonly name = IPCEventType.vcsSync;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath }: IPCEvents[IPCEventType.vcsSync]["data"],
    ): Promise<RequestStatus<VcsSyncResult>> {
        return this.tryUse(() =>
            window.app.getVcsManager().sync(requireWindowProject(window, projectPath)));
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

/**
 * Whether this project is in the middle of a merge, and which paths are still open.
 *
 * **Ask it on opening a project, not only after a sync.** The merge lives in the
 * repository rather than in Studio, so a window closed on a conflicted sync reopens onto
 * the same unfinished merge with nothing in memory to say so. The answer is rebuilt from
 * the repository and from what the merge left on disk; the paths cannot come from a
 * status read, which reports an empty file list for the whole of a merge (docs §4.24).
 *
 * Cheap and local: one non-scanning status call plus a walk of the versioned working set.
 */
export class VcsGetMergeStateHandler extends IPCHandler<IPCEventType.vcsGetMergeState> {
    readonly name = IPCEventType.vcsGetMergeState;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath }: IPCEvents[IPCEventType.vcsGetMergeState]["data"],
    ): Promise<RequestStatus<VcsMergeState>> {
        return this.tryUse(() => window.app.getVcsManager().getMergeState(projectPath));
    }
}

/**
 * The three-way merge of one conflicted document, change by change - tier two.
 *
 * **Only some documents have one, and which ones is an answer rather than a silence.** A path
 * whose format has no spec, whose spec has no `merge3`, whose spec cannot write itself back, or
 * whose sides are too large or unreadable comes back with `blocked` set and stays at tier one in
 * the same list. Hiding it would present "Studio cannot do this here" and "there is nothing left
 * to decide here" as the same empty row.
 *
 * Records nothing and remembers nothing, like every other read in a merge: the decisions the
 * author takes on this live in the window that asked (docs §4.24).
 */
export class VcsGetMergeDocumentHandler extends IPCHandler<IPCEventType.vcsGetMergeDocument> {
    readonly name = IPCEventType.vcsGetMergeDocument;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath, path }: IPCEvents[IPCEventType.vcsGetMergeDocument]["data"],
    ): Promise<RequestStatus<VcsMergeDocument>> {
        return this.tryUse(() => window.app.getVcsManager().getMergeDocument(projectPath, path));
    }
}

/**
 * Settle conflicted paths by taking one side, or by taking the working tree as it stands.
 *
 * **This records nothing.** Settling is not committing: the merge stays open until a
 * commit closes it, which is what lets an author decide one file, look at the result and
 * then decide the next. The caller commits through `vcs.commit` when they are done.
 *
 * `mine` and `theirs` OVERWRITE the working tree for those paths, so the caller must
 * re-read every document it named - an editor still holding the pre-merge bytes will
 * write them back over the side the author just chose. `working-tree` changes no bytes
 * and accepts whatever is on disk, which is how an answer neither side wrote is settled.
 */
export class VcsResolveConflictsHandler extends IPCHandler<IPCEventType.vcsResolveConflicts> {
    readonly name = IPCEventType.vcsResolveConflicts;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath, paths, choice }: IPCEvents[IPCEventType.vcsResolveConflicts]["data"],
    ): Promise<RequestStatus<VcsMergeResolveResult>> {
        // The window's project, not the payload's: `mine` and `theirs` overwrite the named paths.
        return this.tryUse(() => window.app.getVcsManager()
            .resolveConflicts(requireWindowProject(window, projectPath), paths, choice));
    }
}

/**
 * Take one side per path and close the merge with a commit.
 *
 * The one merge handler that DOES record, and it is deliberately the only way to do both halves:
 * a renderer that settled and then committed through {@link VcsCommitHandler} would leave a window
 * in which the checkpoint timer closes the author's merge under its own message and kind. Here they
 * are one queued act.
 *
 * It writes the author's files - each side overwrites its path - and then adds a revision, so the
 * caller carries a restore's obligations: hold the workspace in its view, release before leaving
 * it, and re-read every document afterwards.
 *
 * A path the merge has not settled and the author did not decide comes back as a failure carrying
 * the backend's own sentence, which names that path.
 */
export class VcsCompleteMergeHandler extends IPCHandler<IPCEventType.vcsCompleteMerge> {
    readonly name = IPCEventType.vcsCompleteMerge;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath, decisions, options }: IPCEvents[IPCEventType.vcsCompleteMerge]["data"],
    ): Promise<RequestStatus<VcsMergeCompletion>> {
        // The window's project, not the payload's: this writes each decided side over its path and
        // then commits, so a request about another project both changes it and records the change.
        return this.tryUse(() => window.app.getVcsManager()
            .completeMerge(requireWindowProject(window, projectPath), decisions, options ?? {}));
    }
}

/** Undo a choice: these paths go back to unsettled, with all three sides still on disk. */
export class VcsUnresolveConflictsHandler extends IPCHandler<IPCEventType.vcsUnresolveConflicts> {
    readonly name = IPCEventType.vcsUnresolveConflicts;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath, paths }: IPCEvents[IPCEventType.vcsUnresolveConflicts]["data"],
    ): Promise<RequestStatus<VcsMergeResolveResult>> {
        return this.tryUse(() => window.app.getVcsManager().unresolveConflicts(projectPath, paths));
    }
}

/**
 * Merge these paths again from scratch, DISCARDING what is in the working tree for them.
 *
 * The difference from unresolving: that takes a decision back, this throws the bytes away
 * too. The way out of a merge result the author edited into something they no longer want.
 */
export class VcsRestartConflictsHandler extends IPCHandler<IPCEventType.vcsRestartConflicts> {
    readonly name = IPCEventType.vcsRestartConflicts;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath, paths }: IPCEvents[IPCEventType.vcsRestartConflicts]["data"],
    ): Promise<RequestStatus<VcsMergeState>> {
        // The window's project, not the payload's. This is the one that throws bytes away on
        // purpose, which is exactly why it may not be aimed at a project nobody is looking at.
        return this.tryUse(() => window.app.getVcsManager()
            .restartConflicts(requireWindowProject(window, projectPath), paths));
    }
}

/**
 * Abandon the merge and put the working tree back to before it started.
 *
 * A COMPLETE rollback, and that is measured rather than hoped for (docs §4.27): every
 * file back to its pre-merge content, the merge's own leftovers deleted, the repository
 * where it was. It writes the author's files, so the caller must re-read every document
 * once it resolves.
 */
export class VcsAbortMergeHandler extends IPCHandler<IPCEventType.vcsAbortMerge> {
    readonly name = IPCEventType.vcsAbortMerge;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath }: IPCEvents[IPCEventType.vcsAbortMerge]["data"],
    ): Promise<RequestStatus<VcsMergeState>> {
        // The window's project, not the payload's: a complete rollback of every file the merge
        // touched, in whichever project is named.
        return this.tryUse(() => window.app.getVcsManager()
            .abortMerge(requireWindowProject(window, projectPath)));
    }
}
