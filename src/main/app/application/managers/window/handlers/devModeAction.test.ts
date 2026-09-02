import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Enough of Electron for the module graph behind these handlers to load. None of them reaches it:
// what they do is decide which window to hand a message to.
vi.mock("electron", () => ({
    app: { getPath: () => "" },
    dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
    net: { request: vi.fn() },
    session: { defaultSession: undefined },
}));

const { WindowAppType } = await import("@shared/types/window");
const { WINDOW_PROJECT_MISMATCH_CODE } = await import("@shared/types/window");
const { IPCEventType } = await import("@shared/types/ipcEvents");
const { normalizeProjectPath } = await import("@shared/utils/recentProject");
const {
    DevModeForwardBlueprintDebugEventHandler,
    DevModeForwardStoryRowHandler,
    DevModeOpenBlueprintInWorkspaceHandler,
    DevModeOpenStoryRowInWorkspaceHandler,
} = await import("./devModeAction");

type AppWindowLike = Parameters<InstanceType<typeof DevModeOpenStoryRowInWorkspaceHandler>["handle"]>[0];

/** The project the preview has open, and a second one it does not. */
const mine = path.resolve("/projects/mine");
const theirs = path.resolve("/projects/theirs");

type Workspace = {
    sendIpcEvent: ReturnType<typeof vi.fn>;
    show: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
};

/**
 * A preview window and, unless the case is about its absence, the workspace beside it.
 *
 * The app double answers `findWorkspaceForProject` the way `App` does - over its own window list,
 * through the shared identity rule - rather than returning a fixed window, because the lookup is
 * half of what is under test: a handler that found the workspace by some private comparison of its
 * own would pass a double that answered unconditionally.
 *
 * `windowManager.getWindows()` is the same list, and it is here because a handler that walked it
 * itself is what these tests exist to describe: the doubles have to be able to run that shape too,
 * or the red half of the evidence is a crash rather than a refusal.
 */
function makePreview(options: { props: unknown; workspaceProject?: string }) {
    const workspace: Workspace = { sendIpcEvent: vi.fn(), show: vi.fn(), focus: vi.fn() };
    const windows = options.workspaceProject === undefined ? [] : [{
        getWindowType: () => WindowAppType.Workspace,
        isClosed: () => false,
        isDestroyed: () => false,
        getProps: () => ({ projectPath: options.workspaceProject }),
        sendIpcEvent: workspace.sendIpcEvent,
        getBrowserWindow: () => ({ show: workspace.show, focus: workspace.focus }),
    }];
    const app = {
        windowManager: { getWindows: () => windows },
        findWorkspaceForProject: (projectPath: string) => windows.find(w =>
            w.getWindowType() === WindowAppType.Workspace
            && !w.isClosed()
            && normalizeProjectPath(w.getProps().projectPath as string) === normalizeProjectPath(projectPath),
        ),
    };
    const window = {
        getWindowType: () => WindowAppType.DevMode,
        getProps: () => options.props,
        getApp: () => app,
        app,
    } as unknown as AppWindowLike;
    return { window, workspace };
}

/** A window that is not a preview at all: the same request from the workspace itself. */
function notAPreview(props: unknown): AppWindowLike {
    const { window } = makePreview({ props });
    return { ...(window as object), getWindowType: () => WindowAppType.Workspace } as unknown as AppWindowLike;
}

const row = { storyId: "story", sceneId: "scene", blockId: "block" };

/**
 * The four doors a Dev Mode preview has into its own workspace.
 *
 * `noWorkspace` is each door's own answer to "nothing has this project open", which is not uniform
 * and must not become so: the play head fires on every action and says nothing when there is
 * nowhere to say it, while the two the author clicked have to report that they did nothing.
 */
const doors = [
    {
        name: "openBlueprintInWorkspace",
        event: IPCEventType.workspaceBlueprintNavigateFromPreview,
        noWorkspace: "failed" as const,
        run: (window: AppWindowLike, projectPath: string) =>
            new DevModeOpenBlueprintInWorkspaceHandler().handle(window, {
                projectPath,
                blueprintId: "bp",
                ownerKind: "surfaceMain",
                surfaceId: "surface",
            } as never),
    },
    {
        name: "forwardBlueprintDebugEvent",
        event: IPCEventType.workspaceBlueprintDebugEvent,
        noWorkspace: "silent" as const,
        run: (window: AppWindowLike, projectPath: string) =>
            new DevModeForwardBlueprintDebugEventHandler().handle(window, {
                projectPath,
                event: { kind: "nodeEntered" },
            } as never),
    },
    {
        name: "forwardStoryRow",
        event: IPCEventType.workspaceStoryRowHighlight,
        noWorkspace: "silent" as const,
        run: (window: AppWindowLike, projectPath: string) =>
            new DevModeForwardStoryRowHandler().handle(window, { projectPath, ...row } as never),
    },
    {
        name: "openStoryRowInWorkspace",
        event: IPCEventType.workspaceStoryRowOpen,
        noWorkspace: "failed" as const,
        run: (window: AppWindowLike, projectPath: string) =>
            new DevModeOpenStoryRowInWorkspaceHandler().handle(window, { projectPath, ...row } as never),
    },
] as const;

/**
 * Which project a Dev Mode request may be about, and how "the same project" is decided.
 *
 * All four ask their own window rather than believing the payload, which is the check the rest of
 * the main process asks. They used to ask it with a `path.normalize` comparison written in that
 * file - a private copy of the app's identity rule that agrees about separators and not about case,
 * and does not even agree about a trailing one. Nothing spelled the two sides differently, so it
 * never misbehaved; the tests below pin both halves, because the half that would have broken first
 * is the author being refused their own project.
 */
describe("a Dev Mode request reaches the workspace of its own project", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    for (const door of doors) {
        /**
         * The property the check exists for. `theirs` has a workspace open, so without it the
         * message lands in a window showing a project this preview is not running.
         */
        it(`${door.name} refuses a project this window does not have open`, async () => {
            const { window, workspace } = makePreview({
                props: { projectPath: mine },
                workspaceProject: theirs,
            });

            const result = await door.run(window, theirs);

            expect(result.success).toBe(false);
            expect(result.code).toBe(WINDOW_PROJECT_MISMATCH_CODE);
            expect(workspace.sendIpcEvent).not.toHaveBeenCalled();
        });

        /** The ordinary case, asserted through to the message rather than at the envelope. */
        it(`${door.name} reaches the workspace showing the window's own project`, async () => {
            const { window, workspace } = makePreview({
                props: { projectPath: mine },
                workspaceProject: mine,
            });

            const result = await door.run(window, mine);

            expect(result.success).toBe(true);
            expect(workspace.sendIpcEvent).toHaveBeenCalledWith(door.event, expect.anything());
        });

        /**
         * The first failure mode that matters more than the hole: refusing the author's own project.
         *
         * A trailing separator names the same directory, and `path.normalize` keeps it - on every
         * platform - so the comparison this replaces answered "not your project" to a preview
         * talking about the only project it has. Both sides are resolved before being folded, which
         * is what makes the two spellings one question.
         */
        it(`${door.name} accepts the window's own project with a trailing separator`, async () => {
            const { window, workspace } = makePreview({
                props: { projectPath: mine },
                workspaceProject: mine,
            });

            const result = await door.run(window, mine + path.sep);

            expect(result.success).toBe(true);
            expect(workspace.sendIpcEvent).toHaveBeenCalledWith(door.event, expect.anything());
        });

        /**
         * The second, and the one only the shared rule answers. On Windows `D:\Projects\Game` and
         * `d:/projects/game` are one directory - a picker writes `\`, a typed or scripted path
         * usually carries `/` - and folding case is the difference between a guard and an outage.
         */
        it.runIf(process.platform === "win32")(
            `${door.name} accepts the window's own project under another spelling`,
            async () => {
                const { window, workspace } = makePreview({
                    props: { projectPath: "D:\\Projects\\Game" },
                    workspaceProject: "D:\\Projects\\Game",
                });

                const result = await door.run(window, "d:/projects/game");

                expect(result.success).toBe(true);
                expect(workspace.sendIpcEvent).toHaveBeenCalledWith(door.event, expect.anything());
            },
        );

        /** Only a preview may ask. Every window in the app carries these handlers. */
        it(`${door.name} refuses a window that is not a preview`, async () => {
            const result = await door.run(notAPreview({ projectPath: mine }), mine);

            expect(result.success).toBe(false);
            expect(result.error).toContain("Invalid window");
        });

        /**
         * "Nothing has this project open" is an ordinary situation rather than a refusal, and the
         * two kinds of door answer it differently on purpose. Pinned so that routing the project
         * check through a shared helper did not flatten them into one answer.
         */
        it(`${door.name} answers its own way when no workspace has the project open`, async () => {
            const { window, workspace } = makePreview({ props: { projectPath: mine } });

            const result = await door.run(window, mine);

            expect(result.success).toBe(door.noWorkspace === "silent");
            expect(workspace.sendIpcEvent).not.toHaveBeenCalled();
        });
    }

    /** The two doors the author clicked pull the workspace forward; the play head must not. */
    it("only the doors the author clicked bring the workspace to the front", async () => {
        for (const door of doors) {
            const { window, workspace } = makePreview({
                props: { projectPath: mine },
                workspaceProject: mine,
            });

            await door.run(window, mine);

            expect(workspace.show.mock.calls.length > 0).toBe(door.noWorkspace === "failed");
        }
    });
});
