import { describe, expect, it } from "vitest";
import { parseTranslationCsv, serializeTranslationCsv, type TranslationCsvRow } from "./localizationCsv";
import { validatePlaceholderParity } from "./localizationText";

const row = (partial: Partial<TranslationCsvRow>): TranslationCsvRow => ({
    unitId: "u1",
    context: "",
    source: "",
    target: "",
    status: "",
    note: "",
    ...partial,
});

describe("translation csv round-trip", () => {
    it("escapes quotes, commas, and newlines and parses them back", () => {
        const rows = [
            row({ unitId: "t-1", context: "Scene A · Alice", source: "He said \"go\", now.", target: "多行\n译文", status: "translated", note: "备注, 带逗号" }),
            row({ unitId: "key:menu.start", source: "Start", target: "开始" }),
        ];
        const csv = serializeTranslationCsv(rows);
        const parsed = parseTranslationCsv(csv);
        expect(parsed.errors).toEqual([]);
        expect(parsed.rows).toEqual(rows);
    });

    it("tolerates reordered and extra columns, keying by header", () => {
        const csv = "target,extra,unit_id\n你好,x,t-9\n";
        const parsed = parseTranslationCsv(csv);
        expect(parsed.rows).toEqual([row({ unitId: "t-9", target: "你好" })]);
    });

    it("strips a UTF-8 BOM and reports rows without unit ids", () => {
        const csv = "﻿unit_id,target\n,orphan\nt-1,ok\n";
        const parsed = parseTranslationCsv(csv);
        expect(parsed.rows).toEqual([row({ unitId: "t-1", target: "ok" })]);
        expect(parsed.errors).toHaveLength(1);
    });

    it("rejects files without the unit_id column", () => {
        expect(parseTranslationCsv("source,target\nA,B\n").errors).toEqual(["Missing required column: unit_id"]);
    });
});

describe("validatePlaceholderParity", () => {
    it("passes when placeholders match the interpolation count", () => {
        expect(validatePlaceholderParity("你好，{0}！{1}", 2)).toEqual([]);
    });

    it("flags out-of-range references and missing interpolations", () => {
        expect(validatePlaceholderParity("你好，{2}！", 1)).toEqual([
            { kind: "outOfRange", index: 2 },
            { kind: "missing", index: 0 },
        ]);
    });

    it("is clean for plain text with no interpolations", () => {
        expect(validatePlaceholderParity("纯文本", 0)).toEqual([]);
    });
});
