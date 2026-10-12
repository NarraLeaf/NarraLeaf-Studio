import { spawn } from "child_process";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { Readable } from "stream";
import { format } from "util";
import type { App as ElectronApp } from "electron";
import { AGENT_MCP_STDIO_FLAG, AGENT_SETTINGS_FILE_NAME, type AgentStdioCommand } from "@shared/agent/settings";
import { readMcpStdioUserDataDir, runAgentStdioBridge } from "./agentStdioBridge";

/**
 * The process side of the stdio bridge: what a launch with `--mcp-stdio` does instead of starting
 * Studio. Called from `index.ts` before `App.create`, so none of Studio starts - no profile is
 * claimed, no window opens, no log file, tray item or update check.
 *
 * ## Why it never meets the running Studio's single-instance lock
 *
 * A second launch of a packaged Studio finds the running one through `requestSingleInstanceLock`,
 * and the *running* one is told about it through its `second-instance` event - which is answered by
 * opening the home screen. That call is made in `BaseApp.acquireSingleInstanceLock`, from
 * `index.ts`'s `start()`, which this mode never reaches: no lock is asked for, so the running Studio
 * hears nothing and the bridge is never refused.
 *
 * Electron's own paths are pointed at a scratch folder for the same reason. Chromium writes its own
 * state under them once the app is ready, and two processes writing the running Studio's profile is
 * how files get corrupted; the bridge reads exactly one file there, `agent-mcp.json`, and writes none.
 *
 * Comments in English per project convention.
 */

/** Electron's own state for the bridge process, which keeps none worth keeping. */
const SCRATCH_DIR_NAME = "narraleaf-studio-mcp-stdio";

/**
 * Starts within a few seconds of the bridge itself are not reopen requests: macOS may report the
 * bridge's own launch as an activation, and starting Studio for that would open it unasked.
 */
const ACTIVATION_GRACE_MS = 3_000;

/**
 * The command line that starts Studio as an ordinary, windowed launch.
 *
 * Packaged, that is the executable on its own - except in an AppImage, whose `execPath` is inside a
 * mount that disappears with the process, so the path to the AppImage file itself is the one that
 * still works later. In development the executable is Electron, which needs the bundled main entry
 * (`dist/main/index.js`, beside which `getAppPath()` points) and `--dev`; that command works while
 * `dist/` is built, without the dev server, and the Studio it starts reloads nothing.
 */
export function studioLaunchCommand(electronApp: ElectronApp): AgentStdioCommand {
    if (electronApp.isPackaged) {
        return { command: process.env.APPIMAGE || process.execPath, args: [] };
    }
    return { command: process.execPath, args: [path.join(electronApp.getAppPath(), "index.js"), "--dev"] };
}

/** The command a stdio-only MCP client runs: the launch above, as the bridge. */
export function agentStdioCommand(electronApp: ElectronApp): AgentStdioCommand {
    const launch = studioLaunchCommand(electronApp);
    return { command: launch.command, args: [...launch.args, AGENT_MCP_STDIO_FLAG] };
}

/**
 * The profile whose `agent-mcp.json` the bridge reads: `--user-data-dir` when given, else the one
 * `BaseApp.setupUserDataDir` gives an ordinary launch - `.dev/temp/userData-dev` in development, the
 * platform's default when packaged. Must be read before {@link startAgentStdioBridge} moves
 * Electron's own `userData` path.
 */
export function agentStdioProfileDir(electronApp: ElectronApp, argv: readonly string[]): string {
    const requested = readMcpStdioUserDataDir(argv);
    if (requested) {
        return path.resolve(process.cwd(), requested);
    }
    if (!electronApp.isPackaged) {
        return path.join(path.resolve(electronApp.getAppPath(), "../.."), ".dev", "temp", "userData-dev");
    }
    return electronApp.getPath("userData");
}

/**
 * `fetch` for one request to the endpoint, with no clock of its own: it waits for the answer as
 * long as the connection stays open.
 *
 * Node's global `fetch` is undici's, whose `headersTimeout` and `bodyTimeout` give up after five
 * minutes, and the endpoint sends a tool call's headers only when the tool has finished - so a
 * build longer than that was reported to the client as a lost connection while it went on. The
 * `undici` package that would switch those off is not a dependency Studio ships (only a dev tool's),
 * so this goes through `http` instead, on a connection of its own (`agent: false`: no pooled socket
 * and no agent timeout). What comes back is a real `Response`, its body streamed as it arrives, and a
 * failure to connect rejects the way `fetch` does - a `TypeError` whose `cause` is the socket's
 * error - so the bridge reads both exactly as before. Plain `http:` only: the endpoint is local.
 */
export function fetchWithoutTimeouts(url: string, init: RequestInit = {}): Promise<Response> {
    return new Promise<Response>((resolve, reject) => {
        const target = new URL(url);
        if (target.protocol !== "http:") {
            reject(new TypeError(`Only http: endpoints can be reached, not ${target.protocol}`));
            return;
        }
        const signal = init.signal ?? undefined;
        if (signal?.aborted) {
            reject(signal.reason);
            return;
        }
        const headers = new Headers(init.headers);
        const body = typeof init.body === "string" ? Buffer.from(init.body, "utf8") : null;
        if (body) {
            headers.set("Content-Length", String(body.byteLength));
        }
        const method = init.method ?? "GET";
        const request = http.request(target, { method, headers: Object.fromEntries(headers), agent: false, signal }, incoming => {
            const status = incoming.statusCode ?? 0;
            const responseHeaders = new Headers();
            for (const [name, value] of Object.entries(incoming.headers)) {
                for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
                    responseHeaders.append(name, entry);
                }
            }
            // `Response` refuses a body for these, as `fetch` never gives them one.
            const bodyless = method === "HEAD" || status === 204 || status === 205 || status === 304;
            if (bodyless) {
                incoming.on("error", () => undefined);
                incoming.resume();
            }
            resolve(new Response(bodyless ? null : Readable.toWeb(incoming) as ReadableStream<Uint8Array>, {
                status,
                statusText: incoming.statusMessage ?? "",
                headers: responseHeaders,
            }));
        });
        request.on("error", error => {
            reject(signal?.aborted ? signal.reason : new TypeError("fetch failed", { cause: error }));
        });
        request.end(body ?? undefined);
    });
}

/**
 * Run this process as the bridge, and exit when the client closes standard input. Synchronous up to
 * the point the bridge starts reading, because the GPU and Dock calls must come before `ready`.
 */
export function startAgentStdioBridge(electronApp: ElectronApp, argv: readonly string[]): void {
    // Standard output belongs to JSON-RPC. Anything any module logs goes to standard error instead.
    const toStderr = (...args: unknown[]) => {
        process.stderr.write(`${format(...args)}\n`);
    };
    console.log = toStderr;
    console.info = toStderr;
    console.debug = toStderr;
    console.warn = toStderr;
    const log = (message: string) => toStderr(`[mcp-stdio] ${message}`);

    // Draws nothing, so it needs no GPU; and on macOS a second process of the app would otherwise
    // put a second icon in the Dock for as long as the client keeps it running.
    electronApp.disableHardwareAcceleration();
    if (process.platform === "darwin") {
        electronApp.dock?.hide();
    }

    const profileDir = agentStdioProfileDir(electronApp, argv);
    const overridden = readMcpStdioUserDataDir(argv) !== null;
    try {
        // Per account: on Linux the temporary folder is shared, and another user's copy is not writable.
        const scratch = path.join(os.tmpdir(), `${SCRATCH_DIR_NAME}${process.getuid ? `-${process.getuid()}` : ""}`);
        fs.mkdirSync(scratch, { recursive: true });
        electronApp.setPath("userData", scratch);
        electronApp.setPath("sessionData", scratch);
    } catch (error) {
        log(`Could not move Electron's own state out of the profile: ${String(error)}`);
    }
    log(`Bridging to the endpoint named in ${path.join(profileDir, AGENT_SETTINGS_FILE_NAME)}`);

    // A Studio started from here could not be told to use a profile named on the bridge's command
    // line - an ordinary launch takes no profile flag - so with one, the bridge only connects.
    const launch = overridden ? null : studioLaunchCommand(electronApp);
    let lastLaunchAt = 0;
    const launchStudio = launch
        ? (extraArgs: string[] = []) => {
            lastLaunchAt = Date.now();
            const child = spawn(launch.command, [...launch.args, ...extraArgs], {
                detached: true,
                stdio: "ignore",
                cwd: os.homedir(),
                env: process.env,
            });
            child.on("error", error => log(`Starting Studio failed: ${error.message}`));
            child.unref();
        }
        : null;

    // macOS routes a double-click on Studio (or on a project) to whichever process of the app it
    // finds running - which may be this one. Hand it on to a real launch: when Studio is already
    // running that launch hands over to it like any second launch, and when it is not, it starts.
    // Packaged only: in development the bundle is Electron's own, and a development Studio takes no
    // single-instance lock, so a forwarded launch there would be a second Studio.
    const startedAt = Date.now();
    if (process.platform === "darwin" && electronApp.isPackaged && launchStudio) {
        electronApp.on("activate", () => {
            const now = Date.now();
            if (now - startedAt < ACTIVATION_GRACE_MS || now - lastLaunchAt < ACTIVATION_GRACE_MS) {
                return;
            }
            launchStudio();
        });
        electronApp.on("open-file", (event, filePath) => {
            event.preventDefault();
            launchStudio([filePath]);
        });
    }

    // The client went away: nothing left to answer.
    process.stdout.on("error", () => electronApp.exit(0));
    // A pipe is written asynchronously on macOS, so the last answers may still be queued when the
    // bridge is done; an empty write's callback runs once everything before it has gone out.
    const exitAfterFlush = (code: number) => {
        process.stdout.write("", () => electronApp.exit(code));
    };

    void runAgentStdioBridge({
        input: process.stdin,
        writeLine: line => {
            process.stdout.write(`${line}\n`);
        },
        log,
        fetch: (input, init) => fetch(input, init),
        fetchUntimed: fetchWithoutTimeouts,
        readSettings: async () => {
            try {
                return JSON.parse(await fs.promises.readFile(path.join(profileDir, AGENT_SETTINGS_FILE_NAME), "utf8"));
            } catch {
                return null;
            }
        },
        launchStudio: launchStudio ? () => launchStudio() : null,
        sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
        now: () => Date.now(),
    }).then(
        () => exitAfterFlush(0),
        error => {
            log(`Stopped: ${String(error)}`);
            exitAfterFlush(1);
        },
    );
}
