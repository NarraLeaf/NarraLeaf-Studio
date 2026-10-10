import { AGENT_MCP_STDIO_FLAG } from "@shared/agent/settings";

/**
 * The stdio bridge: Studio launched with `--mcp-stdio`, standing between an MCP client that can only
 * start a local program and the Streamable HTTP endpoint the running Studio serves.
 *
 * The client writes newline-delimited JSON-RPC to the bridge's standard input. Each message becomes
 * one POST to the address in `<userData>/agent-mcp.json`, carrying the bearer token from the same
 * file and the `Mcp-Session-Id` the endpoint issued on `initialize`; each answer goes back as one
 * line on standard output. A notification is answered with nothing, as the endpoint answers it with
 * a bare 202. Standard output carries JSON-RPC and nothing else - one stray log line there and the
 * client drops the connection - so everything the bridge has to say goes through {@link AgentStdioBridgeIo.log},
 * which the process wires to standard error.
 *
 * ## Notifications
 *
 * Once the client has sent `notifications/initialized`, the bridge opens the endpoint's notification
 * stream (a GET asking for `text/event-stream`) and copies every JSON-RPC message on it to standard
 * output - today that is `notifications/tools/list_changed`, sent when the plugin tools of the open
 * projects change. A Studio without the stream answers 405 and the bridge simply goes without: the
 * client sees a new tool list the next time it asks. A dropped stream is opened again with the next
 * message the client sends.
 *
 * Everything that touches the process (stdin, stdout, `fetch`, the settings file, starting Studio)
 * comes in through {@link AgentStdioBridgeIo}, so the whole of it runs under a unit test; the
 * Electron side is `agentStdioMain.ts`.
 *
 * ## When there is no endpoint to forward to
 *
 *   - **Agent access is off** (or the profile has never had it configured): every request is
 *     answered with an error that says where to turn it on. `initialize` included - a client that
 *     gets an error there shows the message, where one that gets silence shows only a timeout.
 *     The file is read again on the next request, so switching it on needs no restart of the bridge.
 *   - **Studio is not running** (no address in the file, or nothing answers a `ping` there): the
 *     bridge starts Studio once and waits for the address to come up. A second wait would hold
 *     every later request for the full timeout, so once the first has run out the bridge only looks.
 *   - **The connection is refused mid-session** (Studio quit, or the author moved the port): the
 *     file is read again and the message retried once - safe because a refused connection
 *     delivered nothing. A connection that broke after the request went out is NOT retried: the
 *     edit may have landed, and doing it twice is worse than reporting the failure.
 *
 * Comments in English per project convention.
 */

/** An error code from the range JSON-RPC leaves to the server: agent access is switched off. */
export const AGENT_BRIDGE_DISABLED_CODE = -32001;
/** The same range: Studio could not be reached, or did not come up in time. */
export const AGENT_BRIDGE_UNAVAILABLE_CODE = -32002;

export const AGENT_BRIDGE_DISABLED_MESSAGE =
    "Agent access is turned off in NarraLeaf Studio. Turn it on in Studio's Settings > Agent access, then reconnect.";

/** How long a launch of Studio is waited for, from the moment it is started to a `ping` answered. */
export const AGENT_BRIDGE_STARTUP_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 500;
const PING_TIMEOUT_MS = 3_000;
/** The session is ended on the way out, but a Studio that does not answer does not hold the exit up. */
const CLOSE_TIMEOUT_MS = 2_000;

type JsonRpcId = string | number | null;

/** What the bridge needs from the process around it. */
export interface AgentStdioBridgeIo {
    /** Standard input, in whatever chunks it arrives. Ends when the client closes it. */
    input: AsyncIterable<string | Uint8Array>;
    /** Write one line to standard output. The bridge adds the newline. */
    writeLine(line: string): void;
    /** Diagnostics, for standard error. Never standard output. */
    log(message: string): void;
    fetch: typeof fetch;
    /** `agent-mcp.json` parsed, or null when it is missing or unreadable. */
    readSettings(): Promise<unknown>;
    /**
     * Start Studio in the background, detached from the bridge. Null when the bridge cannot start
     * one that would serve the profile it reads (see `agentStdioMain.ts`).
     */
    launchStudio: (() => void) | null;
    sleep(ms: number): Promise<void>;
    now(): number;
    /** Defaults to {@link AGENT_BRIDGE_STARTUP_TIMEOUT_MS}. */
    startupTimeoutMs?: number;
}

/** Whether this launch is the stdio bridge. */
export function isMcpStdioLaunch(argv: readonly string[]): boolean {
    return argv.includes(AGENT_MCP_STDIO_FLAG);
}

/** `--user-data-dir=<dir>` or `--user-data-dir <dir>`: the profile whose endpoint the bridge reaches. */
export function readMcpStdioUserDataDir(argv: readonly string[]): string | null {
    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if (arg.startsWith("--user-data-dir=")) {
            return arg.slice("--user-data-dir=".length) || null;
        }
        if (arg === "--user-data-dir") {
            const next = argv[index + 1];
            return next && !next.startsWith("--") ? next : null;
        }
    }
    return null;
}

/**
 * Splits standard input into lines. UTF-8 is decoded as a stream, so a character cut in two by a
 * chunk boundary is put back together; a trailing `\r` is dropped (a client on Windows may write
 * CRLF), and blank lines are skipped.
 */
export class JsonLineReader {
    private readonly decoder = new TextDecoder("utf-8");
    private buffer = "";

    public push(chunk: string | Uint8Array): string[] {
        this.buffer += typeof chunk === "string" ? chunk : this.decoder.decode(chunk, { stream: true });
        const lines: string[] = [];
        let newline = this.buffer.indexOf("\n");
        while (newline !== -1) {
            lines.push(this.buffer.slice(0, newline));
            this.buffer = this.buffer.slice(newline + 1);
            newline = this.buffer.indexOf("\n");
        }
        return clean(lines);
    }

    /** Whatever was left without a newline when the input ended. */
    public end(): string[] {
        const rest = this.buffer + this.decoder.decode();
        this.buffer = "";
        return clean([rest]);
    }
}

function clean(lines: string[]): string[] {
    return lines.map(line => line.endsWith("\r") ? line.slice(0, -1) : line).filter(line => line.trim() !== "");
}

type Endpoint = { url: string; token: string };
type Resolution =
    | { kind: "ready"; endpoint: Endpoint }
    | { kind: "disabled" }
    | { kind: "unavailable"; message: string };

type ReadSettings =
    | { enabled: false }
    | { enabled: true; url: string | null; token: string };

/**
 * Run the bridge until the input ends and every message already read has been answered.
 * Never rejects; a failure to reach Studio is an answer, not an exception.
 */
export async function runAgentStdioBridge(io: AgentStdioBridgeIo): Promise<void> {
    const bridge = new AgentStdioBridge(io);
    const reader = new JsonLineReader();
    for await (const chunk of io.input) {
        for (const line of reader.push(chunk)) {
            bridge.accept(line);
        }
    }
    for (const line of reader.end()) {
        bridge.accept(line);
    }
    await bridge.close();
}

class AgentStdioBridge {
    private endpoint: Endpoint | null = null;
    private session: string | null = null;
    /** The client's own `initialize` params, replayed to a Studio that came back, to get a session there. */
    private initializeParams: unknown = undefined;
    private resolving: Promise<Resolution> | null = null;
    private launched = false;
    /** The one launch has been waited for in full; from now on the bridge only looks. */
    private launchWaitSpent = false;
    private replaying: Promise<void> | null = null;
    private readonly inFlight = new Set<Promise<void>>();
    /** The session a notification stream is open (or being opened) for. */
    private streamSession: string | null = null;
    private streamAbort: AbortController | null = null;
    private closing = false;

    constructor(private readonly io: AgentStdioBridgeIo) {}

    /** One line from the client. Messages are forwarded concurrently: a long tool call must not hold up a `ping`. */
    public accept(line: string): void {
        const task = this.handle(line).catch(error => {
            this.io.log(`[Bridge] Unexpected failure: ${describe(error)}`);
        });
        this.inFlight.add(task);
        void task.finally(() => this.inFlight.delete(task));
    }

    public async close(): Promise<void> {
        while (this.inFlight.size > 0) {
            await Promise.all([...this.inFlight]);
        }
        this.closing = true;
        this.streamAbort?.abort();
        this.streamAbort = null;
        const endpoint = this.endpoint;
        const session = this.session;
        if (!endpoint || !session) {
            return;
        }
        // The endpoint forgets sessions on its own; this only keeps its list short.
        try {
            await this.io.fetch(endpoint.url, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${endpoint.token}`, "Mcp-Session-Id": session },
                signal: AbortSignal.timeout(CLOSE_TIMEOUT_MS),
            });
        } catch {
            // Studio already gone: nothing to end.
        }
    }

    private async handle(line: string): Promise<void> {
        let message: unknown;
        try {
            message = JSON.parse(line);
        } catch {
            this.write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
            return;
        }
        const ids = requestIds(message);
        if (isInitialize(message)) {
            this.initializeParams = (message as { params?: unknown }).params;
        }
        await this.forward(line, message, ids, false);
        // The client is ready for notifications once it says it is initialized; a stream that was
        // open and dropped is opened again with whatever the client sends next.
        if (isInitializedNotification(message) || (this.streamSession === null && this.session && !isInitialize(message))) {
            await this.openStream();
        }
    }

    /**
     * Open the endpoint's notification stream for the current session and relay it in the
     * background. Resolves once the endpoint has answered the GET, so the order of requests is the
     * order a reader of the log expects; the relaying itself is never waited for.
     */
    private async openStream(): Promise<void> {
        const endpoint = this.endpoint;
        const session = this.session;
        if (!endpoint || !session || this.closing || this.streamSession === session) {
            return;
        }
        this.streamSession = session;
        this.streamAbort?.abort();
        const controller = new AbortController();
        this.streamAbort = controller;
        let response: Response;
        try {
            response = await this.io.fetch(endpoint.url, {
                method: "GET",
                headers: { Accept: "text/event-stream", Authorization: `Bearer ${endpoint.token}`, "Mcp-Session-Id": session },
                signal: controller.signal,
            });
        } catch {
            return;
        }
        if (!response.ok || !response.body || !(response.headers.get("content-type") ?? "").includes("text/event-stream")) {
            // An older Studio: no stream. The client still sees changes on its next tools/list.
            await response.body?.cancel().catch(() => undefined);
            return;
        }
        void this.relay(response.body, controller);
    }

    private async relay(body: ReadableStream<Uint8Array>, controller: AbortController): Promise<void> {
        const reader = body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }
                buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
                let boundary = buffer.indexOf("\n\n");
                while (boundary !== -1) {
                    this.relayEvent(buffer.slice(0, boundary));
                    buffer = buffer.slice(boundary + 2);
                    boundary = buffer.indexOf("\n\n");
                }
            }
        } catch {
            // Aborted on the way out, or Studio went away: the next message reopens it.
        } finally {
            if (this.streamAbort === controller) {
                this.streamAbort = null;
                this.streamSession = null;
            }
        }
    }

    /** One server-sent event: its `data:` lines joined, written out if they are a JSON-RPC message. */
    private relayEvent(event: string): void {
        const data = event
            .split("\n")
            .filter(line => line.startsWith("data:"))
            .map(line => line.slice(5).replace(/^ /, ""))
            .join("\n");
        if (!data || this.closing) {
            return;
        }
        try {
            const message = JSON.parse(data);
            if (isJsonRpcAnswer(message)) {
                this.write(message);
            }
        } catch {
            this.io.log("[Bridge] Ignored a notification that is not JSON.");
        }
    }

    private async forward(body: string, message: unknown, ids: JsonRpcId[], retried: boolean): Promise<void> {
        const resolution = await this.ensureEndpoint();
        if (resolution.kind === "disabled") {
            this.fail(ids, AGENT_BRIDGE_DISABLED_CODE, AGENT_BRIDGE_DISABLED_MESSAGE);
            return;
        }
        if (resolution.kind === "unavailable") {
            this.fail(ids, AGENT_BRIDGE_UNAVAILABLE_CODE, resolution.message);
            return;
        }

        let response: Response;
        try {
            response = await this.post(resolution.endpoint, body);
        } catch (error) {
            if (!retried && isConnectionRefused(error)) {
                // Nothing was delivered, so trying again cannot do anything twice.
                this.forget(resolution.endpoint);
                await this.reconnect(message);
                await this.forward(body, message, ids, true);
                return;
            }
            this.fail(ids, AGENT_BRIDGE_UNAVAILABLE_CODE, `Lost the connection to NarraLeaf Studio: ${describe(error)}`);
            return;
        }

        if (response.status === 401 && !retried) {
            // The token was replaced in Settings. Refused before anything was read, so safe to retry.
            await response.body?.cancel().catch(() => undefined);
            this.forget(resolution.endpoint);
            await this.reconnect(message);
            await this.forward(body, message, ids, true);
            return;
        }

        const issued = response.headers.get("mcp-session-id");
        if (issued) {
            this.session = issued;
        }
        const text = await response.text().catch(() => "");
        if (text.trim() === "") {
            if (!response.ok) {
                this.fail(ids, AGENT_BRIDGE_UNAVAILABLE_CODE, `NarraLeaf Studio answered HTTP ${response.status}.`);
            }
            // 202: notifications only. Nothing to write.
            return;
        }
        let answer: unknown;
        try {
            answer = JSON.parse(text);
        } catch {
            this.fail(ids, AGENT_BRIDGE_UNAVAILABLE_CODE, `NarraLeaf Studio answered something that is not JSON (HTTP ${response.status}).`);
            return;
        }
        if (isJsonRpcAnswer(answer)) {
            this.write(answer);
            return;
        }
        // The endpoint's own refusals (403, 413, 404) are plain `{ error }` objects, not JSON-RPC.
        const reason = answer && typeof answer === "object" && typeof (answer as { error?: unknown }).error === "string"
            ? (answer as { error: string }).error
            : `HTTP ${response.status}`;
        this.fail(ids, AGENT_BRIDGE_UNAVAILABLE_CODE, `NarraLeaf Studio refused the request: ${reason}`);
    }

    private post(endpoint: Endpoint, body: string): Promise<Response> {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            Authorization: `Bearer ${endpoint.token}`,
        };
        if (this.session) {
            headers["Mcp-Session-Id"] = this.session;
        }
        return this.io.fetch(endpoint.url, { method: "POST", headers, body });
    }

    /** Drop an endpoint that stopped answering, unless a concurrent message already replaced it. */
    private forget(endpoint: Endpoint): void {
        if (this.endpoint === endpoint) {
            this.endpoint = null;
            this.session = null;
        }
    }

    /**
     * Find the endpoint again and give it the client's `initialize`, so the session there carries
     * the client's name - a Studio that restarted has never heard of the old session. Not done for
     * an `initialize` that is itself about to be retried.
     */
    private async reconnect(message: unknown): Promise<void> {
        const resolution = await this.ensureEndpoint();
        if (resolution.kind !== "ready" || isInitialize(message) || this.initializeParams === undefined || this.session) {
            return;
        }
        // Messages refused together all land here; one replay serves them all.
        this.replaying ??= this.replayInitialize(resolution.endpoint).finally(() => {
            this.replaying = null;
        });
        await this.replaying;
    }

    private async replayInitialize(endpoint: Endpoint): Promise<void> {
        try {
            const replay = await this.post(endpoint, JSON.stringify({
                jsonrpc: "2.0", id: "narraleaf-bridge-reinitialize", method: "initialize", params: this.initializeParams,
            }));
            const issued = replay.headers.get("mcp-session-id");
            await replay.text().catch(() => "");
            if (issued) {
                this.session = issued;
                const initialized = await this.post(endpoint, JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
                await initialized.text().catch(() => "");
            }
        } catch (error) {
            this.io.log(`[Bridge] Could not start a session with the restarted Studio: ${describe(error)}`);
        }
    }

    /** The endpoint, found once and shared: concurrent messages wait on the same search and the same launch. */
    private ensureEndpoint(): Promise<Resolution> {
        if (this.endpoint) {
            return Promise.resolve({ kind: "ready", endpoint: this.endpoint });
        }
        if (!this.resolving) {
            this.resolving = this.resolve().then(resolution => {
                if (resolution.kind === "ready") {
                    this.endpoint = resolution.endpoint;
                }
                return resolution;
            }).finally(() => {
                this.resolving = null;
            });
        }
        return this.resolving;
    }

    private async resolve(): Promise<Resolution> {
        const first = await this.look();
        if (first.kind !== "unavailable") {
            return first;
        }
        if (this.launched) {
            if (this.launchWaitSpent) {
                return first;
            }
        } else {
            if (!this.io.launchStudio) {
                return { kind: "unavailable", message: "NarraLeaf Studio is not running on this profile. Open it, then reconnect." };
            }
            this.launched = true;
            this.io.log("[Bridge] NarraLeaf Studio is not serving agent access; starting it.");
            try {
                this.io.launchStudio();
            } catch (error) {
                this.launchWaitSpent = true;
                return { kind: "unavailable", message: `NarraLeaf Studio could not be started: ${describe(error)}` };
            }
        }
        const deadline = this.io.now() + (this.io.startupTimeoutMs ?? AGENT_BRIDGE_STARTUP_TIMEOUT_MS);
        while (this.io.now() < deadline) {
            await this.io.sleep(POLL_INTERVAL_MS);
            const next = await this.look();
            if (next.kind !== "unavailable") {
                return next;
            }
        }
        this.launchWaitSpent = true;
        return {
            kind: "unavailable",
            message: "NarraLeaf Studio did not start serving agent access in time. Open Studio, check Settings > Agent access, then reconnect.",
        };
    }

    /** One look at the file and, when it names an address, one `ping` there. */
    private async look(): Promise<Resolution> {
        const settings = readBridgeSettings(await this.io.readSettings().catch(() => null));
        if (!settings.enabled) {
            return { kind: "disabled" };
        }
        if (settings.url && await this.ping({ url: settings.url, token: settings.token })) {
            return { kind: "ready", endpoint: { url: settings.url, token: settings.token } };
        }
        return { kind: "unavailable", message: "NarraLeaf Studio is not running." };
    }

    private async ping(endpoint: Endpoint): Promise<boolean> {
        try {
            const response = await this.io.fetch(endpoint.url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json, text/event-stream",
                    Authorization: `Bearer ${endpoint.token}`,
                },
                body: JSON.stringify({ jsonrpc: "2.0", id: "narraleaf-bridge-ping", method: "ping" }),
                signal: AbortSignal.timeout(PING_TIMEOUT_MS),
            });
            await response.text().catch(() => "");
            return response.ok;
        } catch {
            return false;
        }
    }

    private fail(ids: JsonRpcId[], code: number, message: string): void {
        for (const id of ids) {
            this.write({ jsonrpc: "2.0", id, error: { code, message } });
        }
    }

    private write(message: unknown): void {
        this.io.writeLine(JSON.stringify(message));
    }
}

/** What the file says, reduced to what the bridge acts on. A token too short to be one is treated as no file. */
function readBridgeSettings(raw: unknown): ReadSettings {
    const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
    if (!record || record.enabled !== true || typeof record.token !== "string" || record.token.length === 0) {
        return { enabled: false };
    }
    return { enabled: true, url: typeof record.url === "string" && record.url ? record.url : null, token: record.token };
}

/** The ids of the requests in a message or a batch - the ones that must be answered, whatever happens. */
function requestIds(message: unknown): JsonRpcId[] {
    const entries = Array.isArray(message) ? message : [message];
    const ids: JsonRpcId[] = [];
    for (const entry of entries) {
        if (!entry || typeof entry !== "object") {
            continue;
        }
        const record = entry as { id?: unknown; method?: unknown };
        if (typeof record.method === "string" && (typeof record.id === "string" || typeof record.id === "number")) {
            ids.push(record.id);
        }
    }
    return ids;
}

function isInitializedNotification(message: unknown): boolean {
    return !!message && typeof message === "object" && !Array.isArray(message)
        && (message as { method?: unknown }).method === "notifications/initialized";
}

function isInitialize(message: unknown): boolean {
    return !!message && typeof message === "object" && !Array.isArray(message)
        && (message as { method?: unknown }).method === "initialize";
}

function isJsonRpcAnswer(value: unknown): boolean {
    if (Array.isArray(value)) {
        return value.length > 0 && value.every(isJsonRpcAnswer);
    }
    return !!value && typeof value === "object" && (value as { jsonrpc?: unknown }).jsonrpc === "2.0";
}

/** `fetch` rejects with "fetch failed" and the socket's error as its cause. */
function isConnectionRefused(error: unknown): boolean {
    const code = (error as { cause?: { code?: unknown }; code?: unknown } | null)?.cause?.code
        ?? (error as { code?: unknown } | null)?.code;
    return code === "ECONNREFUSED";
}

function describe(error: unknown): string {
    if (error instanceof Error) {
        const cause = (error as { cause?: unknown }).cause;
        return cause instanceof Error ? `${error.message} (${cause.message})` : error.message;
    }
    return String(error);
}
