import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Enough of Electron for `devModeAction`'s module graph to load. The screenshot pair is the only
// part of it that reaches Electron at all, through `shell.openPath`, and that is recorded here.
const { openPath } = vi.hoisted(() => ({ openPath: vi.fn(async (_directory: string) => "") }));
vi.mock("electron", () => ({
    app: { getPath: () => "" },
    dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
    net: { request: vi.fn() },
    session: { defaultSession: undefined },
    screen: {},
    shell: { openPath },
}));

const { UserDataNamespace } = await import("@shared/types/constants");
const { WINDOW_PROJECT_MISMATCH_CODE } = await import("@shared/types/window");
const { encodeProjectConfig } = await import("@shared/utils/nlproj");
const { forgetProjectStoreIdentifiers } = await import("../../../utils/windowProjectStore");
const {
    DevModeSaveDeleteHandler,
    DevModeSaveListHeadersHandler,
    DevModeSaveListIdsHandler,
    DevModeSaveReadHandler,
    DevModeSaveReadPreviewHandler,
    DevModeSaveWriteHandler,
    devModeProjectDirectoryName,
} = await import("./devModeSaveAction");
const { DevModeDataResetHandler } = await import("./devModeDataResetAction");
const {
    BlueprintPersistenceGetAllHandler,
    BlueprintPersistenceGetValueHandler,
    BlueprintPersistenceRemoveValueHandler,
    BlueprintPersistenceSetValueHandler,
} = await import("./blueprintPersistenceAction");
const { DevModeScreenshotOpenFolderHandler, DevModeScreenshotSaveHandler } = await import("./devModeAction");

type AppWindowLike = Parameters<InstanceType<typeof DevModeSaveReadHandler>["handle"]>[0];
type Ref = { projectPath: string; projectIdentifier?: string };

/**
 * Every request that reaches a project's Dev Mode data, and the one rule they now share.
 *
 * Thirteen channels - six over the save slots, the reset, four over the persistence store and the
 * screenshot pair - and all of them used to name the project by a `{ projectIdentifier?, projectPath }`
 * in which the IDENTIFIER decided which directory was meant. So asserting the path would not have
 * closed any of them: report your own path and another project's identifier, and the stores open
 * the other project's saves, persistent variables and screenshots. The main process now reads the
 * identifier out of the window's own project, and the path is held against the window.
 *
 * The fixtures are real on purpose. `theirs` genuinely holds a save, a persistent value and a
 * screenshot, all carrying a marker string, and the handlers genuinely read and write the disk - so
 * a guard that stopped working fails on an ANSWER (the marker comes back, or theirs changes), rather
 * than on some unrelated error a double would have raised either way.
 */

const SECRET = "SECRET-FROM-THEIRS";

let root: string;
let mine: string;
let theirs: string;
let stores: Map<string, Record<string, unknown>>;

function windowOn(projectPath?: string) {
    const capturePage = vi.fn(async () => ({ toPNG: () => Buffer.from("png-bytes") }));
    const storageManager = {
        getNamespacePath: (namespace: string) => path.join(root, "userData", namespace),
        createState: (namespace: string, name: string, defaults: Record<string, unknown>) => {
            const key = `${namespace}:${name}`;
            const values = stores.get(key) ?? { ...defaults };
            stores.set(key, values);
            return {
                raw: () => values,
                getItem: (item: string) => values[item],
                setItem: (item: string, value: unknown) => { values[item] = value; },
                removeItem: (item: string) => { delete values[item]; },
                clear: () => { for (const item of Object.keys(values)) delete values[item]; },
            };
        },
    };
    const app = { storageManager };
    const window = {
        app,
        getApp: () => app,
        getProps: () => (projectPath === undefined ? {} : { projectPath }),
        win: { webContents: { capturePage } },
    } as unknown as AppWindowLike;
    return { window, capturePage };
}

async function makeProject(name: string, identifier: string): Promise<string> {
    const dir = path.join(root, "projects", name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "game.nlproj"), encodeProjectConfig({ name, identifier, metadata: {} }));
    return dir;
}

/** The name `theirs`'s saves and screenshots are filed under - its identifier's, hashed. */
function theirsDirectoryName(): string {
    return devModeProjectDirectoryName({ projectPath: theirs, projectIdentifier: "game.theirs" });
}

async function listing(dir: string): Promise<string[]> {
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    return Promise.all(names.sort().map(async name => `${name}=${await fs.readFile(path.join(dir, name), "utf-8")}`));
}

/**
 * Everything of `theirs`'s, as bytes and values, to compare before and after a request. The
 * persistence store is named by the same hash as the two directories.
 */
async function theirsState(): Promise<string> {
    const name = theirsDirectoryName();
    return JSON.stringify({
        saves: await listing(path.join(root, "userData", UserDataNamespace.DevModeSaves, name)),
        screenshots: await listing(path.join(root, "userData", UserDataNamespace.DevModeScreenshots, name)),
        persistence: stores.get(`${UserDataNamespace.BlueprintPersistence}:${name}`) ?? null,
    });
}

beforeEach(async () => {
    forgetProjectStoreIdentifiers();
    openPath.mockClear();
    stores = new Map();
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nls-dev-store-"));
    mine = await makeProject("mine", "game.mine");
    theirs = await makeProject("theirs", "game.theirs");

    // `theirs` has a save, a persistent value and a screenshot, written through its own window. The
    // reference carries the identifier the way the renderer used to send it, so that these fixtures
    // sit exactly where they would have if the main process still believed it.
    const { window } = windowOn(theirs);
    const ref = { projectPath: theirs, projectIdentifier: "game.theirs" } as { projectPath: string };
    await new DevModeSaveWriteHandler().handle(window, {
        projectRef: ref,
        id: SECRET,
        savedGame: { note: SECRET },
        capture: `data:image/png;base64,${SECRET}`,
    });
    await new BlueprintPersistenceSetValueHandler().handle(window, { projectRef: ref, key: SECRET, value: SECRET });
    await new DevModeScreenshotSaveHandler().handle(window, { projectRef: ref });
    openPath.mockClear();
});

afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
});

const channels: { name: string; run: (window: AppWindowLike, projectRef: Ref) => Promise<unknown> }[] = [
    {
        name: "devMode.save.write",
        run: (window, projectRef) => new DevModeSaveWriteHandler().handle(window, {
            projectRef, id: SECRET, savedGame: { overwritten: true },
        }),
    },
    { name: "devMode.save.read", run: (window, projectRef) => new DevModeSaveReadHandler().handle(window, { projectRef, id: SECRET }) },
    { name: "devMode.save.readPreview", run: (window, projectRef) => new DevModeSaveReadPreviewHandler().handle(window, { projectRef, id: SECRET }) },
    { name: "devMode.save.listIds", run: (window, projectRef) => new DevModeSaveListIdsHandler().handle(window, { projectRef }) },
    { name: "devMode.save.listHeaders", run: (window, projectRef) => new DevModeSaveListHeadersHandler().handle(window, { projectRef }) },
    { name: "devMode.save.delete", run: (window, projectRef) => new DevModeSaveDeleteHandler().handle(window, { projectRef, id: SECRET }) },
    { name: "devMode.data.reset", run: (window, projectRef) => new DevModeDataResetHandler().handle(window, { projectRef }) },
    { name: "blueprintPersistence.getAll", run: (window, projectRef) => new BlueprintPersistenceGetAllHandler().handle(window, { projectRef }) },
    { name: "blueprintPersistence.getValue", run: (window, projectRef) => new BlueprintPersistenceGetValueHandler().handle(window, { projectRef, key: SECRET }) },
    {
        name: "blueprintPersistence.setValue",
        run: (window, projectRef) => new BlueprintPersistenceSetValueHandler().handle(window, {
            projectRef, key: SECRET, value: "overwritten",
        }),
    },
    { name: "blueprintPersistence.removeValue", run: (window, projectRef) => new BlueprintPersistenceRemoveValueHandler().handle(window, { projectRef, key: SECRET }) },
    { name: "devMode.screenshot.save", run: (window, projectRef) => new DevModeScreenshotSaveHandler().handle(window, { projectRef }) },
    { name: "devMode.screenshot.openFolder", run: (window, projectRef) => new DevModeScreenshotOpenFolderHandler().handle(window, { projectRef }) },
];

describe("the Dev Mode store channels reach only the window's own project", () => {
    for (const channel of channels) {
        it(`${channel.name} answers for the window's own project`, async () => {
            const before = await theirsState();

            const result = await channel.run(windowOn(mine).window, { projectPath: mine + path.sep });

            expect(result).toMatchObject({ success: true });
            expect(JSON.stringify(result)).not.toContain(SECRET);
            expect(await theirsState()).toBe(before);
        });

        it(`${channel.name} refuses a project this window does not have open, and touches nothing`, async () => {
            const { window, capturePage } = windowOn(mine);
            const before = await theirsState();

            const result = await channel.run(window, { projectPath: theirs });

            expect(result).toMatchObject({ success: false, code: WINDOW_PROJECT_MISMATCH_CODE });
            expect(await theirsState()).toBe(before);
            expect(capturePage).not.toHaveBeenCalled();
            expect(openPath).not.toHaveBeenCalled();
        });

        it(`${channel.name} refuses a window that has no project`, async () => {
            const before = await theirsState();

            const result = await channel.run(windowOn().window, { projectPath: theirs });

            expect(result).toMatchObject({ success: false, code: WINDOW_PROJECT_MISMATCH_CODE });
            expect(await theirsState()).toBe(before);
        });

        /**
         * The case the path assertion alone would have passed: the window's own path, and the
         * other project's identifier. It must land on this project's stores - so nothing of
         * `theirs` comes back, nothing of `theirs` changes, and no answer names its directory.
         */
        it(`${channel.name} ignores another project's identifier carried with the window's own path`, async () => {
            const before = await theirsState();

            const result = await channel.run(windowOn(mine).window, { projectPath: mine, projectIdentifier: "game.theirs" });

            expect(result).toMatchObject({ success: true });
            expect(JSON.stringify(result)).not.toContain(SECRET);
            expect(JSON.stringify(result)).not.toContain(theirsDirectoryName());
            expect(await theirsState()).toBe(before);
            for (const [directory] of openPath.mock.calls) {
                expect(path.basename(directory)).not.toBe(theirsDirectoryName());
            }
        });
    }
});
