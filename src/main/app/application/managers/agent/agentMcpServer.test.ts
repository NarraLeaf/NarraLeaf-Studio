import http from "http";
import net from "net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_MCP_PATH, AGENT_MCP_PROTOCOL_VERSIONS, agentRefusal, agentText } from "@shared/agent/protocol";
import { AGENT_GUIDE_CHAPTERS, AGENT_TOOLS } from "@shared/agent/tools";
import { AGENT_MCP_BODY_LIMIT, AgentMcpServer, describeTool, tokensEqual, type AgentMcpHost } from "./agentMcpServer";

const TOKEN = "t".repeat(43);

type Reply = { status: number; headers: http.IncomingHttpHeaders; body: string; json: () => any };

function request(
    port: number,
    options: { method?: string; path?: string; headers?: Record<string, string>; body?: string | Buffer } = {},
): Promise<Reply> {
    return new Promise((resolve, reject) => {
        const req = http.request({
            host: "127.0.0.1",
            port,
            method: options.method ?? "POST",
            path: options.path ?? AGENT_MCP_PATH,
            headers: {
                Host: `127.0.0.1:${port}`,
                Authorization: `Bearer ${TOKEN}`,
                "Content-Type": "application/json",
                ...options.headers,
            },
        }, res => {
            const chunks: Buffer[] = [];
            res.on("data", chunk => chunks.push(chunk));
            res.on("end", () => {
                const body = Buffer.concat(chunks).toString("utf8");
                resolve({ status: res.statusCode ?? 0, headers: res.headers, body, json: () => JSON.parse(body) });
            });
        });
        req.on("error", reject);
        if (options.body !== undefined) {
            req.write(options.body);
        }
        req.end();
    });
}

function rpc(port: number, method: string, params: unknown = {}, headers: Record<string, string> = {}) {
    return request(port, { body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), headers });
}

describe("AgentMcpServer", () => {
    let server: AgentMcpServer;
    let port: number;
    let host: AgentMcpHost & { callTool: ReturnType<typeof vi.fn>; log: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        host = {
            callTool: vi.fn(async () => agentText("done", { value: 1 })),
            readGuide: vi.fn(async chapter => (chapter === "workflow" ? "# Workflow\n\nStep one." : null)),
            version: () => "9.9.9",
            log: vi.fn(),
        };
        server = new AgentMcpServer({ port: 0, token: () => TOKEN, host });
        port = await server.start();
    });

    afterEach(async () => {
        await server.stop();
    });

    describe("refuses before reading anything", () => {
        it("a request without a token, or with the wrong one", async () => {
            const missing = await request(port, { headers: { Authorization: "" }, body: "{}" });
            expect(missing.status).toBe(401);
            expect(missing.headers["www-authenticate"]).toBe("Bearer");
            const wrong = await request(port, { headers: { Authorization: "Bearer nope" }, body: "{}" });
            expect(wrong.status).toBe(401);
            expect(host.callTool).not.toHaveBeenCalled();
        });

        it("any request that carries an Origin header, token or not", async () => {
            const reply = await request(port, { headers: { Origin: "http://evil.example" }, body: "{}" });
            expect(reply.status).toBe(403);
            const nullOrigin = await request(port, { headers: { Origin: "null" }, body: "{}" });
            expect(nullOrigin.status).toBe(403);
        });

        it("a Host header that does not name this server", async () => {
            for (const value of ["evil.example", `evil.example:${port}`, "127.0.0.1", `127.0.0.1:${port + 1}`]) {
                const reply = await request(port, { headers: { Host: value }, body: "{}" });
                expect(reply.status, value).toBe(403);
            }
            const localhost = await rpc(port, "ping", {}, { Host: `localhost:${port}` });
            expect(localhost.status).toBe(200);
        });

        it("a body over the limit", async () => {
            const reply = await request(port, { body: Buffer.alloc(AGENT_MCP_BODY_LIMIT + 1, 32) });
            expect(reply.status).toBe(413);
        });

        it("a declared length over the limit without waiting for the body", async () => {
            const status = await new Promise<string>((resolve, reject) => {
                const socket = net.connect(port, "127.0.0.1", () => {
                    socket.write(
                        `POST ${AGENT_MCP_PATH} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nAuthorization: Bearer ${TOKEN}\r\n`
                        + `Content-Type: application/json\r\nContent-Length: ${AGENT_MCP_BODY_LIMIT + 10}\r\n\r\n{`,
                    );
                });
                socket.once("data", chunk => {
                    resolve(chunk.toString("utf8").split("\r\n")[0]);
                    socket.destroy();
                });
                socket.on("error", reject);
            });
            expect(status).toContain("413");
        });
    });

    it("answers a GET that asks for no stream with 405, and DELETE with 200", async () => {
        const get = await request(port, { method: "GET" });
        expect(get.status).toBe(405);
        expect(get.headers.allow).toContain("POST");
        const del = await request(port, { method: "DELETE", headers: { "Mcp-Session-Id": "x" } });
        expect(del.status).toBe(200);
    });

    it("answers 404 off the endpoint path", async () => {
        const reply = await request(port, { path: "/other", body: "{}" });
        expect(reply.status).toBe(404);
    });

    it("negotiates the protocol version and issues a session id", async () => {
        const reply = await rpc(port, "initialize", { protocolVersion: "2025-03-26", clientInfo: { name: "test-client" }, capabilities: {} });
        expect(reply.status).toBe(200);
        expect(reply.headers["mcp-session-id"]).toMatch(/^[0-9a-f-]{36}$/);
        const result = reply.json().result;
        expect(result.protocolVersion).toBe("2025-03-26");
        expect(result.capabilities).toMatchObject({ tools: { listChanged: true }, resources: {}, prompts: {} });
        expect(result.serverInfo).toMatchObject({ name: "narraleaf-studio", version: "9.9.9" });
        expect(result.instructions).toContain("agent_status");
        expect(result.instructions).toContain("workflow");

        const unknown = await rpc(port, "initialize", { protocolVersion: "1999-01-01" });
        expect(unknown.json().result.protocolVersion).toBe(AGENT_MCP_PROTOCOL_VERSIONS[0]);
    });

    it("accepts notifications with 202 and no body", async () => {
        const reply = await request(port, { body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
        expect(reply.status).toBe(202);
        expect(reply.body).toBe("");
    });

    it("answers a batch with one response per request", async () => {
        const reply = await request(port, {
            body: JSON.stringify([
                { jsonrpc: "2.0", id: "a", method: "ping" },
                { jsonrpc: "2.0", method: "notifications/initialized" },
                { jsonrpc: "2.0", id: "b", method: "nope" },
            ]),
        });
        const body = reply.json();
        expect(body).toHaveLength(2);
        expect(body[0]).toEqual({ jsonrpc: "2.0", id: "a", result: {} });
        expect(body[1].error.code).toBe(-32601);
    });

    it("reports a parse error", async () => {
        const reply = await request(port, { body: "{nope" });
        expect(reply.status).toBe(400);
        expect(reply.json().error.code).toBe(-32700);
    });

    it("lists exactly the tool table", async () => {
        const reply = await rpc(port, "tools/list");
        const tools = reply.json().result.tools;
        expect(tools).toEqual(AGENT_TOOLS.map(describeTool));
        const status = tools.find((tool: { name: string }) => tool.name === "agent_status");
        expect(status.annotations.readOnlyHint).toBe(true);
        const apply = tools.find((tool: { name: string }) => tool.name === "story_apply");
        expect(apply.annotations.readOnlyHint).toBe(false);
    });

    it("calls a tool with the client name from its session and returns content and structured data", async () => {
        const init = await rpc(port, "initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code" } });
        const session = init.headers["mcp-session-id"] as string;
        const reply = await rpc(port, "tools/call", { name: "agent_status", arguments: {} }, { "Mcp-Session-Id": session });
        expect(reply.json().result).toEqual({
            content: [{ type: "text", text: "done" }],
            structuredContent: { value: 1 },
            isError: false,
        });
        expect(host.callTool).toHaveBeenCalledWith(
            expect.objectContaining({ name: "agent_status" }),
            {},
            { clientName: "claude-code" },
        );
        expect(host.log).toHaveBeenCalledWith("info", expect.stringMatching(/^\[Agent\] agent_status ok in \d+ms \(claude-code\)$/));
    });

    it("turns an unknown tool into an error result rather than a transport error", async () => {
        const reply = await rpc(port, "tools/call", { name: "no_such_tool", arguments: {} });
        const result = reply.json().result;
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/^unknown_tool: /);
        expect(host.callTool).not.toHaveBeenCalled();
    });

    it("refuses arguments that do not fit the schema without calling the host", async () => {
        const reply = await rpc(port, "tools/call", { name: "agent_guide", arguments: { chapter: 3 } });
        const result = reply.json().result;
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/^invalid_args: chapter: expected a string/);
        expect(result.content[0].text).toContain("\nHint: ");
        expect(host.callTool).not.toHaveBeenCalled();
    });

    it("renders a refusal as code, message and hint", async () => {
        host.callTool.mockResolvedValueOnce(agentRefusal("writes_disabled", "Writes are off.", "Ask the author."));
        const reply = await rpc(port, "tools/call", { name: "agent_status" });
        expect(reply.json().result).toMatchObject({
            isError: true,
            content: [{ type: "text", text: "writes_disabled: Writes are off.\nHint: Ask the author." }],
        });
        expect(host.log).toHaveBeenCalledWith("warn", expect.stringContaining("agent_status writes_disabled"));
    });

    it("serves the guide as resources, tolerating a missing chapter", async () => {
        const list = (await rpc(port, "resources/list")).json().result.resources;
        expect(list.map((resource: { uri: string }) => resource.uri)).toEqual(
            AGENT_GUIDE_CHAPTERS.map(chapter => `narraleaf://guide/${chapter}`),
        );
        const workflow = (await rpc(port, "resources/read", { uri: "narraleaf://guide/workflow" })).json().result;
        expect(workflow.contents[0]).toEqual({ uri: "narraleaf://guide/workflow", mimeType: "text/markdown", text: "# Workflow\n\nStep one." });
        const missing = (await rpc(port, "resources/read", { uri: "narraleaf://guide/ui-format" })).json().result;
        expect(missing.contents[0].text).toContain("not installed");
        const bad = (await rpc(port, "resources/read", { uri: "file:///etc/passwd" })).json();
        expect(bad.error.code).toBe(-32002);
    });

    describe("plugin tools", () => {
        const pluginTool = {
            ...AGENT_TOOLS.find(tool => tool.name === "project_info")!,
            name: "acme_notes__list",
            title: "List notes",
            description: "Lists notes.",
            inputSchema: { type: "object" as const, properties: { query: { type: "string" as const }, project: { type: "string" as const } }, additionalProperties: false },
            pluginId: "acme.notes",
            pluginName: "Notes",
            pluginToolName: "acme.notes.list",
        };

        it("lists what the host lists and routes a call by the host's lookup, schema checked first", async () => {
            host.listTools = () => [...AGENT_TOOLS, pluginTool];
            host.findTool = name => (name === pluginTool.name ? pluginTool : AGENT_TOOLS.find(tool => tool.name === name) ?? null);
            const tools = (await rpc(port, "tools/list")).json().result.tools;
            expect(tools.map((tool: { name: string }) => tool.name)).toContain("acme_notes__list");
            const bad = (await rpc(port, "tools/call", { name: "acme_notes__list", arguments: { query: 1 } })).json().result;
            expect(bad.isError).toBe(true);
            expect(host.callTool).not.toHaveBeenCalled();
            await rpc(port, "tools/call", { name: "acme_notes__list", arguments: { query: "x" } });
            expect(host.callTool).toHaveBeenCalledWith(expect.objectContaining({ name: "acme_notes__list", pluginId: "acme.notes" }), { query: "x" }, { clientName: null });
        });

        it("answers a plugin tool that is not loaded with the host's own refusal", async () => {
            host.unknownTool = name => agentRefusal("unknown_tool", `The plugin is not loaded in this project: ${name}`);
            const result = (await rpc(port, "tools/call", { name: "gone__tool" })).json().result;
            expect(result.content[0].text).toContain("not loaded in this project");
        });

        it("pushes tools/list_changed to every open notification stream", async () => {
            const received = new Promise<string>((resolve, reject) => {
                const req = http.request({
                    host: "127.0.0.1",
                    port,
                    method: "GET",
                    path: AGENT_MCP_PATH,
                    headers: { Host: `127.0.0.1:${port}`, Authorization: `Bearer ${TOKEN}`, Accept: "text/event-stream" },
                }, res => {
                    expect(res.statusCode).toBe(200);
                    expect(res.headers["content-type"]).toContain("text/event-stream");
                    let text = "";
                    res.on("data", chunk => {
                        text += chunk.toString("utf8");
                        if (text.includes("list_changed")) {
                            resolve(text);
                            req.destroy();
                        } else if (text.includes("notifications")) {
                            // The opening comment arrived: the stream is registered, so notify now.
                            server.notifyToolsChanged();
                        }
                    });
                });
                req.on("error", error => (error.message.includes("socket hang up") ? undefined : reject(error)));
                req.end();
            });
            const text = await received;
            const data = text.split("\n").find(line => line.startsWith("data: "))!;
            expect(JSON.parse(data.slice("data: ".length))).toEqual({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
        });

        it("serves a plugin's guide chapter as a resource", async () => {
            host.listPluginGuides = async () => [{ pluginId: "acme.notes", name: "Notes" }];
            host.readPluginGuide = async pluginId => (pluginId === "acme.notes" ? "# Notes guide" : null);
            const list = (await rpc(port, "resources/list")).json().result.resources;
            expect(list.map((resource: { uri: string }) => resource.uri)).toContain("narraleaf://guide/plugin/acme.notes");
            const read = (await rpc(port, "resources/read", { uri: "narraleaf://guide/plugin/acme.notes" })).json().result;
            expect(read.contents[0].text).toBe("# Notes guide");
            const unknown = (await rpc(port, "resources/read", { uri: "narraleaf://guide/plugin/other.plugin" })).json();
            expect(unknown.error.code).toBe(-32002);
        });
    });

    it("offers the make_game prompt with the workflow and the brief", async () => {
        const list = (await rpc(port, "prompts/list")).json().result.prompts;
        expect(list).toEqual([expect.objectContaining({ name: "make_game", arguments: [expect.objectContaining({ name: "brief", required: false })] })]);
        const prompt = (await rpc(port, "prompts/get", { name: "make_game", arguments: { brief: "A short ghost story." } })).json().result;
        const text = prompt.messages[0].content.text;
        expect(text).toContain("A short ghost story.");
        expect(text).toContain("Step one.");
    });

    describe("choosing a port", () => {
        /** Ports nothing listens on right now, as the system hands them out. */
        async function freePorts(count: number): Promise<number[]> {
            const holders = await Promise.all(Array.from({ length: count }, () => new Promise<net.Server>((resolve, reject) => {
                const holder = net.createServer();
                holder.once("error", reject);
                holder.listen(0, "127.0.0.1", () => resolve(holder));
            })));
            const ports = holders.map(holder => (holder.address() as { port: number }).port);
            await Promise.all(holders.map(holder => new Promise(resolve => holder.close(resolve))));
            return ports;
        }

        /** Make `listen` on these ports fail the way the system would, before anything is bound. */
        function refuseListen(codes: Record<number, string>) {
            const original = http.Server.prototype.listen;
            const attempts: number[] = [];
            const spy = vi.spyOn(http.Server.prototype, "listen").mockImplementation(function (this: http.Server, ...args: unknown[]) {
                const asked = args[0] as number;
                attempts.push(asked);
                const code = codes[asked];
                if (code) {
                    process.nextTick(() => this.emit("error", Object.assign(new Error(`listen ${code}: 127.0.0.1:${asked}`), { code })));
                    return this;
                }
                return Reflect.apply(original, this, args) as http.Server;
            });
            return { attempts, restore: () => spy.mockRestore() };
        }

        it("moves past a port in use and a port the system reserved, in the order given", async () => {
            const [reserved, free, unused] = await freePorts(3);
            // `port` is held by the server the suite started: in use for real.
            const listen = refuseListen({ [reserved]: "EACCES" });
            const second = new AgentMcpServer({ port, fallbackPorts: [reserved, free, unused], token: () => TOKEN, host });
            try {
                expect(await second.start()).toBe(free);
                expect(listen.attempts).toEqual([port, reserved, free]);
                expect((await rpc(free, "ping")).status).toBe(200);
            } finally {
                listen.restore();
                await second.stop();
            }
        });

        it("takes any free port once every port it was given is unavailable", async () => {
            const [reserved] = await freePorts(1);
            const listen = refuseListen({ [reserved]: "EACCES" });
            const second = new AgentMcpServer({ port: reserved, fallbackPorts: [port], token: () => TOKEN, host });
            try {
                const bound = await second.start();
                expect(bound).not.toBe(reserved);
                expect(bound).not.toBe(port);
                expect(listen.attempts).toEqual([reserved, port, 0]);
            } finally {
                listen.restore();
                await second.stop();
            }
        });

        it("fails with the last refusal when told not to take any free port", async () => {
            const [reserved] = await freePorts(1);
            const listen = refuseListen({ [reserved]: "EACCES" });
            try {
                const strict = new AgentMcpServer({ port, fallbackPorts: [reserved], token: () => TOKEN, host, fallBackToFreePort: false });
                await expect(strict.start()).rejects.toMatchObject({ code: "EACCES" });
                expect(listen.attempts).toEqual([port, reserved]);
            } finally {
                listen.restore();
            }
        });

        it("does not try another port for a failure that is not about the port", async () => {
            const [odd, next] = await freePorts(2);
            const listen = refuseListen({ [odd]: "EINVAL" });
            try {
                const server = new AgentMcpServer({ port: odd, fallbackPorts: [next], token: () => TOKEN, host });
                await expect(server.start()).rejects.toMatchObject({ code: "EINVAL" });
                expect(listen.attempts).toEqual([odd]);
            } finally {
                listen.restore();
            }
        });
    });

    it("compares tokens by value", () => {
        expect(tokensEqual(TOKEN, TOKEN)).toBe(true);
        expect(tokensEqual(TOKEN.slice(1), TOKEN)).toBe(false);
        expect(tokensEqual("", "")).toBe(false);
    });
});
