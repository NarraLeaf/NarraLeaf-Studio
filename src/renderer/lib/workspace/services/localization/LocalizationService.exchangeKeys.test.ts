import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FsRejectErrorCode, type FsRequestResult } from "@shared/types/os";
import {
    parseTranslationExchange,
    serializeTranslationExchange,
    TRANSLATION_EXCHANGE_FORMATS,
} from "@shared/utils/localizationExchange";
import { Services, type WorkspaceContext } from "../services";
import { LocalizationService } from "./LocalizationService";
import { buildTranslationExchangeRows } from "./localizationModel";

const IDS = ["__proto__", "constructor", "toString", "ordinary"];
const ROWS = IDS.map((unitId, index) => ({
    unitId, source: `Source ${index}`, target: `訳文${index}`, status: "reviewed", context: "Scene", note: "",
}));

function harness() {
    const files = new Map<string, string>();
    let beforeNextWrite: (() => Promise<void>) | null = null;
    const ok = <T,>(data: T): FsRequestResult<T> => ({ ok: true, data });
    const stubs: Record<string, unknown> = {
        [Services.FileSystem]: {
            read: async (path: string) => files.has(path)
                ? ok(files.get(path)!)
                : { ok: false, error: { code: FsRejectErrorCode.NOT_FOUND, message: "missing" } },
            writeFileNoFollowOrCreate: async (path: string, text: string) => {
                const before = beforeNextWrite;
                beforeNextWrite = null;
                if (before) await before();
                files.set(path, text);
                return ok(undefined);
            },
            createDir: async () => ok(undefined),
            copyFile: async () => ok(undefined),
        },
        [Services.Project]: {
            getLocalizationConfiguration: () => ({ sourceLocale: "en", locales: [{ code: "ja", name: "Japanese" }] }),
        },
        [Services.SaveStatus]: { register: () => undefined, reportUnreadableDocument: vi.fn() },
    };
    const ctx = {
        project: { getConfig: () => ({ projectPath: "/project" }) },
        services: { get: (id: string) => {
            if (!stubs[id]) throw new Error(`Service ${id} not found`);
            return stubs[id];
        } },
    } as unknown as WorkspaceContext;
    return { ctx, files, pauseNextWrite: (before: () => Promise<void>) => { beforeNextWrite = before; } };
}

async function open(ctx: WorkspaceContext): Promise<LocalizationService> {
    const service = new LocalizationService();
    await service.initialize(ctx, async () => undefined);
    await service.loadDocument("ja");
    return service;
}

describe("translation unit ids", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    for (const format of TRANSLATION_EXCHANGE_FORMATS) {
        it(`round-trips every imported id through ${format}, storage, and export`, async () => {
            const h = harness();
            const service = await open(h.ctx);
            const input = serializeTranslationExchange(format, { sourceLocale: "en", targetLocale: "ja", rows: ROWS });
            const parsed = parseTranslationExchange(format, input);
            expect(parsed.problems).toEqual([]);
            expect(parsed.rows.map(row => row.unitId)).toEqual(IDS);
            const sources = new Map(ROWS.map(row => [row.unitId, row.source]));

            expect(service.applyImportedRows("ja", parsed.rows, sources)).toMatchObject({ applied: IDS.length, unknown: 0 });
            await service.flushPendingChanges();
            await service.teardown(h.ctx);
            const restored = await open(h.ctx);
            const document = restored.getDocumentIfLoaded("ja")!;
            expect(Object.getPrototypeOf(document.units)).toBe(Object.prototype);
            for (const [index, id] of IDS.entries()) {
                expect(Object.hasOwn(document.units, id)).toBe(true);
                expect(document.units[id].target).toBe(`訳文${index}`);
            }
            const exported = buildTranslationExchangeRows(
                ROWS.map(row => ({ unitId: row.unitId, sourceText: row.source, context: row.context })),
                document,
            );
            const again = parseTranslationExchange(format, serializeTranslationExchange(format, {
                sourceLocale: "en", targetLocale: "ja", rows: exported,
            }));
            expect(again.rows.map(row => [row.unitId, row.target])).toEqual(ROWS.map(row => [row.unitId, row.target]));
            await restored.teardown(h.ctx);
        });
    }

    it("updates, adopts, removes, and applies live edits by own unit id", async () => {
        const h = harness();
        const service = await open(h.ctx);
        service.updateUnit("ja", "__proto__", "Source", { target: "First" });
        service.adoptUnits("ja", Object.fromEntries([
            ["constructor", { target: "Second", sourceHash: "hash", status: "translated" }],
            ["toString", { target: "Third", sourceHash: "hash", status: "translated" }],
        ]));
        expect(IDS.slice(0, 3).map(id => Object.hasOwn(service.unitsOf("ja")!, id))).toEqual([true, true, true]);

        service.applyLiveOp({ op: "set-translation", locale: "ja", unitId: "__proto__", unit: {
            target: "Live", sourceHash: "hash", status: "translated",
        } });
        expect(service.unitsOf("ja")!["__proto__"].target).toBe("Live");
        service.applyUnitEdits("ja", { set: {}, remove: ["__proto__", "constructor"] });
        expect(Object.hasOwn(service.unitsOf("ja")!, "__proto__")).toBe(false);
        expect(Object.hasOwn(service.unitsOf("ja")!, "constructor")).toBe(false);
        expect(Object.hasOwn(service.unitsOf("ja")!, "toString")).toBe(true);
        await service.flushPendingChanges();
        await service.teardown(h.ctx);
    });

    it("reports a repeated identical special id as unchanged", async () => {
        const h = harness();
        const service = await open(h.ctx);
        const row = ROWS[0];
        const summary = service.applyImportedRows("ja", [row, row], new Map([[row.unitId, row.source]]));
        expect(summary).toMatchObject({ applied: 1, unchanged: 1 });
        await service.flushPendingChanges();
        await service.teardown(h.ctx);
    });

    it("saves a later imported edit when an earlier write is still in flight", async () => {
        const h = harness();
        const service = await open(h.ctx);
        let release!: () => void;
        let announce!: () => void;
        const waiting = new Promise<void>(resolve => { release = resolve; });
        const started = new Promise<void>(resolve => { announce = resolve; });
        h.pauseNextWrite(async () => { announce(); await waiting; });
        const row = ROWS[0];
        const sources = new Map([[row.unitId, row.source]]);
        service.applyImportedRows("ja", [row], sources);
        const saving = service.flushPendingChanges();
        await started;
        service.applyImportedRows("ja", [{ ...row, target: "Later" }], sources);
        release();
        await saving;
        await service.flushPendingChanges();
        await service.teardown(h.ctx);

        const restored = await open(h.ctx);
        expect(restored.unitsOf("ja")![row.unitId].target).toBe("Later");
        await restored.teardown(h.ctx);
    });

    it("saves a later named-key edit when an earlier write is still in flight", async () => {
        const h = harness();
        const service = await open(h.ctx);
        await service.loadKeys();
        let release!: () => void;
        let announce!: () => void;
        const waiting = new Promise<void>(resolve => { release = resolve; });
        const started = new Promise<void>(resolve => { announce = resolve; });
        h.pauseNextWrite(async () => { announce(); await waiting; });
        service.setKey("Title", { sourceText: "First" });
        const saving = service.flushPendingChanges();
        await started;
        service.setKey("Title", { sourceText: "Later" });
        release();
        await saving;
        await service.flushPendingChanges();
        await service.teardown(h.ctx);

        const restored = await open(h.ctx);
        expect((await restored.loadKeys()).keys.Title.sourceText).toBe("Later");
        await restored.teardown(h.ctx);
    });
});
