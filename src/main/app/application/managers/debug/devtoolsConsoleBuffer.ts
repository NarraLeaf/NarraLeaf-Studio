/**
 * In-process capture of every window's Chrome DevTools console feed.
 *
 * Dev-only. The main process listens to each window's `console-message` event
 * (see {@link StudioDebugServer}) and funnels the entries here, so an agent or
 * script can pull a window's console output over HTTP without attaching a CDP
 * client and without missing the logs that fired before it connected.
 *
 * We deliberately use `webContents.on("console-message")` rather than
 * `webContents.debugger` + `Runtime.consoleAPICalled`: the debugger is a
 * single-client channel that conflicts with the `--cdp` remote-debugging port
 * (the normal `yarn dev` launch) and with a hand-opened DevTools window. The
 * event feed has neither limitation and captures the same lines DevTools shows.
 */

/** Severities as Electron reports them on the `console-message` event. */
export type DevtoolsConsoleLevel = "debug" | "info" | "warning" | "error";

const LEVEL_RANK: Record<DevtoolsConsoleLevel, number> = {
    debug: 0,
    info: 1,
    warning: 2,
    error: 3,
};

export interface DevtoolsConsoleEntry {
    /** Process-wide monotonic id; usable as a cursor for tailing (`afterSeq`). */
    seq: number;
    /** ms epoch when the line was captured. */
    timestamp: number;
    /** webContents id of the originating window. */
    windowId: number;
    /** Window type ("workspace", "dev-mode", …) recorded at capture time. */
    windowType: string;
    level: DevtoolsConsoleLevel;
    message: string;
    /** Source URL of the log site, when Chromium provides one. */
    source?: string;
    /** 1-based line in {@link source}. */
    line?: number;
}

export interface DevtoolsWindowInfo {
    windowId: number;
    windowType: string;
    title: string;
    closed: boolean;
    entryCount: number;
}

export interface DevtoolsConsoleQuery {
    /** Match window by type/title substring or exact webContents id. Omit for all windows. */
    window?: string;
    /** Minimum severity; e.g. "warning" returns warnings and errors. */
    level?: DevtoolsConsoleLevel;
    /** Only entries strictly newer than this ms-epoch timestamp. */
    since?: number;
    /** Only entries with `seq` strictly greater than this (polling cursor). */
    afterSeq?: number;
    /** Keep at most this many entries, taking the most recent. Default 200. */
    limit?: number;
}

export interface DevtoolsConsoleQueryResult {
    entries: DevtoolsConsoleEntry[];
    /** Highest `seq` currently buffered; pass back as `afterSeq` to tail. */
    latestSeq: number;
    windows: DevtoolsWindowInfo[];
}

interface WindowBucket {
    windowId: number;
    windowType: string;
    title: string;
    closed: boolean;
    entries: DevtoolsConsoleEntry[];
}

const DEFAULT_MAX_PER_WINDOW = 2000;
const DEFAULT_MAX_WINDOWS = 12;
const DEFAULT_QUERY_LIMIT = 200;

export class DevtoolsConsoleBuffer {
    private readonly buckets = new Map<number, WindowBucket>();
    /** webContents ids in first-seen order, oldest first, for eviction. */
    private readonly order: number[] = [];
    private seq = 0;

    constructor(
        private readonly maxPerWindow: number = DEFAULT_MAX_PER_WINDOW,
        private readonly maxWindows: number = DEFAULT_MAX_WINDOWS,
    ) {}

    /** Begin (or refresh) tracking a window. Safe to call more than once. */
    public track(windowId: number, windowType: string, title: string): void {
        const existing = this.buckets.get(windowId);
        if (existing) {
            existing.windowType = windowType;
            existing.title = title;
            existing.closed = false;
            return;
        }

        this.buckets.set(windowId, { windowId, windowType, title, closed: false, entries: [] });
        this.order.push(windowId);
        this.evictWindows();
    }

    /** Append one captured console line. Unknown windows are tracked on the fly. */
    public push(
        windowId: number,
        entry: { level: DevtoolsConsoleLevel; message: string; source?: string; line?: number; timestamp?: number },
    ): void {
        let bucket = this.buckets.get(windowId);
        if (!bucket) {
            this.track(windowId, "unknown", "");
            bucket = this.buckets.get(windowId)!;
        }

        this.seq += 1;
        bucket.entries.push({
            seq: this.seq,
            timestamp: entry.timestamp ?? Date.now(),
            windowId,
            windowType: bucket.windowType,
            level: entry.level,
            message: entry.message,
            source: entry.source || undefined,
            line: entry.line,
        });

        if (bucket.entries.length > this.maxPerWindow) {
            bucket.entries.splice(0, bucket.entries.length - this.maxPerWindow);
        }
    }

    /** Mark a window closed. Its buffer is kept (subject to eviction) so a crash's tail survives. */
    public markClosed(windowId: number): void {
        const bucket = this.buckets.get(windowId);
        if (bucket) {
            bucket.closed = true;
        }
    }

    public listWindows(): DevtoolsWindowInfo[] {
        return this.order
            .map(id => this.buckets.get(id))
            .filter((b): b is WindowBucket => Boolean(b))
            .map(b => ({
                windowId: b.windowId,
                windowType: b.windowType,
                title: b.title,
                closed: b.closed,
                entryCount: b.entries.length,
            }));
    }

    public query(query: DevtoolsConsoleQuery = {}): DevtoolsConsoleQueryResult {
        const minRank = query.level ? LEVEL_RANK[query.level] : -1;
        const limit = Math.max(1, query.limit ?? DEFAULT_QUERY_LIMIT);
        const matchWindow = this.buildWindowMatcher(query.window);

        const matched: DevtoolsConsoleEntry[] = [];
        for (const id of this.order) {
            const bucket = this.buckets.get(id);
            if (!bucket || !matchWindow(bucket)) {
                continue;
            }
            for (const entry of bucket.entries) {
                if (LEVEL_RANK[entry.level] < minRank) continue;
                if (query.since != null && entry.timestamp <= query.since) continue;
                if (query.afterSeq != null && entry.seq <= query.afterSeq) continue;
                matched.push(entry);
            }
        }

        matched.sort((a, b) => a.seq - b.seq);
        const trimmed = matched.length > limit ? matched.slice(matched.length - limit) : matched;

        return {
            entries: trimmed,
            latestSeq: this.seq,
            windows: this.listWindows(),
        };
    }

    private buildWindowMatcher(window: string | undefined): (bucket: WindowBucket) => boolean {
        if (!window) {
            return () => true;
        }
        const normalized = window.toLowerCase();
        const asId = Number(window);
        return bucket => {
            if (Number.isInteger(asId) && bucket.windowId === asId) {
                return true;
            }
            return (
                bucket.windowType.toLowerCase().includes(normalized)
                || bucket.title.toLowerCase().includes(normalized)
            );
        };
    }

    private evictWindows(): void {
        while (this.order.length > this.maxWindows) {
            // Prefer evicting an already-closed window; fall back to the oldest.
            const closedIndex = this.order.findIndex(id => this.buckets.get(id)?.closed);
            const removeIndex = closedIndex >= 0 ? closedIndex : 0;
            const [removedId] = this.order.splice(removeIndex, 1);
            this.buckets.delete(removedId);
        }
    }
}
