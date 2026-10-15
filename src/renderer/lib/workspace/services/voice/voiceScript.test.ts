import { describe, expect, it } from "vitest";
import { hashSourceText } from "@shared/utils/localizationText";
import type { VoiceDocument } from "@shared/types/voice";
import { VOICE_DOCUMENT_SCHEMA_VERSION } from "@shared/types/voice";
import {
    buildRecordingScriptRows,
    buildVoiceNameKeyMap,
    buildAssetNameKeyMap,
    matchImportedFiles,
    voiceLineSpeaker,
    voiceMatchKeyForEntry,
    voiceMatchKeysForEntry,
    withSceneIndices,
    type VoiceScriptEntry,
} from "./voiceScript";
import { matchKeyForFilename } from "@shared/utils/voiceNaming";

const PATTERN = "{scene}_{index}_{character}";

const ENTRIES: VoiceScriptEntry[] = [
    { unitId: "t-n1", sceneName: "Rooftop", indexInScene: 1, speaker: "Narration", sourceText: "Rain again." },
    { unitId: "t-d1", sceneName: "Rooftop", indexInScene: 2, speaker: "Aoi", sourceText: "We should go." },
    { unitId: "t-d2", sceneName: "Hallway", indexInScene: 1, speaker: "Aoi", sourceText: "Wait." },
];

function doc(units: VoiceDocument["units"]): VoiceDocument {
    return { schemaVersion: VOICE_DOCUMENT_SCHEMA_VERSION, locale: "ja", units };
}

describe("withSceneIndices", () => {
    it("numbers rows 1-based within each scene, resetting per scene", () => {
        const rows = withSceneIndices([
            { sceneId: "a" }, { sceneId: "a" }, { sceneId: "b" }, { sceneId: "a" },
        ]);
        expect(rows.map(r => r.indexInScene)).toEqual([1, 2, 1, 3]);
    });
});

describe("buildRecordingScriptRows", () => {
    it("emits human filenames, the authoritative unit id, context, and current status", () => {
        const document = doc({ "t-n1": { assetId: "a1", sourceHash: hashSourceText("Rain again."), status: "approved", note: "soft" } });
        const rows = buildRecordingScriptRows(ENTRIES, PATTERN, "ja", document);
        expect(rows[0]).toEqual({
            filename: "Rooftop_001_Narration",
            unitId: "t-n1",
            character: "Narration",
            scene: "Rooftop",
            line: "Rain again.",
            status: "approved",
            note: "soft",
        });
        expect(rows[1].status).toBe("missing");
        expect(rows[1].filename).toBe("Rooftop_002_Aoi");
    });
});

describe("buildVoiceNameKeyMap + matchImportedFiles", () => {
    it("reverse-matches imported files to units by filename, ignoring folders/extension/case", () => {
        const keyMap = buildVoiceNameKeyMap(ENTRIES, PATTERN, "ja");
        const result = matchImportedFiles(
            ["takes/ja/Rooftop_002_Aoi.wav", "Hallway_001_Aoi.MP3", "leftover_take.wav"],
            keyMap,
        );
        expect(result.matched.map(m => m.unitId)).toEqual(["t-d1", "t-d2"]);
        expect(result.matched[0].sourceText).toBe("We should go.");
        expect(result.unmatched).toEqual(["leftover_take.wav"]);
    });

    /**
     * A speaker whose name has a dot. Reading `.Hara` off the expected name as an extension made the
     * line expect `…_ms`, so the booth's correctly named file never matched.
     */
    it("matches a speaker whose name has a dot", () => {
        const dotted: VoiceScriptEntry[] = [
            { unitId: "t-h", sceneName: "Walk together", indexInScene: 5, speaker: "Ms. Hara", sourceText: "Morning." },
            { unitId: "t-m", sceneName: "Walk together", indexInScene: 6, speaker: "Ms", sourceText: "Hi." },
        ];
        const keyMap = buildVoiceNameKeyMap(dotted, PATTERN, "en");
        const result = matchImportedFiles(["Walktogether_005_Ms.Hara.wav", "Walktogether_006_Ms.wav"], keyMap);

        expect(result.matched.map(m => m.unitId)).toEqual(["t-h", "t-m"]);
        expect(voiceMatchKeyForEntry(dotted[0], PATTERN, "en")).toBe("walktogether005mshara");
        // An asset keeps the extension it was imported with, and is matched with it dropped.
        expect(buildAssetNameKeyMap([{ id: "a1", name: "Walktogether_005_Ms.Hara.wav" }])
            .get(voiceMatchKeyForEntry(dotted[0], PATTERN, "en"))).toBe("a1");
    });

    it("drops ambiguous keys rather than mis-linking", () => {
        // Two lines that collapse to the same filename (same scene/index/speaker).
        const collide: VoiceScriptEntry[] = [
            { unitId: "t-a", sceneName: "S", indexInScene: 1, speaker: "X", sourceText: "one" },
            { unitId: "t-b", sceneName: "S", indexInScene: 1, speaker: "X", sourceText: "two" },
        ];
        const keyMap = buildVoiceNameKeyMap(collide, PATTERN, "ja");
        expect(matchImportedFiles(["S_001_X.wav"], keyMap).matched).toEqual([]);
    });
});

describe("assign-time name matching", () => {
    const entry = {
        unitId: "t-1",
        sceneName: "First Day",
        indexInScene: 2,
        speaker: "Nattou",
        sourceText: "hi",
    };

    it("keys a line by the name its take is expected to carry", () => {
        expect(voiceMatchKeyForEntry(entry, "{scene}_{index}_{character}", "ja")).toBe("firstday002nattou");
    });

    /**
     * The library name, not the imported filename. That name is the one an author sees and can
     * rename, and renaming is the only repair available for a clip that arrived badly named.
     */
    it("finds the asset whose library name matches, however it was punctuated", () => {
        const assets = buildAssetNameKeyMap([
            { id: "a1", name: "FirstDay_002_Nattou" },
            { id: "a2", name: "first day - 003 - youki.wav" },
        ]);

        expect(assets.get(voiceMatchKeyForEntry(entry, "{scene}_{index}_{character}", "ja"))).toBe("a1");
        expect(assets.get(matchKeyForFilename("FirstDay 003 YouKi"))).toBe("a2");
    });

    it("matches a CJK cast the same way", () => {
        const key = voiceMatchKeyForEntry(
            { ...entry, sceneName: "序章", speaker: "優希" },
            "{scene}_{index}_{character}",
            "ja",
        );
        expect(buildAssetNameKeyMap([{ id: "a1", name: "序章_002_優希" }]).get(key)).toBe("a1");
    });

    it("drops a key two assets share rather than guessing between them", () => {
        const assets = buildAssetNameKeyMap([
            { id: "a1", name: "FirstDay_002_Nattou" },
            { id: "a2", name: "firstday 002 nattou" },
        ]);

        expect(assets.size).toBe(0);
    });

    it("ignores an asset whose name reduces to nothing", () => {
        expect(buildAssetNameKeyMap([{ id: "a1", name: "---" }]).size).toBe(0);
    });
});

describe("the speaker a narration line is named by", () => {
    const narration = { role: "narration" as const };
    const noCharacter = () => undefined;

    it("is the project's word for narration, not the interface's", () => {
        expect(voiceLineSpeaker(narration, noCharacter, "zh-CN").speaker).toBe("旁白");
        expect(voiceLineSpeaker(narration, noCharacter, "en").speaker).toBe("Narration");
        expect(voiceLineSpeaker(narration, noCharacter, "ja").speaker).toBe("地の文");
    });

    it("is a character's own name on her lines", () => {
        const line = voiceLineSpeaker({ role: "dialogue", characterId: "c1" }, () => "Narra", "zh");
        expect(line).toEqual({ speaker: "Narra", speakerAliases: [] });
    });

    /** Both directions: a take named under another language's word still finds its line. */
    it.each([
        ["zh-CN", "放学后_001_Narration.wav"],
        ["zh-CN", "放学后_001_地の文.wav"],
        ["en", "放学后_001_旁白.wav"],
        ["ja", "放学后_001_Narration.wav"],
    ])("in a %s project still matches %s", (sourceLocale, file) => {
        const entry: VoiceScriptEntry = {
            unitId: "t-n",
            sceneName: "放学后",
            indexInScene: 1,
            ...voiceLineSpeaker(narration, noCharacter, sourceLocale),
            sourceText: "走廊的灯一盏一盏熄了。",
        };
        const keyMap = buildVoiceNameKeyMap([entry], PATTERN, "zh");
        expect(matchImportedFiles([file], keyMap).matched.map(m => m.unitId)).toEqual(["t-n"]);
        // The assign picker's preselection answers the same.
        const assets = buildAssetNameKeyMap([{ id: "a1", name: file }]);
        expect(voiceMatchKeysForEntry(entry, PATTERN, "zh").map(key => assets.get(key)).filter(Boolean)).toEqual(["a1"]);
    });

    it("is exported under the project's word, so the script and the import agree", () => {
        const entry: VoiceScriptEntry = {
            unitId: "t-n", sceneName: "放学后", indexInScene: 1,
            ...voiceLineSpeaker(narration, noCharacter, "zh-CN"), sourceText: "…",
        };
        const [row] = buildRecordingScriptRows([entry], PATTERN, "zh", undefined);
        expect(row.filename).toBe("放学后_001_旁白");
    });
});
