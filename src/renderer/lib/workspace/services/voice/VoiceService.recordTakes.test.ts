import { describe, expect, it, vi } from "vitest";
import { FsRejectErrorCode, type FsRequestResult } from "@shared/types/os";
import type { TranslationKey } from "@shared/i18n";
import { join } from "@shared/utils/path";
import { HistoryService } from "../history/HistoryService";
import { projectHistoryScope } from "../history/historyScopes";
import { Services, type WorkspaceContext } from "../services";
import { VoiceService } from "./VoiceService";

vi.mock("@/lib/app/writeFreeze", () => ({ getProjectWriteFreeze: () => null }));

/**
 * An audio import - new takes linked, a pickup written into an existing take - left as ONE step on
 * the project's stack, together with what it did to the asset library. The library's half is a
 * stand-in here; the recordings themselves coming back are `AssetsService.test.ts`.
 */

const ROOT = join("D:/projects", "my-game");
const LABEL = { key: "workspace.history.entry.importAudio" as TranslationKey };

async function createHarness() {
    const files = new Map<string, string>();
    const history = new HistoryService();
    const ok = <T,>(data: T): FsRequestResult<T> => ({ ok: true, data });
    const stubs: Record<string, unknown> = {
        [Services.FileSystem]: {
            read: async (path: string) => {
                const value = files.get(path);
                return value === undefined
                    ? { ok: false, error: { code: FsRejectErrorCode.NOT_FOUND, message: "missing" } }
                    : ok(value);
            },
            writeFileNoFollowOrCreate: async (path: string, data: string) => {
                files.set(path, data);
                return ok(undefined);
            },
            createDir: async () => ok(undefined),
            copyFile: async () => ok(undefined),
        },
        [Services.Project]: {
            getVoiceConfiguration: () => ({
                voicedLocales: [{ code: "ja", name: "Japanese" }],
                namingPattern: "{unitId}",
                cast: {},
                voiceChoices: false,
            }),
        },
        [Services.SaveStatus]: { register: () => undefined, reportUnreadableDocument: vi.fn() },
        [Services.Localization]: { getDocumentIfLoaded: () => undefined },
        [Services.History]: history,
    };
    const context = {
        project: { getConfig: () => ({ projectPath: ROOT }) },
        services: {
            get: (id: string) => {
                const stub = stubs[id];
                if (stub === undefined) {
                    throw new Error(`Service ${id} not found`);
                }
                return stub;
            },
        },
    } as unknown as WorkspaceContext;
    history.setContext(context);
    const service = new VoiceService();
    await service.initialize(context, async () => undefined);
    await service.loadDocument("ja");
    return { service, history };
}

function libraryStub(log: string[], undoFails = false) {
    return {
        undo: vi.fn(async () => {
            if (undoFails) {
                throw new Error("could not keep");
            }
            log.push("library-undo");
        }),
        redo: vi.fn(async () => {
            log.push("library-redo");
        }),
        dispose: vi.fn(() => {
            log.push("library-dispose");
        }),
        isEmpty: () => false,
    };
}

describe("VoiceService.recordTakesEdit", () => {
    it("takes back the lines an import linked and the take it re-stamped, with the library's half", async () => {
        const { service, history } = await createHarness();
        // A take the booth recorded once and approved; the pickup replaces its file.
        service.updateUnit("ja", "line-1", "Hello.", { assetId: "take-1", status: "approved" });
        const before = service.getDocumentIfLoaded("ja")!.units;

        service.updateUnit("ja", "line-1", "Hello there.", { assetId: "take-1" });
        service.updateUnit("ja", "line-2", "Bye.", { assetId: "take-2" });
        const after = service.getDocumentIfLoaded("ja")!.units;
        const log: string[] = [];

        expect(service.recordTakesEdit("ja", [
            { unitId: "line-1", unit: before["line-1"] },
            { unitId: "line-2", unit: null },
        ], LABEL, libraryStub(log))).toBe(true);
        expect(history.peekUndo(projectHistoryScope())).toEqual(LABEL);

        history.undo(projectHistoryScope());
        await history.settled();
        const undone = service.getDocumentIfLoaded("ja")!.units;
        expect(undone["line-1"]).toEqual(before["line-1"]);
        expect(undone["line-2"]).toBeUndefined();
        expect(log).toEqual(["library-undo"]);

        history.redo(projectHistoryScope());
        await history.settled();
        const redone = service.getDocumentIfLoaded("ja")!.units;
        expect(redone["line-1"]).toEqual(after["line-1"]);
        expect(redone["line-2"]).toEqual(after["line-2"]);
        expect(log).toEqual(["library-undo", "library-redo"]);
    });

    it("keeps a clip length measured after the import through undo and redo", async () => {
        const { service, history } = await createHarness();
        service.updateUnit("ja", "line-2", "Bye.", { assetId: "take-2" });
        service.recordTakesEdit("ja", [{ unitId: "line-2", unit: null }], LABEL, libraryStub([]));
        // The lengths trail the import.
        service.updateUnit("ja", "line-2", "Bye.", { duration: 1.5 });

        history.undo(projectHistoryScope());
        await history.settled();
        history.redo(projectHistoryScope());
        await history.settled();
        expect(service.getDocumentIfLoaded("ja")!.units["line-2"]?.duration).toBe(1.5);
    });

    it("leaves the takes and the step as they were when the library's half refuses", async () => {
        const { service, history } = await createHarness();
        service.updateUnit("ja", "line-2", "Bye.", { assetId: "take-2" });
        const after = service.getDocumentIfLoaded("ja")!.units;
        service.recordTakesEdit("ja", [{ unitId: "line-2", unit: null }], LABEL, libraryStub([], true));

        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            history.undo(projectHistoryScope());
            await history.settled();
        } finally {
            error.mockRestore();
        }
        expect(service.getDocumentIfLoaded("ja")!.units["line-2"]).toEqual(after["line-2"]);
        expect(history.canUndo(projectHistoryScope())).toBe(true);
    });

    it("leaves no step, and lets the library's half go, inside a live session", async () => {
        const { service, history } = await createHarness();
        service.setOperationSink({ handle: () => true });
        const log: string[] = [];

        expect(service.recordTakesEdit("ja", [{ unitId: "line-2", unit: null }], LABEL, libraryStub(log))).toBe(false);
        expect(history.canUndo(projectHistoryScope())).toBe(false);
        expect(log).toEqual(["library-dispose"]);
    });
});
