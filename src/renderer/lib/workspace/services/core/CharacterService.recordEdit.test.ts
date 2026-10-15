import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranslationKey } from "@shared/i18n";
import { HistoryService } from "../history/HistoryService";
import { projectHistoryScope } from "../history/historyScopes";
import { Services } from "../services";
import type { StoredCharacter } from "../character/types";
import { CharacterService } from "./CharacterService";

vi.mock("@/lib/app/writeFreeze", () => ({ getProjectWriteFreeze: () => null }));

/**
 * Edits made to a character in place - what a PSD import does through the editor's setters - left as
 * ONE step on the project's stack, together with what the same gesture did to the asset library.
 * The library's half here is a stand-in; the bytes themselves are `AssetsService.test.ts`.
 */
function createHarness() {
    const history = new HistoryService();
    const service = new CharacterService();
    let nextId = 0;
    const context = {
        project: {} as never,
        services: {
            get(id: Services) {
                switch (id) {
                    case Services.History: return history;
                    case Services.Uuid: return { generate: () => `id-${++nextId}` };
                    case Services.UI: return { showError: vi.fn() };
                    case Services.ServiceAssets: return { deleteFile: vi.fn(async () => ({ ok: true })) };
                    case Services.FileSystem: return {};
                    case Services.Story: return { listStories: () => [] };
                    default: throw new Error(`Unexpected service ${id}`);
                }
            },
        } as never,
        commandLineRun: false,
    };
    history.setContext(context);
    service.setContext(context);
    return { service, history };
}

const LABEL = { key: "workspace.history.entry.importPsd" as TranslationKey };

/** The library's half of a gesture, as a step sees it: what it was asked to do, in order. */
function libraryStub(log: string[], options: { undoFails?: () => boolean } = {}) {
    return {
        undo: vi.fn(async () => {
            if (options.undoFails?.()) {
                log.push("library-undo-refused");
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

/** What a PSD import leaves in a layered character: a layer showing an image. */
function importInto(mei: ReturnType<CharacterService["createCharacter"]>) {
    const appearance = mei.profile.appearance;
    appearance.setKind("layered");
    const layer = appearance.createLayer("body")!;
    appearance.setLayerAsset(layer.id, "asset-body");
    return layer;
}

describe("CharacterService.recordCharacterEdit", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("takes the edits and the library's half back in one step, and puts both in again", async () => {
        const { service, history } = createHarness();
        const mei = service.createCharacter("Mei");
        const before = structuredClone(mei.toJSON()) as StoredCharacter;
        importInto(mei);
        const after = structuredClone(mei.toJSON());
        const log: string[] = [];
        const library = libraryStub(log);

        expect(service.recordCharacterEdit(mei.profile.getId(), before, LABEL, library)).toBe(true);
        expect(history.peekUndo(projectHistoryScope())).toEqual(LABEL);

        expect(history.undo(projectHistoryScope())).toBe(true);
        await history.settled();
        expect(mei.toJSON()).toEqual(before);
        expect(log).toEqual(["library-undo"]);

        expect(history.redo(projectHistoryScope())).toBe(true);
        await history.settled();
        expect(mei.toJSON()).toEqual(after);
        expect(log).toEqual(["library-undo", "library-redo"]);
    });

    it("gives back on redo the edits made after the gesture, which undo also took back", async () => {
        const { service, history } = createHarness();
        const mei = service.createCharacter("Mei");
        const before = structuredClone(mei.toJSON()) as StoredCharacter;
        const layer = importInto(mei);
        service.recordCharacterEdit(mei.profile.getId(), before, LABEL, libraryStub([]));

        // The editor's own edits leave no step of their own.
        mei.profile.appearance.createLayer("hair");
        mei.profile.appearance.setLayerAsset(layer.id, "asset-body-2");
        const edited = structuredClone(mei.toJSON());

        history.undo(projectHistoryScope());
        await history.settled();
        expect(mei.toJSON()).toEqual(before);

        history.redo(projectHistoryScope());
        await history.settled();
        expect(mei.toJSON()).toEqual(edited);
    });

    it("leaves the character and the step as they were when the library's half refuses", async () => {
        const { service, history } = createHarness();
        const mei = service.createCharacter("Mei");
        const before = structuredClone(mei.toJSON()) as StoredCharacter;
        importInto(mei);
        const after = structuredClone(mei.toJSON());
        let refuse = true;
        const log: string[] = [];
        service.recordCharacterEdit(mei.profile.getId(), before, LABEL, libraryStub(log, { undoFails: () => refuse }));

        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            history.undo(projectHistoryScope());
            await history.settled();
        } finally {
            error.mockRestore();
        }
        expect(mei.toJSON()).toEqual(after);
        expect(history.canUndo(projectHistoryScope())).toBe(true);

        refuse = false;
        history.undo(projectHistoryScope());
        await history.settled();
        expect(mei.toJSON()).toEqual(before);
    });

    it("lets the library's half go when the step leaves the stack", () => {
        const { service, history } = createHarness();
        const mei = service.createCharacter("Mei");
        const before = structuredClone(mei.toJSON()) as StoredCharacter;
        importInto(mei);
        const log: string[] = [];
        service.recordCharacterEdit(mei.profile.getId(), before, LABEL, libraryStub(log));

        history.clearAll();
        expect(log).toEqual(["library-dispose"]);
    });

    it("leaves no step, and lets the library's half go, inside a live session", () => {
        const { service, history } = createHarness();
        const mei = service.createCharacter("Mei");
        const before = structuredClone(mei.toJSON()) as StoredCharacter;
        service.setOperationSink({ handle: () => true });
        const log: string[] = [];

        expect(service.recordCharacterEdit(mei.profile.getId(), before, LABEL, libraryStub(log))).toBe(false);
        expect(history.canUndo(projectHistoryScope())).toBe(false);
        expect(log).toEqual(["library-dispose"]);
    });
});
