import type { TranslationKey } from "@shared/i18n";
import type { DocumentCorruptError } from "@shared/documents/types";
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
import { NotificationType } from "../ui/types";
import type { DebouncedSaver, SaveState } from "./DebouncedSaver";

/** The console channel this service writes to. Registered as a built-in by ConsoleService. */
export const STORAGE_CONSOLE_CHANNEL = "storage";

/** The workspace-wide answer to "is my work on disk?". Worst state across every registered saver. */
export type SaveStatus = SaveState;

/** One file that could not be written, and how long that has been true. */
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
    FsRejectErrorCode.UNKNOWN,
]);

function fileNameOf(path: string): string {
    const parts = path.split(/[\\/]/);
    return parts[parts.length - 1] || path;
}

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
    private readonly failures = new Map<string, SaveFailure>();
    /** path → notification id, so one failing file raises one toast rather than one per retry. */
    private readonly toasts = new Map<string, string>();
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
        this.toasts.clear();
        this.corruptToasts.clear();
        this.frozenToast = null;
    }

    public override dispose(): void {
        this.unobserveWrites?.();
        this.unobserveWrites = null;
        this.unobserveFreeze?.();
        this.unobserveFreeze = null;
        this.failures.clear();
        this.toasts.clear();
        this.corruptToasts.clear();
        this.frozenToast = null;
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
     * write observer within the same call, so nothing is hidden - but a one-off failure from a write
     * no saver owns (an export, an asset copy) stops pinning the status bar red forever, which it
     * otherwise would, since only a later successful write to that same path can clear it.
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
     */
    public reportUnreadableDocument(error: DocumentCorruptError, quarantinePath: string | null): void {
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
            return;
        }
        const notifications = this.getNotifications();
        if (!notifications) {
            return;
        }
        const id = notifications.showSticky({
            type: NotificationType.Error,
            message: translate("workspace.shell.save.unreadableTitle", { file: fileNameOf(error.path) }),
            detail: quarantinePath
                ? translate("workspace.shell.save.unreadableDetailQuarantined", {
                    reason: error.reason,
                    path: quarantinePath,
                })
                : translate("workspace.shell.save.unreadableDetail", { reason: error.reason }),
        });
        this.corruptToasts.set(error.path, id);
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

        if (this.frozenToast) {
            return;
        }
        const notifications = this.getNotifications();
        if (!notifications) {
            return;
        }
        this.frozenToast = notifications.showSticky({
            type: NotificationType.Warning,
            message: translate("workspace.shell.save.frozenTitle"),
            detail: refusal.reason.kind === "revision"
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

    private handleWriteOutcome(outcome: FsWriteOutcome): void {
        if (outcome.ok) {
            this.clearFailure(outcome.path);
            return;
        }
        this.recordFailure(outcome.path, outcome.error?.code ?? FsRejectErrorCode.UNKNOWN, outcome.error?.message ?? "");
    }

    private recordFailure(path: string, code: FsRejectErrorCode, message: string): void {
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

        // One sticky toast per path: the backoff will keep retrying, and a toast per attempt would
        // bury the workspace under duplicates of the same sentence.
        if (!this.toasts.has(path)) {
            const notifications = this.getNotifications();
            if (notifications) {
                const id = notifications.showSticky({
                    type: NotificationType.Error,
                    message: translate("workspace.shell.save.failedTitle", { file: fileNameOf(path) }),
                    detail: failure.transient
                        ? translate("workspace.shell.save.failedDetailTransient", { error: message })
                        : translate("workspace.shell.save.failedDetailPermanent", { error: message }),
                    actions: [
                        {
                            label: translate("workspace.shell.save.retry"),
                            onClick: () => {
                                void this.retryNow();
                            },
                        },
                    ],
                });
                this.toasts.set(path, id);
            }
        }

        this.notifyChanged();
    }

    private clearFailure(path: string, options: { announce?: boolean } = {}): void {
        if (!this.failures.delete(path)) {
            return;
        }
        if (options.announce !== false) {
            this.logStorage("success", translate("workspace.shell.save.consoleRecovered", { path }));
        }
        const toastId = this.toasts.get(path);
        if (toastId) {
            this.toasts.delete(path);
            this.getNotifications()?.close(toastId);
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
 * The one line a document service adds to the `corrupt` arm of a load result.
 *
 * Swallows its own failures on purpose: this runs on a load path that has already gone wrong, and
 * the news is the unreadable document, not that the console service was torn down while we were
 * telling somebody about it.
 */
export function reportUnreadableDocument(
    ctx: WorkspaceContext,
    result: { error: DocumentCorruptError; quarantinePath: string | null },
): void {
    try {
        ctx.services.get<SaveStatusService>(Services.SaveStatus)
            .reportUnreadableDocument(result.error, result.quarantinePath);
    } catch (error) {
        console.warn("[SaveStatus] could not report an unreadable document", error);
    }
}
