/**
 * Small RFC 4180 CSV primitives shared by the localization and voice tables:
 * field escaping, a tokenizer that handles quoted multi-line fields, and a
 * header-keyed row reader (so exported columns may be reordered or extended by
 * whoever edits the file). Callers prepend a UTF-8 BOM when writing so Excel
 * opens the file correctly.
 * Comments in English per project convention.
 */

export function escapeCsvField(value: string): string {
    if (/[",\r\n]/.test(value)) {
        return `"${value.replace(/"/g, "\"\"")}"`;
    }
    return value;
}

/** Serialize a header + rows of already-stringified cells into CRLF-terminated CSV. */
export function serializeCsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
    const lines = [header.map(escapeCsvField).join(",")];
    for (const row of rows) {
        lines.push(row.map(escapeCsvField).join(","));
    }
    return lines.join("\r\n") + "\r\n";
}

/** RFC 4180 tokenizer: returns rows of raw fields. Handles quoted multi-line fields. */
export function tokenizeCsv(text: string): string[][] {
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

export type CsvTable = {
    /** Look up a cell by column header name (lower-cased); "" when absent. */
    cell: (cells: string[], column: string) => string;
    /** Data rows (header excluded), blank rows dropped. */
    rows: string[][];
    hasColumn: (column: string) => boolean;
};

/**
 * Parse CSV into a header-keyed table. Strips a UTF-8 BOM, lower-cases header
 * names, and drops fully-blank rows. Returns null when the file is empty.
 */
export function readCsvTable(text: string): CsvTable | null {
    const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    const table = tokenizeCsv(clean).filter(cells => cells.some(cell => cell.length > 0));
    if (table.length === 0) {
        return null;
    }
    const header = table[0].map(name => name.trim().toLowerCase());
    const columnIndex = new Map<string, number>();
    header.forEach((name, index) => {
        if (!columnIndex.has(name)) {
            columnIndex.set(name, index);
        }
    });
    return {
        cell: (cells, column) => {
            const index = columnIndex.get(column);
            return index === undefined ? "" : cells[index] ?? "";
        },
        rows: table.slice(1),
        hasColumn: column => columnIndex.has(column),
    };
}
