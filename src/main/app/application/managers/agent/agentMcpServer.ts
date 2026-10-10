import crypto from "crypto";
import http from "http";
import type { AddressInfo } from "net";
import {
    AGENT_MCP_PATH,
    AGENT_MCP_PROTOCOL_VERSIONS,
    AGENT_MCP_SERVER_NAME,
    type AgentCallResult,
} from "@shared/agent/protocol";
import {
    AGENT_GUIDE_CHAPTERS,
    AGENT_TOOLS,
    AGENT_TOOLS_BY_NAME,
    type AgentGuideChapter,
    type AgentToolDescriptor,
} from "@shared/agent/tools";
import { validateAgentArgs } from "@shared/agent/validateArgs";

/**
 * Studio's MCP endpoint: the door an author's own AI agent (Claude Code, opencode, Codex, Cursor…)
 * comes in through to work on the project open in front of them.
 *
 * MCP's Streamable HTTP transport, the JSON-response form of it: every request is one POST carrying
 * a JSON-RPC message or a batch of them, answered in the response body. There is nothing the server
 * needs to push unasked, so there is no event stream - a GET is answered 405, which the transport
 * defines as "this server offers no stream". Hand-written over Node's `http` rather than taken from
 * an SDK because the protocol surface is small and fixed, and every byte of it is reachable by any
 * program on the machine.
 *
 * ## Who may knock
 *
 * Bound to 127.0.0.1 only, and that is not enough on its own: every web page the author opens can
 * send requests to localhost. So, before a byte of the body is read:
 *
 *   - **No `Origin` header, ever.** Browsers send one on every cross-origin request and on every
 *     POST; MCP clients are programs and send none. Refusing it shuts out a page posting to the
 *     port (CSRF) and a page that rebinds its own host name to 127.0.0.1 (DNS rebinding).
 *   - **`Host` must name this server** - `127.0.0.1:<port>` or `localhost:<port>` - the second half
 *     of the rebinding defence, for anything that strips `Origin`.
 *   - **A bearer token** (`Authorization: Bearer …`), compared in constant time. It lives in a file
 *     only the author's account can read, and the Settings window can replace it at any moment.
 *   - **4 MB per request.** The largest thing an agent sends is a scene or a page as text.
 *
 * Nothing in a request is ever evaluated. Arguments are checked against the tool's schema here,
 * then handed to {@link AgentMcpHost.callTool}, which owns the author's switches and the routing.
 *
 * Comments in English per project convention.
 */

/** What the server asks of the rest of Studio. */
export interface AgentMcpHost {
    /** Carry out a call whose name is in the tool table and whose arguments fit its schema. */
    callTool(tool: AgentToolDescriptor, args: Record<string, unknown>, context: AgentCallContext): Promise<AgentCallResult>;
    /** One guide chapter as Markdown, or null when the file is missing. */
    readGuide(chapter: AgentGuideChapter): Promise<string | null>;
    /** Studio's version, for `serverInfo`. */
    version(): string;
    log(level: "info" | "warn", message: string): void;
}

export type AgentCallContext = {
    /** `clientInfo.name` from `initialize`, when the client's session is known. */
    clientName: string | null;
};

export type AgentMcpServerOptions = {
    /** The port asked for. 0 asks the system for any free one. */
    port: number;
    /** Read on every request, so a regenerated token takes effect at once. */
    token: () => string;
    host: AgentMcpHost;
    /** When the port asked for is taken, take any free one instead of failing. Defaults to true. */
    fallBackToFreePort?: boolean;
};

export const AGENT_MCP_BODY_LIMIT = 4 * 1024 * 1024;

const BIND_ADDRESS = "127.0.0.1";

/** Remembered sessions; the oldest is forgotten past this, which only costs its client name in the log. */
const MAX_SESSIONS = 64;

export const AGENT_MCP_INSTRUCTIONS = [
    "This server is NarraLeaf Studio, a visual-novel editor, running on the author's machine with their project open.",
    "Your edits land live in the editor the author is watching; each write is one undo step for them.",
    "Start by calling agent_status, then read the `workflow` chapter with agent_guide (also served as the resource narraleaf://guide/workflow) before you change anything.",
    "Read before you write: the show tools return a revision that every write must carry back.",
].join(" ");

const GUIDE_URI_PREFIX = "narraleaf://guide/";

const GUIDE_TITLES: Record<AgentGuideChapter, string> = {
    workflow: "Making a game, start to finish",
    "story-format": "The .story text format",
    "ui-format": "The .ui text format",
    "blueprint-format": "The .bp text format",
    "ui-design": "Designing visual-novel interfaces",
    "script-adaptation": "Turning a script into scenes",
    "verify-and-ship": "Checking, play-testing and building",
    troubleshooting: "Refusals and what to do about them",
};

const MAKE_GAME_PROMPT = "make_game";

type JsonRpcId = string | number | null;
type JsonRpcResponse =
    | { jsonrpc: "2.0"; id: JsonRpcId; result: unknown }
    | { jsonrpc: "2.0"; id: JsonRpcId; error: { code: number; message: string; data?: unknown } };

class RpcError extends Error {
    constructor(public readonly code: number, message: string) {
        super(message);
    }
}

export class AgentMcpServer {
    private server: http.Server | null = null;
    private boundPort: number | null = null;
    private readonly sessions = new Map<string, { clientName: string | null }>();

    constructor(private readonly options: AgentMcpServerOptions) {}

    /** The port being served on, or null while stopped. */
    public get port(): number | null {
        return this.boundPort;
    }

    /** Start listening; resolves with the port actually bound. */
    public async start(): Promise<number> {
        if (this.server && this.boundPort !== null) {
            return this.boundPort;
        }
        const server = http.createServer((req, res) => {
            this.handle(req, res).catch(error => {
                this.options.host.log("warn", `[Agent] Request failed: ${describe(error)}`);
                if (!res.headersSent) {
                    sendJson(res, 500, { jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal error" } });
                } else {
                    res.end();
                }
            });
        });
        // Slow or idle connections are not held open forever: a request is a few kilobytes.
        server.requestTimeout = 5 * 60 * 1000;
        server.headersTimeout = 30 * 1000;
        try {
            this.boundPort = await listen(server, this.options.port);
        } catch (error) {
            if ((error as NodeJS.ErrnoException)?.code !== "EADDRINUSE" || this.options.fallBackToFreePort === false) {
                throw error;
            }
            this.options.host.log("warn", `[Agent] Port ${this.options.port} is taken; serving on a free port instead`);
            this.boundPort = await listen(server, 0);
        }
        // An error after listening (a socket fault) must not become an unhandled 'error' event,
        // which would take the main process down with it.
        server.on("error", error => this.options.host.log("warn", `[Agent] Server error: ${describe(error)}`));
        this.server = server;
        return this.boundPort;
    }

    public async stop(): Promise<void> {
        const server = this.server;
        this.server = null;
        this.boundPort = null;
        this.sessions.clear();
        if (!server) {
            return;
        }
        await new Promise<void>(resolve => {
            server.close(() => resolve());
            server.closeAllConnections?.();
        });
    }

    private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const refusal = this.refuse(req);
        if (refusal) {
            req.resume();
            sendJson(res, refusal.status, { error: refusal.message }, refusal.headers);
            return;
        }

        const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname.replace(/\/+$/, "") || "/";
        if (pathname !== AGENT_MCP_PATH) {
            req.resume();
            sendJson(res, 404, { error: `Not found. The endpoint is ${AGENT_MCP_PATH}.` });
            return;
        }

        switch (req.method) {
            case "POST":
                break;
            case "DELETE": {
                // The client ending its session.
                const sessionId = headerValue(req, "mcp-session-id");
                if (sessionId) {
                    this.sessions.delete(sessionId);
                }
                req.resume();
                res.writeHead(200, { "Cache-Control": "no-store" });
                res.end();
                return;
            }
            default:
                req.resume();
                // GET included: there is no server-to-client stream to open.
                sendJson(res, 405, { error: "Use POST." }, { Allow: "POST, DELETE" });
                return;
        }

        const body = await readBody(req, AGENT_MCP_BODY_LIMIT);
        if (body === "too-large") {
            // `Connection: close` ends the socket once this is written, so the rest of an oversized
            // upload is not read; destroying the request here could cut the answer off instead.
            sendJson(res, 413, { error: `Request body exceeds ${AGENT_MCP_BODY_LIMIT} bytes.` }, { Connection: "close" });
            return;
        }

        let message: unknown;
        try {
            message = JSON.parse(body.toString("utf8"));
        } catch {
            sendJson(res, 400, rpcError(null, -32700, "Parse error"));
            return;
        }

        const sessionHeader = headerValue(req, "mcp-session-id");
        const batch = Array.isArray(message);
        const messages = batch ? message as unknown[] : [message];
        if (batch && messages.length === 0) {
            sendJson(res, 400, rpcError(null, -32600, "Empty batch"));
            return;
        }

        let issuedSession: string | null = null;
        const responses: JsonRpcResponse[] = [];
        for (const entry of messages) {
            const outcome = await this.dispatch(entry, sessionHeader);
            if (outcome.session) {
                issuedSession = outcome.session;
            }
            if (outcome.response) {
                responses.push(outcome.response);
            }
        }

        const headers: Record<string, string> = {};
        if (issuedSession) {
            headers["Mcp-Session-Id"] = issuedSession;
        }
        if (responses.length === 0) {
            // Notifications and responses only: accepted, nothing to say.
            res.writeHead(202, { "Cache-Control": "no-store", ...headers });
            res.end();
            return;
        }
        sendJson(res, 200, batch ? responses : responses[0], headers);
    }

    /** The checks that come before anything in the request is read. Null when it may proceed. */
    private refuse(req: http.IncomingMessage): { status: number; message: string; headers?: Record<string, string> } | null {
        if (req.headers.origin !== undefined) {
            return { status: 403, message: "Requests from web pages are not accepted." };
        }
        const host = (headerValue(req, "host") ?? "").toLowerCase();
        const port = this.boundPort;
        if (port === null || (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)) {
            return { status: 403, message: "Unexpected Host header." };
        }
        const authorization = headerValue(req, "authorization") ?? "";
        const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
        if (!match || !tokensEqual(match[1].trim(), this.options.token())) {
            return {
                status: 401,
                message: "Missing or wrong bearer token. Copy the configuration from Studio's Settings > Agent access.",
                headers: { "WWW-Authenticate": "Bearer" },
            };
        }
        return null;
    }

    private async dispatch(
        entry: unknown,
        sessionHeader: string | null,
    ): Promise<{ response: JsonRpcResponse | null; session?: string }> {
        if (!entry || typeof entry !== "object" || (entry as { jsonrpc?: unknown }).jsonrpc !== "2.0") {
            return { response: rpcError(null, -32600, "Invalid Request") };
        }
        const request = entry as { id?: unknown; method?: unknown; params?: unknown };
        const isRequest = "id" in request && (typeof request.id === "string" || typeof request.id === "number");
        if (typeof request.method !== "string") {
            // A response to something the server never asked, or garbage. Either way, nothing to answer.
            return { response: isRequest ? rpcError(request.id as JsonRpcId, -32600, "Invalid Request") : null };
        }
        if (!isRequest) {
            // `notifications/initialized`, `notifications/cancelled` and the like: nothing to do.
            return { response: null };
        }
        const id = request.id as string | number;
        const params = (request.params && typeof request.params === "object" ? request.params : {}) as Record<string, unknown>;
        try {
            if (request.method === "initialize") {
                const { result, session } = this.initialize(params);
                return { response: { jsonrpc: "2.0", id, result }, session };
            }
            const result = await this.call(request.method, params, sessionHeader);
            return { response: { jsonrpc: "2.0", id, result } };
        } catch (error) {
            if (error instanceof RpcError) {
                return { response: rpcError(id, error.code, error.message) };
            }
            this.options.host.log("warn", `[Agent] ${request.method} failed: ${describe(error)}`);
            return { response: rpcError(id, -32603, "Internal error") };
        }
    }

    private initialize(params: Record<string, unknown>): { result: unknown; session: string } {
        const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
        const protocolVersion = (AGENT_MCP_PROTOCOL_VERSIONS as readonly string[]).includes(asked)
            ? asked
            : AGENT_MCP_PROTOCOL_VERSIONS[0];
        const clientInfo = params.clientInfo && typeof params.clientInfo === "object"
            ? params.clientInfo as Record<string, unknown>
            : {};
        const clientName = typeof clientInfo.name === "string" ? clientInfo.name.slice(0, 80) : null;
        const session = crypto.randomUUID();
        this.sessions.set(session, { clientName });
        while (this.sessions.size > MAX_SESSIONS) {
            this.sessions.delete(this.sessions.keys().next().value as string);
        }
        this.options.host.log("info", `[Agent] ${clientName ?? "A client"} connected (protocol ${protocolVersion})`);
        return {
            session,
            result: {
                protocolVersion,
                capabilities: {
                    tools: { listChanged: false },
                    resources: { listChanged: false, subscribe: false },
                    prompts: { listChanged: false },
                },
                serverInfo: { name: AGENT_MCP_SERVER_NAME, title: "NarraLeaf Studio", version: this.options.host.version() },
                instructions: AGENT_MCP_INSTRUCTIONS,
            },
        };
    }

    private async call(method: string, params: Record<string, unknown>, sessionHeader: string | null): Promise<unknown> {
        switch (method) {
            case "ping":
                return {};
            case "tools/list":
                return { tools: AGENT_TOOLS.map(describeTool) };
            case "tools/call":
                return this.callTool(params, sessionHeader);
            case "resources/list":
                return {
                    resources: AGENT_GUIDE_CHAPTERS.map(chapter => ({
                        uri: `${GUIDE_URI_PREFIX}${chapter}`,
                        name: chapter,
                        title: GUIDE_TITLES[chapter],
                        mimeType: "text/markdown",
                    })),
                };
            case "resources/templates/list":
                return { resourceTemplates: [] };
            case "resources/read": {
                const uri = typeof params.uri === "string" ? params.uri : "";
                const chapter = uri.startsWith(GUIDE_URI_PREFIX) ? uri.slice(GUIDE_URI_PREFIX.length) : "";
                if (!(AGENT_GUIDE_CHAPTERS as readonly string[]).includes(chapter)) {
                    throw new RpcError(-32002, `Resource not found: ${uri}`);
                }
                const text = await this.options.host.readGuide(chapter as AgentGuideChapter);
                return {
                    contents: [{
                        uri,
                        mimeType: "text/markdown",
                        text: text ?? missingGuideText(chapter),
                    }],
                };
            }
            case "prompts/list":
                return {
                    prompts: [{
                        name: MAKE_GAME_PROMPT,
                        title: "Make a game",
                        description: "Make a complete visual novel in NarraLeaf Studio, from a brief to a playable build.",
                        arguments: [{
                            name: "brief",
                            description: "What the game is: title, story or script, art style, language, number of endings.",
                            required: false,
                        }],
                    }],
                };
            case "prompts/get": {
                if (params.name !== MAKE_GAME_PROMPT) {
                    throw new RpcError(-32602, `Unknown prompt: ${String(params.name)}`);
                }
                const args = params.arguments && typeof params.arguments === "object"
                    ? params.arguments as Record<string, unknown>
                    : {};
                const brief = typeof args.brief === "string" ? args.brief.trim() : "";
                const workflow = await this.options.host.readGuide("workflow");
                return {
                    description: "Make a complete visual novel in NarraLeaf Studio",
                    messages: [{
                        role: "user",
                        content: { type: "text", text: makeGamePrompt(workflow, brief) },
                    }],
                };
            }
            default:
                throw new RpcError(-32601, `Method not found: ${method}`);
        }
    }

    private async callTool(params: Record<string, unknown>, sessionHeader: string | null): Promise<unknown> {
        const name = typeof params.name === "string" ? params.name : "";
        const startedAt = Date.now();
        const clientName = sessionHeader ? this.sessions.get(sessionHeader)?.clientName ?? null : null;
        const descriptor = AGENT_TOOLS_BY_NAME.get(name);
        let result: AgentCallResult;
        if (!descriptor) {
            result = {
                ok: false,
                error: { code: "unknown_tool", message: `There is no tool called "${name}".`, hint: "Call tools/list for the tools this server offers." },
            };
        } else {
            const args = params.arguments === undefined || params.arguments === null ? {} : params.arguments;
            const validation = validateAgentArgs(descriptor.inputSchema, args);
            if (!validation.ok) {
                result = {
                    ok: false,
                    error: {
                        code: "invalid_args",
                        message: validation.errors.join("; "),
                        hint: `Check ${name}'s inputSchema in tools/list.`,
                    },
                };
            } else {
                try {
                    result = await this.options.host.callTool(descriptor, args as Record<string, unknown>, { clientName });
                } catch (error) {
                    result = { ok: false, error: { code: "internal", message: describe(error) } };
                }
            }
        }
        const elapsed = Date.now() - startedAt;
        this.options.host.log(
            result.ok ? "info" : "warn",
            `[Agent] ${name || "(no name)"} ${result.ok ? "ok" : result.error.code} in ${elapsed}ms${clientName ? ` (${clientName})` : ""}`,
        );
        return toToolResult(result);
    }
}

/** A tool as `tools/list` describes it. */
export function describeTool(tool: AgentToolDescriptor) {
    return {
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
            title: tool.title,
            readOnlyHint: !tool.write,
            destructiveHint: tool.write,
            openWorldHint: false,
        },
    };
}

/** An answer as MCP's `tools/call` result: a refusal is a result the model reads, not a transport error. */
export function toToolResult(result: AgentCallResult) {
    if (result.ok) {
        return {
            content: result.content,
            ...(result.structured ? { structuredContent: result.structured } : {}),
            isError: false,
        };
    }
    const { code, message, hint } = result.error;
    return {
        content: [{ type: "text", text: `${code}: ${message}${hint ? `\nHint: ${hint}` : ""}` }],
        structuredContent: { error: result.error },
        isError: true,
    };
}

export function missingGuideText(chapter: string): string {
    return `# ${chapter}\n\nThis chapter of the guide is not installed with this copy of NarraLeaf Studio. `
        + "Use the tool descriptions and the catalogue tools (story_commands, ui_widgets, blueprint_nodes) instead.";
}

function makeGamePrompt(workflow: string | null, brief: string): string {
    const parts = [
        "Make a complete visual novel in NarraLeaf Studio, working in the editor the author has open, following the workflow below.",
        "Call agent_status first. Ask the author for anything the brief leaves open that would be costly to guess (title, language, resolution, number of endings) before creating the project.",
    ];
    if (brief) {
        parts.push(`## Brief\n\n${brief}`);
    }
    parts.push(workflow ? `## Workflow\n\n${workflow}` : missingGuideText("workflow"));
    return parts.join("\n\n");
}

function rpcError(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
    return { jsonrpc: "2.0", id, error: { code, message } };
}

function sendJson(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": String(Buffer.byteLength(payload)),
        "Cache-Control": "no-store",
        ...headers,
    });
    res.end(payload);
}

function headerValue(req: http.IncomingMessage, name: string): string | null {
    const value = req.headers[name];
    if (Array.isArray(value)) {
        return value[0] ?? null;
    }
    return typeof value === "string" ? value : null;
}

/**
 * Compare a presented token with the real one without the time taken saying how much of it matched.
 * Both sides are hashed first so `timingSafeEqual` compares equal lengths whatever was sent.
 */
export function tokensEqual(presented: string, expected: string): boolean {
    if (!expected) {
        return false;
    }
    const a = crypto.createHash("sha256").update(presented).digest();
    const b = crypto.createHash("sha256").update(expected).digest();
    return crypto.timingSafeEqual(a, b);
}

function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer | "too-large"> {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > limit) {
        return Promise.resolve("too-large");
    }
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let settled = false;
        req.on("data", (chunk: Buffer) => {
            if (settled) {
                return;
            }
            size += chunk.length;
            if (size > limit) {
                settled = true;
                resolve("too-large");
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => {
            if (!settled) {
                settled = true;
                resolve(Buffer.concat(chunks));
            }
        });
        req.on("error", error => {
            if (!settled) {
                settled = true;
                reject(error);
            }
        });
    });
}

function listen(server: http.Server, port: number): Promise<number> {
    return new Promise((resolve, reject) => {
        const onError = (error: Error) => {
            server.off("listening", onListening);
            reject(error);
        };
        const onListening = () => {
            server.off("error", onError);
            resolve((server.address() as AddressInfo).port);
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, BIND_ADDRESS);
    });
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
