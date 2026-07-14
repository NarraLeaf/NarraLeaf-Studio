import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";
import { getInterface } from "@/lib/app/bridge";
import { Service } from "../Service";
import { Services, type WorkspaceContext } from "../services";
import { EventEmitter } from "../ui/EventEmitter";
import { DevModeService } from "./DevModeService";

/** A console channel id. Built-ins are seeded; feature areas register their own via registerChannel. */
export type ConsoleChannelId = string;

export type ConsoleLogLevel = "verbose" | "info" | "success" | "warning" | "error";

export type ConsoleLineSegment = {
    text: string;
    bold?: boolean;
    italic?: boolean;
    color?: string;
};

export type ConsoleEntry = {
    id: string;
    channel: ConsoleChannelId;
    level: ConsoleLogLevel;
    timestamp: number;
    source?: string;
    segments: ConsoleLineSegment[];
    bold?: boolean;
    italic?: boolean;
    color?: string;
};

export type ConsoleChannelDefinition = {
    id: ConsoleChannelId;
    label: string;
    description: string;
};

/**
 * Per-channel progress descriptor rendered as a thin bar along the bottom of the
 * console panel. Any producer (build/package pipeline, long imports, …) can drive
 * it through {@link ConsoleService.setProgress}.
 */
export type ConsoleProgress = {
    /** Fraction complete in [0, 1]. Ignored while `indeterminate` is true. */
    value: number;
    /** Animated "in progress, no known fraction" bar; `value` is ignored while true. */
    indeterminate: boolean;
    /** Render in the warning colour instead of the primary colour to flag a problem. */
    error: boolean;
    /** Optional short label surfaced as the bar's tooltip / accessible name. */
    label?: string;
};

/** Partial progress update; omitted fields keep their previous value (see setProgress). */
export type ConsoleProgressInput = {
    value?: number;
    indeterminate?: boolean;
    error?: boolean;
    label?: string;
};

export type ConsoleAppendInput = {
    level?: ConsoleLogLevel;
    source?: string;
    message?: string;
    segments?: readonly ConsoleLineSegment[];
    bold?: boolean;
    italic?: boolean;
    color?: string;
    timestamp?: number;
};

type ConsoleServiceEvents = {
    entriesChanged: {
        channel: ConsoleChannelId;
        entries: ConsoleEntry[];
        reason: "append" | "clear";
        entry?: ConsoleEntry;
    };
    /** The set of registered channels (tabs) changed — a channel was registered or removed. */
    channelsChanged: {
        channels: readonly ConsoleChannelDefinition[];
    };
    /** A channel's progress bar was updated or cleared (`progress` is null when cleared). */
    progressChanged: {
        channel: ConsoleChannelId;
        progress: ConsoleProgress | null;
    };
};

export const MAX_CONSOLE_ENTRIES_PER_CHANNEL = 500;
export const MAX_CONSOLE_ENTRY_CHARS = 8192;
const TRUNCATED_ENTRY_SUFFIX = "... [truncated]";

/**
 * Always-present channels seeded at startup. Additional channels (e.g. the story preview's "Story"
 * tab) are contributed at runtime through {@link ConsoleService.registerChannel} and appear as tabs
 * for as long as at least one producer keeps them registered.
 */
export const BUILTIN_CONSOLE_CHANNELS: readonly ConsoleChannelDefinition[] = [
    {
        id: "blueprint",
        label: "Blueprint",
        description: "Blueprint runtime and graph diagnostics",
    },
    {
        id: "build",
        label: "Build",
        description: "Build, packaging, and preview pipeline output",
    },
] as const;

/** One registered channel: its definition plus a ref-count so multiple producers can share it. */
type RegisteredChannel = {
    definition: ConsoleChannelDefinition;
    builtin: boolean;
    refs: number;
};

function createChannelRegistry(): Map<ConsoleChannelId, RegisteredChannel> {
    const registry = new Map<ConsoleChannelId, RegisteredChannel>();
    for (const definition of BUILTIN_CONSOLE_CHANNELS) {
        registry.set(definition.id, { definition, builtin: true, refs: 0 });
    }
    return registry;
}

function createEntryStore(): Map<ConsoleChannelId, ConsoleEntry[]> {
    const store = new Map<ConsoleChannelId, ConsoleEntry[]>();
    for (const definition of BUILTIN_CONSOLE_CHANNELS) {
        store.set(definition.id, []);
    }
    return store;
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return value < 0 ? 0 : value > 1 ? 1 : value;
}

function normalizeCssColor(color: string | undefined): string | undefined {
    const trimmed = color?.trim();
    if (!trimmed || trimmed.length > 80) {
        return undefined;
    }
    return trimmed;
}

function truncateSegments(segments: ConsoleLineSegment[]): ConsoleLineSegment[] {
    const totalChars = segments.reduce((sum, segment) => sum + segment.text.length, 0);
    if (totalChars <= MAX_CONSOLE_ENTRY_CHARS) {
        return segments;
    }

    const contentBudget = Math.max(0, MAX_CONSOLE_ENTRY_CHARS - TRUNCATED_ENTRY_SUFFIX.length);
    const out: ConsoleLineSegment[] = [];
    let remaining = contentBudget;

    for (const segment of segments) {
        if (remaining <= 0) {
            break;
        }
        const text = segment.text.slice(0, remaining);
        if (text.length > 0) {
            out.push({ ...segment, text });
            remaining -= text.length;
        }
    }

    out.push({
        text: TRUNCATED_ENTRY_SUFFIX,
        italic: true,
        color: "#8b949e",
    });
    return out;
}

function normalizeSegments(input: ConsoleAppendInput): ConsoleLineSegment[] {
    const source = input.segments?.length
        ? input.segments
        : [{ text: input.message ?? "", bold: input.bold, italic: input.italic, color: input.color }];

    return truncateSegments(source.map(segment => ({
        text: String(segment.text ?? ""),
        bold: Boolean(segment.bold),
        italic: Boolean(segment.italic),
        color: normalizeCssColor(segment.color),
    })));
}

function normalizeBlueprintLevel(level: string): ConsoleLogLevel {
    const normalized = level.trim().toLowerCase();
    if (normalized === "error") {
        return "error";
    }
    if (normalized === "warn" || normalized === "warning") {
        return "warning";
    }
    if (normalized === "success") {
        return "success";
    }
    if (normalized === "verbose" || normalized === "debug" || normalized === "trace") {
        return "verbose";
    }
    return "info";
}

function devModeStatusLevel(status: string): ConsoleLogLevel {
    if (status === "error") {
        return "error";
    }
    return "info";
}

function formatBlueprintDebugEvent(event: BlueprintDebugEvent): string {
    switch (event.type) {
        case "execution.started":
            return `execution started - bp:${event.blueprintId.slice(0, 8)} - ${event.executionId.slice(0, 8)}`;
        case "execution.finished":
            return `execution finished - bp:${event.blueprintId.slice(0, 8)} - ${event.executionId.slice(0, 8)}`;
        case "execution.cancelled":
            return [
                event.reason || "execution cancelled",
                event.blueprintId ? `bp:${event.blueprintId.slice(0, 8)}` : null,
                event.eventId ? `event:${event.eventId}` : null,
                event.nodeId ? `node:${event.nodeId.slice(0, 10)}` : null,
            ].filter(Boolean).join(" - ");
        case "execution.error":
            return [
                event.message,
                event.blueprintId ? `bp:${event.blueprintId.slice(0, 8)}` : null,
                event.eventId ? `event:${event.eventId}` : null,
                event.nodeId ? `node:${event.nodeId.slice(0, 10)}` : null,
            ].filter(Boolean).join(" - ");
        case "node.enter":
            return `node enter - ${event.nodeId.slice(0, 12)}`;
        case "node.exit":
            return `node exit - ${event.nodeId.slice(0, 12)}`;
        case "state.read":
            return `state read - ${event.scope} - ${event.key}`;
        case "state.write":
            return `state write - ${event.scope} - ${event.key}`;
        case "binding.evaluated":
            return `binding evaluated - ${event.bindingId.slice(0, 10)}`;
        case "function.call":
            return `function call - ${event.functionId}`;
        case "function.return":
            return `function return - ${event.functionId}`;
        case "devtools.log":
            return event.message;
        default:
            return JSON.stringify(event);
    }
}

/**
 * Workspace console output buffer.
 *
 * The service owns structured console entries and exposes channel-oriented
 * append/clear APIs so build, package, preview, and blueprint pipelines can
 * write to the same bottom panel without coupling to React components.
 */
export class ConsoleService extends Service<ConsoleService> {
    private entries = createEntryStore();
    private channelRegistry = createChannelRegistry();
    private progress = new Map<ConsoleChannelId, ConsoleProgress>();
    private readonly events = new EventEmitter<ConsoleServiceEvents>();
    private sequence = 0;
    private devModeStatusUnsubscribe: (() => void) | null = null;
    private devModeConsoleLogUnsubscribe: (() => void) | null = null;
    private devModeBlueprintDebugUnsubscribe: (() => void) | null = null;

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const devMode = ctx.services.get<DevModeService>(Services.DevMode);
        await depend([devMode]);

        this.devModeStatusUnsubscribe?.();
        this.devModeStatusUnsubscribe = devMode.onStatusChanged(status => {
            this.append("build", {
                level: devModeStatusLevel(status),
                source: "Dev Mode",
                segments: [
                    { text: "status changed: ", color: "#8b949e" },
                    { text: status, bold: true },
                ],
            });
        });

        this.devModeConsoleLogUnsubscribe?.();
        const consoleLogToken = getInterface().devMode.onConsoleLog(payload => {
            this.append("build", {
                level: payload.level,
                source: payload.source ?? "Dev Mode",
                message: payload.message,
                timestamp: payload.timestamp,
            });
        });
        this.devModeConsoleLogUnsubscribe = () => consoleLogToken.cancel();

        this.devModeBlueprintDebugUnsubscribe?.();
        const blueprintDebugToken = getInterface().devMode.onBlueprintDebugEvent(event => {
            this.appendBlueprintDebugEvent(event);
        });
        this.devModeBlueprintDebugUnsubscribe = () => blueprintDebugToken.cancel();
    }

    public getChannels(): readonly ConsoleChannelDefinition[] {
        return [...this.channelRegistry.values()].map(channel => channel.definition);
    }

    /**
     * Register a channel so it shows up as a console tab. Ref-counted and idempotent by id: N
     * registrations of the same id take N disposals before a non-builtin channel (and its buffered
     * entries) are removed. Built-in channels are permanent — registering their id is a no-op that
     * still returns a (no-op) disposer, so callers can register uniformly.
     */
    public registerChannel(definition: ConsoleChannelDefinition): () => void {
        const existing = this.channelRegistry.get(definition.id);
        if (existing) {
            if (!existing.builtin) {
                existing.refs += 1;
            }
            return this.makeChannelDisposer(definition.id);
        }
        this.channelRegistry.set(definition.id, { definition, builtin: false, refs: 1 });
        if (!this.entries.has(definition.id)) {
            this.entries.set(definition.id, []);
        }
        this.emitChannelsChanged();
        return this.makeChannelDisposer(definition.id);
    }

    public getEntries(channel: ConsoleChannelId): ConsoleEntry[] {
        return [...(this.entries.get(channel) ?? [])];
    }

    public append(channel: ConsoleChannelId, input: ConsoleAppendInput): ConsoleEntry {
        const entry: ConsoleEntry = {
            id: this.nextEntryId(channel),
            channel,
            level: input.level ?? "info",
            timestamp: input.timestamp ?? Date.now(),
            source: input.source?.trim() || undefined,
            segments: normalizeSegments(input),
            bold: Boolean(input.bold),
            italic: Boolean(input.italic),
            color: normalizeCssColor(input.color),
        };

        let list = this.entries.get(channel);
        if (!list) {
            list = [];
            this.entries.set(channel, list);
        }
        list.push(entry);
        if (list.length > MAX_CONSOLE_ENTRIES_PER_CHANNEL) {
            list.splice(0, list.length - MAX_CONSOLE_ENTRIES_PER_CHANNEL);
        }
        this.emitChanged(channel, "append", entry);

        // An error logged while a progress bar is running flips it to the warning
        // colour automatically, so producers that already log errors get the visual
        // signal without a separate setProgress call.
        if (entry.level === "error" && this.progress.get(channel)?.error === false) {
            this.setProgress(channel, { error: true });
        }
        return entry;
    }

    public log(
        channel: ConsoleChannelId,
        level: ConsoleLogLevel,
        message: string,
        options: Omit<ConsoleAppendInput, "level" | "message" | "segments"> = {},
    ): ConsoleEntry {
        return this.append(channel, { ...options, level, message });
    }

    public appendBlueprintDebugEvent(event: BlueprintDebugEvent): ConsoleEntry {
        const level =
            event.type === "execution.error"
                ? "error"
                : event.type === "devtools.log"
                    ? normalizeBlueprintLevel(event.level)
                    : "verbose";

        return this.append("blueprint", {
            level,
            source: event.type === "devtools.log" ? "Blueprint Log" : "Blueprint",
            message: formatBlueprintDebugEvent(event),
        });
    }

    /** Current progress bar for a channel, or null when none is running. */
    public getProgress(channel: ConsoleChannelId): ConsoleProgress | null {
        return this.progress.get(channel) ?? null;
    }

    /**
     * Drive (or clear) a channel's progress bar. Passing `null` removes the bar.
     * Otherwise the given fields are merged over the channel's current progress, so
     * callers can nudge a single field — e.g. `setProgress("build", { error: true })`
     * flips the colour while keeping the current value. A brand-new bar defaults to
     * value 0, determinate, non-error.
     */
    public setProgress(channel: ConsoleChannelId, input: ConsoleProgressInput | null): void {
        if (input === null) {
            if (this.progress.delete(channel)) {
                this.events.emit("progressChanged", { channel, progress: null });
            }
            return;
        }

        const previous = this.progress.get(channel);
        const next: ConsoleProgress = {
            value: clamp01(input.value ?? previous?.value ?? 0),
            indeterminate: input.indeterminate ?? previous?.indeterminate ?? false,
            error: input.error ?? previous?.error ?? false,
            label: input.label ?? previous?.label,
        };
        this.progress.set(channel, next);
        this.events.emit("progressChanged", { channel, progress: next });
    }

    public onProgressChanged(handler: (event: ConsoleServiceEvents["progressChanged"]) => void): () => void {
        return this.events.on("progressChanged", handler);
    }

    public clear(channel?: ConsoleChannelId): void {
        if (channel) {
            this.entries.set(channel, []);
            this.emitChanged(channel, "clear");
            return;
        }

        for (const id of [...this.entries.keys()]) {
            this.entries.set(id, []);
            this.emitChanged(id, "clear");
        }
    }

    public onEntriesChanged(handler: (event: ConsoleServiceEvents["entriesChanged"]) => void): () => void {
        return this.events.on("entriesChanged", handler);
    }

    public onChannelsChanged(handler: (event: ConsoleServiceEvents["channelsChanged"]) => void): () => void {
        return this.events.on("channelsChanged", handler);
    }

    public override dispose(_ctx: WorkspaceContext): void {
        this.devModeStatusUnsubscribe?.();
        this.devModeStatusUnsubscribe = null;
        this.devModeConsoleLogUnsubscribe?.();
        this.devModeConsoleLogUnsubscribe = null;
        this.devModeBlueprintDebugUnsubscribe?.();
        this.devModeBlueprintDebugUnsubscribe = null;
        this.events.clear();
        this.entries = createEntryStore();
        this.channelRegistry = createChannelRegistry();
        this.progress = new Map();
        this.sequence = 0;
    }

    private makeChannelDisposer(channel: ConsoleChannelId): () => void {
        let disposed = false;
        return () => {
            if (disposed) {
                return;
            }
            disposed = true;
            const entry = this.channelRegistry.get(channel);
            if (!entry || entry.builtin) {
                return;
            }
            entry.refs -= 1;
            if (entry.refs <= 0) {
                this.channelRegistry.delete(channel);
                this.entries.delete(channel);
                this.emitChannelsChanged();
            }
        };
    }

    private emitChannelsChanged(): void {
        this.events.emit("channelsChanged", { channels: this.getChannels() });
    }

    private emitChanged(
        channel: ConsoleChannelId,
        reason: ConsoleServiceEvents["entriesChanged"]["reason"],
        entry?: ConsoleEntry,
    ): void {
        this.events.emit("entriesChanged", {
            channel,
            entries: this.getEntries(channel),
            reason,
            entry,
        });
    }

    private nextEntryId(channel: ConsoleChannelId): string {
        this.sequence += 1;
        return `${channel}:${Date.now().toString(36)}:${this.sequence.toString(36)}`;
    }
}
