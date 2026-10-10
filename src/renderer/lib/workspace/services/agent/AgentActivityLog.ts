/**
 * Every agent call this workspace saw, for the Agent log panel: the calls the bridge carried out,
 * and the calls main answered itself (main-side tools, refusals made before routing) as main
 * reported them.
 *
 * In memory and per workspace, a ring of {@link AGENT_ACTIVITY_LOG_CAPACITY} entries - it is a
 * window onto the session, not a record. What an entry holds is what a row shows: no arguments, no
 * answer text, nothing a call carried that the author did not see on screen anyway.
 *
 * Comments in English per project convention.
 */

import type { AgentErrorCode } from "@shared/agent/protocol";
import type { AgentMainActivity } from "@shared/agent/workspaceAccess";
import { AGENT_TOOLS_BY_NAME } from "@shared/agent/tools";
import type { AgentWriteTarget } from "./AgentFollowService";

export const AGENT_ACTIVITY_LOG_CAPACITY = 500;

export type AgentActivityStatus = "running" | "ok" | "refused";

export type AgentActivityEntry = {
    /** Increasing within one log; stable for the entry's life. */
    id: number;
    /** When the call started, epoch milliseconds. */
    startedAt: number;
    tool: string;
    clientName: string | null;
    /** The tool changes the project (its row in the tool table says so). */
    write: boolean;
    /** Who answered it: this workspace's bridge, or main. */
    side: "workspace" | "main";
    status: AgentActivityStatus;
    code?: AgentErrorCode;
    message?: string;
    hint?: string;
    /** Null while running. */
    durationMs: number | null;
    /** The page, scene or other thing the call was about, once known. */
    target: string | null;
    /** Where the call's first write landed, for a row that opens it. */
    reveal: AgentWriteTarget | null;
};

export type AgentActivityFilter = "all" | "writes" | "failures";

export const AGENT_ACTIVITY_FILTERS: readonly AgentActivityFilter[] = ["all", "writes", "failures"];

export function filterAgentActivity(entries: readonly AgentActivityEntry[], filter: AgentActivityFilter): readonly AgentActivityEntry[] {
    switch (filter) {
        case "all":
            return entries;
        case "writes":
            return entries.filter(entry => entry.write);
        case "failures":
            return entries.filter(entry => entry.status === "refused");
    }
}

/** Calls main makes that are not tools an agent named (`__state`, `__test`, `__build`); never logged. */
export function isInternalAgentTool(tool: string): boolean {
    return tool.startsWith("__");
}

type Finish = {
    ok: boolean;
    code?: AgentErrorCode;
    message?: string;
    hint?: string;
    durationMs: number;
    target?: string | null;
    reveal?: AgentWriteTarget | null;
};

export class AgentActivityLog {
    private entries: readonly AgentActivityEntry[] = [];
    private nextId = 1;
    private readonly listeners = new Set<() => void>();

    public constructor(
        private readonly capacity = AGENT_ACTIVITY_LOG_CAPACITY,
        private readonly now: () => number = Date.now,
    ) {}

    /** The entries, oldest first. A new array after every change, so it can be a React snapshot. */
    public readonly getEntries = (): readonly AgentActivityEntry[] => this.entries;

    public readonly subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    /** A call the bridge is starting. Returns the id {@link end} takes. Internal calls get -1 and no row. */
    public begin(tool: string, clientName: string | null): number {
        if (isInternalAgentTool(tool)) {
            return -1;
        }
        const id = this.nextId++;
        this.push({
            id,
            startedAt: this.now(),
            tool,
            clientName,
            write: AGENT_TOOLS_BY_NAME.get(tool)?.write ?? false,
            side: "workspace",
            status: "running",
            durationMs: null,
            target: null,
            reveal: null,
        });
        return id;
    }

    /** The call {@link begin} returned `id` for has ended. An entry already pushed out of the ring is let go. */
    public end(id: number, finish: Finish): void {
        if (id < 0) {
            return;
        }
        let changed = false;
        this.entries = this.entries.map(entry => {
            if (entry.id !== id) {
                return entry;
            }
            changed = true;
            return applyFinish(entry, finish);
        });
        if (changed) {
            this.emit();
        }
    }

    /** A whole call at once: one the bridge refused before it started, or one main reports. */
    public record(tool: string, clientName: string | null, side: "workspace" | "main", finish: Finish): void {
        if (isInternalAgentTool(tool)) {
            return;
        }
        this.push(applyFinish({
            id: this.nextId++,
            startedAt: this.now() - finish.durationMs,
            tool,
            clientName,
            write: AGENT_TOOLS_BY_NAME.get(tool)?.write ?? false,
            side,
            status: "running",
            durationMs: null,
            target: null,
            reveal: null,
        }, finish));
    }

    /** A line main sent about a call it answered. */
    public recordMain(activity: AgentMainActivity): void {
        this.record(activity.tool, activity.clientName, "main", {
            ok: activity.ok,
            code: activity.code,
            message: activity.message,
            hint: activity.hint,
            durationMs: activity.durationMs,
            target: activity.summary,
        });
    }

    public clear(): void {
        if (this.entries.length === 0) {
            return;
        }
        this.entries = [];
        this.emit();
    }

    private push(entry: AgentActivityEntry): void {
        const next = [...this.entries, entry];
        this.entries = next.length > this.capacity ? next.slice(next.length - this.capacity) : next;
        this.emit();
    }

    private emit(): void {
        for (const listener of [...this.listeners]) {
            listener();
        }
    }
}

function applyFinish(entry: AgentActivityEntry, finish: Finish): AgentActivityEntry {
    return {
        ...entry,
        status: finish.ok ? "ok" : "refused",
        ...(finish.ok ? {} : { code: finish.code, message: finish.message, ...(finish.hint ? { hint: finish.hint } : {}) }),
        durationMs: Math.max(0, Math.round(finish.durationMs)),
        target: finish.target ?? entry.target,
        reveal: finish.reveal ?? entry.reveal,
    };
}

/**
 * The log as JSON Lines, one call per line, for the panel's export. The same fields a row shows,
 * with ISO times; nothing else.
 */
export function agentActivityToJsonl(entries: readonly AgentActivityEntry[]): string {
    return entries.map(entry => JSON.stringify({
        time: new Date(entry.startedAt).toISOString(),
        tool: entry.tool,
        client: entry.clientName,
        side: entry.side,
        write: entry.write,
        status: entry.status,
        ...(entry.code ? { code: entry.code } : {}),
        ...(entry.message ? { message: entry.message } : {}),
        ...(entry.hint ? { hint: entry.hint } : {}),
        target: entry.target,
        durationMs: entry.durationMs,
    })).join("\n") + (entries.length > 0 ? "\n" : "");
}
