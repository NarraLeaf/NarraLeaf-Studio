import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { showOpenDialog } = vi.hoisted(() => ({ showOpenDialog: vi.fn() }));

vi.mock("electron", () => ({
    dialog: { showOpenDialog, showSaveDialog: vi.fn() },
    net: { request: vi.fn() },
}));

const { GameBuildErrorCode } = await import("@shared/types/gameBuild");

const {
    GameBuildExportPatchHandler,
    GameBuildReadPatchBaselineHandler,
    GameBuildSelectPatchBaselineHandler,
} = await import("./gameBuildAction");

type AppWindowLike = Parameters<InstanceType<typeof GameBuildReadPatchBaselineHandler>["handle"]>[0];

/**
 * A patch baseline is a folder anywhere on the author's disk, so these tests are about one question:
 * which folders this window may open one from.
 *
 * Every folder here is a *real* payload the reader can read. That is deliberate and it is what makes
 * the refusals mean anything: if the guard goes, the handler reaches `openPayload` and answers, so a
 * test that asserts the refusal fails on the answer rather than on some unrelated error. A fixture
 * that could not be read either way would pass with or without the check.
 */
let root: string;
/** The folder the author picked, as a picker would have granted it. */
let picked: string;
/** A readable payload nobody picked - what a renderer names when it is naming a path of its own. */
let unpicked: string;

function appDouble(gameBuildManager: unknown) {
    return {
        hasExperimentalCondition: () => false,
        getCommandLineBuild: () => false,
        globalState: { get: (key: string) => (key === "app.language" ? "en" : undefined) },
        getGameBuildManager: () => gameBuildManager,
    };
}

type Grant = { path: string; recursive: boolean; mode: string };

/**
 * A window whose storage manager keeps its grants, rather than answering a fixed yes or no.
 *
 * Wired end to end on purpose: the picker mints the grant and the readers ask about it, and a double
 * that stubbed both halves would agree with itself no matter which half was broken.
 */
function makeWindow(options: { grants?: Grant[]; exportPatch?: ReturnType<typeof vi.fn> } = {}) {
    const grants: Grant[] = [...(options.grants ?? [])];
    const exportPatch = options.exportPatch ?? vi.fn(() => ({ status: "preparing" }));
    const storageManager = {
        grantFileSystemAccess: vi.fn((
            _window: unknown,
            fsPath: string,
            mode: string = "readwrite",
            recursive: boolean = true,
        ) => {
            for (const granted of mode === "readwrite" ? ["read", "write"] : [mode]) {
                grants.push({ path: path.resolve(fsPath), recursive, mode: granted });
            }
        }),
        isPathTreeAllowed: vi.fn(async (_window: unknown, fsPath: string, mode: string) => {
            const target = path.resolve(fsPath);
            return grants.some(grant => grant.mode === mode
                && grant.recursive
                && (target === grant.path || target.startsWith(`${grant.path}${path.sep}`)));
        }),
    };
    const app = { storageManager, getGameBuildManager: () => ({ exportPatch }) };
    return {
        win: {},
        app,
        getApp: () => appDouble({ exportPatch }),
        __grants: grants,
        __exportPatch: exportPatch,
        __storageManager: storageManager,
    } as unknown as AppWindowLike;
}

function internals(window: AppWindowLike) {
    return window as unknown as {
        __grants: Grant[];
        __exportPatch: ReturnType<typeof vi.fn>;
        __storageManager: {
            grantFileSystemAccess: ReturnType<typeof vi.fn>;
            isPathTreeAllowed: ReturnType<typeof vi.fn>;
        };
    };
}

/** A loose payload: what an unprotected build stages, and the shape the reader speaks natively. */
async function writePayload(name: string): Promise<string> {
    const appDir = path.join(root, name);
    await fs.mkdir(path.join(appDir, "assets"), { recursive: true });
    await fs.writeFile(path.join(appDir, "pack.json"), JSON.stringify({
        schemaVersion: 2,
        generatedAt: "2026-01-01T00:00:00.000Z",
        project: { name: `${name} game`, version: "1.2.3" },
        addOns: { appTagId: "main" },
        assets: { items: {} },
    }));
    return appDir;
}

/** A recursive read grant, as the picker leaves behind. */
function readGrant(target: string): Grant {
    return { path: target, recursive: true, mode: "read" };
}

beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nls-build-guard-"));
    picked = await writePayload("picked");
    unpicked = await writePayload("unpicked");
    showOpenDialog.mockReset();
});

afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
});

describe("GameBuildReadPatchBaselineHandler", () => {
    const handler = new GameBuildReadPatchBaselineHandler();

    /**
     * The guard, stated as the thing it prevents.
     *
     * `unpicked` is readable, so without the check this answers with its pack. It matters more than
     * a leaked product name: opening a payload that looks sealed loads `bindings.node` out of the
     * folder, and loading a `.node` is `dlopen` - a renderer that may name any folder may run native
     * code in the main process.
     */
    it("refuses a readable baseline this window was never granted", async () => {
        const window = makeWindow();

        const result = await handler.handle(window, { path: unpicked });

        expect(result.success).toBe(false);
        expect(result.error).toContain("File system access is not allowed");
        expect(result.error).toContain(unpicked);
    });

    /**
     * The refusal has to be *identifiable*, not merely present.
     *
     * Without the code, this arrives at the dialog as an English sentence indistinguishable from
     * "that folder holds no build" - and the dialog says exactly that, about a folder the author can
     * see their build in. The code is what lets the two be told apart, so it is pinned here rather
     * than left to the sentence.
     */
    it("names the refusal with a code the dialog can tell from an empty folder", async () => {
        const window = makeWindow();

        const result = await handler.handle(window, { path: unpicked });

        expect(result.code).toBe(GameBuildErrorCode.BaselineNotGranted);
    });

    /** A folder that really holds no build is the other fact, and must not borrow the same code. */
    it("does not use that code for a folder that holds no build", async () => {
        const empty = path.join(root, "empty");
        await fs.mkdir(empty, { recursive: true });
        const window = makeWindow({ grants: [readGrant(empty)] });

        const result = await handler.handle(window, { path: empty });

        expect(result.success).toBe(false);
        expect(result.code).not.toBe(GameBuildErrorCode.BaselineNotGranted);
    });

    it("reads a baseline the window holds a grant for", async () => {
        const window = makeWindow({ grants: [readGrant(picked)] });

        const result = await handler.handle(window, { path: picked });

        expect(result).toMatchObject({
            success: true,
            data: { appTagId: "main", productName: "picked game", version: "1.2.3" },
        });
    });

    /** A grant on one build says nothing about the folder beside it. */
    it("refuses a sibling of a granted baseline", async () => {
        const window = makeWindow({ grants: [readGrant(picked)] });

        const result = await handler.handle(window, { path: unpicked });

        expect(result.success).toBe(false);
    });

    /**
     * The grant is on a tree, so the question has to be asked about a tree. A relative path or a
     * `..` walk that lands outside it is the same path spelled differently, and resolving before
     * asking is what makes the two the same question.
     */
    it("refuses a traversal out of a granted baseline", async () => {
        const window = makeWindow({ grants: [readGrant(picked)] });

        const result = await handler.handle(window, {
            path: path.join(picked, "..", path.basename(unpicked)),
        });

        expect(result.success).toBe(false);
        expect(internals(window).__storageManager.isPathTreeAllowed)
            .toHaveBeenCalledWith(window, unpicked, "read");
    });
});

describe("GameBuildExportPatchHandler", () => {
    const handler = new GameBuildExportPatchHandler();
    const entry = { kind: "story" } as never;

    /**
     * The same hole, entered by the request that presses the button rather than by the one the
     * dialog polls while a folder is being typed. The export opens the baseline with the same
     * reader, so guarding one entrance and not the other guards nothing.
     */
    it("refuses a baseline the window was never granted, and starts nothing", async () => {
        const window = makeWindow();

        const result = await handler.handle(window, {
            projectPath: root,
            entry,
            request: { baselineAppDir: unpicked } as never,
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain("File system access is not allowed");
        expect(internals(window).__exportPatch).not.toHaveBeenCalled();
    });

    it("exports against a granted baseline", async () => {
        const window = makeWindow({ grants: [readGrant(picked)] });

        const result = await handler.handle(window, {
            projectPath: root,
            entry,
            request: { baselineAppDir: picked } as never,
        });

        expect(result.success).toBe(true);
        expect(internals(window).__exportPatch).toHaveBeenCalledWith(
            root,
            entry,
            expect.objectContaining({ baselineAppDir: picked }),
        );
    });

    /** No folder named, nothing to authorise: the export builds its own baseline instead. */
    it("leaves an export that names no baseline alone", async () => {
        const window = makeWindow();

        const result = await handler.handle(window, {
            projectPath: root,
            entry,
            request: { baselineFromBuild: true } as never,
        });

        expect(result.success).toBe(true);
        expect(internals(window).__exportPatch).toHaveBeenCalledWith(
            root,
            entry,
            expect.objectContaining({ baselineFromBuild: true }),
        );
    });
});

describe("GameBuildSelectPatchBaselineHandler", () => {
    const handler = new GameBuildSelectPatchBaselineHandler();

    /**
     * The other half of the arrangement. The readers above authorise nothing themselves, so a picker
     * that handed back a path without granting it would leave the feature unusable - and a reader
     * that stopped asking would leave it exploitable. The pair only works whole.
     */
    it("grants the folder it hands back, so the reader can open it", async () => {
        showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [picked], bookmarks: [] });
        const window = makeWindow();

        const selection = await handler.handle(window, {});

        expect(selection).toMatchObject({ success: true, data: { path: picked } });
        expect(internals(window).__storageManager.grantFileSystemAccess)
            .toHaveBeenCalledWith(window, picked, "read", true, undefined, "session");
        await expect(new GameBuildReadPatchBaselineHandler().handle(window, { path: picked }))
            .resolves.toMatchObject({ success: true });
    });

    it("grants nothing when the author cancels", async () => {
        showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [], bookmarks: [] });
        const window = makeWindow();

        const selection = await handler.handle(window, {});

        expect(selection).toMatchObject({ success: true, data: { path: null } });
        expect(internals(window).__grants).toHaveLength(0);
    });
});
