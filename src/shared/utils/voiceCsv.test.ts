import { describe, expect, it } from "vitest";
import { normalizeVoiceCsvStatus, parseVoiceCsv, serializeVoiceCsv, type VoiceCsvRow } from "./voiceCsv";
import { formatVoiceFilename, matchKeyForFilename } from "./voiceNaming";
import { serializeCsv, readCsvTable } from "./csv";

describe("voice CSV round-trip", () => {
    const rows: VoiceCsvRow[] = [
        { filename: "Rooftop_001_Aoi", unitId: "t-d1", character: "Aoi", scene: "Rooftop", line: "We should go.", status: "linked", note: "soft" },
        { filename: "Rooftop_002_Narration", unitId: "t-n1", character: "Narration", scene: "Rooftop", line: "Rain, again,\nalways.", status: "approved", note: "" },
    ];

    it("serializes with a stable header and parses back by column name", () => {
        const csv = serializeVoiceCsv(rows);
        // The people reading it get words, and the id comes last, named as the one machine column.
        expect(csv.split("\r\n")[0]).toBe("File name,Speaker,Scene,Line,Status,Note,Line ID");
        expect(csv.split("\r\n")[1]).toBe("Rooftop_001_Aoi,Aoi,Rooftop,We should go.,Voiced,soft,t-d1");
        const parsed = parseVoiceCsv(csv);
        expect(parsed.problems).toEqual([]);
        // Each row read back knows where it sat, as a spreadsheet numbers it: the header is row 1.
        expect(parsed.rows).toEqual(rows.map((row, index) => ({ ...row, row: index + 2 })));
    });

    it("writes the headers and status words in the language asked for, and reads them back from any", () => {
        const zh = serializeVoiceCsv(rows, "zh");
        expect(zh.split("\r\n")[0]).toBe("文件名,说话人,场景,文本,状态,备注,行 ID");
        expect(zh.split("\r\n")[1]).toBe("Rooftop_001_Aoi,Aoi,Rooftop,We should go.,已配音,soft,t-d1");
        for (const locale of ["zh", "ja", "en"] as const) {
            const parsed = parseVoiceCsv(serializeVoiceCsv(rows, locale));
            expect(parsed.problems).toEqual([]);
            expect(parsed.rows.map(row => [row.unitId, row.status, row.note])).toEqual([
                ["t-d1", "linked", "soft"],
                ["t-n1", "approved", ""],
            ]);
        }
        expect(normalizeVoiceCsvStatus("已审听")).toBe("approved");
        expect(normalizeVoiceCsvStatus("承認済み")).toBe("approved");
        expect(normalizeVoiceCsvStatus("待更新")).toBe("stale");
    });

    it("still reads a script written with the old English ids", () => {
        const old = serializeCsv(
            ["filename", "unit_id", "character", "scene", "line", "status", "note"],
            [["Rooftop_001_Aoi", "t-d1", "Aoi", "Rooftop", "We should go.", "approved", "keep"]],
        );
        const parsed = parseVoiceCsv("﻿" + old);
        expect(parsed.problems).toEqual([]);
        expect(parsed.rows[0]).toMatchObject({ filename: "Rooftop_001_Aoi", unitId: "t-d1", status: "approved", note: "keep" });
    });

    it("survives a UTF-8 BOM and reordered/extra columns", () => {
        const reordered = serializeCsv(
            ["unit_id", "extra", "status", "note"],
            [["t-d1", "junk", "approved", "keep"]],
        );
        const parsed = parseVoiceCsv("﻿" + reordered);
        expect(parsed.problems).toEqual([]);
        expect(parsed.rows[0]).toMatchObject({ unitId: "t-d1", status: "approved", note: "keep" });
    });

    it("reports rows missing the authoritative unit id and rejects a headerless file", () => {
        const csv = serializeCsv(["filename", "unit_id"], [["a.wav", ""], ["b.wav", "t-x"]]);
        const parsed = parseVoiceCsv(csv);
        expect(parsed.rows.map(r => r.unitId)).toEqual(["t-x"]);
        expect(parsed.problems).toEqual([{ code: "missingId", at: { row: 2 } }]);
        expect(parseVoiceCsv("filename\na.wav").problems).toEqual([{ code: "noIdColumn" }]);
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
