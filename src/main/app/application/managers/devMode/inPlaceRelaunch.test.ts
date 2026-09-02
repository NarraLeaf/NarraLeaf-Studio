import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { App } from "@/app/app";
import type { DevModeEntry } from "@shared/types/devMode";
import { IPCEventType } from "@shared/types/ipcEvents";
import { isProjectAssetPath, devModeAssetPrewarmKey } from "@shared/devMode/assetRevision";
import { DevModeManager } from "./DevModeManager";
import type { DevModeBundleLoadContext, DevModeBundleSource } from "./pipeline/types";

/**
 * What a story row's play control costs when Dev Mode is already open.
 *
 * It used to cost a window: every press closed the Dev Mode window and built another one, so the
 * author waited for a window teardown and a renderer boot before the row they pointed at appeared.
 * The window is the same window and the project is the same project, so the assertions here are
 * about what does NOT happen - no `forceClose`, no second `launchDevMode` - and about the one thing
 * that must, which is that the recompiled documents reach the window with the instruction ahead of
 * them.
 */

let root: string;
let devMode: DevModeManager;
/** Every bundle the source was asked to assemble, in order. */
let compiled: DevModeBundleLoadContext[];
let launchedWindows: FakeWindow[];

const STORY_ENTRY: DevModeEntry = { kind: "story", storyId: "story-1", sceneId: "scene-1", blockId: "row-9" };
const SURFACE_ENTRY: DevModeEntry = { kind: "surface", surfaceId: "main" };

const recordingBundleSource: DevModeBundleSource = {
    kind: "recording",
    async load(context: DevModeBundleLoadContext) {
        compiled.push(context);
        return {
            bundleId: context.bundleId,
            revision: context.revision,
            ...(context.assetRevision === undefined ? {} : { assetRevision: context.assetRevision }),
            timestamp: new Date().toISOString(),
            ui: {},
        } as never;
    },
};

type SentEvent = { type: IPCEventType; payload: unknown };

type FakeWindow = {
    closed: boolean;
    forceClosed: boolean;
    sent: SentEvent[];
    ready(): void;
    isClosed(): boolean;
    forceClose(): void;
};

function fakeWindow(): FakeWindow {
    const readyHandlers: (() => void)[] = [];
    const closeHandlers: (() => void)[] = [];
    const window = {
        closed: false,
        forceClosed: false,
        sent: [] as SentEvent[],
        isClosed: () => window.closed,
        isDestroyed: () => window.closed,
        show: () => undefined,
        focus: () => undefined,
        win: { focus: () => undefined, on: () => undefined },
        onClose: (handler: () => void) => closeHandlers.push(handler),
        // Announced the moment the manager subscribes: the real window fires this once its renderer
        // is up, and a fake that never did would leave every payload queued and every outbox empty.
        onReady: (handler: () => void) => {
            readyHandlers.push(handler);
            handler();
        },
        ready: () => readyHandlers.forEach(handler => handler()),
        setCloseGuard: () => undefined,
        sendIpcEvent: (type: IPCEventType, payload: unknown) => window.sent.push({ type, payload }),
        forceClose: () => {
            window.forceClosed = true;
            window.closed = true;
            for (const handler of closeHandlers) handler();
        },
    };
    return window as unknown as FakeWindow;
}

/** Just enough app for the manager: a logger, no workspace window, a trusted project, no VCS. */
function fakeApp(): App {
    const noop = () => undefined;
    return {
        logger: { info: noop, warn: noop, error: noop, debug: noop },
        isQuitting: () => false,
        windowManager: { getWindows: () => [] },
        findWorkspaceForProject: () => undefined,
        getGlobalState: () => ({ get: () => undefined }),
        projectTrustManager: { isTrusted: () => true },
        launchDevMode: async () => {
            const window = fakeWindow();
            launchedWindows.push(window);
            return window;
        },
    } as unknown as App;
}

/** Events of one type, in the order the window received them. */
function sentOfType(window: FakeWindow, type: IPCEventType): unknown[] {
    return window.sent.filter(event => event.type === type).map(event => event.payload);
}

beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nl-devmode-inplace-")));
    fs.writeFileSync(path.join(root, "project.json"), JSON.stringify({ name: "in-place" }));
    compiled = [];
    launchedWindows = [];
    devMode = new DevModeManager(fakeApp(), undefined, recordingBundleSource);
});

afterEach(async () => {
    await devMode.stop(root).catch(() => undefined);
    fs.rmSync(root, { recursive: true, force: true });
});

describe("a story launch while Dev Mode is already open", () => {
    it("keeps the window it has instead of building another", async () => {
        await expect(devMode.launch(root, SURFACE_ENTRY)).resolves.toBe("running");
        expect(launchedWindows).toHaveLength(1);
        const window = launchedWindows[0];

        await expect(devMode.launch(root, STORY_ENTRY)).resolves.toBe("running");

        // The assertion this exists for: the window the author was watching is the window that is
        // now playing their row.
        expect(launchedWindows).toHaveLength(1);
        expect(window.forceClosed).toBe(false);
        expect(window.isClosed()).toBe(false);
    });

    it("recompiles, and puts the instruction in front of the bundle it belongs to", async () => {
        await devMode.launch(root, SURFACE_ENTRY);
        const window = launchedWindows[0];
        window.sent.length = 0;

        await devMode.launch(root, STORY_ENTRY);

        // The launch flushes the author's unsaved documents on its way here, so sending the row
        // without the documents would play it as it was before they pressed play.
        expect(compiled).toHaveLength(2);
        expect(compiled[1].revision).toBe(2);

        const startIndex = window.sent.findIndex(event => event.type === IPCEventType.devModeControlStartStory);
        const payloadIndex = window.sent.findIndex(event => event.type === IPCEventType.devModePayloadUpdate);
        expect(startIndex).toBeGreaterThanOrEqual(0);
        expect(payloadIndex).toBeGreaterThan(startIndex);
        expect(sentOfType(window, IPCEventType.devModeControlStartStory)[0]).toEqual({
            token: 1,
            storyId: "story-1",
            sceneId: "scene-1",
            startBlockId: "row-9",
        });
    });

    it("gives every press its own token", async () => {
        await devMode.launch(root, STORY_ENTRY);
        const window = launchedWindows[0];

        await devMode.launch(root, { ...STORY_ENTRY, blockId: "row-2" });
        await devMode.launch(root, { ...STORY_ENTRY, blockId: "row-3" });

        expect(sentOfType(window, IPCEventType.devModeControlStartStory)).toEqual([
            { token: 1, storyId: "story-1", sceneId: "scene-1", startBlockId: "row-2" },
            { token: 2, storyId: "story-1", sceneId: "scene-1", startBlockId: "row-3" },
        ]);
    });

    it("still opens a window when there is none", async () => {
        await expect(devMode.launch(root, STORY_ENTRY)).resolves.toBe("running");

        expect(launchedWindows).toHaveLength(1);
        // The boot carries the row: nothing is running yet, so there is nothing to relaunch in place.
        expect(sentOfType(launchedWindows[0], IPCEventType.devModeControlStartStory)).toEqual([]);
    });

    it("opens a new window when the old one was closed", async () => {
        await devMode.launch(root, STORY_ENTRY);
        launchedWindows[0].forceClose();

        await expect(devMode.launch(root, STORY_ENTRY)).resolves.toBe("running");

        expect(launchedWindows).toHaveLength(2);
    });

    it("leaves a launch that is not a story on the path that rebuilds the window", async () => {
        // A surface launch changes which surface the window is FOR, which is what its props say and
        // what its renderer booted against. Only a story is something the running app can be asked
        // to start over the surface it already has.
        await devMode.launch(root, STORY_ENTRY);
        expect(launchedWindows).toHaveLength(1);

        await devMode.launch(root, SURFACE_ENTRY);

        expect(launchedWindows).toHaveLength(2);
        expect(launchedWindows[0].forceClosed).toBe(true);
    });
});

describe("which reloads the window has to re-resolve its assets for", () => {
    it("counts a change under the project's assets, and nothing else", () => {
        const assets = path.join(root, "assets");
        expect(isProjectAssetPath(assets, path.join(assets, "content", "bg.png"))).toBe(true);
        expect(isProjectAssetPath(assets, path.join(assets, "assets.metadata.blueprint.json"))).toBe(true);
        expect(isProjectAssetPath(assets, path.join(root, "editor", "story", "storydoc.json"))).toBe(false);
        // A sibling whose name merely starts with the root's: a prefix test would say yes.
        expect(isProjectAssetPath(assets, path.join(root, "assets-old", "bg.png"))).toBe(false);
        expect(isProjectAssetPath(assets, assets)).toBe(false);
    });

    it("lets two bundles share one pass only while the asset count stands still", () => {
        const base = { bundleId: "b", revision: 4, assetRevision: 0 };
        expect(devModeAssetPrewarmKey(base)).toBe(devModeAssetPrewarmKey({ ...base, revision: 5 }));
        // An asset the author replaced mints a new grant token, so the URLs have to be asked for again.
        expect(devModeAssetPrewarmKey(base)).not.toBe(devModeAssetPrewarmKey({ ...base, assetRevision: 1 }));
        // A host that watches nothing states no count and keeps the behaviour it always had.
        expect(devModeAssetPrewarmKey({ bundleId: "b", revision: 4 })).toBe("b:4");
    });

    it("carries the session's count on every bundle it assembles", async () => {
        await devMode.launch(root, SURFACE_ENTRY);

        expect(compiled[0].assetRevision).toBe(0);
    });
});

describe("a file the author saves while Dev Mode runs", () => {
    /**
     * Edit a file until the watcher has answered with a bundle.
     *
     * Re-edited rather than written once, because a watcher installed a moment ago may still be
     * walking the tree it was given, and an edit that lands during that walk is reported by nobody.
     * The content grows each round so every write is a real change by the mtime/size rule the watcher
     * filters on, and the rounds are far enough apart not to keep resetting its debounce.
     */
    async function reloadAfterEditing(file: string): Promise<DevModeBundleLoadContext> {
        const before = compiled.length;
        for (let round = 0; round < 12; round++) {
            fs.writeFileSync(file, `edit-${round}`.padEnd(round + 8, "x"));
            for (let poll = 0; poll < 10; poll++) {
                await new Promise(resolve => setTimeout(resolve, 100));
                if (compiled.length > before) {
                    return compiled[compiled.length - 1];
                }
            }
        }
        throw new Error(`no reload after editing ${file}`);
    }

    it("bumps the asset count for an asset and leaves it alone for a document", async () => {
        const story = path.join(root, "editor", "story", "stories", "prologue", "storydoc.json");
        const asset = path.join(root, "assets", "content", "bg.png");
        for (const file of [story, asset]) {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, "seed");
        }

        await devMode.launch(root, SURFACE_ENTRY);

        expect((await reloadAfterEditing(story)).assetRevision).toBe(0);
        // The count moves, so the window asks the workspace for every asset URL again - which is
        // exactly what a replaced file needs, since its grant token is derived from size and mtime.
        expect((await reloadAfterEditing(asset)).assetRevision).toBeGreaterThan(0);
    }, 60_000);
});
