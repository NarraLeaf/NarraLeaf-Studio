import type { LiveDerived, LiveDocument, LiveStoryOp } from "@shared/live/ops";
import { isProjectDocumentPath, isWholeFilePath, projectDocumentPath, type ProjectOp, type TeamFileContent, type TeamFileDocument, type TeamFileOp, type TeamStoryLibraryOp } from "@shared/authority/project";
import type { StoryDocument, StoryId, StoryLibraryEntry } from "@shared/types/story";
import { storyDiffToOps } from "@shared/story/storyDiffToOps";
import type { TeamDocHandler } from "./teamDocWiring";
import {
    bytesOf,
    changesSince,
    contentFor,
    decodeBase64,
    isAssetContentPath,
    manifestOf,
    type TeamFileBytes,
    type TeamFileChange,
    type TeamFilePorts,
} from "./teamFileSync";

/** How long after a write to a project file this looks for whole files to send. */
const SCAN_DELAY_MS = 400;
/** And how often regardless: some writers (the project file) do not pass through the observed boundary. */
const SCAN_EVERY_MS = 10_000;

/**
 * One window's half of a team project whose documents live on the Team server.
 *
 * **Opening a team project is following it.** There is no room and no host: the server holds the
 * project's current state, every edit made here is sent to it as an intent, and every edit anybody
 * makes - this window's included - arrives back as an effect, numbered by the server, which this
 * applies in that order. Nothing is applied before the server has done it, so nothing ever has to
 * be taken back, and two windows that have applied the same seq hold the same documents.
 *
 * **Offline is a mode, not a failure.** While the server cannot be reached the author keeps
 * editing their own copy. The copy the server and this window last agreed on is kept beside it
 * (the *base*, with the seq it stood at). On reconnecting, the difference between base and copy
 * becomes story operations (`storyDiffToOps`), the copy goes back to the base, this window catches
 * up on everything that happened meanwhile, and the operations are sent as intents stamped with
 * the base's seq. The server lands whatever nobody else touched; a row somebody changed in the
 * meantime comes back as a conflict, which is reported - with what the author had written - so
 * nothing they typed is silently lost.
 *
 * Everything it touches is a port, so all of the above runs in a test without a server, a socket
 * or a workspace.
 *
 * **Every other file travels whole** (see `./teamFileSync`): a file with no finer operations is
 * sent whenever it is written, and offline every changed file - the documents too - is sent whole on
 * reconnecting, stamped with the seq it was based on. Stories alone are replayed row by row.
 */
export class TeamDocSync {
    private appliedSeq = 0;
    private readonly pending = new Map<number, TeamDocEffect>();
    private catchingUp: Promise<void> | null = null;
    private online = false;
    private started = false;
    private stopListening: (() => void) | null = null;
    private stopConnection: (() => void) | null = null;
    private nextClient = 0;
    private view: TeamDocView = { state: "starting", seq: 0, conflicts: [], mayEdit: true };
    private readonly listeners = new Set<(view: TeamDocView) => void>();
    /** Offline: what this window and the server last agreed on, and the seq it stood at. */
    private offlineBase: TeamDocOfflineBase | null = null;
    /** While true, arriving effects wait in {@link pending}. See {@link holdEffects}. */
    private held = false;
    /** Holds taken while a file is put back from the server; effects wait while any is up. */
    private fileHolds = 0;
    /** What this window and the server last agreed each whole file is: its digest, by path. */
    private known = new Map<string, string>();
    /** Whether {@link known} came from somewhere, rather than being empty for lack of a record. */
    private knownLoaded = false;
    /** Whole files sent and taken whose effect has not been applied yet: digest, by path. */
    private readonly sentFiles = new Map<string, string>();
    /** Effects on these paths are not applied up to the seq given: the file is being put back whole. */
    private readonly skipThrough = new Map<string, number>();
    /** File work - applying file effects, sending whole files, putting files back - one at a time. */
    private fileQueue: Promise<void> = Promise.resolve();
    /** The batch of file effects being applied, while one is. */
    private fileBatch: Promise<void> | null = null;
    private scanTimer: ReturnType<typeof setTimeout> | null = null;
    private scanInterval: ReturnType<typeof setInterval> | null = null;
    private stopObserving: (() => void) | null = null;

    public constructor(private readonly ports: TeamDocPorts) {}

    public getView(): TeamDocView {
        return this.view;
    }

    public onChanged(listener: (view: TeamDocView) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * Begin following the project.
     *
     * Reads where this window left off (a seq, and an offline base if it closed while offline),
     * brings its tree to what the server has, and from then on follows the project's `doc` topic.
     */
    public async start(): Promise<void> {
        if (this.started) {
            return;
        }
        this.started = true;
        const held = await this.ports.state.load();
        this.offlineBase = held?.offline ?? null;
        this.appliedSeq = held?.seq ?? -1;
        this.known = new Map(Object.entries(held?.files ?? {}));
        this.knownLoaded = held?.files !== undefined;
        const files = this.ports.files;
        if (files !== undefined) {
            this.stopObserving = files.observe(path => {
                if (isWholeFilePath(path)) this.queueScan();
            });
            this.scanInterval = setInterval(() => this.queueScan(), SCAN_EVERY_MS);
        }
        this.stopListening = this.ports.listen(payload => this.receive(payload));
        this.stopConnection = this.ports.onConnection(online => {
            void (online ? this.goOnline() : this.goOffline());
        });
        if (this.ports.isOnline()) {
            await this.goOnline();
        } else {
            await this.goOffline();
        }
    }

    public stop(): void {
        this.stopListening?.();
        this.stopConnection?.();
        this.stopObserving?.();
        this.stopListening = null;
        this.stopConnection = null;
        this.stopObserving = null;
        if (this.scanTimer !== null) clearTimeout(this.scanTimer);
        if (this.scanInterval !== null) clearInterval(this.scanInterval);
        this.scanTimer = null;
        this.scanInterval = null;
        this.ports.documents.install(null);
        this.started = false;
    }

    /** Save what the project holds now as a history version. */
    public async saveVersion(label?: string): Promise<TeamDocOutcome<{ revision?: string }>> {
        const answered = await this.ports.call("doc.snapshot", label === undefined ? {} : { label });
        if (!answered.ok) {
            return answered;
        }
        const revision = readText(answered.value, "revision");
        return { ok: true, value: revision === undefined ? {} : { revision } };
    }

    /** Put one version back as the current state, as a new version. */
    public async restoreVersion(revision: string): Promise<TeamDocOutcome<null>> {
        const answered = await this.ports.call("doc.restore", { revision });
        return answered.ok ? { ok: true, value: null } : answered;
    }

    /** Forget the conflicts reported so far. */
    public dismissConflicts(): void {
        this.set({ conflicts: [] });
    }

    /**
     * Let the author's offline version of one conflicted edit win: send it again as an ordinary live
     * edit, which lands over whatever is there now. Answers whether the server took it.
     */
    public async overrideConflict(index: number): Promise<boolean> {
        const conflict = this.view.conflicts[index];
        if (conflict === undefined || !this.online) {
            return false;
        }
        const answer = conflict.kind === "file"
            ? await this.sendFile({ path: conflict.path, bytes: conflict.mine }, this.appliedSeq)
            : await this.send({ doc: "story", storyId: conflict.storyId }, conflict.op);
        if (answer.kind === "effect") {
            this.set({ conflicts: this.view.conflicts.filter((_, at) => at !== index) });
            return true;
        }
        return false;
    }

    /* -------------------------------------------------------------- connection */

    private async goOnline(): Promise<void> {
        if (this.online) {
            return;
        }
        const head = await this.ports.call("doc.head", {});
        if (!head.ok) {
            // Reachable but refusing, or not reachable after all: carry on as offline.
            await this.goOffline();
            return;
        }
        this.online = true;
        const seq = readNumber(head.value, "seq") ?? 0;
        const mayEdit = readBoolean(head.value, "mayEdit") ?? true;
        const prunedThrough = readNumber(head.value, "prunedThrough") ?? 0;
        this.set({ state: "syncing", mayEdit });

        // Files changed here since this window and the server last agreed - offline, or while this
        // window was closed - are read before anything is written over them.
        const offline = this.offlineBase;
        const files = this.ports.files;
        const fileBase = offline?.seq ?? this.appliedSeq;
        let fileChanges: TeamFileChange[] = [];
        if (files !== undefined && mayEdit && fileBase >= 0) {
            if (offline?.files !== undefined) {
                fileChanges = await changesSince(files, new Map(Object.entries(offline.files)), "all");
            } else if (this.knownLoaded) {
                fileChanges = await changesSince(files, this.known, "whole");
            }
        }

        // Offline edits are taken out of the documents first, so the catch-up applies to the base
        // the server and this window agreed on.
        let replay: Array<{ storyId: StoryId; op: LiveStoryOp | TeamStoryLibraryOp }> = [];
        if (offline !== null) {
            replay = this.offlineOps(offline);
            this.ports.story.restore(offline.stories);
            this.appliedSeq = offline.seq;
        }

        // A window that does not know where it stands - never opened here, or its copy was found
        // to differ - starts from the last saved version, which holds everything up to its seq.
        // (A window that does know follows the log from its own seq, which the server keeps whole.)
        // So does one the server's log no longer reaches back to: it was away longer than the log is
        // kept, and the last saved version is the nearest point both still have.
        // Whole files first, against the seq they were based on: one somebody else wrote since comes
        // back refused, is kept for its author as a conflict, and is put back from the server once
        // the catch-up is done - nothing that arrives for it meanwhile is applied over the author's
        // copy.
        const fileConflicts: TeamDocConflict[] = [];
        const putBack: string[] = [];
        for (const change of fileChanges) {
            const answer = await this.sendFile(change, fileBase);
            if (answer.kind === "refusal" && answer.reason !== "nothing-there") {
                fileConflicts.push({ kind: "file", path: change.path, mine: change.bytes, reason: answer.reason, ...(answer.detail === undefined ? {} : { detail: answer.detail }) });
                putBack.push(change.path);
                this.skipThrough.set(change.path, Number.POSITIVE_INFINITY);
            }
        }

        if (this.appliedSeq < 0 || this.appliedSeq < prunedThrough) {
            if (!(await this.adoptBase())) {
                this.online = false;
                this.set({ state: "offline" });
                return;
            }
        }

        await this.catchUp(seq);
        for (const path of putBack) {
            await this.putBack(path);
        }
        if (files !== undefined && !this.knownLoaded) {
            // A window that kept no record of its whole files (a Studio before this one wrote it):
            // what is on disk now is taken as agreed.
            this.known = await manifestOf(files, "whole");
            this.knownLoaded = true;
        }
        this.ports.documents.install(mayEdit ? this.handler : null);
        this.offlineBase = null;
        await this.persist();
        this.set({ state: "online", seq: this.appliedSeq });
        if (fileConflicts.length > 0) {
            this.set({ conflicts: [...this.view.conflicts, ...fileConflicts] });
        }

        if (replay.length > 0) {
            const conflicts: TeamDocConflict[] = [];
            for (const { storyId, op } of replay) {
                const answer = await this.send({ doc: "story", storyId }, op, undefined, offline?.seq);
                if (answer.kind === "refusal") {
                    conflicts.push({ kind: "story", storyId, op, reason: answer.reason, ...(answer.detail === undefined ? {} : { detail: answer.detail }) });
                }
            }
            if (conflicts.length > 0) {
                this.set({ conflicts: [...this.view.conflicts, ...conflicts] });
            }
        }
    }

    private async goOffline(): Promise<void> {
        const wasOnline = this.online;
        this.online = false;
        // Edits go straight into this window's copy from here on.
        this.ports.documents.install(null);
        if (this.offlineBase === null && this.appliedSeq >= 0) {
            this.offlineBase = await this.captureBase();
            await this.persist();
        }
        if (wasOnline || this.view.state !== "offline") {
            this.set({ state: "offline" });
        }
    }

    /**
     * What this window and the server agree on right now, kept so that what changes from here can be
     * told apart: the stories (replayed as rows), and the digest of every other file (sent whole) -
     * whole files as last agreed rather than as on disk, because one written and not yet sent is a
     * change too.
     */
    public async captureBase(): Promise<TeamDocOfflineBase> {
        const base: TeamDocOfflineBase = { seq: this.appliedSeq, stories: this.ports.story.snapshot() };
        const files = this.ports.files;
        if (files === undefined || !this.knownLoaded) {
            return base;
        }
        await files.flush();
        const manifest = await manifestOf(files, "all");
        for (const path of [...manifest.keys()]) {
            if (isWholeFilePath(path)) manifest.delete(path);
        }
        for (const [path, digest] of this.known) manifest.set(path, digest);
        return { ...base, files: Object.fromEntries(manifest) };
    }

    /**
     * What to keep when this project stops following the server (made a personal copy): where it
     * stands, and what it and the server last agreed - so going back later sends what changed since,
     * as coming back online does.
     */
    public async detachedState(): Promise<TeamDocState> {
        const offline = this.offlineBase ?? (this.appliedSeq >= 0 ? await this.captureBase() : undefined);
        return {
            seq: this.appliedSeq,
            ...(offline === undefined ? {} : { offline }),
            ...(this.knownLoaded ? { files: Object.fromEntries(this.known) } : {}),
        };
    }

    /**
     * Replace this window's copy with the last saved version, read from the server, and stand at
     * its seq. Read a file a chunk at a time; a version saved halfway through starts it again.
     */
    private async adoptBase(): Promise<boolean> {
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const read = await this.readFiles("doc.base", {}, true);
            if (read === null) {
                return false;
            }
            if (read === "moved") {
                continue;
            }
            const documents = new Map<string, string>();
            const whole = new Map<string, Uint8Array>();
            for (const [path, bytes] of read.files) {
                if (isWholeFilePath(path)) whole.set(path, bytes);
                else if (isProjectDocumentPath(path)) documents.set(path, new TextDecoder().decode(bytes));
            }
            await this.ports.story.adoptFiles(documents);
            if (!(await this.adoptWholeFiles(whole, read.notes, read.revision))) {
                return false;
            }
            this.appliedSeq = read.seq;
            this.pending.clear();
            return true;
        }
        return false;
    }

    /**
     * Bring every whole file to the version's, and remove those it does not have - the server is
     * where the project is, and a window starting from a version holds nothing of its own yet.
     */
    private async adoptWholeFiles(
        files: ReadonlyMap<string, Uint8Array>,
        notes: readonly TeamFileNote[],
        revision: string | null,
    ): Promise<boolean> {
        const port = this.ports.files;
        if (port === undefined) {
            return true;
        }
        const wanted = new Map(files);
        for (const note of notes) {
            if (!isWholeFilePath(note.path)) continue;
            const bytes = await this.noteBytes(note, revision);
            if (bytes === null) return false;
            wanted.set(note.path, bytes);
        }
        await port.flush();
        const known = new Map<string, string>();
        let wrote = false;
        const disk = await manifestOf(port, "whole");
        for (const [path, bytes] of wanted) {
            const digest = await port.digest(bytes);
            known.set(path, digest);
            if (disk.get(path) !== digest) {
                await port.write(path, bytes);
                wrote = true;
            }
        }
        for (const path of disk.keys()) {
            if (!wanted.has(path)) {
                await port.remove(path);
                wrote = true;
            }
        }
        this.known = known;
        this.knownLoaded = true;
        if (wrote) await port.reload();
        return true;
    }

    /** The bytes a note stands for: a large file read from the saved version, or one still in transfer. */
    private async noteBytes(note: TeamFileNote, revision: string | null): Promise<Uint8Array | null> {
        if (note.transferId !== undefined) {
            return (await this.ports.files?.collect(note.path, { transferId: note.transferId, digest: note.digest, size: note.size })) ?? null;
        }
        if (revision === null) return null;
        return this.readOne("doc.files", { revision }, note.path);
    }

    /** The project documents of one saved version, for previewing or comparing it. Null when unreadable. */
    public async readVersion(revision: string): Promise<Map<string, string> | null> {
        const read = await this.readFiles("doc.files", { revision }, false);
        if (read === null || read === "moved") return null;
        const out = new Map<string, string>();
        for (const [path, bytes] of read.files) {
            if (isProjectDocumentPath(path)) out.set(path, new TextDecoder().decode(bytes));
        }
        return out;
    }

    /**
     * Read a set of files a chunk at a time. With `consistent`, every chunk has to come from the
     * same seq and revision as the listing; one that does not answers "moved" so the caller starts
     * again (a version was saved halfway through).
     */
    private async readFiles(
        method: "doc.base" | "doc.files",
        extra: Record<string, unknown>,
        consistent: boolean,
    ): Promise<{ seq: number; revision: string | null; files: Map<string, Uint8Array>; notes: TeamFileNote[] } | "moved" | null> {
        const listing = await this.ports.call(method, extra);
        if (!listing.ok) {
            return null;
        }
        const seq = readNumber(listing.value, "seq") ?? 0;
        const revision = readText(listing.value, "revision") ?? null;
        const list = readRecord(listing.value)?.["files"];
        const entries = Array.isArray(list) ? list : [];
        const paths: string[] = [];
        const notes: TeamFileNote[] = [];
        for (const entry of entries) {
            const path = readText(entry, "path");
            if (path === undefined) continue;
            const digest = readText(entry, "digest");
            if (digest !== undefined) {
                const transferId = readText(entry, "transferId");
                notes.push({ path, digest, size: readNumber(entry, "size") ?? 0, ...(transferId === undefined ? {} : { transferId }) });
            } else {
                paths.push(path);
            }
        }
        const files = new Map<string, Uint8Array>();
        for (const path of paths) {
            const chunks: Uint8Array[] = [];
            let offset = 0;
            for (;;) {
                const part = await this.ports.call(method, { ...extra, path, offset });
                if (!part.ok) {
                    return null;
                }
                if (consistent && (readNumber(part.value, "seq") !== seq || (readText(part.value, "revision") ?? null) !== revision)) {
                    return "moved";
                }
                const bytes = decodeBase64(readText(part.value, "chunk") ?? "");
                chunks.push(bytes);
                offset += bytes.length;
                const size = readNumber(part.value, "size") ?? 0;
                if (offset >= size || bytes.length === 0) {
                    break;
                }
            }
            files.set(path, concat(chunks));
        }
        return { seq, revision, files, notes };
    }

    /** One file of a listing method, a chunk at a time. Null when it cannot be read. */
    private async readOne(method: "doc.files" | "doc.file", extra: Record<string, unknown>, path: string): Promise<Uint8Array | null> {
        const chunks: Uint8Array[] = [];
        let offset = 0;
        for (;;) {
            const part = await this.ports.call(method, { ...extra, path, offset });
            if (!part.ok) return null;
            const bytes = decodeBase64(readText(part.value, "chunk") ?? "");
            chunks.push(bytes);
            offset += bytes.length;
            if (offset >= (readNumber(part.value, "size") ?? 0) || bytes.length === 0) break;
        }
        return concat(chunks);
    }

    /**
     * Stop applying arriving effects, or start again. While a past version is on screen the editors
     * hold that version, and an effect applied to it would be lost when the view returns to the
     * present; held effects wait in order and are applied the moment the hold is lifted.
     */
    public holdEffects(hold: boolean): void {
        this.held = hold;
        if (!hold) {
            this.drain();
        }
    }

    private isHeld(): boolean {
        return this.held || this.fileHolds > 0;
    }

    /* -------------------------------------------------------------- applying */

    /** Fetch and apply every effect after what is applied, up to at least `until`. */
    private async catchUp(until = 0): Promise<void> {
        if (this.catchingUp !== null) {
            return this.catchingUp;
        }
        this.catchingUp = (async () => {
            try {
                for (;;) {
                    if (this.isHeld()) {
                        return;
                    }
                    const page = await this.ports.call("doc.effects", { after: this.appliedSeq });
                    if (!page.ok) {
                        return;
                    }
                    const effects = readEffects(page.value);
                    const first = effects[0];
                    if (first !== undefined && first.seq > this.appliedSeq + 1 && !this.pending.has(this.appliedSeq + 1)) {
                        // The log starts after where this window stands: it was cleared while this
                        // window was away. Start again from the last saved version and read on.
                        if (!(await this.adoptBase())) {
                            return;
                        }
                        continue;
                    }
                    for (const effect of effects) {
                        this.pending.set(effect.seq, effect);
                    }
                    this.drain();
                    await this.settled();
                    const more = readBoolean(page.value, "more") === true;
                    if (!more && this.appliedSeq >= until) {
                        return;
                    }
                    if (effects.length === 0) {
                        return;
                    }
                }
            } finally {
                this.catchingUp = null;
            }
        })();
        return this.catchingUp;
    }

    private receive(payload: unknown): void {
        const kind = readText(payload, "kind");
        if (kind === "doc-effect") {
            const effect = readEffect(readRecord(payload, "effect"));
            if (effect !== null) {
                this.accept(effect);
            }
            return;
        }
        if (kind === "doc-snapshot") {
            const revision = readText(payload, "revision");
            const seq = readNumber(payload, "seq");
            const label = readText(payload, "label");
            if (revision !== undefined && seq !== undefined) {
                this.ports.notify({ kind: "version-saved", revision, seq, ...(label === undefined ? {} : { label }) });
            }
            return;
        }
        if (kind === "doc-reset") {
            const revision = readText(payload, "revision");
            const seq = readNumber(payload, "seq");
            if (revision !== undefined && seq !== undefined) {
                void this.reset(revision, seq, readText(payload, "by"));
            }
        }
    }

    /** A restore replaced everything: bring the tree to the version it made and carry on from there. */
    private async reset(revision: string, seq: number, by: string | undefined): Promise<void> {
        if (!this.online) {
            return;
        }
        this.ports.documents.install(null);
        this.pending.clear();
        await this.adoptBase();
        await this.catchUp(seq);
        this.ports.documents.install(this.view.mayEdit ? this.handler : null);
        await this.persist();
        this.set({ seq: this.appliedSeq });
        this.ports.notify({ kind: "restored", revision, ...(by === undefined ? {} : { by }) });
    }

    private accept(effect: TeamDocEffect): void {
        if (effect.seq <= this.appliedSeq) {
            return;
        }
        this.pending.set(effect.seq, effect);
        this.drain();
        if (this.pending.size > 0 && this.online && !this.isHeld() && this.fileBatch === null) {
            // A gap: something was missed. Delivery is weak on purpose; the log is not.
            void this.catchUp(effect.seq);
        }
    }

    private drain(): void {
        if (this.isHeld() || this.fileBatch !== null) {
            return;
        }
        let moved = false;
        for (;;) {
            const next = this.pending.get(this.appliedSeq + 1);
            if (next === undefined) {
                break;
            }
            if (this.ports.files !== undefined && fileOf(next) !== null) {
                // Files are written to disk, which takes a while; everything after waits for them.
                this.runFileBatch();
                break;
            }
            this.pending.delete(next.seq);
            this.apply(next);
            this.appliedSeq = next.seq;
            moved = true;
        }
        for (const seq of this.pending.keys()) {
            if (seq <= this.appliedSeq) {
                this.pending.delete(seq);
            }
        }
        if (moved) {
            void this.persist();
            this.set({ seq: this.appliedSeq });
        }
    }

    /** Apply every file effect that is next in line, one batch: flush first, re-read once after. */
    private runFileBatch(): void {
        const files = this.ports.files!;
        const batch = this.enqueue(async () => {
            await files.flush();
            let wrote = false;
            for (;;) {
                const next = this.pending.get(this.appliedSeq + 1);
                if (next === undefined || fileOf(next) === null || this.held) break;
                this.pending.delete(next.seq);
                wrote = (await this.applyFile(next)) || wrote;
                this.appliedSeq = next.seq;
            }
            if (wrote) await files.reload();
            await this.persist();
            this.set({ seq: this.appliedSeq });
        });
        this.fileBatch = batch;
        void batch.finally(() => {
            if (this.fileBatch === batch) this.fileBatch = null;
            this.drain();
            if (this.pending.size > 0 && this.online && !this.isHeld() && this.fileBatch === null) {
                void this.catchUp();
            }
        });
    }

    /** Wait for the file effects being applied, and any batch that follows them, to finish. */
    private async settled(): Promise<void> {
        while (this.fileBatch !== null) {
            await this.fileBatch.catch(() => undefined);
        }
    }

    private enqueue(task: () => Promise<void>): Promise<void> {
        const run = this.fileQueue.then(task, task);
        this.fileQueue = run.catch(error => {
            console.warn("[TeamDocSync] file work failed", error);
        });
        return run;
    }

    /**
     * Write one file somebody put. A whole file this window changed and has not sent yet collides:
     * the author's bytes are kept as a conflict and the server's are written, the same way an
     * offline edit refused is reported. Answers whether anything on disk changed.
     */
    private async applyFile(effect: TeamDocEffect): Promise<boolean> {
        const files = this.ports.files!;
        const file = fileOf(effect)!;
        const path = file.document.path;
        if ((this.skipThrough.get(path) ?? -1) >= effect.seq) {
            return false;
        }
        const bytes = await bytesOf(files, path, file.op.content);
        if (bytes === "unavailable") {
            this.ports.notify({ kind: "diverged", detail: `${path} could not be brought down from the server` });
            return false;
        }
        const theirs = bytes === null ? null : await files.digest(bytes);
        if (isAssetContentPath(path)) {
            // Named by its digest: one already here is the same file.
            if (bytes !== null && (await files.read(path)) === null) {
                await files.write(path, bytes);
                return true;
            }
            return false;
        }
        const disk = await files.read(path);
        const mine = disk === null ? null : await files.digest(disk);
        const whole = isWholeFilePath(path);
        if (whole) {
            const agreed = this.known.get(path) ?? null;
            if (this.sentFiles.get(path) === (theirs ?? "")) this.sentFiles.delete(path);
            if (mine !== agreed && mine !== theirs && this.sentFiles.get(path) !== mine) {
                this.addConflicts([{ kind: "file", path, mine: disk, reason: "conflict" }]);
            }
            if (theirs === null) this.known.delete(path);
            else this.known.set(path, theirs);
        }
        if (mine === theirs) {
            return false;
        }
        if (bytes === null) await files.remove(path);
        else await files.write(path, bytes);
        return true;
    }

    /**
     * Put one file back as the server has it now, and skip whatever effects that already includes.
     * Effects wait meanwhile, so nothing for the file lands between reading it and writing it.
     */
    private putBack(path: string): Promise<void> {
        const files = this.ports.files;
        if (files === undefined) return Promise.resolve();
        this.fileHolds += 1;
        this.skipThrough.set(path, Number.POSITIVE_INFINITY);
        return this.enqueue(async () => {
            let at: number | undefined;
            try {
                const current = await this.readCurrent(path);
                if (current === null) {
                    this.ports.notify({ kind: "diverged", detail: `${path} could not be read from the server` });
                    return;
                }
                at = current.seq;
                await files.flush();
                const disk = await files.read(path);
                const same = disk !== null && current.bytes !== null
                    ? (await files.digest(disk)) === (await files.digest(current.bytes))
                    : disk === current.bytes;
                if (!same) {
                    if (current.bytes === null) await files.remove(path);
                    else await files.write(path, current.bytes);
                }
                if (isWholeFilePath(path)) {
                    if (current.bytes === null) this.known.delete(path);
                    else this.known.set(path, await files.digest(current.bytes));
                }
                if (!same) await files.reload();
                await this.persist();
            } finally {
                if (at === undefined) this.skipThrough.delete(path);
                else this.skipThrough.set(path, at);
                this.fileHolds -= 1;
                this.drain();
                if (this.pending.size > 0 && this.online && !this.isHeld()) void this.catchUp();
            }
        });
    }

    /** One file as the server holds it now, and the seq that is. Null when it cannot be read. */
    private async readCurrent(path: string): Promise<{ seq: number; bytes: TeamFileBytes } | null> {
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const first = await this.ports.call("doc.file", { path });
            if (!first.ok) return null;
            const seq = readNumber(first.value, "seq") ?? 0;
            if (readBoolean(first.value, "absent") === true) return { seq, bytes: null };
            const digest = readText(first.value, "digest");
            if (digest !== undefined) {
                const transferId = readText(first.value, "transferId");
                const note: TeamFileNote = { path, digest, size: readNumber(first.value, "size") ?? 0, ...(transferId === undefined ? {} : { transferId }) };
                const bytes = await this.noteBytes(note, readText(first.value, "revision") ?? null);
                return bytes === null ? null : { seq, bytes };
            }
            const chunks: Uint8Array[] = [decodeBase64(readText(first.value, "chunk") ?? "")];
            let offset = chunks[0]!.length;
            const size = readNumber(first.value, "size") ?? 0;
            let moved = false;
            while (offset < size) {
                const part = await this.ports.call("doc.file", { path, offset });
                if (!part.ok) return null;
                if (readNumber(part.value, "seq") !== seq) {
                    moved = true;
                    break;
                }
                const bytes = decodeBase64(readText(part.value, "chunk") ?? "");
                if (bytes.length === 0) break;
                chunks.push(bytes);
                offset += bytes.length;
            }
            if (!moved) return { seq, bytes: concat(chunks) };
        }
        return null;
    }

    private addConflicts(conflicts: TeamDocConflict[]): void {
        this.set({ conflicts: [...this.view.conflicts, ...conflicts] });
    }

    /* -------------------------------------------------------------- whole files */

    /** Look for whole files to send, a moment after a write (several writes make one look). */
    private queueScan(): void {
        if (this.scanTimer !== null) return;
        this.scanTimer = setTimeout(() => {
            this.scanTimer = null;
            void this.enqueue(() => this.scanWhole());
        }, SCAN_DELAY_MS);
    }

    /** Send every whole file written here since it was last agreed, each against the seq this window is at. */
    private async scanWhole(): Promise<void> {
        const files = this.ports.files;
        if (files === undefined || !this.online || !this.view.mayEdit || !this.knownLoaded || this.view.state !== "online") {
            return;
        }
        for (const change of await changesSince(files, this.known, "whole")) {
            const digest = change.bytes === null ? "" : await files.digest(change.bytes);
            if (this.sentFiles.get(change.path) === digest) continue;
            const answer = await this.sendFile(change, this.appliedSeq);
            if (answer.kind === "effect") {
                this.sentFiles.set(change.path, digest);
                continue;
            }
            if (answer.reason === "nothing-there") {
                // The server holds exactly this already.
                if (change.bytes === null) this.known.delete(change.path);
                else this.known.set(change.path, digest);
                continue;
            }
            if (answer.reason === "unreachable") {
                return;
            }
            this.addConflicts([{ kind: "file", path: change.path, mine: change.bytes, reason: answer.reason, ...(answer.detail === undefined ? {} : { detail: answer.detail }) }]);
            void this.putBack(change.path);
        }
        await this.persist();
    }

    /** Send one file whole, against `basedOn`. */
    private async sendFile(change: TeamFileChange, basedOn: number): Promise<TeamDocAnswer> {
        const files = this.ports.files;
        if (files === undefined) return { kind: "refusal", reason: "rejected", detail: "files are not kept in step here" };
        const content = await contentFor(files, change.path, change.bytes);
        if (content === "unsendable") {
            return { kind: "refusal", reason: "unsendable", detail: `${change.path} could not be sent` };
        }
        const op: TeamFileOp = { op: "put-file", content };
        return this.send({ doc: "file", path: change.path }, op, undefined, basedOn);
    }

    private apply(effect: TeamDocEffect): void {
        const document = effect.document as LiveDocument | { doc?: unknown } | null;
        if (document === null || typeof document !== "object" || typeof document.doc !== "string" || document.doc === "project") {
            // A restore's own step in the log: it arrives as a reset, not as an effect to apply.
            return;
        }
        if (document.doc === "file") {
            // A window without a disk to keep whole files on: nothing of its own to bring in step.
            return;
        }
        try {
            const path = projectDocumentPath(document as LiveDocument);
            if ((this.skipThrough.get(path) ?? -1) >= effect.seq) {
                // Being put back whole from the server, which already includes this.
                return;
            }
        } catch {
            // An address this window cannot place: apply it as ever.
        }
        try {
            this.ports.documents.apply(document as LiveDocument, effect.op as ProjectOp, effect.derived as LiveDerived | undefined);
        } catch (error) {
            // A document this window holds differently from the server: the honest repair is a
            // fresh start from the last version, which the next connection makes.
            this.ports.notify({ kind: "diverged", detail: error instanceof Error ? error.message : String(error) });
            void this.ports.state.save({ seq: -1 });
        }
    }

    /* -------------------------------------------------------------- sending */

    private readonly handler: TeamDocHandler = (document, op, derived) => {
        if (!this.online || !this.view.mayEdit) {
            return false;
        }
        void this.send(document, op, derived).then(answer => {
            if (answer.kind === "refusal") {
                this.ports.notify({ kind: "refused", reason: answer.reason, ...(answer.detail === undefined ? {} : { detail: answer.detail }) });
            }
        });
        return true;
    };

    private async send(document: LiveDocument | TeamFileDocument, op: ProjectOp, derived?: LiveDerived, basedOn?: number): Promise<TeamDocAnswer> {
        const clientId = `${this.ports.instance}:${Date.now().toString(36)}:${(this.nextClient++).toString(36)}`;
        const answered = await this.ports.call("doc.intent", {
            clientId,
            document,
            op,
            ...(derived === undefined ? {} : { derived }),
            ...(basedOn === undefined ? {} : { basedOn }),
        });
        if (!answered.ok) {
            return { kind: "refusal", reason: "unreachable", detail: answered.problem.detail };
        }
        const kind = readText(answered.value, "kind");
        if (kind === "effect") {
            const effect = readEffect(readRecord(answered.value, "effect"));
            if (effect !== null) {
                this.accept(effect);
            }
            return { kind: "effect" };
        }
        const reason = readText(answered.value, "reason") ?? "refused";
        const detail = readText(answered.value, "detail");
        return { kind: "refusal", reason, ...(detail === undefined ? {} : { detail }) };
    }

    /**
     * What changed in the stories since `base`, as operations: rows and structure by diff, and a
     * story made or removed here as making or removing it.
     */
    private offlineOps(base: TeamDocOfflineBase): Array<{ storyId: StoryId; op: LiveStoryOp | TeamStoryLibraryOp }> {
        const now = this.ports.story.snapshot();
        const ops: Array<{ storyId: StoryId; op: LiveStoryOp | TeamStoryLibraryOp }> = [];
        for (const [storyId, mine] of Object.entries(now)) {
            const was = base.stories[storyId];
            if (was === undefined) {
                const entry = this.ports.story.entry?.(storyId);
                if (entry !== undefined) {
                    ops.push({ storyId, op: { op: "create-story", entry, document: structuredClone(mine) } });
                }
                continue;
            }
            for (const op of storyDiffToOps(was, mine)) {
                ops.push({ storyId, op });
            }
        }
        if (this.ports.story.entry !== undefined) {
            for (const storyId of Object.keys(base.stories)) {
                if (now[storyId] === undefined) ops.push({ storyId, op: { op: "delete-story" } });
            }
        }
        return ops;
    }

    private async persist(): Promise<void> {
        await this.ports.state.save({
            seq: this.appliedSeq,
            ...(this.offlineBase === null ? {} : { offline: this.offlineBase }),
            ...(this.knownLoaded ? { files: Object.fromEntries(this.known) } : {}),
        });
    }

    private set(patch: Partial<TeamDocView>): void {
        this.view = { ...this.view, ...patch };
        for (const listener of this.listeners) {
            listener(this.view);
        }
    }
}

/** What the window shows about following the project. */
export type TeamDocView = {
    state: "starting" | "syncing" | "online" | "offline";
    /** The last seq applied here. */
    seq: number;
    /** Offline edits the server would not take, with what the author had written. */
    conflicts: TeamDocConflict[];
    /** Whether this account's role edits the project. A reviewer follows read-only. */
    mayEdit: boolean;
};

export type TeamDocConflict =
    | {
        kind: "story";
        storyId: StoryId;
        op: LiveStoryOp | TeamStoryLibraryOp;
        reason: string;
        detail?: string;
    }
    | {
        /** A file sent whole that the server would not take; the project holds the server's now. */
        kind: "file";
        path: string;
        /** What the author had: null for a file they removed. */
        mine: TeamFileBytes;
        reason: string;
        detail?: string;
    };

/** A file a listing names without its bytes: held as a note by the server. */
type TeamFileNote = { path: string; digest: string; size: number; transferId?: string };

export type TeamDocEffect = {
    seq: number;
    clientId: string;
    by: string;
    document: unknown;
    op: unknown;
    derived?: unknown;
    at: string;
};

export type TeamDocOfflineBase = {
    seq: number;
    stories: Record<StoryId, StoryDocument>;
    /** Every other file's digest as it was agreed then, by path (asset files: present). */
    files?: Record<string, string>;
};

export type TeamDocState = {
    /** The last seq applied here, or -1 when this window's tree is not known to be at any. */
    seq: number;
    offline?: TeamDocOfflineBase;
    /** What this window and the server last agreed each whole file is: its digest, by path. */
    files?: Record<string, string>;
};

export type TeamDocOutcome<T> = { ok: true; value: T } | { ok: false; problem: { detail: string } };

type TeamDocAnswer = { kind: "effect" } | { kind: "refusal"; reason: string; detail?: string };

export type TeamDocNotice =
    | { kind: "refused"; reason: string; detail?: string }
    | { kind: "version-saved"; revision: string; seq: number; label?: string }
    | { kind: "restored"; revision: string; by?: string }
    | { kind: "diverged"; detail: string };

/** Everything {@link TeamDocSync} needs from the world. */
export type TeamDocPorts = {
    /** This window's instance id, the prefix of every intent id it mints. */
    instance: string;
    /** Call a `doc.*` method on the project's server; the project id is filled in. */
    call(method: string, params: Record<string, unknown>): Promise<TeamDocOutcome<unknown>>;
    /** Follow the project's `doc` topic. */
    listen(onEvent: (payload: unknown) => void): () => void;
    isOnline(): boolean;
    onConnection(listener: (online: boolean) => void): () => void;
    documents: {
        /** Hand every document service's edits to `handler`, or (null) give them back. */
        install(handler: TeamDocHandler | null): void;
        /** Apply one effect to the service that owns its document (not recorded in anybody's undo). */
        apply(document: LiveDocument, op: ProjectOp, derived?: LiveDerived): void;
    };
    story: {
        /** Copies of every story document, loaded. */
        snapshot(): Record<StoryId, StoryDocument>;
        /** Put these documents back as they were. */
        restore(stories: Record<StoryId, StoryDocument>): void;
        /** Replace every story with the files of a saved version (library and documents, by path). */
        adoptFiles(files: ReadonlyMap<string, string>): Promise<void>;
        /** One story's library entry, for sending a story made offline. */
        entry?(storyId: StoryId): StoryLibraryEntry | undefined;
    };
    state: {
        load(): Promise<TeamDocState | null>;
        save(state: TeamDocState): Promise<void>;
    };
    notify(notice: TeamDocNotice): void;
    /** The disk, for files that travel whole. Without it only documents are kept in step. */
    files?: TeamFilePorts;
};

/** A file effect's address and operation, or null for any other effect. */
function fileOf(effect: TeamDocEffect): { document: TeamFileDocument; op: TeamFileOp } | null {
    const document = effect.document as { doc?: unknown; path?: unknown } | null;
    const op = effect.op as { op?: unknown } | null;
    if (document?.doc !== "file" || typeof document.path !== "string" || op?.op !== "put-file") return null;
    return { document: document as TeamFileDocument, op: op as TeamFileOp & { content: TeamFileContent | null } };
}

function readRecord(value: unknown, key?: string): Record<string, unknown> | null {
    const target = key === undefined ? value : (value as Record<string, unknown> | null)?.[key];
    return typeof target === "object" && target !== null && !Array.isArray(target) ? (target as Record<string, unknown>) : null;
}

function readText(value: unknown, key: string): string | undefined {
    const field = readRecord(value)?.[key];
    return typeof field === "string" && field !== "" ? field : undefined;
}

function readNumber(value: unknown, key: string): number | undefined {
    const field = readRecord(value)?.[key];
    return typeof field === "number" && Number.isFinite(field) ? field : undefined;
}

function readBoolean(value: unknown, key: string): boolean | undefined {
    const field = readRecord(value)?.[key];
    return typeof field === "boolean" ? field : undefined;
}

function readEffect(value: unknown): TeamDocEffect | null {
    const from = readRecord(value);
    if (from === null) return null;
    const seq = readNumber(from, "seq");
    const clientId = readText(from, "clientId");
    if (seq === undefined || clientId === undefined || readRecord(from, "op") === null) {
        return null;
    }
    return {
        seq,
        clientId,
        by: readText(from, "by") ?? "",
        document: from["document"],
        op: from["op"],
        ...(from["derived"] === undefined ? {} : { derived: from["derived"] }),
        at: readText(from, "at") ?? "",
    };
}

function readEffects(value: unknown): TeamDocEffect[] {
    const list = readRecord(value)?.["effects"];
    if (!Array.isArray(list)) return [];
    return list.map(readEffect).filter((effect): effect is TeamDocEffect => effect !== null);
}


function concat(chunks: readonly Uint8Array[]): Uint8Array {
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
        out.set(chunk, at);
        at += chunk.length;
    }
    return out;
}
