import { describe, expect, it, vi } from "vitest";
import { FsRejectErrorCode, type FsRequestResult } from "@shared/types/os";
import { join } from "@shared/utils/path";
import { Services, type WorkspaceContext } from "../services";
import { VariableRegistryService } from "./VariableRegistryService";

/**
 * The service end of H2b: reads go through `loadDocument`, writes through `saveDocument`, and the
 * canonical encoder is strict about the two things `JSON.stringify` used to swallow - an optional
 * field holding `undefined`, and a file that could not be parsed.
 */

const ROOT = join("D:/projects", "my-game");
const DOCUMENT = join(ROOT, "editor", "variables.json");

type Harness = {
    service: VariableRegistryService;
    files: Map<string, string>;
    unreadable: ReturnType<typeof vi.fn>;
};

async function createHarness(seed?: string, reuse?: VariableRegistryService): Promise<Harness> {
    const files = new Map<string, string>();
    if (seed !== undefined) {
        files.set(DOCUMENT, seed);
    }
    const unreadable = vi.fn();
    let nextId = 0;

    const ok = <T,>(data: T): FsRequestResult<T> => ({ ok: true, data });
    const stubs: Record<string, unknown> = {
        [Services.FileSystem]: {
            read: async (path: string) => {
                const value = files.get(path);
                return value === undefined
                    ? { ok: false, error: { code: FsRejectErrorCode.NOT_FOUND, message: "missing" } }
                    : ok(value);
            },
            write: async (path: string, data: string) => {
                files.set(path, data);
                return ok(undefined);
            },
            createDir: async () => ok(undefined),
            copyFile: async (src: string, dest: string) => {
                files.set(dest, files.get(src) ?? "");
                return ok(undefined);
            },
        },
        [Services.Project]: {},
        [Services.Uuid]: { generate: () => `var-${++nextId}` },
        [Services.UIGraph]: { consumeLegacyPersistentVariables: () => null },
        [Services.SaveStatus]: { register: () => undefined, reportUnreadableDocument: unreadable },
    };

    const ctx = {
        project: { getConfig: () => ({ projectPath: ROOT }) },
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

    // No `setContext` first: `initializeFresh` sets it, and pre-setting it makes `initialize`
    // short-circuit for a service that is already initialized - i.e. exactly the project-switch
    // case one of these tests is about.
    const service = reuse ?? new VariableRegistryService();
    await service.initialize(ctx, async () => undefined);

    return { service, files, unreadable };
}

describe("VariableRegistryService document adoption", () => {
    it("creates the registry on first open, in canonical form", async () => {
        const { files } = await createHarness();

        expect(files.get(DOCUMENT)).toMatch(/^\{\n {2}"entries": \{\},\n/);
        expect(files.get(DOCUMENT)?.endsWith("\n")).toBe(true);
    });

    /**
     * The regression the milestone was warned about. A variable created without a default used to
     * carry `defaultValue: undefined`; `JSON.stringify` dropped it in silence, and the canonical
     * encoder refuses the whole document by name - so the first variable an author created would
     * have been the one that stopped their project saving.
     */
    it("saves a variable that has no default", async () => {
        const { service, files } = await createHarness();

        const entry = service.createEntry("persistent", { name: "Gold", valueType: "number" });
        await service.flushPendingChanges();

        expect("defaultValue" in entry).toBe(false);
        expect(files.get(DOCUMENT)).toContain("\"name\": \"Gold\"");
        expect(files.get(DOCUMENT)).not.toContain("defaultValue");
    });

    it("saves a variable whose default was explicitly cleared", async () => {
        const { service, files } = await createHarness();

        const entry = service.createEntry("persistent", { name: "Gold", valueType: "number", defaultValue: 100 });
        await service.flushPendingChanges();
        expect(files.get(DOCUMENT)).toContain("\"defaultValue\": 100");

        service.setEntryDefault(entry.id, undefined);
        await service.flushPendingChanges();

        expect(files.get(DOCUMENT)).not.toContain("defaultValue");
        expect("defaultValue" in service.getEntry(entry.id)!).toBe(false);
    });

    it("writes keys in code-unit order rather than in the order the entry was built", async () => {
        const { service, files } = await createHarness();

        service.createEntry("persistent", { name: "Gold", valueType: "number" });
        await service.flushPendingChanges();

        // The literal is assembled `{id, storageKey, name, scope, valueType}`; the bytes have to read
        // `id, name, scope, storageKey, valueType`, or a document rebuilt through a different code
        // path would land as a whole-file diff.
        const text = files.get(DOCUMENT) ?? "";
        expect(text.indexOf("\"name\"")).toBeLessThan(text.indexOf("\"scope\""));
        expect(text.indexOf("\"scope\"")).toBeLessThan(text.indexOf("\"storageKey\""));
        expect(text.indexOf("\"storageKey\"")).toBeLessThan(text.indexOf("\"valueType\""));
    });

    /**
     * The registry holds both project scopes, and they are backed by different stores. A caller that
     * asks for one must never be handed the other's entries.
     */
    describe("scope", () => {
        it("keeps the two scopes apart when listing, and leaves the unscoped listing whole", async () => {
            const { service } = await createHarness();

            const persistent = service.createEntry("persistent", { name: "Gold" });
            const saved = service.createEntry("saved", { name: "Route Flag" });

            expect(service.listEntries().map(entry => entry.id).sort()).toEqual([persistent.id, saved.id].sort());
            expect(service.listEntriesInScope("persistent").map(entry => entry.id)).toEqual([persistent.id]);
            expect(service.listEntriesInScope("saved").map(entry => entry.id)).toEqual([saved.id]);
        });

        it("names an unnamed variable after its scope, so the two are told apart on sight", async () => {
            const { service } = await createHarness();

            expect(service.createEntry("persistent").name).toMatch(/^persist_/);
            expect(service.createEntry("saved").name).toMatch(/^saved_/);
        });

        it("writes the scope to disk", async () => {
            const { service, files } = await createHarness();

            service.createEntry("saved", { name: "Route Flag" });
            await service.flushPendingChanges();

            expect(files.get(DOCUMENT)).toContain("\"scope\": \"saved\"");
        });
    });

    describe("when the file on disk cannot be read", () => {
        const BROKEN = "{\"entries\": {\"gold\": {\"name\": \"Gold\", \"storageKey\": \"gold\"";

        it("opens the project anyway, and reports the failure where the author can see it", async () => {
            const { service, unreadable } = await createHarness(BROKEN);

            expect(unreadable).toHaveBeenCalledTimes(1);
            expect(unreadable.mock.calls[0][0].path).toBe("editor/variables.json");
            expect(service.listEntries()).toEqual([]);
        });

        it("leaves the original bytes in place and keeps a copy", async () => {
            const { files } = await createHarness(BROKEN);

            expect(files.get(DOCUMENT)).toBe(BROKEN);
            const quarantined = [...files.keys()].filter(path => path.includes("quarantine"));
            expect(quarantined).toHaveLength(1);
            expect(files.get(quarantined[0])).toBe(BROKEN);
        });

        /**
         * The point of the whole exercise. The in-memory registry is empty because the file could
         * not be read, and writing an empty registry over it would turn "unreadable" into "gone".
         */
        it("refuses to write, rather than replacing it with an empty registry", async () => {
            const { service, files } = await createHarness(BROKEN);

            await expect(service.save(service.getRegistry())).rejects.toThrow(/could not be read/);
            await expect(service.flushPendingChanges()).resolves.toBeUndefined();
            expect(files.get(DOCUMENT)).toBe(BROKEN);
        });

        /** These services are singletons, so the refusal has to be per-project, not per-process. */
        it("does not follow the author into the next project they open", async () => {
            const broken = await createHarness(BROKEN);

            const healthy = await createHarness(undefined, broken.service);

            expect(healthy.files.get(DOCUMENT)).toContain("\"entries\"");
            healthy.service.createEntry("persistent", { name: "Gold" });
            await expect(healthy.service.flushPendingChanges()).resolves.toBeUndefined();
        });
    });
});
