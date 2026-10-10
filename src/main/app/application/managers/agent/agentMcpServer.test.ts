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

    it("answers GET with 405 and DELETE with 200", async () => {
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
        expect(result.capabilities).toMatchObject({ tools: {}, resources: {}, prompts: {} });
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
        const reply = await rpc(port, "tools/call", { name: "agent_guide", arguments: { chapter: "nope" } });
        const result = reply.json().result;
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/^invalid_args: chapter: must be one of/);
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

    it("offers the make_game prompt with the workflow and the brief", async () => {
        const list = (await rpc(port, "prompts/list")).json().result.prompts;
        expect(list).toEqual([expect.objectContaining({ name: "make_game", arguments: [expect.objectContaining({ name: "brief", required: false })] })]);
        const prompt = (await rpc(port, "prompts/get", { name: "make_game", arguments: { brief: "A short ghost story." } })).json().result;
        const text = prompt.messages[0].content.text;
        expect(text).toContain("A short ghost story.");
        expect(text).toContain("Step one.");
    });

    it("falls back to a free port when the one asked for is taken", async () => {
        const second = new AgentMcpServer({ port, token: () => TOKEN, host });
        try {
            const other = await second.start();
            expect(other).not.toBe(port);
        } finally {
            await second.stop();
        }
        const strict = new AgentMcpServer({ port, token: () => TOKEN, host, fallBackToFreePort: false });
        await expect(strict.start()).rejects.toMatchObject({ code: "EADDRINUSE" });
    });

    it("compares tokens by value", () => {
        expect(tokensEqual(TOKEN, TOKEN)).toBe(true);
        expect(tokensEqual(TOKEN.slice(1), TOKEN)).toBe(false);
        expect(tokensEqual("", "")).toBe(false);
    });
});
