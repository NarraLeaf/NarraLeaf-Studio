import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Services } from "../services";
import { UIDocumentService } from "./UIDocumentService";
import { UIGraphService } from "./UIGraphService";

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({}),
    getPrivilegedInterface: () => ({ fs: {} }),
}));

type DocumentService = UIDocumentService | UIGraphService;

function harness(kind: "interface" | "blueprint") {
    let disk = "";
    const writes: Array<{ data: string; finish: () => void }> = [];
    const filesystem = {
        isDirExists: async () => ({ ok: true, data: true }),
        writeFileNoFollowOrCreate: (_path: string, data: string) => new Promise(resolve => {
            writes.push({ data, finish: () => { disk = data; resolve({ ok: true }); } });
        }),
    };
    const service: DocumentService = kind === "interface" ? new UIDocumentService() : new UIGraphService();
    let id = 0;
    service.setContext({
        project: {
            resolve: (...parts: (string | string[])[]) => ["/project", ...parts.flat()].join("/"),
            getProjectConfig: () => ({ metadata: { resolution: { width: 1280, height: 720 } } }),
        },
        services: {
            get: (key: Services) => {
                if (key === Services.FileSystem) return filesystem;
                if (key === Services.Uuid) return { generate: () => `id-${++id}` };
                if (key === Services.Project) return { getProjectConfig: () => ({ metadata: { resolution: { width: 1280, height: 720 } } }) };
                throw new Error(`Unexpected service ${key}`);
            },
        },
    } as never);
    const internals = service as never as { document: unknown; createEmptyDocument: () => unknown };
    internals.document = internals.createEmptyDocument();

    function edit(name: string) {
        if (service instanceof UIDocumentService) {
            service.restoreDocumentFromHistory({ ...service.getDocument(), name });
        } else {
            service.applyGraphMutation(doc => {
                const blueprint = Object.values(doc.blueprintDocument.blueprints)[0];
                blueprint.name = name;
            });
        }
    }
    function nameOf(document: any): string {
        return kind === "interface"
            ? document.name
            : (Object.values(document.blueprintDocument.blueprints)[0] as { name: string }).name;
    }
    function save() {
        return service instanceof UIDocumentService
            ? service.save(service.getDocument())
            : service.save(service.getDocument());
    }
    return { service, writes, edit, nameOf, save, disk: () => disk };
}

async function settleMicrotasks() {
    for (let i = 0; i < 20; i++) await Promise.resolve();
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe.each(["interface", "blueprint"] as const)("%s document writes", kind => {
    it("keeps an edit made during a save dirty and writes it on flush", async () => {
        const h = harness(kind);
        h.edit("first");
        const saving = h.save();
        await settleMicrotasks();
        h.edit("second");
        h.writes[0].finish();
        await saving;
        const currentAfterSave = h.nameOf(h.service.getDocument());
        const dirtyAfterSave = h.service.isDirty();

        const flushing = h.service.flushPendingChanges();
        await settleMicrotasks();
        h.writes[1]?.finish();
        await flushing;

        expect(currentAfterSave).toBe("second");
        expect(dirtyAfterSave).toBe(true);
        expect(h.nameOf(JSON.parse(h.disk()))).toBe("second");
        expect(h.service.isDirty()).toBe(false);
    });

    it("keeps the latest save on disk when two manual saves overlap", async () => {
        const h = harness(kind);
        h.edit("first");
        const first = h.save();
        await settleMicrotasks();
        h.edit("second");
        const second = h.save();
        await settleMicrotasks();

        if (h.writes.length > 1) {
            h.writes[1].finish();
            await second;
            h.writes[0].finish();
            await first;
        } else {
            h.writes[0].finish();
            await first;
            await settleMicrotasks();
            h.writes[1].finish();
            await second;
        }

        expect(h.nameOf(JSON.parse(h.disk()))).toBe("second");
        expect(h.nameOf(h.service.getDocument())).toBe("second");
    });

    it("joins a manual write when the workspace flushes", async () => {
        const h = harness(kind);
        h.edit("first");
        const saving = h.save();
        await settleMicrotasks();
        let flushed = false;
        const flushing = h.service.flushPendingChanges().then(() => { flushed = true; });
        await settleMicrotasks();
        const flushedBeforeWrite = flushed;
        h.writes[0].finish();
        await Promise.all([saving, flushing]);

        expect(flushedBeforeWrite).toBe(false);
        expect(h.writes).toHaveLength(1);
        expect(h.nameOf(JSON.parse(h.disk()))).toBe("first");
    });
});
