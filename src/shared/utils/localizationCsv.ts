/**
 * CSV round-trip for translation tables. Columns are stable and keyed by header
 * name on import, so translators may reorder or append columns freely. The RFC
 * 4180 primitives live in `./csv`; the row model and the other three exchange
 * formats live in `./localizationExchange`. `serializeTranslationExchange`
 * prepends the UTF-8 BOM that makes Excel read the file as UTF-8.
 * Comments in English per project convention.
 */

import { readCsvTable, serializeCsv } from "./csv";
import type { ExchangeProblem } from "./exchangeProblem";
import type { ParsedTranslationExchange, TranslationExchangeRow } from "./localizationExchange";

export const TRANSLATION_CSV_COLUMNS = ["unit_id", "context", "source", "target", "status", "note"] as const;

/** The shared exchange row; CSV was the first format to carry it. */
export type TranslationCsvRow = TranslationExchangeRow;

export function serializeTranslationCsv(rows: readonly TranslationCsvRow[]): string {
    return serializeCsv(
        TRANSLATION_CSV_COLUMNS,
        rows.map(row => [row.unitId, row.context, row.source, row.target, row.status, row.note]),
    );
}

/** Problems are reported the same way for every exchange format; CSV carries no language tags. */
export type ParsedTranslationCsv = ParsedTranslationExchange;

/**
 * Parse a translation CSV by header names (column order and extra columns are
 * tolerated). Only `unit_id` is required; absent cells become empty strings.
 */
export function parseTranslationCsv(text: string): ParsedTranslationCsv {
    const table = readCsvTable(text);
    if (!table) {
        return { rows: [], problems: [{ code: "empty" }] };
    }
    if (!table.hasColumn("unit_id")) {
        return { rows: [], problems: [{ code: "noIdColumn" }] };
    }
    const rows: TranslationCsvRow[] = [];
    const problems: ExchangeProblem[] = [];
    table.rows.forEach((cells, lineIndex) => {
        const unitId = table.cell(cells, "unit_id").trim();
        if (!unitId) {
            // The row number a spreadsheet shows beside it: the header is row 1.
            problems.push({ code: "missingId", at: { row: lineIndex + 2 } });
            return;
        }
        rows.push({
            unitId,
            context: table.cell(cells, "context"),
            source: table.cell(cells, "source"),
            target: table.cell(cells, "target"),
            status: table.cell(cells, "status").trim().toLowerCase(),
            note: table.cell(cells, "note"),
        });
    });
    return { rows, problems };
}
