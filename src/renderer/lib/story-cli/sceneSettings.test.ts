import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StoryDocument, StoryScene } from "@shared/types/story";
import { commandI18nStore } from "@/lib/i18n/commandLocale";
import { formatApplySummary, summariseApply } from "./apply";
import { runCli } from "./cli";
import { compileStoryFile } from "./dsl/compile";
import { parseStoryFile } from "./dsl/parse";
import { printStoryScene } from "./dsl/print";
import { applySceneSettings, describeSceneSettings, printSceneSettings, type SceneSettingsLookups } from "./dsl/sceneSettings";
import { buildLookups } from "./lookups";
import { buildContext, readProjectData } from "./project";

/**
 * A scene's own settings - the background and the music it opens on - as `#background` / `#music`
 * header directives.
 *
 * The defect these pin (acceptance run #2): the skeleton's demo scenes, reused for a train game, kept
 * opening on the classroom picture for a beat before the file's own `/bg` row, because the scene
 * carried `defaultBackgroundAssetId` and nothing a `.story` file showed or wrote reached it.
 */

const SKELETON = path.resolve(__dirname, "../../../../resources/templates/skeleton/content");
const STORY_DIR = path.join(SKELETON, "editor", "story", "stories");

function skeletonDocument(): StoryDocument {
    const storyId = fs.readdirSync(STORY_DIR)[0];
    return JSON.parse(fs.readFileSync(path.join(STORY_DIR, storyId, "storydoc.json"), "utf8")) as StoryDocument;
}

function sceneNamed(document: StoryDocument, name: string): StoryScene {
    const scene = Object.values(document.scenes).find(candidate => candidate.name === name);
    if (!scene) {
        throw new Error(`no scene ${name}`);
    }
    return scene;
}

const lookups: SceneSettingsLookups = {
    images: [
        { id: "img-classroom", name: "classroom" },
        { id: "img-street", name: "night street" },
        { id: "img-dup-1", name: "forest" },
        { id: "img-dup-2", name: "forest" },
    ],
    audio: [{ id: "aud-quiet", name: "bgm-quiet" }],
    audioTracks: [{ id: "track-music", name: "Music" }],
};

const bare: StoryScene = { id: "s", name: "S", runtimeName: "s", rootBlockIds: [], blocks: {} };

function settingsOf(source: string, scene: StoryScene = bare) {
    return applySceneSettings(scene, parseStoryFile(`#nlstory 1\n${source}\n`).ast.settings, lookups);
}

describe("#background and #music", () => {
    it("print both settings, always, and read back as the same record", () => {
        const scene: StoryScene = {
            ...bare,
            defaultBackgroundAssetId: "img-street",
            bgm: { assetId: "aud-quiet", audioTrackId: "track-music", volume: 0.7, loop: false, fadeMs: 1200 },
        };
        const printed = printSceneSettings(scene, lookups);
        expect(printed).toEqual([
            "#background 'night street'",
            "#music bgm-quiet track=Music volume=0.7 loop=false fade=1200",
        ]);
        const back = settingsOf(printed.join("\n"), bare);
        expect(back.diagnostics).toEqual([]);
        expect(back.scene).toEqual(scene);
        expect(printSceneSettings(bare, lookups)).toEqual(["#background none", "#music none"]);
    });

    it("clears a setting with none, and leaves one the file does not state as it was", () => {
        const scene: StoryScene = { ...bare, defaultBackgroundAssetId: "img-classroom", bgm: { assetId: "aud-quiet" } };
        const cleared = settingsOf("#background none\n#music none", scene);
        expect(cleared.diagnostics).toEqual([]);
        expect(cleared.scene).toEqual(bare);
        expect("defaultBackgroundAssetId" in cleared.scene).toBe(false);
        expect(settingsOf("#background classroom", bare).scene.defaultBackgroundAssetId).toBe("img-classroom");
        expect(settingsOf("", scene).scene).toBe(scene);
    });

    it("refuses a name nothing answers to, an ambiguous one and a bad key, on the directive's line", () => {
        expect(settingsOf("#background gym").diagnostics).toMatchObject([{ code: "file.bad_setting", line: 2, message: expect.stringMatching(/no image is named "gym"/) }]);
        expect(settingsOf("#background forest").diagnostics[0].message).toMatch(/more than one image is named "forest"/);
        expect(settingsOf("#music bgm-quiet volume=2").diagnostics[0].message).toMatch(/volume= takes a number from 0 to 1/);
        expect(settingsOf("#music bgm-quiet speed=2").diagnostics[0].message).toMatch(/not a #music setting/);
        expect(parseStoryFile("#nlstory 1\n#background a\n#background b\n").diagnostics).toMatchObject([{ code: "file.duplicate_setting", line: 3 }]);
    });

    it("prints a fade with float noise in whole milliseconds, and reads it back as the stored value", () => {
        // The scene panel stores `Number(seconds) * 1000`, so these are real stored values.
        for (const fadeMs of [2009.9999999999998, 16100.000000000002]) {
            const scene: StoryScene = { ...bare, bgm: { assetId: "aud-quiet", fadeMs } };
            const printed = printSceneSettings(scene, lookups);
            expect(printed[1]).toBe(`#music bgm-quiet fade=${Math.round(fadeMs)}`);
            const back = settingsOf(printed.join("\n"), scene);
            expect(back.diagnostics).toEqual([]);
            expect(back.scene).toBe(scene);
        }
        // A fraction typed into the file is a fade like any other, kept to the millisecond.
        const typed = settingsOf("#music bgm-quiet fade=1200.6");
        expect(typed.diagnostics).toEqual([]);
        expect(typed.scene.bgm).toEqual({ assetId: "aud-quiet", fadeMs: 1201 });
        expect(settingsOf("#music bgm-quiet fade=-1").diagnostics[0].message).toMatch(/fade= takes milliseconds/);
    });

    it("reads an unedited #music back as the stored record whatever order the scene panel spread its keys in", () => {
        // The panel builds the record with `{ ...bgm, ...next }`, so keys land in the order they were
        // edited, and a cleared track is `audioTrackId: undefined` in memory.
        const panelOrder: StoryScene = {
            ...bare,
            bgm: { assetId: "aud-quiet", fadeMs: 1200, loop: true, volume: 0.7, audioTrackId: undefined },
        };
        const back = settingsOf(printSceneSettings(panelOrder, lookups).join("\n"), panelOrder);
        expect(back.diagnostics).toEqual([]);
        expect(back.scene).toBe(panelOrder);

        const readerOrder: StoryScene = { ...bare, bgm: { assetId: "aud-quiet", volume: 0.7, loop: true, fadeMs: 1200 } };
        const summary = summariseApply(panelOrder, readerOrder, () => "", {
            before: describeSceneSettings(panelOrder, lookups),
            after: describeSceneSettings(readerOrder, lookups),
            stated: { background: true, music: true },
        });
        expect(summary.settingsChanged).toEqual([]);
        expect(settingsOf("#music bgm-quiet volume=0.7 loop=true fade=1500", panelOrder).scene.bgm)
            .toEqual({ assetId: "aud-quiet", volume: 0.7, loop: true, fadeMs: 1500 });
    });

    it("counts a setting only in the header, and reads one further down or indented as a comment with a warning", () => {
        const header = parseStoryFile("#nlstory 1\n#music bgm-quiet\n\nThe rain had stopped.\n");
        expect(header.diagnostics).toEqual([]);
        expect(header.ast.settings.music).toEqual({ value: "bgm-quiet", line: 2 });

        // The note an author always could write, and one that happens to name a real clip.
        for (const note of ["#music swells here", "#music bgm-quiet", "#background classroom"]) {
            const parsed = parseStoryFile(`#nlstory 1\n\nThe rain had stopped.\n${note}\nAlice: Hello.\n`);
            expect(parsed.ast.settings).toEqual({});
            expect(parsed.ast.lines).toHaveLength(2);
            expect(parsed.diagnostics).toMatchObject([
                { code: "file.setting_outside_header", severity: "warning", line: 4, message: expect.stringMatching(/only counts in the header/) },
            ]);
        }
        const nested = parseStoryFile("#nlstory 1\n/menu Which?\n  - Left.\n    #music bgm-quiet\n");
        expect(nested.ast.settings).toEqual({});
        expect(nested.diagnostics).toMatchObject([{ code: "file.setting_outside_header", line: 4 }]);
        // Before any row but indented is not the header's shape either.
        const indented = parseStoryFile("#nlstory 1\n  #background classroom\n");
        expect(indented.ast.settings).toEqual({});
        expect(indented.diagnostics).toMatchObject([{ code: "file.setting_outside_header", severity: "warning", line: 2 }]);
        // Every other `#` line is still a silent comment, wherever it is.
        expect(parseStoryFile("#nlstory 1\nThe rain.\n# a note\n#musical cue\n").diagnostics).toEqual([]);
    });

    it("keeps an id nothing answers to any more when the file leaves it as printed", () => {
        const scene: StoryScene = { ...bare, defaultBackgroundAssetId: "deleted-asset" };
        const printed = printSceneSettings(scene, lookups);
        expect(printed[0]).toBe("#background deleted-asset");
        expect(settingsOf(printed.join("\n"), scene)).toEqual({ scene, diagnostics: [] });
    });

    it("says in the summary what changed, and what the scene still opens on when the file is silent", () => {
        const scene: StoryScene = { ...bare, defaultBackgroundAssetId: "img-classroom" };
        const describe = (next: StoryScene) => describeSceneSettings(next, lookups);
        const changed = summariseApply(scene, bare, () => "", {
            before: describe(scene),
            after: describe(bare),
            stated: { background: true, music: false },
        });
        expect(formatApplySummary(changed, true)).toContain('Scene setting: opening background "classroom" -> none.');
        const kept = summariseApply(scene, scene, () => "", {
            before: describe(scene),
            after: describe(scene),
            stated: { background: false, music: false },
        });
        const text = formatApplySummary(kept, false);
        expect(text).toContain('This scene still opens with opening background "classroom", before its first row');
        expect(text).toContain('Write "#background none" in the header to clear them.');
    });
});

describe("the skeleton's scenes, printed and read back", () => {
    commandI18nStore.setPreference(false);
    const document = skeletonDocument();
    const data = readProjectData(SKELETON);

    it("print the background each demo scene opens on, and give it back unchanged", () => {
        for (const scene of Object.values(document.scenes)) {
            const context = buildContext(data, document, scene);
            const rowLookups = buildLookups(data, document, scene, context);
            const printed = printStoryScene({
                scene,
                storyName: document.name,
                context,
                rowLookups: rowLookups.rowLookups,
                prose: rowLookups.prose,
                conditions: rowLookups.conditions,
            });
            const header = printed.text.split("\n").slice(0, 5);
            expect(header[3]).toMatch(/^#background (?!none)/);
            expect(header[4]).toBe("#music none");
            const compiled = compileStoryFile({
                ast: parseStoryFile(printed.text).ast,
                existing: scene,
                document,
                contextFor: next => buildContext(data, document, next ?? scene),
                prose: rowLookups.prose,
                conditions: rowLookups.conditions,
                mintId: () => "MINTED",
            });
            expect(compiled.diagnostics).toEqual([]);
            expect(compiled.scene?.defaultBackgroundAssetId).toBe(scene.defaultBackgroundAssetId);
            expect(compiled.scene?.bgm).toEqual(scene.bgm);
        }
        expect(printSceneSettings(sceneNamed(document, "The clubroom"), buildContext(data, document, null))[0]).toBe("#background classroom");
    });
});

describe("story show / apply on the command line", () => {
    let projectDir: string;

    beforeEach(() => {
        projectDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nl-story-settings-")));
        // The documents only: the asset files themselves are not read by `show` or `apply`.
        fs.cpSync(path.join(SKELETON, "editor"), path.join(projectDir, "editor"), { recursive: true });
        fs.mkdirSync(path.join(projectDir, "assets"));
        for (const file of fs.readdirSync(path.join(SKELETON, "assets"))) {
            if (file.endsWith(".json")) {
                fs.copyFileSync(path.join(SKELETON, "assets", file), path.join(projectDir, "assets", file));
            }
        }
    });

    afterEach(() => {
        fs.rmSync(projectDir, { recursive: true, force: true });
    });

    async function cli(...args: string[]): Promise<{ code: number; out: string; err: string }> {
        const out: string[] = [];
        const err: string[] = [];
        const code = await runCli(args, { out: text => out.push(text), err: text => err.push(text) });
        return { code, out: out.join("\n"), err: err.join("\n") };
    }

    function storyFile(): string {
        const storyId = fs.readdirSync(path.join(projectDir, "editor/story/stories"))[0];
        return path.join(projectDir, "editor/story/stories", storyId, "storydoc.json");
    }

    function stored(): StoryScene {
        const document = JSON.parse(fs.readFileSync(storyFile(), "utf8")) as StoryDocument;
        return sceneNamed(document, "The clubroom");
    }

    /** Give the clubroom's stored scene its music, as the scene panel would have written it. */
    function storeMusic(bgm: StoryScene["bgm"]): void {
        const document = JSON.parse(fs.readFileSync(storyFile(), "utf8")) as StoryDocument;
        const scene = sceneNamed(document, "The clubroom");
        document.scenes[scene.id] = { ...scene, bgm };
        fs.writeFileSync(storyFile(), JSON.stringify(document, null, 2), "utf8");
    }

    it("applies a printed scene whose stored fade carries float noise as no change at all", async () => {
        storeMusic({ assetId: "49b1db61-3d5e-4453-aa78-531a78e38de5", fadeMs: 2009.9999999999998 });
        const file = path.join(projectDir, "clubroom.story");
        expect((await cli("show", "--project", projectDir, "--scene", "The clubroom", "--out", file)).code).toBe(0);
        expect(fs.readFileSync(file, "utf8")).toContain("\n#music bgm-quiet fade=2010\n");

        const applied = await cli("apply", file, "--project", projectDir, "--write");
        expect(applied.code, applied.out + applied.err).toBe(0);
        expect(applied.out).toContain("No row changed.");
        expect(applied.out).not.toContain("Scene setting:");
        expect(stored().bgm).toEqual({ assetId: "49b1db61-3d5e-4453-aa78-531a78e38de5", fadeMs: 2009.9999999999998 });
    });

    it("checks and applies a body note that reads like a setting as the comment it is, with a warning", async () => {
        const file = path.join(projectDir, "clubroom.story");
        await cli("show", "--project", projectDir, "--scene", "The clubroom", "--out", file);
        const lines = fs.readFileSync(file, "utf8").split("\n");
        const firstRow = lines.findIndex((line, index) => index > 0 && lines[index - 1] === "" && line !== "");
        lines.splice(firstRow + 1, 0, "#music bgm-quiet", "#music swells here");
        fs.writeFileSync(file, lines.join("\n"), "utf8");

        const checked = await cli("check", file, "--project", projectDir);
        expect(checked.code, checked.out + checked.err).toBe(0);
        expect(checked.out).toContain("#music only counts in the header");
        const applied = await cli("apply", file, "--project", projectDir, "--write");
        expect(applied.code, applied.out + applied.err).toBe(0);
        expect(applied.out).not.toContain("Scene setting:");
        expect(stored().bgm).toBeUndefined();
    });

    it("re-applies an unedited file without reporting a music change when the stored keys are in panel order", async () => {
        const bgm = { assetId: "49b1db61-3d5e-4453-aa78-531a78e38de5", fadeMs: 1200, loop: false, volume: 0.5 };
        storeMusic(bgm);
        const file = path.join(projectDir, "clubroom.story");
        await cli("show", "--project", projectDir, "--scene", "The clubroom", "--out", file);

        const applied = await cli("apply", file, "--project", projectDir, "--write");
        expect(applied.code, applied.out + applied.err).toBe(0);
        expect(applied.out).not.toContain("Scene setting:");
        expect(Object.keys(stored().bgm ?? {})).toEqual(Object.keys(bgm));
    });

    it("clears a reused scene's opening background with #background none, and lists it under targets before", async () => {
        const targets = await cli("targets", "classroom", "--project", projectDir);
        expect(targets.out).toContain("The clubroom: #background classroom");

        const file = path.join(projectDir, "clubroom.story");
        expect((await cli("show", "--project", projectDir, "--scene", "The clubroom", "--out", file)).code).toBe(0);
        const shown = fs.readFileSync(file, "utf8");
        expect(shown).toContain("\n#background classroom\n#music none\n");

        fs.writeFileSync(file, shown.replace("#background classroom", "#background none"), "utf8");
        const applied = await cli("apply", file, "--project", projectDir, "--write");
        expect(applied.code, applied.out + applied.err).toBe(0);
        expect(applied.out).toContain('Scene setting: opening background "classroom" -> none.');
        expect(stored().defaultBackgroundAssetId).toBeUndefined();
    });

    it("keeps the background when the file leaves the directive out, and says so", async () => {
        const file = path.join(projectDir, "clubroom.story");
        await cli("show", "--project", projectDir, "--scene", "The clubroom", "--out", file);
        const withoutSettings = fs.readFileSync(file, "utf8").split("\n").filter(line => !/^#(background|music) /.test(line)).join("\n");
        fs.writeFileSync(file, withoutSettings, "utf8");
        const applied = await cli("apply", file, "--project", projectDir, "--write");
        expect(applied.code, applied.out + applied.err).toBe(0);
        expect(applied.out).toContain('This scene still opens with opening background "classroom"');
        expect(stored().defaultBackgroundAssetId).toBeDefined();
    });
});
