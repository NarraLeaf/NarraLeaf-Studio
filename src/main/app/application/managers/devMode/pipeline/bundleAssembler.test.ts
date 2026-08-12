import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { encodeProjectConfig } from "@shared/utils/nlproj";
import { DEFAULT_AUTO_SAVE_CONFIGURATION } from "@shared/types/saves";
import { DEFAULT_PLAYER_PREFERENCES } from "@shared/types/preference";
import { BUILTIN_BRAND_COLORS } from "@shared/types/brand";
import { APP_TAG_ID_RELEASE } from "@shared/types/appTag";
import type { Blueprint } from "@shared/types/blueprint/document";
import {
    loadAutoSaveConfiguration,
    loadGameAudio,
    loadGameLocalization,
    loadPlayerPreferences,
    loadProjectBrand,
    planSceneDrop,
    resolveStoryDocumentPathForIndexEntry,
} from "./bundleAssembler";
import type { DevModeBundleLoadContext } from "./types";

const STORY_ID = "00000000-0000-4000-8000-000000000001";

describe("bundleAssembler story documents", () => {
    it("derives story document paths from UUID story ids", () => {
        expect(resolveStoryDocumentPathForIndexEntry("/project", {
            id: STORY_ID,
        })).toBe(path.join("/project", "editor", "story", "stories", STORY_ID, "storydoc.json"));
    });

    it("rejects non-UUID story ids before resolving paths", () => {
        expect(resolveStoryDocumentPathForIndexEntry("/project", {
            id: "../outside",
        })).toBeNull();
    });
});

describe("bundleAssembler game localization", () => {
    const tempDirs: string[] = [];

    afterEach(async () => {
        await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
    });

    async function createProject(localization: unknown): Promise<string> {
        const projectPath = await mkdtemp(path.join(os.tmpdir(), "nls-loc-test-"));
        tempDirs.push(projectPath);
        const encoded = encodeProjectConfig({
            name: "Test",
            identifier: "test.project",
            metadata: {},
            ...(localization ? { app: { localization } } : {}),
        } as never);
        await writeFile(path.join(projectPath, "project.nlproj"), encoded);
        return projectPath;
    }

    it("returns undefined when the project has no localization setup", async () => {
        const projectPath = await createProject(undefined);
        expect(await loadGameLocalization(projectPath)).toBeUndefined();
    });

    it("loads config and per-locale tables, skipping the source locale and empty targets", async () => {
        const projectPath = await createProject({
            sourceLocale: "zh-CN",
            locales: [
                { code: "zh-CN", displayName: "简体中文" },
                { code: "en", displayName: "English" },
                { code: "ja", displayName: "日本語" },
            ],
        });
        const localizationDir = path.join(projectPath, "editor", "localization");
        await mkdir(localizationDir, { recursive: true });
        await writeFile(path.join(localizationDir, "en.json"), JSON.stringify({
            schemaVersion: 1,
            locale: "en",
            units: {
                "text-1": { target: "Hello.", sourceHash: "fnv1a:1", status: "translated" },
                "text-2": { target: "", sourceHash: "fnv1a:2", status: "untranslated" },
            },
        }));
        await writeFile(path.join(localizationDir, "zh-CN.json"), JSON.stringify({
            schemaVersion: 1,
            locale: "zh-CN",
            units: { "text-1": { target: "不应加载（源语言）", sourceHash: "x", status: "translated" } },
        }));

        const bundle = await loadGameLocalization(projectPath);
        expect(bundle?.sourceLocale).toBe("zh-CN");
        expect(bundle?.locales.map(locale => locale.code)).toEqual(["zh-CN", "en", "ja"]);
        expect(bundle?.tables).toEqual({ en: { "text-1": "Hello." } });
    });

    it("degrades a broken translation file to an absent table", async () => {
        const projectPath = await createProject({
            sourceLocale: "zh-CN",
            locales: [
                { code: "zh-CN", displayName: "简体中文" },
                { code: "en", displayName: "English" },
            ],
        });
        const localizationDir = path.join(projectPath, "editor", "localization");
        await mkdir(localizationDir, { recursive: true });
        await writeFile(path.join(localizationDir, "en.json"), "{ not json");

        const bundle = await loadGameLocalization(projectPath);
        expect(bundle?.tables).toEqual({});
    });
});

describe("bundleAssembler auto save", () => {
    const tempDirs: string[] = [];

    afterEach(async () => {
        await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
    });

    async function createProject(autoSave: unknown): Promise<string> {
        const projectPath = await mkdtemp(path.join(os.tmpdir(), "nls-autosave-test-"));
        tempDirs.push(projectPath);
        const encoded = encodeProjectConfig({
            name: "Test",
            identifier: "test.project",
            metadata: {},
            ...(autoSave ? { app: { autoSave } } : {}),
        } as never);
        await writeFile(path.join(projectPath, "project.nlproj"), encoded);
        return projectPath;
    }

    // Unlike localization and voice, this one never degrades to `undefined`:
    // autosaving is on by default, so a project that predates the setting has
    // to come back configured, not unconfigured.
    it("gives a project with no autoSave config the defaults", async () => {
        const projectPath = await createProject(undefined);
        expect(await loadAutoSaveConfiguration(projectPath)).toEqual(DEFAULT_AUTO_SAVE_CONFIGURATION);
    });

    it("bakes the authored values into the bundle", async () => {
        const projectPath = await createProject({ enabled: false, intervalSeconds: 60, slots: 5 });
        expect(await loadAutoSaveConfiguration(projectPath)).toEqual({
            enabled: false,
            intervalSeconds: 60,
            slots: 5,
        });
    });

    it("falls back to the defaults when the project cannot be read", async () => {
        expect(await loadAutoSaveConfiguration(path.join(os.tmpdir(), "nls-missing-project")))
            .toEqual(DEFAULT_AUTO_SAVE_CONFIGURATION);
    });
});

/**
 * The player-preference defaults. Dense for the same reason autosave is: the running game holds a
 * value for every preference from the moment it is constructed, so a project that never opened the
 * page has to arrive configured with the engine's own rather than with a gap the game app would
 * have to invent an answer for.
 */
describe("bundleAssembler player preferences", () => {
    const tempDirs: string[] = [];

    afterEach(async () => {
        await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
    });

    async function createProject(preferences: unknown): Promise<string> {
        const projectPath = await mkdtemp(path.join(os.tmpdir(), "nls-preferences-test-"));
        tempDirs.push(projectPath);
        const encoded = encodeProjectConfig({
            name: "Test",
            identifier: "test.project",
            metadata: {},
            ...(preferences ? { app: { preferences } } : {}),
        } as never);
        await writeFile(path.join(projectPath, "project.nlproj"), encoded);
        return projectPath;
    }

    it("gives a project with no preferences config the engine defaults", async () => {
        const projectPath = await createProject(undefined);
        expect(await loadPlayerPreferences(projectPath)).toEqual(DEFAULT_PLAYER_PREFERENCES);
    });

    it("bakes the authored values into the bundle", async () => {
        const projectPath = await createProject({ cps: 45, skipReadText: true, bgmVolume: 0.4 });
        expect(await loadPlayerPreferences(projectPath)).toEqual({
            ...DEFAULT_PLAYER_PREFERENCES,
            cps: 45,
            skipReadText: true,
            bgmVolume: 0.4,
        });
    });

    it("clamps a hand-edited value rather than shipping it", async () => {
        // A zero here is not a slow game, it is a hung one: the engine divides by `gameSpeed`.
        const projectPath = await createProject({ gameSpeed: 0, cps: 1e9 });
        const loaded = await loadPlayerPreferences(projectPath);
        expect(loaded.gameSpeed).toBe(0.1);
        expect(loaded.cps).toBe(200);
    });

    it("falls back to the defaults when the project cannot be read", async () => {
        expect(await loadPlayerPreferences(path.join(os.tmpdir(), "nls-missing-project")))
            .toEqual(DEFAULT_PLAYER_PREFERENCES);
    });
});

/**
 * The audio payload. The in/out points an author marks in the asset manager and the project's audio
 * tracks only reach the game through this table, so "the marker did nothing" is exactly the failure
 * these guard.
 */
describe("bundleAssembler audio payload", () => {
    const tempDirs: string[] = [];

    afterEach(async () => {
        await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
    });

    async function createProject(shard: unknown, tracksDocument?: string): Promise<string> {
        const projectPath = await mkdtemp(path.join(os.tmpdir(), "nls-audio-test-"));
        tempDirs.push(projectPath);
        if (shard !== undefined) {
            await mkdir(path.join(projectPath, "assets"), { recursive: true });
            await writeFile(
                path.join(projectPath, "assets", "assets.metadata.audio.json"),
                JSON.stringify(shard),
            );
        }
        if (tracksDocument !== undefined) {
            await mkdir(path.join(projectPath, "editor"), { recursive: true });
            await writeFile(path.join(projectPath, "editor", "audio-tracks.json"), tracksDocument);
        }
        return projectPath;
    }

    async function clipsOf(projectPath: string): Promise<Record<string, unknown>> {
        return (await loadGameAudio(projectPath)).clips;
    }

    it("carries an empty clip table when no audio asset has a region", async () => {
        const projectPath = await createProject({
            a1: { id: "a1", name: "theme.mp3" },
            a2: { id: "a2", name: "hit.wav", extras: {} },
        });
        expect(await clipsOf(projectPath)).toEqual({});
    });

    it("carries only the marked clips", async () => {
        const projectPath = await createProject({
            a1: { id: "a1", extras: { audioLoop: { inMs: 4200, outMs: 92500, loopStartMs: 12000 } } },
            a2: { id: "a2", extras: { audioLoop: { inMs: 1000 } } },
            a3: { id: "a3", name: "unmarked.wav" },
        });
        expect(await clipsOf(projectPath)).toEqual({
            a1: { inMs: 4200, outMs: 92500, loopStartMs: 12000 },
            a2: { inMs: 1000 },
        });
    });

    it("reads the cue-point shape that preceded the region", async () => {
        const projectPath = await createProject({
            a1: { id: "a1", extras: { cuePoints: [{ timeMs: 900 }, { timeMs: 200 }] } },
        });
        // Earliest two in time order, so a record written against the old shape opens with what the
        // author marked rather than blank.
        expect(await clipsOf(projectPath)).toEqual({ a1: { inMs: 200, outMs: 900 } });
    });

    it("drops an out point that is not after the in point", async () => {
        const projectPath = await createProject({
            a1: { id: "a1", extras: { audioLoop: { inMs: 5000, outMs: 5000 } } },
        });
        expect(await clipsOf(projectPath)).toEqual({ a1: { inMs: 5000 } });
    });

    it("degrades to no regions when the shard is missing or unreadable", async () => {
        expect(await clipsOf(await createProject(undefined))).toEqual({});

        const broken = await mkdtemp(path.join(os.tmpdir(), "nls-audio-test-"));
        tempDirs.push(broken);
        await mkdir(path.join(broken, "assets"), { recursive: true });
        await writeFile(path.join(broken, "assets", "assets.metadata.audio.json"), "{not json");
        // Every clip then plays whole, which is what happened before regions existed.
        expect(await clipsOf(broken)).toEqual({});
    });

    it("seeds the built-in buses when the project has no track document", async () => {
        // A project that has never opened the Audio surface must behave exactly the way Studio
        // behaved before tracks existed, not lose every play that references one.
        const tracks = (await loadGameAudio(await createProject(undefined))).tracks;
        expect(tracks?.map(track => track.id)).toEqual(["bgm", "sound", "voice"]);
        expect(tracks?.find(track => track.id === "bgm")).toMatchObject({
            name: "Music",
            parentId: null,
            volume: 1,
            loop: true,
        });
    });

    it("migrates a v1 document: channel becomes the parent, gain becomes the bus volume", async () => {
        const projectPath = await createProject(undefined, JSON.stringify({
            schemaVersion: 1,
            tracks: [
                {
                    id: "ambience",
                    name: "Ambience",
                    channel: "sound",
                    gain: 0.6,
                    fadeInMs: 2000,
                    fadeOutMs: 2000,
                    loop: true,
                },
                {
                    id: "music",
                    name: "Score",
                    channel: "bgm",
                    gain: 0.8,
                    fadeInMs: 400,
                    fadeOutMs: 400,
                    loop: true,
                },
            ],
        }));
        const tracks = (await loadGameAudio(projectPath)).tracks;
        // v1's `music` seed is renamed onto the engine's channel id; `sfx` and `voice` are re-seeded
        // because the document never had them.
        expect(tracks?.map(track => track.id)).toEqual(["sound", "voice", "ambience", "bgm"]);
        // A renamed / re-tuned seed keeps the author's values, and its v1 `channel` is not turned
        // into a parent pointing at itself.
        expect(tracks?.find(track => track.id === "bgm"))
            .toMatchObject({ name: "Score", volume: 0.8, parentId: null, loop: true });
        // An author's own track: its old channel is exactly the bus it now hangs off.
        expect(tracks?.find(track => track.id === "ambience"))
            .toMatchObject({ name: "Ambience", parentId: "sound", volume: 0.6 });
        // The fades are gone rather than carried; a fade belongs to the moment, not the category.
        expect(tracks?.every(track => !("fadeInMs" in track) && !("fadeOutMs" in track))).toBe(true);
    });

    it("carries a v2 tree as authored, nesting and all", async () => {
        const projectPath = await createProject(undefined, JSON.stringify({
            schemaVersion: 2,
            tracks: [
                { id: "bgm", name: "Music", parentId: null, volume: 1, loop: true },
                { id: "sound", name: "SFX", parentId: null, volume: 1, loop: false },
                { id: "voice", name: "Voice", parentId: null, volume: 1, loop: false },
                { id: "alice", name: "Alice", parentId: "voice", volume: 0.7, loop: false },
            ],
        }));
        const tracks = (await loadGameAudio(projectPath)).tracks;
        expect(tracks?.map(track => track.id)).toEqual(["bgm", "sound", "voice", "alice"]);
        // The motivating case: a per-character bus reaches the runtime with its parent intact.
        expect(tracks?.find(track => track.id === "alice"))
            .toMatchObject({ parentId: "voice", volume: 0.7 });
    });

    it("repairs a tree the engine would refuse rather than shipping it", async () => {
        // `AudioBusTree.resolve` throws on a cycle or an unknown parent, and it throws lazily - the
        // first time something plays. A hand-corrupted file must not turn into "the game boots and
        // then goes silent forever with an exception nobody sees".
        const projectPath = await createProject(undefined, JSON.stringify({
            schemaVersion: 2,
            tracks: [
                { id: "a", name: "A", parentId: "b", volume: 1, loop: false },
                { id: "b", name: "B", parentId: "a", volume: 1, loop: false },
                { id: "orphan", name: "Orphan", parentId: "nowhere", volume: 1, loop: false },
            ],
        }));
        const tracks = (await loadGameAudio(projectPath)).tracks;
        const byId = Object.fromEntries((tracks ?? []).map(track => [track.id, track]));
        expect(byId.orphan.parentId).toBeNull();
        // The ring is cut at one member, so the other keeps the parent the author gave it.
        expect([byId.a.parentId, byId.b.parentId].filter(parent => parent === null)).toHaveLength(1);
    });

    it("falls back to the built-ins rather than throwing on an unreadable track document", async () => {
        // A hand-corrupted track file must not be the reason a build cannot be produced.
        const projectPath = await createProject(undefined, "{not json");
        const tracks = (await loadGameAudio(projectPath)).tracks;
        expect(tracks?.map(track => track.id)).toEqual(["bgm", "sound", "voice"]);
    });
});

/**
 * The brand palette. Dense like the tracks and for the same reason: a `nlbrand:` link is only a
 * colour while a palette is beside it, so every path out of this loader has to be a usable palette
 * rather than an absence the runtime would have to invent an answer for.
 */
describe("bundleAssembler brand palette", () => {
    const tempDirs: string[] = [];

    afterEach(async () => {
        await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
    });

    async function createProject(document?: string): Promise<string> {
        const projectPath = await mkdtemp(path.join(os.tmpdir(), "nls-brand-test-"));
        tempDirs.push(projectPath);
        if (document !== undefined) {
            await mkdir(path.join(projectPath, "editor"), { recursive: true });
            await writeFile(path.join(projectPath, "editor", "brand.json"), document);
        }
        return projectPath;
    }

    it("seeds the built-in palette for a project that has never opened the Brand surface", async () => {
        const colors = await loadProjectBrand(await createProject());
        expect(colors).toEqual([...BUILTIN_BRAND_COLORS]);
        // The seeded control slots have to arrive as links, not as pre-resolved literals: resolving
        // them here would freeze today's primary into the bundle and "change the primary colour"
        // would stop meaning anything in a shipped game.
        expect(colors.find(color => color.id === "button.primary")?.value).toBe("nlbrand:primary");
    });

    it("carries the author's palette, their own colours included", async () => {
        const projectPath = await createProject(JSON.stringify({
            schemaVersion: 1,
            colors: [
                { id: "primary", value: "#FF0000" },
                { id: "ink", name: "Ink", value: "nlbrand:primary/0.5" },
            ],
        }));
        const colors = await loadProjectBrand(projectPath);
        expect(colors.find(color => color.id === "primary")?.value).toBe("#FF0000");
        expect(colors.find(color => color.id === "ink")).toEqual({ id: "ink", name: "Ink", value: "nlbrand:primary/0.5" });
        // Whatever the author's document was missing comes back seeded, so the runtime can assume
        // every built-in id resolves.
        expect(BUILTIN_BRAND_COLORS.every(seed => colors.some(color => color.id === seed.id))).toBe(true);
    });

    it("falls back to the seeds rather than throwing on an unreadable document", async () => {
        // One corrupted colour file must not be the reason a preview will not start; booting in the
        // default palette is a state the author can see.
        expect(await loadProjectBrand(await createProject("{not json")))
            .toEqual([...BUILTIN_BRAND_COLORS]);
        expect(await loadProjectBrand(await createProject(JSON.stringify({ colors: "nonsense" }))))
            .toEqual([...BUILTIN_BRAND_COLORS]);
    });

    it("falls back to the seeds when the project cannot be read at all", async () => {
        expect(await loadProjectBrand(path.join(os.tmpdir(), "nls-missing-project")))
            .toEqual([...BUILTIN_BRAND_COLORS]);
    });
});

describe("bundleAssembler scene drop plan", () => {
    function graphBlueprint(nodes: Record<string, unknown>): Blueprint {
        return {
            id: "bp-1",
            name: "Menu",
            owner: { kind: "surface", surfaceId: "s1" },
            frontend: "visual",
            programKind: "graph",
            program: { kind: "graph", graphs: { events: { "e-1": { id: "e-1", graph: { nodes } } } } },
        } as unknown as Blueprint;
    }

    function scriptBlueprint(): Blueprint {
        return {
            id: "bp-2",
            name: "Script",
            owner: { kind: "surface", surfaceId: "s1" },
            frontend: "typescript",
            programKind: "scriptModule",
            program: { kind: "scriptModule", source: { entry: "index.ts", files: {} } },
        } as unknown as Blueprint;
    }

    function context(extra?: Partial<DevModeBundleLoadContext>): DevModeBundleLoadContext {
        return { projectPath: "/project", bundleId: "b", revision: 1, ...extra };
    }

    const startGame = (params: Record<string, string>) => ({
        "n-1": { id: "n-1", type: "blueprint.game.startStory", params },
    });

    it("keeps every scene in the release build", () => {
        // Release cuts nothing, and Dev Mode, the preview and "play from this row" all enter a scene
        // the author picked rather than one the story reaches.
        expect(planSceneDrop(context(), APP_TAG_ID_RELEASE, [])).toBeNull();
    });

    it("collects the scenes a Start Game node names, per story", () => {
        const plan = planSceneDrop(context(), "tag-demo", [
            graphBlueprint(startGame({ storyId: "story-1", sceneId: "scene-7" })),
        ]);

        expect(plan?.get("story-1")).toEqual({ entrySceneIds: ["scene-7"] });
        expect(plan?.get("story-2")).toBeUndefined();
    });

    it("ships every story whole when a Start Game node picks its scene while the game runs", () => {
        const notices: string[] = [];
        const plan = planSceneDrop(context({ onNotice: message => notices.push(message) }), "tag-demo", [
            graphBlueprint(startGame({ storyId: "story-1", sceneId: "" })),
        ]);

        expect(plan).toBeNull();
        expect(notices).toHaveLength(1);
    });

    it("ships every story whole when a blueprint is written in TypeScript", () => {
        const notices: string[] = [];
        const plan = planSceneDrop(
            context({ onNotice: message => notices.push(message) }),
            "tag-demo",
            [scriptBlueprint()],
        );

        expect(plan).toBeNull();
        expect(notices).toHaveLength(1);
    });

    it("ships every story whole when the pack carries a plugin", () => {
        const notices: string[] = [];
        const plan = planSceneDrop(
            context({ hasRuntimePlugins: true, onNotice: message => notices.push(message) }),
            "tag-demo",
            [],
        );

        expect(plan).toBeNull();
        expect(notices).toHaveLength(1);
    });
});
