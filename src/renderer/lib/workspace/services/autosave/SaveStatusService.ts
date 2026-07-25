import type { TranslationKey } from "@shared/i18n";
import { FsRejectErrorCode } from "@shared/types/os";
import { translate } from "@/lib/i18n";
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
    private readonly listeners = new Set<() => void>();
    private unobserveWrites: (() => void) | null = null;

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const filesystemService = ctx.services.get<FileSystemService>(Services.FileSystem);
        await depend([filesystemService]);

        // A project switch re-runs init on the same singleton; the previous subscription would
        // otherwise keep reporting into a workspace that is gone.
        this.unobserveWrites?.();
        this.unobserveWrites = filesystemService.observeWrites(outcome => this.handleWriteOutcome(outcome));
        this.failures.clear();
        this.toasts.clear();
    }

    public override dispose(): void {
        this.unobserveWrites?.();
        this.unobserveWrites = null;
        this.failures.clear();
        this.toasts.clear();
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
