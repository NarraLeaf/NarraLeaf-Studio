/**
 * What every agent tool handler in the workspace is written against.
 *
 * A handler answers one call from an agent connected to Studio's MCP endpoint (see
 * `@shared/agent/protocol`). It reads its arguments through the readers here, throws
 * {@link AgentRefusal} for anything the agent can correct, and returns an `AgentCallResult` for
 * everything else. The bridge turns a refusal into `{ ok: false }` and anything else thrown into an
 * `internal` error, so a handler never has to wrap itself in a try.
 *
 * Comments in English per project convention.
 */

import type { AgentCallRequest, AgentCallResult, AgentErrorCode } from "@shared/agent/protocol";
import type { WorkspaceContext } from "../services";
import type { AgentFollowService } from "./AgentFollowService";
import type { AgentOffscreenRenderer } from "./agentOffscreenRenderer";

/** A call the agent can correct: the code and message reach it as a tool result with `isError`. */
export class AgentRefusal extends Error {
    public constructor(
        public readonly code: AgentErrorCode,
        message: string,
        public readonly hint?: string,
    ) {
        super(message);
        this.name = "AgentRefusal";
    }
}

export function refuse(code: AgentErrorCode, message: string, hint?: string): AgentRefusal {
    return new AgentRefusal(code, message, hint);
}

/** What a handler is given besides its arguments. */
export type AgentToolContext = {
    ctx: WorkspaceContext;
    request: AgentCallRequest;
    follow: AgentFollowService;
    /** Where a page is mounted to be photographed; see `agentOffscreenRenderer`. */
    offscreen: AgentOffscreenRenderer;
    /** One line in the console's agent channel, under this call's id. */
    log(level: "info" | "warning" | "error", message: string): void;
};

export type AgentToolHandler = (args: Record<string, unknown>, tool: AgentToolContext) => Promise<AgentCallResult>;

// ── Argument readers ─────────────────────────────────────────────────────────────────────────────
//
// Main validates every call against the tool's schema before routing it, so these mostly restate
// what is already true. They are still worth having: a handler that reads `args.name as string` and
// gets a number writes it into the project, and the schema cannot say "not blank".

export function readString(args: Record<string, unknown>, key: string): string {
    const value = args[key];
    if (typeof value !== "string" || value.trim() === "") {
        throw refuse("invalid_args", `\`${key}\` must be a non-empty string.`);
    }
    return value.trim();
}

export function readOptionalString(args: Record<string, unknown>, key: string): string | undefined {
    const value = args[key];
    if (value === undefined || value === null) {
        return undefined;
    }
    if (typeof value !== "string") {
        throw refuse("invalid_args", `\`${key}\` must be a string.`);
    }
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
}

export function readOptionalInteger(
    args: Record<string, unknown>,
    key: string,
    bounds: { min?: number; max?: number } = {},
): number | undefined {
    const value = args[key];
    if (value === undefined || value === null) {
        return undefined;
    }
    if (typeof value !== "number" || !Number.isInteger(value)) {
        throw refuse("invalid_args", `\`${key}\` must be an integer.`);
    }
    if ((bounds.min !== undefined && value < bounds.min) || (bounds.max !== undefined && value > bounds.max)) {
        throw refuse("invalid_args", `\`${key}\` must be between ${bounds.min ?? "-∞"} and ${bounds.max ?? "∞"}.`);
    }
    return value;
}

export function readOptionalNumber(args: Record<string, unknown>, key: string): number | undefined {
    const value = args[key];
    if (value === undefined || value === null) {
        return undefined;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw refuse("invalid_args", `\`${key}\` must be a number.`);
    }
    return value;
}

export function readOptionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
    const value = args[key];
    if (value === undefined || value === null) {
        return undefined;
    }
    if (typeof value !== "boolean") {
        throw refuse("invalid_args", `\`${key}\` must be true or false.`);
    }
    return value;
}

export function readOptionalStringArray(args: Record<string, unknown>, key: string): string[] | undefined {
    const value = args[key];
    if (value === undefined || value === null) {
        return undefined;
    }
    if (!Array.isArray(value) || value.some(item => typeof item !== "string")) {
        throw refuse("invalid_args", `\`${key}\` must be an array of strings.`);
    }
    return value as string[];
}

export function readOptionalRecord(args: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
    const value = args[key];
    if (value === undefined || value === null) {
        return undefined;
    }
    if (typeof value !== "object" || Array.isArray(value)) {
        throw refuse("invalid_args", `\`${key}\` must be an object.`);
    }
    return value as Record<string, unknown>;
}

/** The answer as a short text line plus the same facts as data, which is what most tools return. */
export function answer(text: string, structured?: Record<string, unknown>): AgentCallResult {
    return { ok: true, content: [{ type: "text", text }], structured };
}

/** Data the model reads best as JSON: the text is the JSON, and `structured` the same object. */
export function answerJson(structured: Record<string, unknown>, lead?: string): AgentCallResult {
    const json = JSON.stringify(structured, null, 2);
    return { ok: true, content: [{ type: "text", text: lead ? `${lead}\n${json}` : json }], structured };
}
