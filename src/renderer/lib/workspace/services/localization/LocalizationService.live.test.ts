import { describe, expect, it, vi } from "vitest";
import { FsRejectErrorCode, type FsRequestResult } from "@shared/types/os";
import type { LiveLocalizationOp, LiveVoiceOp } from "@shared/live/ops";
import { hashSourceText } from "@shared/utils/localizationText";
import { join } from "@shared/utils/path";
import { Services, type WorkspaceContext } from "../services";
import { VoiceService } from "../voice/VoiceService";
import { LocalizationService } from "./LocalizationService";

/**
 * The seam a live session hangs the two libraries off.
 *
 * The property every one of these is about: **with a sink installed, an editing gesture becomes an
 * operation and the document is not touched.** Nothing is applied optimistically, so nothing ever has
 * to be taken back - the table moves when the effect answering the intent arrives and
 * `applyLiveOp` runs.
 */

const ROOT = join("D:/projects", "my-game");

type Harness<S> = {
    service: S;
    files: Map<string, string>;
    /** Every operation the sink was handed, in order. */
    handled: (LiveLocalizationOp | LiveVoiceOp)[];
};

function createContext(files: Map<string, string>, kind: "localization" | "voice"): WorkspaceContext {
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
            // One language, declared the way a project declares it. The two configurations are
            // deliberately separate: a project can be translated into a language nobody records.
            getLocalizationConfiguration: () => ({ sourceLocale: "en", locales: [{ code: "ja", name: "Japanese" }] }),
            getVoiceConfiguration: () => ({
                voicedLocales: [{ code: "ja", name: "Japanese" }],
                namingPattern: "{unitId}",
                cast: {},
                voiceChoices: false,
            }),
        },
        [Services.SaveStatus]: { register: () => undefined, reportUnreadableDocument: vi.fn() },
        [Services.Localization]: undefined,
    };
    if (kind === "voice") {
        // The voice service reaches for the localization service to show a line as its actor reads
        // it. Nothing in these tests asks for a line, so the narrowest stand-in is enough.
        stubs[Services.Localization] = { getDocumentIfLoaded: () => undefined };
    }

    return {
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
}

async function createTranslations(): Promise<Harness<LocalizationService>> {
    const files = new Map<string, string>();
    const handled: LiveLocalizationOp[] = [];
    const service = new LocalizationService();
    await service.initialize(createContext(files, "localization"), async () => undefined);
    await service.loadDocument("ja");
    service.setOperationSink({ handle: op => (handled.push(op), true) });
    return { service, files, handled };
}

async function createTakes(): Promise<Harness<VoiceService>> {
    const files = new Map<string, string>();
    const handled: LiveVoiceOp[] = [];
    const service = new VoiceService();
    await service.initialize(createContext(files, "voice"), async () => undefined);
    await service.loadDocument("ja");
    service.setOperationSink({ handle: op => (handled.push(op), true) });
    return { service, files, handled };
}

describe("translations, while a session owns them", () => {
    it("hands an edit over and leaves the library alone", async () => {
        const { service, handled } = await createTranslations();

        service.updateUnit("ja", "text-a", "Too slow.", { target: "遅いよ。" });

        expect(handled).toEqual([{
            op: "set-translation",
            locale: "ja",
            unitId: "text-a",
            // ⚠ The entry as it WOULD have been written, never the patch that was asked for: a patch
            // states an intention and every machine would resolve it against its own copy.
            unit: { target: "遅いよ。", sourceHash: expect.any(String), status: "translated" },
        }]);
        expect(service.unitsOf("ja")).toEqual({});
    });

    it("says the line has no entry when a translator clears the box", async () => {
        // Absence is a value in this document rather than a state to be found missing, so clearing
        // the box is the same verb with nothing in it - and the entry has to already exist, or there
        // is no change to state at all.
        const { service, handled } = await createTranslations();
        service.applyLiveOp({
            op: "set-translation",
            locale: "ja",
            unitId: "text-a",
            unit: { target: "遅いよ。", sourceHash: "h", status: "translated" },
        });

        service.updateUnit("ja", "text-a", "Too slow.", { target: "" });

        expect(handled).toEqual([{ op: "set-translation", locale: "ja", unitId: "text-a", unit: null }]);
        expect(service.unitsOf("ja")).toHaveProperty("text-a");
    });

    it("hands an import over as ONE operation, naming only what it changed", async () => {
        const { service, handled } = await createTranslations();
        service.applyLiveOp({
            op: "set-translation",
            locale: "ja",
            unitId: "text-a",
            unit: { target: "遅いよ。", sourceHash: hashSourceText("Too slow."), status: "translated" },
        });

        const summary = service.applyImportedRows("ja", [
            // Identical to what is there: counted as unchanged and left out of the operation.
            { unitId: "text-a", source: "Too slow.", target: "遅いよ。", status: "translated", note: "", context: "" },
            { unitId: "text-b", source: "Too fast.", target: "早いね。", status: "translated", note: "", context: "" },
            // Nothing in the project answers to this id.
            { unitId: "stranger", source: "?", target: "?", status: "", note: "", context: "" },
        ], new Map([["text-a", "Too slow."], ["text-b", "Too fast."]]));

        expect(handled).toHaveLength(1);
        const op = handled[0];
        expect(op.op).toBe("set-translations");
        expect(op.op === "set-translations" ? op.units.map(entry => entry.unitId) : []).toEqual(["text-b"]);
        // Reported whichever way it went: the summary is what the import DECIDED, and inside a
        // session the entries land when the effect comes back.
        expect(summary).toMatchObject({ applied: 1, unchanged: 1, unknown: 1 });
    });

    it("applies an arriving effect without consulting the sink", async () => {
        const { service, handled } = await createTranslations();

        service.applyLiveOp({
            op: "set-translations",
            locale: "ja",
            units: [
                { unitId: "text-a", unit: { target: "遅いよ。", sourceHash: "h", status: "translated" } },
                { unitId: "text-b", unit: null },
            ],
        });

        expect(handled).toEqual([]);
        expect(service.unitsOf("ja")).toEqual({ "text-a": { target: "遅いよ。", sourceHash: "h", status: "translated" } });
    });

    it("does nothing about a language it does not hold, rather than throwing", async () => {
        // ⚠ An applier runs inside the host reading a message; one that threw would take the session
        // down over one document. The divergence guard catches this on the same effect, because the
        // digest of a library nobody holds is a value rather than a missing answer.
        const { service } = await createTranslations();

        expect(() => service.applyLiveOp({
            op: "set-translation", locale: "fr", unitId: "text-a", unit: null,
        })).not.toThrow();
        expect(service.unitsOf("fr")).toBeNull();
    });

    it("writes the library itself once the sink is taken back", async () => {
        const { service } = await createTranslations();
        service.setOperationSink(null);

        service.updateUnit("ja", "text-a", "Too slow.", { target: "遅いよ。" });

        expect(service.unitsOf("ja")).toHaveProperty("text-a");
    });

    it("reads every language the project declares, and says which ones it got", async () => {
        const { service } = await createTranslations();
        expect(service.listLocales()).toEqual(["ja"]);
        expect(await service.loadAllDocuments()).toEqual(["ja"]);
    });
});

describe("voice takes, while a session owns them", () => {
    it("hands an edit over and leaves the library alone", async () => {
        const { service, handled } = await createTakes();

        service.updateUnit("ja", "text-a", "Too slow.", { assetId: "clip-1" });

        expect(handled).toEqual([{
            op: "set-take",
            locale: "ja",
            unitId: "text-a",
            unit: { assetId: "clip-1", sourceHash: expect.any(String), status: "linked" },
        }]);
        expect(service.unitsOf("ja")).toEqual({});
    });

    it("says the line has no take when the clip is unlinked", async () => {
        const { service, handled } = await createTakes();
        service.applyLiveOp({
            op: "set-take",
            locale: "ja",
            unitId: "text-a",
            unit: { assetId: "clip-1", sourceHash: "h", status: "linked" },
        });

        service.updateUnit("ja", "text-a", "Too slow.", { assetId: "" });

        expect(handled).toEqual([{ op: "set-take", locale: "ja", unitId: "text-a", unit: null }]);
    });

    it("hands a recording script back as ONE operation", async () => {
        const { service, handled } = await createTakes();
        service.applyLiveOp({
            op: "set-take",
            locale: "ja",
            unitId: "text-a",
            unit: { assetId: "clip-1", sourceHash: "h", status: "linked" },
        });

        const summary = service.applyImportedRows("ja", [
            { unitId: "text-a", status: "approved", note: "softer", filename: "", character: "", scene: "", line: "" },
            // No take for this line, so there is nothing for a note or an approval to be about.
            { unitId: "text-b", status: "approved", note: "", filename: "", character: "", scene: "", line: "" },
        ]);

        expect(handled).toHaveLength(1);
        const op = handled[0];
        expect(op.op).toBe("set-takes");
        expect(op.op === "set-takes" ? op.units.map(entry => entry.unitId) : []).toEqual(["text-a"]);
        expect(summary).toMatchObject({ applied: 1, unknown: 1 });
    });

    it("applies an arriving effect without consulting the sink", async () => {
        const { service, handled } = await createTakes();

        service.applyLiveOp({
            op: "set-take",
            locale: "ja",
            unitId: "text-a",
            unit: { assetId: "clip-1", sourceHash: "h", status: "approved" },
        });

        expect(handled).toEqual([]);
        expect(service.unitsOf("ja")).toEqual({ "text-a": { assetId: "clip-1", sourceHash: "h", status: "approved" } });
    });
});
