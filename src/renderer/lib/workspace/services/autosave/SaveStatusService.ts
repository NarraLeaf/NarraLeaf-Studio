import type { InterpolationParams, TranslationKey } from "@shared/i18n";
import type { DocumentCorruptError, DocumentKind } from "@shared/documents/types";
import { FsRejectErrorCode } from "@shared/types/os";
import { translate } from "@/lib/i18n";
import {
    observeProjectWriteFreeze,
    observeRefusedWrites,
    type RefusedWrite,
} from "@/lib/app/writeFreeze";
import { Service } from "../Service";
import { Services, type WorkspaceContext } from "../services";
import { ConsoleService } from "../core/ConsoleService";
import { FileSystemService, type FsWriteOutcome } from "../core/FileSystem";
import { UIService } from "../core/UIService";
import { describeWriteFailureReason } from "../core/writeFailureReason";
import { NotificationType } from "../ui/types";
import type { DebouncedSaver, SaveState } from "./DebouncedSaver";
import type { SavedFileName } from "./writeReport";

type Translate = (key: TranslationKey, params?: InterpolationParams) => string;

/** The console channel this service writes to. Registered as a built-in by ConsoleService. */
export const STORAGE_CONSOLE_CHANNEL = "storage";

/** The workspace-wide answer to "is my work on disk?". Worst state across every registered saver. */
export type SaveStatus = SaveState;

/**
 * One file that could not be written and that a saver is still trying to write, and how long that
 * has been true. Only files some saver retries are held here: this is the set of writes still owed,
 * which is what turns the status bar red and what "Retry now" replays.
 */
export type SaveFailure = {
    path: string;
    code: FsRejectErrorCode;
    message: string;
    /** Timestamp of the first failure in the current streak for this path. */
    since: number;
    attempts: number;
    /**
     * Whether retrying stands a chance without the user changing something first. A full disk or a
     * busy file clears on its own; a path the main process refuses will keep refusing.
     */
    transient: boolean;
};

type RegisteredSaver = {
    id: string;
    labelKey: TranslationKey;
    saver: DebouncedSaver;
    unsubscribe: () => void;
};

/**
 * Codes that describe a condition outside the app which can clear while it stays open: the volume
 * fills up, a lock is released, an IPC round trip is lost during teardown. Everything else is a
 * statement about the path itself and will not be fixed by trying harder - the retry still runs
 * (see {@link DebouncedSaver}), but the user is the one who has to act, so the report says so.
 */
const TRANSIENT_FS_ERROR_CODES: ReadonlySet<FsRejectErrorCode> = new Set([
    FsRejectErrorCode.IO_ERROR,
    FsRejectErrorCode.IPC_ERROR,
    FsRejectErrorCode.NO_SPACE,
    FsRejectErrorCode.UNKNOWN,
]);

/**
 * The notice's title: what could not be saved, by the name the author knows it by.
 *
 * Never the path's last segment. For an asset's content that segment is the tail of the asset's id;
 * for a story it is `storydoc.json`; for everything else it is a file name Studio chose and the
 * author never sees. A write whose writer did not say what it was is titled without naming a file,
 * which is less than it could say and nothing that is untrue.
 */
export function describeSaveFailureTitle(name: SavedFileName | undefined, t: Translate = translate): string {
    if (!name) {
        return t("workspace.shell.save.failedTitleUnnamed");
    }
    return "item" in name
        ? t("workspace.shell.save.failedTitleNamed", { name: name.item })
        : t("workspace.shell.save.failedTitle", { name: t(name.store) });
}

/**
 * The toast's second line: what the disk said when that is something the author can act on, then
 * what becomes of the change - retried in the background, retried in vain until the author fixes
 * something, or not saved and not tried again.
 *
 * `retried` is the writer's answer (see `WriteFailureFollowUp`), never a guess from the error. The
 * notice used to say every failed write was still being retried, and for a file no saver writes - an
 * asset folder list, a panel layout - nothing was.
 *
 * Never the error's own message. That is the system's, in English whatever the interface speaks; it
 * names the scratch file an atomic write renames from rather than the file in the title; and before
 * the protocol handler passed the filesystem's code through, it was the one-use grant URL the write
 * had gone to. The console line keeps it in full.
 */
export function describeSaveFailureDetail(
    failure: Pick<SaveFailure, "code" | "transient"> & { retried: boolean },
    t: Translate = translate,
): string {
    const retry = t(!failure.retried
        ? "workspace.shell.save.failedDetailNotSaved"
        : failure.transient
            ? "workspace.shell.save.failedDetailTransient"
            : "workspace.shell.save.failedDetailPermanent");
    const reason = describeWriteFailureReason(failure, t);
    return reason ? t("workspace.shell.save.failedDetailWithReason", { reason, retry }) : retry;
}

/**
 * The store each document kind belongs to, for the notice that says one could not be read.
 *
 * A `Record` over the whole union, so a new document kind fails to compile here instead of reaching
 * the author as its file name.
 */
const UNREADABLE_DOCUMENT_STORE: Record<DocumentKind, TranslationKey> = {
    project: "workspace.shell.save.stores.project",
    "story-index": "workspace.shell.save.stores.story",
    story: "workspace.shell.save.stores.story",
    "story-animation-index": "workspace.shell.save.stores.story",
    "story-animation": "workspace.shell.save.stores.story",
    "ui-document": "workspace.shell.save.stores.uiDocument",
    "ui-graphs": "workspace.shell.save.stores.uiGraph",
    variables: "workspace.shell.save.stores.variables",
    "audio-tracks": "workspace.shell.save.stores.audioTracks",
    brand: "workspace.shell.save.stores.brand",
    "app-tags": "workspace.shell.save.stores.appTags",
    dlc: "workspace.shell.save.stores.dlc",
    dictionary: "workspace.shell.save.stores.dictionary",
    "transform-presets": "workspace.shell.save.stores.transformPresets",
    "save-schema": "workspace.shell.save.stores.saveSchema",
    "asset-sets": "workspace.shell.save.stores.assetSets",
    localization: "workspace.shell.save.stores.localization",
    "localization-keys": "workspace.shell.save.stores.localization",
    voice: "workspace.shell.save.stores.voice",
    "assets-metadata": "workspace.shell.save.stores.assets",
    "assets-groups": "workspace.shell.save.stores.assets",
    characters: "workspace.shell.save.stores.characters",
};

/** The title of the notice for a document that is on disk and could not be understood. */
export function describeUnreadableDocumentTitle(kind: DocumentKind, t: Translate = translate): string {
    return t("workspace.shell.save.unreadableTitle", { name: t(UNREADABLE_DOCUMENT_STORE[kind]) });
}

/**
 * The second line of that notice: what is wrong with the file, as something the author can act on,
 * then that it was left as it was.
 *
 * Never the error's `reason`. That is the parser's English (`not valid JSON: Unexpected token } in
 * JSON at position 41273`), and the console line keeps it. Never the quarantine copy's path either:
 * it is a folder Studio made, named by a timestamp and - for a story - by the story's id. The copy is
 * said to exist, and the console line says where.
 */
export function describeUnreadableDocumentDetail(
    error: Pick<DocumentCorruptError, "defect">,
    quarantined: boolean,
    t: Translate = translate,
): string {
    const reason = t(error.defect === "newerVersion"
        ? "workspace.shell.save.unreadableReason.newerVersion"
        : "workspace.shell.save.unreadableReason.damaged");
    return t(quarantined
        ? "workspace.shell.save.unreadableDetailQuarantined"
        : "workspace.shell.save.unreadableDetail", { reason });
}

/**
 * One sticky notice about files that could not be written, and every path it currently speaks for.
 *
 * Keyed by what the notice says rather than by path, because one change can fail on several files
 * that the author knows as one thing: a new asset folder is written to the folder list and to the
 * row order beside it, and both are "the asset library". Two notices with the same title would read
 * as the same failure reported twice.
 */
type FailureNotice = {
    id: string;
    paths: Set<string>;
};

/**
 * The single answer to "did my work reach the disk?".
 *
 * Two signals feed it, because neither is sufficient alone:
 *
 *  - **Registered savers** ({@link register}) report `dirty | saving | failed | clean`. They know a
 *    write is *owed*, which no filesystem observation can tell you.
 *  - **Write outcomes** ({@link FileSystemService.observeWrites}) report which *path* failed. A
 *    saver only knows that its `save()` rejected, and its error text is not always the file name.
 *
 * Before this existed, a rejected auto-save reached a `console.warn` in a devtools window nobody had
 * open, and the asset-metadata writer did not even do that - it dropped the `FsRequestResult` on the
 * floor. The user's first sign of trouble was missing work.
 */
export class SaveStatusService extends Service<SaveStatusService> {
    private readonly savers = new Map<string, RegisteredSaver>();
    /** Open editors holding words the documents have not been told about. See {@link registerPendingEdit}. */
    private readonly pendingEdits = new Set<() => void>();
    private readonly failures = new Map<string, SaveFailure>();
    /**
     * Sticky notices for failed writes, by what they say. One failing file raises one notice rather
     * than one per retry, and files the author knows as one thing share it. See {@link FailureNotice}.
     */
    private readonly notices = new Map<string, FailureNotice>();
    /** path → notification id for documents that could not be *read*. See {@link reportUnreadableDocument}. */
    private readonly corruptToasts = new Map<string, string>();
    private readonly listeners = new Set<() => void>();
    private unobserveWrites: (() => void) | null = null;
    private unobserveFreeze: (() => void) | null = null;
    /** The sticky notice for the current frozen stretch, if one has been raised. */
    private frozenToast: string | null = null;

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const filesystemService = ctx.services.get<FileSystemService>(Services.FileSystem);
        await depend([filesystemService]);

        // A project switch re-runs init on the same singleton; the previous subscription would
        // otherwise keep reporting into a workspace that is gone.
        this.unobserveWrites?.();
        this.unobserveWrites = filesystemService.observeWrites(outcome => this.handleWriteOutcome(outcome));

        // Subscribed straight to the latch rather than through WorkspaceFreezeService, which depends
        // on this service to flush before it freezes: routing the report back through it would close
        // that loop and the service graph rejects a cycle outright.
        this.unobserveFreeze?.();
        const unobserveRefusals = observeRefusedWrites(refusal => this.handleRefusedWrite(refusal));
        const unobserveState = observeProjectWriteFreeze(freeze => {
            if (!freeze) {
                this.clearFrozenNotice();
            }
        });
        this.unobserveFreeze = () => {
            unobserveRefusals();
            unobserveState();
        };

        this.failures.clear();
        this.notices.clear();
        this.corruptToasts.clear();
        this.frozenToast = null;
    }

    public override dispose(): void {
        this.unobserveWrites?.();
        this.unobserveWrites = null;
        this.unobserveFreeze?.();
        this.unobserveFreeze = null;
        this.failures.clear();
        this.notices.clear();
        this.corruptToasts.clear();
        this.frozenToast = null;
        this.pendingEdits.clear();
        this.notifyChanged();
    }

    /**
     * Register a document service's auto-saver so its state reaches the status bar, and so the
     * shutdown flush can reach its pending write.
     *
     * Idempotent by id: services are singletons that outlive a project switch and re-register on
     * every init, and re-registering must not accumulate subscriptions.
     */
    public register(id: string, labelKey: TranslationKey, saver: DebouncedSaver): void {
        this.savers.get(id)?.unsubscribe();
        const unsubscribe = saver.onStateChanged(() => this.notifyChanged());
        this.savers.set(id, { id, labelKey, saver, unsubscribe });
        this.notifyChanged();
    }

    /** Every registered saver, for callers that need to flush them one at a time. */
    public listSavers(): readonly { id: string; labelKey: TranslationKey; saver: DebouncedSaver }[] {
        return [...this.savers.values()].map(({ id, labelKey, saver }) => ({ id, labelKey, saver }));
    }

    /**
     * Register an editor that is holding an edit no document service has been told about yet.
     *
     * A saver can only write what its service already has. An editor with a field open is the one
     * place where that is not the whole truth: the words are in the field, on their way to the
     * document but not there yet, and a flush that only asked the savers would write everything
     * except the line the author is in the middle of. `settle` moves them into the document; the
     * saver that owns the document then has something to flush, which is why this runs first.
     *
     * Returns the deregistration, to be called when the editor closes.
     */
    public registerPendingEdit(settle: () => void): () => void {
        this.pendingEdits.add(settle);
        return () => {
            this.pendingEdits.delete(settle);
        };
    }

    /**
     * Move every open editor's held edit into its document. Synchronous, and safe to call when
     * there is nothing to move - a settle with no change writes nothing.
     *
     * One editor that throws must not stop the others, and must not be the reason a window refuses
     * to close: the failure is reported and the flush carries on with what it can still save.
     */
    public settlePendingEdits(): void {
        for (const settle of [...this.pendingEdits]) {
            try {
                settle();
            } catch (error) {
                this.logStorage("error", translate("workspace.shell.save.flushFailed", {
                    label: translate("workspace.shell.save.stores.openEditors"),
                    error: String((error as Error)?.message ?? error),
                }));
            }
        }
    }

    /** Worst state across every registered saver, with any write failure taking precedence. */
    public getStatus(): SaveStatus {
        if (this.failures.size > 0) {
            return "failed";
        }
        let status: SaveStatus = "clean";
        for (const { saver } of this.savers.values()) {
            const state = saver.getState();
            if (state === "failed") {
                return "failed";
            }
            if (state === "saving") {
                status = "saving";
            } else if (state === "dirty" && status === "clean") {
                status = "dirty";
            }
        }
        return status;
    }

    /** Files that could not be written, newest streak first. */
    public getFailures(): readonly SaveFailure[] {
        return [...this.failures.values()].sort((a, b) => b.since - a.since);
    }

    public onChanged(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /**
     * Write out everything that is owed, and wait for all of it.
     *
     * Never short-circuits: one service whose write rejects must not stop the other five from
     * reaching the disk, so failures are collected rather than thrown.
     */
    public async flushAll(): Promise<void> {
        const entries = [...this.savers.values()];
        const results = await Promise.allSettled(entries.map(entry => entry.saver.flush()));
        for (const [index, result] of results.entries()) {
            if (result.status === "rejected") {
                this.logStorage("error", translate("workspace.shell.save.flushFailed", {
                    label: translate(entries[index].labelKey),
                    error: String((result.reason as Error)?.message ?? result.reason),
                }));
            }
        }
    }

    /**
     * Make every registered saver forget what it owes, and drop the "could not read this document"
     * notices. Called by `WorkspaceReloadService` before it re-reads the working tree.
     *
     * Both halves are statements about bytes that are about to be read again:
     *
     *  - A pending write is owed on memory the reload is about to replace. `flushAll` here would be
     *    the defect this whole mechanism exists to fix, one function earlier - see
     *    {@link DebouncedSaver.abandon}.
     *  - An "unreadable" toast names a file we are about to re-read. If it is still corrupt the load
     *    path raises it again within the same call, so nothing is hidden; if it is not, the author
     *    stops being warned about a file that is now fine.
     *
     * The write-failure table is deliberately left alone: those are paths the disk itself rejected,
     * which a reload says nothing about, and only a later successful write to the same path is
     * evidence they recovered.
     */
    public async prepareForReload(): Promise<void> {
        await Promise.allSettled([...this.savers.values()].map(entry => entry.saver.abandon()));
        for (const [path, id] of [...this.corruptToasts]) {
            this.corruptToasts.delete(path);
            this.getNotifications()?.close(id);
        }
        this.notifyChanged();
    }

    /**
     * Retry now instead of waiting out the backoff. Safe to call when nothing is owed.
     *
     * Clears the failure table first, then writes. Anything still broken is re-reported by the
     * write observer within the same call, so nothing is hidden. Only files a saver retries are in
     * that table - a write nothing retries never turns the status bar red, since nothing is owed and
     * this could not replay it.
     */
    public async retryNow(): Promise<void> {
        for (const path of [...this.failures.keys()]) {
            this.clearFailure(path, { announce: false });
        }
        await this.flushAll();
    }

    /**
     * Report a document that could be read off the disk but not understood.
     *
     * This is the read-side counterpart of a failed write, and it goes out on the same two channels
     * for the same reason: before they existed, a document service that could not parse its file
     * reached a `console.warn` in a devtools window nobody had open, and the author's first sign of
     * trouble was an empty panel.
     *
     * Deliberately NOT recorded in {@link failures}. That table is the set of writes still owed, it
     * drives the status bar and {@link retryNow} clears it - none of which is true here. A file we
     * cannot parse will not become parseable because we tried again, and the one thing that must
     * not happen is the service treating it as "clean" and writing a default over it.
     *
     * Answers whether a notice went up just now, so that a service throwing the failure on to whoever
     * asked can mark it as already said (see `markReportedToAuthor`). False when this document's
     * notice is already up - the asker is then the one to say it - or when there is no interface.
     */
    public reportUnreadableDocument(error: DocumentCorruptError, quarantinePath: string | null): boolean {
        this.logStorage("error", translate("workspace.shell.save.consoleUnreadable", {
            kind: error.kind,
            path: error.path,
            reason: error.reason,
        }));
        if (quarantinePath) {
            this.logStorage("error", translate("workspace.shell.save.consoleQuarantined", { path: quarantinePath }));
        }

        // One toast per document: loading is retried on every project switch and on every panel that
        // opens the same locale, and a toast per attempt would bury the workspace in duplicates.
        if (this.corruptToasts.has(error.path)) {
            return false;
        }
        const notifications = this.getNotifications();
        if (!notifications) {
            return false;
        }
        const id = notifications.showSticky({
            type: NotificationType.Error,
            message: describeUnreadableDocumentTitle(error.kind),
            detail: describeUnreadableDocumentDetail(error, quarantinePath !== null),
        });
        this.corruptToasts.set(error.path, id);
        return true;
    }

    /**
     * Report a write the freeze latch refused.
     *
     * Deliberately NOT recorded in {@link failures}, for the same reason an unreadable document is
     * not: that table is the set of writes still owed, it turns the status bar red and
     * {@link retryNow} replays it. A refused write is owed to nobody - it was aimed at a project the
     * author is only looking at - and replaying it later is the exact accident this gate exists to
     * prevent.
     *
     * One notice for the whole frozen stretch rather than one per path: a single refused save can be
     * several refusals (the parent directory, then the file), and an import of fifty assets would
     * otherwise bury the workspace. The console keeps the per-path record - it is editor state, so
     * it goes on working while frozen.
     */
    private handleRefusedWrite(refusal: RefusedWrite): void {
        this.logStorage("error", translate("workspace.shell.save.consoleFrozen", {
            path: refusal.path,
            reason: refusal.reason.kind,
        }));

        // Recovery mode is read-only by construction and says so on its own banner, so a refusal
        // there is the design working rather than news. It still gets the console line above - the
        // per-path record is exactly what a recovery session is for - but a sticky toast repeating
        // "not saved" over a shell whose whole purpose is not saving would be noise the author
        // cannot act on.
        if (refusal.reason.kind === "recovery") {
            return;
        }
        // A project another Studio has taken over is said once, by the screen that replaces the
        // editor, and there is no editor left under it to go on producing saves. A toast about a
        // save that "did not happen" would repeat that screen in a smaller voice, and is the
        // mechanism for freezes the author entered and can leave - neither of which is true here.
        if (refusal.reason.kind === "taken-over") {
            return;
        }

        if (this.frozenToast) {
            return;
        }
        const notifications = this.getNotifications();
        if (!notifications) {
            return;
        }
        // A live session is the one freeze that is partial, and both of the usual sentences are
        // false under it: the story the session is about IS being saved, and there is no "unfreeze"
        // - the way out is leaving the session. Told the usual way, an author who had just watched a
        // line of dialogue save would be informed that nothing is being saved, which is alarming and
        // wrong in the direction that makes people stop working.
        const session = refusal.reason.kind === "live-session";
        this.frozenToast = notifications.showSticky({
            type: NotificationType.Warning,
            message: translate(session
                ? "workspace.shell.save.frozenTitleSession"
                : "workspace.shell.save.frozenTitle"),
            detail: session
                ? translate("workspace.shell.save.frozenDetailSession")
                : refusal.reason.kind === "revision"
                    ? translate("workspace.shell.save.frozenDetailRevision", {
                        version: refusal.reason.label ?? refusal.reason.revision,
                    })
                    // A merge gets its own sentence rather than the manual one, because the remedy is
                    // opposite: there is nothing to "unfreeze" - the way out is finishing the merge,
                    // and an author told to unfreeze would look for a control that is not there.
                    : refusal.reason.kind === "merge"
                        ? translate("workspace.shell.save.frozenDetailMerge")
                        : translate("workspace.shell.save.frozenDetailManual"),
        });
    }

    private clearFrozenNotice(): void {
        const toastId = this.frozenToast;
        this.frozenToast = null;
        if (toastId) {
            this.getNotifications()?.close(toastId);
        }
    }

    /**
     * Report one write's outcome the way its writer said a failure would go (see
     * `WriteFailureFollowUp`). A write whose writer said nothing is treated as one nothing retries:
     * that is true of any failed write the moment it fails, where "still retrying" is only true of
     * the ones a saver owns.
     */
    private handleWriteOutcome(outcome: FsWriteOutcome): void {
        if (outcome.ok) {
            this.clearFailure(outcome.path);
            return;
        }
        const code = outcome.error?.code ?? FsRejectErrorCode.UNKNOWN;
        const message = outcome.error?.message ?? "";
        const followUp = outcome.report?.afterFailure ?? "notRetried";
        if (followUp === "retried") {
            this.recordFailure(outcome.path, code, message, outcome.report?.name);
            return;
        }
        this.logStorage("error", translate("workspace.shell.save.consoleFailedNotRetried", {
            path: outcome.path,
            code,
            error: message,
        }));
        if (followUp === "notRetried") {
            // Not in `failures`: nothing is owed and nothing will write the file again, so the
            // status bar has no save to wait for and "Retry now" nothing to replay.
            this.raiseNotice(outcome.path, outcome.report?.name, {
                code,
                transient: TRANSIENT_FS_ERROR_CODES.has(code),
                retried: false,
            });
        }
    }

    private recordFailure(path: string, code: FsRejectErrorCode, message: string, name: SavedFileName | undefined): void {
        const existing = this.failures.get(path);
        const failure: SaveFailure = {
            path,
            code,
            message,
            since: existing?.since ?? Date.now(),
            attempts: (existing?.attempts ?? 0) + 1,
            transient: TRANSIENT_FS_ERROR_CODES.has(code),
        };
        this.failures.set(path, failure);

        this.logStorage("error", translate("workspace.shell.save.consoleFailed", {
            path,
            code,
            error: message,
            attempt: String(failure.attempts),
        }));

        this.raiseNotice(path, name, { code, transient: failure.transient, retried: true });
        this.notifyChanged();
    }

    /**
     * Put up the sticky notice for a failed write, or add the path to the one already saying the
     * same thing: the backoff keeps retrying, and a toast per attempt - or per file of one change -
     * would bury the workspace under duplicates of the same sentence.
     */
    private raiseNotice(
        path: string,
        name: SavedFileName | undefined,
        detail: { code: FsRejectErrorCode; transient: boolean; retried: boolean },
    ): void {
        const title = describeSaveFailureTitle(name);
        // A notice that offers a retry and one that says nothing will be retried are two different
        // statements even under one title, so they are never merged.
        const key = `${detail.retried ? "retried" : "notRetried"}|${title}`;
        const existing = this.notices.get(key);
        if (existing) {
            existing.paths.add(path);
            return;
        }
        const notifications = this.getNotifications();
        if (!notifications) {
            return;
        }
        const id = notifications.showSticky({
            type: NotificationType.Error,
            message: title,
            detail: describeSaveFailureDetail(detail),
            // Only where something will write the file again. For a write nothing retries, the
            // button would flush every saver, none of which writes this file.
            actions: detail.retried
                ? [
                    {
                        label: translate("workspace.shell.save.retry"),
                        onClick: () => {
                            void this.retryNow();
                        },
                    },
                ]
                : undefined,
        });
        this.notices.set(key, { id, paths: new Set([path]) });
    }

    /**
     * A write to `path` landed, or a retry is about to try it again: it is no longer owed, and a
     * notice that spoke only for it comes down. A notice still speaking for another file stays up.
     */
    private clearFailure(path: string, options: { announce?: boolean } = {}): void {
        const owed = this.failures.delete(path);
        let noticed = false;
        for (const [key, notice] of [...this.notices]) {
            if (!notice.paths.delete(path)) {
                continue;
            }
            noticed = true;
            if (notice.paths.size === 0) {
                this.notices.delete(key);
                this.getNotifications()?.close(notice.id);
            }
        }
        if (!owed && !noticed) {
            return;
        }
        if (options.announce !== false) {
            this.logStorage("success", translate("workspace.shell.save.consoleRecovered", { path }));
        }
        this.notifyChanged();
    }

    private logStorage(level: "error" | "success", message: string): void {
        try {
            this.getContext().services.get<ConsoleService>(Services.Console).log(STORAGE_CONSOLE_CHANNEL, level, message, {
                source: "Storage",
            });
        } catch {
            // Reporting a failed write must never itself throw - during teardown the console
            // service can already be gone, and the write failure is the news, not this.
        }
    }

    private getNotifications(): UIService["notifications"] | null {
        try {
            return this.getContext().services.get<UIService>(Services.UI).notifications;
        } catch {
            return null;
        }
    }

    private notifyChanged(): void {
        for (const listener of this.listeners) {
            listener();
        }
    }
}

/**
 * The one line a document service adds to its `init` to become visible to the status bar and to the
 * shutdown flush. Idempotent, so a project switch re-running `init` is harmless.
 */
export async function registerAutoSaver(
    ctx: WorkspaceContext,
    depend: (services: Service[]) => Promise<void>,
    id: string,
    labelKey: TranslationKey,
    saver: DebouncedSaver,
): Promise<void> {
    const saveStatus = ctx.services.get<SaveStatusService>(Services.SaveStatus);
    await depend([saveStatus]);
    saveStatus.register(id, labelKey, saver);
}

/**
 * The one line a document service adds to the `corrupt` arm of a load result. Answers whether a
 * notice went up just now; see {@link SaveStatusService.reportUnreadableDocument}.
 *
 * Swallows its own failures on purpose: this runs on a load path that has already gone wrong, and
 * the news is the unreadable document, not that the console service was torn down while we were
 * telling somebody about it.
 */
export function reportUnreadableDocument(
    ctx: WorkspaceContext,
    result: { error: DocumentCorruptError; quarantinePath: string | null },
): boolean {
    try {
        return ctx.services.get<SaveStatusService>(Services.SaveStatus)
            .reportUnreadableDocument(result.error, result.quarantinePath);
    } catch (error) {
        console.warn("[SaveStatus] could not report an unreadable document", error);
        return false;
    }
}
