import { afterEach, describe, expect, it, vi } from "vitest";
import { Services, type WorkspaceContext } from "../services";
import { DevModeService } from "./DevModeService";
import { PreviewService } from "./PreviewService";

/**
 * Both runs are compiled from the disk, so what reaches the disk before the launch request is what
 * the author sees played. These pin the order: the open editors are settled, then every store is
 * written, and only then does the request leave the renderer.
 */

const calls: string[] = [];

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        devMode: {
            launch: async () => {
                calls.push("launch");
                return { success: true, data: { status: "running" } };
            },
            status: async () => ({ success: true, data: { status: "running" } }),
        },
        preview: {
            launch: async () => {
                calls.push("launch");
                return { success: true, data: { status: "running" } };
            },
            status: async () => ({ success: true, data: { status: "running" } }),
        },
    }),
}));

/**
 * A workspace with an editor holding an unsettled line and stores that each owe a write.
 *
 * The story store only has something to write once the editor has been settled into it - which is
 * the state a row open for editing is in when its play control is pressed before the field's blur
 * has been handled.
 */
function createContext() {
    let storyOwesLine = false;
    const written: string[] = [];
    const saver = (id: string, write: () => void) => ({
        id,
        labelKey: "workspace.shell.save.stores.story",
        saver: {
            flush: async () => {
                calls.push(`flush:${id}`);
                write();
            },
        },
    });
    const stubs: Record<string, unknown> = {
        [Services.SaveStatus]: {
            settlePendingEdits: () => {
                calls.push("settle");
                storyOwesLine = true;
            },
            listSavers: () => [
                saver("story", () => {
                    if (storyOwesLine) {
                        written.push("story with the edited line");
                    }
                }),
                saver("localization", () => written.push("localization")),
                saver("variables", () => written.push("variables")),
            ],
        },
        // What the narrower flush this replaced asked for directly. Present so that a regression to
        // it fails on what reached the disk rather than on a missing service.
        [Services.UIDocument]: { isDirty: () => false },
        [Services.UIGraph]: { isDirty: () => false },
        [Services.Story]: {
            isDirty: () => true,
            flushPendingChanges: async () => {
                calls.push("flush:story");
                if (storyOwesLine) {
                    written.push("story with the edited line");
                }
            },
        },
        [Services.Character]: {
            isDirty: () => false,
            flushPendingChanges: async () => {
                calls.push("flush:characters");
            },
        },
        [Services.Console]: { log: () => undefined },
    };
    const ctx = {
        project: { getConfig: () => ({ projectPath: "D:/projects/game" }) },
        services: {
            get: (id: string) => {
                const stub = stubs[id];
                if (!stub) {
                    throw new Error(`Service ${id} not found`);
                }
                return stub;
            },
        },
    } as unknown as WorkspaceContext;
    return { ctx, written };
}

afterEach(() => {
    calls.length = 0;
});

describe.each([
    ["Dev Mode", () => new DevModeService(), (service: DevModeService | PreviewService) => (service as DevModeService).launch({ kind: "story", storyId: "s", sceneId: "c", blockId: "b" })],
    ["Preview", () => new PreviewService(), (service: DevModeService | PreviewService) => (service as PreviewService).launch({ kind: "surface", surfaceId: "main" })],
] as const)("%s launch", (_name, make, launch) => {
    it("settles the open editors before writing the stores, and writes them all before launching", async () => {
        const { ctx, written } = createContext();
        const service = make();
        service.setContext(ctx);
        try {
            await launch(service);
        } finally {
            service.dispose(ctx);
        }

        expect(calls[0]).toBe("settle");
        expect(calls.at(-1)).toBe("launch");
        expect(calls).toEqual(expect.arrayContaining(["flush:story", "flush:localization", "flush:variables", "flush:characters"]));
        expect(written).toEqual(expect.arrayContaining(["story with the edited line", "localization", "variables"]));
    });
});
