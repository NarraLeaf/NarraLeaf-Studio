/**
 * CSV round-trip for the voice recording script. The exported script gives the
 * booth a human `filename` to record to and, alongside it, the authoritative
 * `unit_id` so re-importing status/notes never depends on the filename staying
 * put. Columns are keyed by header name, so extra columns survive a round-trip.
 * RFC 4180 primitives live in `./csv`; callers prepend a UTF-8 BOM when writing.
 * Comments in English per project convention.
 */

import { readCsvTable, serializeCsv } from "./csv";
import type { ExchangeProblem } from "./exchangeProblem";

export const VOICE_CSV_COLUMNS = ["filename", "unit_id", "character", "scene", "line", "status", "note"] as const;

export type VoiceCsvRow = {
    filename: string;
    unitId: string;
    character: string;
    scene: string;
    line: string;
    status: string;
    note: string;
};

export function serializeVoiceCsv(rows: readonly VoiceCsvRow[]): string {
    return serializeCsv(
        VOICE_CSV_COLUMNS,
        rows.map(row => [row.filename, row.unitId, row.character, row.scene, row.line, row.status, row.note]),
    );
}

export type ParsedVoiceCsv = {
    rows: VoiceCsvRow[];
    /** What was wrong with the file, as codes the interface words; see `ExchangeProblem`. */
    problems: ExchangeProblem[];
};

/**
 * Parse a voice recording-script CSV by header names. `unit_id` is required (the
 * authoritative key); every other column is optional and defaults to empty.
 */
export function parseVoiceCsv(text: string): ParsedVoiceCsv {
    const table = readCsvTable(text);
    if (!table) {
        return { rows: [], problems: [{ code: "empty" }] };
    }
    if (!table.hasColumn("unit_id")) {
        return { rows: [], problems: [{ code: "noIdColumn" }] };
    }
    const rows: VoiceCsvRow[] = [];
    const problems: ExchangeProblem[] = [];
    table.rows.forEach((cells, lineIndex) => {
        const unitId = table.cell(cells, "unit_id").trim();
        if (!unitId) {
            // The row number a spreadsheet shows beside it: the header is row 1.
            problems.push({ code: "missingId", at: { row: lineIndex + 2 } });
            return;
        }
        rows.push({
            filename: table.cell(cells, "filename"),
            unitId,
            character: table.cell(cells, "character"),
            scene: table.cell(cells, "scene"),
            line: table.cell(cells, "line"),
            status: table.cell(cells, "status").trim().toLowerCase(),
            note: table.cell(cells, "note"),
        });
    });
    return { rows, problems };
}
