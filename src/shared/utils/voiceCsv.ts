/**
 * CSV round-trip for the voice recording script. The exported script gives the
 * booth a human file name to record to and, in its last column, the line's
 * authoritative id so re-importing status/notes never depends on the file name
 * staying put. Columns are keyed by header name, so extra columns survive a
 * round-trip. RFC 4180 primitives live in `./csv`; callers prepend a UTF-8 BOM
 * when writing.
 *
 * The file is read by people - a booth, a director - so its headers and status
 * words are written in a Studio language rather than as internal ids: the
 * column names and the voice table's status words. The id column is the one
 * machine column, named as one and placed last. Reading accepts every
 * language's headers and words, and the English ids scripts were written with
 * before, so a script exported by any Studio imports into any other.
 * Comments in English per project convention.
 */

import { createTranslator, isLocale, SUPPORTED_LOCALES, type Locale, type TranslationKey } from "../i18n";
import { pickTemplateContentLocale } from "../types/projectTemplate";
import { readCsvTable, serializeCsv, type CsvTable } from "./csv";
import type { ExchangeProblem } from "./exchangeProblem";

/** The columns, in file order: the human ones, then the id. Also the ids scripts used to be written with. */
export const VOICE_CSV_COLUMNS = ["filename", "character", "scene", "line", "status", "note", "unit_id"] as const;

type VoiceCsvColumn = (typeof VOICE_CSV_COLUMNS)[number];

const COLUMN_KEY: Record<VoiceCsvColumn, TranslationKey> = {
    filename: "workspace.voice.script.column.filename",
    character: "workspace.voice.script.column.character",
    scene: "workspace.voice.script.column.scene",
    line: "workspace.voice.script.column.line",
    status: "workspace.voice.script.column.status",
    note: "workspace.voice.script.column.note",
    unit_id: "workspace.voice.script.column.unitId",
};

/** A line's state as `deriveVoiceUnitState` names it, and the voice table's word for it. */
const STATUS_KEY: Readonly<Record<string, TranslationKey>> = {
    missing: "workspace.voice.table.statusMissing",
    linked: "workspace.voice.table.statusVoiced",
    approved: "workspace.voice.table.statusApproved",
    stale: "workspace.voice.table.statusOutdated",
};

export type VoiceCsvRow = {
    filename: string;
    unitId: string;
    character: string;
    scene: string;
    line: string;
    /** The state id (`missing` / `linked` / `approved` / `stale`); written and read as a word. */
    status: string;
    note: string;
    /**
     * Where the row sits in the file it was read from, as a spreadsheet numbers it (the header is
     * row 1), so a row that is skipped can be named. Absent on rows built for export.
     */
    row?: number;
};

/** The Studio language a script is written in for an interface in `locale`; English for one Studio has no words for. */
export function voiceCsvLocaleFor(locale: string | null | undefined): Locale {
    if (isLocale(locale)) {
        return locale;
    }
    return (pickTemplateContentLocale(locale ?? "", SUPPORTED_LOCALES) ?? "en") as Locale;
}

export function serializeVoiceCsv(rows: readonly VoiceCsvRow[], locale: Locale = "en"): string {
    const { t } = createTranslator(locale);
    const statusWord = (status: string): string => (STATUS_KEY[status] ? t(STATUS_KEY[status]) : status);
    return serializeCsv(
        VOICE_CSV_COLUMNS.map(column => t(COLUMN_KEY[column])),
        rows.map(row => [
            row.filename,
            row.character,
            row.scene,
            row.line,
            statusWord(row.status),
            row.note,
            row.unitId,
        ]),
    );
}

export type ParsedVoiceCsv = {
    rows: VoiceCsvRow[];
    /** What was wrong with the file, as codes the interface words; see `ExchangeProblem`. */
    problems: ExchangeProblem[];
};

/** Every header a column may carry: its id, and its name in each Studio language, lower-cased as the table reads them. */
function headerNames(column: VoiceCsvColumn): string[] {
    return [column, ...SUPPORTED_LOCALES.map(locale => createTranslator(locale).t(COLUMN_KEY[column]))]
        .map(name => name.trim().toLowerCase());
}

/** The header this file uses for a column, or null when it has none of them. */
function findColumn(table: CsvTable, column: VoiceCsvColumn): string | null {
    return headerNames(column).find(name => table.hasColumn(name)) ?? null;
}

/**
 * A status cell as the state id it names: a status word in any Studio language, or an id. Anything
 * else comes back lower-cased, as it always did, and changes nothing on import.
 */
export function normalizeVoiceCsvStatus(raw: string): string {
    const value = raw.trim().toLowerCase();
    return statusByWord().get(value) ?? value;
}

let statusWords: Map<string, string> | null = null;

/** Every spelling of every state - its id and each language's word - to the id. Built once. */
function statusByWord(): Map<string, string> {
    if (!statusWords) {
        statusWords = new Map();
        for (const [status, key] of Object.entries(STATUS_KEY)) {
            statusWords.set(status, status);
            for (const locale of SUPPORTED_LOCALES) {
                const word = createTranslator(locale).t(key).trim().toLowerCase();
                if (!statusWords.has(word)) {
                    statusWords.set(word, status);
                }
            }
        }
    }
    return statusWords;
}

/**
 * Parse a voice recording-script CSV by header names. The id column is required (the
 * authoritative key); every other column is optional and defaults to empty.
 */
export function parseVoiceCsv(text: string): ParsedVoiceCsv {
    const table = readCsvTable(text);
    if (!table) {
        return { rows: [], problems: [{ code: "empty" }] };
    }
    const idColumn = findColumn(table, "unit_id");
    if (!idColumn) {
        return { rows: [], problems: [{ code: "noIdColumn" }] };
    }
    const columns = Object.fromEntries(
        VOICE_CSV_COLUMNS.map(column => [column, findColumn(table, column)]),
    ) as Record<VoiceCsvColumn, string | null>;
    const cell = (cells: string[], column: VoiceCsvColumn): string => {
        const name = columns[column];
        return name ? table.cell(cells, name) : "";
    };
    const rows: VoiceCsvRow[] = [];
    const problems: ExchangeProblem[] = [];
    table.rows.forEach((cells, lineIndex) => {
        // The row number a spreadsheet shows beside it: the header is row 1.
        const row = lineIndex + 2;
        const unitId = table.cell(cells, idColumn).trim();
        if (!unitId) {
            problems.push({ code: "missingId", at: { row } });
            return;
        }
        rows.push({
            filename: cell(cells, "filename"),
            unitId,
            character: cell(cells, "character"),
            scene: cell(cells, "scene"),
            line: cell(cells, "line"),
            status: normalizeVoiceCsvStatus(cell(cells, "status")),
            note: cell(cells, "note"),
            row,
        });
    });
    return { rows, problems };
}
