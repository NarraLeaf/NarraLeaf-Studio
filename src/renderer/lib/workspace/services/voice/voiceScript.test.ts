import { describe, expect, it } from "vitest";
import { hashSourceText } from "@shared/utils/localizationText";
import type { VoiceDocument } from "@shared/types/voice";
import { VOICE_DOCUMENT_SCHEMA_VERSION } from "@shared/types/voice";
import {
    buildRecordingScriptRows,
    buildVoiceNameKeyMap,
    matchImportedFiles,
    withSceneIndices,
    type VoiceScriptEntry,
} from "./voiceScript";

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
