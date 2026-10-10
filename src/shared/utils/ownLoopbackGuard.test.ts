import { describe, expect, it, vi } from "vitest";
import { AGENT_MCP_DEFAULT_PORT, AGENT_MCP_FALLBACK_PORTS, AGENT_MCP_LEGACY_DEFAULT_PORT } from "@shared/agent/protocol";
import {
    isLoopbackAddress,
    refuseOwnLoopbackService,
    STUDIO_DEFAULT_LOOPBACK_PORTS,
    withoutHostHeader,
    type HostAddressLookup,
} from "./ownLoopbackGuard";

/**
 * What keeps a main-process request proxy off Studio's own loopback services.
 *
 * The two failure modes that matter: a spelling of "this machine" that slips past (every one below
 * reaches the agent endpoint's socket), and a guard that refuses more than Studio's own ports - a
 * game calling the author's local API on `localhost:3000` is ordinary and must keep working.
 */

const PORTS = [AGENT_MCP_DEFAULT_PORT, 9223];

/** A resolver answering from a table; a name not in it does not resolve. */
function resolver(table: Record<string, string[]>) {
    return vi.fn<HostAddressLookup>(async hostname => {
        const answers = table[hostname];
        if (!answers) {
            throw new Error(`ENOTFOUND ${hostname}`);
        }
        return answers;
    });
}

describe("isLoopbackAddress", () => {
    it.each([
        "127.0.0.1",
        "127.5.6.7",
        "0.0.0.0",
        "::1",
        "[::1]",
        "::",
        "[::]",
        "0:0:0:0:0:0:0:1",
        "::ffff:127.0.0.1",
        "::ffff:7f00:1",
        "[::ffff:7f00:1]",
        "::ffff:0.0.0.0",
        "::127.0.0.1",
        "::1%lo0",
    ])("knows %s is this machine", address => {
        expect(isLoopbackAddress(address)).toBe(true);
    });

    it.each([
        "192.168.1.10",
        "10.0.0.1",
        "93.184.216.34",
        "128.0.0.1",
        "::2",
        "2001:db8::1",
        "::ffff:192.168.1.10",
        "fe80::1",
        "localhost",
        "not an address",
        "1.2.3",
        "::1::",
    ])("knows %s is not", address => {
        expect(isLoopbackAddress(address)).toBe(false);
    });
});

describe("refuseOwnLoopbackService", () => {
    it.each([
        "http://127.0.0.1:47219/mcp",
        "http://127.9.9.9:47219/mcp",
        "http://0.0.0.0:47219/mcp",
        "http://[::1]:47219/mcp",
        "http://[::]:47219/mcp",
        "http://[::ffff:127.0.0.1]:47219/mcp",
        "http://127.1:47219/mcp",
        "http://2130706433:47219/mcp",
        "http://0x7f.0.0.1:47219/mcp",
        "https://127.0.0.1:9223/console",
    ])("refuses %s", async address => {
        const lookup = resolver({});
        expect(await refuseOwnLoopbackService(address, PORTS, lookup)).toContain("NarraLeaf Studio's own local services");
        // An IP literal is judged as written; nothing is resolved.
        expect(lookup).not.toHaveBeenCalled();
    });

    it("resolves a name on one of Studio's ports, and refuses one that lands on loopback", async () => {
        const lookup = resolver({ localhost: ["::1", "127.0.0.1"], "localtest.me": ["127.0.0.1"], "rebind.example": ["93.184.216.34", "127.0.0.1"] });
        for (const address of ["http://localhost:47219/mcp", "http://LOCALHOST:47219/mcp", "http://localtest.me:47219/mcp", "http://rebind.example:47219/mcp"]) {
            expect(await refuseOwnLoopbackService(address, PORTS, lookup)).not.toBeNull();
        }
    });

    it("refuses a name on one of Studio's ports that does not resolve", async () => {
        expect(await refuseOwnLoopbackService("http://nowhere.invalid:47219/mcp", PORTS, resolver({}))).not.toBeNull();
    });

    it("lets a public host on the same port number through", async () => {
        expect(await refuseOwnLoopbackService("http://api.example.com:47219/x", PORTS, resolver({ "api.example.com": ["93.184.216.34"] }))).toBeNull();
    });

    it("leaves every other loopback port alone, without resolving anything", async () => {
        const lookup = resolver({});
        for (const address of ["http://localhost:3000/api", "http://127.0.0.1:8080/", "http://[::1]:5173/", "https://localhost/"]) {
            expect(await refuseOwnLoopbackService(address, PORTS, lookup)).toBeNull();
        }
        expect(lookup).not.toHaveBeenCalled();
    });

    it("reads a URL without a port as its scheme's default", async () => {
        expect(await refuseOwnLoopbackService("http://127.0.0.1/", [80], resolver({}))).not.toBeNull();
        expect(await refuseOwnLoopbackService("https://127.0.0.1/", [80], resolver({}))).toBeNull();
    });

    it("protects nothing when Studio serves nothing", async () => {
        expect(await refuseOwnLoopbackService("http://127.0.0.1:47219/mcp", [], resolver({}))).toBeNull();
    });

    it("lets something that is not a URL through for the caller's own checks to refuse", async () => {
        expect(await refuseOwnLoopbackService("not a url", PORTS, resolver({}))).toBeNull();
    });

    it("names the agent endpoint's default port and its fixed fallbacks among the defaults a packaged game refuses", () => {
        expect(STUDIO_DEFAULT_LOOPBACK_PORTS).toContain(AGENT_MCP_DEFAULT_PORT);
        expect(STUDIO_DEFAULT_LOOPBACK_PORTS).toContain(47219);
        for (const port of AGENT_MCP_FALLBACK_PORTS) {
            expect(STUDIO_DEFAULT_LOOPBACK_PORTS).toContain(port);
        }
        expect(STUDIO_DEFAULT_LOOPBACK_PORTS).not.toContain(AGENT_MCP_LEGACY_DEFAULT_PORT);
    });

    it("refuses a packaged game's request to the port the endpoint moves to when the default is taken", async () => {
        expect(await refuseOwnLoopbackService("http://127.0.0.1:47220/mcp", STUDIO_DEFAULT_LOOPBACK_PORTS, resolver({}))).not.toBeNull();
        expect(await refuseOwnLoopbackService("http://127.0.0.1:47229/mcp", STUDIO_DEFAULT_LOOPBACK_PORTS, resolver({}))).toBeNull();
    });
});

describe("withoutHostHeader", () => {
    it("drops Host in any spelling and keeps the rest", () => {
        expect(withoutHostHeader({ Host: "127.0.0.1:47219", " host ": "x", HOST: "y", authorization: "Bearer t", "x-a": "1" }))
            .toEqual({ authorization: "Bearer t", "x-a": "1" });
    });

    it("answers no headers for none, and for nothing but Host", () => {
        expect(withoutHostHeader(null)).toBeUndefined();
        expect(withoutHostHeader(undefined)).toBeUndefined();
        expect(withoutHostHeader({ host: "a" })).toBeUndefined();
    });
});
