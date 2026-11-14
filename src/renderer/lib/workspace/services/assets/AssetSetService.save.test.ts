import { afterEach, describe, expect, it, vi } from "vitest";
import { FsRejectErrorCode } from "@shared/types/os";
import { join } from "@shared/utils/path";
import { Services, type WorkspaceContext } from "../services";
import { HistoryService } from "../history/HistoryService";
import { AssetSetService } from "./AssetSetService";
import { AssetType } from "./assetTypes";

const ROOT = join("D:/projects", "my-game");
const DOCUMENT = join(ROOT, "editor", "asset-sets.json");

afterEach(() => vi.useRealTimers());

describe("AssetSetService saves", () => {
    it("preserves and saves an edit made while an earlier write is in flight", async () => {
        vi.useFakeTimers();
        const files = new Map<string, string>();
        let releaseWrite!: () => void;
        let writeStarted!: () => void;
        const started = new Promise<void>(resolve => { writeStarted = resolve; });
        const blocked = new Promise<void>(resolve => { releaseWrite = resolve; });
        let writes = 0;
        let nextId = 0;
        const registry: Record<string, unknown> = {
            [Services.FileSystem]: {
                read: async () => ({ ok: false, error: { code: FsRejectErrorCode.NOT_FOUND, message: "missing" } }),
                createDir: async () => ({ ok: true, data: undefined }),
                writeFileNoFollowOrCreate: async (path: string, text: string) => {
                    if (++writes === 1) {
                        writeStarted();
                        await blocked;
                    }
                    files.set(path, text);
                    return { ok: true, data: undefined };
                },
            },
            [Services.Project]: {},
            [Services.Uuid]: { generate: () => `set-${++nextId}` },
            [Services.SaveStatus]: { register: () => undefined },
            [Services.History]: new HistoryService(),
        };
        const context = {
            project: { getConfig: () => ({ projectPath: ROOT }) },
            services: { get: (id: string) => registry[id] },
        } as unknown as WorkspaceContext;
        const service = new AssetSetService();
        await service.initialize(context, async () => undefined);

        service.createSet({ name: "First", type: AssetType.Image });
        const firstSave = service.flushPendingChanges();
        await started;
        service.createSet({ name: "Second", type: AssetType.Image });
        releaseWrite();
        await firstSave;

        expect(service.listSets().map(set => set.name)).toEqual(["First", "Second"]);
        expect(service.isDirty()).toBe(true);
        await service.flushPendingChanges();
        expect(JSON.parse(files.get(DOCUMENT)!).sets.map((set: { name: string }) => set.name))
            .toEqual(["First", "Second"]);
        expect(service.isDirty()).toBe(false);
    });
});
