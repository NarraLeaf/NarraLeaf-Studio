import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";
import { getInterface } from "@/lib/app/bridge";
import { Service } from "../Service";
import { Services, type WorkspaceContext } from "../services";
import { EventEmitter } from "../ui/EventEmitter";
import { DevModeService } from "./DevModeService";

export type ConsoleChannelId = "blueprint" | "build";

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
};

export const MAX_CONSOLE_ENTRIES_PER_CHANNEL = 500;
export const MAX_CONSOLE_ENTRY_CHARS = 8192;
const TRUNCATED_ENTRY_SUFFIX = "... [truncated]";

export const CONSOLE_CHANNELS: readonly ConsoleChannelDefinition[] = [
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

function createEntryStore(): Record<ConsoleChannelId, ConsoleEntry[]> {
    return {
        blueprint: [],
        build: [],
    };
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
        return CONSOLE_CHANNELS;
    }

    public getEntries(channel: ConsoleChannelId): ConsoleEntry[] {
        return [...this.entries[channel]];
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

        const list = this.entries[channel];
        list.push(entry);
        if (list.length > MAX_CONSOLE_ENTRIES_PER_CHANNEL) {
            list.splice(0, list.length - MAX_CONSOLE_ENTRIES_PER_CHANNEL);
        }
        this.emitChanged(channel, "append", entry);
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

    public clear(channel?: ConsoleChannelId): void {
        if (channel) {
            this.entries[channel] = [];
            this.emitChanged(channel, "clear");
            return;
        }

        for (const item of CONSOLE_CHANNELS) {
            this.entries[item.id] = [];
            this.emitChanged(item.id, "clear");
        }
    }

    public onEntriesChanged(handler: (event: ConsoleServiceEvents["entriesChanged"]) => void): () => void {
        return this.events.on("entriesChanged", handler);
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
        this.sequence = 0;
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
