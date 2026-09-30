import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectSessionHolder } from "@shared/types/projectSession";
import { getProjectWriteFreeze, thawForeignProjectWrites, thawProjectWrites } from "@/lib/app/writeFreeze";
import { BaseFileSystemService } from "../services/core/FileSystem";
import { watchForSessionTakeover } from "./sessionTakeover";

/**
 * A workspace whose project another NarraLeaf Studio has taken over.
 *
 * Until this existed the Studio that lost the project wrote one log line and went on editing and
 * saving - two Studios writing one project, with nothing on screen in either. What is pinned here is
 * the renderer's half of the fix: the message main sends arms the write latch, and from that moment
 * no verb that moves bytes reaches the main process for anything inside the project.
 */

const PROJECT = "D:/projects/my-game";
const HOLDER: ProjectSessionHolder = { hostname: "studio-two", startedAt: "2026-09-21T09:14:00.000Z", sameHost: false };

const bridge = vi.hoisted(() => {
    const calls: string[] = [];
    // Every privileged verb, answered as a success and recorded, so "nothing reached main" is a
    // statement about this list rather than about the handful of verbs a test thought to spy on.
    const fs = new Proxy({} as Record<string, (...args: unknown[]) => Promise<unknown>>, {
        get: (_target, verb: string) => async (...args: unknown[]) => {
            calls.push(`${verb} ${String(args[1] ?? "")}`);
            return { success: true, data: { ok: true, data: verb.startsWith("request") ? "grant" : undefined } };
        },
    });
    return {
        calls,
        fs,
        takeover: null as ((holder: ProjectSessionHolder) => void) | null,
        windowProps: vi.fn(async () => ({ success: true, data: { projectPath: "D:/projects/my-game" } })),
    };
});

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        getWindowProps: bridge.windowProps,
        workspace: {
            onSessionTakenOver: (handler: (holder: ProjectSessionHolder) => void) => {
                bridge.takeover = handler;
                return { cancel: () => { bridge.takeover = null; } };
            },
        },
    }),
    getPrivilegedInterface: () => ({ fs: bridge.fs }),
}));

function deliverTakeover(): void {
    if (!bridge.takeover) {
        throw new Error("nothing is listening for a takeover");
    }
    bridge.takeover(HOLDER);
}

/** Every verb that moves bytes, aimed at `target` (and, for the two-ended ones, at `other`). */
async function writeEverything(target: string, other: string): Promise<void> {
    await BaseFileSystemService.write(target, "{}", "utf-8");
    await BaseFileSystemService.writeRaw(target, new Uint8Array([1, 2, 3]));
    await BaseFileSystemService.writeBatch([{ path: target, data: "{}", encoding: "utf-8" }]);
    await BaseFileSystemService.ensureRegularFile(target, "{}", "utf-8");
    await BaseFileSystemService.writeFileNoFollow(target, "{}", "utf-8");
    await BaseFileSystemService.writeFileNoFollowOrCreate(target, "{}", "utf-8");
    await BaseFileSystemService.createDir(`${target}.d`);
    await BaseFileSystemService.deleteFile(target);
    await BaseFileSystemService.deleteDir(`${target}.d`);
    await BaseFileSystemService.copyFile(other, target);
    await BaseFileSystemService.copyDir(other, target);
    await BaseFileSystemService.moveFile(target, other);
    await BaseFileSystemService.moveDir(target, other);
}

beforeEach(() => {
    bridge.calls.length = 0;
    bridge.takeover = null;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        bridge.calls.push(`fetch ${url}`);
        return new Response("", { status: 200 });
    }));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
    // The takeover freeze survives a thaw by design; a project switch is what clears it.
    thawForeignProjectWrites("D:/projects/somewhere-else");
    thawProjectWrites();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("watchForSessionTakeover", () => {
    it("arms the latch for this window's project the moment the message arrives", () => {
        const token = watchForSessionTakeover(() => PROJECT);

        deliverTakeover();

        // Synchronously: an auto-save timer firing on the next tick must already meet it.
        expect(getProjectWriteFreeze()).toEqual({
            projectPath: PROJECT,
            reason: { kind: "taken-over", holder: HOLDER },
        });
        token.cancel();
    });

    it("reads the project from the window when the workspace has not come up yet", async () => {
        const token = watchForSessionTakeover(() => null);

        deliverTakeover();
        await vi.waitFor(() => expect(getProjectWriteFreeze()?.reason.kind).toBe("taken-over"));

        expect(getProjectWriteFreeze()?.projectPath).toBe(PROJECT);
        expect(bridge.windowProps).toHaveBeenCalled();
        token.cancel();
    });

    it("stops listening when the window lets go of it", () => {
        const token = watchForSessionTakeover(() => PROJECT);
        token.cancel();

        expect(bridge.takeover).toBeNull();
    });
});

describe("a workspace after its project was taken over", () => {
    it("writes normally before - which is what makes the silence after mean something", async () => {
        await writeEverything(`${PROJECT}/project.json`, `${PROJECT}/backup.json`);

        expect(bridge.calls.length).toBeGreaterThan(0);
    });

    it("sends nothing to the main process for any file in the project", async () => {
        const token = watchForSessionTakeover(() => PROJECT);
        deliverTakeover();

        await writeEverything(`${PROJECT}/editor/story/stories/s1/storydoc.json`, `${PROJECT}/editor/story/stories/s1/old.json`);
        // Editor state as well, which every other freeze leaves writable: it is the other Studio's too.
        await writeEverything(`${PROJECT}/.nlstudio/services/panel_state.json`, `${PROJECT}/.nlstudio/services/old.json`);

        expect(bridge.calls).toEqual([]);
        token.cancel();
    });

    it("answers each refused write as refused, so a saver does not believe its debt was paid", async () => {
        const token = watchForSessionTakeover(() => PROJECT);
        deliverTakeover();

        const result = await BaseFileSystemService.write(`${PROJECT}/project.json`, "{}", "utf-8");

        expect(result).toMatchObject({ ok: true, refused: true });
        token.cancel();
    });

    it("still lets a file outside the project be written", async () => {
        // Exporting the logs to the desktop is how the author takes this window's account with them.
        const token = watchForSessionTakeover(() => PROJECT);
        deliverTakeover();

        await BaseFileSystemService.write("D:/Users/author/Desktop/logs.txt", "log", "utf-8");

        expect(bridge.calls.length).toBeGreaterThan(0);
        token.cancel();
    });
});
