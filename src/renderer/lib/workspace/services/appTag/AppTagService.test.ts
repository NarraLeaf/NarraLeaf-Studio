import { describe, expect, it, vi } from "vitest";
import { FsRejectErrorCode, type FsRequestResult } from "@shared/types/os";
import { join } from "@shared/utils/path";
import { APP_TAG_ID_RELEASE, APP_TAG_SCHEMA_VERSION, RELEASE_APP_TAG, type AppTagBaseIdentity } from "@shared/types/appTag";
import type { PluginBuildConfigField } from "@shared/types/plugins";
import { Services, type WorkspaceContext } from "../services";
import { HistoryService } from "../history/HistoryService";
import { projectHistoryScope } from "../history/historyScopes";
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
    /** The real service, not a stub: every mutation is meant to leave a step on the project stack. */
    history: HistoryService;
};

async function createHarness(seed?: string): Promise<Harness> {
    const files = new Map<string, string>();
    if (seed !== undefined) {
        files.set(DOCUMENT, seed);
    }
    const unreadable = vi.fn();
    const history = new HistoryService();
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
        [Services.History]: history,
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

    return { service, files, unreadable, history };
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

    it("names two variants apart when Add is pressed twice with one default name", async () => {
        const { service } = await createHarness();

        const first = service.createTag({ name: "New Variant" });
        const second = service.createTag({ name: "New Variant" });

        expect([first.name, service.getTag(second.id)?.name]).toEqual(["New Variant", "New Variant 2"]);
    });

    it("numbers a rename onto a name already in use instead of leaving two of it", async () => {
        const { service } = await createHarness();
        service.createTag({ name: "Demo" });
        const other = service.createTag({ name: "Bonus" });

        expect(service.renameTag(other.id, "demo")).toBe(true);
        // Case-insensitive, because that is how every surface resolves a name.
        expect(service.getTag(other.id)?.name).toBe("demo 2");
    });

    it("refuses to let a variant take the release tag's name", async () => {
        const { service } = await createHarness();

        const created = service.createTag({ name: RELEASE_APP_TAG.name });

        expect(service.getTag(created.id)?.name).toBe(`${RELEASE_APP_TAG.name} 2`);
    });

    it("lets a rename keep its own name, rather than numbering a variant against itself", async () => {
        const { service } = await createHarness();
        const created = service.createTag({ name: "Demo" });

        expect(service.renameTag(created.id, "Demo")).toBe(true);
        expect(service.getTag(created.id)?.name).toBe("Demo");
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

/**
 * Plugin build config through the service: where a value lands is the field's scope's business, and
 * the two records - the project's and the variant's - are written, cleared and saved as one document.
 */
const buildField = (
    key: string,
    scope: PluginBuildConfigField["scope"],
    type: PluginBuildConfigField["type"] = "text",
): PluginBuildConfigField => ({
    pluginId: "acme.steam",
    pluginName: "Steam",
    key,
    label: key,
    type,
    scope,
});

describe("AppTagService plugin config", () => {
    it("writes a global field on the project whatever variant is selected", async () => {
        const { service, files } = await createHarness();
        const demo = service.createTag({ name: "Demo" });

        expect(service.setPluginConfigValue(demo.id, buildField("appId", "global"), " 480 ")).toBe(true);
        await service.flushPendingChanges();

        expect(service.getProjectPluginConfig()).toEqual({ "acme.steam": { appId: "480" } });
        expect(service.getVariantPluginConfig(demo.id)).toEqual({});
        expect(JSON.parse(files.get(DOCUMENT)!).pluginConfig).toEqual({ "acme.steam": { appId: "480" } });
    });

    it("writes a variant field on the variant, and on the project under the release tag", async () => {
        const { service } = await createHarness();
        const demo = service.createTag({ name: "Demo" });
        const field = buildField("branch", "variant");

        service.setPluginConfigValue(APP_TAG_ID_RELEASE, field, "default");
        service.setPluginConfigValue(demo.id, field, "beta");

        expect(service.resolvePluginConfigValue(APP_TAG_ID_RELEASE, field))
            .toEqual({ value: "default", overridden: false });
        expect(service.resolvePluginConfigValue(demo.id, field)).toEqual({ value: "beta", overridden: true });
    });

    it("keys a platform-scoped field per platform", async () => {
        const { service } = await createHarness();
        const field = buildField("depot", "platform");

        service.setPluginConfigValue(null, field, "1001", "windows");

        expect(service.getProjectPluginConfig()).toEqual({ "acme.steam": { "depot@windows": "1001" } });
        expect(service.resolvePluginConfigValue(null, field, "windows"))
            .toEqual({ value: "1001", overridden: false });
        expect(service.resolvePluginConfigValue(null, field, "linux")).toEqual({ value: "", overridden: false });
    });

    it("clears by deleting, so the variant inherits again", async () => {
        const { service } = await createHarness();
        const demo = service.createTag({ name: "Demo" });
        const field = buildField("branch", "variant");
        service.setPluginConfigValue(null, field, "default");
        service.setPluginConfigValue(demo.id, field, "beta");

        // A blank value is the same act as clearing: "" is not a value a build can ship with.
        expect(service.setPluginConfigValue(demo.id, field, "  ")).toBe(true);

        expect(service.resolvePluginConfigValue(demo.id, field)).toEqual({ value: "default", overridden: false });
        expect(service.getVariantPluginConfig(demo.id)).toEqual({});
    });

    it("leaves no empty record behind when the last value goes", async () => {
        const { service, files } = await createHarness();
        const field = buildField("appId", "global");
        service.setPluginConfigValue(null, field, "480");
        await service.flushPendingChanges();

        service.clearPluginConfigValue(null, field);
        await service.flushPendingChanges();

        expect(service.getProjectPluginConfig()).toEqual({});
        expect(JSON.parse(files.get(DOCUMENT)!)).not.toHaveProperty("pluginConfig");
    });

    it("sweeps a variant entry for a field the project owns", async () => {
        const stored = JSON.stringify({
            schemaVersion: APP_TAG_SCHEMA_VERSION,
            tags: [{ id: "demo", name: "Demo", overrides: {}, pluginConfig: { "acme.steam": { appId: "999" } } }],
        });
        const { service } = await createHarness(stored);
        const field = buildField("appId", "global");

        // The scope arrives with the write, which is the only moment the service can know it. Until
        // then the stray entry is inert - resolution never reads it - but it is not left behind.
        service.setPluginConfigValue("demo", field, "480");

        expect(service.getVariantPluginConfig("demo")).toEqual({});
        expect(service.resolvePluginConfigValue("demo", field)).toEqual({ value: "480", overridden: false });
    });

    it("keeps the values of a plugin that is not installed here", async () => {
        const stored = JSON.stringify({
            schemaVersion: APP_TAG_SCHEMA_VERSION,
            tags: [{ id: "demo", name: "Demo", overrides: {}, pluginConfig: { "acme.absent": { token: "kept" } } }],
            pluginConfig: { "acme.absent": { license: "kept" } },
        });
        const { service, files } = await createHarness(stored);

        service.setPluginConfigValue("demo", buildField("branch", "variant"), "beta");
        await service.flushPendingChanges();

        const written = JSON.parse(files.get(DOCUMENT)!);
        expect(written.pluginConfig).toEqual({ "acme.absent": { license: "kept" } });
        expect(written.tags[0].pluginConfig).toEqual({
            "acme.absent": { token: "kept" },
            "acme.steam": { branch: "beta" },
        });
    });

    it("refuses a variant that does not exist", async () => {
        const { service } = await createHarness();

        expect(service.setPluginConfigValue("no-such-tag", buildField("branch", "variant"), "beta")).toBe(false);
        expect(service.clearAllPluginConfig("no-such-tag")).toBe(false);
        expect(service.clearAllPluginConfig(APP_TAG_ID_RELEASE)).toBe(false);
    });

    it("marks the project dirty when only the project's own record changed", async () => {
        const { service } = await createHarness();
        const revision = service.getRevision();

        service.setPluginConfigValue(null, buildField("appId", "global"), "480");

        expect(service.isDirty()).toBe(true);
        expect(service.getRevision()).toBe(revision + 1);
    });

    it("clears every value a variant states in one act", async () => {
        const { service } = await createHarness();
        const demo = service.createTag({ name: "Demo" });
        service.setPluginConfigValue(demo.id, buildField("branch", "variant"), "beta");
        service.setPluginConfigValue(demo.id, buildField("token", "variant", "secret"), "handle-1");

        expect(service.clearAllPluginConfig(demo.id)).toBe(true);
        expect(service.getVariantPluginConfig(demo.id)).toEqual({});
    });
});

describe("app tag external links", () => {
    it("writes the project's own list at the document root", async () => {
        const { service, files } = await createHarness();

        expect(service.setExternalLinks(null, [" https://example.com/store ", "not a url"])).toBe(true);
        await service.flushPendingChanges();

        expect(service.getProjectExternalLinks()).toEqual(["https://example.com/store"]);
        expect(JSON.parse(files.get(DOCUMENT)!).externalLinks).toEqual(["https://example.com/store"]);
    });

    it("lets a variant state its own list, and restores it by removing the key", async () => {
        const { service, files } = await createHarness();
        service.setExternalLinks(null, ["https://example.com/store"]);
        const demo = service.createTag({ name: "Demo" });

        expect(service.resolveExternalLinks(demo.id))
            .toEqual({ value: ["https://example.com/store"], overridden: false });

        service.setExternalLinks(demo.id, ["https://example.com/store", "https://example.com/full"]);
        expect(service.resolveExternalLinks(demo.id).overridden).toBe(true);
        await service.flushPendingChanges();
        expect(JSON.parse(files.get(DOCUMENT)!).tags[0].externalLinks).toHaveLength(2);

        expect(service.clearExternalLinks(demo.id)).toBe(true);
        expect(service.resolveExternalLinks(demo.id))
            .toEqual({ value: ["https://example.com/store"], overridden: false });
        await service.flushPendingChanges();
        expect(JSON.parse(files.get(DOCUMENT)!).tags[0]).not.toHaveProperty("externalLinks");
    });

    it("keeps a variant that states it opens nothing apart from one that inherits", async () => {
        const { service } = await createHarness();
        service.setExternalLinks(null, ["https://example.com/store"]);
        const demo = service.createTag({ name: "Demo" });

        service.setExternalLinks(demo.id, []);

        expect(service.resolveExternalLinks(demo.id)).toEqual({ value: [], overridden: true });
    });

    it("answers every address any build could open, project and variants together", async () => {
        const { service } = await createHarness();
        service.setExternalLinks(null, ["https://example.com/store"]);
        const demo = service.createTag({ name: "Demo" });
        service.setExternalLinks(demo.id, ["https://example.com/store", "https://example.com/full"]);

        expect(service.listDeclaredExternalLinks())
            .toEqual(["https://example.com/store", "https://example.com/full"]);
    });

    it("refuses a variant that does not exist, and the release tag for a restore", async () => {
        const { service } = await createHarness();

        expect(service.setExternalLinks("no-such-tag", ["https://example.com/"])).toBe(false);
        expect(service.clearExternalLinks(APP_TAG_ID_RELEASE)).toBe(false);
    });
});

describe("app tag ending page", () => {
    it("writes the project's own page at the document root", async () => {
        const { service, files } = await createHarness();

        expect(service.setEndingSurface(null, " surface-credits ")).toBe(true);
        await service.flushPendingChanges();

        expect(service.getProjectEndingSurfaceId()).toBe("surface-credits");
        expect(JSON.parse(files.get(DOCUMENT)!).endingSurfaceId).toBe("surface-credits");
    });

    it("lets a variant state its own page, and restores it by removing the key", async () => {
        const { service, files } = await createHarness();
        service.setEndingSurface(null, "surface-credits");
        const demo = service.createTag({ name: "Demo" });

        expect(service.resolveEndingSurface(demo.id))
            .toEqual({ value: "surface-credits", overridden: false });

        service.setEndingSurface(demo.id, "surface-thanks");
        expect(service.resolveEndingSurface(demo.id))
            .toEqual({ value: "surface-thanks", overridden: true });
        await service.flushPendingChanges();
        expect(JSON.parse(files.get(DOCUMENT)!).tags[0].endingSurfaceId).toBe("surface-thanks");

        expect(service.clearEndingSurface(demo.id)).toBe(true);
        expect(service.resolveEndingSurface(demo.id))
            .toEqual({ value: "surface-credits", overridden: false });
        await service.flushPendingChanges();
        expect(JSON.parse(files.get(DOCUMENT)!).tags[0]).not.toHaveProperty("endingSurfaceId");
    });

    it("keeps a variant that states it shows nothing apart from one that inherits", async () => {
        const { service, files } = await createHarness();
        service.setEndingSurface(null, "surface-credits");
        const demo = service.createTag({ name: "Demo" });

        service.setEndingSurface(demo.id, "");

        expect(service.resolveEndingSurface(demo.id)).toEqual({ value: "", overridden: true });
        await service.flushPendingChanges();
        expect(JSON.parse(files.get(DOCUMENT)!).tags[0].endingSurfaceId).toBe("");
    });

    it("removes the project's key when the project picks no page", async () => {
        const { service, files } = await createHarness();
        service.setEndingSurface(null, "surface-credits");

        service.setEndingSurface(null, "");
        await service.flushPendingChanges();

        expect(service.getProjectEndingSurfaceId()).toBe("");
        expect(JSON.parse(files.get(DOCUMENT)!)).not.toHaveProperty("endingSurfaceId");
    });

    it("refuses a variant that does not exist, and the release tag for a restore", async () => {
        const { service } = await createHarness();

        expect(service.setEndingSurface("no-such-tag", "surface-credits")).toBe(false);
        expect(service.clearEndingSurface(APP_TAG_ID_RELEASE)).toBe(false);
    });
});

/**
 * Deleting a variant strands every reference to it - they resolve to release from then on - and the
 * confirmation used to be the only thing standing in front of that.
 */
describe("build variant undo", () => {
    it("puts a deleted variant back with its overrides", async () => {
        const { service, history } = await createHarness();
        const tag = service.createTag({ name: "Demo" });
        service.setOverride(tag.id, "displayName", "My Game Demo");

        service.deleteTag(tag.id);
        expect(service.getTag(tag.id)).toBeUndefined();

        expect(history.undo(projectHistoryScope())).toBe(true);
        expect(service.getTag(tag.id)?.name).toBe("Demo");
        expect(service.resolveIdentity(tag.id, BASE).displayName.value).toBe("My Game Demo");
    });

    it("undoes an override without undoing the variant that carries it", async () => {
        const { service, history } = await createHarness();
        const tag = service.createTag({ name: "Demo" });
        service.setOverride(tag.id, "displayName", "My Game Demo");

        history.undo(projectHistoryScope());

        expect(service.getTag(tag.id)?.name).toBe("Demo");
        // Back to inheriting, which is the absence of the key rather than a copy of the base value.
        expect(service.listOverriddenKeys(tag.id)).toEqual([]);
        expect(service.resolveIdentity(tag.id, BASE).displayName.value).toBe("My Game");
    });

    it("names the step it would undo", async () => {
        const { service, history } = await createHarness();
        const tag = service.createTag({ name: "Demo" });
        service.deleteTag(tag.id);

        expect(history.peekUndo(projectHistoryScope())).toEqual({
            key: "project.appTags.history.delete",
            params: { name: "Demo" },
        });
    });
});
