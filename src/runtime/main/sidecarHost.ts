/**
 * Runtime hosting for plugin sidecars, in the game's own main process.
 *
 * A sidecar is a native child process a plugin shipped inside the pack. This
 * module owns everything about it that the plugin must not: where it runs, how
 * it is framed, which reply belongs to which call, when it is restarted, and -
 * above all - that it is dead before the game's process is.
 *
 * Deliberately free of Electron imports. Everything environmental (the app dir,
 * userData, the Electron binary, the log sink, the renderer push, and `spawn`
 * itself) arrives as a dependency, so the state machine below can be driven by a
 * fake process in tests without ever launching a real program.
 *
 * ## Wire protocol (v1, `transport: "stdio-jsonl"`)
 *
 * Newline-delimited JSON. **stdout is the protocol; stderr is a log channel** -
 * a sidecar may write anything it likes to stderr and it will never be parsed.
 *
 *   host -> sidecar  {"t":"hello","protocol":1,"pluginId":…,"sidecarId":…,"cwd":…,
 *                     "mode":"preview"|"production","game":{"name":…,"version":…}}
 *   sidecar -> host  {"t":"ready","protocol":1,"caps":[…]}
 *   host -> sidecar  {"t":"req","id":1,"method":"…","params":…}   // id omitted = notify
 *   sidecar -> host  {"t":"res","id":1,"result":…}                // or "error":{message,code?}
 *   sidecar -> host  {"t":"evt","method":"…","params":…}
 *   host -> sidecar  {"t":"bye"}
 *
 * Correlation ids are the host's business: a plugin only ever sees
 * `request(method, params) => Promise`.
 *
 * A sidecar must also treat **stdin EOF as "terminate now"**. That is the one
 * shutdown signal that still arrives if the game's main process dies without
 * running any of its own cleanup.
 */

import { spawn as spawnChildProcess } from "child_process";
import fsSync from "fs";
import path from "path";
import { StringDecoder } from "string_decoder";
import type {
    GameRuntimePackSidecarEntry,
    GameRuntimePackV1,
    GameRuntimeSidecarMessage,
} from "@shared/types/gameRuntime";
import { resolveInsideRoot } from "./runtimeProtocol";

export const SIDECAR_PROTOCOL_VERSION = 1;

/** Directory sidecar payloads are copied into, under both the app dir and userData. */
const SIDECAR_DIR_NAME = "sidecars";

/**
 * A single protocol line longer than this is dropped rather than buffered. A
 * sidecar that streams megabytes through one frame is either misbehaving or not
 * speaking this protocol at all; either way the host must not grow without
 * bound waiting for a newline that may never come.
 */
const MAX_FRAME_LENGTH = 1024 * 1024;

/** Grace between SIGTERM and SIGKILL once the polite shutdown has already timed out. */
const KILL_GRACE_MS = 2_000;

/**
 * Upper bound on the whole stop sequence. Past this the host stops waiting and
 * lets the quit continue - a hung quit would be a worse bug than the one this
 * guards against, and the process has been SIGKILLed by then anyway.
 */
const STOP_HARD_TIMEOUT_MS = 5_000;

/** A run at least this long counts as healthy, so the next crash starts a fresh retry budget. */
const STABLE_RUN_MS = 60_000;

/** Ceiling on exponential backoff, so a long session cannot schedule a restart hours out. */
const MAX_BACKOFF_MS = 30_000;

export type SidecarLogLevel = "info" | "warning" | "error";

export type SidecarReadableStream = {
    on(event: "data", listener: (chunk: unknown) => void): unknown;
};

export type SidecarWritableStream = {
    write(chunk: string): unknown;
    end(): unknown;
};

/**
 * The slice of Node's ChildProcess this module uses. Narrow on purpose: it is
 * the seam tests replace with a fake, and every method here has to be one a
 * fake can honestly implement.
 */
export type SidecarChildProcess = {
    readonly pid?: number | undefined;
    readonly stdin: SidecarWritableStream | null;
    readonly stdout: SidecarReadableStream | null;
    readonly stderr: SidecarReadableStream | null;
    on(event: "error", listener: (error: Error) => void): unknown;
    once(event: "exit", listener: (code: number | null, signal: string | null) => void): unknown;
    kill(signal?: "SIGTERM" | "SIGKILL"): boolean;
};

export type SidecarSpawnOptions = {
    cwd: string;
    env: Record<string, string | undefined>;
};

export type SidecarSpawnFn = (
    command: string,
    args: readonly string[],
    options: SidecarSpawnOptions,
) => SidecarChildProcess;

/** One sidecar the pack shipped, with the plugin that owns it folded in. */
export type SidecarDeclaration = GameRuntimePackSidecarEntry & { pluginId: string };

export type SidecarHostDeps = {
    /** Root the pack's `entry` paths resolve against. */
    appDir: string;
    /** Root of the per-sidecar writable working directories. */
    userDataDir: string;
    /** The game's own Electron binary; `kind: "node"` sidecars run under it as Node. */
    execPath: string;
    mode: "preview" | "production";
    game: { name: string; version: string | null };
    log(level: SidecarLogLevel, message: string): void;
    /** Push to the renderer. Dropped silently when no window is listening. */
    send(message: GameRuntimeSidecarMessage): void;
    spawn?: SidecarSpawnFn;
    /** Existence probe for the resolved entry path; injectable so tests need no real binary. */
    entryExists?: (entryPath: string) => boolean;
    ensureDir?: (dir: string) => void;
    /** File mode probe and repair, injected so the exec-bit fix is testable off-disk. */
    readMode?: (entryPath: string) => number;
    chmod?: (entryPath: string, mode: number) => void;
    /** Overrides `process.platform`; the posix-only paths have to be reachable from any host. */
    platform?: NodeJS.Platform;
};

/** Flatten the sidecars a pack shipped. Absent fields mean "this build has none". */
export function collectPackSidecars(pack: GameRuntimePackV1): SidecarDeclaration[] {
    const declarations: SidecarDeclaration[] = [];
    for (const plugin of pack.plugins ?? []) {
        for (const sidecar of plugin.sidecars ?? []) {
            declarations.push({ ...sidecar, pluginId: plugin.manifest.id });
        }
    }
    return declarations;
}

/**
 * Newline-delimited framing over a byte stream that may split anywhere.
 *
 * Tolerant by construction: a line longer than `maxLineLength` is dropped along
 * with the rest of its line, and the decoder resynchronises on the next newline
 * instead of tearing down the stream. One bad line costs one line.
 */
export class NdjsonDecoder {
    private buffer = "";
    /** True while discarding the tail of an over-long line. */
    private resyncing = false;

    public constructor(
        private readonly maxLineLength: number = MAX_FRAME_LENGTH,
        private readonly onDrop?: (droppedLength: number) => void,
    ) {}

    public push(chunk: string): string[] {
        const lines: string[] = [];
        this.buffer += chunk;
        for (;;) {
            const index = this.buffer.indexOf("\n");
            if (index === -1) {
                break;
            }
            const raw = this.buffer.slice(0, index);
            this.buffer = this.buffer.slice(index + 1);
            if (this.resyncing) {
                // The head of this line was already dropped; discard its tail too.
                this.resyncing = false;
                continue;
            }
            const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
            if (line.trim().length > 0) {
                lines.push(line);
            }
        }
        if (this.buffer.length > this.maxLineLength) {
            this.onDrop?.(this.buffer.length);
            this.buffer = "";
            this.resyncing = true;
        }
        return lines;
    }
}

/**
 * How loudly a stderr line should be reported. Sidecars are ordinary programs
 * with ordinary logging, so the host reads the conventional level prefix and
 * defaults to `info` - which a shipped game then drops, keeping a chatty
 * sidecar out of a player's log while still surfacing its real problems.
 */
export function classifyStderrLine(line: string): SidecarLogLevel {
    if (/^\s*[[<(]?\s*(?:error|err|fatal|panic|critical)\b/i.test(line)) {
        return "error";
    }
    if (/^\s*[[<(]?\s*(?:warn|warning)\b/i.test(line)) {
        return "warning";
    }
    return "info";
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Ids are manifest-validated, but a path segment is built from them; keep it boring. */
function safeSegment(value: string): string {
    return value.replace(/[^A-Za-z0-9._-]/g, "_") || "_";
}

function truncate(value: string, limit = 200): string {
    return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

type PendingRequest = {
    method: string;
    resolve(value: unknown): void;
    reject(error: Error): void;
};

type StartSettlement = {
    resolve(): void;
    reject(error: Error): void;
};

/**
 * One declared sidecar across the whole life of the game process: idle, running,
 * restarting after a crash, or permanently given up on.
 */
class SidecarInstance {
    private child: SidecarChildProcess | null = null;
    private state: "idle" | "starting" | "ready" = "idle";
    private startPromise: Promise<void> | null = null;
    private startSettlement: StartSettlement | null = null;
    private startupTimer: ReturnType<typeof setTimeout> | null = null;
    private restartTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly pending = new Map<number, PendingRequest>();
    private nextRequestId = 1;
    private restartAttempts = 0;
    private readyAt = 0;
    /** Set for the duration of an intentional stop, so the exit does not look like a crash. */
    private stopping = false;
    private readonly stopWaiters: Array<() => void> = [];
    /** Non-null once the host has given up: `available()` is false and `start()` rejects. */
    private unavailableReason: string | null = null;
    private entryPathCache: string | null | undefined;
    /**
     * Why the current process is being torn down, when the host decided that
     * before the process exited (handshake timeout, protocol mismatch, stream
     * error). The exit handler reports this instead of the bare exit code, and
     * it is the exit handler - the one place that knows the process is really
     * gone - that charges the failure and schedules any restart.
     */
    private pendingFailureReason: string | null = null;

    public constructor(
        private readonly declaration: SidecarDeclaration,
        private readonly deps: SidecarHostDeps,
        private readonly spawnProcess: SidecarSpawnFn,
    ) {}

    private get label(): string {
        return `${this.declaration.pluginId}/${this.declaration.id}`;
    }

    public get isRunning(): boolean {
        return this.child !== null;
    }

    /** A crashed sidecar waiting out its backoff still has a process coming. */
    public get hasPendingRestart(): boolean {
        return this.restartTimer !== null;
    }

    public isAvailable(): boolean {
        return this.unavailableReason === null && this.resolveEntryPath() !== null;
    }

    // ------------------------------------------------------------------ start

    public start(): Promise<void> {
        if (this.unavailableReason) {
            return Promise.reject(new Error(`Sidecar "${this.label}" is unavailable: ${this.unavailableReason}`));
        }
        if (this.state === "ready") {
            return Promise.resolve();
        }
        if (this.startPromise) {
            return this.startPromise;
        }
        if (this.child) {
            // A previous process is still being torn down. Stacking a second one
            // would leave the first unreferenced - i.e. an orphan.
            return Promise.reject(new Error(`Sidecar "${this.label}" is still shutting down`));
        }
        // An explicit start cancels a scheduled retry: the caller wants it now,
        // not at the end of a backoff it cannot see.
        this.clearRestartTimer();
        const tracked: Promise<void> = this.spawnAndHandshake().finally(() => {
            if (this.startPromise === tracked) {
                this.startPromise = null;
            }
        });
        this.startPromise = tracked;
        return tracked;
    }

    private spawnAndHandshake(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const entryPath = this.resolveEntryPath();
            if (!entryPath) {
                reject(new Error(`Sidecar "${this.label}" is not present in this build`));
                return;
            }
            let cwd: string;
            try {
                cwd = this.ensureWorkingDir();
            } catch (error) {
                reject(new Error(`Sidecar "${this.label}": could not create its working directory: ${describeError(error)}`));
                return;
            }

            if (this.declaration.kind === "executable") {
                try {
                    this.ensureExecutable(entryPath);
                } catch (error) {
                    // Not retryable: whatever stopped the chmod will stop the
                    // next one too, and a sidecar that cannot be executed is
                    // exactly what "unavailable" means.
                    const reason = `entry could not be made executable: ${describeError(error)}`;
                    this.markUnavailable(reason);
                    reject(new Error(`Sidecar "${this.label}" ${reason}`));
                    return;
                }
            }

            const command = this.declaration.kind === "node" ? this.deps.execPath : entryPath;
            const args = this.declaration.kind === "node" ? [entryPath] : [];
            const env: Record<string, string | undefined> = { ...process.env };
            if (this.declaration.kind === "node") {
                // Run the game's own Electron as a plain Node interpreter.
                env.ELECTRON_RUN_AS_NODE = "1";
            } else {
                // Never leak an inherited marker into a real executable: it would
                // change how that program interprets its own arguments.
                delete env.ELECTRON_RUN_AS_NODE;
            }

            let child: SidecarChildProcess;
            try {
                child = this.spawnProcess(command, args, { cwd, env });
            } catch (error) {
                this.chargeFailure(`spawn failed: ${describeError(error)}`, { scheduleRestart: false });
                reject(new Error(`Sidecar "${this.label}": spawn failed: ${describeError(error)}`));
                return;
            }

            this.child = child;
            this.state = "starting";
            this.pendingFailureReason = null;
            this.startSettlement = { resolve, reject };
            this.startupTimer = setTimeout(() => {
                this.startupTimer = null;
                this.failStart(
                    `did not complete the handshake within ${this.declaration.startupTimeoutMs}ms`,
                );
            }, this.declaration.startupTimeoutMs);

            this.wireStreams(child);
            child.on("error", error => {
                if (this.child !== child) {
                    return;
                }
                this.deps.log("error", `sidecar ${this.label}: ${describeError(error)}`);
                if (child.pid === undefined) {
                    // Spawn itself failed (ENOENT/EACCES): there is no process,
                    // and Node emits no "exit" for one that never existed. Run
                    // the teardown by hand so the instance does not sit forever
                    // believing a child is still shutting down.
                    this.pendingFailureReason = describeError(error);
                    this.handleExit(null, null);
                    return;
                }
                this.failStart(describeError(error));
            });
            child.once("exit", (code, signal) => {
                if (this.child !== child) {
                    return;
                }
                this.handleExit(code, signal);
            });

            this.writeFrame({
                t: "hello",
                protocol: SIDECAR_PROTOCOL_VERSION,
                pluginId: this.declaration.pluginId,
                sidecarId: this.declaration.id,
                cwd,
                mode: this.deps.mode,
                game: this.deps.game,
            });
        });
    }

    private wireStreams(child: SidecarChildProcess): void {
        const stdoutDecoder = new StringDecoder("utf8");
        const stdoutFramer = new NdjsonDecoder(MAX_FRAME_LENGTH, dropped => {
            this.deps.log("warning", `sidecar ${this.label}: dropped ${dropped} bytes of an over-long protocol line`);
        });
        child.stdout?.on("data", chunk => {
            for (const line of stdoutFramer.push(decodeChunk(stdoutDecoder, chunk))) {
                this.handleFrame(line);
            }
        });

        const stderrDecoder = new StringDecoder("utf8");
        const stderrFramer = new NdjsonDecoder(MAX_FRAME_LENGTH);
        child.stderr?.on("data", chunk => {
            for (const line of stderrFramer.push(decodeChunk(stderrDecoder, chunk))) {
                const level = classifyStderrLine(line);
                // A shipped game keeps a chatty sidecar out of the player's log;
                // preview shows everything, which is the point of preview.
                if (level === "info" && this.deps.mode === "production") {
                    continue;
                }
                this.deps.log(level, `sidecar ${this.label}: ${line}`);
            }
        });
    }

    // ----------------------------------------------------------------- frames

    private handleFrame(line: string): void {
        let frame: unknown;
        try {
            frame = JSON.parse(line);
        } catch {
            // One malformed line is one malformed line; the stream keeps going.
            this.deps.log("warning", `sidecar ${this.label}: ignored a non-JSON stdout line: ${truncate(line)}`);
            return;
        }
        if (!frame || typeof frame !== "object") {
            this.deps.log("warning", `sidecar ${this.label}: ignored a non-object frame: ${truncate(line)}`);
            return;
        }
        const record = frame as Record<string, unknown>;
        switch (record.t) {
            case "ready":
                this.handleReady(record);
                return;
            case "res":
                this.handleResponse(record);
                return;
            case "evt":
                this.deps.send({
                    kind: "event",
                    pluginId: this.declaration.pluginId,
                    sidecarId: this.declaration.id,
                    method: String(record.method ?? ""),
                    params: record.params,
                });
                return;
            default:
                this.deps.log("warning", `sidecar ${this.label}: unknown frame type: ${truncate(line)}`);
        }
    }

    private handleReady(record: Record<string, unknown>): void {
        const protocol = record.protocol;
        if (typeof protocol === "number" && protocol !== SIDECAR_PROTOCOL_VERSION) {
            this.failStart(`speaks protocol ${protocol}, but this game hosts protocol ${SIDECAR_PROTOCOL_VERSION}`);
            return;
        }
        if (this.state !== "starting") {
            this.deps.log("warning", `sidecar ${this.label}: ignored a second "ready" frame`);
            return;
        }
        this.clearStartupTimer();
        this.state = "ready";
        this.readyAt = Date.now();
        const caps = Array.isArray(record.caps) ? record.caps.map(String) : [];
        this.deps.log("info", `sidecar ${this.label}: ready${caps.length > 0 ? ` (caps: ${caps.join(", ")})` : ""}`);
        const settlement = this.startSettlement;
        this.startSettlement = null;
        settlement?.resolve();
    }

    private handleResponse(record: Record<string, unknown>): void {
        const id = record.id;
        if (typeof id !== "number") {
            this.deps.log("warning", `sidecar ${this.label}: response frame with no numeric id`);
            return;
        }
        const request = this.pending.get(id);
        if (!request) {
            // A reply to a request already rejected by an exit, or an id the
            // sidecar invented. Neither is worth more than a line.
            this.deps.log("warning", `sidecar ${this.label}: response for unknown request id ${id}`);
            return;
        }
        this.pending.delete(id);
        const error = record.error;
        if (error !== undefined && error !== null) {
            const message = typeof error === "object"
                ? String((error as Record<string, unknown>).message ?? "sidecar reported an error")
                : String(error);
            const code = typeof error === "object" ? (error as Record<string, unknown>).code : undefined;
            request.reject(new Error(
                `Sidecar "${this.label}" ${request.method} failed: ${message}${code === undefined ? "" : ` (${String(code)})`}`,
            ));
            return;
        }
        request.resolve(record.result);
    }

    // ---------------------------------------------------------------- calling

    public async request(method: string, params?: unknown): Promise<unknown> {
        await this.start();
        const id = this.nextRequestId++;
        return new Promise<unknown>((resolve, reject) => {
            this.pending.set(id, { method, resolve, reject });
            if (!this.writeFrame({ t: "req", id, method, ...(params === undefined ? {} : { params }) })) {
                this.pending.delete(id);
                reject(new Error(`Sidecar "${this.label}": could not write request "${method}"`));
            }
        });
    }

    /**
     * Fire-and-forget, so there is no promise to reject and nothing to await. A
     * notify against a stopped sidecar starts it and sends once it is ready -
     * the alternative would be dropping the call for a reason the plugin has no
     * synchronous way to observe.
     */
    public notify(method: string, params?: unknown): void {
        const send = () => {
            this.writeFrame({ t: "req", method, ...(params === undefined ? {} : { params }) });
        };
        if (this.state === "ready") {
            send();
            return;
        }
        void this.start().then(send).catch(error => {
            this.deps.log("warning", `sidecar ${this.label}: dropped notify "${method}": ${describeError(error)}`);
        });
    }

    private writeFrame(frame: Record<string, unknown>): boolean {
        const stdin = this.child?.stdin;
        if (!stdin) {
            return false;
        }
        try {
            stdin.write(`${JSON.stringify(frame)}\n`);
            return true;
        } catch (error) {
            // EPIPE against a process that died between the check and the write.
            this.deps.log("warning", `sidecar ${this.label}: write failed: ${describeError(error)}`);
            return false;
        }
    }

    // --------------------------------------------------------------- stopping

    /**
     * Polite shutdown, escalating on a timer: `bye` + stdin EOF, then SIGTERM
     * once `shutdownTimeoutMs` has passed, then SIGKILL. Resolves when the
     * process is gone (or when the hard timeout says to stop waiting for it).
     */
    public stop(): Promise<void> {
        this.clearRestartTimer();
        const child = this.child;
        if (!child) {
            return Promise.resolve();
        }
        if (this.stopping) {
            return new Promise<void>(resolve => this.stopWaiters.push(resolve));
        }
        this.stopping = true;
        return new Promise<void>(resolve => {
            const timers: Array<ReturnType<typeof setTimeout>> = [];
            const finish = () => {
                for (const timer of timers.splice(0)) {
                    clearTimeout(timer);
                }
                resolve();
            };
            this.stopWaiters.push(finish);
            this.writeFrame({ t: "bye" });
            try {
                child.stdin?.end();
            } catch {
                // Already closed; the escalation below still applies.
            }
            timers.push(setTimeout(() => {
                this.deps.log("warning", `sidecar ${this.label}: ignored "bye", sending SIGTERM`);
                this.killChild("SIGTERM");
            }, this.declaration.shutdownTimeoutMs));
            timers.push(setTimeout(() => {
                this.deps.log("warning", `sidecar ${this.label}: survived SIGTERM, sending SIGKILL`);
                this.killChild("SIGKILL");
            }, this.declaration.shutdownTimeoutMs + KILL_GRACE_MS));
            timers.push(setTimeout(() => {
                // Stop holding the quit open. The process has been SIGKILLed;
                // if it is somehow still there, the OS owns it now.
                this.deps.log("error", `sidecar ${this.label}: did not exit after SIGKILL`);
                this.drainStopWaiters();
            }, this.declaration.shutdownTimeoutMs + KILL_GRACE_MS + STOP_HARD_TIMEOUT_MS));
        });
    }

    /** Last-ditch synchronous kill for the quit path. No waiting, no frames. */
    public killNow(): void {
        this.clearRestartTimer();
        this.stopping = true;
        this.killChild("SIGKILL");
    }

    private killChild(signal: "SIGTERM" | "SIGKILL"): void {
        try {
            this.child?.kill(signal);
        } catch (error) {
            this.deps.log("warning", `sidecar ${this.label}: ${signal} failed: ${describeError(error)}`);
        }
    }

    // ------------------------------------------------------------------- exit

    private handleExit(code: number | null, signal: string | null): void {
        const wasReady = this.state === "ready";
        const intentional = this.stopping;
        const readyAt = this.readyAt;
        const declaredReason = this.pendingFailureReason;
        this.child = null;
        this.state = "idle";
        this.readyAt = 0;
        this.pendingFailureReason = null;
        this.clearStartupTimer();

        const exited = `exited (code=${code ?? "null"}, signal=${signal ?? "null"})`;
        const reason = declaredReason ?? exited;
        this.rejectPending(new Error(`Sidecar "${this.label}" ${exited} before replying`));
        const settlement = this.startSettlement;
        this.startSettlement = null;
        settlement?.reject(new Error(`Sidecar "${this.label}" ${exited} during startup`));

        this.deps.send({
            kind: "exit",
            pluginId: this.declaration.pluginId,
            sidecarId: this.declaration.id,
            code,
            signal,
        });

        if (intentional) {
            this.stopping = false;
            this.drainStopWaiters();
            return;
        }
        this.deps.log("warning", `sidecar ${this.label}: ${reason}`);
        // A long healthy run earns a fresh retry budget: an occasional crash
        // after hours of play is not the crash loop this counter guards against,
        // and should not be charged against one.
        if (wasReady && readyAt > 0 && Date.now() - readyAt >= STABLE_RUN_MS) {
            this.restartAttempts = 0;
        }
        this.chargeFailure(reason, { scheduleRestart: true });
    }

    /**
     * Charge one failure against the restart budget. Either schedules the next
     * attempt after an exponential backoff, or - once the budget is spent -
     * marks the sidecar unavailable for the rest of the process and tells the
     * renderer so `available()` starts answering false.
     *
     * Only ever called from the paths that know no process is running, so a
     * scheduled restart can never race a still-dying one.
     */
    private chargeFailure(reason: string, options: { scheduleRestart: boolean }): void {
        const { maxRetries, backoffMs } = this.declaration.restart;
        if (this.restartAttempts >= Math.max(0, maxRetries)) {
            this.markUnavailable(reason);
            return;
        }
        this.restartAttempts += 1;
        if (!options.scheduleRestart) {
            return;
        }
        const delay = Math.min(Math.max(0, backoffMs) * 2 ** (this.restartAttempts - 1), MAX_BACKOFF_MS);
        this.deps.log(
            "info",
            `sidecar ${this.label}: restarting in ${delay}ms (attempt ${this.restartAttempts}/${maxRetries})`,
        );
        this.clearRestartTimer();
        this.restartTimer = setTimeout(() => {
            this.restartTimer = null;
            void this.start().catch(error => {
                this.deps.log("warning", `sidecar ${this.label}: restart failed: ${describeError(error)}`);
            });
        }, delay);
    }

    private markUnavailable(reason: string): void {
        if (this.unavailableReason) {
            return;
        }
        this.unavailableReason = reason;
        this.deps.log("error", `sidecar ${this.label}: giving up after ${this.restartAttempts} restart(s) (${reason})`);
        this.deps.send({
            kind: "unavailable",
            pluginId: this.declaration.pluginId,
            sidecarId: this.declaration.id,
            reason,
        });
    }

    /**
     * The host has decided this process is no good (handshake timeout, protocol
     * mismatch, stream error). Rejects whoever is awaiting the start and kills
     * it; the exit handler does the accounting, so a failure is charged exactly
     * once no matter which of the two got there first.
     */
    private failStart(reason: string): void {
        if (this.state === "ready" || !this.startSettlement) {
            return;
        }
        this.clearStartupTimer();
        const settlement = this.startSettlement;
        this.startSettlement = null;
        this.pendingFailureReason = reason;
        this.deps.log("error", `sidecar ${this.label}: ${reason}`);
        this.killChild("SIGKILL");
        settlement.reject(new Error(`Sidecar "${this.label}" ${reason}`));
    }

    private rejectPending(error: Error): void {
        // Nothing may be left hanging: a plugin awaiting a reply from a dead
        // process would wait for the life of the game.
        for (const request of Array.from(this.pending.values())) {
            request.reject(error);
        }
        this.pending.clear();
    }

    private drainStopWaiters(): void {
        for (const waiter of this.stopWaiters.splice(0)) {
            waiter();
        }
    }

    private clearStartupTimer(): void {
        if (this.startupTimer) {
            clearTimeout(this.startupTimer);
            this.startupTimer = null;
        }
    }

    private clearRestartTimer(): void {
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }
    }

    // ------------------------------------------------------------------ paths

    /** Absolute entry path, or null when it is missing or escapes the app dir. */
    private resolveEntryPath(): string | null {
        if (this.entryPathCache !== undefined) {
            return this.entryPathCache;
        }
        const exists = this.deps.entryExists ?? ((candidate: string) => fsSync.existsSync(candidate));
        let resolved: string | null = null;
        try {
            const candidate = resolveInsideRoot(this.deps.appDir, this.declaration.entry);
            resolved = exists(candidate) ? candidate : null;
            if (!resolved) {
                this.deps.log("warning", `sidecar ${this.label}: entry is missing from this build (${this.declaration.entry})`);
            }
        } catch (error) {
            this.deps.log("error", `sidecar ${this.label}: entry path is not inside the app dir: ${describeError(error)}`);
        }
        this.entryPathCache = resolved;
        return resolved;
    }

    /**
     * Make sure the entry actually carries an executable bit on posix, and put
     * one back if it does not.
     *
     * Nothing on the way here guarantees it. A plugin installed from the
     * registry arrives as a zip, and neither the registry's writer nor Studio's
     * extractor records or restores file modes, so every file lands 0644 - a
     * sidecar that simply cannot be spawned on macOS or Linux. Local directory
     * installs and build staging copies are separate paths with their own
     * answers to the same question. Fixing each source is a list that will be
     * incomplete the moment a fourth one appears; this is the point every source
     * has to pass through, and it costs one stat per process launch.
     *
     * Only the bits the file already grants read on are made executable, so a
     * repair never widens who can run it.
     */
    private ensureExecutable(entryPath: string): void {
        const platform = this.deps.platform ?? process.platform;
        if (platform === "win32") {
            // Windows has no exec bit; executability is the extension's business.
            return;
        }
        const readMode = this.deps.readMode ?? ((target: string) => fsSync.statSync(target).mode);
        const chmod = this.deps.chmod ?? ((target: string, mode: number) => {
            fsSync.chmodSync(target, mode);
        });
        const mode = readMode(entryPath);
        if ((mode & 0o100) !== 0) {
            return;
        }
        const repaired = mode
            | 0o100
            | ((mode & 0o040) === 0 ? 0 : 0o010)
            | ((mode & 0o004) === 0 ? 0 : 0o001);
        chmod(entryPath, repaired);
        this.deps.log(
            "info",
            `sidecar ${this.label}: entry arrived without an executable bit ` +
            `(${(mode & 0o7777).toString(8)}); repaired to ${(repaired & 0o7777).toString(8)}`,
        );
    }

    /**
     * Per-sidecar writable working directory under userData.
     *
     * The sidecar's cwd is NOT its install directory: the app dir is read-only
     * on a real install, and a sidecar needs somewhere to put its own state.
     * (It is also where Steam's development-mode `steam_appid.txt` has to live.)
     * Shared libraries still load from beside the executable - the OS resolves
     * those against the image's own directory, not the cwd.
     */
    private ensureWorkingDir(): string {
        const dir = path.join(
            this.deps.userDataDir,
            SIDECAR_DIR_NAME,
            safeSegment(this.declaration.pluginId),
            safeSegment(this.declaration.id),
        );
        const ensure = this.deps.ensureDir ?? ((target: string) => {
            fsSync.mkdirSync(target, { recursive: true });
        });
        ensure(dir);
        return dir;
    }
}

function decodeChunk(decoder: StringDecoder, chunk: unknown): string {
    if (typeof chunk === "string") {
        return chunk;
    }
    if (chunk instanceof Uint8Array) {
        // Multi-byte characters can straddle a chunk boundary; the decoder holds
        // the partial sequence rather than emitting a replacement character.
        return decoder.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    }
    return String(chunk);
}

const defaultSpawn: SidecarSpawnFn = (command, args, options) =>
    spawnChildProcess(command, [...args], {
        cwd: options.cwd,
        env: options.env,
        stdio: ["pipe", "pipe", "pipe"],
        // No console window flashing behind the game on Windows.
        windowsHide: true,
    }) as unknown as SidecarChildProcess;

/**
 * Every sidecar this game shipped, keyed by plugin and sidecar id.
 *
 * An id the pack never declared has no instance here and never will - that, not
 * the caller-supplied `pluginId` on the IPC boundary, is the real limit on what
 * a plugin can start.
 */
export class SidecarHost {
    private readonly instances = new Map<string, SidecarInstance>();

    public constructor(
        private readonly declarations: readonly SidecarDeclaration[],
        private readonly deps: SidecarHostDeps,
    ) {
        const spawn = deps.spawn ?? defaultSpawn;
        for (const declaration of declarations) {
            this.instances.set(
                instanceKey(declaration.pluginId, declaration.id),
                new SidecarInstance(declaration, deps, spawn),
            );
        }
    }

    public available(pluginId: string, sidecarId: string): boolean {
        return this.instances.get(instanceKey(pluginId, sidecarId))?.isAvailable() === true;
    }

    // `async` on the three below so an undeclared id rejects rather than throwing
    // synchronously across the IPC boundary.

    public async start(pluginId: string, sidecarId: string): Promise<void> {
        await this.require(pluginId, sidecarId).start();
    }

    public async stop(pluginId: string, sidecarId: string): Promise<void> {
        await this.require(pluginId, sidecarId).stop();
    }

    public async request(pluginId: string, sidecarId: string, method: string, params?: unknown): Promise<unknown> {
        return this.require(pluginId, sidecarId).request(method, params);
    }

    public notify(pluginId: string, sidecarId: string, method: string, params?: unknown): void {
        const instance = this.instances.get(instanceKey(pluginId, sidecarId));
        if (!instance) {
            this.deps.log("warning", `sidecar ${pluginId}/${sidecarId}: notify dropped, no such sidecar in this build`);
            return;
        }
        instance.notify(method, params);
    }

    /** Spawn everything declared `autostart: "onGameStart"`. Failures only log. */
    public startAutostart(): void {
        for (const declaration of this.declarations) {
            if (declaration.autostart !== "onGameStart") {
                continue;
            }
            if (!this.available(declaration.pluginId, declaration.id)) {
                // Declared, but its payload is not in this app dir. That is the
                // documented degradation, not a fault: say so once and do not
                // spend a restart attempt failing to spawn nothing.
                this.deps.log(
                    "info",
                    `sidecar ${declaration.pluginId}/${declaration.id}: not present in this build; not started`,
                );
                continue;
            }
            const instance = this.instances.get(instanceKey(declaration.pluginId, declaration.id));
            void instance?.start().catch(error => {
                this.deps.log(
                    "warning",
                    `sidecar ${declaration.pluginId}/${declaration.id}: autostart failed: ${describeError(error)}`,
                );
            });
        }
    }

    /**
     * Whether the quit has anything to wait for. A sidecar waiting out a restart
     * backoff counts: left alone, its timer would fire mid-quit and spawn a
     * process nothing is left to shut down.
     */
    public needsShutdown(): boolean {
        for (const instance of this.instances.values()) {
            if (instance.isRunning || instance.hasPendingRestart) {
                return true;
            }
        }
        return false;
    }

    /** Graceful shutdown of every live sidecar, in parallel. Never rejects. */
    public async shutdownAll(): Promise<void> {
        await Promise.allSettled(Array.from(this.instances.values(), instance => instance.stop()));
    }

    /**
     * Synchronous last resort, for the very end of the quit. Anything still
     * breathing after {@link shutdownAll} is killed outright - a sidecar that
     * outlives its game is a process the player cannot see and cannot close.
     */
    public killAllSync(): void {
        for (const instance of this.instances.values()) {
            // Unconditional: killNow also disarms a pending restart, and a timer
            // that fires after this point would spawn an orphan by definition.
            instance.killNow();
        }
    }

    private require(pluginId: string, sidecarId: string): SidecarInstance {
        const instance = this.instances.get(instanceKey(pluginId, sidecarId));
        if (!instance) {
            throw new Error(`No sidecar "${sidecarId}" of plugin "${pluginId}" shipped with this game`);
        }
        return instance;
    }
}

function instanceKey(pluginId: string, sidecarId: string): string {
    return `${pluginId}\u0000${sidecarId}`;
}
