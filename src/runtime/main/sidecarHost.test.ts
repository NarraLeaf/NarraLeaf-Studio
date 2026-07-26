import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameRuntimeSidecarMessage } from "@shared/types/gameRuntime";
import {
    classifyStderrLine,
    collectPackSidecars,
    NdjsonDecoder,
    SidecarHost,
    type SidecarChildProcess,
    type SidecarDeclaration,
    type SidecarHostDeps,
    type SidecarLogLevel,
} from "./sidecarHost";

const PLUGIN_ID = "acme.tools";
const SIDECAR_ID = "acme.tools.bridge";

class FakeStream {
    private readonly listeners: Array<(chunk: unknown) => void> = [];

    public on(_event: "data", listener: (chunk: unknown) => void): unknown {
        this.listeners.push(listener);
        return this;
    }

    public emit(chunk: unknown): void {
        for (const listener of [...this.listeners]) {
            listener(chunk);
        }
    }
}

/**
 * Stands in for a spawned process. The point of the seam: every state the host
 * has to survive (a torn frame, a garbage line, a sudden exit, a process that
 * ignores `bye`) is producible here without a real program on disk.
 */
class FakeChild implements SidecarChildProcess {
    public pid: number | undefined = 4242;
    public readonly stdout = new FakeStream();
    public readonly stderr = new FakeStream();
    public readonly written: string[] = [];
    public readonly killSignals: string[] = [];
    public stdinEnded = false;
    public readonly stdin = {
        write: (chunk: string): unknown => {
            this.written.push(chunk);
            return true;
        },
        end: (): unknown => {
            this.stdinEnded = true;
            return undefined;
        },
    };

    private readonly exitListeners: Array<(code: number | null, signal: string | null) => void> = [];
    private readonly errorListeners: Array<(error: Error) => void> = [];

    public on(_event: "error", listener: (error: Error) => void): unknown {
        this.errorListeners.push(listener);
        return this;
    }

    public once(_event: "exit", listener: (code: number | null, signal: string | null) => void): unknown {
        this.exitListeners.push(listener);
        return this;
    }

    public kill(signal: "SIGTERM" | "SIGKILL" = "SIGTERM"): boolean {
        this.killSignals.push(signal);
        return true;
    }

    // ------------------------------------------------------------- test drives

    public sendFrame(frame: Record<string, unknown>): void {
        this.sendRaw(`${JSON.stringify(frame)}\n`);
    }

    public sendRaw(text: string): void {
        this.stdout.emit(Buffer.from(text, "utf-8"));
    }

    public sendStderr(text: string): void {
        this.stderr.emit(Buffer.from(text, "utf-8"));
    }

    public exit(code: number | null = 1, signal: string | null = null): void {
        for (const listener of this.exitListeners.splice(0)) {
            listener(code, signal);
        }
    }

    public fail(error: Error, spawnFailed = false): void {
        if (spawnFailed) {
            this.pid = undefined;
        }
        for (const listener of [...this.errorListeners]) {
            listener(error);
        }
    }

    public frames(): Array<Record<string, unknown>> {
        return this.written
            .join("")
            .split("\n")
            .filter(line => line.trim().length > 0)
            .map(line => JSON.parse(line) as Record<string, unknown>);
    }
}

function createHost(
    overrides: Partial<SidecarDeclaration> = {},
    mode: "preview" | "production" = "preview",
    depsOverrides: Partial<SidecarHostDeps> = {},
) {
    const declaration: SidecarDeclaration = {
        pluginId: PLUGIN_ID,
        id: SIDECAR_ID,
        entry: `sidecars/${PLUGIN_ID}/${SIDECAR_ID}/bin/tool`,
        kind: "executable",
        autostart: "onRequest",
        startupTimeoutMs: 1_000,
        shutdownTimeoutMs: 500,
        restart: { maxRetries: 2, backoffMs: 100 },
        ...overrides,
    };
    const children: FakeChild[] = [];
    const logs: Array<{ level: SidecarLogLevel; message: string }> = [];
    const sent: GameRuntimeSidecarMessage[] = [];
    const spawned: Array<{ command: string; args: readonly string[]; cwd: string; env: Record<string, string | undefined> }> = [];
    const chmods: Array<{ entryPath: string; mode: number }> = [];
    // Pinned to posix with an already-executable entry, so every test exercises
    // the same branch whatever machine it runs on.
    const host = new SidecarHost([declaration], {
        appDir: "/app",
        userDataDir: "/user",
        execPath: "/app/electron",
        mode,
        game: { name: "Test Game", version: "1.2.3" },
        log: (level, message) => logs.push({ level, message }),
        send: message => sent.push(message),
        spawn: (command, args, options) => {
            spawned.push({ command, args, cwd: options.cwd, env: options.env });
            const child = new FakeChild();
            children.push(child);
            return child;
        },
        entryExists: () => true,
        ensureDir: () => undefined,
        platform: "linux",
        readMode: () => 0o755,
        chmod: (entryPath, fileMode) => chmods.push({ entryPath, mode: fileMode }),
        ...depsOverrides,
    });
    return { host, children, logs, sent, spawned, chmods, declaration };
}

const start = (host: SidecarHost) => host.start(PLUGIN_ID, SIDECAR_ID);

describe("NdjsonDecoder", () => {
    it("reassembles lines split across chunk boundaries", () => {
        const decoder = new NdjsonDecoder();
        expect(decoder.push('{"t":"re')).toEqual([]);
        expect(decoder.push('ady"}\n{"t":"evt"}\n')).toEqual(['{"t":"ready"}', '{"t":"evt"}']);
    });

    it("tolerates CRLF and blank lines", () => {
        const decoder = new NdjsonDecoder();
        expect(decoder.push('{"a":1}\r\n\n  \n{"b":2}\n')).toEqual(['{"a":1}', '{"b":2}']);
    });

    it("drops an over-long line and resynchronises on the next one", () => {
        const dropped: number[] = [];
        const decoder = new NdjsonDecoder(16, length => dropped.push(length));
        expect(decoder.push("x".repeat(40))).toEqual([]);
        expect(dropped).toHaveLength(1);
        // The tail of the dropped line is discarded, the next line survives.
        expect(decoder.push('rest-of-the-garbage\n{"t":"evt"}\n')).toEqual(['{"t":"evt"}']);
    });
});

describe("classifyStderrLine", () => {
    it("reads the conventional level prefix and defaults to info", () => {
        expect(classifyStderrLine("ERROR: boom")).toBe("error");
        expect(classifyStderrLine("[warn] slow")).toBe("warning");
        expect(classifyStderrLine("fatal: gone")).toBe("error");
        expect(classifyStderrLine("listening on port 1")).toBe("info");
    });
});

describe("collectPackSidecars", () => {
    it("treats a pack with no sidecar fields as a pack with no sidecars", () => {
        const pack = {
            plugins: [
                { manifest: { id: "a" }, entryRelativePath: "plugins/a/runtime.js" },
                { manifest: { id: "b" }, entryRelativePath: "plugins/b/runtime.js", sidecars: [{ id: "b.one" }] },
            ],
        } as never;
        expect(collectPackSidecars(pack).map(entry => `${entry.pluginId}/${entry.id}`)).toEqual(["b/b.one"]);
    });
});

describe("SidecarHost", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("hand-shakes with hello/ready before the start resolves", async () => {
        const { host, children, spawned } = createHost();
        const started = start(host);
        const child = children[0]!;

        // The executable is the pack's entry resolved inside the app dir, never
        // anything the renderer named.
        expect(spawned[0]!.command).toBe(path.resolve("/app", `sidecars/${PLUGIN_ID}/${SIDECAR_ID}/bin/tool`));
        expect(spawned[0]!.args).toEqual([]);
        expect(child.frames()[0]).toMatchObject({
            t: "hello",
            protocol: 1,
            pluginId: PLUGIN_ID,
            sidecarId: SIDECAR_ID,
            mode: "preview",
            game: { name: "Test Game", version: "1.2.3" },
        });

        child.sendFrame({ t: "ready", protocol: 1, caps: ["achievements"] });
        await expect(started).resolves.toBeUndefined();
        // Idempotent: a second start neither spawns nor re-handshakes.
        await expect(start(host)).resolves.toBeUndefined();
        expect(children).toHaveLength(1);
    });

    it("runs a node sidecar under the game's own Electron", async () => {
        const { host, children, spawned } = createHost({ kind: "node", entry: "sidecars/a/b/main.js" });
        void start(host).catch(() => undefined);
        children[0]!.sendFrame({ t: "ready" });
        await vi.advanceTimersByTimeAsync(0);
        expect(spawned[0]!.command).toBe("/app/electron");
        expect(spawned[0]!.args).toHaveLength(1);
        expect(spawned[0]!.env.ELECTRON_RUN_AS_NODE).toBe("1");
        // cwd is the per-sidecar writable dir under userData, never the app dir.
        expect(spawned[0]!.cwd).toContain("sidecars");
        expect(spawned[0]!.cwd).not.toContain("/app");
    });

    it("routes replies to their own requests, whatever order they arrive in", async () => {
        const { host, children } = createHost();
        const first = host.request(PLUGIN_ID, SIDECAR_ID, "first", { a: 1 });
        const second = host.request(PLUGIN_ID, SIDECAR_ID, "second");
        const child = children[0]!;
        child.sendFrame({ t: "ready" });
        await vi.advanceTimersByTimeAsync(0);

        const requests = child.frames().filter(frame => frame.t === "req");
        expect(requests).toHaveLength(2);
        const idOf = (method: string) => requests.find(frame => frame.method === method)!.id as number;
        expect(requests.find(frame => frame.method === "first")!.params).toEqual({ a: 1 });

        // Answered out of order on purpose: correlation is the host's job.
        child.sendFrame({ t: "res", id: idOf("second"), result: "B" });
        child.sendFrame({ t: "res", id: idOf("first"), result: "A" });
        await expect(first).resolves.toBe("A");
        await expect(second).resolves.toBe("B");
    });

    it("rejects a request the sidecar answers with an error frame", async () => {
        const { host, children } = createHost();
        const pending = host.request(PLUGIN_ID, SIDECAR_ID, "unlock");
        children[0]!.sendFrame({ t: "ready" });
        await vi.advanceTimersByTimeAsync(0);
        const id = children[0]!.frames().find(frame => frame.t === "req")!.id as number;
        children[0]!.sendFrame({ t: "res", id, error: { message: "no such achievement", code: "ENOENT" } });
        await expect(pending).rejects.toThrow(/no such achievement.*ENOENT/);
    });

    it("survives garbage on stdout without losing the stream", async () => {
        const { host, children, logs } = createHost();
        const pending = host.request(PLUGIN_ID, SIDECAR_ID, "ping");
        const child = children[0]!;
        child.sendFrame({ t: "ready" });
        await vi.advanceTimersByTimeAsync(0);
        const id = child.frames().find(frame => frame.t === "req")!.id as number;

        child.sendRaw("this is not json at all\n");
        child.sendRaw('{"t":"nonsense"}\n');
        child.sendRaw("x".repeat(2 * 1024 * 1024));
        child.sendRaw('leftovers\n{"t":"res","id":');
        child.sendRaw(`${id},"result":"pong"}\n`);

        await expect(pending).resolves.toBe("pong");
        expect(logs.some(entry => entry.message.includes("non-JSON"))).toBe(true);
        expect(logs.some(entry => entry.message.includes("over-long"))).toBe(true);
    });

    it("forwards stderr as log lines, dropping chatter in production", async () => {
        const preview = createHost();
        void start(preview.host).catch(() => undefined);
        preview.children[0]!.sendStderr("just chatting\nWARN: slow disk\n");
        expect(preview.logs.some(entry => entry.level === "info" && entry.message.includes("just chatting"))).toBe(true);
        expect(preview.logs.some(entry => entry.level === "warning" && entry.message.includes("slow disk"))).toBe(true);

        const production = createHost({}, "production");
        void start(production.host).catch(() => undefined);
        production.children[0]!.sendStderr("just chatting\nERROR: broke\n");
        expect(production.logs.some(entry => entry.message.includes("just chatting"))).toBe(false);
        expect(production.logs.some(entry => entry.level === "error" && entry.message.includes("broke"))).toBe(true);
    });

    it("rejects every in-flight request when the process dies", async () => {
        const { host, children, sent } = createHost();
        // Assertions attached up front: nothing may be left pending, and a
        // handler added after the fact would not prove that.
        const first = expect(host.request(PLUGIN_ID, SIDECAR_ID, "first")).rejects.toThrow(/exited \(code=3/);
        const second = expect(host.request(PLUGIN_ID, SIDECAR_ID, "second")).rejects.toThrow(/exited \(code=3/);
        children[0]!.sendFrame({ t: "ready" });
        await vi.advanceTimersByTimeAsync(0);

        children[0]!.exit(3, null);
        await first;
        await second;
        expect(sent).toContainEqual({
            kind: "exit",
            pluginId: PLUGIN_ID,
            sidecarId: SIDECAR_ID,
            code: 3,
            signal: null,
        });
    });

    it("fails the start when the handshake times out", async () => {
        const { host, children } = createHost();
        const started = expect(start(host)).rejects.toThrow(/handshake within 1000ms/);
        await vi.advanceTimersByTimeAsync(1_000);
        await started;
        expect(children[0]!.killSignals).toContain("SIGKILL");
    });

    it("restarts a crashed sidecar with exponential backoff, then gives up for good", async () => {
        const { host, children, sent } = createHost({ restart: { maxRetries: 2, backoffMs: 100 } });
        void start(host).catch(() => undefined);
        children[0]!.sendFrame({ t: "ready" });
        await vi.advanceTimersByTimeAsync(0);
        expect(host.available(PLUGIN_ID, SIDECAR_ID)).toBe(true);

        // First crash: restarts after backoffMs.
        children[0]!.exit(1);
        await vi.advanceTimersByTimeAsync(99);
        expect(children).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(children).toHaveLength(2);

        // Second crash: the delay has doubled.
        children[1]!.sendFrame({ t: "ready" });
        await vi.advanceTimersByTimeAsync(0);
        children[1]!.exit(1);
        await vi.advanceTimersByTimeAsync(150);
        expect(children).toHaveLength(2);
        await vi.advanceTimersByTimeAsync(50);
        expect(children).toHaveLength(3);

        // Third crash exhausts maxRetries: no fourth process, ever.
        children[2]!.sendFrame({ t: "ready" });
        await vi.advanceTimersByTimeAsync(0);
        children[2]!.exit(1);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(children).toHaveLength(3);
        expect(host.available(PLUGIN_ID, SIDECAR_ID)).toBe(false);
        expect(sent.filter(message => message.kind === "unavailable")).toHaveLength(1);
        await expect(start(host)).rejects.toThrow(/unavailable/);
    });

    it("charges a crash after a long healthy run against a fresh budget", async () => {
        const { host, children } = createHost({ restart: { maxRetries: 1, backoffMs: 100 } });
        void start(host).catch(() => undefined);
        children[0]!.sendFrame({ t: "ready" });
        await vi.advanceTimersByTimeAsync(0);

        // Crash once, restart, then run for a long time before crashing again.
        children[0]!.exit(1);
        await vi.advanceTimersByTimeAsync(100);
        children[1]!.sendFrame({ t: "ready" });
        await vi.advanceTimersByTimeAsync(120_000);
        children[1]!.exit(1);
        await vi.advanceTimersByTimeAsync(100);

        // Without the reset this second crash would have exhausted maxRetries: 1.
        expect(children).toHaveLength(3);
        expect(host.available(PLUGIN_ID, SIDECAR_ID)).toBe(true);
    });

    it("shuts down politely, then escalates, and never leaves the process behind", async () => {
        const { host, children } = createHost();
        void start(host).catch(() => undefined);
        const child = children[0]!;
        child.sendFrame({ t: "ready" });
        await vi.advanceTimersByTimeAsync(0);

        const stopped = host.shutdownAll();
        expect(child.frames().at(-1)).toEqual({ t: "bye" });
        expect(child.stdinEnded).toBe(true);

        // Ignores `bye`: SIGTERM after its own shutdown timeout, SIGKILL after that.
        await vi.advanceTimersByTimeAsync(500);
        expect(child.killSignals).toEqual(["SIGTERM"]);
        await vi.advanceTimersByTimeAsync(2_000);
        expect(child.killSignals).toEqual(["SIGTERM", "SIGKILL"]);

        child.exit(null, "SIGKILL");
        await expect(stopped).resolves.toBeUndefined();
        expect(host.needsShutdown()).toBe(false);
        // An intentional stop is not a crash: nothing is restarted.
        await vi.advanceTimersByTimeAsync(60_000);
        expect(children).toHaveLength(1);
    });

    it("stops waiting for a sidecar that ignores even SIGKILL", async () => {
        const { host, children } = createHost();
        void start(host).catch(() => undefined);
        children[0]!.sendFrame({ t: "ready" });
        await vi.advanceTimersByTimeAsync(0);

        const stopped = host.shutdownAll();
        // shutdownTimeoutMs + SIGKILL grace + hard timeout, with no exit event.
        await vi.advanceTimersByTimeAsync(500 + 2_000 + 5_000);
        await expect(stopped).resolves.toBeUndefined();
    });

    it("kills anything still alive at the very end of the quit", async () => {
        const { host, children } = createHost();
        void start(host).catch(() => undefined);
        children[0]!.sendFrame({ t: "ready" });
        await vi.advanceTimersByTimeAsync(0);

        host.killAllSync();
        expect(children[0]!.killSignals).toEqual(["SIGKILL"]);
    });

    it("forwards sidecar events to the renderer", async () => {
        const { host, children, sent } = createHost();
        void start(host).catch(() => undefined);
        children[0]!.sendFrame({ t: "ready" });
        await vi.advanceTimersByTimeAsync(0);
        children[0]!.sendFrame({ t: "evt", method: "achievement.unlocked", params: { id: "first-blood" } });
        expect(sent).toContainEqual({
            kind: "event",
            pluginId: PLUGIN_ID,
            sidecarId: SIDECAR_ID,
            method: "achievement.unlocked",
            params: { id: "first-blood" },
        });
    });

    it("puts back the executable bit a plugin zip dropped", async () => {
        // Registry installs arrive as zips that carry no file modes, so the
        // sidecar lands 0644 and cannot be spawned at all on posix.
        const { host, chmods, spawned } = createHost({}, "preview", { readMode: () => 0o644 });
        void start(host).catch(() => undefined);
        expect(chmods).toHaveLength(1);
        // Only where the file already granted read: a repair never widens access.
        expect(chmods[0]!.mode & 0o777).toBe(0o755);
        expect(chmods[0]!.entryPath).toBe(spawned[0]!.command);

        const privateEntry = createHost({}, "preview", { readMode: () => 0o600 });
        void start(privateEntry.host).catch(() => undefined);
        expect(privateEntry.chmods[0]!.mode & 0o777).toBe(0o700);
    });

    it("leaves an already-executable entry and Windows alone", async () => {
        const posix = createHost({}, "preview", { readMode: () => 0o755 });
        void start(posix.host).catch(() => undefined);
        expect(posix.chmods).toEqual([]);

        const windows = createHost({}, "preview", {
            platform: "win32",
            readMode: () => {
                throw new Error("stat must not be called on Windows");
            },
        });
        void start(windows.host).catch(() => undefined);
        expect(windows.chmods).toEqual([]);
        expect(windows.spawned).toHaveLength(1);
    });

    it("marks a sidecar unavailable when the executable bit cannot be restored", async () => {
        const { host, sent, spawned } = createHost({}, "preview", {
            readMode: () => 0o644,
            chmod: () => {
                throw new Error("EPERM: operation not permitted");
            },
        });
        await expect(start(host)).rejects.toThrow(/could not be made executable.*EPERM/);
        // Nothing was spawned, and it is not retried: the next chmod would fail too.
        expect(spawned).toEqual([]);
        expect(host.available(PLUGIN_ID, SIDECAR_ID)).toBe(false);
        expect(sent.filter(message => message.kind === "unavailable")).toHaveLength(1);
        await expect(start(host)).rejects.toThrow(/unavailable/);
    });

    it("refuses a sidecar this build never shipped", async () => {
        const { host } = createHost();
        expect(host.available(PLUGIN_ID, "acme.tools.other")).toBe(false);
        await expect(host.start(PLUGIN_ID, "acme.tools.other")).rejects.toThrow(/never shipped|No sidecar/);
        await expect(host.request("someone.else", SIDECAR_ID, "hi")).rejects.toThrow(/No sidecar/);
    });

    it("recovers from a spawn that never produced a process", async () => {
        const { host, children } = createHost({ restart: { maxRetries: 1, backoffMs: 100 } });
        const started = expect(start(host)).rejects.toThrow(/exited|ENOENT/);
        children[0]!.fail(new Error("spawn ENOENT"), true);
        await started;
        // The instance must not be left believing a child is still shutting down.
        await vi.advanceTimersByTimeAsync(100);
        expect(children).toHaveLength(2);
    });
});
