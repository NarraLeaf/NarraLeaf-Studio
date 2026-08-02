/**
 * Dev-only bridge exposing the workspace window's application Console service
 * to the main process. The main-process debug server ({@link file
 * src/main/app/application/managers/debug/studioDebugServer.ts}) reads it via
 * `webContents.executeJavaScript` and serves it over HTTP so tooling can pull
 * the in-app Console panel's contents without scraping the UI.
 *
 * Installed only in development builds (the `__NLS_STUDIO_DEV__` build define
 * gates the call site in the workspace entry), and only in the workspace window
 * — the Console service exists nowhere else.
 */
import {
    ConsoleService,
    type ConsoleEntry,
    type ConsoleLogLevel,
} from "../services/core/ConsoleService";

const BRIDGE_VERSION = 1;

/** Severity order used for the `level` (minimum-severity) filter. */
const LEVEL_RANK: Record<ConsoleLogLevel, number> = {
    verbose: 0,
    info: 1,
    success: 1,
    warning: 2,
    error: 3,
};

export interface ConsoleSnapshotOptions {
    /** Restrict to one channel id (e.g. "build", "blueprint", "story"). */
    channel?: string;
    /** Minimum severity; e.g. "warning" returns warnings and errors. */
    level?: ConsoleLogLevel | string;
    /** Case-insensitive substring match against the entry source. */
    source?: string;
    /** Only entries with a timestamp strictly greater than this (ms epoch). */
    since?: number;
    /** Keep at most this many entries, most recent first-trimmed. Default 200. */
    limit?: number;
}

interface FlatConsoleEntry {
    id: string;
    channel: string;
    level: ConsoleLogLevel;
    timestamp: number;
    /** ISO string for human-readable output. */
    time: string;
    source?: string;
    /** Segments flattened to plain text — what the panel renders as one line. */
    text: string;
}

interface ConsoleSnapshot {
    channels: { id: string; label: string; description: string }[];
    entries: FlatConsoleEntry[];
    /** Total entries matched before `limit` trimming. */
    matched: number;
}

interface StudioDebugBridge {
    version: number;
    console: {
        snapshot(options?: ConsoleSnapshotOptions): ConsoleSnapshot;
        channels(): { id: string; label: string; description: string }[];
    };
}

declare global {
    interface Window {
        __NLS_STUDIO_DEBUG__?: StudioDebugBridge;
    }
}

const DEFAULT_LIMIT = 200;

function flatten(entry: ConsoleEntry): FlatConsoleEntry {
    return {
        id: entry.id,
        channel: entry.channel,
        level: entry.level,
        timestamp: entry.timestamp,
        time: new Date(entry.timestamp).toISOString(),
        source: entry.source,
        text: entry.segments.map(segment => segment.text).join(""),
    };
}

function snapshot(options: ConsoleSnapshotOptions = {}): ConsoleSnapshot {
    const service = ConsoleService.getInstance();
    const channels = service.getChannels();
    const minRank = options.level ? LEVEL_RANK[String(options.level).toLowerCase() as ConsoleLogLevel] ?? -1 : -1;
    const sourceNeedle = options.source?.toLowerCase();
    const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);

    const targetChannels = options.channel
        ? channels.filter(channel => channel.id === options.channel)
        : channels;

    const matched: FlatConsoleEntry[] = [];
    for (const channel of targetChannels) {
        for (const entry of service.getEntries(channel.id)) {
            if (LEVEL_RANK[entry.level] < minRank) continue;
            if (options.since != null && entry.timestamp <= options.since) continue;
            if (sourceNeedle && !(entry.source ?? "").toLowerCase().includes(sourceNeedle)) continue;
            matched.push(flatten(entry));
        }
    }

    matched.sort((a, b) => a.timestamp - b.timestamp);
    const trimmed = matched.length > limit ? matched.slice(matched.length - limit) : matched;

    return {
        channels: channels.map(channel => ({ ...channel })),
        entries: trimmed,
        matched: matched.length,
    };
}

/** Idempotently install `window.__NLS_STUDIO_DEBUG__`. No-op outside a browser realm. */
export function installStudioDebugBridge(): void {
    if (typeof window === "undefined" || window.__NLS_STUDIO_DEBUG__) {
        return;
    }
    window.__NLS_STUDIO_DEBUG__ = {
        version: BRIDGE_VERSION,
        console: {
            snapshot,
            channels: () => ConsoleService.getInstance().getChannels().map(channel => ({ ...channel })),
        },
    };
}
