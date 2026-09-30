import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The build itself is a bundler run over a vendor SDK, and the authorization is the file-system gate
// in front of it. Both are recorded rather than run: what is under test is which project reaches them.
const { buildLive2DRuntime, authorizeActorFileSystemRequest } = vi.hoisted(() => ({
    buildLive2DRuntime: vi.fn(async (_options: { targetDir: string }) => ({
        backend: "live2d",
        sdkVersion: "5",
        entryPath: "index.js",
        bytes: 1,
    })),
    authorizeActorFileSystemRequest: vi.fn(async (..._args: unknown[]) => ({ allowed: true })),
}));
vi.mock("electron", () => ({}));
vi.mock("../../puppet/live2dRuntimeBuild", () => ({ buildLive2DRuntime }));
vi.mock("../actorAuthorization", () => ({ authorizeActorFileSystemRequest }));

const { WINDOW_PROJECT_MISMATCH_CODE } = await import("@shared/types/window");
const { PuppetRuntimeInstallSdkHandler } = await import("./puppetRuntimeAction");

type AppWindowLike = Parameters<InstanceType<typeof PuppetRuntimeInstallSdkHandler>["handle"]>[0];

const mine = path.resolve("/projects/mine");
const theirs = path.resolve("/projects/theirs");
const archivePath = path.resolve("/downloads/CubismSdkForWeb.zip");

function windowOn(projectPath?: string): AppWindowLike {
    const app = { getCacheRootDir: () => "", resolveResource: (relative: string) => relative };
    return {
        getProps: () => ({ projectPath }),
        getApp: () => app,
        app,
    } as unknown as AppWindowLike;
}

beforeEach(() => {
    buildLive2DRuntime.mockClear();
    authorizeActorFileSystemRequest.mockClear();
});

/**
 * Installing a puppet runtime compiles code into a project that the project then runs. The window's
 * file-system grant already stood in front of the write; the project is now held against the
 * window's own as well, so a grant that happened to reach further is not a way to put code into
 * somebody else's project.
 */
describe("PuppetRuntimeInstallSdkHandler", () => {
    it("builds into the window's own project, in the window's spelling", async () => {
        const result = await new PuppetRuntimeInstallSdkHandler().handle(windowOn(mine), {
            runtimeId: "live2d",
            projectPath: mine + path.sep,
            archivePath,
        });

        expect(result.success).toBe(true);
        expect(buildLive2DRuntime.mock.calls[0][0].targetDir.startsWith(mine + path.sep)).toBe(true);
    });

    it("refuses a project this window does not have open, before authorizing or building anything", async () => {
        const result = await new PuppetRuntimeInstallSdkHandler().handle(windowOn(mine), {
            runtimeId: "live2d",
            projectPath: theirs,
            archivePath,
        });

        expect(result).toMatchObject({ success: false, code: WINDOW_PROJECT_MISMATCH_CODE });
        expect(authorizeActorFileSystemRequest).not.toHaveBeenCalled();
        expect(buildLive2DRuntime).not.toHaveBeenCalled();
    });

    it("refuses a window that has no project open", async () => {
        const result = await new PuppetRuntimeInstallSdkHandler().handle(windowOn(), {
            runtimeId: "live2d",
            projectPath: mine,
            archivePath,
        });

        expect(result).toMatchObject({ success: false, code: WINDOW_PROJECT_MISMATCH_CODE });
        expect(buildLive2DRuntime).not.toHaveBeenCalled();
    });
});
