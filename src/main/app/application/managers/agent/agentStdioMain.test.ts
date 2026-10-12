import http from "http";
import type { AddressInfo } from "net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithoutTimeouts } from "./agentStdioMain";

/**
 * The stdio bridge's own request for the client's messages, against a real local server: it has
 * to read like `fetch` to the bridge while never giving up on a slow answer the way undici does.
 */

const servers: http.Server[] = [];

afterEach(async () => {
    vi.unstubAllGlobals();
    await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
        server.closeAllConnections();
        server.close(() => resolve());
    })));
});

async function serve(handler: http.RequestListener): Promise<string> {
    const server = http.createServer(handler);
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
}

function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise(resolve => {
        const chunks: Buffer[] = [];
        req.on("data", chunk => chunks.push(chunk));
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
}

describe("fetchWithoutTimeouts", () => {
    it("posts the message and waits for headers that come only when the tool has finished, without Node's fetch", async () => {
        // Not undici's fetch underneath: that one stops waiting for headers after five minutes.
        vi.stubGlobal("fetch", () => {
            throw new Error("the global fetch was used");
        });
        const received: { method?: string; headers?: http.IncomingHttpHeaders; body?: string } = {};
        const url = await serve(async (req, res) => {
            received.method = req.method;
            received.headers = req.headers;
            received.body = await readBody(req);
            setTimeout(() => {
                res.writeHead(200, { "Content-Type": "application/json", "Mcp-Session-Id": "session-1" });
                res.end(JSON.stringify({ jsonrpc: "2.0", id: 7, result: { built: true } }));
            }, 150);
        });
        const message = JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "build", arguments: { text: "台词" } } });
        const response = await fetchWithoutTimeouts(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer token", "Mcp-Session-Id": "session-0" },
            body: message,
        });
        expect(received.method).toBe("POST");
        expect(received.headers?.authorization).toBe("Bearer token");
        expect(received.headers?.["mcp-session-id"]).toBe("session-0");
        expect(received.body).toBe(message);
        expect(response.ok).toBe(true);
        expect(response.status).toBe(200);
        expect(response.headers.get("mcp-session-id")).toBe("session-1");
        expect(JSON.parse(await response.text())).toEqual({ jsonrpc: "2.0", id: 7, result: { built: true } });
    });

    it("streams the body as it arrives", async () => {
        let finish: () => void = () => undefined;
        const url = await serve((req, res) => {
            req.resume();
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.write("first ");
            finish = () => res.end("second");
        });
        const response = await fetchWithoutTimeouts(url, { method: "POST", body: "{}" });
        const reader = response.body!.getReader();
        const first = await reader.read();
        expect(new TextDecoder().decode(first.value)).toBe("first ");
        finish();
        let rest = "";
        for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
            rest += new TextDecoder().decode(chunk.value);
        }
        expect(rest).toBe("second");
    });

    it("answers a bare 202 with an empty body, and a 204 with none", async () => {
        const url = await serve((req, res) => {
            req.resume();
            res.writeHead(req.url?.endsWith("/none") ? 204 : 202);
            res.end();
        });
        const accepted = await fetchWithoutTimeouts(url, { method: "POST", body: "{}" });
        expect(accepted.status).toBe(202);
        expect(await accepted.text()).toBe("");
        const empty = await fetchWithoutTimeouts(`${url}/none`, { method: "POST", body: "{}" });
        expect(empty.status).toBe(204);
        expect(empty.body).toBeNull();
    });

    it("rejects a refused connection the way fetch does, so the bridge still knows nothing was delivered", async () => {
        const url = await serve(() => undefined);
        const server = servers.pop()!;
        await new Promise<void>(resolve => server.close(() => resolve()));
        const failure = await fetchWithoutTimeouts(url, { method: "POST", body: "{}" }).catch(error => error);
        expect(failure).toBeInstanceOf(TypeError);
        expect(failure.message).toBe("fetch failed");
        expect(failure.cause?.code).toBe("ECONNREFUSED");
    });

    it("stops when its signal is aborted", async () => {
        const url = await serve(req => {
            req.resume();
        });
        const controller = new AbortController();
        const pending = fetchWithoutTimeouts(url, { method: "POST", body: "{}", signal: controller.signal });
        setTimeout(() => controller.abort(new Error("stopped")), 20);
        await expect(pending).rejects.toThrow("stopped");
    });
});
