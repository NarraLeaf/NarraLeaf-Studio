/**
 * JSON for translation exchange - the format for whoever is not using a
 * translation tool at all: a script, a model, a programmer with an editor.
 *
 * Writing is exact and one shape. Reading is deliberately loose, because the
 * file coming back was very often produced by something that was told "give me
 * the translations back as JSON" and answered in whichever of these shapes it
 * felt like:
 *
 * ```jsonc
 * { "units": { "id": { "source": "…", "target": "…" } } }   // what Studio wrote
 * { "units": { "id": "translation" } }                       // targets only
 * { "id": "translation" }                                    // a bare map
 * [ { "unitId": "id", "target": "translation" } ]            // a list of rows
 * ```
 *
 * All four mean the same thing and all four are accepted. What is *not*
 * accepted is a file with no unit ids in it: the ids are the anchor, and a file
 * keyed by source text would attach translations to the wrong lines.
 *
 * Comments in English per project convention.
 */

import type { ExchangeProblem } from "./exchangeProblem";
import type {
    ParsedTranslationExchange,
    TranslationExchangeDocument,
    TranslationExchangeRow,
} from "./localizationExchange";

/** Marks a file as Studio's own shape; readers of a bare map never see it. */
export const TRANSLATION_JSON_FORMAT = "narraleaf-translation";
export const TRANSLATION_JSON_VERSION = 1;

type JsonUnit = {
    context?: string;
    source: string;
    target: string;
    status?: string;
    note?: string;
};

export function serializeTranslationJson(document: TranslationExchangeDocument): string {
    const units: Record<string, JsonUnit> = {};
    for (const row of document.rows) {
        units[row.unitId] = {
            ...(row.context ? { context: row.context } : {}),
            source: row.source,
            target: row.target,
            ...(row.status ? { status: row.status } : {}),
            ...(row.note ? { note: row.note } : {}),
        };
    }
    return `${JSON.stringify({
        format: TRANSLATION_JSON_FORMAT,
        version: TRANSLATION_JSON_VERSION,
        sourceLocale: document.sourceLocale,
        targetLocale: document.targetLocale,
        ...(document.projectName ? { project: document.projectName } : {}),
        units,
    }, null, 2)}\n`;
}

function asString(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function rowFromValue(unitId: string, value: unknown): TranslationExchangeRow | null {
    if (typeof value === "string") {
        return { unitId, context: "", source: "", target: value, status: "", note: "" };
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    const record = value as Record<string, unknown>;
    return {
        unitId,
        context: asString(record.context),
        source: asString(record.source),
        target: asString(record.target ?? record.translation ?? record.value),
        status: asString(record.status),
        note: asString(record.note ?? record.comment),
    };
}

/** Read a `{ id: unit }` map in any of the accepted unit shapes. */
function rowsFromMap(map: Record<string, unknown>, problems: ExchangeProblem[]): TranslationExchangeRow[] {
    const rows: TranslationExchangeRow[] = [];
    for (const [unitId, value] of Object.entries(map)) {
        if (!unitId) {
            continue;
        }
        const row = rowFromValue(unitId, value);
        if (row) {
            rows.push(row);
        } else {
            problems.push({ code: "notEntry" });
        }
    }
    return rows;
}

/** Metadata keys of Studio's own shape, so a bare map is not mistaken for one. */
const METADATA_KEYS = new Set(["format", "version", "sourceLocale", "targetLocale", "project", "units"]);

export function parseTranslationJson(text: string): ParsedTranslationExchange {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { rows: [], problems: [{ code: "notFormat", format: "json" }] };
    }

    const problems: ExchangeProblem[] = [];

    if (Array.isArray(parsed)) {
        const rows: TranslationExchangeRow[] = [];
        parsed.forEach((entry, index) => {
            if (!entry || typeof entry !== "object") {
                problems.push({ code: "notEntry", at: { entry: index + 1 } });
                return;
            }
            const record = entry as Record<string, unknown>;
            const unitId = asString(record.unitId ?? record.unit_id ?? record.id ?? record.key).trim();
            if (!unitId) {
                problems.push({ code: "missingId", at: { entry: index + 1 } });
                return;
            }
            const row = rowFromValue(unitId, record);
            if (row) {
                rows.push(row);
            }
        });
        return { rows, problems };
    }

    if (!parsed || typeof parsed !== "object") {
        return { rows: [], problems: [{ code: "noRows" }] };
    }

    const record = parsed as Record<string, unknown>;
    if (record.units && typeof record.units === "object" && !Array.isArray(record.units)) {
        return {
            rows: rowsFromMap(record.units as Record<string, unknown>, problems),
            sourceLocale: typeof record.sourceLocale === "string" ? record.sourceLocale : undefined,
            targetLocale: typeof record.targetLocale === "string" ? record.targetLocale : undefined,
            problems,
        };
    }

    // A bare map of ids to translations. Metadata keys are dropped rather than
    // read as units, so a half-Studio file does not grow a unit named "version".
    const bare = Object.fromEntries(Object.entries(record).filter(([key]) => !METADATA_KEYS.has(key)));
    const rows = rowsFromMap(bare, problems);
    if (rows.length === 0) {
        return { rows: [], problems: [...problems, { code: "noRows" }] };
    }
    return {
        rows,
        sourceLocale: typeof record.sourceLocale === "string" ? record.sourceLocale : undefined,
        targetLocale: typeof record.targetLocale === "string" ? record.targetLocale : undefined,
        problems,
    };
}
