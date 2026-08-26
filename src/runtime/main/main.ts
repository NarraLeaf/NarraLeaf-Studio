import fsSync from "fs";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Readable } from "stream";
import { nativeImage } from "electron";
import { shell } from "electron";
import { app, BrowserWindow, dialog, ipcMain, Menu, powerSaveBlocker, protocol, screen, session } from "electron/main";
import { WebSocketServer, type WebSocket } from "ws";
import type { GameTestCommand, GameTestEvent } from "@shared/types/gameTest";
import type { SaveCompatibilityStamp } from "@shared/types/saveCompatibility";
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
import {
    normalizeWindowConfiguration,
    WINDOW_SCALE_DESIGN,
    type WindowConfiguration,
    type WindowScaleStep,
} from "@shared/types/appWindow";
import { getMimeType } from "@shared/utils/fs";
import {
    DEFAULT_SAVE_LOCATION_CONFIGURATION,
    normalizeSaveLocationConfiguration,
    type SaveLocationConfiguration,
} from "@shared/utils/userDataLocation";
import { buildGameRuntimeAssetVersionArg } from "@shared/utils/gameRuntimeAssetUrl";
import { buildGameRuntimeIndexUrl } from "@shared/utils/gameRuntimeIndexUrl";
import {
    resolveGameRuntimeEntrySurface,
    resolveGameRuntimeInitialBackgroundColor,
} from "@shared/utils/gameRuntimeEntrySurface";
import { resolveSingleByteRange } from "@shared/utils/httpRange";
import type { BlueprintNetworkFetchRequest } from "@shared/types/blueprint/network";
import {
    resolveCoreExternalLink,
    resolvePluginExternalLinkAmong,
    type BlueprintOpenExternalRequest,
    type BlueprintOpenExternalResult,
} from "@shared/types/blueprint/externalLink";
import { executeBlueprintNetworkFetch } from "@shared/utils/blueprintNetworkFetch";
import type { BlueprintPointerMoveRequest } from "@shared/types/blueprint/pointer";
import { executeBlueprintPointerMove } from "@shared/utils/blueprintPointerMove";
import { packNetworkAllowlist, type NetworkAllowlist } from "@shared/types/networkAllowlist";
import { sniffMediaType } from "./mediaSniff";
import { createRuntimeResources, isSealedBuildSync, type RuntimeResources } from "./runtimeResources";
import {
    PLUGIN_REACT_MODULE_SOURCES,
    PLUGIN_RUNTIME_API_MODULE_SOURCE,
} from "@shared/utils/pluginRuntimeApiModule";
import { resolveModelBundleKey, resolveRuntimeStaticPath } from "./runtimeProtocol";
import { injectRuntimeCsp, installRuntimeNetworkPolicy } from "./networkPolicy";
import { dispatchControlFrame, encodeTestEventFrame } from "./testControlProtocol";
import {
    GAME_RUNTIME_TEST_COMMAND_CHANNEL,
    GAME_RUNTIME_TEST_COMMAND_READY_CHANNEL,
    GAME_RUNTIME_TEST_SIGNAL_CHANNEL,
    toGameTestEvent,
} from "../gameTestSignal";
import {
    RuntimePersistenceStore,
    RuntimeSaveStore,
    sweepAbandonedTempFiles,
} from "./runtimeStorage";
import { collectPackSidecars, SidecarHost } from "./sidecarHost";
import { resolveGameRootDir, resolvePlayerFilesDir, resolveRuntimeUserDataDir } from "./userDataDir";
import {
    readGameProgressFile,
    writeGameProgressFile,
    type GameProgressEnvironment,
} from "@shared/utils/gameProgressFile";
import type { GameProgressExportRequest } from "@shared/types/gameProgress";
import { installRuntimeLogSink, runtimeLogPath } from "./runtimeLog";
import { installDisplaySleepInhibitor, type DisplaySleepInhibitor } from "./displaySleep";
import { resolveShellText, type ShellText } from "./shellText";
import { claimSingleInstance } from "./singleInstance";
import {
    currentWindowScale,
    fitInside,
    fittingWindowScales,
    NO_WINDOW_CHROME,
    readWindowGeometry,
    resolveWindowGeometry,
    roomForStage,
    scaledDesign,
    writeWindowGeometry,
    type WindowChrome,
} from "./windowGeometry";
import { installWindowCrashHandling } from "./windowCrashHandling";
import {
    hasDebuggingSwitch,
    hasStartupSwitch,
    honoursDebuggableMarker,
    reviewStartupArguments,
    RUNTIME_LOGS_SWITCH,
} from "@shared/utils/runtimeStartupArguments";
import { silenceRuntimeConsole } from "./runtimeConsole";

const appDir = __dirname;

/**
 * Early facts from the loose app manifest, readable synchronously before
 * app-ready so path setup and the debugger guard run before Chromium does any
 * work. The pack's own `mode` (which may live in the consolidated store) stays
 * authoritative for everything decided after the pack is open; a stripped or
 * tampered manifest only ever downgrades to the stricter checks below.
 */
function readShellManifest(): {
    mode: "preview" | "production";
    userDataDirName: string | null;
    saveLocation: SaveLocationConfiguration;
    debuggable: boolean;
} {
    try {
        const manifest = JSON.parse(fsSync.readFileSync(path.join(appDir, "package.json"), "utf-8")) as {
            narraleaf?: { mode?: unknown; userDataDir?: unknown; saveLocation?: unknown; debuggable?: unknown };
        };
        const userDataDir = manifest.narraleaf?.userDataDir;
        return {
            mode: manifest.narraleaf?.mode === "production" ? "production" : "preview",
            userDataDirName: typeof userDataDir === "string" && userDataDir.trim() ? userDataDir.trim() : null,
            saveLocation: normalizeSaveLocationConfiguration(manifest.narraleaf?.saveLocation),
            debuggable: manifest.narraleaf?.debuggable === true,
        };
    } catch {
        return {
            mode: "preview",
            userDataDirName: null,
            saveLocation: { ...DEFAULT_SAVE_LOCATION_CONFIGURATION },
            debuggable: false,
        };
    }
}

const shellManifest = readShellManifest();
const shellMode = shellManifest.mode;

/**
 * Whether this build's content is sealed.
 *
 * Read from disk rather than from the pack, because the marker below has to be answered before
 * anything can open one. It is the same file `createRuntimeResources` decides on a moment later, so
 * the two cannot disagree about what kind of build this is.
 */
const shellSealed = isSealedBuildSync(appDir);

/**
 * This build was made to be inspected, so the guards below stand aside for the launch switches
 * they otherwise refuse.
 *
 * Only Studio's experimental `debuggable-build` condition writes it, and it changes nothing on its
 * own: the switch still has to be on the command line for anything to be listening. The pack
 * carries the same marker and stays authoritative - a manifest that claims this while the pack does
 * not is refused by the second gate, which is the one that runs from inside the archive.
 *
 * A sealed build refuses it whichever marker carries it, because this gate - the one that decides
 * in time to matter - can only read the manifest, and a protected build cannot have a text edit
 * standing between a stranger and its decrypted content. See {@link honoursDebuggableMarker}.
 */
const shellDebuggable = honoursDebuggableMarker(shellManifest.debuggable, shellSealed);

/*
 * Before anything has had a chance to print. A shipped game keeps its own output to its log file
 * unless this run asked for it, so that starting the executable from a terminal does not answer
 * what the game is built with.
 *
 * Preview and test keep their console unconditionally: Studio reads the child's stdout to fill the
 * console panel an author watches, and a build made to be inspected is not one to go quiet on.
 */
if (shellMode === "production" && !shellDebuggable
    && !hasStartupSwitch(startupArguments(), process.platform, RUNTIME_LOGS_SWITCH)) {
    silenceRuntimeConsole();
    // Chromium's own logging is written from C++, where no JavaScript reaches it, so the only
    // thing that turns it off is a switch this process appends to its own command line. Without it
    // a child process dying still prints a Chromium source path to stderr, which answers the same
    // question the game's own lines used to.
    //
    // Both, because `disable-logging` alone does not stop it: measured on Electron 38, a browser
    // process killed while its network service was running still printed one ERROR line with the
    // switch set, and none once the severity floor was raised to FATAL.
    app.commandLine.appendSwitch("disable-logging");
    app.commandLine.appendSwitch("log-level", "3");
}

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
 * The folder holding the player's copy of this game: where a patch is looked for, and - when the
 * author said so - where the player's files are kept.
 *
 * One answer for both, because they are the same question to the person asking it. A player who
 * moves an installed game to another drive expects their progress to travel with the folder, and
 * looks in that folder first for anywhere to put a patch.
 */
const gameRootDir = resolveGameRootDir({
    platform: process.platform,
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appDir,
    ...(process.env.APPIMAGE ? { appImagePath: process.env.APPIMAGE } : {}),
});

/**
 * Where the save and persistence stores write.
 *
 * Only these two follow the author's setting: everything else under {@link userDataDir} belongs to
 * the shell rather than to the player. A preview never follows it at all - it has no installation
 * to sit beside, and its saves are the author's own working copies.
 */
const playerFilesDir = shellMode === "production" && !useSiblingUserData
    ? resolvePlayerFilesDir({
        platform: process.platform,
        config: shellManifest.saveLocation,
        gameRootDir,
        userDataDir,
    })
    : userDataDir;

/**
 * Where the progress document lives, which is deliberately not under {@link userDataDir}.
 *
 * That directory is named after this build's app id, and two editions of one title have different
 * app ids on purpose - that is precisely why they cannot read each other's saves. The progress
 * document sits beside both, in the per-user root the platform names. Resolved fresh per request
 * because `XDG_DATA_HOME` is environmental and nothing here caches environmental facts.
 */
function progressEnvironment(): GameProgressEnvironment {
    return {
        platform: process.platform,
        appDataDir: app.getPath("appData"),
        homeDir: os.homedir(),
        ...(process.env.XDG_DATA_HOME ? { xdgDataHome: process.env.XDG_DATA_HOME } : {}),
    };
}

/**
 * Everything this process and the game have to say, on disk.
 *
 * Installed here rather than at app-ready because the failures worth having a log for include the
 * ones during startup, and because it is the first moment the profile directory is known.
 */
const logRuntime = installRuntimeLogSink(userDataDir);

let packPromise: Promise<GameRuntimePackV1> | null = null;
/** The game's own name, once the pack has been read. Titles the crash dialogs. */
let loadedPackName: string | null = null;
/** What this build does when it stops working, from the pack. */
let crashPolicy: GameCrashPolicy = DEFAULT_GAME_CRASH_POLICY;
let mainWindow: BrowserWindow | null = null;
/** The window's display block, driven by the renderer over `runtime:displayAwake:set`. */
let displaySleep: DisplaySleepInhibitor | null = null;
/** What the project says its window may do; settled from the pack as the window is built. */
let windowConfig: WindowConfiguration = normalizeWindowConfiguration(undefined);
/** The stage's own size, which every offered scale step is a multiple of. */
let windowDesign = { width: 1280, height: 720 };
/**
 * The window's content bounds while it is neither maximised nor full-screen.
 *
 * Kept because that is the size worth restoring: `getContentBounds` on a maximised window answers
 * with the screen, and a player who closed the game maximised should get a maximised window back -
 * not a window whose restored size is also the screen.
 */
let normalWindowBounds: { width: number; height: number; x: number | null; y: number | null } | null = null;
/** What this platform's window frame adds to the stage, measured from the window itself. */
let windowChrome: WindowChrome = NO_WINDOW_CHROME;
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

/**
 * What this launch was given that a shipped game does not accept.
 *
 * The whole command line rather than a list of switches known to be dangerous: Electron takes every
 * switch Chromium was compiled with, and naming the bad ones means the list is only ever as current
 * as the last person who read Chromium's release notes. A game states what it accepts instead, and
 * everything outside that stops the launch - see `@shared/utils/runtimeStartupArguments`.
 */
function refusedStartupArguments(): string[] {
    return reviewStartupArguments(startupArguments(), process.platform).refused;
}

/**
 * The command line as far as it came from whoever started the game.
 *
 * `electron <app dir>` puts the directory in `argv[1]`, and a build run that way is how a developer
 * opens a compiled app directory without packaging it. A shipped game has no such argument - what
 * follows the executable there is the player's - so the one Electron itself added is dropped only
 * in the mode Electron adds it in, and a packaged build stays strict about every positional.
 */
function startupArguments(): string[] {
    return [...process.argv.slice(process.defaultApp ? 2 : 1), ...process.execArgv];
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

/**
 * Earliest possible refusal of a command line a shipped game does not accept: before app-ready,
 * before any window or session exists. The post-pack-read check below stays as the authoritative
 * (tamper-resistant on asar-integrity platforms) second gate.
 *
 * Both halves matter and they are not the same half. Quitting states the policy; taking the
 * switches off the command line is what stops them being acted on, because Chromium reads several
 * of them after this script has run. Measured on Electron 38: a launch with
 * `--remote-debugging-port` that only quit here still had the port accepting connections about
 * 130ms later, and the same launch with the switch removed here never listened at all.
 */
function refuseStartupArguments(): boolean {
    const refused = refusedStartupArguments();
    if (refused.length === 0) {
        return false;
    }
    for (const name of reviewStartupArguments(startupArguments(), process.platform).removable) {
        app.commandLine.removeSwitch(name);
    }
    // Written to the log and nowhere else. The player who typed a switch into a launcher gets the
    // file to send to support; anyone probing the game for what it refuses gets a process that
    // exits and says nothing.
    logRuntime("error", `refusing to start: this build does not accept ${refused.join(", ")}`);
    app.quit();
    return true;
}

const startupBlocked = shellMode === "production" && !shellDebuggable && refuseStartupArguments();

/**
 * A shipped game runs once at a time; see `singleInstance` for what a second copy costs the player.
 *
 * Only a shipped one. Studio's preview and its test runner start several copies of the same build
 * on purpose - two authors' windows, a test suite and the game it is testing - and they do not
 * share a player directory to damage either: a preview writes beside the compiled app rather than
 * into the installed game's (see `useSiblingUserData`).
 *
 * After the command-line gate above, so a launch this build refuses is refused for that reason
 * rather than reported as a second copy.
 */
const secondCopy = shellMode === "production" && !startupBlocked && !claimSingleInstance({
    requestLock: () => app.requestSingleInstanceLock(),
    quit: () => {
        app.quit();
    },
    onSecondInstance: listener => {
        app.on("second-instance", () => {
            listener();
        });
    },
    window: () => mainWindow,
    log: logRuntime,
});

void app.whenReady().then(async () => {
    if (startupBlocked || secondCopy) {
        return;
    }
    resources = await createRuntimeResources(appDir, {
        // Where a player puts a patch: the folder their copy of the game sits in,
        // which is the first place anyone looks for one. The same folder the
        // player's files may sit in, resolved by the same function, so a player
        // told where their saves are has been told where a patch goes.
        gameRootDir,
        // Searched as well, so a patch can outlive reinstalling the game.
        userDataDir,
        // What applied, and what did not, is the only trace a patch leaves.
        log: logRuntime,
        // A build made to be inspected says why a patch was refused; a shipped one names the file
        // and stops, because the reason describes how a patch is bound to its build.
        explainRefusedPatches: shellMode !== "production" || shellDebuggable,
    });
    const pack = await readPack();
    if (pack.mode === "production" && !packDebuggable(pack) && refusedStartupArguments().length > 0) {
        // The pack is what a shipped game is, and it is inside the archive - so this is the gate a
        // rewritten shell manifest does not get past on the platforms that validate one.
        app.quit();
        return;
    }
    if (packDebuggable(pack)) {
        console.log("[GameRuntime] This build accepts any command line (built under an experimental condition).");
    }
    const allowHttp = pack.network?.allowHttp === true;
    const networkAllowlist = packNetworkAllowlist(pack);
    applyRuntimeAppIdentity(pack);
    applyRuntimeMenu();
    registerRuntimeProtocol(allowHttp, networkAllowlist);
    sidecarHost = createSidecarHost(pack);
    registerRuntimeIpc();
    startPreviewControlServer(pack);
    // Confine the renderer to the app protocol before it loads any document
    // unless the project opted into HTTP - and unconditionally when a test asked
    // for a network-less run, which overrides the project's own flag.
    installRuntimeNetworkPolicy(session.defaultSession, {
        allowHttp,
        allowlist: networkAllowlist,
        blockAll: testNetworkBlocked,
    });
    mainWindow = createWindow(pack);
    // After the window exists so a sidecar's first event has somewhere to land,
    // and unawaited so a slow handshake never delays the game's first paint.
    sidecarHost.startAutostart();
    // A preview stopped while it was still booting quits mid-load, and the pending navigation then
    // rejects with ERR_FAILED. That is the shutdown working, not a failure to report - and the
    // author, who pressed Stop, would otherwise read an unhandled rejection on the Studio console.
    // Keyed on the quit rather than on the window being destroyed: `app.quit()` aborts the load
    // first and tears the window down after, so `isDestroyed()` is still false when this rejects.
    await mainWindow.loadURL(buildGameRuntimeIndexUrl({
        policy: normalizeGameCrashPolicy(pack.crash?.policy),
        logPath: runtimeLogPath(userDataDir),
    })).catch(error => {
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
        const text = shellText();
        dialog.showErrorBox(
            gameDisplayName(),
            `${headline}\n\n${text.fatalClose} ${text.logAt(runtimeLogPath(userDataDir))}`,
        );
    } catch {
        /* No window server, or a dialog that refused. The log line above is the report. */
    }
}

/**
 * What this process says to the player, in the language this machine asked for.
 *
 * `getLocale()` leads, and that ordering is the whole point: it is the same tag the page's
 * `navigator.languages` leads with, so the native dialogs and the game's own crash screen cannot
 * end up in different languages. It also moves with `--lang`, which is on the startup allowlist
 * and which the system list does not follow - a player who launches the game in Japanese on a
 * Chinese machine gets a Japanese page, and would otherwise get a Chinese dialog over it.
 *
 * The system list follows as the preference order proper. Before the app is ready `getLocale()`
 * answers an empty string rather than throwing, and an empty tag is dropped, so the list degrades
 * to the system one on its own - which matters because the earliest caller here is the
 * uncaught-exception monitor, and that can fire before ready.
 *
 * Resolved once. Nothing about a running game can change the answer, and a crash is a bad moment
 * to start asking questions.
 */
let cachedShellText: ShellText | null = null;

function shellText(): ShellText {
    if (!cachedShellText) {
        cachedShellText = resolveShellText([app.getLocale(), ...app.getPreferredSystemLanguages()]);
    }
    return cachedShellText;
}

/** The game's own name once the pack has been read, and something honest before that. */
function gameDisplayName(): string {
    return loadedPackName ?? app.getName();
}

/**
 * Whether the window has a listener for the command channel yet.
 *
 * Set by the renderer the moment it subscribes. Until then `webContents.send` reaches nobody and
 * Electron drops the message - there is no queue behind an `ipcRenderer.on` that does not exist.
 */
let testCommandListenerReady = false;

/**
 * The `start` that arrived before there was a listener, kept for when there is one.
 *
 * Only ever a `start`, and only ever the latest. Every other command is a move in a story that is
 * already playing, and replaying a stale one later would click something nobody asked for at that
 * moment; a driver that wanted to advance is still sending advances anyway. A start is the one
 * command with nothing to re-send it - the run is waiting on the story it asks for.
 */
let pendingTestStart: GameTestCommand | null = null;

/**
 * Hand a command Studio sent to the window that can carry it out.
 *
 * Best-effort by design, like {@link emitTestEvent}: the socket has already been answered, and what
 * the frame meant was "understood", never "done". A command that arrives after the window has gone
 * is dropped, and the caller learns nothing happened from the observations that do not follow it.
 *
 * The one that arrives too EARLY is different, and it is why the hold above exists. The control
 * socket opens once the pack is read, which is before the window has finished loading, so the first
 * thing a test says is usually said to nobody - and it is always the `start`.
 */
function deliverTestCommand(command: GameTestCommand): void {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }
    if (!testCommandListenerReady) {
        if (command.kind === "start") {
            pendingTestStart = command;
        }
        return;
    }
    mainWindow.webContents.send(GAME_RUNTIME_TEST_COMMAND_CHANNEL, command);
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

/**
 * The pack's own `debuggable` marker, as far as it is allowed to mean anything.
 *
 * Sealed builds are excluded here as well as at the pre-ready gate. This one cannot be tampered
 * with - it comes out of the protected store - so the exclusion is not defending against an edit;
 * it keeps the two gates saying the same thing, so that an artifact built before a sealed build
 * stopped carrying the marker does not open DevTools after the earlier gate has already refused
 * the switch that would have been inspected through them.
 */
function packDebuggable(pack: GameRuntimePackV1): boolean {
    return honoursDebuggableMarker(pack.debuggable === true, shellSealed);
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
    const design = resolveInitialWindowSize(pack);
    windowConfig = normalizeWindowConfiguration(pack.bundle?.window);
    // Measured rather than assumed: a 1080-tall window plus its title bar does not fit a 1080p
    // desktop once the taskbar has its strip, and the display the player left the game on may not
    // be the primary one. `getDisplayMatching` answers both - it falls back to the nearest display
    // for a rectangle that lands on none, which is the case a remembered position has to survive.
    const remembered = readWindowGeometry(userDataDir);
    const displays = screen.getAllDisplays().map(display => display.workArea);
    const workArea = remembered && remembered.x !== null && remembered.y !== null
        ? screen.getDisplayMatching({
            x: remembered.x,
            y: remembered.y,
            width: remembered.width,
            height: remembered.height,
        }).workArea
        : screen.getPrimaryDisplay().workArea;
    const geometry = resolveWindowGeometry({
        design,
        config: windowConfig,
        remembered,
        workArea,
        displays,
    });
    const icon = createProjectIcon(pack);
    // Production disables DevTools outright: with devTools:false Electron ignores
    // any openDevTools call and the menu/keyboard toggles become no-ops, so there
    // is no in-app path to the inspector (the startup switch guard covers CDP).
    //
    // A debuggable build is the one exception, and only for a launch that actually asked: with no
    // switch on the command line it starts exactly as a production build does, which is what keeps
    // it usable for testing what players get.
    const devToolsEnabled = pack.mode !== "production"
        || (packDebuggable(pack) && hasDebuggingSwitch(startupArguments(), process.platform));
    const win = new BrowserWindow({
        title: pack.project.name,
        // The design size is the STAGE, not the window: Electron's width/height are the outer size,
        // so without this a 1920x1080 project was drawn into a client area a title bar shorter than
        // it asked for and scaled to about 0.97 on the display it was made for.
        useContentSize: true,
        width: geometry.width,
        height: geometry.height,
        ...(geometry.x !== undefined && geometry.y !== undefined
            ? { x: geometry.x, y: geometry.y }
            : { center: true }),
        fullscreen: geometry.fullscreen,
        // The steps a configuration screen offers are one thing and the window frame is another;
        // an author who wants only the offered sizes turns dragging off.
        resizable: windowConfig.resizable,
        minWidth: 480,
        minHeight: 320,
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
            // The crash policy and the log path used to travel here too, and no longer do: the
            // preload republishes them, so they went down with it in the one failure - a preload
            // that never ran - where the crash screen has to be right on its own. They are on the
            // page's own address now (see `buildGameRuntimeIndexUrl`).
            additionalArguments: [
                buildGameRuntimeAssetVersionArg(resolveAssetVersion(pack)),
            ],
        },
    });
    win.setTitle(pack.project.name);
    windowDesign = design;
    /*
     * The frame, and then the geometry again.
     *
     * Only a window can say what its own frame costs - it depends on the platform, the theme and
     * the display's scaling - and the size that has to fit the screen is the window rather than the
     * stage inside it. MEASURED on Windows 11 at 125%: 15x64, which is why a 1080-tall stage does
     * not fit a desktop with 1104 rows under its taskbar. Asking once with zero and again with the
     * real number costs nothing visible, because the window is still hidden until first paint.
     */
    const outerBounds = win.getBounds();
    const [openedWidth, openedHeight] = win.getContentSize();
    windowChrome = {
        width: Math.max(0, outerBounds.width - openedWidth),
        height: Math.max(0, outerBounds.height - openedHeight),
    };
    const fitted = resolveWindowGeometry({
        design,
        config: windowConfig,
        remembered,
        workArea,
        displays,
        chrome: windowChrome,
    });
    if (fitted.width !== openedWidth || fitted.height !== openedHeight) {
        win.setContentSize(fitted.width, fitted.height);
        if (fitted.x === undefined || fitted.y === undefined) {
            win.center();
        }
    }
    normalWindowBounds = {
        width: fitted.width,
        height: fitted.height,
        x: fitted.x ?? null,
        y: fitted.y ?? null,
    };
    /*
     * No `setAspectRatio`. It looks like the right answer - a window held at the design ratio can
     * never letterbox its own art - and on Windows it is not: MEASURED on Electron 38, the ratio is
     * maintained for the WHOLE window including the frame, with or without the frame passed as the
     * extra size, so asking for 16:9 gave a 16:9 window with a 1.90 stage inside it. The stage is
     * fitted by the renderer either way; a window dragged off the ratio letterboxes, which is what
     * every build has always done and is at least the shape the author drew.
     */
    if (fitted.maximized) {
        win.maximize();
    }
    // Only while the window is in its ordinary state - see `normalWindowBounds`.
    const rememberNormalBounds = (): void => {
        if (win.isDestroyed() || win.isMaximized() || win.isMinimized() || win.isFullScreen()) {
            return;
        }
        // Size from the content, position from the window. Mixing them is a real drift: the
        // content origin sits a title bar below the window's, so a window reopened at its content
        // position walks down the screen by the height of its own frame on every launch. MEASURED
        // at 56 rows per relaunch before this was split.
        const content = win.getContentSize();
        const bounds = win.getBounds();
        normalWindowBounds = {
            width: content[0],
            height: content[1],
            x: bounds.x,
            y: bounds.y,
        };
    };
    win.on("resize", rememberNormalBounds);
    win.on("move", rememberNormalBounds);
    // On the way out rather than after: `closed` fires on a window there is nothing left to read.
    // A close the game cancels writes too, which costs one file write and keeps the answer correct
    // for the quit that does not go through a close at all.
    win.on("close", () => {
        if (!windowConfig.rememberGeometry || win.isDestroyed()) {
            return;
        }
        writeWindowGeometry(userDataDir, {
            width: normalWindowBounds?.width ?? geometry.width,
            height: normalWindowBounds?.height ?? geometry.height,
            x: normalWindowBounds?.x ?? null,
            y: normalWindowBounds?.y ?? null,
            maximized: win.isMaximized(),
            fullscreen: win.isFullScreen(),
        }, message => logRuntime("warning", `[Window] ${message}`));
    });
    // Chromium raises the loaded document's <title> to the window, and the shell's index.html
    // carries a generic one, so the name set above lasted until the first paint and every game
    // was called NarraLeaf Game in the taskbar. The window is the project's, and a variant's is
    // the variant's, so the document's answer is refused rather than followed. The web shell
    // interpolates the same name into its document and needs nothing here.
    win.on("page-title-updated", (event) => {
        event.preventDefault();
    });
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
        text: shellText(),
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
    // Auto mode plays for an hour without a single input, which the system reads as an idle
    // machine; the renderer says when the story is moving on its own and this holds the display
    // for as long as it is, and the window is on screen.
    displaySleep = installDisplaySleepInhibitor(win, {
        hold: () => powerSaveBlocker.start("prevent-display-sleep"),
        release: id => {
            powerSaveBlocker.stop(id);
        },
        log: logRuntime,
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

/**
 * Put the stage at a multiple of the size the game was drawn at.
 *
 * Any multiple, not only the ones the project offers: see the IPC handler for why the offered list
 * is a list rather than a limit.
 */
function applyWindowScale(scale: number): void {
    if (!Number.isFinite(scale) || scale <= 0) {
        return;
    }
    const size = scaledDesign(windowDesign, scale);
    applyWindowContentSize(size.width, size.height);
}

/**
 * Put the stage at a size in pixels.
 *
 * The one place a window is resized while the game runs, so the two ways of asking - a multiple of
 * the design size, or the pixels themselves - cannot drift apart.
 *
 * Full screen and maximised are left first: both are answers to "how big", and a window sized
 * underneath either would come back to the old size the moment the player left it.
 *
 * The window keeps its place unless the new size would hang off the screen, in which case it is
 * centred - a player who put the window where they wanted it has said something worth keeping, and
 * a window half off the desktop has not.
 */
function applyWindowContentSize(width: number, height: number): void {
    const win = mainWindow;
    if (!win || win.isDestroyed()) {
        return;
    }
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return;
    }
    if (win.isFullScreen()) {
        win.setFullScreen(false);
    }
    if (win.isMaximized()) {
        win.unmaximize();
    }
    const workArea = screen.getDisplayMatching(win.getBounds()).workArea;
    const size = fitInside({ width, height }, roomForStage(workArea, windowChrome));
    win.setContentSize(size.width, size.height);
    const bounds = win.getBounds();
    const fits = bounds.x >= workArea.x
        && bounds.y >= workArea.y
        && bounds.x + bounds.width <= workArea.x + workArea.width
        && bounds.y + bounds.height <= workArea.y + workArea.height;
    if (!fits) {
        win.center();
    }
}

/** Which step the window is at now, for a configuration screen reading its own state. */
function readWindowScale(): WindowScaleStep {
    const win = mainWindow;
    if (!win || win.isDestroyed()) {
        return WINDOW_SCALE_DESIGN;
    }
    const [width, height] = win.getContentSize();
    return currentWindowScale(windowDesign, { width, height });
}

/**
 * The sizes worth offering this player, measured against the display their window is on.
 *
 * Asked of the shell rather than declared by the project: 200% is the right offer on a 4K monitor
 * and nonsense on a laptop, and only the running game can see which one it is looking at.
 */
function readWindowScaleOptions(): number[] {
    const win = mainWindow;
    const workArea = win && !win.isDestroyed()
        ? screen.getDisplayMatching(win.getBounds()).workArea
        : screen.getPrimaryDisplay().workArea;
    return fittingWindowScales(windowDesign, roomForStage(workArea, windowChrome));
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

function registerRuntimeProtocol(allowHttp: boolean, allowlist: NetworkAllowlist): void {
    protocol.handle(GAME_RUNTIME_PROTOCOL, async request => {
        const url = new URL(request.url);
        try {
            if (url.hostname === "runtime") {
                const pathname = decodeURIComponent(url.pathname);
                if (isIndexDocument(pathname)) {
                    return serveIndexDocument(resolveRuntimeStaticPath(appDir, pathname), allowHttp, allowlist);
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
            // The page gets nothing but the status. A read that fails inside the payload fails with
            // the payload's own wording, and answering a fetch with it would let any script in the
            // renderer ask the game how it stores what it stores. The log keeps the detail.
            logRuntime("warning", `request failed: ${error instanceof Error ? error.message : String(error)}`);
            return new Response("Not found", { status: 404 });
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

const modelBundleKey = (pack: GameRuntimePackV1, assetId: string) => resolveModelBundleKey(
    pack,
    assetId,
    id => runtimeResources().readModelBundleEntry(pack, id),
);

async function serveAsset(request: Request, assetId: string): Promise<Response> {
    const pack = await readPack();
    // A mount request cannot be served as itself - there is no item at `{id}/` holding bytes - so it
    // is resolved before the ordinary path rather than after it fails.
    if (assetId.endsWith("/")) {
        const key = await modelBundleKey(pack, assetId);
        return key ? serveAssetBytes(request, pack, key) : new Response("Not found", { status: 404 });
    }
    try {
        return await serveAssetBytes(request, pack, assetId);
    } catch (error) {
        const key = await modelBundleKey(pack, assetId);
        if (!key || key === assetId) {
            throw error;
        }
        return serveAssetBytes(request, pack, key);
    }
}

async function serveAssetBytes(request: Request, pack: GameRuntimePackV1, assetId: string): Promise<Response> {
    const declaredType = pack.assets.items[assetId]?.mimeType;
    const rangeHeader = request.headers.get("range");
    const filePath = runtimeResources().getAssetFilePath(pack, assetId);
    if (filePath) {
        // A loose pack keeps its manifest and its file extensions, so nothing here has to guess.
        const contentType = declaredType ?? getMimeType(filePath);
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
    /*
     * Sniffed first, and from the bytes we already hold, because a shipped protected pack has no
     * manifest to declare anything: entries are stored under the asset id alone, with no extension
     * and no recorded media type. The manifest is consulted only as a fallback, which is also what
     * keeps preview honest - a preview pack still carries one, and letting it win would mean the
     * sniffer never ran until a player's copy did.
     */
    const contentType = sniffMediaType(data) ?? declaredType ?? getMimeType(assetId);
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
async function serveIndexDocument(
    filePath: string,
    allowHttp: boolean,
    allowlist: NetworkAllowlist,
): Promise<Response> {
    const html = await fs.readFile(filePath, "utf-8");
    return new Response(injectRuntimeCsp(html, allowHttp, allowlist), {
        status: 200,
        headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
        },
    });
}

function registerRuntimeIpc(): void {
    // Module-level refs so the before-quit handler can flush pending writes.
    const saves = new RuntimeSaveStore(playerFilesDir);
    const persistence = new RuntimePersistenceStore(playerFilesDir);
    saveStore = saves;
    persistenceStore = persistence;
    // Housekeeping, once, on the way up: a store write that was interrupted between its temp file
    // and the rename leaves the temp behind for good. Not awaited and never fatal - nothing here
    // is worth delaying a boot for, let alone failing one.
    void Promise.all([
        sweepAbandonedTempFiles(playerFilesDir),
        sweepAbandonedTempFiles(path.join(playerFilesDir, "saves")),
    ]).catch(() => undefined);

    ipcMain.handle("runtime:read-pack", () => readPack());
    ipcMain.handle("runtime:close", () => {
        // The Quit Application node's graceful terminate. Mark the quit before it reaches the
        // window so the close guard stands aside and the blueprint close event does not fire again.
        isQuitting = true;
        app.quit();
    });
    ipcMain.handle("runtime:restart", () => {
        // Quit and come back, for a game that cannot be corrected in place - a language changed
        // mid-playthrough (see the renderer's `localeRestart`). The run has already been written
        // into a save and the resume marked in persistence by the time this arrives; both are
        // drained by the `before-quit` flush below, which is why this path must go through `quit`
        // and not `exit`.
        //
        // `relaunch` only schedules the new instance - it does not end this one - so the quit that
        // follows is what actually performs the restart. Same arguments and working directory as
        // this run, which is what carries the asset version, the crash policy and the log path
        // into the instance that replaces it.
        isQuitting = true;
        app.relaunch();
        app.quit();
    });
    ipcMain.on(GAME_RUNTIME_CLOSE_DECISION_CHANNEL, (_event, payload: { requestId?: number; allow?: boolean }) => {
        const requestId = payload?.requestId;
        if (typeof requestId !== "number") {
            return;
        }
        pendingCloseDecisions.get(requestId)?.(payload?.allow !== false);
    });
    // Fire-and-forget: nothing in the game waits on the display, and a request arriving after the
    // window has gone is about a window with no display left to hold.
    ipcMain.on("runtime:displayAwake:set", (_event, awake: boolean) => {
        displaySleep?.setRequested(awake === true);
    });
    ipcMain.handle("runtime:window:getScaleOptions", () => readWindowScaleOptions());
    ipcMain.handle("runtime:window:getScale", () => readWindowScale());
    ipcMain.handle("runtime:window:setScale", (_event, scale: number) => {
        // Any multiple the graph asks for, not only the ones the project offers: the offered list
        // is what a configuration screen is built from, and a game that computed a size of its own
        // has a reason the list cannot know. The screen and the window minimum are the only limits,
        // and those are not policy - a window larger than the desktop is one the player cannot use.
        applyWindowScale(Number(scale));
    });
    ipcMain.handle("runtime:window:getSize", () => {
        const win = mainWindow;
        if (!win || win.isDestroyed()) {
            return { width: windowDesign.width, height: windowDesign.height };
        }
        const [width, height] = win.getContentSize();
        return { width, height };
    });
    ipcMain.handle("runtime:window:setSize", (_event, size: { width?: number; height?: number }) => {
        applyWindowContentSize(Number(size?.width), Number(size?.height));
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
    // The renderer has a listener now, so anything held for want of one can go.
    ipcMain.on(GAME_RUNTIME_TEST_COMMAND_READY_CHANNEL, () => {
        testCommandListenerReady = true;
        const pending = pendingTestStart;
        pendingTestStart = null;
        if (pending) {
            deliverTestCommand(pending);
        }
    });
    ipcMain.on(GAME_RUNTIME_TEST_SIGNAL_CHANNEL, (_event, signal: unknown) => {
        const event = toGameTestEvent(signal);
        if (event) {
            emitTestEvent(event);
        }
    });

    ipcMain.handle("runtime:save:write", (_event, data: {
        id: string;
        savedGame: unknown;
        capture?: string;
        metadata?: unknown;
        compatibility?: SaveCompatibilityStamp;
        playtimeSeconds?: number;
    }) => saves.write(
        data.id,
        data.savedGame,
        data.capture,
        data.metadata,
        data.compatibility,
        data.playtimeSeconds,
    ));
    ipcMain.handle("runtime:save:read", (_event, id: string) => saves.read(id));
    ipcMain.handle("runtime:save:listIds", () => saves.listIds());
    ipcMain.handle("runtime:save:listHeaders", () => saves.listHeaders());
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
    // Which is also why the project's settings are re-read here from the pack. This process sits
    // OUTSIDE the CSP and `webRequest` cage that `installRuntimeNetworkPolicy` puts the renderer in,
    // so that cage cannot be what enforces them on this path - without the checks below, routing
    // through main would hand a game that shipped with the network off a working network, and one
    // shipped with an allowlist the whole internet.
    //
    // `redirects: "check"` because this process can: it follows the chain itself and decides every
    // hop, so the allowlist governs where the bytes came from rather than only what was typed.
    ipcMain.handle("runtime:network:fetch", async (_event, request: BlueprintNetworkFetchRequest) => {
        const pack = await readPack();
        return executeBlueprintNetworkFetch(request, {
            allowHttp: pack.network?.allowHttp === true,
            allowlist: packNetworkAllowlist(pack),
            redirects: "check",
        });
    });

    // The Move Mouse family's request.
    //
    // Here because this is the process that can answer it: the renderer knows where the point is in
    // the page, and only this side knows where the page is on the desktop. The conversion and the
    // platform call are shared with Dev Mode so the author tests what ships.
    ipcMain.handle("runtime:pointer:move", (event, request: BlueprintPointerMoveRequest) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        return executeBlueprintPointerMove(request, window, { screen });
    });

    // The Open Link node's request.
    //
    // Decided here because this is where it is performed - `shell.openExternal` runs in this
    // process, and a renderer that asked nicely is not a boundary. What is decided is the scheme
    // and nothing else: the address is the author's, written into their own graph.
    //
    // Deliberately not gated on the network settings: no request is made and no bytes come back, so
    // a game shipped with the network off still opens its own store page.
    ipcMain.handle("runtime:external:open", async (_event, request: BlueprintOpenExternalRequest) => {
        const decision = resolveCoreExternalLink(request);
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

    // The Export/Import Progress nodes, performed here because here is the process with a
    // filesystem.
    //
    // The renderer says what the playthrough holds and never which file. `pack.progressKey` is
    // re-read per request, exactly as the declared addresses above are, and it is the only thing
    // that decides where the bytes land - a key taken from the caller would make these channels a
    // way to write into another title's document.
    //
    // The directory is deliberately NOT `userDataDir`. That one is named after this build's app id,
    // and the whole point of this feature is that a demo and a full game have different app ids and
    // therefore cannot read each other's saves. The progress document sits beside both of them.
    //
    // A pack with no key (one built before the field existed) fails with a reason rather than
    // guessing one: a guessed key names a file the real build would never look at.
    ipcMain.handle("runtime:progress:write", async (_event, request: GameProgressExportRequest) => {
        const pack = await readPack();
        const result = await writeGameProgressFile(
            progressEnvironment(),
            String(pack.progressKey ?? ""),
            request,
        );
        if (result.outcome === "failed") {
            logRuntime("warning", `Export Progress failed: ${result.error}`);
        }
        return result;
    });
    ipcMain.handle("runtime:progress:read", async () => {
        const pack = await readPack();
        const result = await readGameProgressFile(progressEnvironment(), String(pack.progressKey ?? ""));
        if (result.outcome === "failed") {
            logRuntime("warning", `Import Progress failed: ${result.error}`);
        }
        return result;
    });

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
            const { reply, effect, command } = dispatchControlFrame(raw.toString(), preview.controlToken);
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
                return;
            }
            if (effect === "command" && command) {
                deliverTestCommand(command);
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
