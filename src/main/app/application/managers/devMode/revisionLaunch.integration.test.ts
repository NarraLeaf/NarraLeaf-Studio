import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { isVcsPlatformSupported } from "@shared/types/vcs";
import type { DevModeEntry } from "@shared/types/devMode";
import type { App } from "@/app/app";
import type { BaseApp } from "../../baseApp";
import { forgetWorkspaceFreeze, reportWorkspaceFreeze } from "../../utils/workspaceFreeze";
import type { LoreGlobals } from "../vcs/lore/call";
import { flushRepository, releaseRepository } from "../vcs/lore/verbs";
import { initRepository } from "../vcs/repository";
import { revisionSnapshotsRoot } from "../vcs/revisionSnapshot";
import { VcsManager } from "../vcs/VcsManager";
import { DevModeManager } from "./DevModeManager";
import type { DevModeBundleLoadContext, DevModeBundleSource } from "./pipeline/types";

/**
 * A Dev Mode launch while the workspace is showing a past revision, end to end against a real
 * repository.
 *
 * Driven through {@link DevModeManager} rather than through the resolver, because the failure this
 * milestone exists to prevent lives in the wiring and not in the decision: the author presses Run on
 * version #1 and watches the current game. So every assertion here is about the directory the BUNDLE
 * SOURCE was handed, and the fake source reads a document out of it - a test that only checked the
 * path would still pass if the snapshot were empty.
 *
 * Teardown is flush -> closeStore -> release (docs/version-control.md §4.15, §4.19); a session left
 * open strands Lore's exclusive repository lock and the temp directory cannot be removed on Windows.
 */

const supported = isVcsPlatformSupported() || Boolean(process.env.LORE_LIB_PATH);

const STORY = "editor/story/stories/prologue/storydoc.json";
const ENTRY: DevModeEntry = { kind: "surface", surfaceId: "main" };

let root: string;
let globals: LoreGlobals;
let vcs: VcsManager;
let devMode: DevModeManager;
/** Every directory the compile path was pointed at, in order. */
let compiled: { projectPath: string; story: string | null }[];
let launchedWindows: FakeWindow[];

function write(relative: string, bytes: string): void {
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, bytes);
}

/**
 * A bundle source that records where it was told to read AND what it found there.
 *
 * Deliberately not the real disk source: that one requires a complete document set (`uidoc.json`,
 * `uigraphs.json`, the asset shards) and would fail this test for reasons that have nothing to do with
 * which directory it was given.
 */
const recordingBundleSource: DevModeBundleSource = {
    kind: "recording",
    async load(context: DevModeBundleLoadContext) {
        const storyPath = path.join(context.projectPath, ...STORY.split("/"));
        compiled.push({
            projectPath: context.projectPath,
            story: fs.existsSync(storyPath) ? fs.readFileSync(storyPath, "utf-8") : null,
        });
        return {
            bundleId: context.bundleId,
            revision: context.revision,
            timestamp: new Date().toISOString(),
            ui: {},
        } as never;
    },
};

type FakeWindow = {
    closed: boolean;
    forceClosed: boolean;
    isClosed(): boolean;
    forceClose(): void;
};

function fakeWindow(): FakeWindow {
    const closeHandlers: (() => void)[] = [];
    const window = {
        closed: false,
        forceClosed: false,
        isClosed: () => window.closed,
        isDestroyed: () => window.closed,
        show: () => undefined,
        win: { focus: () => undefined, on: () => undefined },
        onClose: (handler: () => void) => closeHandlers.push(handler),
        onReady: () => undefined,
        setCloseGuard: () => undefined,
        sendIpcEvent: () => undefined,
        forceClose: () => {
            window.forceClosed = true;
            window.closed = true;
            for (const handler of closeHandlers) handler();
        },
    };
    return window as unknown as FakeWindow;
}

/**
 * Just enough app for the manager: a logger, a window list (empty, so console output goes nowhere) and
 * the real VcsManager - the point of the file is that the real materialiser runs.
 */
function fakeApp(): App {
    const noop = () => undefined;
    return {
        logger: { info: noop, warn: noop, error: noop, debug: noop },
        isQuitting: () => false,
        windowManager: { getWindows: () => [] },
        getVcsManager: () => vcs,
        // Every host resolves which edition it is running as; this profile picked none.
        getGlobalState: () => ({ get: () => undefined }),
        launchDevMode: async () => {
            const window = fakeWindow();
            launchedWindows.push(window);
            return window;
        },
    } as unknown as App;
}

beforeAll(async () => {
    if (!supported) return;

    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nl-devmode-rev-")));
    globals = { repositoryPath: root, offline: true, cache: true };

    write("project.json", JSON.stringify({ name: "prologue" }));
    write(STORY, JSON.stringify({ version: 9, scenes: ["COMMITTED"] }));
    await initRepository(globals, { identity: "author@narraleaf" });

    const noop = () => undefined;
    vcs = new VcsManager({
        logger: { info: noop, warn: noop, error: noop, debug: noop },
        getGlobalState: () => ({ get: () => undefined }),
    } as unknown as BaseApp);

    // The working tree now differs from the only revision, which is what makes "compiled the revision"
    // distinguishable from "compiled the project".
    write(STORY, JSON.stringify({ version: 9, scenes: ["WORKING"] }));
}, 300_000);

beforeAll(() => {
    compiled = [];
    launchedWindows = [];
    devMode = new DevModeManager(fakeApp(), undefined, recordingBundleSource);
});

afterEach(async () => {
    // Stops the session and disposes its chokidar watcher; a working-tree launch installs one and vitest
    // would not exit with it open.
    if (supported) await devMode.stop(root).catch(() => undefined);
    forgetWorkspaceFreeze(root);
    compiled = [];
    launchedWindows = [];
});

afterAll(async () => {
    if (!supported) return;
    await vcs?.dispose().catch(() => undefined);
    await flushRepository(globals).catch(() => undefined);
    await releaseRepository(globals).catch(() => undefined);
    if (root) {
        for (let attempt = 0; attempt < 20; attempt++) {
            try {
                fs.rmSync(root, { recursive: true, force: true });
                break;
            } catch {
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        }
    }
}, 120_000);

async function headRevision(): Promise<string> {
    const history = await vcs.getHistory(root);
    return history[0].revision;
}

describe.skipIf(!supported)("a Dev Mode launch and what it compiles", () => {
    it("compiles the working tree when the workspace is not showing a revision", async () => {
        await expect(devMode.launch(root, ENTRY)).resolves.toBe("running");

        expect(compiled).toHaveLength(1);
        expect(compiled[0].projectPath).toBe(root);
        expect(JSON.parse(compiled[0].story!).scenes).toEqual(["WORKING"]);
    }, 120_000);

    it("compiles the snapshot of the revision the workspace is showing", async () => {
        const revision = await headRevision();
        reportWorkspaceFreeze(root, "revision", revision);

        await expect(devMode.launch(root, ENTRY)).resolves.toBe("running");

        expect(compiled).toHaveLength(1);
        // Under `.nlstudio/`, which the repository excludes - running an old version must not appear in
        // the author's change list.
        expect(compiled[0].projectPath.startsWith(revisionSnapshotsRoot(root))).toBe(true);
        // And it really is the revision: the file on disk says WORKING.
        expect(JSON.parse(compiled[0].story!).scenes).toEqual(["COMMITTED"]);
    }, 120_000);

    it("compiles the working tree under a manual freeze", async () => {
        // The working tree IS what the author is looking at while frozen by hand, so running it is right;
        // the build and Preview still refuse, for consistency rather than for correctness.
        reportWorkspaceFreeze(root, "manual");

        await expect(devMode.launch(root, ENTRY)).resolves.toBe("running");
        expect(compiled[0].projectPath).toBe(root);
    }, 120_000);

    it("refuses the launch when the revision cannot be read, and compiles nothing", async () => {
        reportWorkspaceFreeze(root, "revision", "f".repeat(64));

        await expect(devMode.launch(root, ENTRY)).resolves.toBe("error");

        // The assertion that matters. A fallback to the working tree would leave a bundle here, and the
        // author - who is reading version #1 - would be watching the current game.
        expect(compiled).toHaveLength(0);
        // And no Dev Mode window was opened for a launch that was never going to run.
        expect(launchedWindows).toHaveLength(0);
    }, 120_000);

    it("refuses a revision freeze that did not say which revision", async () => {
        reportWorkspaceFreeze(root, "revision");

        await expect(devMode.launch(root, ENTRY)).resolves.toBe("error");
        expect(compiled).toHaveLength(0);
    }, 120_000);

    it("removes the snapshot when the session stops", async () => {
        const revision = await headRevision();
        reportWorkspaceFreeze(root, "revision", revision);
        await devMode.launch(root, ENTRY);
        expect(fs.existsSync(revisionSnapshotsRoot(root))).toBe(true);

        await devMode.stop(root);

        // Not left behind per revision: a directory per version the author ever ran would be a full copy
        // of their documents each time, with nothing anywhere to delete them.
        //
        // Asserted the instant `stop()` resolves, ON PURPOSE, and this line was flaky until the product
        // was fixed. Stopping closes the window, whose own close handler also discards, so two recursive
        // removes of one tree were started at once - which on Windows fails 20 times out of 20, one of
        // them with EPERM, and the loser returned early having done nothing. `stop()` therefore resolved
        // while the tree was still going away. Weakening this to "eventually gone" would have hidden the
        // real defect: a discard that loses the race and swallows the error leaves a full copy of the
        // author's documents in their project with nothing that will ever remove it.
        expect(fs.existsSync(revisionSnapshotsRoot(root))).toBe(false);
    }, 120_000);

    it("survives a relaunch: the second launch's snapshot is not deleted by the first window's close", async () => {
        const revision = await headRevision();
        reportWorkspaceFreeze(root, "revision", revision);
        await devMode.launch(root, ENTRY);
        await devMode.launch(root, ENTRY);

        expect(compiled).toHaveLength(2);
        expect(compiled[1].projectPath.startsWith(revisionSnapshotsRoot(root))).toBe(true);
        // The outgoing window's close arrives after the replacement session is installed, and the
        // snapshot directory is shared per project: an unguarded cleanup there deletes what the new
        // session is compiling from.
        expect(fs.existsSync(compiled[1].projectPath)).toBe(true);
        expect(JSON.parse(compiled[1].story!).scenes).toEqual(["COMMITTED"]);
    }, 120_000);

    it("leaves no snapshot behind once a working-tree launch takes over", async () => {
        const revision = await headRevision();
        reportWorkspaceFreeze(root, "revision", revision);
        await devMode.launch(root, ENTRY);

        forgetWorkspaceFreeze(root);
        await devMode.launch(root, ENTRY);

        expect(compiled[1].projectPath).toBe(root);
        expect(fs.existsSync(revisionSnapshotsRoot(root))).toBe(false);
    }, 120_000);
});
