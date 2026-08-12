import { describe, expect, it } from "vitest";
import {
    APP_TAG_ID_RELEASE,
    APP_TAG_SCHEMA_VERSION,
    appTagMechanismKey,
    countAppTagReferences,
    findAppTagByName,
    hasAppTag,
    hasAppTagReachableScenes,
    isExternalLinkDeclared,
    listAppTags,
    migrateProjectAppTagDocument,
    normalizeAppTagExternalLinks,
    normalizeAppTagPluginConfig,
    normalizeAppTagReachableScenes,
    normalizeExternalLinkUrl,
    normalizeProjectAppTags,
    resolveAppTag,
    resolveAppTagExternalLinks,
    resolveAppTagIdentity,
    resolveAppTagPluginConfigValue,
    resolveAppTagReachableScenes,
    uniqueAppTagName,
    variantStorablePluginConfig,
    type AppTagBaseIdentity,
    type ProjectAppTag,
} from "./appTag";
import type { PluginBuildConfigField } from "./plugins";

/**
 * The model half of build variants: what a stored list is allowed to say, what a tag resolves to,
 * and what a tag reads for a key it does not state.
 */

const BASE: AppTagBaseIdentity = {
    displayName: "My Game",
    identifier: "com.example.mygame",
    version: "1.0.0",
};

const tag = (id: string, overrides: ProjectAppTag["overrides"] = {}): ProjectAppTag => ({
    id,
    name: id,
    overrides,
});

describe("app tag list", () => {
    it("answers the release tag in a project that has never heard of tags", () => {
        expect(listAppTags([])).toEqual([expect.objectContaining({ id: APP_TAG_ID_RELEASE, builtin: true })]);
        expect(hasAppTag([], APP_TAG_ID_RELEASE)).toBe(true);
        expect(resolveAppTag([], undefined).id).toBe(APP_TAG_ID_RELEASE);
    });

    it("resolves an unknown, blank or deleted id to the release tag rather than nothing", () => {
        const stored = [tag("demo")];

        expect(resolveAppTag(stored, "demo").id).toBe("demo");
        expect(resolveAppTag(stored, "gone").id).toBe(APP_TAG_ID_RELEASE);
        expect(resolveAppTag(stored, "   ").id).toBe(APP_TAG_ID_RELEASE);
        expect(resolveAppTag(stored, null).id).toBe(APP_TAG_ID_RELEASE);
    });

    it("refuses a stored release tag, so the synthesized one is the only one", () => {
        const stored = normalizeProjectAppTags([
            { id: APP_TAG_ID_RELEASE, name: "Not the real one" },
            { id: "demo", name: "Demo" },
        ]);

        expect(stored.map(entry => entry.id)).toEqual(["demo"]);
        expect(listAppTags(stored)[0].name).toBe("main");
    });

    it("keeps the first of two entries under one id", () => {
        const stored = normalizeProjectAppTags([
            { id: "demo", name: "Demo" },
            { id: "demo", name: "Demo again" },
        ]);

        expect(stored).toHaveLength(1);
        expect(stored[0].name).toBe("Demo");
    });

    it("drops unknown and blank overrides instead of storing them", () => {
        const stored = normalizeProjectAppTags([
            { id: "demo", name: "Demo", overrides: { displayName: "  ", version: " 1.1.0 ", nonsense: "x" } },
        ]);

        expect(stored[0].overrides).toEqual({ version: "1.1.0" });
    });

    it("reads a document with no tags key as a project with only the release tag", () => {
        const document = migrateProjectAppTagDocument({ schemaVersion: APP_TAG_SCHEMA_VERSION });

        expect(document.tags).toEqual([]);
        expect(listAppTags(document.tags)).toHaveLength(1);
    });

    it("finds a tag by name and reports two of a name rather than picking one", () => {
        const tags = listAppTags([tag("a"), tag("b")]);
        const named = [...tags, { ...tag("c"), name: "a" }];

        expect(findAppTagByName(tags, "A")?.valueOf()).toMatchObject({ id: "a" });
        expect(findAppTagByName(named, "a")).toBe("ambiguous");
        expect(findAppTagByName(tags, "nothing")).toBeNull();
    });
});

describe("app tag names", () => {
    it("answers the desired name when nothing else has it", () => {
        expect(uniqueAppTagName(["main", "Bonus"], "Demo")).toBe("Demo");
    });

    it("numbers from 2, and keeps numbering past the first free-looking one", () => {
        expect(uniqueAppTagName(["Demo"], "Demo")).toBe("Demo 2");
        expect(uniqueAppTagName(["Demo", "Demo 2"], "Demo")).toBe("Demo 3");
    });

    it("matches case-insensitively, because every surface resolves names that way", () => {
        expect(uniqueAppTagName(["demo"], "Demo")).toBe("Demo 2");
    });

    it("keeps a variant off the release name, which is the same word in every language", () => {
        expect(uniqueAppTagName(["main"], "main")).toBe("main 2");
    });

    it("falls back to the release name for a blank request rather than answering blank", () => {
        expect(uniqueAppTagName([], "   ")).toBe("main");
    });
});

describe("app tag inheritance", () => {
    it("reads every key from the project when the tag states nothing", () => {
        const identity = resolveAppTagIdentity(tag("demo"), BASE);

        expect(identity.displayName).toEqual({ value: "My Game", overridden: false });
        expect(identity.identifier).toEqual({ value: "com.example.mygame", overridden: false });
        expect(identity.version).toEqual({ value: "1.0.0", overridden: false });
    });

    it("reads a stated key from the tag and says so", () => {
        const identity = resolveAppTagIdentity(tag("demo", { displayName: "My Game Demo" }), BASE);

        expect(identity.displayName).toEqual({ value: "My Game Demo", overridden: true });
        // Unstated keys are untouched by a stated neighbour.
        expect(identity.version).toEqual({ value: "1.0.0", overridden: false });
    });

    it("follows the project after a key is restored, rather than freezing what was inherited", () => {
        const overridden = tag("demo", { version: "0.9.0-demo" });
        expect(resolveAppTagIdentity(overridden, BASE).version.value).toBe("0.9.0-demo");

        const restored: ProjectAppTag = { ...overridden, overrides: {} };
        const laterBase: AppTagBaseIdentity = { ...BASE, version: "2.0.0" };

        expect(resolveAppTagIdentity(restored, laterBase).version).toEqual({ value: "2.0.0", overridden: false });
    });

    it("gives the release tag the project's own values", () => {
        const identity = resolveAppTagIdentity(listAppTags([])[0], BASE);

        expect(identity.displayName).toEqual({ value: "My Game", overridden: false });
    });
});

describe("app tag references", () => {
    it("counts every stored reference and reports zero for a tag nothing points at", () => {
        const documents = [
            { blocks: [{ payload: { appTagId: "demo" } }, { payload: { appTagId: "demo" } }] },
            { nodes: { a: { params: { appTagId: "bonus" } } } },
        ];

        expect(countAppTagReferences(documents, ["demo", "bonus", "unused"]))
            .toEqual({ demo: 2, bonus: 1, unused: 0 });
    });

    it("ignores a value that names no known tag", () => {
        const documents = [{ payload: { appTagId: "deleted-long-ago" } }];

        expect(countAppTagReferences(documents, ["demo"])).toEqual({ demo: 0 });
    });

    it("does not hang on a document holding a shared sub-object", () => {
        const shared: Record<string, unknown> = { appTagId: "demo" };
        const cyclic: Record<string, unknown> = { shared };
        cyclic.self = cyclic;

        expect(countAppTagReferences([cyclic], ["demo"])).toEqual({ demo: 1 });
    });
});

/**
 * The plugin half: what a stored record may say, what a variant may say it differently, and the
 * one rule that separates the two - a field with a single value for the whole project cannot be
 * stated on a variant, so nothing reads one that is.
 */
const buildField = (
    pluginId: string,
    key: string,
    scope: PluginBuildConfigField["scope"],
): PluginBuildConfigField => ({
    pluginId,
    pluginName: pluginId,
    key,
    label: key,
    type: "text",
    scope,
});

describe("app tag plugin config", () => {
    it("keeps well-formed values and drops what says nothing", () => {
        expect(normalizeAppTagPluginConfig({
            "acme.steam": { appId: " 480 ", blank: "   ", missing: 7 },
            "acme.empty": {},
            "  ": { appId: "1" },
            broken: [],
        })).toEqual({ "acme.steam": { appId: "480" } });
    });

    it("reads an unusable record as empty rather than throwing", () => {
        expect(normalizeAppTagPluginConfig(undefined)).toEqual({});
        expect(normalizeAppTagPluginConfig("nonsense")).toEqual({});
        expect(normalizeAppTagPluginConfig([{ appId: "480" }])).toEqual({});
    });

    it("omits the record entirely when a tag states nothing", () => {
        const normalized = normalizeProjectAppTags([
            { id: "demo", name: "Demo", pluginConfig: { "acme.steam": {} } },
        ]);

        expect(normalized[0].pluginConfig).toBeUndefined();
    });

    it("carries the project's own record through a document migration", () => {
        const document = migrateProjectAppTagDocument({
            schemaVersion: APP_TAG_SCHEMA_VERSION,
            tags: [],
            pluginConfig: { "acme.steam": { appId: "480" } },
        });

        expect(document.pluginConfig).toEqual({ "acme.steam": { appId: "480" } });
    });

    it("leaves a document that predates plugin config without the key", () => {
        const document = migrateProjectAppTagDocument({ schemaVersion: APP_TAG_SCHEMA_VERSION, tags: [] });

        expect(document.pluginConfig).toBeUndefined();
    });

    it("reads a variant's own value, and the project's when it states none", () => {
        const demo: ProjectAppTag = {
            id: "demo",
            name: "Demo",
            overrides: {},
            pluginConfig: { "acme.steam": { branch: "beta" } },
        };
        const base = { "acme.steam": { branch: "default", appId: "480" } };

        expect(resolveAppTagPluginConfigValue(demo, base, buildField("acme.steam", "branch", "variant")))
            .toEqual({ value: "beta", overridden: true });
        expect(resolveAppTagPluginConfigValue(demo, base, buildField("acme.steam", "appId", "variant")))
            .toEqual({ value: "480", overridden: false });
        expect(resolveAppTagPluginConfigValue(demo, base, buildField("acme.steam", "unset", "variant")))
            .toEqual({ value: "", overridden: false });
    });

    it("reads a global field from the project even when the variant holds one", () => {
        const demo: ProjectAppTag = {
            id: "demo",
            name: "Demo",
            overrides: {},
            pluginConfig: { "acme.steam": { appId: "999" } },
        };

        expect(resolveAppTagPluginConfigValue(demo, { "acme.steam": { appId: "480" } }, buildField("acme.steam", "appId", "global")))
            .toEqual({ value: "480", overridden: false });
    });

    it("keys a platform-scoped field per platform", () => {
        const demo: ProjectAppTag = {
            id: "demo",
            name: "Demo",
            overrides: {},
            pluginConfig: { "acme.steam": { "depot@windows": "1001" } },
        };
        const field = buildField("acme.steam", "depot", "variant-platform");

        expect(resolveAppTagPluginConfigValue(demo, {}, field, "windows"))
            .toEqual({ value: "1001", overridden: true });
        expect(resolveAppTagPluginConfigValue(demo, {}, field, "macos"))
            .toEqual({ value: "", overridden: false });
    });

    it("drops a variant entry for a field the project owns, and leaves undeclared keys alone", () => {
        const stored = {
            "acme.steam": { appId: "999", branch: "beta", "depot@windows": "1001" },
            "acme.uninstalled": { anything: "kept" },
        };

        expect(variantStorablePluginConfig(stored, [
            buildField("acme.steam", "appId", "global"),
            buildField("acme.steam", "branch", "variant"),
            buildField("acme.steam", "depot", "platform"),
        ])).toEqual({
            "acme.steam": { branch: "beta" },
            "acme.uninstalled": { anything: "kept" },
        });
    });
});

describe("app tag scene declarations", () => {
    const NODE = appTagMechanismKey({
        kind: "startStoryNode",
        blueprintId: "bp-1",
        graphKind: "event",
        graphId: "ev-1",
        nodeId: "n-1",
    });

    it("keeps well-formed pairs and drops what cannot be one", () => {
        expect(normalizeAppTagReachableScenes({
            [NODE]: [
                { storyId: " story-1 ", sceneId: " scene-1 " },
                { storyId: "story-1", sceneId: "scene-1" },
                { storyId: "story-1", sceneId: "  " },
                { storyId: 7, sceneId: "scene-2" },
                "nonsense",
            ],
            "  ": [{ storyId: "story-1", sceneId: "scene-9" }],
            "plugin:acme.thing": "not a list",
        })).toEqual({ [NODE]: [{ storyId: "story-1", sceneId: "scene-1" }] });
    });

    it("keeps a declared empty list, which is not the same as no declaration", () => {
        // Absent means undeclared and the build stops; empty means the author said this mechanism
        // starts nothing here, and it does not.
        const declared = normalizeAppTagReachableScenes({ [NODE]: [] });

        expect(declared[NODE]).toEqual([]);
        expect(hasAppTagReachableScenes(declared)).toBe(true);
    });

    it("keeps a declaration whose scene the project no longer has", () => {
        // Dropping it would delete the author's answer and turn their next build into a refusal they
        // never asked for. Reporting the stale scene is the surfaces' job, not the normalizer's.
        expect(normalizeAppTagReachableScenes({ [NODE]: [{ storyId: "gone", sceneId: "gone" }] }))
            .toEqual({ [NODE]: [{ storyId: "gone", sceneId: "gone" }] });
    });

    it("reads an unusable record as empty rather than throwing", () => {
        expect(normalizeAppTagReachableScenes(undefined)).toEqual({});
        expect(normalizeAppTagReachableScenes("nonsense")).toEqual({});
        expect(normalizeAppTagReachableScenes([])).toEqual({});
    });

    it("lets a variant replace the project's list rather than adding to it", () => {
        // A demo whose chapter select offers one chapter is stating a smaller set; a union would
        // hand it the chapters it exists to leave out.
        const tag: ProjectAppTag = {
            id: "demo",
            name: "Demo",
            overrides: {},
            reachableScenes: { [NODE]: [{ storyId: "s", sceneId: "chapter-1" }] },
        };
        const base = {
            [NODE]: [
                { storyId: "s", sceneId: "chapter-1" },
                { storyId: "s", sceneId: "chapter-2" },
            ],
            "plugin:acme.thing": [{ storyId: "s", sceneId: "gallery" }],
        };

        expect(resolveAppTagReachableScenes(tag, base)).toEqual({
            [NODE]: [{ storyId: "s", sceneId: "chapter-1" }],
            // Untouched keys stay inherited, which is what "states only what it says differently" means.
            "plugin:acme.thing": [{ storyId: "s", sceneId: "gallery" }],
        });
    });

    it("gives the three mechanism kinds keys that cannot collide", () => {
        const keys = [
            appTagMechanismKey({ kind: "scriptBlueprint", blueprintId: "shared-id" }),
            appTagMechanismKey({ kind: "plugin", pluginId: "shared-id" }),
            NODE,
        ];

        expect(new Set(keys).size).toBe(3);
    });

    it("carries both records through a document migration", () => {
        const document = migrateProjectAppTagDocument({
            schemaVersion: APP_TAG_SCHEMA_VERSION,
            tags: [{ id: "demo", name: "Demo", reachableScenes: { [NODE]: [] } }],
            reachableScenes: { [NODE]: [{ storyId: "s", sceneId: "sc" }] },
        });

        expect(document.reachableScenes).toEqual({ [NODE]: [{ storyId: "s", sceneId: "sc" }] });
        expect(document.tags[0].reachableScenes).toEqual({ [NODE]: [] });
    });

    it("omits the record entirely when nothing is declared", () => {
        const document = migrateProjectAppTagDocument({ schemaVersion: APP_TAG_SCHEMA_VERSION, tags: [] });

        expect(document.reachableScenes).toBeUndefined();
        expect(normalizeProjectAppTags([{ id: "demo", name: "Demo", reachableScenes: {} }])[0].reachableScenes)
            .toBeUndefined();
    });
});

describe("app tag external links", () => {
    it("keeps absolute http and https entries in the form a match compares", () => {
        expect(normalizeAppTagExternalLinks([
            " https://store.example.com/app/480 ",
            "http://example.com",
        ])).toEqual(["https://store.example.com/app/480", "http://example.com/"]);
    });

    it("refuses anything that is not an absolute web address", () => {
        expect(normalizeExternalLinkUrl("file:///C:/secrets.txt")).toBeNull();
        expect(normalizeExternalLinkUrl("javascript:alert(1)")).toBeNull();
        expect(normalizeExternalLinkUrl("app://asset/1")).toBeNull();
        expect(normalizeExternalLinkUrl("/app/480")).toBeNull();
        expect(normalizeExternalLinkUrl("store.example.com")).toBeNull();
        expect(normalizeExternalLinkUrl("")).toBeNull();
        expect(normalizeAppTagExternalLinks("nonsense")).toEqual([]);
    });

    it("drops a repeated entry and keeps author order", () => {
        expect(normalizeAppTagExternalLinks([
            "https://b.example.com/",
            "https://a.example.com/",
            "https://b.example.com",
        ])).toEqual(["https://b.example.com/", "https://a.example.com/"]);
    });

    it("matches exactly, so a declared host does not cover a lookalike", () => {
        const declared = ["https://store.example.com"];

        expect(isExternalLinkDeclared(declared, "https://store.example.com/")).toBe(true);
        expect(isExternalLinkDeclared(declared, " https://store.example.com ")).toBe(true);
        expect(isExternalLinkDeclared(declared, "https://store.example.com.evil.test/")).toBe(false);
        expect(isExternalLinkDeclared(declared, "https://store.example.com/app/480")).toBe(false);
        expect(isExternalLinkDeclared(declared, "http://store.example.com/")).toBe(false);
        expect(isExternalLinkDeclared(undefined, "https://store.example.com/")).toBe(false);
        expect(isExternalLinkDeclared(declared, "not a url")).toBe(false);
    });

    it("reads a variant's own list, and the project's when it states none", () => {
        const base = ["https://example.com/game"];
        const stating: ProjectAppTag = {
            id: "demo",
            name: "Demo",
            overrides: {},
            externalLinks: ["https://example.com/full-version"],
        };

        expect(resolveAppTagExternalLinks(tag("demo"), base))
            .toEqual({ value: ["https://example.com/game"], overridden: false });
        expect(resolveAppTagExternalLinks(stating, base))
            .toEqual({ value: ["https://example.com/full-version"], overridden: true });
    });

    it("treats a stated empty list as a statement, not as inheritance", () => {
        const stored = normalizeProjectAppTags([{ id: "demo", name: "Demo", externalLinks: [] }]);

        expect(stored[0].externalLinks).toEqual([]);
        expect(resolveAppTagExternalLinks(stored[0], ["https://example.com/"]))
            .toEqual({ value: [], overridden: true });
    });

    it("carries the project's own list through a document migration", () => {
        expect(migrateProjectAppTagDocument({
            schemaVersion: APP_TAG_SCHEMA_VERSION,
            tags: [],
            externalLinks: ["https://example.com/", "not a url"],
        }).externalLinks).toEqual(["https://example.com/"]);
        expect(migrateProjectAppTagDocument({ schemaVersion: APP_TAG_SCHEMA_VERSION, tags: [] }).externalLinks)
            .toBeUndefined();
    });
});
