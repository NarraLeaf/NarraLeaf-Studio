import http from "http";
import type { AddressInfo } from "net";
import { WindowAppType } from "@shared/types/window";
import type { BaseApp } from "../../baseApp";
import type { AppWindow } from "../window/appWindow";
import {
    DevtoolsConsoleBuffer,
    type DevtoolsConsoleLevel,
    type DevtoolsConsoleQuery,
} from "./devtoolsConsoleBuffer";

/**
 * Default port for the Studio debug server. Sits next to the CDP port (9222).
 * Override with the `NLS_DEBUG_PORT` env var.
 */
export const DEFAULT_DEBUG_PORT = 9223;

const DEBUG_HOST = "127.0.0.1";
const CONSOLE_LEVELS: readonly DevtoolsConsoleLevel[] = ["debug", "info", "warning", "error"];

export function resolveDebugPort(): number {
    const raw = process.env.NLS_DEBUG_PORT;
    if (!raw) {
        return DEFAULT_DEBUG_PORT;
    }
    const port = Number(raw);
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_DEBUG_PORT;
}

interface AttachedTap {
    window: AppWindow;
    handler: (...args: unknown[]) => void;
}

/**
 * Dev-only HTTP surface that lets external tooling (agents, scripts, the
 * `project/app/debug.js` CLI) pull Studio's logs without hand-rolling a CDP
 * session. Two log sources are exposed:
 *
 *   - `/console`  the application-level Console service (the in-app bottom
 *                 panel: build, blueprint, story… channels). Read from the
 *                 workspace window through a small renderer bridge.
 *   - `/devtools` the raw Chrome DevTools console feed of any window, captured
 *                 in the main process from window creation onward.
 *
 * Bound to 127.0.0.1 only and started exclusively in development mode.
 */
export class StudioDebugServer {
    private readonly buffer = new DevtoolsConsoleBuffer();
    private readonly taps = new Map<number, AttachedTap>();
    private server: http.Server | null = null;
    private readonly port: number;

    private readonly onWindowCreated = (window: AppWindow) => this.attachTap(window);
    private readonly onWindowClosed = (window: AppWindow) => this.detachTap(window);

    constructor(private readonly app: BaseApp, port: number = resolveDebugPort()) {
        this.port = port;
    }

    public start(): void {
        if (this.server) {
            return;
        }

        // Capture windows that already exist, then follow the lifecycle.
        for (const window of this.app.windowManager.getWindows()) {
            this.attachTap(window);
        }
        this.app.windowManager.events.on("window-created", this.onWindowCreated);
        this.app.windowManager.events.on("window-closed", this.onWindowClosed);

        const server = http.createServer((req, res) => {
            void this.handleRequest(req, res).catch(error => {
                this.sendJson(res, 500, { error: String((error as Error)?.message ?? error) });
            });
        });
        server.on("error", error => {
            this.app.logger.warn(`[Debug] Debug server error (port ${this.port}): ${String(error)}`);
        });
        server.listen(this.port, DEBUG_HOST, () => {
            const address = server.address() as AddressInfo | null;
            const boundPort = address?.port ?? this.port;
            this.app.logger.info(`[Debug] Debug server listening on http://${DEBUG_HOST}:${boundPort}`);
        });
        this.server = server;
    }

    public stop(): void {
        this.app.windowManager.events.off("window-created", this.onWindowCreated);
        this.app.windowManager.events.off("window-closed", this.onWindowClosed);
        for (const window of [...this.taps.values()].map(tap => tap.window)) {
            this.detachTap(window);
        }
        this.server?.close();
        this.server = null;
    }

    private attachTap(window: AppWindow): void {
        let webContents: Electron.WebContents;
        try {
            webContents = window.getWebContents();
        } catch {
            return; // Window already gone.
        }
        const id = webContents.id;
        if (this.taps.has(id)) {
            return;
        }

        this.buffer.track(id, window.getWindowType(), safeTitle(window));

        // Electron 38 emits a details object; the trailing positional args are deprecated.
        const handler = (details: Electron.Event & {
            level?: DevtoolsConsoleLevel | string;
            message?: string;
            lineNumber?: number;
            sourceId?: string;
        }) => {
            this.buffer.push(id, {
                level: normalizeLevel(details?.level),
                message: String(details?.message ?? ""),
                source: details?.sourceId,
                line: details?.lineNumber,
            });
        };

        webContents.on("console-message", handler as (...args: unknown[]) => void);
        this.taps.set(id, { window, handler: handler as (...args: unknown[]) => void });
    }

    private detachTap(window: AppWindow): void {
        let id: number | null = null;
        try {
            id = window.getWebContents().id;
        } catch {
            // Resolve by identity when the webContents is already destroyed.
            for (const [tapId, tap] of this.taps) {
                if (tap.window === window) {
                    id = tapId;
                    break;
                }
            }
        }
        if (id == null) {
            return;
        }
        const tap = this.taps.get(id);
        if (tap) {
            try {
                window.getWebContents().off("console-message", tap.handler);
            } catch {
                /* webContents destroyed; listener is gone with it. */
            }
            this.taps.delete(id);
        }
        this.buffer.markClosed(id);
    }

    private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        if (req.method !== "GET") {
            this.sendJson(res, 405, { error: "Only GET is supported" });
            return;
        }

        const url = new URL(req.url ?? "/", `http://${DEBUG_HOST}:${this.port}`);
        const path = url.pathname.replace(/\/+$/, "") || "/";

        switch (path) {
            case "/":
            case "/health":
                this.sendJson(res, 200, this.health());
                return;
            case "/windows":
                this.sendJson(res, 200, { windows: this.liveWindows(), buffered: this.buffer.listWindows() });
                return;
            case "/devtools":
                this.sendJson(res, 200, this.buffer.query(this.parseDevtoolsQuery(url)));
                return;
            case "/console":
                this.sendJson(res, 200, await this.consoleSnapshot(url));
                return;
            case "/anomalies":
                this.sendJson(res, 200, await this.anomalySnapshot());
                return;
            case "/logs":
                this.sendJson(res, 200, {
                    console: await this.consoleSnapshot(url),
                    devtools: this.buffer.query(this.parseDevtoolsQuery(url)),
                });
                return;
            default:
                this.sendJson(res, 404, { error: `Unknown endpoint: ${path}` });
        }
    }

    private health() {
        return {
            ok: true,
            app: "NarraLeaf Studio",
            version: this.safeVersion(),
            dev: this.app.isDevMode(),
            port: this.port,
            endpoints: ["/health", "/windows", "/console", "/devtools", "/anomalies", "/logs"],
            windows: this.liveWindows(),
        };
    }

    private liveWindows() {
        return this.app.windowManager.getWindows()
            .filter(window => !window.isClosed())
            .map(window => {
                let id: number | null = null;
                let url = "";
                try {
                    const wc = window.getWebContents();
                    id = wc.id;
                    url = wc.getURL();
                } catch {
                    /* window is tearing down */
                }
                return {
                    windowId: id,
                    windowType: window.getWindowType(),
                    title: safeTitle(window),
                    url,
                    // Existing is not the same as on screen: a launcher held back for a project
                    // being opened, and a window that has not finished its first render, are both
                    // here and neither is visible. Without this the only way to tell them apart is
                    // to look at the screen.
                    visible: isVisible(window),
                };
            });
    }

    private findWorkspaceWindow(): AppWindow | null {
        return this.app.windowManager.getWindows().find(window =>
            !window.isClosed() && window.getWindowType() === WindowAppType.Workspace,
        ) ?? null;
    }

    private async consoleSnapshot(url: URL): Promise<Record<string, unknown>> {
        const options = {
            channel: url.searchParams.get("channel") ?? undefined,
            level: url.searchParams.get("level") ?? undefined,
            source: url.searchParams.get("source") ?? undefined,
            since: parseIntParam(url.searchParams.get("since")),
            limit: parseIntParam(url.searchParams.get("limit")),
        };
        return this.readBridge(
            "console",
            `return {available:true,data:d.console.snapshot(${JSON.stringify(options)})};`,
        );
    }

    /**
     * Everything the workspace survived rather than reported.
     *
     * Served rather than left to whoever thinks to evaluate it, because the failures it records are
     * the ones with no other symptom: a corrupt asset shard is set aside and replaced with `{}`, a
     * story that will not parse is left unloaded, and the project then opens looking merely empty.
     * A caller reading only the two log surfaces sees a workspace with nothing to say for itself.
     */
    private async anomalySnapshot(): Promise<Record<string, unknown>> {
        return this.readBridge("anomalies", "return {available:true,data:{anomalies:d.anomalies()}};");
    }

    /**
     * Ask the workspace window's dev bridge for something.
     *
     * `available: false` with a reason rather than an error status, for every way this comes back
     * empty: no workspace window open yet, a renderer built without the bridge, a bridge too old to
     * carry the member asked for, and a call that threw. Polling one of these while Studio is still
     * starting is the ordinary case, and a 500 would make it read as a fault.
     */
    private async readBridge(member: string, body: string): Promise<Record<string, unknown>> {
        const workspace = this.findWorkspaceWindow();
        if (!workspace) {
            return { available: false, reason: "no-workspace-window" };
        }
        const code = buildBridgeCallScript(member, body);

        try {
            const result = await workspace.getWebContents().executeJavaScript(code, false);
            return result as Record<string, unknown>;
        } catch (error) {
            return { available: false, reason: `eval-failed: ${String((error as Error)?.message ?? error)}` };
        }
    }

    private parseDevtoolsQuery(url: URL): DevtoolsConsoleQuery {
        const levelParam = url.searchParams.get("level");
        const level = levelParam && (CONSOLE_LEVELS as readonly string[]).includes(levelParam)
            ? (levelParam as DevtoolsConsoleLevel)
            : undefined;
        return {
            window: url.searchParams.get("window") ?? undefined,
            level,
            since: parseIntParam(url.searchParams.get("since")),
            afterSeq: parseIntParam(url.searchParams.get("afterSeq")),
            limit: parseIntParam(url.searchParams.get("limit")),
        };
    }

    private safeVersion(): string {
        try {
            return this.app.getAppInfo().version;
        } catch {
            return "unknown";
        }
    }

    private sendJson(res: http.ServerResponse, status: number, body: unknown): void {
        const payload = JSON.stringify(body, null, 2);
        res.writeHead(status, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
        });
        res.end(payload);
    }
}

/**
 * The script a bridge read runs inside the workspace window.
 *
 * A string, evaluated in another process, whose every failure mode has to come back as data rather
 * than as a rejected promise - so a mistake inside it does not surface as a mistake inside it, but
 * as `available: false` with a reason that reads exactly like a renderer built without the bridge.
 * Built here, and separately from the server, so the four answers it can give can be pinned by a
 * test that simply runs it.
 *
 * `body` is trusted: it comes from this file, and the only thing interpolated into it is
 * JSON-encoded query options.
 */
export function buildBridgeCallScript(member: string, body: string): string {
    return `(function(){try{`
        + `var d=window.__NLS_STUDIO_DEBUG__;`
        + `if(!d){return {available:false,reason:'bridge-not-installed'};}`
        + `if(!d[${JSON.stringify(member)}]){return {available:false,reason:'bridge-too-old'};}`
        + body
        + `}catch(e){return {available:false,reason:String((e&&e.message)||e)};}})()`;
}

function normalizeLevel(level: DevtoolsConsoleLevel | string | undefined): DevtoolsConsoleLevel {
    switch (String(level ?? "").toLowerCase()) {
        case "error":
            return "error";
        case "warning":
        case "warn":
            return "warning";
        case "debug":
        case "verbose":
            return "debug";
        default:
            return "info";
    }
}

function safeTitle(window: AppWindow): string {
    try {
        return window.getTitle();
    } catch {
        return "";
    }
}

function isVisible(window: AppWindow): boolean {
    try {
        return window.win.isVisible();
    } catch {
        return false;
    }
}

function parseIntParam(value: string | null): number | undefined {
    if (value == null || value === "") {
        return undefined;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}
