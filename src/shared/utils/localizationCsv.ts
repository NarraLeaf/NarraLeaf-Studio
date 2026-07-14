/**
 * CSV round-trip for translation tables (RFC 4180: quoted fields, doubled
 * quotes, multi-line values). Callers prepend a UTF-8 BOM when writing so
 * Excel opens the file correctly. Columns are stable and keyed by header
 * name on import, so translators may reorder or append columns freely.
 * Comments in English per project convention.
 */

export const TRANSLATION_CSV_COLUMNS = ["unit_id", "context", "source", "target", "status", "note"] as const;

export type TranslationCsvRow = {
    unitId: string;
    context: string;
    source: string;
    target: string;
    status: string;
    note: string;
};

function escapeCsvField(value: string): string {
    if (/[",\r\n]/.test(value)) {
        return `"${value.replace(/"/g, "\"\"")}"`;
    }
    return value;
}

export function serializeTranslationCsv(rows: readonly TranslationCsvRow[]): string {
    const lines = [TRANSLATION_CSV_COLUMNS.join(",")];
    for (const row of rows) {
        lines.push([
            escapeCsvField(row.unitId),
            escapeCsvField(row.context),
            escapeCsvField(row.source),
            escapeCsvField(row.target),
            escapeCsvField(row.status),
            escapeCsvField(row.note),
        ].join(","));
    }
    return lines.join("\r\n") + "\r\n";
}

/** RFC 4180 tokenizer: returns rows of raw fields. Handles quoted multi-line fields. */
function tokenizeCsv(text: string): string[][] {
    const rows: string[][] = [];
    let field = "";
    let row: string[] = [];
    let inQuotes = false;
    let index = 0;
    const pushField = () => {
        row.push(field);
        field = "";
    };
    const pushRow = () => {
        pushField();
        rows.push(row);
        row = [];
    };
    while (index < text.length) {
        const char = text[index];
        if (inQuotes) {
            if (char === "\"") {
                if (text[index + 1] === "\"") {
                    field += "\"";
                    index += 2;
                    continue;
                }
                inQuotes = false;
                index += 1;
                continue;
            }
            field += char;
            index += 1;
            continue;
        }
        if (char === "\"" && field.length === 0) {
            inQuotes = true;
            index += 1;
            continue;
        }
        if (char === ",") {
            pushField();
            index += 1;
            continue;
        }
        if (char === "\r") {
            if (text[index + 1] === "\n") {
                index += 1;
            }
            pushRow();
            index += 1;
            continue;
        }
        if (char === "\n") {
            pushRow();
            index += 1;
            continue;
        }
        field += char;
        index += 1;
    }
    if (field.length > 0 || row.length > 0) {
        pushRow();
    }
    return rows;
}

export type ParsedTranslationCsv = {
    rows: TranslationCsvRow[];
    /** Human-readable problems (bad header, rows without a unit id). */
    errors: string[];
};

/**
 * Parse a translation CSV by header names (column order and extra columns are
 * tolerated). Only `unit_id` is required; absent cells become empty strings.
 */
export function parseTranslationCsv(text: string): ParsedTranslationCsv {
    // Strip a UTF-8 BOM if present.
    const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    const table = tokenizeCsv(clean).filter(cells => cells.some(cell => cell.length > 0));
    if (table.length === 0) {
        return { rows: [], errors: ["Empty file"] };
    }
    const header = table[0].map(cell => cell.trim().toLowerCase());
    const columnIndex = new Map<string, number>();
    header.forEach((name, index) => {
        if (!columnIndex.has(name)) {
            columnIndex.set(name, index);
        }
    });
    if (!columnIndex.has("unit_id")) {
        return { rows: [], errors: ["Missing required column: unit_id"] };
    }
    const cell = (cells: string[], column: string): string => {
        const index = columnIndex.get(column);
        return index === undefined ? "" : cells[index] ?? "";
    };
    const rows: TranslationCsvRow[] = [];
    const errors: string[] = [];
    for (let lineIndex = 1; lineIndex < table.length; lineIndex++) {
        const cells = table[lineIndex];
        const unitId = cell(cells, "unit_id").trim();
        if (!unitId) {
            errors.push(`Row ${lineIndex + 1}: missing unit_id`);
            continue;
        }
        rows.push({
            unitId,
            context: cell(cells, "context"),
            source: cell(cells, "source"),
            target: cell(cells, "target"),
            status: cell(cells, "status").trim().toLowerCase(),
            note: cell(cells, "note"),
        });
    }
    return { rows, errors };
}
