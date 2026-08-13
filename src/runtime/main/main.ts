import fsSync from "fs";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Readable } from "stream";
import { nativeImage } from "electron";
import { shell } from "electron";
import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session } from "electron/main";
import { WebSocketServer, type WebSocket } from "ws";
import type { GameTestEvent } from "@shared/types/gameTest";
import {
    GAME_RUNTIME_CLOSE_DECISION_CHANNEL,
    GAME_RUNTIME_CLOSE_REQUESTED_CHANNEL,
    GAME_RUNTIME_FULLSCREEN_CHANGED_CHANNEL,
    GAME_RUNTIME_PROTOCOL,
    GAME_RUNTIME_SIDECAR_MESSAGE_CHANNEL,
    DEFAULT_GAME_CRASH_POLICY,
    normalizeGameCrashPolicy,
    type GameCrashPolicy,
    type GameRuntimePackV1,
} from "@shared/types/gameRuntime";
import { getMimeType } from "@shared/utils/fs";
import {
    buildGameRuntimeAssetVersionArg,
    buildGameRuntimeCrashPolicyArg,
    buildGameRuntimeLogPathArg,
} from "@shared/utils/gameRuntimeAssetUrl";
import {
    resolveGameRuntimeEntrySurface,
    resolveGameRuntimeInitialBackgroundColor,
} from "@shared/utils/gameRuntimeEntrySurface";
import { resolveSingleByteRange } from "@shared/utils/httpRange";
import type { BlueprintNetworkFetchRequest } from "@shared/types/blueprint/network";
import {
    resolveDeclaredExternalLink,
    resolvePluginExternalLinkAmong,
    type BlueprintOpenExternalRequest,
    type BlueprintOpenExternalResult,
} from "@shared/types/blueprint/externalLink";
import { executeBlueprintNetworkFetch } from "@shared/utils/blueprintNetworkFetch";
import { createRuntimeResources, type RuntimeResources } from "./runtimeResources";
import {
    PLUGIN_REACT_MODULE_SOURCES,
    PLUGIN_RUNTIME_API_MODULE_SOURCE,
} from "@shared/utils/pluginRuntimeApiModule";
import { resolveRuntimeStaticPath } from "./runtimeProtocol";
import { injectRuntimeCsp, installRuntimeNetworkPolicy } from "./networkPolicy";
import { dispatchControlFrame, encodeTestEventFrame } from "./testControlProtocol";
import { GAME_RUNTIME_TEST_SIGNAL_CHANNEL, toGameTestEvent } from "../gameTestSignal";
import {
    RuntimePersistenceStore,
    RuntimeSaveStore,
} from "./runtimeStorage";
import { collectPackSidecars, SidecarHost } from "./sidecarHost";
import { resolveRuntimeUserDataDir } from "./userDataDir";
import { installRuntimeLogSink, runtimeLogPath } from "./runtimeLog";
import { installWindowCrashHandling } from "./windowCrashHandling";

const appDir = __dirname;

/**
 * Early facts from the loose app manifest, readable synchronously before
 * app-ready so path setup and the debugger guard run before Chromium does any
 * work. The pack's own `mode` (which may live in the consolidated store) stays
 * authoritative for everything decided after the pack is open; a stripped or
 * tampered manifest only ever downgrades to the stricter checks below.
 */
function readShellManifest(): { mode: "preview" | "production"; userDataDirName: string | null } {
    try {
        const manifest = JSON.parse(fsSync.readFileSync(path.join(appDir, "package.json"), "utf-8")) as {
            narraleaf?: { mode?: unknown; userDataDir?: unknown };
        };
        const userDataDir = manifest.narraleaf?.userDataDir;
        return {
            mode: manifest.narraleaf?.mode === "production" ? "production" : "preview",
            userDataDirName: typeof userDataDir === "string" && userDataDir.trim() ? userDataDir.trim() : null,
        };
    } catch {
        return { mode: "preview", userDataDirName: null };
    }
}

const shellManifest = readShellManifest();
const shellMode = shellManifest.mode;

/**
 * A test asked for this game to run with no way out to the network.
 *
 * An environment variable rather than a pack field: the pack is the game's own content and is
 * identical whether a test launched it or an author did, and baking "this run has no network" into
 * it would mean recompiling to change how a run is observed.
 */
const testNetworkBlocked = process.env.NARRALEAF_TEST_NETWORK === "blocked";

// Preview keeps saves next to the compiled app; a shipped game names its
// per-user directory explicitly (see resolvePlayerDataDir).
const previewUserDataDir = path.resolve(appDir, "..", "userData");
const useSiblingUserData = shellMode !== "production" && fsSync.existsSync(previewUserDataDir);
const userDataDir = useSiblingUserData
    ? previewUserDataDir
    : resolveRuntimeUserDataDir(shellManifest.userDataDirName, {
        platform: process.platform,
        appDataDir: app.getPath("appData"),
        shellUserDataDir: app.getPath("userData"),
        homeDir: os.homedir(),
        xdgDataHome: process.env.XDG_DATA_HOME,
        exists: target => fsSync.existsSync(target),
        makeDirectory: target => { fsSync.mkdirSync(target, { recursive: true }); },
        move: (from, to) => { fsSync.renameSync(from, to); },
        warn: message => { console.warn(`[GameRuntime] ${message}`); },
    });

/**
 * Everything this process and the game have to say, on disk.
 *
 * Installed here rather than at app-ready because the failures worth having a log for include the
 * ones during startup, and because it is the first moment the profile directory is known.
 */
const logRuntime = installRuntimeLogSink(userDataDir);


/** Node inspector / Chromium remote-debugging switches refused in production. */
const DEBUG_SWITCHES = [
    "remote-debugging-port",
    "remote-debugging-pipe",
    "inspect",
    "inspect-brk",
    "inspect-port",
    "inspect-publish-uid",
];

let packPromise: Promise<GameRuntimePackV1> | null = null;
/** The game's own name, once the pack has been read. Titles the crash dialogs. */
let loadedPackName: string | null = null;
/** What this build does when it stops working, from the pack. */
let crashPolicy: GameCrashPolicy = DEFAULT_GAME_CRASH_POLICY;
let mainWindow: BrowserWindow | null = null;
let controlServer: WebSocketServer | null = null;
let resources: RuntimeResources | null = null;
let saveStore: RuntimeSaveStore | null = null;
let persistenceStore: RuntimePersistenceStore | null = null;
let sidecarHost: SidecarHost | null = null;
/**
 * Set once the quit has already drained everything that needs draining (queued
 * storage writes, running sidecars), so the second pass through `before-quit`
 * does not start over.
 */
let runtimeQuitDrained = false;
/**
 * Set once the app has started quitting (Quit Application node, window-all-closed, preview
 * shutdown). The window-close guard stands aside while this is true, so a programmatic quit never
 * fires the blueprint `On Window Close Requested` event - that is reserved for the user closing the
 * window.
 */
let isQuitting = false;
/** Pending window-close decisions, keyed by requestId, resolved by the renderer's reply. */
const pendingCloseDecisions = new Map<number, (allow: boolean) => void>();
let closeDecisionSeq = 0;
/**
 * Upper bound on how long the close is held open while the renderer's blueprints decide. A
 * synchronous decision returns in milliseconds; the timeout only bounds a hung/crashed renderer,
 * after which the window closes (the default is to close unless a blueprint cancels it).
 */
const CLOSE_DECISION_TIMEOUT_MS = 60 * 1000;

/**
 * The active resource backend. Established once at startup; every packaged read
 * (pack, assets, bundled plugin entries) goes through it.
 */
function runtimeResources(): RuntimeResources {
    if (!resources) {
        throw new Error("Runtime resources accessed before initialization");
    }
    return resources;
}

/** Whether the process was started with an inspector / remote-debugging switch. */
function hasDebuggingSwitch(): boolean {
    if (DEBUG_SWITCHES.some(name => app.commandLine.hasSwitch(name))) {
        return true;
    }
    const pattern = /^--(remote-debugging-(port|pipe)|inspect(-brk|-port|-publish-uid)?)(=|$)/;
    return [...process.argv, ...process.execArgv].some(arg => pattern.test(arg));
}

protocol.registerSchemesAsPrivileged([
    {
        scheme: GAME_RUNTIME_PROTOCOL,
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            corsEnabled: true,
            // Media elements need streamed responses for playback and seeking;
            // without this the whole payload buffers before <video> starts.
            stream: true,
        },
    },
]);

// Both the sibling preview directory and a shipped game's named one differ from
// what the shell resolved on its own, and everything Chromium keeps here (caches,
// cookies, local storage) has to follow the same move as the player's files.
if (userDataDir !== app.getPath("userData")) {
    app.setPath("userData", userDataDir);
}

if (testNetworkBlocked) {
    // Belt, applied here because command-line switches are only read before Chromium starts:
    // every name resolves to NOTFOUND, so a game that reaches for a host fails the way a player's
    // would rather than the way a firewall's does. `EXCLUDE localhost` is not optional - Chromium
    // resolves its own inspector endpoint through this, and dropping it takes DevTools with it.
    //
    // Braces are the `webRequest` veto in networkPolicy.ts, which is what actually enforces the
    // block: a literal IP never goes through DNS at all, so this switch alone would leak.
    app.commandLine.appendSwitch("host-resolver-rules", "MAP * ~NOTFOUND, EXCLUDE localhost");
    console.log(
        "[GameRuntime] Network blocked for this run (NARRALEAF_TEST_NETWORK=blocked): "
        + "only nlgame:, file:, devtools:, data:/blob: and loopback will load.",
    );
}

// Earliest possible refusal to run a production game under an attached
// debugger/CDP: before app-ready, before any window or session exists. The
// post-pack-read check below stays as the authoritative (tamper-resistant on
// asar-integrity platforms) second gate.
const startupBlocked = shellMode === "production" && hasDebuggingSwitch();
if (startupBlocked) {
    app.quit();
}

void app.whenReady().then(async () => {
    if (startupBlocked) {
        return;
    }
    resources = await createRuntimeResources(appDir);
    const pack = await readPack();
    if (pack.mode === "production" && hasDebuggingSwitch()) {
        // Refuse to run a production game under an attached debugger/CDP.
        app.quit();
        return;
    }
    const allowHttp = pack.network?.allowHttp === true;
    applyRuntimeAppIdentity(pack);
    applyRuntimeMenu();
    registerRuntimeProtocol(allowHttp);
    sidecarHost = createSidecarHost(pack);
    registerRuntimeIpc();
    startPreviewControlServer(pack);
    // Confine the renderer to the app protocol before it loads any document
    // unless the project opted into HTTP - and unconditionally when a test asked
    // for a network-less run, which overrides the project's own flag.
    installRuntimeNetworkPolicy(session.defaultSession, { allowHttp, blockAll: testNetworkBlocked });
    mainWindow = createWindow(pack);
    // After the window exists so a sidecar's first event has somewhere to land,
    // and unawaited so a slow handshake never delays the game's first paint.
    sidecarHost.startAutostart();
    // A preview stopped while it was still booting quits mid-load, and the pending navigation then
    // rejects with ERR_FAILED. That is the shutdown working, not a failure to report - and the
    // author, who pressed Stop, would otherwise read an unhandled rejection on the Studio console.
    // Keyed on the quit rather than on the window being destroyed: `app.quit()` aborts the load
    // first and tears the window down after, so `isDestroyed()` is still false when this rejects.
    await mainWindow.loadURL(`${GAME_RUNTIME_PROTOCOL}://runtime/index.html`).catch(error => {
        if (isQuitting) {
            return;
        }
        throw error;
    });
});

/**
 * Sidecars are addressed by the plugin that shipped them, but the pack - not the
 * caller - decides what exists: {@link collectPackSidecars} is the only source of
 * declarations, so an id this build never packaged has nothing to spawn.
 */
function createSidecarHost(pack: GameRuntimePackV1): SidecarHost {
    return new SidecarHost(collectPackSidecars(pack), {
        appDir,
        userDataDir,
        execPath: process.execPath,
        mode: pack.mode,
        game: { name: pack.project.name, version: pack.project.version ?? null },
        log: (level, message) => {
            logRuntime(level, message);
        },
        send: message => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send(GAME_RUNTIME_SIDECAR_MESSAGE_CHANNEL, message);
            }
        },
    });
}

app.on("window-all-closed", () => {
    app.quit();
});

app.on("before-quit", event => {
    // From here on every window close is part of the quit, not a user close, so the close guard
    // must stand aside (it also lets the quit-and-flush dance below re-close without re-prompting).
    isQuitting = true;
    // Two things can outlive the decision to quit: debounced storage writes that
    // have not reached disk, and sidecar processes that have not been told to
    // stop. Both are drained on this one held-open pass rather than on separate
    // ones - a second `before-quit` path would race this one's re-quit.
    if (!runtimeQuitDrained) {
        const pendingWrites = saveStore?.hasPendingWrites() === true || persistenceStore?.hasPendingWrites() === true;
        const runningSidecars = sidecarHost?.needsShutdown() === true;
        if (pendingWrites || runningSidecars) {
            event.preventDefault();
            void Promise.allSettled([
                saveStore?.flush(),
                persistenceStore?.flush(),
                // Polite first (`bye`), then SIGTERM, then SIGKILL - all inside
                // the sidecar's own declared shutdown timeout, and bounded, so a
                // wedged sidecar cannot trap the quit.
                sidecarHost?.shutdownAll(),
            ]).then(() => {
                runtimeQuitDrained = true;
                app.quit();
            });
            return;
        }
        runtimeQuitDrained = true;
    }
    controlServer?.close();
    controlServer = null;
    testSubscribers.clear();
    void resources?.dispose();
    resources = null;
});

/**
 * Last line of defence against an orphaned sidecar. `before-quit` does the
 * graceful shutdown, but it can be skipped (a second quit path, a preventDefault
 * elsewhere, an exception in a listener) and `will-quit`/`exit` cannot: the only
 * thing that runs here is a synchronous SIGKILL of anything still breathing.
 *
 * A sidecar is also expected to exit on stdin EOF, which covers the one case no
 * handler can - the game's process dying without running any of its own code.
 */
app.on("will-quit", () => {
    sidecarHost?.killAllSync();
});
process.on("exit", () => {
    sidecarHost?.killAllSync();
});

/**
 * Sockets that asked for test events with `test:subscribe`.
 *
 * Empty in every ordinary run: a production pack carries no `preview` block, so there is no control
 * server for anything to subscribe on. That is what makes {@link emitTestEvent} safe to call from
 * anywhere, including a crash handler - with no subscribers it does nothing at all.
 *
 * Declared above the error monitor below rather than after it, so an exception thrown while this
 * module is still evaluating finds an initialised set instead of a temporal-dead-zone error that
 * would replace the real crash with a bogus one.
 */
const testSubscribers = new Set<WebSocket>();

/** `ws` readyState for an open socket; compared numerically so no `ws` value import is needed. */
const WEBSOCKET_OPEN = 1;

function describeRuntimeError(error: unknown): { message: string; stack?: string } {
    if (error instanceof Error) {
        return {
            message: error.message || String(error),
            ...(error.stack ? { stack: error.stack } : {}),
        };
    }
    return { message: String(error) };
}

/**
 * Report an uncaught error in the game's main process without changing what happens next.
 *
 * `uncaughtExceptionMonitor` rather than `uncaughtException` / `unhandledRejection`: registering
 * either of those *replaces* Node's default handling, and the default is to die. A game left alive
 * after an uncaught exception - half-initialised, its invariants gone - is a worse bug than the
 * missing report this hook exists to fix, and a test watching that wreck would call it a pass.
 * The monitor observes and the process still ends exactly as it would have. Unhandled rejections
 * arrive here too: Node's default mode raises them as uncaught exceptions.
 *
 * Best-effort by nature - the frame is written to the socket on the way out, and a process that
 * dies before the kernel drains it loses the message. Studio still classifies the death from the
 * exit code, so a lost frame costs detail, not the verdict.
 */
process.on("uncaughtExceptionMonitor", (error: unknown, origin?: string) => {
    const described = describeRuntimeError(error);
    const headline = origin === "unhandledRejection"
        ? `Unhandled rejection: ${described.message}`
        : described.message;
    emitTestEvent({
        kind: "runtime-error",
        scope: "main",
        message: headline,
        ...(described.stack ? { stack: described.stack } : {}),
    });
    // Written before the box below, so the record survives even if drawing it is what fails. Both
    // are new: this used to report to a test nobody was running and then let the process disappear
    // off the player's screen without a word.
    logRuntime("error", `[Crash] ${headline}${described.stack ? `\n${described.stack}` : ""}`);
    reportFatalRuntimeError(headline);
});

/**
 * Tell the player the game is going down, on its way down.
 *
 * `showErrorBox` because it is synchronous and needs no window: by this point the process has
 * milliseconds left, and the window is often the thing that died. The stack stays in the log - a
 * player cannot act on it, and the author asking for it can be pointed at a file.
 *
 * Wrapped whole. A failure to report a fatal error must not become a second fatal error.
 */
function reportFatalRuntimeError(headline: string): void {
    try {
        dialog.showErrorBox(
            gameDisplayName(),
            `${headline}\n\nThe game has to close. Details were written to ${runtimeLogPath(userDataDir)}`,
        );
    } catch {
        /* No window server, or a dialog that refused. The log line above is the report. */
    }
}

/** The game's own name once the pack has been read, and something honest before that. */
function gameDisplayName(): string {
    return loadedPackName ?? app.getName();
}

function emitTestEvent(event: GameTestEvent): void {
    if (testSubscribers.size === 0) {
        return;
    }
    const frame = encodeTestEventFrame(event);
    for (const socket of Array.from(testSubscribers)) {
        if (socket.readyState !== WEBSOCKET_OPEN) {
            continue;
        }
        try {
            socket.send(frame);
        } catch {
            // A subscriber that vanished mid-run is not the game's problem; its own close/error
            // handler reaps it from the set.
        }
    }
}

async function readPack(): Promise<GameRuntimePackV1> {
    if (!packPromise) {
        packPromise = runtimeResources()
            .readPack()
            .then(raw => JSON.parse(raw.toString("utf-8")) as GameRuntimePackV1);
    }
    return packPromise;
}

function createWindow(pack: GameRuntimePackV1): BrowserWindow {
    const size = resolveInitialWindowSize(pack);
    const icon = createProjectIcon(pack);
    // Production disables DevTools outright: with devTools:false Electron ignores
    // any openDevTools call and the menu/keyboard toggles become no-ops, so there
    // is no in-app path to the inspector (the startup switch guard covers CDP).
    const devToolsEnabled = pack.mode !== "production";
    const win = new BrowserWindow({
        title: pack.project.name,
        width: size.width,
        height: size.height,
        minWidth: 480,
        minHeight: 320,
        center: true,
        frame: true,
        // Windows and Linux lay the menu bar out inside the window, so it has to
        // be gone before the first frame or the game's viewport is measured with
        // a strip taken out of it. Ignored on macOS, where the menu is the OS's.
        autoHideMenuBar: true,
        // Stay hidden until the renderer's first paint so launch never flashes
        // an empty window; the background matches the entry surface for the
        // brief gap between first paint and the surface rendering its content.
        show: false,
        ...(icon ? { icon } : {}),
        backgroundColor: resolveGameRuntimeInitialBackgroundColor(pack),
        webPreferences: {
            preload: path.join(appDir, "preload.js"),
            contextIsolation: true,
            devTools: devToolsEnabled,
            // The preload derives versioned asset URLs from this marker; a
            // process argument is the only synchronous channel it can read
            // before the document loads.
            additionalArguments: [
                buildGameRuntimeAssetVersionArg(resolveAssetVersion(pack)),
                // So the crash screen is right from the first frame. The failure it is most likely
                // to draw happens while the pack is still being read, and asking the pack for the
                // policy then would mean falling back to "show the error" in exactly the build
                // whose author asked for the opposite.
                buildGameRuntimeCrashPolicyArg(normalizeGameCrashPolicy(pack.crash?.policy)),
                // So the crash screen can say where the report is. The one thing a player can do
                // about a crash is hand the file over, which needs them to be told where it is.
                buildGameRuntimeLogPathArg(runtimeLogPath(userDataDir)),
            ],
        },
    });
    win.setTitle(pack.project.name);
    if (process.platform !== "darwin") {
        // The window carries a menu of its own, and `autoHideMenuBar` only hides
        // it - Alt would still pull it back down over the game. Removing it is
        // what makes the bar unreachable rather than merely out of sight.
        win.removeMenu();
    }
    // Show on first paint. The timer is a safety net: a renderer that never
    // reaches ready-to-show should still surface a window rather than leave
    // the process running invisibly.
    const fallbackShow = setTimeout(() => {
        if (!win.isDestroyed() && !win.isVisible()) {
            win.show();
        }
    }, 3000);
    win.once("ready-to-show", () => {
        clearTimeout(fallbackShow);
        if (!win.isDestroyed()) {
            win.show();
        }
    });
    // Give the game's blueprints a chance to intercept a user-initiated close (native close box, OS
    // shortcut) via the `On Window Close Requested` head: hold the close, ask the renderer, and
    // re-issue it once nothing cancelled it. Every app.quit() path sets isQuitting first and so
    // bypasses this, meaning the Quit Application node never fires the blueprint close event.
    let closeApproved = false;
    let closeDecisionPending = false;
    win.on("close", event => {
        if (isQuitting || closeApproved || win.isDestroyed()) {
            return;
        }
        event.preventDefault();
        if (closeDecisionPending) {
            return;
        }
        closeDecisionPending = true;
        void requestRendererCloseDecision(win).then(allow => {
            closeDecisionPending = false;
            if (win.isDestroyed()) {
                return;
            }
            if (allow) {
                closeApproved = true;
                win.close();
            }
        });
    });
    win.on("closed", () => {
        if (mainWindow === win) {
            mainWindow = null;
        }
    });
    // Push fullscreen transitions to the renderer so the `On Fullscreen Changed`
    // blueprint head also fires for fullscreen toggled outside the game (macOS
    // green button, OS shortcuts), not just via the Set Fullscreen node.
    const emitFullscreen = (isFullscreen: boolean) => () => {
        if (!win.isDestroyed()) {
            win.webContents.send(GAME_RUNTIME_FULLSCREEN_CHANGED_CHANNEL, isFullscreen);
        }
    };
    win.on("enter-full-screen", emitFullscreen(true));
    win.on("leave-full-screen", emitFullscreen(false));
    installWindowCrashHandling(win, {
        log: logRuntime,
        logPath: runtimeLogPath(userDataDir),
        displayName: gameDisplayName,
        // Read through rather than captured: the pack settles the policy as the window is being
        // built, and a snapshot taken here could be one step behind it.
        policy: () => crashPolicy,
        isQuitting: () => isQuitting,
        quit: () => {
            isQuitting = true;
            app.quit();
        },
        reportFatal: reportFatalRuntimeError,
        ask: async request => (await dialog.showMessageBox(win, {
            type: "warning",
            title: request.title,
            message: request.message,
            detail: request.detail,
            buttons: request.buttons,
            defaultId: 0,
            cancelId: 0,
            noLink: true,
        })).response,
        now: () => Date.now(),
    });
    if (devToolsEnabled) {
        win.webContents.on("before-input-event", (_event, input) => {
            if (input.type === "keyUp" && input.key === "F12") {
                if (win.webContents.isDevToolsOpened()) {
                    win.webContents.closeDevTools();
                } else {
                    win.webContents.openDevTools({ mode: "detach" });
                }
            }
        });
    }
    return win;
}

/**
 * Ask the renderer whether a user-initiated close may proceed, resolving to the blueprint's
 * decision. Each request carries a unique id the renderer echoes back; a hung/crashed renderer
 * falls back to closing so the window can never get trapped open.
 */
function requestRendererCloseDecision(win: BrowserWindow): Promise<boolean> {
    if (win.isDestroyed()) {
        return Promise.resolve(true);
    }
    const requestId = ++closeDecisionSeq;
    return new Promise<boolean>(resolve => {
        let settled = false;
        const finish = (allow: boolean) => {
            if (settled) {
                return;
            }
            settled = true;
            pendingCloseDecisions.delete(requestId);
            clearTimeout(timer);
            resolve(allow);
        };
        const timer = setTimeout(() => finish(true), CLOSE_DECISION_TIMEOUT_MS);
        pendingCloseDecisions.set(requestId, finish);
        win.webContents.send(GAME_RUNTIME_CLOSE_REQUESTED_CHANNEL, { requestId });
    });
}

/**
 * No mode ships Electron's default menu: it carries Reload and DevTools items
 * (and their accelerators) that have no place above a game, and a menu bar is
 * chrome the author's surface layout never accounts for. Preview is held to the
 * same rule deliberately - a playtest that grows a menu bar is not the window
 * the player gets - and it loses nothing, because preview's DevTools is on F12
 * and its reload comes from the Studio recompiling, neither of which was ever
 * the menu's doing.
 *
 * macOS cannot simply drop the menu. It is the process's only route to Quit,
 * and the Edit roles are what make Cmd+C/V work inside a text field at all
 * (the OS routes those through the menu, so a game with no Edit menu has a save
 * name box nothing can be pasted into). That platform therefore keeps the
 * smallest set that leaves the OS's own operations intact, and nothing beyond it.
 */
function applyRuntimeMenu(): void {
    if (process.platform === "darwin") {
        Menu.setApplicationMenu(Menu.buildFromTemplate([
            { role: "appMenu" },
            { role: "editMenu" },
            { role: "windowMenu" },
        ]));
    } else {
        Menu.setApplicationMenu(null);
    }
}

function applyRuntimeAppIdentity(pack: GameRuntimePackV1): void {
    crashPolicy = normalizeGameCrashPolicy(pack.crash?.policy);
    // Also the title of any error box after this point. Before it there is no name to use, which
    // is itself a fact worth keeping honest rather than papering over with the product's name.
    loadedPackName = pack.project.name;
    app.setName(pack.project.name);
    app.setAboutPanelOptions({
        applicationName: pack.project.name,
        applicationVersion: pack.project.version ?? pack.runtimeVersion,
    });
    const icon = createProjectIcon(pack);
    if (icon && process.platform === "darwin" && app.dock) {
        app.dock.setIcon(icon);
    }
}

function createProjectIcon(pack: GameRuntimePackV1): Electron.NativeImage | undefined {
    const relativePath = pack.project.icon?.relativePath;
    if (!relativePath) {
        return undefined;
    }
    try {
        const iconPath = resolveRuntimeStaticPath(appDir, relativePath);
        const image = nativeImage.createFromPath(iconPath);
        return image.isEmpty() ? undefined : image;
    } catch (error) {
        console.warn("[GameRuntime] Failed to load project icon", error);
        return undefined;
    }
}

function resolveInitialWindowSize(pack: GameRuntimePackV1): { width: number; height: number } {
    const surface = resolveGameRuntimeEntrySurface(pack);
    const width = surface?.designSize.width;
    const height = surface?.designSize.height;
    if (Number.isFinite(width) && Number.isFinite(height) && width! > 0 && height! > 0) {
        return { width: Math.round(width!), height: Math.round(height!) };
    }
    return { width: 1280, height: 720 };
}


/**
 * Version tag baked into every asset URL by the preload. The per-compile
 * bundle id changes whenever the Studio produces a new pack, which is exactly
 * the lifetime of "this asset id maps to these bytes": asset ids themselves
 * are stable across recompiles, so they cannot key the HTTP cache alone.
 */
function resolveAssetVersion(pack: GameRuntimePackV1): string {
    const bundleId = String(pack.bundle?.bundleId ?? "").trim();
    return bundleId || pack.generatedAt || String(Date.now());
}

function registerRuntimeProtocol(allowHttp: boolean): void {
    protocol.handle(GAME_RUNTIME_PROTOCOL, async request => {
        const url = new URL(request.url);
        try {
            if (url.hostname === "runtime") {
                const pathname = decodeURIComponent(url.pathname);
                if (isIndexDocument(pathname)) {
                    return serveIndexDocument(resolveRuntimeStaticPath(appDir, pathname), allowHttp);
                }
                // Bundled runtime files (e.g. plugin entries) come from the store;
                // static runtime files fall back to a loose read from the app dir.
                const bundled = await runtimeResources().readRuntimeFile(pathname.replace(/^\/+/, ""));
                if (bundled) {
                    return serveBytes(bundled, getMimeType(pathname));
                }
                return serveFile(resolveRuntimeStaticPath(appDir, pathname));
            }
            if (url.hostname === "pack") {
                return serveBytes(await runtimeResources().readPack(), "application/json");
            }
            if (url.hostname === "plugin-api") {
                const pathname = `/${decodeURIComponent(url.pathname).replace(/^\/+/, "")}`;
                const source = pathname === "/runtime.js"
                    ? PLUGIN_RUNTIME_API_MODULE_SOURCE
                    : PLUGIN_REACT_MODULE_SOURCES[pathname];
                if (source) {
                    return new Response(source, {
                        status: 200,
                        headers: {
                            "Content-Type": "text/javascript",
                            // Fixed per runtime build and served from memory; a
                            // modest lifetime skips re-fetches within a session
                            // without pinning sources across Studio upgrades.
                            "Cache-Control": "public, max-age=3600",
                        },
                    });
                }
                return new Response("Not found", { status: 404 });
            }
            if (url.hostname === "asset") {
                // The query string only versions the URL for HTTP cache keying
                // (see the preload's assetUrl); assets resolve by pathname alone.
                const assetId = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
                return await serveAsset(request, assetId);
            }
            return new Response("Not found", { status: 404 });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return new Response(message, { status: 404 });
        }
    });
}

/**
 * Asset responses are effectively immutable: every asset URL carries a
 * per-pack version query, so a newer pack always requests different URLs and
 * long-lived cache entries can never go stale. Caching matters here - the
 * game engine drops and re-fetches images on every scene change, and without
 * it each of those requests round-trips into this process.
 *
 * Verified on Electron 38: custom-protocol responses never enter Chromium's
 * HTTP cache - no disk-cache entries are written and fetch() re-requests the
 * same URL every time. This header is honored only by the renderer's
 * in-memory resource cache (notably decoded images), which is the desired
 * shape: repeat <img> loads are served inside the renderer without a
 * round-trip here, while asset bytes never persist to the user's disk.
 */
const ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** Loose assets above this size stream from disk instead of buffering fully. */
const ASSET_STREAM_THRESHOLD_BYTES = 8 * 1024 * 1024;

async function serveAsset(request: Request, assetId: string): Promise<Response> {
    const pack = await readPack();
    const contentType = pack.assets.items[assetId]?.mimeType ?? getMimeType(assetId);
    const rangeHeader = request.headers.get("range");
    const filePath = runtimeResources().getAssetFilePath(pack, assetId);
    if (filePath) {
        const { size } = await fs.stat(filePath);
        const range = resolveSingleByteRange(rangeHeader, size);
        if (range.kind === "unsatisfiable") {
            return rangeNotSatisfiable(size);
        }
        if (range.kind === "partial") {
            return streamAssetFile(filePath, contentType, range, size, 206);
        }
        if (size > ASSET_STREAM_THRESHOLD_BYTES) {
            return streamAssetFile(filePath, contentType, { start: 0, end: size - 1 }, size, 200);
        }
        return assetResponse(await fs.readFile(filePath), contentType);
    }
    const data = await runtimeResources().readAsset(pack, assetId);
    const range = resolveSingleByteRange(rangeHeader, data.byteLength);
    if (range.kind === "unsatisfiable") {
        return rangeNotSatisfiable(data.byteLength);
    }
    if (range.kind === "partial") {
        // subarray shares the underlying memory, so range requests against a
        // cached buffer cost no copy.
        return new Response(asBodyBytes(data.subarray(range.start, range.end + 1)), {
            status: 206,
            headers: partialAssetHeaders(contentType, range, data.byteLength),
        });
    }
    return assetResponse(data, contentType);
}

function assetHeaders(contentType: string): Record<string, string> {
    return {
        "Content-Type": contentType,
        "Cache-Control": ASSET_CACHE_CONTROL,
        "Accept-Ranges": "bytes",
    };
}

function partialAssetHeaders(
    contentType: string,
    range: { start: number; end: number },
    totalSize: number,
): Record<string, string> {
    return {
        ...assetHeaders(contentType),
        "Content-Range": `bytes ${range.start}-${range.end}/${totalSize}`,
        "Content-Length": String(range.end - range.start + 1),
    };
}

function assetResponse(data: Buffer, contentType: string): Response {
    return new Response(asBodyBytes(data), {
        status: 200,
        headers: assetHeaders(contentType),
    });
}

function rangeNotSatisfiable(totalSize: number): Response {
    return new Response(null, {
        status: 416,
        headers: {
            "Content-Range": `bytes */${totalSize}`,
            "Accept-Ranges": "bytes",
        },
    });
}

function streamAssetFile(
    filePath: string,
    contentType: string,
    range: { start: number; end: number },
    totalSize: number,
    status: 200 | 206,
): Response {
    const stream = fsSync.createReadStream(filePath, { start: range.start, end: range.end });
    const headers = status === 206
        ? partialAssetHeaders(contentType, range, totalSize)
        : { ...assetHeaders(contentType), "Content-Length": String(totalSize) };
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream, { status, headers });
}

async function serveFile(filePath: string, contentType = getMimeType(filePath)): Promise<Response> {
    return serveBytes(await fs.readFile(filePath), contentType);
}

/** Runtime code and the pack stay no-store: preview recompiles must always be fresh. */
function serveBytes(data: Buffer, contentType: string): Response {
    return new Response(asBodyBytes(data), {
        status: 200,
        headers: {
            "Content-Type": contentType,
            "Cache-Control": "no-store",
        },
    });
}

/**
 * Hand Buffer bytes to a Response without the copy `new Uint8Array(data)`
 * would make: a Buffer already satisfies the runtime BufferSource contract,
 * the cast only bridges lib.dom's stricter ArrayBuffer-backed view type.
 */
function asBodyBytes(data: Buffer): Uint8Array<ArrayBuffer> {
    return data as Uint8Array<ArrayBuffer>;
}

function isIndexDocument(pathname: string): boolean {
    const normalized = pathname.replace(/^\/+/, "").toLowerCase();
    return normalized === "" || normalized === "index.html";
}

/** Serve the runtime document with the gated Content-Security-Policy injected. */
async function serveIndexDocument(filePath: string, allowHttp: boolean): Promise<Response> {
    const html = await fs.readFile(filePath, "utf-8");
    return new Response(injectRuntimeCsp(html, allowHttp), {
        status: 200,
        headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
        },
    });
}

function registerRuntimeIpc(): void {
    // Module-level refs so the before-quit handler can flush pending writes.
    const saves = new RuntimeSaveStore(userDataDir);
    const persistence = new RuntimePersistenceStore(userDataDir);
    saveStore = saves;
    persistenceStore = persistence;

    ipcMain.handle("runtime:read-pack", () => readPack());
    ipcMain.handle("runtime:close", () => {
        // The Quit Application node's graceful terminate. Mark the quit before it reaches the
        // window so the close guard stands aside and the blueprint close event does not fire again.
        isQuitting = true;
        app.quit();
    });
    ipcMain.on(GAME_RUNTIME_CLOSE_DECISION_CHANNEL, (_event, payload: { requestId?: number; allow?: boolean }) => {
        const requestId = payload?.requestId;
        if (typeof requestId !== "number") {
            return;
        }
        pendingCloseDecisions.get(requestId)?.(payload?.allow !== false);
    });
    ipcMain.handle("runtime:fullscreen:get", () => mainWindow?.isFullScreen() === true);
    ipcMain.handle("runtime:fullscreen:set", (_event, fullscreen: boolean) => {
        mainWindow?.setFullScreen(fullscreen === true);
    });
    ipcMain.on("runtime:log", (_event, data: { level?: string; message?: string }) => {
        const level = data?.level === "error" ? "error" : data?.level === "warning" ? "warning" : "info";
        logRuntime(level, String(data?.message ?? ""));
    });
    // The renderer's uncaught errors and the engine reaching an ending. Validated rather than
    // trusted (toGameTestEvent stamps the scope and refuses anything else), and dropped on the
    // floor when nothing is subscribed - which is every run that is not a test.
    ipcMain.on(GAME_RUNTIME_TEST_SIGNAL_CHANNEL, (_event, signal: unknown) => {
        const event = toGameTestEvent(signal);
        if (event) {
            emitTestEvent(event);
        }
    });

    ipcMain.handle("runtime:save:write", (_event, data: { id: string; savedGame: unknown; capture?: string; metadata?: unknown }) =>
        saves.write(data.id, data.savedGame, data.capture, data.metadata));
    ipcMain.handle("runtime:save:read", (_event, id: string) => saves.read(id));
    ipcMain.handle("runtime:save:listIds", () => saves.listIds());
    ipcMain.handle("runtime:save:readPreview", (_event, id: string) => saves.readPreview(id));
    ipcMain.handle("runtime:save:delete", (_event, id: string) => saves.delete(id));

    ipcMain.handle("runtime:persistence:getAll", () => persistence.getAll());
    ipcMain.handle("runtime:persistence:getValue", (_event, key: string) => persistence.getValue(key));
    ipcMain.handle("runtime:persistence:setValue", (_event, key: string, value: unknown) => persistence.setValue(key, value));
    ipcMain.handle("runtime:persistence:removeValue", (_event, key: string) => persistence.removeValue(key));

    // The Fetch node's request.
    //
    // Issued here rather than in the renderer for two reasons: the renderer's origin is `nlgame:`,
    // so a request to a third-party API would be refused by CORS; and the timeout, size cap and
    // scheme check are only enforceable somewhere the page cannot reach around.
    //
    // Which is also why `allowHttp` is re-read here from the pack. This process sits OUTSIDE the CSP
    // and `webRequest` cage that `installRuntimeNetworkPolicy` puts the renderer in, so that cage
    // cannot be what enforces the project's setting on this path - without the check below, routing
    // through main would hand a game that shipped with the network off a working network.
    ipcMain.handle("runtime:network:fetch", async (_event, request: BlueprintNetworkFetchRequest) => {
        const pack = await readPack();
        return executeBlueprintNetworkFetch(request, { allowHttp: pack.network?.allowHttp === true });
    });

    // The Open Link node's request.
    //
    // Decided here because this is where it is performed: the renderer names an address, and the
    // pack - re-read per request, like `allowHttp` above - says whether this build declares it.
    // Nothing about the renderer's message is trusted, because the renderer is where an author's
    // graph runs.
    //
    // Deliberately not gated on `network.allowHttp`: no request is made and no bytes come back, so
    // a game shipped with the network off still opens its own store page.
    ipcMain.handle("runtime:external:open", async (_event, request: BlueprintOpenExternalRequest) => {
        const pack = await readPack();
        const decision = resolveDeclaredExternalLink(request, pack.externalLinks);
        if (!decision.allowed) {
            logRuntime("warning", `Open Link refused: ${decision.result.error}`);
            return decision.result;
        }
        try {
            await shell.openExternal(decision.url);
            return { outcome: "opened", error: null } satisfies BlueprintOpenExternalResult;
        } catch (error) {
            return {
                outcome: "failed",
                error: error instanceof Error ? error.message : String(error),
            } satisfies BlueprintOpenExternalResult;
        }
    });

    // A plugin's request to open an address, decided against that plugin's own declaration.
    //
    // Here for the same reason the channel above is: this is the process that calls the platform
    // opener, so this is where the question has to be answered. The declaration is re-read from the
    // pack per request, and it is the manifest that shipped inside it - `pack.plugins[].manifest.
    // contributes.externalLinks` - rather than a second copy written somewhere for this check to
    // read. There is only one list, and it is the one the author approved at install.
    //
    // Same security posture as the sidecar channels below, stated once more because it is the thing
    // most likely to be misread: `pluginId` is what the renderer said it was and this process
    // cannot verify it, since runtime plugins share one realm and nothing in that realm can prove
    // which plugin a call came from. That is why the id is used to *select* a declaration and never
    // to grant one. The set of addresses reachable from this handler is exactly the union of what
    // the plugins in this pack declared, whatever id is passed - and every one of them is a
    // declaration the author read and approved.
    ipcMain.handle(
        "runtime:external:openForPlugin",
        async (_event, pluginId: string, request: BlueprintOpenExternalRequest) => {
            const pack = await readPack();
            const decision = resolvePluginExternalLinkAmong(pack.plugins, pluginId, request);
            if (!decision.allowed) {
                logRuntime("warning", `Plugin Open Link refused: ${decision.result.error}`);
                return decision.result;
            }
            try {
                await shell.openExternal(decision.url);
                return { outcome: "opened", error: null } satisfies BlueprintOpenExternalResult;
            } catch (error) {
                return {
                    outcome: "failed",
                    error: error instanceof Error ? error.message : String(error),
                } satisfies BlueprintOpenExternalResult;
            }
        },
    );

    // Sidecar control.
    //
    // SECURITY POSTURE, stated plainly: the `pluginId` on these calls is what the
    // caller said it was, and this process CANNOT check it. Runtime plugins are
    // same-origin ES modules sharing one renderer realm - they can read each
    // other's closures, so nothing in the renderer can prove which plugin a call
    // came from. Adding a check here would only look like a boundary.
    //
    // The boundary that does hold is upstream of the caller: `requireSidecarHost`
    // resolves against the sidecars THIS PACK DECLARED, so the worst a plugin can
    // do with another plugin's id is talk to a process the game already ships and
    // the player already approved at install. No id reaches spawn(), no path from
    // the renderer names an executable, and an undeclared id has nothing to hit.
    ipcMain.handle("runtime:sidecar:start", (_event, pluginId: string, sidecarId: string) =>
        requireSidecarHost().start(pluginId, sidecarId));
    ipcMain.handle("runtime:sidecar:stop", (_event, pluginId: string, sidecarId: string) =>
        requireSidecarHost().stop(pluginId, sidecarId));
    ipcMain.handle(
        "runtime:sidecar:request",
        (_event, pluginId: string, sidecarId: string, method: string, params?: unknown) =>
            requireSidecarHost().request(pluginId, sidecarId, method, params),
    );
    ipcMain.on(
        "runtime:sidecar:notify",
        (_event, pluginId: string, sidecarId: string, method: string, params?: unknown) => {
            requireSidecarHost().notify(pluginId, sidecarId, method, params);
        },
    );
}

function requireSidecarHost(): SidecarHost {
    if (!sidecarHost) {
        throw new Error("Sidecar host accessed before initialization");
    }
    return sidecarHost;
}

function startPreviewControlServer(pack: GameRuntimePackV1): void {
    const preview = pack.preview;
    if (!preview?.controlPort || !preview.controlToken) {
        return;
    }
    controlServer = new WebSocketServer({
        host: "127.0.0.1",
        port: preview.controlPort,
    });
    controlServer.on("connection", socket => {
        socket.on("message", raw => {
            const { reply, effect } = dispatchControlFrame(raw.toString(), preview.controlToken);
            // Always answer first: a shutdown that quit before replying would reach Studio as a
            // dropped connection, which is exactly the crash/clean-quit ambiguity this pipeline is
            // here to remove.
            socket.send(JSON.stringify(reply));
            if (effect === "shutdown") {
                setTimeout(() => app.quit(), 20);
                return;
            }
            if (effect === "subscribe") {
                testSubscribers.add(socket);
            }
        });
        const forget = () => {
            testSubscribers.delete(socket);
        };
        socket.on("close", forget);
        socket.on("error", forget);
    });
    controlServer.on("error", error => {
        console.error("[GameRuntime] Preview control server error", error);
    });
}
