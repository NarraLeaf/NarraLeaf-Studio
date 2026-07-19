import { describe, expect, it } from "vitest";
import { parseVoiceCsv, serializeVoiceCsv, type VoiceCsvRow } from "./voiceCsv";
import { formatVoiceFilename, matchKeyForFilename } from "./voiceNaming";
import { serializeCsv, readCsvTable } from "./csv";

describe("voice CSV round-trip", () => {
    const rows: VoiceCsvRow[] = [
        { filename: "Rooftop_001_Aoi", unitId: "t-d1", character: "Aoi", scene: "Rooftop", line: "We should go.", status: "linked", note: "soft" },
        { filename: "Rooftop_002_Narration", unitId: "t-n1", character: "Narration", scene: "Rooftop", line: "Rain, again,\nalways.", status: "approved", note: "" },
    ];

    it("serializes with a stable header and parses back by column name", () => {
        const csv = serializeVoiceCsv(rows);
        expect(csv.split("\r\n")[0]).toBe("filename,unit_id,character,scene,line,status,note");
        const parsed = parseVoiceCsv(csv);
        expect(parsed.errors).toEqual([]);
        expect(parsed.rows).toEqual(rows);
    });

    it("survives a UTF-8 BOM and reordered/extra columns", () => {
        const reordered = serializeCsv(
            ["unit_id", "extra", "status", "note"],
            [["t-d1", "junk", "approved", "keep"]],
        );
        const parsed = parseVoiceCsv("﻿" + reordered);
        expect(parsed.errors).toEqual([]);
        expect(parsed.rows[0]).toMatchObject({ unitId: "t-d1", status: "approved", note: "keep" });
    });

    it("reports rows missing the authoritative unit id and rejects a headerless file", () => {
        const csv = serializeCsv(["filename", "unit_id"], [["a.wav", ""], ["b.wav", "t-x"]]);
        const parsed = parseVoiceCsv(csv);
        expect(parsed.rows.map(r => r.unitId)).toEqual(["t-x"]);
        expect(parsed.errors).toHaveLength(1);
        expect(parseVoiceCsv("filename\na.wav").errors[0]).toContain("unit_id");
    });
});

describe("voice filename convention", () => {
    it("fills tokens, zero-pads the index, and sanitises segments", () => {
        const name = formatVoiceFilename("{scene}_{index}_{character}", {
            scene: "Rooftop Scene",
            index: 7,
            character: "Aoi",
            locale: "ja",
            unitId: "t-d1",
        });
        expect(name).toBe("RooftopScene_007_Aoi");
    });

    it("preserves folder separators in the pattern but neutralises them inside tokens", () => {
        const name = formatVoiceFilename("{locale}/{scene}/{index}", {
            scene: "Act 1/Rooftop",
            index: 3,
            character: "Aoi",
            locale: "ja",
            unitId: "t-d1",
        });
        expect(name).toBe("ja/Act1Rooftop/003");
    });

    it("derives a match key that ignores folders, extension, case, and punctuation", () => {
        expect(matchKeyForFilename("takes/Rooftop_007_Aoi.wav")).toBe("rooftop007aoi");
        expect(matchKeyForFilename("Rooftop 007 Aoi.WAV")).toBe("rooftop007aoi");
    });

    it("round-trips: a formatted name matches its imported file's key regardless of extension", () => {
        const base = formatVoiceFilename("{scene}_{index}_{character}", {
            scene: "Rooftop", index: 7, character: "Aoi", locale: "ja", unitId: "t-d1",
        });
        expect(matchKeyForFilename(`${base}.mp3`)).toBe(matchKeyForFilename(base));
    });
});

describe("readCsvTable", () => {
    it("returns null for an empty document", () => {
        expect(readCsvTable("")).toBeNull();
    });
});
