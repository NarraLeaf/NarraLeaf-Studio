import { describe, expect, it, vi } from "vitest";
import { FsRejectErrorCode, type FsRequestResult } from "@shared/types/os";
import { join } from "@shared/utils/path";
import { APP_TAG_ID_RELEASE, APP_TAG_SCHEMA_VERSION, type AppTagBaseIdentity } from "@shared/types/appTag";
import { Services, type WorkspaceContext } from "../services";
import { AppTagService } from "./AppTagService";

/**
 * The service end of build variants: reads through `loadDocument`, writes through `saveDocument`,
 * absent until the first variant, and the same "refuse to write over a file we could not read" latch
 * every adopted document service carries.
 */

const ROOT = join("D:/projects", "my-game");
const DOCUMENT = join(ROOT, "editor", "app-tags.json");

const BASE: AppTagBaseIdentity = {
    displayName: "My Game",
    identifier: "com.example.mygame",
    version: "1.0.0",
};

type Harness = {
    service: AppTagService;
    files: Map<string, string>;
    unreadable: ReturnType<typeof vi.fn>;
};

async function createHarness(seed?: string): Promise<Harness> {
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
        [Services.Uuid]: { generate: () => `tag-${++nextId}` },
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

    const service = new AppTagService();
    await service.initialize(ctx, async () => undefined);

    return { service, files, unreadable };
}

const ids = (service: AppTagService): string[] => service.listTags().map(tag => tag.id);

describe("AppTagService", () => {
    it("opens a project that has never heard of tags without writing anything", async () => {
        const { service, files } = await createHarness();

        expect(ids(service)).toEqual([APP_TAG_ID_RELEASE]);
        // Opening a project is not a change to it: the release tag is not stored, so an empty list on
        // disk would say nothing that absence does not already say.
        expect(files.has(DOCUMENT)).toBe(false);
        expect(service.isDirty()).toBe(false);
    });

    it("resolves to the release tag on a project with no document", async () => {
        const { service } = await createHarness();

        expect(service.resolveTag("anything").id).toBe(APP_TAG_ID_RELEASE);
        expect(service.hasTag(APP_TAG_ID_RELEASE)).toBe(true);
        expect(service.hasTag("anything")).toBe(false);
        expect(service.resolveIdentity(null, BASE).displayName).toEqual({ value: "My Game", overridden: false });
    });

    it("creates a variant that inherits everything until it says otherwise", async () => {
        const { service, files } = await createHarness();

        const created = service.createTag({ name: "Demo" });
        await service.flushPendingChanges();

        expect(ids(service)).toEqual([APP_TAG_ID_RELEASE, created.id]);
        expect(created.overrides).toEqual({});
        expect(service.resolveIdentity(created.id, BASE)).toEqual({
            displayName: { value: "My Game", overridden: false },
            identifier: { value: "com.example.mygame", overridden: false },
            version: { value: "1.0.0", overridden: false },
        });
        const text = files.get(DOCUMENT) ?? "";
        expect(text).toContain(`"schemaVersion": ${APP_TAG_SCHEMA_VERSION}`);
        expect(text).toContain("\"Demo\"");
        expect(text.endsWith("\n")).toBe(true);
    });

    it("round-trips an override and restores it by removing the key", async () => {
        const { service, files } = await createHarness();
        const created = service.createTag({ name: "Demo" });

        service.setOverride(created.id, "displayName", "My Game Demo");
        expect(service.resolveIdentity(created.id, BASE).displayName)
            .toEqual({ value: "My Game Demo", overridden: true });
        expect(service.listOverriddenKeys(created.id)).toEqual(["displayName"]);

        await service.flushPendingChanges();
        expect(files.get(DOCUMENT)).toContain("My Game Demo");

        service.clearOverride(created.id, "displayName");
        await service.flushPendingChanges();

        expect(service.getTag(created.id)?.overrides).toEqual({});
        // Restored by deletion, so the value is not carried in the file under any spelling.
        expect(files.get(DOCUMENT)).not.toContain("My Game Demo");
        expect(service.resolveIdentity(created.id, BASE).displayName)
            .toEqual({ value: "My Game", overridden: false });
    });

    it("treats a blank override as a restore rather than shipping an empty value", async () => {
        const { service } = await createHarness();
        const created = service.createTag({ name: "Demo" });

        service.setOverride(created.id, "version", "1.1.0");
        service.setOverride(created.id, "version", "   ");

        expect(service.getTag(created.id)?.overrides).toEqual({});
    });

    it("follows references through a rename, because they hold the id", async () => {
        const { service } = await createHarness();
        const created = service.createTag({ name: "Demo" });
        service.setOverride(created.id, "identifier", "com.example.mygame.demo");

        expect(service.renameTag(created.id, "Trial")).toBe(true);

        // The id every stored reference holds is unchanged, so resolution and the overrides it
        // carries are untouched by the rename.
        expect(created.id).toBe(service.getTag(created.id)?.id);
        expect(service.resolveTag(created.id).name).toBe("Trial");
        expect(service.resolveIdentity(created.id, BASE).identifier)
            .toEqual({ value: "com.example.mygame.demo", overridden: true });
    });

    it("refuses a blank rename rather than storing one", async () => {
        const { service } = await createHarness();
        const created = service.createTag({ name: "Demo" });

        expect(service.renameTag(created.id, "   ")).toBe(false);
        expect(service.getTag(created.id)?.name).toBe("Demo");
    });

    it("refuses to rename, override or delete the release tag", async () => {
        const { service } = await createHarness();

        expect(service.renameTag(APP_TAG_ID_RELEASE, "Shipping")).toBe(false);
        expect(service.setOverride(APP_TAG_ID_RELEASE, "version", "9.9.9")).toBe(false);
        expect(service.deleteTag(APP_TAG_ID_RELEASE)).toBe(false);
        expect(ids(service)).toEqual([APP_TAG_ID_RELEASE]);
    });

    it("deletes a variant and leaves its references resolving to release", async () => {
        const { service } = await createHarness();
        const created = service.createTag({ name: "Demo" });

        expect(service.deleteTag(created.id)).toBe(true);
        expect(ids(service)).toEqual([APP_TAG_ID_RELEASE]);
        expect(service.hasTag(created.id)).toBe(false);
        expect(service.resolveTag(created.id).id).toBe(APP_TAG_ID_RELEASE);
    });

    it("reads a stored list back with its overrides", async () => {
        const stored = JSON.stringify({
            schemaVersion: APP_TAG_SCHEMA_VERSION,
            tags: [{ id: "demo", name: "Demo", overrides: { displayName: "My Game Demo" } }],
        });
        const { service } = await createHarness(stored);

        expect(ids(service)).toEqual([APP_TAG_ID_RELEASE, "demo"]);
        expect(service.resolveIdentity("demo", BASE).displayName)
            .toEqual({ value: "My Game Demo", overridden: true });
    });

    it("still answers the release tag when the document cannot be read, and refuses to write", async () => {
        const { service, unreadable } = await createHarness("{ not json");

        expect(unreadable).toHaveBeenCalled();
        expect(ids(service)).toEqual([APP_TAG_ID_RELEASE]);
        expect(service.resolveTag("demo").id).toBe(APP_TAG_ID_RELEASE);
        await expect(service.save(service.getDocument())).rejects.toThrow(/could not be read/);
    });
});
