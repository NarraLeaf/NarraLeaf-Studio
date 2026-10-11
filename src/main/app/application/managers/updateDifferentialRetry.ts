/**
 * Keeps an incremental update incremental when the connection is unreliable.
 *
 * electron-updater downloads an update as the handful of blocks that changed (about 15 MB against
 * the installer it is diffed with, which is over 300 MB). Its `differentialDownloadInstaller`
 * catches every failure on the way and answers "download the whole installer instead" - so one
 * 502 from a mirror or a proxy, on either blockmap or on any one of the ranges, turns a 15 MB
 * update into a 330 MB one. On a connection that drops requests every few minutes, that is every
 * update: the full download is twenty times longer and fails the same way.
 *
 * So the method is wrapped. A failure that says the network did not answer is retried as an
 * incremental download, after a pause; when the pauses run out the download fails, and the user
 * presses Download again rather than watching a full installer start. A failure that says the
 * incremental data cannot be used - the installer it diffs against is missing or differs, a range
 * came back wrong - still falls back to the full installer at once, which is the only way such an
 * update can succeed.
 *
 * The method swallows the error it falls back on, so the reason is read from the one line it logs
 * on the way out (`observe`). A line this module does not recognise is treated as "cannot be
 * used", which is electron-updater's own behaviour: a change in its wording costs the retries,
 * never the update.
 */

/** How electron-updater 6.x opens the line it logs when it gives up on an incremental download. */
export const DIFFERENTIAL_FALLBACK_LOG_PREFIX = "Cannot download differentially, fallback to full download:";

/**
 * Pauses between incremental attempts. A proxy that answers 502 tends to do it for a minute or so
 * at a time, so the later pauses are long enough to wait one of those out.
 */
export const DIFFERENTIAL_RETRY_DELAYS_MS: readonly number[] = [3_000, 10_000, 30_000, 60_000];

/**
 * Why an incremental download gave up.
 *
 * - `network`: the request failed or the server answered with a temporary error. Retried, and
 *   never a reason to download the full installer.
 * - `unreadable`: a blockmap arrived but could not be read - typically a page a proxy substituted
 *   for the file. Retried, since a second request often gets the real file; if it never does,
 *   the full installer is the remaining way.
 * - `unusable`: anything else. The incremental data does not fit this installation, so the full
 *   installer is downloaded at once.
 */
export type DifferentialFailureKind = "network" | "unreadable" | "unusable";

const NETWORK_FAILURES: readonly RegExp[] = [
    // Range requests: builder-util-runtime's HttpError. Blockmaps: "Cannot download …, status 502".
    /HttpError: (?:5\d\d|408|429)\b/,
    /\bstatus (?:5\d\d|408|429)\b/,
    // Chromium's net stack, which electron-updater uses through `net.request`.
    /\bnet::ERR_[A-Z0-9_]+/,
    /\b(?:ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND|ENETUNREACH|EHOSTUNREACH)\b/,
    /socket hang up/i,
    /response has been aborted by the server/,
];

const UNREADABLE_FAILURES: readonly RegExp[] = [
    /Cannot parse blockmap/,
    /Blockmap ".*" is empty/,
];

export function classifyDifferentialFailure(reason: string): DifferentialFailureKind {
    if (NETWORK_FAILURES.some(pattern => pattern.test(reason))) {
        return "network";
    }
    if (UNREADABLE_FAILURES.some(pattern => pattern.test(reason))) {
        return "unreadable";
    }
    return "unusable";
}

/**
 * The few words of a failure worth showing: `HTTP 502`, `net::ERR_NETWORK_CHANGED`, `ECONNRESET`.
 * The full text carries a stack and, for a blockmap, a signed URL several hundred characters long.
 */
export function summarizeDifferentialFailure(reason: string): string {
    const status = /HttpError: (\d{3})\b/.exec(reason) ?? /\bstatus (\d{3})\b/.exec(reason);
    if (status) {
        return `HTTP ${status[1]}`;
    }
    const chromium = /\bnet::ERR_[A-Z0-9_]+/.exec(reason);
    if (chromium) {
        return chromium[0];
    }
    const code = /\bE[A-Z_]{3,}\b/.exec(reason);
    if (code) {
        return code[0];
    }
    const firstLine = reason.split("\n", 1)[0].trim();
    return firstLine.length > 120 ? `${firstLine.slice(0, 119)}…` : firstLine;
}

export interface DifferentialRetryOptions {
    log(message: string): void;
    /** The error a download fails with once the network has failed on every attempt. */
    networkError(summary: string): Error;
    delays?: readonly number[];
    /** Waits `ms`, or less once `cancelled` turns true. */
    sleep?(ms: number, cancelled: () => boolean): Promise<void>;
}

type DifferentialDownload = (...args: unknown[]) => Promise<boolean>;

export class DifferentialRetry {
    private lastFailure: string | null = null;

    constructor(private readonly options: DifferentialRetryOptions) {}

    /** Every line the updater logs as an error; keeps the one that says why an attempt gave up. */
    public observe(message: unknown): void {
        if (typeof message === "string" && message.startsWith(DIFFERENTIAL_FALLBACK_LOG_PREFIX)) {
            this.lastFailure = message.slice(DIFFERENTIAL_FALLBACK_LOG_PREFIX.length).trim();
        }
    }

    /**
     * Replace the updater's `differentialDownloadInstaller` with one that retries.
     *
     * The method is protected in electron-updater's typings and called through `this` by
     * `NsisUpdater.doDownloadUpdate`, so an own property on the instance is what that call finds.
     * Returns false when there is no such method - a later electron-updater that renamed it still
     * updates, only without the retries.
     */
    public install(updater: object): boolean {
        const target = updater as { differentialDownloadInstaller?: unknown };
        const original = target.differentialDownloadInstaller;
        if (typeof original !== "function") {
            return false;
        }
        const download = original as DifferentialDownload;
        target.differentialDownloadInstaller = (...args: unknown[]) => this.run(
            () => download.apply(updater, args),
            () => isCancelled(args[1]),
        );
        return true;
    }

    /**
     * One incremental download, attempted until it succeeds or a reason to stop comes up.
     * Resolves to what the wrapped method returns: true means "download the full installer".
     */
    public async run(attempt: () => Promise<boolean>, cancelled: () => boolean = () => false): Promise<boolean> {
        const delays = this.options.delays ?? DIFFERENTIAL_RETRY_DELAYS_MS;
        const sleep = this.options.sleep ?? defaultSleep;
        for (let retry = 0; ; retry += 1) {
            this.lastFailure = null;
            const needsFullDownload = await attempt();
            if (!needsFullDownload) {
                return false;
            }
            const reason = this.lastFailure;
            // No logged reason is the updater declining to try at all, not a failure.
            if (reason === null || cancelled()) {
                return true;
            }
            const kind = classifyDifferentialFailure(reason);
            if (kind === "unusable") {
                return true;
            }
            const summary = summarizeDifferentialFailure(reason);
            if (retry >= delays.length) {
                if (kind === "network") {
                    this.options.log(`Incremental download failed ${retry + 1} times (${summary}); not falling back to the full installer.`);
                    throw this.options.networkError(summary);
                }
                this.options.log(`Blockmap still unreadable after ${retry + 1} attempts (${summary}); downloading the full installer.`);
                return true;
            }
            const delay = delays[retry];
            this.options.log(`Incremental download failed (${summary}); trying it again in ${Math.round(delay / 1000)} s.`);
            await sleep(delay, cancelled);
            if (cancelled()) {
                return true;
            }
        }
    }
}

function isCancelled(downloadUpdateOptions: unknown): boolean {
    const token = (downloadUpdateOptions as { cancellationToken?: { cancelled?: unknown } } | null)?.cancellationToken;
    return token?.cancelled === true;
}

/**
 * Waits in short steps so a cancelled download stops waiting within a quarter of a second. Until it
 * does, electron-updater still holds the download as in progress, and a Download pressed meanwhile
 * would be handed the cancelled one.
 */
async function defaultSleep(ms: number, cancelled: () => boolean): Promise<void> {
    const end = Date.now() + ms;
    while (!cancelled() && Date.now() < end) {
        await new Promise(resolve => setTimeout(resolve, Math.min(250, end - Date.now())));
    }
}
