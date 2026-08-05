/**
 * gettext PO for translation exchange - the format Poedit, Weblate, Crowdin and
 * half the volunteer translation world speak natively.
 *
 * The mapping to gettext's vocabulary, which is narrower than Studio's:
 *
 * - `msgctxt` carries the unit id. It is what gettext has for "two identical
 *   strings that are not the same string", and it is exactly the anchor Studio
 *   needs: the id, not the source text.
 * - `msgid` is the source text, `msgstr` the translation.
 * - `#.` extracted comments carry the translator-facing context, plus one
 *   `nls-status:` line when the state is finer than gettext can say.
 * - `#` translator comments carry the unit's note, both ways.
 * - `#, fuzzy` is set for `machine` and `stale`, which is what the flag means to
 *   every PO tool: there is something here, and a human still has to look at it.
 *
 * Plurals are read (the first form is taken) and never written: a translation
 * unit in Studio is one authored line, and gettext's plural machinery has no
 * source-side counterpart here.
 *
 * Comments in English per project convention.
 */

import type {
    ParsedTranslationExchange,
    TranslationExchangeDocument,
    TranslationExchangeRow,
} from "./localizationExchange";

/** Extracted-comment key carrying a state gettext has no flag for. */
const STATUS_COMMENT = "nls-status:";

/** States that mean "not finished", which is what `#, fuzzy` says in PO. */
const FUZZY_STATES = new Set(["machine", "stale"]);

function escapePoString(text: string): string {
    return text
        .replace(/\\/g, "\\\\")
        .replace(/"/g, "\\\"")
        .replace(/\t/g, "\\t")
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
}

/**
 * Write `<keyword> "value"`, or the multi-line form when the value has newlines.
 *
 * The multi-line form is not cosmetic: it is how every PO tool displays a
 * paragraph, and a narration block written as one enormous escaped line is
 * unreadable in the editor the translator is actually using.
 */
function poEntryLine(keyword: string, value: string): string[] {
    if (!value.includes("\n")) {
        return [`${keyword} "${escapePoString(value)}"`];
    }
    const parts = value.split("\n");
    const lines = [`${keyword} ""`];
    parts.forEach((part, index) => {
        const isLast = index === parts.length - 1;
        if (isLast && part === "") {
            return;
        }
        lines.push(`"${escapePoString(isLast ? part : `${part}\n`)}"`);
    });
    return lines;
}

/** Prefix every line of a comment, so a multi-line note stays a legal comment block. */
function commentLines(prefix: string, text: string): string[] {
    return text.split("\n").map(line => (line ? `${prefix} ${line}` : prefix));
}

export function serializeTranslationPo(document: TranslationExchangeDocument): string {
    const header = [
        "msgid \"\"",
        "msgstr \"\"",
        `"Project-Id-Version: ${escapePoString(document.projectName || "narraleaf")}\\n"`,
        "\"MIME-Version: 1.0\\n\"",
        "\"Content-Type: text/plain; charset=UTF-8\\n\"",
        "\"Content-Transfer-Encoding: 8bit\\n\"",
        `"Language: ${escapePoString(document.targetLocale)}\\n"`,
        `"X-Source-Language: ${escapePoString(document.sourceLocale)}\\n"`,
        "\"X-Generator: NarraLeaf Studio\\n\"",
        "",
    ];

    const body: string[] = [];
    for (const row of document.rows) {
        if (row.note) {
            body.push(...commentLines("#", row.note));
        }
        if (row.context) {
            body.push(...commentLines("#.", row.context));
        }
        if (row.status) {
            body.push(`#. ${STATUS_COMMENT} ${row.status}`);
        }
        body.push(`#: ${row.unitId.replace(/\s+/g, " ")}`);
        if (FUZZY_STATES.has(row.status)) {
            body.push("#, fuzzy");
        }
        body.push(...poEntryLine("msgctxt", row.unitId));
        body.push(...poEntryLine("msgid", row.source));
        body.push(...poEntryLine("msgstr", row.target));
        body.push("");
    }

    return [...header, ...body].join("\n");
}

/** Concatenate every quoted span on a line, unescaping as it goes. */
function readPoString(line: string): string {
    let out = "";
    let index = 0;
    while (index < line.length) {
        if (line[index] !== "\"") {
            index += 1;
            continue;
        }
        index += 1;
        while (index < line.length && line[index] !== "\"") {
            if (line[index] === "\\") {
                const escape = line[index + 1];
                out += escape === "n" ? "\n"
                    : escape === "t" ? "\t"
                        : escape === "r" ? "\r"
                            : escape === "\\" ? "\\"
                                : escape === "\"" ? "\""
                                    : escape ?? "";
                index += 2;
                continue;
            }
            out += line[index];
            index += 1;
        }
        index += 1;
    }
    return out;
}

type PoEntry = {
    notes: string[];
    extracted: string[];
    references: string[];
    flags: string[];
    values: Partial<Record<"msgctxt" | "msgid" | "msgstr", string>>;
};

function emptyEntry(): PoEntry {
    return { notes: [], extracted: [], references: [], flags: [], values: {} };
}

function isEmptyEntry(entry: PoEntry): boolean {
    return entry.notes.length === 0
        && entry.extracted.length === 0
        && entry.references.length === 0
        && entry.flags.length === 0
        && Object.keys(entry.values).length === 0;
}

export function parseTranslationPo(text: string): ParsedTranslationExchange {
    const rows: TranslationExchangeRow[] = [];
    const errors: string[] = [];
    let sourceLocale: string | undefined;
    let targetLocale: string | undefined;

    let entry = emptyEntry();
    let currentKey: "msgctxt" | "msgid" | "msgstr" | null = null;
    /** Set while reading a form Studio does not keep, so its continuation lines are dropped too. */
    let ignoringValue = false;

    const readHeader = (value: string): void => {
        for (const line of value.split("\n")) {
            const separator = line.indexOf(":");
            if (separator < 0) {
                continue;
            }
            const field = line.slice(0, separator).trim().toLowerCase();
            const fieldValue = line.slice(separator + 1).trim();
            if (field === "language") {
                targetLocale = fieldValue;
            } else if (field === "x-source-language") {
                sourceLocale = fieldValue;
            }
        }
    };

    const flush = (): void => {
        const { values } = entry;
        if (isEmptyEntry(entry)) {
            entry = emptyEntry();
            currentKey = null;
            return;
        }
        // The header is the entry with an empty msgid and no context. Its msgstr
        // is a field block, not a translation.
        if (values.msgctxt === undefined && (values.msgid ?? "") === "") {
            readHeader(values.msgstr ?? "");
            entry = emptyEntry();
            currentKey = null;
            return;
        }
        if (Object.keys(values).length === 0) {
            // A comment block on its own - the licence header most PO files
            // open with. Nothing to translate, nothing to report.
            entry = emptyEntry();
            currentKey = null;
            return;
        }
        const unitId = values.msgctxt ?? entry.references[0] ?? values.msgid ?? "";
        if (!unitId) {
            errors.push("An entry has no msgctxt and no msgid, and was skipped");
            entry = emptyEntry();
            currentKey = null;
            return;
        }
        const statusLine = entry.extracted.find(line => line.startsWith(STATUS_COMMENT));
        const target = values.msgstr ?? "";
        const status = statusLine
            ? statusLine.slice(STATUS_COMMENT.length).trim().toLowerCase()
            : entry.flags.includes("fuzzy") ? "machine"
                : target ? "translated" : "";
        rows.push({
            unitId,
            context: entry.extracted.filter(line => !line.startsWith(STATUS_COMMENT)).join("\n"),
            source: values.msgid ?? "",
            target,
            status,
            note: entry.notes.join("\n"),
        });
        entry = emptyEntry();
        currentKey = null;
    };

    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) {
            flush();
            ignoringValue = false;
            continue;
        }
        if (line.startsWith("#")) {
            // A comment after a finished entry opens the next one.
            if (entry.values.msgstr !== undefined) {
                flush();
            }
            ignoringValue = false;
            if (line.startsWith("#~")) {
                // Obsolete entry: gettext keeps it as a tombstone and nothing
                // references it any more.
                continue;
            }
            if (line.startsWith("#.")) {
                entry.extracted.push(line.slice(2).trim());
            } else if (line.startsWith("#:")) {
                entry.references.push(...line.slice(2).trim().split(/\s+/).filter(Boolean));
            } else if (line.startsWith("#,")) {
                entry.flags.push(...line.slice(2).split(",").map(flag => flag.trim()).filter(Boolean));
            } else if (!line.startsWith("#|")) {
                entry.notes.push(line.slice(1).trim());
            }
            continue;
        }
        const keyword = /^(msgctxt|msgid_plural|msgid|msgstr(?:\[\d+\])?)\s/.exec(line);
        if (keyword) {
            const name = keyword[1];
            const value = readPoString(line.slice(name.length));
            if (name === "msgctxt" && entry.values.msgstr !== undefined) {
                flush();
            }
            if (name === "msgid" && (entry.values.msgid !== undefined || entry.values.msgstr !== undefined)) {
                flush();
            }
            if (name === "msgid_plural" || name === "msgstr[1]") {
                // Plural forms other than the first are dropped, along with
                // their continuation lines.
                ignoringValue = true;
                currentKey = null;
                continue;
            }
            ignoringValue = false;
            currentKey = name === "msgctxt" ? "msgctxt" : name === "msgid" ? "msgid" : "msgstr";
            if (currentKey === "msgstr" && entry.values.msgstr !== undefined) {
                // msgstr[0] after msgstr, or a repeated key: keep the first.
                currentKey = null;
                ignoringValue = true;
                continue;
            }
            entry.values[currentKey] = value;
            continue;
        }
        if (line.startsWith("\"")) {
            if (ignoringValue || !currentKey) {
                continue;
            }
            entry.values[currentKey] = (entry.values[currentKey] ?? "") + readPoString(line);
            continue;
        }
        errors.push(`Unreadable line: ${line.slice(0, 40)}`);
    }
    flush();

    return { rows, sourceLocale, targetLocale, errors };
}
