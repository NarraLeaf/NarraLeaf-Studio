import { describe, expect, it } from "vitest";
import { isNetworkBlockedUrl } from "./networkPolicy";

/**
 * The failure this table guards against is not "a fetch got through" - it is the opposite one: a
 * blocking rule that also cuts the game off from its own bytes, so the window never loads and the
 * test reports a network failure that was really a self-inflicted wound.
 */
const ALLOWED = [
    // The game itself.
    "nlgame://runtime/index.html",
    "nlgame://runtime/renderer.js",
    "nlgame://asset/bg%2Ftitle.png?v=abc123",
    "nlgame://pack/",
    "nlgame://plugin-api/runtime.js",
    // The shell's own document on the paths that use it.
    "file:///C:/Users/dev/AppData/game/index.html",
    "file:///home/dev/game/index.html",
    // The inspector, and its transport.
    "devtools://devtools/bundled/inspector.html",
    "ws://127.0.0.1:9229/devtools/page/1",
    // Loopback, in every spelling that means this machine.
    "http://localhost:5588/",
    "http://LOCALHOST:5588/",
    "http://app.localhost:3000/index.html",
    "http://127.0.0.1:9223/console",
    "http://127.1.2.3:8080/",
    "https://localhost:8443/api",
    "ws://localhost:5599/",
    "http://[::1]:1234/",
    // Renderer-internal URLs that never touch a socket.
    "data:image/png;base64,iVBORw0KGgo=",
    "blob:nlgame://runtime/8f1b0e12-0000-4000-8000-000000000000",
    "about:blank",
];

const BLOCKED = [
    "https://api.example.com/v1/session",
    "http://example.com/",
    "http://cdn.example.com:8080/font.woff2",
    "ws://realtime.example.com/socket",
    "wss://realtime.example.com/socket",
    "ftp://files.example.com/patch.zip",
    "https://127.0.0.1.example.com/",
    // Starts with the word but is a remote host - the label-boundary case.
    "http://localhost.example.com/",
    "https://notlocalhost/",
];

describe("isNetworkBlockedUrl", () => {
    it.each(ALLOWED)("allows %s", url => {
        expect(isNetworkBlockedUrl(url)).toBe(false);
    });

    it.each(BLOCKED)("blocks %s", url => {
        expect(isNetworkBlockedUrl(url)).toBe(true);
    });

    it("fails closed on something it cannot parse", () => {
        expect(isNetworkBlockedUrl("not a url")).toBe(true);
        expect(isNetworkBlockedUrl("")).toBe(true);
    });
});
