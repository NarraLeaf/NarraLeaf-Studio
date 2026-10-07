import { describe, expect, it } from "vitest";
import { STORY_DOCUMENT_SCHEMA_VERSION, type StoryBlock, type StoryDocument } from "@shared/types/story";
import { compileStudioStoryToNlr } from "./storyCompiler";
import { computeStoryStageSnapshot } from "./storyStageSnapshot";

/**
 * A row-precise launch opens on the sound the scene has at that row.
 *
 * "Play from this row" - and a save put back at its row after the story changed, which goes the same
 * way - builds an opening scene from the walk to the row. That scene used to carry the scene's own
 * configured music and nothing else: a launch after a `/bgm` row, or after a looping `/sound`, opened
 * in silence, and every `/vol rain` or `/stop rain` after the row reported a sound that was not
 * playing. It now starts the track on the music channel and the looping sounds the walk left
 * playing, and builds every handle the scene's rows start so the rest of the scene finds them.
 */

type Compiled = Awaited<ReturnType<typeof compileStudioStoryToNlr>>;

const SCENE = "scene-1";

function row(id: string, payload: Record<string, unknown>, kind: StoryBlock["kind"] = "action"): StoryBlock {
    return { id, kind, parentId: null, childrenIds: [], payload } as StoryBlock;
}

const line = (id: string) => row(id, { action: "narration", text: { textId: `${id}-text`, value: id, role: "narration" } }, "nodeAction");
const audio = (id: string, payload: Record<string, unknown>) => row(id, { action: "audio", ...payload });

function document(rows: StoryBlock[], sceneMusic?: { assetId: string; fadeMs?: number }): StoryDocument {
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Story",
        chapters: [{ id: "chapter-1", name: "Chapter", sceneIds: [SCENE] }],
        scenes: {
            [SCENE]: {
                id: SCENE,
                name: "Scene 1",
                runtimeName: "Scene 1",
                ...(sceneMusic ? { bgm: sceneMusic } : {}),
                rootBlockIds: rows.map(entry => entry.id),
                blocks: Object.fromEntries(rows.map(entry => [entry.id, entry])),
            },
        },
    } as StoryDocument;
}

async function launchAt(doc: StoryDocument, targetBlockId: string): Promise<Compiled> {
    return compileStudioStoryToNlr({
        document: doc,
        sceneId: SCENE,
        resolveAssetUrl: (assetId: string) => `test://${assetId}`,
        launch: {
            targetBlockId,
            snapshot: computeStoryStageSnapshot({ document: doc, sceneId: SCENE, targetBlockId }),
        },
    });
}

type EngineAction = { type: string; callee: unknown; contentNode?: { getContent(): unknown[] } };

/**
 * What the opening scene runs before its first row: every action of the entry scene that no row
 * recorded. The launch's setup is the only thing in that scene not compiled from a row.
 */
function setupActions(compiled: Compiled): EngineAction[] {
    const story = compiled.story as unknown as { constructStory(): void };
    story.constructStory();
    const scene = compiled.scene as unknown as {
        getAllChildren(story: unknown, root: unknown, options: { allowFutureScene: boolean }): EngineAction[];
        getSceneRoot(): unknown;
    };
    const recorded = new Set(compiled.actionIdBindings.map(binding => binding.action as unknown));
    return scene.getAllChildren(compiled.story, scene.getSceneRoot(), { allowFutureScene: false })
        .filter(action => !recorded.has(action));
}

const idOf = (element: unknown): string | null => (element as { getId(): string | null }).getId();
const srcOf = (element: unknown): string => (element as { config: { src: string } }).config.src;

/** The setup's sound actions, as `type -> id of the sound` in order - `scene:setBackgroundMusic` names the track it starts. */
function soundSetup(compiled: Compiled): string[] {
    return setupActions(compiled)
        .filter(action => action.type.startsWith("sound:") || action.type === "scene:setBackgroundMusic")
        .map(action => {
            if (action.type === "scene:setBackgroundMusic") {
                const [sound, fade] = action.contentNode!.getContent() as [unknown, number];
                return `${action.type} ${idOf(sound)} fade=${fade}`;
            }
            return `${action.type} ${idOf(action.callee)}`;
        });
}

const errors = (compiled: Compiled) => compiled.diagnostics.filter(entry => entry.level === "error");
const PREFIX = `nl:launch:${SCENE}`;

describe("a row-precise launch and the music channel", () => {
    const theme = audio("theme", { operation: "setBgm", assetId: "asset-theme", fadeMs: 1200, volume: 0.7 });

    it("starts the track a /bgm row before the target put on the channel, named as that row's track", async () => {
        const compiled = await launchAt(document([theme, line("before"), line("target")], { assetId: "asset-scene", fadeMs: 800 }), "target");

        expect(errors(compiled)).toEqual([]);
        // Over the fade its own row brings it in with, and named under the launch, by the row.
        expect(soundSetup(compiled)).toEqual([`scene:setBackgroundMusic ${PREFIX}:target:bgm:theme fade=1200`]);
        const [sound] = setupActions(compiled).find(action => action.type === "scene:setBackgroundMusic")!.contentNode!.getContent();
        expect(srcOf(sound)).toBe("test://asset-theme");
        // The scene's own track does not start under it, and the scene still leaves with its own fade.
        const config = (compiled.scene as unknown as { config: { backgroundMusic: unknown; backgroundMusicFade: number } }).config;
        expect(config.backgroundMusic ?? null).toBeNull();
        expect(config.backgroundMusicFade).toBe(800);
    });

    it("starts the scene's own track when no /bgm row came before the target, as a launch always has", async () => {
        const compiled = await launchAt(document([line("before"), line("target")], { assetId: "asset-scene", fadeMs: 800 }), "target");

        expect(soundSetup(compiled)).toEqual([`scene:setBackgroundMusic ${PREFIX}:target:scene:music fade=800`]);
    });

    it("starts nothing after a /bgm that cleared the channel, or after the music was stopped", async () => {
        const cleared = await launchAt(document([theme, audio("clear", { operation: "setBgm" }), line("target")], { assetId: "asset-scene" }), "target");
        expect(soundSetup(cleared)).toEqual([]);

        const stopped = await launchAt(document([
            theme,
            audio("stop", { operation: "stopSound", target: { builtin: "bgm" } }),
            line("target"),
            audio("again", { operation: "resumeSound", target: { builtin: "bgm" } }),
        ]), "target");
        expect(soundSetup(stopped)).toEqual([]);
        // The handle is still the channel's, so a later row addressing the music finds it.
        expect(compiled(stopped).warnings).toEqual([]);
    });

    it("settles the track where the walk left it - turned down and paused - without a moment at its old level", async () => {
        const compiled = await launchAt(document([
            theme,
            audio("quieter", { operation: "setVolume", target: { builtin: "bgm" }, volume: 0.25 }),
            audio("pause", { operation: "pauseSound", target: { builtin: "bgm" } }),
            line("target"),
        ]), "target");

        const id = `${PREFIX}:target:bgm:theme`;
        expect(soundSetup(compiled)).toEqual([
            `sound:mute ${id}`,
            `scene:setBackgroundMusic ${id} fade=0`,
            `sound:setVolume ${id}`,
            `sound:pause ${id}`,
            `sound:mute ${id}`,
        ]);
        const actions = setupActions(compiled);
        expect(actions.find(action => action.type === "sound:setVolume")!.contentNode!.getContent()[0]).toBe(0.25);
        expect(actions.filter(action => action.type === "sound:mute").map(action => action.contentNode!.getContent()[0])).toEqual([true, false]);
    });
});

describe("a row-precise launch and the scene's sounds", () => {
    const rain = audio("rain", { operation: "playSound", objectName: "rain", assetId: "asset-rain", loop: true, volume: 0.4 });

    it("starts a looping sound the walk left playing, under the launch's name for it", async () => {
        const compiled = await launchAt(document([rain, line("target"), audio("stop", { operation: "stopSound", objectName: "rain" })]), "target");

        // The tail's `/stop rain` finds the handle instead of reporting a sound that is not playing.
        expect(errors(compiled)).toEqual([]);
        expect(soundSetup(compiled)).toEqual([`sound:play ${PREFIX}:target:sound:rain`]);
        const play = setupActions(compiled).find(action => action.type === "sound:play")!;
        // At once, at the level its row built it with: a fade on a start holds the story for its length.
        expect(play.contentNode!.getContent()[0]).toEqual({ end: 0.4, duration: 0, waitForEnd: false });
        expect(srcOf(play.callee)).toBe("test://asset-rain");
    });

    it("does not start one the walk stopped, and still builds it for the rows after the target", async () => {
        const compiled = await launchAt(document([
            rain,
            audio("stop", { operation: "stopSound", objectName: "rain" }),
            line("target"),
            audio("quieter", { operation: "setVolume", objectName: "rain", volume: 0.1 }),
        ]), "target");

        expect(errors(compiled)).toEqual([]);
        expect(soundSetup(compiled)).toEqual([]);
        expect(compiled.elementIdBindings).toContain(`${PREFIX}:target:sound:rain`);
    });

    it("does not play again a sound that does not loop - by the target row it has ended", async () => {
        const compiled = await launchAt(document([
            audio("hit", { operation: "playSound", objectName: "hit", assetId: "asset-hit" }),
            line("target"),
        ]), "target");

        expect(soundSetup(compiled)).toEqual([]);
    });

    it("plays a sound whose track loops by default, as its row does", async () => {
        const compiled = await compileStudioStoryToNlr({
            document: document([audio("hum", { operation: "playSound", objectName: "hum", assetId: "asset-hum", audioTrackId: "ambience" }), line("target")]),
            sceneId: SCENE,
            resolveAssetUrl: (assetId: string) => `test://${assetId}`,
            audioTracks: [
                { id: "bgm", name: "Music", parentId: null, volume: 1, loop: true, builtin: true },
                { id: "sound", name: "SFX", parentId: null, volume: 1, loop: false, builtin: true },
                { id: "voice", name: "Voice", parentId: null, volume: 1, loop: false, builtin: true },
                { id: "ambience", name: "Ambience", parentId: "sound", volume: 1, loop: true },
            ],
            launch: {
                targetBlockId: "target",
                snapshot: computeStoryStageSnapshot({
                    document: document([audio("hum", { operation: "playSound", objectName: "hum", assetId: "asset-hum", audioTrackId: "ambience" }), line("target")]),
                    sceneId: SCENE,
                    targetBlockId: "target",
                }),
            },
        } as Parameters<typeof compileStudioStoryToNlr>[0]);

        expect(soundSetup(compiled)).toEqual([`sound:play ${PREFIX}:target:sound:hum`]);
    });

    it("brings a turned-down sound in at its level, muted until it is there", async () => {
        const compiled = await launchAt(document([
            rain,
            audio("quieter", { operation: "setVolume", objectName: "rain", volume: 0.15, fadeMs: 250 }),
            line("target"),
        ]), "target");

        const id = `${PREFIX}:target:sound:rain`;
        expect(soundSetup(compiled)).toEqual([`sound:mute ${id}`, `sound:play ${id}`, `sound:setVolume ${id}`, `sound:mute ${id}`]);
        // The level the row set, at once - its fade finished long before the target row.
        expect(setupActions(compiled).find(action => action.type === "sound:setVolume")!.contentNode!.getContent()).toEqual([0.15, 0]);
    });

    it("keeps a sound the walk muted muted, playing or not", async () => {
        const playing = await launchAt(document([
            rain,
            audio("mute", { operation: "muteSound", objectName: "rain", muted: true }),
            line("target"),
        ]), "target");
        const id = `${PREFIX}:target:sound:rain`;
        expect(soundSetup(playing)).toEqual([`sound:mute ${id}`, `sound:play ${id}`]);

        const stopped = await launchAt(document([
            rain,
            audio("mute", { operation: "muteSound", objectName: "rain", muted: true }),
            audio("stop", { operation: "stopSound", objectName: "rain" }),
            line("target"),
        ]), "target");
        expect(soundSetup(stopped)).toEqual([`sound:mute ${id}`]);
    });

    it("adds nothing a plain compile of the story could also be holding", async () => {
        // The scene the launch stands for is compiled as well, for anything that jumps back to it, so
        // every sound the launch builds must be named apart from that scene's own.
        const doc = document([
            audio("theme", { operation: "setBgm", assetId: "asset-theme" }),
            rain,
            line("target"),
        ], { assetId: "asset-scene" });
        const plain = await compileStudioStoryToNlr({ document: doc, sceneId: SCENE, resolveAssetUrl: (assetId: string) => `test://${assetId}` });
        const launched = await launchAt(doc, "target");

        const added = launched.elementIdBindings.slice(plain.elementIdBindings.length);
        expect(added).toEqual(expect.arrayContaining([`${PREFIX}:target:bgm:theme`, `${PREFIX}:target:sound:rain`]));
        expect(added.filter(id => !id.startsWith("nl:launch:"))).toEqual([]);
        expect(launched.elementIdBindings.slice(0, plain.elementIdBindings.length)).toEqual(plain.elementIdBindings);
    });
});

/**
 * The engine looks a line's take up in the voices table of the scene playing it, so the opening scene
 * of a launch has to carry the table of the scene it stands for. It carried none, and every line from
 * the launch row to the end of that scene played silently while the same lines spoke from the title.
 * Asserted on the scene's own `config.voices`, the table the engine reads, not on anything the
 * compiler holds.
 */
describe("a row-precise launch and the scene's voice takes", () => {
    const takes = { ja: { "first-text": "asset-ja-first", "target-text": "asset-ja-target" }, en: { "target-text": "asset-en-target" } };

    async function launchVoiced(doc: StoryDocument, targetBlockId: string, voiceLocale = "ja"): Promise<Compiled> {
        return compileStudioStoryToNlr({
            document: doc,
            sceneId: SCENE,
            resolveAssetUrl: (assetId: string) => `test://${assetId}`,
            voice: {
                voicedLocales: [{ code: "ja", displayName: "日本語" }, { code: "en", displayName: "English" }],
                tables: takes,
                getVoiceLocale: () => voiceLocale,
            },
            launch: {
                targetBlockId,
                snapshot: computeStoryStageSnapshot({ document: doc, sceneId: SCENE, targetBlockId }),
            },
        });
    }

    const voicesOf = (scene: unknown): Record<string, unknown> | undefined =>
        (scene as { config?: { voices?: Record<string, unknown> } }).config?.voices;

    it("gives the opening scene the takes of the scene it was launched in", async () => {
        const compiled = await launchVoiced(document([line("first"), line("target")]), "target");

        expect(errors(compiled)).toEqual([]);
        expect(compiled.scene).not.toBe(compiled.scenes[SCENE]);
        expect(voicesOf(compiled.scene)).toEqual({ "first-text": "test://asset-ja-first", "target-text": "test://asset-ja-target" });
        // The document's own scene keeps its table, for a jump back to it.
        expect(voicesOf(compiled.scenes[SCENE])).toEqual(voicesOf(compiled.scene));
    });

    it("opens on the dub language in force, and a dub switch reaches the opening scene too", async () => {
        const compiled = await launchVoiced(document([line("first"), line("target")]), "target", "en");
        expect(voicesOf(compiled.scene)).toEqual({ "target-text": "test://asset-en-target" });

        expect(compiled.setVoiceLocale?.("ja")).toBe(true);
        expect(voicesOf(compiled.scene)).toEqual({ "first-text": "test://asset-ja-first", "target-text": "test://asset-ja-target" });
    });

    it("carries no table in a project with no takes, as the scene itself carries none", async () => {
        const compiled = await launchAt(document([line("first"), line("target")]), "target");

        expect(voicesOf(compiled.scene) ?? null).toBeNull();
    });
});

/** The compile's warnings, for the cases where a row in the tail addresses something the launch must have built. */
function compiled(result: Compiled): { warnings: string[] } {
    return { warnings: result.diagnostics.filter(entry => entry.level === "warning").map(entry => entry.message) };
}
