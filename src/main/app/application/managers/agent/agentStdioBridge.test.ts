import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    AGENT_BRIDGE_DISABLED_CODE,
    AGENT_BRIDGE_UNAVAILABLE_CODE,
    JsonLineReader,
    isMcpStdioLaunch,
    readMcpStdioUserDataDir,
    runAgentStdioBridge,
    type AgentStdioBridgeIo,
} from "./agentStdioBridge";

const TOKEN = "t".repeat(43);
const URL_A = "http://127.0.0.1:47219/mcp";

type Posted = { url: string; method: string; headers: Record<string, string>; body: unknown };

/**
 * A stand-in for the running Studio: answers `fetch` the way `AgentMcpServer` does, and can be
 * switched off (connection refused) or moved to another address.
 */
function fakeStudio(options: { up?: boolean; url?: string; token?: string } = {}) {
    const state = {
        up: options.up ?? true,
        url: options.url ?? URL_A,
        token: options.token ?? TOKEN,
        sessionCounter: 0,
        posted: [] as Posted[],
    };
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
        if (!state.up || url !== state.url) {
            throw new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });
        }
        state.posted.push({ url, method: init?.method ?? "GET", headers, body });
        if (headers.authorization !== `Bearer ${state.token}`) {
            return json(401, { error: "Missing or wrong bearer token." });
        }
        if (init?.method === "DELETE") {
            return new Response(null, { status: 200 });
        }
        const messages = Array.isArray(body) ? body : [body];
        const answers: unknown[] = [];
        let issued: string | null = null;
        for (const message of messages) {
            if (typeof message.id !== "string" && typeof message.id !== "number") {
                continue;
            }
            if (message.method === "initialize") {
                issued = `session-${++state.sessionCounter}`;
                answers.push({ jsonrpc: "2.0", id: message.id, result: { serverInfo: { name: "narraleaf-studio" } } });
            } else if (message.method === "tools/call" && message.params?.name === "too_big") {
                return json(413, { error: "Request body exceeds 4194304 bytes." });
            } else {
                answers.push({ jsonrpc: "2.0", id: message.id, result: { echo: message.method, session: headers["mcp-session-id"] ?? null } });
            }
        }
        const extra: Record<string, string> = issued ? { "Mcp-Session-Id": issued } : {};
        if (answers.length === 0) {
            return new Response(null, { status: 202, headers: extra });
        }
        return json(200, Array.isArray(body) ? answers : answers[0], extra);
    });
    return { state, fetchImpl };
}

function json(status: number, value: unknown, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", ...headers } });
}

async function* chunks(...parts: (string | Uint8Array)[]): AsyncIterable<string | Uint8Array> {
    for (const part of parts) {
        yield part;
    }
}

function line(message: unknown): string {
    return `${JSON.stringify(message)}\n`;
}

/** Run the bridge over `input` and return what it wrote to stdout, parsed. */
async function run(
    input: AsyncIterable<string | Uint8Array>,
    overrides: Partial<AgentStdioBridgeIo> & { settings?: () => unknown } = {},
): Promise<{ out: any[]; logs: string[] }> {
    const out: any[] = [];
    const logs: string[] = [];
    let clock = 0;
    const io: AgentStdioBridgeIo = {
        input,
        writeLine: text => {
            expect(text).not.toContain("\n");
            out.push(JSON.parse(text));
        },
        log: message => logs.push(message),
        fetch: fakeStudio().fetchImpl as unknown as typeof fetch,
        readSettings: async () => overrides.settings ? overrides.settings() : { enabled: true, token: TOKEN, url: URL_A },
        launchStudio: null,
        sleep: async ms => {
            clock += ms;
        },
        now: () => clock,
        ...overrides,
    };
    await runAgentStdioBridge(io);
    return { out, logs };
}

const byId = (out: any[], id: unknown) => out.find(entry => entry.id === id);
let captured: any[] = [];

describe("command line", () => {
    it("recognises the flag and the profile override", () => {
        expect(isMcpStdioLaunch(["/Studio", "--mcp-stdio"])).toBe(true);
        expect(isMcpStdioLaunch(["/Studio"])).toBe(false);
        expect(readMcpStdioUserDataDir(["/Studio", "--mcp-stdio", "--user-data-dir=/p"])).toBe("/p");
        expect(readMcpStdioUserDataDir(["/Studio", "--user-data-dir", "/q", "--mcp-stdio"])).toBe("/q");
        expect(readMcpStdioUserDataDir(["/Studio", "--user-data-dir", "--mcp-stdio"])).toBeNull();
        expect(readMcpStdioUserDataDir(["/Studio", "--mcp-stdio"])).toBeNull();
    });
});

describe("JsonLineReader", () => {
    it("joins partial chunks, splits several messages in one chunk, and drops CR and blank lines", () => {
        const reader = new JsonLineReader();
        expect(reader.push('{"a":')).toEqual([]);
        expect(reader.push('1}\r\n{"b":2}\n\n{"c"')).toEqual(['{"a":1}', '{"b":2}']);
        expect(reader.push(':3}\n')).toEqual(['{"c":3}']);
        expect(reader.end()).toEqual([]);
    });

    it("puts a UTF-8 character split across chunks back together", () => {
        const bytes = new TextEncoder().encode('{"text":"台词"}\n');
        const reader = new JsonLineReader();
        expect(reader.push(bytes.slice(0, 11))).toEqual([]);
        expect(reader.push(bytes.slice(11))).toEqual(['{"text":"台词"}']);
    });

    it("keeps a last message that has no newline", () => {
        const reader = new JsonLineReader();
        reader.push('{"a":1}');
        expect(reader.end()).toEqual(['{"a":1}']);
    });
});

describe("runAgentStdioBridge", () => {
    beforeEach(() => {
        captured = [];
    });

    it("forwards requests, answers each on one line, and says nothing for notifications", async () => {
        const studio = fakeStudio();
        const { out } = await run(chunks(
            line({ jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "Claude Desktop" } } }),
            line({ jsonrpc: "2.0", method: "notifications/initialized" }) + line({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
        ), { fetch: studio.fetchImpl as unknown as typeof fetch });
        expect(out).toHaveLength(2);
        expect(byId(out, 1).result.serverInfo.name).toBe("narraleaf-studio");
        expect(byId(out, 2).result.echo).toBe("tools/list");
        // The notification reached Studio all the same.
        expect(studio.state.posted.some(post => (post.body as any)?.method === "notifications/initialized")).toBe(true);
    });

    it("opens the notification stream once the client is initialized and relays what Studio pushes", async () => {
        const studio = fakeStudio();
        const streamed: Record<string, string>[] = [];
        let push: ((text: string) => void) | null = null;
        const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
            if ((init?.method ?? "GET") === "GET") {
                streamed.push(Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])));
                const stream = new ReadableStream<Uint8Array>({
                    start(controller) {
                        push = text => controller.enqueue(new TextEncoder().encode(text));
                        init?.signal?.addEventListener("abort", () => controller.error(new Error("aborted")));
                    },
                });
                return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
            }
            return studio.fetchImpl(input, init);
        }) as unknown as typeof fetch;
        const lines: any[] = [];
        let relayed: () => void = () => undefined;
        const arrived = new Promise<void>(resolve => {
            relayed = resolve;
        });
        async function* input() {
            yield line({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
            yield line({ jsonrpc: "2.0", method: "notifications/initialized" });
            while (!push) {
                await new Promise(resolve => setTimeout(resolve, 5));
            }
            push!(": hello\n\nevent: message\ndata: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/tools/list_changed\"}\n\n");
            await arrived;
        }
        await run(input(), {
            fetch: fetchImpl,
            writeLine: text => {
                const message = JSON.parse(text);
                lines.push(message);
                if (message.method === "notifications/tools/list_changed") {
                    relayed();
                }
            },
        });
        expect(streamed).toHaveLength(1);
        expect(streamed[0]).toMatchObject({ accept: "text/event-stream", "mcp-session-id": "session-1", authorization: `Bearer ${TOKEN}` });
        expect(lines).toContainEqual({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
    });

    it("carries the session id initialize returned on every later message, and ends it on the way out", async () => {
        const studio = fakeStudio();
        // A gate, so the second message is only read once the first has been answered - as a client does.
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        async function* input() {
            yield line({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
            await gate;
            yield line({ jsonrpc: "2.0", id: 2, method: "tools/list" });
        }
        const out: any[] = [];
        const done = runAgentStdioBridge({
            input: input(),
            writeLine: text => {
                out.push(JSON.parse(text));
                release();
            },
            log: () => undefined,
            fetch: studio.fetchImpl as unknown as typeof fetch,
            readSettings: async () => ({ enabled: true, token: TOKEN, url: URL_A }),
            launchStudio: null,
            sleep: async () => undefined,
            now: () => 0,
        });
        await done;
        expect(byId(out, 2).result.session).toBe("session-1");
        const last = studio.state.posted[studio.state.posted.length - 1];
        expect(last.method).toBe("DELETE");
        expect(last.headers["mcp-session-id"]).toBe("session-1");
    });

    it("passes a batch through and answers it as one line", async () => {
        const studio = fakeStudio();
        const { out } = await run(chunks(line([
            { jsonrpc: "2.0", id: "a", method: "ping" },
            { jsonrpc: "2.0", method: "notifications/cancelled" },
            { jsonrpc: "2.0", id: "b", method: "tools/list" },
        ])), { fetch: studio.fetchImpl as unknown as typeof fetch });
        expect(out).toHaveLength(1);
        expect(out[0].map((entry: any) => entry.id)).toEqual(["a", "b"]);
    });

    it("answers a line that is not JSON with a parse error", async () => {
        const { out } = await run(chunks("{nope\n"));
        expect(out).toEqual([{ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }]);
    });

    it("answers every request, initialize included, with the switch-it-on error while agent access is off", async () => {
        const studio = fakeStudio();
        const { out } = await run(chunks(
            line({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
            line({ jsonrpc: "2.0", method: "notifications/initialized" }),
            line({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
        ), {
            fetch: studio.fetchImpl as unknown as typeof fetch,
            settings: () => ({ enabled: false, token: TOKEN, url: null }),
        });
        expect(out).toHaveLength(2);
        for (const entry of out) {
            expect(entry.error.code).toBe(AGENT_BRIDGE_DISABLED_CODE);
            expect(entry.error.message).toContain("Settings > Agent access");
        }
        expect(studio.fetchImpl).not.toHaveBeenCalled();
    });

    it("treats a missing settings file as agent access never switched on", async () => {
        const { out } = await run(chunks(line({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })), {
            settings: () => null,
        });
        expect(out[0].error.code).toBe(AGENT_BRIDGE_DISABLED_CODE);
    });

    it("starts Studio when nothing is serving, and forwards once the endpoint answers", async () => {
        const studio = fakeStudio({ up: false });
        let url: string | null = null;
        const launchStudio = vi.fn(() => {
            // Studio comes up and writes its address a moment later.
            studio.state.up = true;
            url = URL_A;
        });
        const { out } = await run(chunks(
            line({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
            line({ jsonrpc: "2.0", id: 2, method: "ping" }),
        ), {
            fetch: studio.fetchImpl as unknown as typeof fetch,
            settings: () => ({ enabled: true, token: TOKEN, url }),
            launchStudio,
        });
        expect(launchStudio).toHaveBeenCalledTimes(1);
        expect(byId(out, 1).result).toBeDefined();
        expect(byId(out, 2).result).toBeDefined();
    });

    it("gives up after the startup timeout, launches only once, and then only looks", async () => {
        const studio = fakeStudio({ up: false });
        const launchStudio = vi.fn();
        const sleep = vi.fn(async () => undefined);
        let clock = 0;
        let answered!: () => void;
        const firstAnswer = new Promise<void>(resolve => { answered = resolve; });
        let sleepsBeforeSecond = -1;
        async function* input() {
            yield line({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
            await firstAnswer;
            sleepsBeforeSecond = sleep.mock.calls.length;
            yield line({ jsonrpc: "2.0", id: 2, method: "tools/list" });
        }
        await run(input(), {
            writeLine: text => {
                captured.push(JSON.parse(text));
                answered();
            },
            fetch: studio.fetchImpl as unknown as typeof fetch,
            settings: () => ({ enabled: true, token: TOKEN, url: URL_A }),
            launchStudio,
            sleep: async ms => {
                await sleep();
                clock += ms;
            },
            now: () => clock,
            startupTimeoutMs: 5_000,
        });
        expect(byId(captured, 1).error.code).toBe(AGENT_BRIDGE_UNAVAILABLE_CODE);
        expect(byId(captured, 1).error.message).toContain("did not start");
        expect(byId(captured, 2).error.code).toBe(AGENT_BRIDGE_UNAVAILABLE_CODE);
        expect(launchStudio).toHaveBeenCalledTimes(1);
        expect(sleepsBeforeSecond).toBeGreaterThan(0);
        // The second request looked once and answered, without a second wait.
        expect(sleep.mock.calls.length).toBe(sleepsBeforeSecond);
    });

    it("says Studio is not running, without waiting, when it may not start one", async () => {
        const studio = fakeStudio({ up: false });
        const sleep = vi.fn(async () => undefined);
        const { out } = await run(chunks(line({ jsonrpc: "2.0", id: 7, method: "tools/list" })), {
            fetch: studio.fetchImpl as unknown as typeof fetch,
            launchStudio: null,
            sleep,
        });
        expect(out[0]).toMatchObject({ id: 7, error: { code: AGENT_BRIDGE_UNAVAILABLE_CODE } });
        expect(out[0].error.message).toContain("not running");
        expect(sleep).not.toHaveBeenCalled();
    });

    it("follows Studio to its new address after a refused connection, and starts a session there", async () => {
        const studio = fakeStudio();
        let url = URL_A;
        let release!: () => void;
        let gate = new Promise<void>(resolve => { release = resolve; });
        async function* input() {
            yield line({ jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "c" } } });
            await gate;
            // Studio restarts on another port before the next message.
            url = "http://127.0.0.1:50000/mcp";
            studio.state.url = url;
            yield line({ jsonrpc: "2.0", id: 2, method: "tools/list" });
        }
        const out: any[] = [];
        await runAgentStdioBridge({
            input: input(),
            writeLine: text => {
                out.push(JSON.parse(text));
                release();
                gate = Promise.resolve();
            },
            log: () => undefined,
            fetch: studio.fetchImpl as unknown as typeof fetch,
            readSettings: async () => ({ enabled: true, token: TOKEN, url }),
            launchStudio: null,
            sleep: async () => undefined,
            now: () => 0,
        });
        expect(byId(out, 2).result.echo).toBe("tools/list");
        // The client's initialize was replayed to the new Studio, and its session used.
        expect(byId(out, 2).result.session).toBe("session-2");
        expect(out.some(entry => entry.id === "narraleaf-bridge-reinitialize")).toBe(false);
    });

    it("rereads the token after a 401 and retries once", async () => {
        const studio = fakeStudio();
        let token = TOKEN;
        let answered!: () => void;
        const firstAnswer = new Promise<void>(resolve => { answered = resolve; });
        async function* input() {
            yield line({ jsonrpc: "2.0", id: 1, method: "ping" });
            await firstAnswer;
            // The author replaces the token in Settings between two messages.
            token = "n".repeat(43);
            studio.state.token = token;
            yield line({ jsonrpc: "2.0", id: 2, method: "tools/list" });
        }
        const { out } = await run(input(), {
            fetch: studio.fetchImpl as unknown as typeof fetch,
            settings: () => ({ enabled: true, token, url: URL_A }),
            writeLine: text => {
                captured.push(JSON.parse(text));
                answered();
            },
        });
        expect(out).toEqual([]);
        expect(byId(captured, 2).result.echo).toBe("tools/list");
        expect(studio.state.posted.filter(post => post.headers.authorization === `Bearer ${TOKEN}` && (post.body as any)?.id === 2)).toHaveLength(1);
    });

    it("turns the endpoint's own refusals into JSON-RPC errors for the request", async () => {
        const studio = fakeStudio();
        const { out } = await run(chunks(line({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "too_big" } })), {
            fetch: studio.fetchImpl as unknown as typeof fetch,
        });
        expect(out[0]).toMatchObject({ id: 9, error: { code: AGENT_BRIDGE_UNAVAILABLE_CODE } });
        expect(out[0].error.message).toContain("exceeds");
    });

    it("does not retry a request whose connection broke after it was sent", async () => {
        let calls = 0;
        const fetchImpl = vi.fn(async (_input: unknown, init?: RequestInit) => {
            const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
            if (body?.method === "ping" && body.id === "narraleaf-bridge-ping") {
                return json(200, { jsonrpc: "2.0", id: body.id, result: {} });
            }
            calls++;
            throw new TypeError("fetch failed", { cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }) });
        });
        const { out } = await run(chunks(line({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "story_write" } })), {
            fetch: fetchImpl as unknown as typeof fetch,
        });
        expect(calls).toBe(1);
        expect(out[0]).toMatchObject({ id: 3, error: { code: AGENT_BRIDGE_UNAVAILABLE_CODE } });
        expect(out[0].error.message).toContain("Lost the connection");
    });

    it("sends the client's messages through the untimed fetch, and the ping, the stream and the goodbye through fetch", async () => {
        const studio = fakeStudio();
        const methodOf = (init?: RequestInit) => typeof init?.body === "string"
            ? (JSON.parse(init.body) as { method?: string }).method
            : init?.method;
        const timed = vi.fn((input: string | URL | Request, init?: RequestInit) => studio.fetchImpl(input, init));
        const untimed = vi.fn((url: string, init: RequestInit) => studio.fetchImpl(url, init));
        const { out } = await run(chunks(
            line({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
            line({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "build" } }),
        ), { fetch: timed as unknown as typeof fetch, fetchUntimed: untimed });
        expect(out.map(entry => entry.id).sort()).toEqual([1, 2]);
        expect(untimed.mock.calls.map(([, init]) => methodOf(init))).toEqual(["initialize", "tools/call"]);
        expect(timed.mock.calls.map(([, init]) => methodOf(init))).toEqual(["ping", "GET", "DELETE"]);
    });
});

describe("runAgentStdioBridge against the real endpoint", () => {
    it("initializes, lists tools and calls one over real HTTP, messages going the untimed way the process sends them", async () => {
        const { AgentMcpServer } = await import("./agentMcpServer");
        const { agentText } = await import("@shared/agent/protocol");
        const { fetchWithoutTimeouts } = await import("./agentStdioMain");
        // A tool that answers late: the headers of its POST come only once it has.
        const callTool = vi.fn(async () => {
            await new Promise(resolve => setTimeout(resolve, 100));
            return agentText("done", { value: 1 });
        });
        const server = new AgentMcpServer({
            port: 0,
            token: () => TOKEN,
            host: { callTool, readGuide: async () => null, version: () => "9.9.9", log: () => undefined },
        });
        const port = await server.start();
        try {
            const url = `http://127.0.0.1:${port}/mcp`;
            const out: any[] = [];
            let answered = 0;
            let wake: (() => void) | null = null;
            const waitFor = async (count: number) => {
                while (answered < count) {
                    await new Promise<void>(resolve => { wake = resolve; });
                }
            };
            async function* input() {
                yield line({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "stdio-test" } } });
                await waitFor(1);
                yield line({ jsonrpc: "2.0", method: "notifications/initialized" });
                yield line({ jsonrpc: "2.0", id: 2, method: "tools/list" });
                await waitFor(2);
                yield line({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "agent_status", arguments: {} } });
            }
            await runAgentStdioBridge({
                input: input(),
                writeLine: text => {
                    out.push(JSON.parse(text));
                    answered++;
                    wake?.();
                },
                log: () => undefined,
                fetch,
                fetchUntimed: fetchWithoutTimeouts,
                readSettings: async () => ({ enabled: true, token: TOKEN, url }),
                launchStudio: null,
                sleep: async () => undefined,
                now: () => 0,
            });
            expect(out).toHaveLength(3);
            expect(byId(out, 1).result.serverInfo).toBeDefined();
            expect(Array.isArray(byId(out, 2).result.tools)).toBe(true);
            expect(byId(out, 3).result.content[0].text).toContain("done");
            expect(callTool).toHaveBeenCalledWith(expect.objectContaining({ name: "agent_status" }), {}, { clientName: "stdio-test" });
        } finally {
            await server.stop();
        }
    });
});
