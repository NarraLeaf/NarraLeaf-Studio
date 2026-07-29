import { getInterface } from "@/lib/app/bridge";
import type {
    RevisionId,
    VcsAvailability,
    VcsFileChange,
    VcsHistoryEntry,
    VcsInitOptions,
    VcsRepositoryInfo,
    VcsStatus,
} from "@shared/types/vcs";
import { Service } from "../Service";
import type { IVersionControlService, WorkspaceContext } from "../services";
import { EventEmitter } from "../ui/EventEmitter";

/**
 * The renderer's side of version control.
 *
 * Everything here goes over IPC to the per-project session in `VcsManager`; the
 * project path is this window's own and is never a parameter, because Studio is
 * one-project-one-window and a caller that could pass a different one could reach a
 * repository this window does not own.
 *
 * **Never put this on a timer.** `refreshStatus` runs a backend scan, and the scan is
 * not a pure read: discovering a NEW DIRECTORY records it into the repository's
 * staged state, so a directory created and removed between two ticks is reported as a
 * deletion for the rest of the session even though it was never committed - and the
 * author, following the list, commits the removal of something that never existed.
 * Measured by controlled comparison and pinned in `repository.integration.test.ts`;
 * written up as docs/version-control.md §4.17. So: no `setInterval`, no polling, no
 * subscription to an event that fires repeatedly. A refresh happens when a person
 * asks for one, or right after an operation this service itself performed. If you are
 * here to add a timer because the panel feels stale, add a refresh button instead.
 *
 * Availability is asked once and cached. Version control is an OPTIONAL capability -
 * Epic ships no native build for macOS Intel or Windows ARM64 - and "unavailable" is
 * a normal answer with a reason, not an error. Every read below answers empty rather
 * than throwing when there is nothing to report, so a UI does not need a try/catch to
 * render an empty panel; the two verbs with no honest empty answer, {@link readBlob}
 * and {@link initRepository}, throw.
 *
 * Shaped for the writes that are still to come (commit, restore, branch, push), but
 * none of them are stubbed here: the manager has no such methods yet, and a method
 * that resolves without doing anything is worse than one that does not exist.
 */

type VersionControlServiceEvents = {
    /** Null once the cached snapshot is dropped, e.g. on teardown or after init. */
    statusChanged: VcsStatus | null;
};

export class VersionControlService extends Service<VersionControlService> implements IVersionControlService {
    /**
     * One probe per session, shared by every concurrent caller. Cached because the
     * probe loads a ~29MB native library, not because a second answer would differ.
     */
    private availability: Promise<VcsAvailability> | null = null;
    /**
     * The last scan's result. Deliberately the only cached state that a caller can
     * read without asking for work: it is a SNAPSHOT, and it goes stale the moment
     * the author touches a file. See the class comment for why refreshing it behind
     * their back is not an option.
     */
    private status: VcsStatus | null = null;
    /**
     * History by limit. Safe to cache - revisions are immutable and nothing in this
     * process creates one yet. The first read of a project with a remote may go to
     * the network (docs §6), which is the other reason not to repeat it.
     */
    private readonly history = new Map<number, Promise<VcsHistoryEntry[]>>();
    private readonly events = new EventEmitter<VersionControlServiceEvents>();

    protected async init(_ctx: WorkspaceContext): Promise<void> {
        return;
    }

    /**
     * Nothing eager, on purpose. Probing availability dlopens the native library and
     * a status scan takes Lore's exclusive repository lock - which BLOCKS the author's
     * own `lore` CLI rather than failing it. Both wait for someone to open the UI.
     */
    public override activate(_ctx: WorkspaceContext): void {
        return;
    }

    public override dispose(_ctx: WorkspaceContext): void {
        this.availability = null;
        this.status = null;
        this.history.clear();
        this.events.clear();
    }

    /**
     * Whether this host can do version control at all, and why not if it cannot.
     *
     * Ask this before showing any version control affordance. It is the supported way
     * to find out - probing with another call and catching the error cannot tell
     * "this machine has no backend" apart from "this directory is not a repository",
     * and those need opposite things said to the author.
     */
    public async getAvailability(): Promise<VcsAvailability> {
        if (!this.availability) {
            const pending: Promise<VcsAvailability> = getInterface().vcs.getAvailability().then(
                (result) => {
                    if (result.success) return result.data;
                    // The host could not even answer. That is still an answer about this
                    // installation rather than an exception to propagate, and it is the
                    // same thing a corrupt native library looks like from here.
                    return { available: false, reason: "backend-load-failed", detail: result.error };
                },
                (error: unknown) => {
                    // The CHANNEL failed, not the backend - `ipcRenderer.invoke` rejects
                    // when no handler is registered or the window is tearing down. Still
                    // answered rather than thrown, because every read below promises to
                    // degrade rather than throw and they all wait on this one.
                    //
                    // And not cached: a rejected promise kept here would make all of them
                    // throw for the rest of the session, turning a momentary channel
                    // problem into a permanently broken feature. A backend that will not
                    // load stays not-loaded; a channel can be fine a second later.
                    if (this.availability === pending) this.availability = null;
                    return {
                        available: false,
                        reason: "backend-load-failed",
                        detail: error instanceof Error ? error.message : String(error),
                    };
                },
            );
            this.availability = pending;
        }
        return this.availability;
    }

    /** True when the backend works AND this project directory is a repository. */
    public async isRepository(): Promise<boolean> {
        if (!(await this.isAvailable())) return false;
        const result = await getInterface().vcs.isRepository(this.projectPath());
        return result.success ? result.data.isRepository : false;
    }

    /**
     * Repository identity and head. Null when there is none to report - an
     * unsupported host and a directory that was never initialised both land here, and
     * {@link getAvailability} is what tells them apart.
     */
    public async getInfo(): Promise<VcsRepositoryInfo | null> {
        if (!(await this.isAvailable())) return null;
        const result = await getInterface().vcs.getInfo(this.projectPath());
        return result.success ? result.data : null;
    }

    /**
     * Revisions, newest first. `limit` 0 means all of them.
     *
     * Async and possibly slow: on a project with a remote the first read fetches
     * fragments over the network (docs §6). Show a loading state; there is
     * deliberately no synchronous accessor to fall back on.
     */
    public async getHistory(limit = 0): Promise<VcsHistoryEntry[]> {
        const cached = this.history.get(limit);
        if (cached) return cached;

        const pending = (async () => {
            if (!(await this.isAvailable())) return [];
            const result = await getInterface().vcs.getHistory(this.projectPath(), limit);
            return result.success ? result.data.entries : [];
        })();
        this.history.set(limit, pending);
        // A failed read must not become the cached answer for the rest of the session.
        void pending.catch(() => this.history.delete(limit));
        return pending;
    }

    /**
     * One file's bytes at one revision - the input to a diff.
     *
     * Throws rather than degrading. Every other read here has an honest empty answer;
     * this one does not, and returning zero bytes for "the backend is missing" would
     * render as a file whose contents were deleted at that revision.
     */
    public async readBlob(revision: RevisionId, path: string): Promise<Uint8Array> {
        const result = await getInterface().vcs.readBlob(this.projectPath(), revision, path);
        if (!result.success) throw new Error(result.error);
        return decodeBase64(result.data.contentBase64);
    }

    /** Paths that differ between two revisions - the filter before diffing. */
    public async getChangedPaths(from: RevisionId, to: RevisionId): Promise<string[]> {
        if (!(await this.isAvailable())) return [];
        const result = await getInterface().vcs.getChangedPaths(this.projectPath(), from, to);
        return result.success ? result.data.paths : [];
    }

    /**
     * Put this project under version control.
     *
     * Throws on failure, and the message is meant to reach the author: this runs
     * because they asked for it, and the failures it has - already a repository, an
     * interrupted earlier setup that left an empty one - are things only they can
     * resolve. Silently reporting success would leave them believing their work is
     * protected when nothing is recording it.
     */
    public async initRepository(options: VcsInitOptions = {}): Promise<VcsRepositoryInfo> {
        const availability = await this.getAvailability();
        if (!availability.available) {
            throw new Error(`Version control is not available on this machine (${availability.reason})`);
        }
        const result = await getInterface().vcs.initRepository(this.projectPath(), options);
        if (!result.success) throw new Error(result.error);
        // The project just became a repository: anything cached from before described
        // a project that did not have one.
        this.history.clear();
        this.setStatus(null);
        return result.data;
    }

    /**
     * Scan the working tree and update the cached snapshot.
     *
     * The ONLY thing that scans. Call it when the author opens the changes view, asks
     * to refresh, or completes an operation that changed the tree - and from nothing
     * that fires on its own. Re-read the class comment before wiring this to anything
     * automatic.
     */
    public async refreshStatus(): Promise<VcsStatus | null> {
        if (!(await this.isAvailable())) {
            this.setStatus(null);
            return null;
        }
        const result = await getInterface().vcs.getStatus(this.projectPath());
        this.setStatus(result.success ? result.data : null);
        return this.status;
    }

    /**
     * The last scan's snapshot, without scanning. Null when nothing has scanned yet,
     * which is not the same as "clean" - `VcsStatus.clean` is that.
     */
    public getStatus(): VcsStatus | null {
        return this.status;
    }

    /**
     * The snapshot's changes with directory entries dropped, which is what a change
     * list shown to an author usually wants.
     *
     * `counts` is deliberately NOT filtered to match. The backend counts directories
     * in its own summary - creating one folder with one file in it is two entries -
     * and re-deriving the numbers from this list would produce a second opinion that
     * disagrees with the repository. A view that shows both has to say what each one
     * is counting.
     *
     * Every `path` here is REPOSITORY-RELATIVE. That is the right shape for
     * {@link readBlob} and for the shared `isVersioned` predicate, and the OPPOSITE of
     * what the write verbs will want - Lore resolves a relative path against the
     * process working directory and then silently ignores it for being outside the
     * repository (docs §4.16). This service exposes no helper that turns a change into
     * a path for a write call; whichever milestone adds one has to make it absolute.
     */
    public getChangedFiles(): VcsFileChange[] {
        return this.status?.files.filter((file) => !file.directory) ?? [];
    }

    /**
     * Forget cached history. For the milestone that lands commits: a new revision
     * makes every cached page short by one, and nothing else can notice.
     */
    public invalidateHistory(): void {
        this.history.clear();
    }

    public onStatusChanged(handler: (status: VcsStatus | null) => void): () => void {
        return this.events.on("statusChanged", handler);
    }

    private async isAvailable(): Promise<boolean> {
        return (await this.getAvailability()).available;
    }

    /** This window's project. Every VCS call is scoped to it, never to "some project". */
    private projectPath(): string {
        return this.getContext().project.getConfig().projectPath;
    }

    private setStatus(next: VcsStatus | null): void {
        this.status = next;
        this.events.emit("statusChanged", next);
    }
}

/**
 * Blobs cross IPC as base64 - a Buffer would arrive as a Uint8Array anyway, and the
 * encoding keeps the contract explicit. Byte-wise on purpose: these are binary assets
 * as often as they are text, and any string round trip would corrupt them.
 */
function decodeBase64(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}
