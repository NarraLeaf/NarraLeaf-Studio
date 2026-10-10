import { describe, expect, it, vi } from "vitest";
import type { AgentCallResult } from "@shared/agent/protocol";
import type { StoryBlock } from "@shared/types/story";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import {
    createEmptyLocalizationDocument,
    type LocalizationConfiguration,
    type LocalizationKeysDocument,
} from "@shared/types/localization";
import { createEmptyVoiceDocument, DEFAULT_VOICE_CONFIGURATION, type VoiceConfiguration } from "@shared/types/voice";
import { hashSourceText } from "@shared/utils/localizationText";
import { HistoryService } from "../history/HistoryService";
import { projectHistoryScope } from "../history/historyScopes";
import { Services } from "../services";
import { StoryService } from "../story/StoryService";
import { LocalizationService } from "../localization/LocalizationService";
import { VoiceService } from "../voice/VoiceService";
import { AgentFollowService, type AgentWriteTarget } from "./AgentFollowService";
import { AgentRefusal, type AgentToolContext, type AgentToolHandler } from "./agentCall";
import { localizationList, localizationSet, localizationStatus } from "./tools/localizationTools";
import { planAutoLink, voiceAutoLink, voiceLink, voiceList, voiceSettingsSet, voiceStatus } from "./tools/voiceTools";
import type { AgentVoiceLine } from "./translationUnits";

vi.mock("@/lib/app/writeFreeze", () => ({ getProjectWriteFreeze: () => null }));

/**
 * The translation and voice tools over real story, localization, voice and history services: what
 * they list, that a batch write is one step of undo that takes every unit back, and what they refuse.
 */

function line(id: string, action: "dialogue" | "narration", value: string, extra: Partial<{ characterId: string; rich: unknown[] }> = {}): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds: [],
        payload: {
            action,
            ...(extra.characterId ? { characterId: extra.characterId } : {}),
            text: { textId: `t-${id}`, value, role: action, ...(extra.rich ? { rich: extra.rich } : {}) },
        },
    } as StoryBlock;
}

const emptyInterface = (): UIDocument => ({
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    name: "Doc",
    surfaces: [],
    elements: {},
    components: [],
    meta: {},
} as unknown as UIDocument);

type AudioAsset = { id: string; name: string; type: string; groupId?: string };

function createHarness(options: { audio?: AudioAsset[] } = {}) {
    const history = new HistoryService();
    const story = new StoryService();
    const localization = new LocalizationService();
    const voice = new VoiceService();
    let localizationConfig: LocalizationConfiguration = {
        sourceLocale: "en",
        locales: [{ code: "en", displayName: "English" }, { code: "ja", displayName: "日本語" }],
    };
    let voiceConfig: VoiceConfiguration = { ...DEFAULT_VOICE_CONFIGURATION, voicedLocales: [{ code: "ja", displayName: "日本語" }] };
    const audio: Record<string, AudioAsset> = Object.fromEntries((options.audio ?? []).map(asset => [asset.id, asset]));
    let nextId = 0;
    const uuid = () => `00000000-0000-4000-8000-${(++nextId).toString(16).padStart(12, "0")}`;
    const ok = async () => ({ ok: true as const, data: undefined });
    const fs = {
        writeFileNoFollowOrCreate: vi.fn(ok),
        read: vi.fn(async () => ({ ok: false as const, error: { message: "missing", code: "ENOENT" } })),
        deleteFile: vi.fn(ok),
        deleteDir: vi.fn(ok),
        isFileExists: vi.fn(async () => ({ ok: true as const, data: false })),
        isDirExists: vi.fn(async () => ({ ok: true as const, data: true })),
        createDir: vi.fn(ok),
        mkdir: vi.fn(ok),
    };
    const project = {
        getProjectConfig: () => ({ metadata: { resolution: { width: 1280, height: 720 } } }),
        getLocalizationConfiguration: () => localizationConfig,
        updateLocalizationConfiguration: async (updater: (config: LocalizationConfiguration) => LocalizationConfiguration) => {
            localizationConfig = updater(localizationConfig);
            return localizationConfig;
        },
        getVoiceConfiguration: () => voiceConfig,
        updateVoiceConfiguration: async (updater: (config: VoiceConfiguration) => VoiceConfiguration) => {
            voiceConfig = updater(voiceConfig);
            return voiceConfig;
        },
    };
    const characters = [{ profile: { getId: () => "c-aoi", getName: () => "Aoi" } }];
    const context = {
        project: { resolve: (...parts: (string | string[])[]) => parts.flatMap(part => (Array.isArray(part) ? part : [part])).join("/") },
        services: {
            get(id: Services) {
                switch (id) {
                    case Services.History: return history;
                    case Services.FileSystem: return fs;
                    case Services.Uuid: return { generate: uuid };
                    case Services.Project: return project;
                    case Services.Story: return story;
                    case Services.Localization: return localization;
                    case Services.Voice: return voice;
                    case Services.UIDocument: return { getDocument: emptyInterface };
                    case Services.Character: return { listCharacter: () => characters, getCharacter: (id: string) => characters.find(c => c.profile.getId() === id) };
                    case Services.Assets:
                        return {
                            getAssets: () => ({ audio }),
                            getGroupAssetsManager: () => ({ getGroups: () => [{ id: "g-voice", name: "Voice JA" }] }),
                        };
                    default: throw new Error(`Unexpected service ${id}`);
                }
            },
        } as never,
        commandLineRun: false,
    } as never;
    for (const service of [history, story, localization, voice]) {
        service.setContext(context);
    }
    (story as never as { index: unknown }).index = { schemaVersion: 1, stories: [], meta: {} };
    (story as never as { animationIndex: unknown }).animationIndex = { schemaVersion: 1, animations: [], meta: {} };
    for (const service of [localization, voice]) {
        (service as never as { scheduleAutoSave: () => void }).scheduleAutoSave = () => undefined;
    }
    (localization as never as { documents: Map<string, unknown> }).documents.set("ja", createEmptyLocalizationDocument("ja"));
    const keys: LocalizationKeysDocument = { schemaVersion: 1, keys: { "menu.greet": { sourceText: "Hello, {name}" } } };
    (localization as never as { keysDocument: LocalizationKeysDocument }).keysDocument = keys;
    (voice as never as { documents: Map<string, unknown> }).documents.set("ja", createEmptyVoiceDocument("ja"));

    const entry = story.createStory("Tale");
    const sceneId = story.getStoryDocument(entry.id).chapters[0].sceneIds[0];
    story.renameScene(entry.id, sceneId, "Opening");
    story.insertBlock(entry.id, sceneId, line("a", "narration", "It was raining."), { parentId: null });
    story.insertBlock(entry.id, sceneId, line("b", "dialogue", "Hi there.", { characterId: "c-aoi" }), { parentId: null });
    story.insertBlock(entry.id, sceneId, line("c", "dialogue", "That was really close.", {
        characterId: "c-aoi",
        rich: [{ text: "That was " }, { text: "really", marks: { bold: true } }, { text: " close." }],
    }), { parentId: null });

    const follow = new AgentFollowService();
    const writes: AgentWriteTarget[] = [];
    follow.onWrote(target => writes.push(target));
    const tool: AgentToolContext = {
        ctx: context,
        request: { callId: "call-1", tool: "test", args: {}, clientName: null, policy: { writesEnabled: true, allowedImportRoots: [] }, deadline: Date.now() + 60_000 },
        follow,
        offscreen: null as never,
        log: () => undefined,
    };
    const run = (handler: AgentToolHandler, args: Record<string, unknown>) => handler(args, tool);
    const steps = () => history.describe().find(stack => stack.scopeId === projectHistoryScope())?.undo ?? 0;
    return {
        story, localization, voice, history, storyId: entry.id, sceneId, writes, run, steps,
        localizationConfig: () => localizationConfig,
        voiceConfig: () => voiceConfig,
    };
}

function structured(result: AgentCallResult): Record<string, unknown> {
    if (!result.ok) {
        throw new Error(`refused: ${result.error.code} ${result.error.message}`);
    }
    return result.structured ?? {};
}

async function refusal(promise: Promise<AgentCallResult>): Promise<AgentRefusal> {
    try {
        await promise;
    } catch (error) {
        if (error instanceof AgentRefusal) {
            return error;
        }
        throw error;
    }
    throw new Error("expected a refusal");
}

type ListedUnit = { id: string; kind: string; where: string; speaker?: string; source: string; target?: string; status: string; rev: string };

describe("localization tools", () => {
    it("lists every origin's units with where they are, and pages through them", async () => {
        const harness = createHarness();
        const all = structured(await harness.run(localizationList, { language: "ja" }));
        const units = all.units as ListedUnit[];
        expect(units.map(unit => unit.id)).toEqual(expect.arrayContaining(["char:c-aoi", "t-a", "t-b", "t-c", "key:menu.greet"]));
        const hi = units.find(unit => unit.id === "t-b")!;
        expect(hi).toMatchObject({ kind: "dialogue", speaker: "Aoi", where: "Opening, row 2", source: "Hi there.", status: "missing" });
        // A styled line is shown with its run tags, which is what the translation has to carry.
        expect(units.find(unit => unit.id === "t-c")!.source).toBe("That was ‹1›really‹/1› close.");

        const first = structured(await harness.run(localizationList, { language: "ja", origin: "story", limit: 2 }));
        expect((first.units as ListedUnit[]).map(unit => unit.id)).toEqual(["t-a", "t-b"]);
        expect(first.total).toBe(3);
        const second = structured(await harness.run(localizationList, { language: "ja", origin: "story", limit: 2, cursor: first.nextCursor }));
        expect((second.units as ListedUnit[]).map(unit => unit.id)).toEqual(["t-c"]);
        expect(second.nextCursor).toBeNull();
    });

    it("writes a batch as one step of undo, and undo takes every unit back", async () => {
        const harness = createHarness();
        const listed = (structured(await harness.run(localizationList, { language: "ja", origin: "story" })).units as ListedUnit[]);
        const result = structured(await harness.run(localizationSet, {
            language: "ja",
            entries: listed.map(unit => ({ unitId: unit.id, target: `JA ${unit.id}`, rev: unit.rev })),
        }));
        expect(result.written).toBe(3);
        expect(harness.steps()).toBe(1);
        const document = harness.localization.getDocumentIfLoaded("ja")!;
        expect(document.units["t-a"]).toMatchObject({ target: "JA t-a", status: "machine" });
        expect(harness.writes[0]).toMatchObject({ kind: "translation", locale: "ja", unitId: "t-a", storyId: harness.storyId });

        expect(harness.history.undo(projectHistoryScope())).toBe(true);
        expect(harness.localization.getDocumentIfLoaded("ja")!.units).toEqual({});
        expect(harness.history.redo(projectHistoryScope())).toBe(true);
        expect(Object.keys(harness.localization.getDocumentIfLoaded("ja")!.units).sort()).toEqual(["t-a", "t-b", "t-c"]);

        const status = structured(await harness.run(localizationStatus, { language: "ja" }));
        const ja = (status.languages as { code: string; done: number; byOrigin: Record<string, { done: number }> }[])[0];
        expect(ja.byOrigin.story.done).toBe(3);
        expect((status.scenes as { scene: string; lines: number; missing: number }[])[0]).toMatchObject({ scene: "Opening", lines: 3, missing: 0 });
    });

    it("refuses unknown unit ids, listing them, and writes nothing", async () => {
        const harness = createHarness();
        const refused = await refusal(harness.run(localizationSet, {
            language: "ja",
            entries: [{ unitId: "t-a", target: "雨" }, { unitId: "t-gone", target: "x" }],
        }));
        expect(refused.code).toBe("not_found");
        expect(refused.message).toContain("t-gone");
        expect(harness.localization.getDocumentIfLoaded("ja")!.units).toEqual({});
        expect(harness.steps()).toBe(0);
    });

    it("refuses to write the source language", async () => {
        const harness = createHarness();
        const refused = await refusal(harness.run(localizationSet, { language: "en", entries: [{ unitId: "t-a", target: "Rain" }] }));
        expect(refused.code).toBe("invalid_args");
        expect(refused.message).toContain("source language");
    });

    it("warns, without refusing, when a translation drops a run tag, a placeholder or a line break", async () => {
        const harness = createHarness();
        const result = structured(await harness.run(localizationSet, {
            language: "ja",
            entries: [
                { unitId: "t-c", target: "本当に危なかった。" },
                { unitId: "key:menu.greet", target: "こんにちは" },
                { unitId: "t-a", target: "雨が\n降っていた。" },
            ],
        }));
        expect(result.written).toBe(3);
        const warnings = result.warnings as { id: string; problems: string[] }[];
        expect(warnings.find(item => item.id === "t-c")!.problems.join(" ")).toContain("‹1›");
        expect(warnings.find(item => item.id === "key:menu.greet")!.problems.join(" ")).toContain("{name}");
        expect(warnings.find(item => item.id === "t-a")!.problems.join(" ")).toContain("line break");
    });

    it("skips a unit whose source changed since it was listed, and says what it reads now", async () => {
        const harness = createHarness();
        const listed = (structured(await harness.run(localizationList, { language: "ja", origin: "story" })).units as ListedUnit[]);
        const rev = listed.find(unit => unit.id === "t-a")!.rev;
        const scene = harness.story.getStoryDocument(harness.storyId).scenes[harness.sceneId];
        const block = scene.blocks["a"] as Extract<StoryBlock, { kind: "nodeAction" }>;
        (block.payload as { text: { value: string } }).text.value = "It was snowing.";
        const result = structured(await harness.run(localizationSet, { language: "ja", entries: [{ unitId: "t-a", target: "雨", rev }] }));
        expect(result.written).toBe(0);
        expect((result.changedSinceRead as { id: string; source: string }[])[0]).toMatchObject({ id: "t-a", source: "It was snowing." });
        expect(harness.steps()).toBe(0);
    });

    it("skips a unit whose translation the author typed since it was listed, and leaves the author's words", async () => {
        const harness = createHarness();
        const listed = (structured(await harness.run(localizationList, { language: "ja", origin: "story" })).units as ListedUnit[]);
        const rev = (id: string) => listed.find(unit => unit.id === id)!.rev;
        harness.localization.applyUnitEdits("ja", {
            set: { "t-a": { target: "雨が降っていた。", sourceHash: hashSourceText("It was raining."), status: "reviewed" } },
            remove: [],
        });
        const result = structured(await harness.run(localizationSet, {
            language: "ja",
            entries: [{ unitId: "t-a", target: "雨", rev: rev("t-a") }, { unitId: "t-b", target: "やあ", rev: rev("t-b") }],
        }));
        expect(result.written).toBe(1);
        expect(result.changedSinceRead).toBeUndefined();
        expect((result.translationChangedSinceRead as { id: string; target: string; status: string }[])).toEqual([
            expect.objectContaining({ id: "t-a", target: "雨が降っていた。", status: "reviewed" }),
        ]);
        const units = harness.localization.getDocumentIfLoaded("ja")!.units;
        expect(units["t-a"]).toMatchObject({ target: "雨が降っていた。", status: "reviewed" });
        expect(units["t-b"]).toMatchObject({ target: "やあ" });

        // Listed again, the unit carries the author's words and a rev that lets an overwrite through.
        const again = (structured(await harness.run(localizationList, { language: "ja", origin: "story" })).units as ListedUnit[]);
        const fresh = again.find(unit => unit.id === "t-a")!;
        expect(fresh.target).toBe("雨が降っていた。");
        expect(fresh.rev).not.toBe(rev("t-a"));
        const overwrite = structured(await harness.run(localizationSet, { language: "ja", entries: [{ unitId: "t-a", target: "雨", rev: fresh.rev }] }));
        expect(overwrite.written).toBe(1);
    });
});

describe("voice tools", () => {
    const voiceAudio: AudioAsset[] = [
        { id: "au-1", name: "Opening_001_Narration", type: "audio", groupId: "g-voice" },
        { id: "au-2", name: "opening 002 aoi", type: "audio", groupId: "g-voice" },
        // Two assets share the third line's name: never guessed at.
        { id: "au-3", name: "Opening_003_Aoi", type: "audio", groupId: "g-voice" },
        { id: "au-4", name: "Opening-003-Aoi", type: "audio", groupId: "g-voice" },
        { id: "au-5", name: "stray_take", type: "audio", groupId: "g-voice" },
    ];

    it("reports the naming rule and lists each line with the file name it expects", async () => {
        const harness = createHarness({ audio: voiceAudio });
        const status = structured(await harness.run(voiceStatus, {}));
        expect(status.namingPattern).toBe("{scene}_{index}_{character}");
        const lines = structured(await harness.run(voiceList, { language: "ja" })).lines as { id: string; expect: string; status: string }[];
        expect(lines.map(item => item.expect)).toEqual(["Opening_001_Narration", "Opening_002_Aoi", "Opening_003_Aoi"]);
        expect(lines.every(item => item.status === "missing")).toBe(true);
    });

    it("auto-links by name in one step of undo, and reports ambiguity, gaps and strays", async () => {
        const harness = createHarness({ audio: voiceAudio });
        const dry = structured(await harness.run(voiceAutoLink, { language: "ja", assetFolder: "Voice JA", dryRun: true }));
        expect(dry.linked).toBe(2);
        expect(harness.steps()).toBe(0);

        const result = structured(await harness.run(voiceAutoLink, { language: "ja", assetFolder: "Voice JA" }));
        expect(result.linked).toBe(2);
        expect((result.ambiguous as { expect: string; assets: string[] }[])[0]).toMatchObject({ expect: "Opening_003_Aoi" });
        expect(result.unmatchedAssets).toEqual(["stray_take"]);
        expect(harness.steps()).toBe(1);
        const takes = harness.voice.getDocumentIfLoaded("ja")!.units;
        expect(takes["t-a"]).toMatchObject({ assetId: "au-1", status: "linked" });
        expect(takes["t-b"]).toMatchObject({ assetId: "au-2" });

        expect(harness.history.undo(projectHistoryScope())).toBe(true);
        expect(harness.voice.getDocumentIfLoaded("ja")!.units).toEqual({});

        const unlinked = structured(await harness.run(voiceList, { language: "ja", unlinkedOnly: true })).lines as { id: string }[];
        expect(unlinked.map(item => item.id)).toEqual(["t-a", "t-b", "t-c"]);
    });

    it("links by hand as one step, approves an existing take, and refuses what does not resolve", async () => {
        const harness = createHarness({ audio: voiceAudio });
        await harness.run(voiceLink, { language: "ja", links: [{ unitId: "t-c", asset: "au-3" }, { unitId: "t-a", asset: "Opening_001_Narration" }] });
        expect(harness.steps()).toBe(1);
        await harness.run(voiceLink, { language: "ja", links: [{ unitId: "t-c", status: "approved" }] });
        expect(harness.voice.getDocumentIfLoaded("ja")!.units["t-c"]).toMatchObject({ assetId: "au-3", status: "approved" });
        expect(harness.steps()).toBe(2);

        const refused = await refusal(harness.run(voiceLink, { language: "ja", links: [{ unitId: "t-b", asset: "nope" }, { unitId: "t-x", asset: "au-1" }] }));
        expect(refused.message).toContain("nope");
        expect(refused.message).toContain("t-x");
        expect(harness.steps()).toBe(2);

        harness.history.undo(projectHistoryScope());
        expect(harness.voice.getDocumentIfLoaded("ja")!.units["t-c"]).toMatchObject({ status: "linked" });
    });

    it("adds and refuses to silently drop voice languages, as one step of undo", async () => {
        const harness = createHarness();
        await harness.run(voiceSettingsSet, { languages: ["ja", "en"] });
        expect(harness.voiceConfig().voicedLocales.map(locale => locale.code)).toEqual(["ja", "en"]);
        expect(harness.steps()).toBe(1);
        harness.history.undo(projectHistoryScope());
        await harness.history.settled();
        expect(harness.voiceConfig().voicedLocales.map(locale => locale.code)).toEqual(["ja"]);
    });
});

describe("planAutoLink", () => {
    const voiced = (unitId: string, expectedName: string, matchKey: string): AgentVoiceLine => ({
        unitId, storyId: "s", sceneId: "sc", sceneName: "S", indexInScene: 1, speaker: "A", role: "dialogue",
        text: unitId, where: unitId, expectedName, matchKey,
    });

    it("treats a name two lines share as ambiguous even when only one is in scope", () => {
        const lines = [voiced("one", "S_001_A", "s001a"), voiced("two", "S_001_A", "s001a")];
        const plan = planAutoLink(lines, line => line.unitId === "one", [{ id: "x", name: "S_001_A" }], {}, false);
        expect(plan.matched).toEqual([]);
        expect(plan.ambiguous[0].lines.map(line => line.unitId)).toEqual(["one", "two"]);
    });

    it("leaves a line's other take alone unless asked to relink", () => {
        const lines = [voiced("one", "S_001_A", "s001a")];
        const takes = { one: { assetId: "old", sourceHash: "h", status: "approved" as const } };
        expect(planAutoLink(lines, () => true, [{ id: "new", name: "S_001_A" }], takes, false).keptOtherTake).toHaveLength(1);
        expect(planAutoLink(lines, () => true, [{ id: "new", name: "S_001_A" }], takes, true).matched).toHaveLength(1);
    });
});
