import { getInterface } from "@/lib/app/bridge";
import { announceClient, teamCall } from "@/lib/team/teamCall";
import { parseVcsRemoteUrl } from "@shared/types/vcs";
import { teamProjectDocTopic, type TeamConnection } from "@shared/types/team";
import { storeWrite } from "../autosave/writeReport";
import { Service } from "../Service";
import { Services, type WorkspaceContext } from "../services";
import { ServiceAssetsService } from "../core/ServiceAssetsService";
import { VersionControlService } from "../core/VersionControlService";
import { UIService } from "../core/UIService";
import { translate } from "@/lib/i18n";
import { StoryService } from "../story/StoryService";
import { FileSystemService } from "../core/FileSystem";
import { WorkspaceReloadService } from "../core/WorkspaceReloadService";
import { createProjectWorkingTreeSource } from "../core/DocumentStorage";
import { resolveDocumentSpecForPath } from "@shared/documents/registry";
import { storyCommentsSpec } from "@shared/documents/specs/storyComments";
import type { DocumentDiff } from "@shared/documents/diff";
import { WorkspaceFreezeService } from "../core/WorkspaceFreezeService";
import { ASSET_PAYLOAD_ROOT, liveDocumentPath } from "@shared/live/sharedDocuments";
import { STORY_LIBRARY_PATH } from "@shared/authority/storyFiles";
import { TeamDocSync, type TeamDocNotice, type TeamDocState, type TeamDocView } from "./teamDocSync";
import { TeamDocWiring } from "./teamDocWiring";
import { createTeamFilePorts } from "./teamFilePorts";

/** One document's difference between a saved version and now. */
export type TeamVersionComparison =
    | { path: string; kind: "added" | "removed" }
    | { path: string; kind: "changed"; diff?: DocumentDiff };

/** Whether a path is one of the documents the server holds (and so one a version answers for). */
function isTeamDocumentPath(path: string): boolean {
    // Not the comments' offline copy: the server's versions do not hold comments, so a past version
    // is shown with today's.
    if (path === storyCommentsSpec.pathFor()) {
        return false;
    }
    return teamWritablePaths().some(entry => path === entry || path.startsWith(`${entry}/`));
}

/** A path with its last `levels` segments taken off. */
function dirnameOf(path: string, levels = 1): string {
    return path.split("/").slice(0, -levels).join("/");
}

/**
 * Every path a team project's server applies edits to - an entry stands for itself and everything
 * under it - built from the same document addresses the server uses.
 */
function teamWritablePaths(): string[] {
    return [
        STORY_LIBRARY_PATH,
        dirnameOf(liveDocumentPath({ doc: "story", storyId: "x" }), 2),
        liveDocumentPath({ doc: "characters" }),
        dirnameOf(liveDocumentPath({ doc: "localization", locale: "x" })),
        dirnameOf(liveDocumentPath({ doc: "voice", locale: "x" })),
        liveDocumentPath({ doc: "localization-keys" }),
        liveDocumentPath({ doc: "variables" }),
        liveDocumentPath({ doc: "app-tags" }),
        liveDocumentPath({ doc: "dlc" }),
        liveDocumentPath({ doc: "brand" }),
        liveDocumentPath({ doc: "dictionary" }),
        liveDocumentPath({ doc: "audio-tracks" }),
        liveDocumentPath({ doc: "asset-sets" }),
        liveDocumentPath({ doc: "ui" }),
        liveDocumentPath({ doc: "ui-graphs" }),
        dirnameOf(liveDocumentPath({ doc: "assets", assetType: "x" })),
        ASSET_PAYLOAD_ROOT,
        // Row comments: their truth is the server's threads (`storyCommentsTeamSync`), and this file is
        // the offline copy of them, which has to keep saving or a comment typed offline is lost.
        storyCommentsSpec.pathFor(),
    ];
}

/** The id the partial freeze is armed under, so it can be told from a live session's. */
const TEAM_FREEZE_SESSION = "team-documents";

/** Where this window's place in a team project is kept: `.nlstudio/services/team_docs.json`. */
const STORE = "team_docs";

/**
 * What the store holds. `detached` is set while the project is a personal copy of a team project:
 * the server it came from, and (in `state`) what it and the server last agreed, so reconnecting
 * sends what changed since exactly as coming back online does.
 */
type TeamDocStore = { version: 1; project: string; state: TeamDocState; detached?: { remote: string } };

/**
 * A team project, followed rather than synced.
 *
 * When the project lives on a Team server that announces `documents`, this is on for the life of the
 * workspace: every story edit goes to the server, everybody's edits come back from it, and the
 * history the author sees is the server's saved versions. There is no room to open and nobody to
 * host. On a server without the capability - or a project on no server - it stays off and the
 * project behaves as it always has.
 *
 * The rules are in {@link TeamDocSync}; this is the wiring - which server and project, the bridge
 * to the socket, the story service, and where the seq is kept.
 */
export class TeamDocumentsService extends Service<TeamDocumentsService> {
    private sync: TeamDocSync | null = null;
    private target: { remoteOrigin: string; project: string } | null = null;
    private connectionToken: { cancel(): void } | null = null;
    private readonly listeners = new Set<(view: TeamDocView | null) => void>();
    private previewing: string | null = null;
    private stopFreezeWatch: (() => void) | null = null;
    /** Set while the project is a personal copy of a team project: where it came from. */
    private detached: { remote: string; project: string } | null = null;

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        await depend([
            ctx.services.get<StoryService>(Services.Story),
            ctx.services.get<VersionControlService>(Services.VersionControl),
            ctx.services.get<ServiceAssetsService>(Services.ServiceAssets),
            ctx.services.get<WorkspaceFreezeService>(Services.WorkspaceFreeze),
        ]);
        // Not awaited: following the project may wait on a network, and the workspace must not.
        void this.readDetached(ctx).then(() => this.begin(ctx)).catch(error => {
            console.warn("[TeamDocuments] could not follow the project", error);
        });
    }

    public override dispose(ctx: WorkspaceContext): void {
        this.stopFreezeWatch?.();
        this.stopFreezeWatch = null;
        try {
            const freeze = ctx.services.get<WorkspaceFreezeService>(Services.WorkspaceFreeze);
            const reason = freeze.getReason();
            if (reason?.kind === "live-session" && reason.session === TEAM_FREEZE_SESSION) {
                freeze.thaw();
            }
        } catch {
            // The workspace is going; nothing to give back.
        }
        this.connectionToken?.cancel();
        this.connectionToken = null;
        this.sync?.stop();
        this.sync = null;
        this.target = null;
        this.emit();
    }

    /** True while this project is followed through its Team server. */
    public isActive(): boolean {
        return this.sync !== null;
    }

    /** Where following stands, or null for a project that is not a team project on such a server. */
    public getView(): TeamDocView | null {
        return this.sync?.getView() ?? null;
    }

    public onChanged(listener: (view: TeamDocView | null) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /** The server and project this follows, for screens that ask the server about its history. */
    public getTarget(): { remoteOrigin: string; project: string } | null {
        return this.target;
    }

    public async saveVersion(label?: string) {
        if (this.sync === null) return { ok: false as const, problem: { detail: "not a team project" } };
        return this.sync.saveVersion(label);
    }

    public async restoreVersion(revision: string) {
        if (this.sync === null) return { ok: false as const, problem: { detail: "not a team project" } };
        return this.sync.restoreVersion(revision);
    }

    public dismissConflicts(): void {
        this.sync?.dismissConflicts();
    }

    public overrideConflict(index: number): Promise<boolean> {
        return this.sync?.overrideConflict(index) ?? Promise.resolve(false);
    }

    /** The version on screen while one is being looked at, or null. */
    public getPreviewing(): string | null {
        return this.previewing;
    }

    /**
     * Show one saved version in the real editors, read-only, until {@link endPreview}.
     *
     * The version's documents come from the server; anything else the editors read (the project
     * file, asset bytes) is today's. Arriving effects are held while it is on screen and applied when
     * the view comes back to the present, so nobody's edit is lost to looking at the past.
     */
    public async previewVersion(revision: string, label?: string): Promise<boolean> {
        const ctx = this.getContext();
        if (this.sync === null) return false;
        const files = await this.sync.readVersion(revision);
        if (files === null) return false;
        const present = createProjectWorkingTreeSource(ctx);
        this.sync.holdEffects(true);
        this.previewing = revision;
        this.emit();
        try {
            await ctx.services.get<WorkspaceFreezeService>(Services.WorkspaceFreeze).showRevision({
                origin: { kind: "revision", revision },
                read: async path => files.get(path) ?? (isTeamDocumentPath(path) ? null : present.read(path)),
                prewarm: async () => undefined,
            }, label);
        } catch (error) {
            this.previewing = null;
            this.sync.holdEffects(false);
            this.emit();
            throw error;
        }
        return true;
    }

    /** Come back from a version to the present: the editors re-read today's files, held effects land. */
    public async endPreview(): Promise<void> {
        if (this.previewing === null) return;
        const ctx = this.getContext();
        const freeze = ctx.services.get<WorkspaceFreezeService>(Services.WorkspaceFreeze);
        if (freeze.getReason()?.kind === "revision") {
            freeze.thaw();
        }
        this.previewing = null;
        this.sync?.holdEffects(false);
        await this.armFreeze(ctx);
        this.emit();
    }

    /**
     * What changed between one saved version and what the project holds now, per document, in the
     * same terms the version history has always used. A document only one side has is reported as
     * made or removed.
     */
    public async compareWithCurrent(revision: string): Promise<TeamVersionComparison[] | null> {
        const ctx = this.getContext();
        if (this.sync === null) return null;
        const then = await this.sync.readVersion(revision);
        if (then === null) return null;
        const present = createProjectWorkingTreeSource(ctx);
        const paths = new Set<string>([...then.keys(), ...(await this.currentDocumentPaths(ctx))]);
        const out: TeamVersionComparison[] = [];
        for (const path of [...paths].sort()) {
            const match = resolveDocumentSpecForPath(path);
            if (match === undefined) continue;
            const before = then.get(path) ?? null;
            const after = await present.read(path).catch(() => null);
            if (before === after) continue;
            if (before === null || after === null) {
                out.push({ path, kind: before === null ? "added" : "removed" });
                continue;
            }
            try {
                const context = { path, corrupt: (reason: string): never => { throw new Error(reason); } };
                const base = match.spec.parse(JSON.parse(before), context);
                const head = match.spec.parse(JSON.parse(after), context);
                const diff = match.spec.diff?.(base, head, { limit: 200 });
                if (diff === undefined || diff.total > 0) {
                    out.push({ path, kind: "changed", ...(diff === undefined ? {} : { diff }) });
                }
            } catch {
                out.push({ path, kind: "changed" });
            }
        }
        return out;
    }

    /** Every project document this window's working tree holds, by the paths the stories and libraries name. */
    private async currentDocumentPaths(ctx: WorkspaceContext): Promise<string[]> {
        const story = ctx.services.get<StoryService>(Services.Story);
        return [
            STORY_LIBRARY_PATH,
            ...story.listStories().map(entry => liveDocumentPath({ doc: "story", storyId: entry.id })),
            liveDocumentPath({ doc: "characters" }),
            liveDocumentPath({ doc: "variables" }),
            liveDocumentPath({ doc: "app-tags" }),
            liveDocumentPath({ doc: "dlc" }),
            liveDocumentPath({ doc: "brand" }),
            liveDocumentPath({ doc: "dictionary" }),
            liveDocumentPath({ doc: "audio-tracks" }),
            liveDocumentPath({ doc: "asset-sets" }),
            liveDocumentPath({ doc: "ui" }),
            liveDocumentPath({ doc: "ui-graphs" }),
            liveDocumentPath({ doc: "localization-keys" }),
        ];
    }

    /**
     * Make this a personal project again: stop following the server, record what this window holds
     * as a local version, and point the project at no server.
     *
     * Nothing on the server is touched - the team project is still there for everyone else - and
     * nothing here is lost: the copy this window holds (offline edits included) becomes the project's
     * newest local version, and from then on it is edited and versioned as any personal project.
     *
     * **And it can go back.** What this window and the server last agreed is kept, as it is when the
     * connection drops; {@link reconnect} later sends everything changed since, exactly as coming back
     * online does - collisions with what the team did meanwhile reported, nothing overwritten.
     */
    public async detach(): Promise<void> {
        const ctx = this.getContext();
        const version = ctx.services.get<VersionControlService>(Services.VersionControl);
        const story = ctx.services.get<StoryService>(Services.Story);
        const freeze = ctx.services.get<WorkspaceFreezeService>(Services.WorkspaceFreeze);
        const remote = await version.getRemote();
        const target = this.target;
        const agreed = this.sync === null ? null : await this.sync.detachedState();
        this.stopFreezeWatch?.();
        this.stopFreezeWatch = null;
        this.connectionToken?.cancel();
        this.connectionToken = null;
        this.sync?.stop();
        this.sync = null;
        this.target = null;
        const reason = freeze.getReason();
        if (reason?.kind === "live-session" && reason.session === TEAM_FREEZE_SESSION) {
            freeze.thaw();
        }
        version.setTeamManaged(false);
        await story.flushPendingChanges();
        await version.commit({ message: "Made a personal copy of the team project" });
        await version.setRemote(null);
        const store: TeamDocStore = remote !== null && target !== null && agreed !== null
            ? { version: 1, project: target.project, state: agreed, detached: { remote } }
            : { version: 1, project: "", state: { seq: -1 } };
        await ctx.services.get<ServiceAssetsService>(Services.ServiceAssets).writeStore(
            STORE,
            store,
            storeWrite("workspace.shell.save.stores.teamDocs", "notRetried"),
        );
        this.detached = store.detached === undefined ? null : { remote: store.detached.remote, project: store.project };
        this.emit();
    }

    /** Where the project came from while it is a personal copy of a team project, or null. */
    public getDetached(): { remote: string; project: string } | null {
        return this.detached;
    }

    /**
     * Put a personal copy back on the team project it came from. Everything changed since the copy
     * was made is sent as an offline replay is: the stories row by row, every other file whole,
     * each against what the copy and the server last agreed. Collisions come back as conflicts.
     */
    public async reconnect(): Promise<boolean> {
        const ctx = this.getContext();
        const detached = this.detached;
        if (detached === null || this.sync !== null) return false;
        const version = ctx.services.get<VersionControlService>(Services.VersionControl);
        const stores = ctx.services.get<ServiceAssetsService>(Services.ServiceAssets);
        const read = await stores.readStore<TeamDocStore>(STORE);
        if (!read.ok || !read.data || read.data.version !== 1) return false;
        await ctx.services.get<StoryService>(Services.Story).flushPendingChanges();
        await version.commit({ message: "Back to the team project" }).catch(() => undefined);
        await version.setRemote(detached.remote);
        const { detached: _gone, ...rest } = read.data;
        await stores.writeStore(STORE, rest, storeWrite("workspace.shell.save.stores.teamDocs", "notRetried"));
        this.detached = null;
        this.emit();
        await this.begin(ctx);
        return this.sync !== null;
    }

    private async readDetached(ctx: WorkspaceContext): Promise<void> {
        const read = await ctx.services.get<ServiceAssetsService>(Services.ServiceAssets).readStore<TeamDocStore>(STORE);
        const data = read.ok ? read.data : null;
        this.detached = data?.version === 1 && data.detached !== undefined ? { remote: data.detached.remote, project: data.project } : null;
        if (this.detached !== null) this.emit();
    }

    private async begin(ctx: WorkspaceContext): Promise<void> {
        const version = ctx.services.get<VersionControlService>(Services.VersionControl);
        const info = await version.getInfo();
        const remote = info === null ? null : await version.getRemote();
        const parsed = remote === null ? null : parseVcsRemoteUrl(remote);
        if (info === null || parsed === null || (await version.getServerSession()) === null) {
            return;
        }
        const remoteOrigin = parsed.origin;
        const project = info.repositoryId;
        const opened = await getInterface().team.open(remoteOrigin).catch(() => null);
        if (!opened?.success || !opened.data.capabilities.includes("documents")) {
            // A server that does not hold the project's documents: the project is versioned the old
            // way, and nothing here changes it.
            return;
        }
        this.target = { remoteOrigin, project };
        let connection: TeamConnection = opened.data;
        const connectionListeners = new Set<(online: boolean) => void>();
        this.connectionToken = getInterface().team.onConnectionChanged(({ connection: changed }) => {
            if (changed.remoteOrigin !== remoteOrigin) return;
            const was = connection.state === "ready";
            connection = changed;
            const now = connection.state === "ready";
            if (was !== now) {
                for (const listener of connectionListeners) listener(now);
            }
        });

        const story = ctx.services.get<StoryService>(Services.Story);
        await story.loadAllStories();
        const stores = ctx.services.get<ServiceAssetsService>(Services.ServiceAssets);
        const files = createTeamFilePorts(ctx, { remoteOrigin, project });
        const instance = globalThis.crypto?.randomUUID?.() ?? `w${Date.now().toString(36)}`;
        const wiring = new TeamDocWiring(ctx, remoteOrigin, project);
        // A window the server knows to be on the project: what its file transfers are authorised by.
        await announceClient(remoteOrigin, { project }).catch(() => undefined);

        this.sync = new TeamDocSync({
            instance,
            call: async (method, params) => {
                const answered = await teamCall(remoteOrigin, method, { project, ...params });
                return answered.ok
                    ? answered
                    : { ok: false, problem: { detail: "detail" in answered.problem ? answered.problem.detail : answered.problem.kind } };
            },
            listen: onEvent => {
                const topic = teamProjectDocTopic(project);
                void getInterface().team.subscribe(remoteOrigin, topic).catch(() => undefined);
                const token = getInterface().team.onEvent(message => {
                    if (message.remoteOrigin === remoteOrigin && message.topic === topic) {
                        onEvent(message.payload);
                    }
                });
                return () => {
                    token.cancel();
                    void getInterface().team.unsubscribe(remoteOrigin, topic).catch(() => undefined);
                };
            },
            isOnline: () => connection.state === "ready",
            onConnection: listener => {
                connectionListeners.add(listener);
                return () => connectionListeners.delete(listener);
            },
            documents: {
                install: handler => wiring.install(handler),
                apply: (document, op, derived) => wiring.apply(document, op, derived),
            },
            story: {
                snapshot: () => story.snapshotLoadedDocuments(),
                restore: stories => story.restoreTeamDocuments(stories),
                entry: storyId => story.listStories().find(entry => entry.id === storyId),
                adoptFiles: async files => {
                    // Stories through their service, which parses them as the server did and draws them;
                    // every other document onto disk, and then every service re-reads what it owns.
                    await story.adoptTeamFiles(files);
                    const fs = ctx.services.get<FileSystemService>(Services.FileSystem);
                    const root = ctx.project.getConfig().projectPath;
                    let others = false;
                    for (const [path, text] of files) {
                        if (path === STORY_LIBRARY_PATH || path.startsWith("editor/story/stories/")) continue;
                        const absolute = `${root}/${path}`;
                        await fs.createDir(absolute.slice(0, absolute.lastIndexOf("/")));
                        await fs.write(absolute, text, "utf-8");
                        others = true;
                    }
                    if (others) {
                        await ctx.services.get<WorkspaceReloadService>(Services.WorkspaceReload).reload("restore");
                    }
                },
            },
            state: {
                load: async () => {
                    const read = await stores.readStore<TeamDocStore>(STORE);
                    if (!read.ok || !read.data || read.data.version !== 1 || read.data.project !== project) {
                        return null;
                    }
                    return read.data.state;
                },
                save: async state => {
                    await stores.writeStore(
                        STORE,
                        { version: 1, project, state },
                        storeWrite("workspace.shell.save.stores.teamDocs", "notRetried"),
                    );
                },
            },
            notify: notice => this.notify(ctx, notice),
            files,
        });
        this.sync.onChanged(() => {
            void this.armFreeze(ctx);
            this.emit();
        });
        // Version control stops recording checkpoints of its own: the project's history is the
        // server's saved versions now, and a local commit would only diverge from them.
        version.setTeamManaged(true);
        // Whenever another freeze lets go - a merge settled, a version view left by some other way -
        // the team's own partial freeze goes back up, or the project would be writable everywhere.
        this.stopFreezeWatch = ctx.services.get<WorkspaceFreezeService>(Services.WorkspaceFreeze).onChanged(reason => {
            if (reason === null && this.sync !== null && this.previewing === null) {
                this.freezeKey = "";
                void this.armFreeze(ctx);
            }
        });
        await this.armFreeze(ctx);
        await this.sync.start();
        await this.armFreeze(ctx);
        this.emit();
    }

    /**
     * A team project is edited exactly as a personal one: online every edit goes to the server
     * (documents as operations, every other file whole), offline everything lands here and is sent
     * on reconnecting. So nothing is frozen - except for a role that follows the project without
     * editing it (a reviewer), for whom only the comments' offline copy is written. The same partial
     * freeze a live session arms, so the editors already know how to say why a panel will not take
     * an edit.
     */
    private freezeKey = "";
    private async armFreeze(ctx: WorkspaceContext): Promise<void> {
        const freeze = ctx.services.get<WorkspaceFreezeService>(Services.WorkspaceFreeze);
        const current = freeze.getReason();
        const ours = current?.kind === "live-session" && current.session === TEAM_FREEZE_SESSION;
        if (current !== null && !ours) {
            // Another freeze is up - a version on screen, a merge, a takeover - and outranks this one.
            return;
        }
        const readOnly = this.sync !== null && !this.sync.getView().mayEdit;
        if (!readOnly) {
            this.freezeKey = "";
            if (ours) freeze.thaw();
            return;
        }
        const writable = [storyCommentsSpec.pathFor()];
        const key = writable.join("\n");
        if (current !== null && key === this.freezeKey) {
            return;
        }
        this.freezeKey = key;
        await freeze.freeze({ kind: "live-session", session: TEAM_FREEZE_SESSION, writable });
    }

    private notify(ctx: WorkspaceContext, notice: TeamDocNotice): void {
        const notifications = ctx.services.get<UIService>(Services.UI).notifications;
        switch (notice.kind) {
            case "refused":
                notifications.warning(translate("workspace.shell.team.docs.refused"), notice.detail ?? notice.reason);
                return;
            case "restored":
                notifications.info(translate("workspace.shell.team.docs.restored", { by: notice.by ?? "" }));
                return;
            case "diverged":
                notifications.warning(translate("workspace.shell.team.docs.diverged"), notice.detail);
                return;
            case "version-saved":
                return;
        }
    }

    private emit(): void {
        const view = this.getView();
        for (const listener of this.listeners) listener(view);
    }
}
