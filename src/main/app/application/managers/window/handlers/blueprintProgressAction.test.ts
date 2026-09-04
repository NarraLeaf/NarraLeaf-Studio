import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
    app: { getPath: () => path.join(os.tmpdir(), "nls-progress-appdata") },
}));

/**
 * The player's own file, doubled.
 *
 * Not because reaching it would be hard, but because it is the wrong file to reach in a test: the
 * document these handlers write lives beside every other NarraLeaf title's on this machine, under
 * the *user's* application data rather than anywhere the test owns. What is under test is which
 * project's identity decides its name, and that is answered before a byte is written.
 */
const { writeGameProgressFile, readGameProgressFile } = vi.hoisted(() => ({
    // The environment and the request are declared but unused: what a test reads back is the
    // second argument, the progress key, which is the whole of what the guard decides.
    writeGameProgressFile: vi.fn(async (_environment: unknown, _key: string, _request: unknown) => ({
        outcome: "written",
        error: null,
    })),
    readGameProgressFile: vi.fn(async (_environment: unknown, _key: string) => ({
        outcome: "missing",
        document: null,
        error: null,
    })),
}));
vi.mock("@shared/utils/gameProgressFile", () => ({ writeGameProgressFile, readGameProgressFile }));

const { WINDOW_PROJECT_MISMATCH_CODE } = await import("@shared/types/window");
const { gameProgressKey } = await import("@shared/types/gameProgress");
const { encodeProjectConfig, getProjectConfigFileName } = await import("@shared/utils/nlproj");
const { BlueprintProgressReadHandler, BlueprintProgressWriteHandler } =
    await import("./blueprintProgressAction");

type AppWindowLike = Parameters<InstanceType<typeof BlueprintProgressWriteHandler>["handle"]>[0];

let root: string;
/** The project the preview window has open. */
let mine: string;
/** A second project on this disk, with an identity of its own. */
let theirs: string;

const request = {
    storyId: "story",
    savedVariables: {},
    persistentVariables: {},
    anchor: null,
    visitedSceneIds: [],
} as never;

/** A window on one project. Nothing else about it matters: the key is read off disk. */
function makeWindow(projectPath?: string) {
    return {
        getProps: () => ({ projectPath }),
        getApp: () => ({}),
    } as unknown as AppWindowLike;
}

/** A real project on disk, so the key really is derived from a config the handler reads. */
async function writeProject(name: string, identifier: string): Promise<string> {
    const dir = path.join(root, name);
    await fs.mkdir(dir, { recursive: true });
    const config = { name, identifier, metadata: { version: "1.0.0" } };
    await fs.writeFile(path.join(dir, getProjectConfigFileName(name)), encodeProjectConfig(config));
    return dir;
}

function keyOf(name: string, identifier: string): string {
    return gameProgressKey({ displayName: name, identifier, version: "1.0.0" });
}

beforeEach(async () => {
    vi.clearAllMocks();
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nls-progress-guard-"));
    mine = await writeProject("mine", "com.example.mine");
    theirs = await writeProject("theirs", "com.example.theirs");
});

afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
});

/**
 * Whose progress document a Dev Mode preview may touch.
 *
 * This is not Studio's own storage. The file is the one a *shipped build of that title* reads and
 * writes on this machine, under the player's `NarraLeaf/progress/` - a preview goes there on
 * purpose, so that an author testing Export Progress tests what a player will get.
 *
 * The key was already refused from the caller: it is derived here from the project's config, so
 * that no request can name another title's document directly. What was missing is the step before
 * it - both handlers took their window as `_window` and never looked at it, so naming another
 * project's directory derived that project's key and reached its players' document by the long
 * route. A guard on the key and none on the project guards nothing.
 */
describe("the Progress handlers act on the window's own project", () => {
    const doors = [
        {
            name: "write",
            run: (window: AppWindowLike, projectPath: string) =>
                new BlueprintProgressWriteHandler().handle(window, { projectPath, request }),
            reached: writeGameProgressFile,
        },
        {
            name: "read",
            run: (window: AppWindowLike, projectPath: string) =>
                new BlueprintProgressReadHandler().handle(window, { projectPath }),
            reached: readGameProgressFile,
        },
    ] as const;

    for (const door of doors) {
        it(`${door.name} uses the key of the window's own project`, async () => {
            const result = await door.run(makeWindow(mine), mine);

            expect(result.success).toBe(true);
            expect(door.reached.mock.calls[0][1]).toBe(keyOf("mine", "com.example.mine"));
        });

        it(`${door.name} refuses a project this window does not have open`, async () => {
            const result = await door.run(makeWindow(mine), theirs);

            expect(result.success).toBe(false);
            expect(result.code).toBe(WINDOW_PROJECT_MISMATCH_CODE);
            expect(door.reached).not.toHaveBeenCalled();
        });

        /** The launcher, settings and the wizard have no project a payload could agree with. */
        it(`${door.name} refuses a window that has no project open`, async () => {
            const result = await door.run(makeWindow(), mine);

            expect(result.code).toBe(WINDOW_PROJECT_MISMATCH_CODE);
            expect(door.reached).not.toHaveBeenCalled();
        });

        /** A guard that refused the author their own project would be worse than the hole. */
        it(`${door.name} accepts the window's own project under another spelling`, async () => {
            const result = await door.run(makeWindow(mine), mine + path.sep);

            expect(result.success).toBe(true);
            expect(door.reached.mock.calls[0][1]).toBe(keyOf("mine", "com.example.mine"));
        });
    }

    /**
     * The two projects really do answer to different documents, which is what makes the refusals
     * above about something. Without it the whole table could pass on one shared key.
     */
    it("the two projects derive different keys", () => {
        expect(keyOf("mine", "com.example.mine")).not.toBe(keyOf("theirs", "com.example.theirs"));
    });
});
