import { EventEmitter } from "events";
import { describe, expect, it } from "vitest";
import {
    installRuntimeIpcSenderGuard,
    installRuntimeNavigationGuard,
    isRuntimeDocumentUrl,
    isTrustedRuntimeSender,
    type GuardableIpcMain,
    type GuardableWebContents,
} from "./navigationGuard";

describe("isRuntimeDocumentUrl", () => {
    it("accepts the runtime document, with or without a query", () => {
        expect(isRuntimeDocumentUrl("nlgame://runtime/index.html")).toBe(true);
        expect(isRuntimeDocumentUrl("nlgame://runtime/index.html?crash=1")).toBe(true);
    });

    it("refuses remote pages, other hosts and look-alikes", () => {
        expect(isRuntimeDocumentUrl("https://example.com/")).toBe(false);
        expect(isRuntimeDocumentUrl("http://runtime/index.html")).toBe(false);
        expect(isRuntimeDocumentUrl("nlgame://asset/1")).toBe(false);
        expect(isRuntimeDocumentUrl("nlgame://runtime.evil.com/")).toBe(false);
        expect(isRuntimeDocumentUrl("about:blank")).toBe(false);
        expect(isRuntimeDocumentUrl("")).toBe(false);
        expect(isRuntimeDocumentUrl(null)).toBe(false);
    });
});

describe("isTrustedRuntimeSender", () => {
    it("needs a live frame on the runtime document", () => {
        expect(isTrustedRuntimeSender({ senderFrame: { url: "nlgame://runtime/index.html" } })).toBe(true);
        expect(isTrustedRuntimeSender({ senderFrame: { url: "https://example.com/" } })).toBe(false);
        expect(isTrustedRuntimeSender({ senderFrame: null })).toBe(false);
        expect(isTrustedRuntimeSender({})).toBe(false);
    });
});

function fakeIpc() {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const listeners = new Map<string, (...args: unknown[]) => unknown>();
    const ipc = {
        handle: (channel: string, listener: (...args: unknown[]) => unknown) => { handlers.set(channel, listener); },
        handleOnce: (channel: string, listener: (...args: unknown[]) => unknown) => { handlers.set(channel, listener); },
        on: (channel: string, listener: (...args: unknown[]) => unknown) => { listeners.set(channel, listener); },
        once: (channel: string, listener: (...args: unknown[]) => unknown) => { listeners.set(channel, listener); },
    };
    return { ipc: ipc as unknown as GuardableIpcMain, handlers, listeners };
}

const trusted = { senderFrame: { url: "nlgame://runtime/index.html" } };
const remote = { senderFrame: { url: "https://evil.example/" } };

describe("installRuntimeIpcSenderGuard", () => {
    it("answers the runtime document and rejects a remote frame's invoke", () => {
        const { ipc, handlers } = fakeIpc();
        const refused: string[] = [];
        installRuntimeIpcSenderGuard(ipc, channel => refused.push(channel));
        ipc.handle("runtime:read-pack", () => "pack");
        const handler = handlers.get("runtime:read-pack")!;
        expect(handler(trusted)).toBe("pack");
        expect(() => handler(remote)).toThrow(/untrusted sender/);
        expect(refused).toEqual(["runtime:read-pack"]);
    });

    it("drops a remote frame's message without running the listener", () => {
        const { ipc, listeners } = fakeIpc();
        installRuntimeIpcSenderGuard(ipc);
        let calls = 0;
        ipc.on("runtime:log", () => { calls += 1; });
        const listener = listeners.get("runtime:log")!;
        listener(remote, { message: "x" });
        listener({ senderFrame: null });
        expect(calls).toBe(0);
        listener(trusted, { message: "x" });
        expect(calls).toBe(1);
    });

    it("installs once, so listeners are not wrapped twice", () => {
        const { ipc, handlers } = fakeIpc();
        const refused: string[] = [];
        installRuntimeIpcSenderGuard(ipc, channel => refused.push(channel));
        installRuntimeIpcSenderGuard(ipc, channel => refused.push(`second:${channel}`));
        ipc.handle("c", () => 1);
        expect(() => handlers.get("c")!(remote)).toThrow();
        expect(refused).toEqual(["c"]);
    });
});

function fakeContents() {
    const emitter = new EventEmitter();
    let openHandler: ((details: { url: string }) => { action: "deny" }) | null = null;
    const contents = {
        on: (event: string, listener: (...args: unknown[]) => void) => emitter.on(event, listener),
        setWindowOpenHandler: (handler: typeof openHandler) => { openHandler = handler; },
    } as unknown as GuardableWebContents;
    const fire = (event: string, ...args: unknown[]) => {
        let prevented = false;
        emitter.emit(event, { preventDefault: () => { prevented = true; } }, ...args);
        return prevented;
    };
    return { contents, fire, open: (url: string) => openHandler!({ url }) };
}

describe("installRuntimeNavigationGuard", () => {
    it("keeps the top frame on the runtime document", () => {
        const { contents, fire } = fakeContents();
        const blocked: string[] = [];
        installRuntimeNavigationGuard(contents, (kind, url) => blocked.push(`${kind} ${url}`));
        expect(fire("will-navigate", "nlgame://runtime/index.html?crash=1")).toBe(false);
        expect(fire("will-navigate", "https://evil.example/")).toBe(true);
        expect(blocked).toEqual(["navigate https://evil.example/"]);
    });

    it("cancels main-frame redirects off the runtime and leaves sub-frames alone", () => {
        const { contents, fire } = fakeContents();
        installRuntimeNavigationGuard(contents);
        expect(fire("will-redirect", "https://evil.example/", false, true)).toBe(true);
        expect(fire("will-redirect", "https://cdn.example/embed", false, false)).toBe(false);
    });

    it("denies new windows and webviews", () => {
        const { contents, fire, open } = fakeContents();
        installRuntimeNavigationGuard(contents);
        expect(open("https://evil.example/")).toEqual({ action: "deny" });
        expect(fire("will-attach-webview")).toBe(true);
    });
});
