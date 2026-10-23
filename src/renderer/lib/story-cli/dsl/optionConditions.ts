/**
 * The two conditions a choice option carries, as clauses at the end of its line.
 *
 *     - Library [hide if visited(Library)]
 *     - Buy it [disable if gold < 10]
 *
 * `hide if` is the option's `hiddenWhen` and `disable if` its `disabledWhen`, word for word: the
 * option is hidden (or greyed out) while the expression is true, which is how Studio's inspector
 * labels them. Without these a menu that offers only what is left - three errands done in any order,
 * say - could not be written in this format at all, and had to be spelled as one menu per state.
 *
 * ## Why clauses at the end, in brackets
 *
 * An option's words are free prose, so a separator has to be one prose never ends with by accident
 * and one the expression inside cannot contain. A bare word fails the first test and `?` the second
 * (the expression language has a ternary). A bracketed clause that runs to the end of the line passes
 * both: the expression may hold brackets of its own - list literals, `inv[0]` - because the scan
 * counts them and skips strings, and the words keep any bracket they like, because a bracket that is
 * not followed by the rest of a clause and the end of the line is just words.
 *
 * The printer escapes the one sequence that would read as a clause opener (`[<word> if `) wherever it
 * occurs in the words, so a printed line always reads back as the words it printed.
 *
 * Comments in English per project convention.
 */

import { escapeText, unescapeText } from "./shapes";

export const OPTION_CLAUSE_KEYWORDS = {
    hide: "hide",
    disable: "disable",
} as const;

export type OptionClauseKey = keyof typeof OPTION_CLAUSE_KEYWORDS;

/** The clauses in the order the printer writes them. */
const CLAUSE_ORDER: readonly OptionClauseKey[] = ["hide", "disable"];

/** `[<word> if ` - the opening every clause has and the one sequence the printer escapes in words. */
const CLAUSE_OPENER = /^\[([A-Za-z]+) if /;

export type OptionLineParts = {
    /** The words, still escaped: the prose reader decodes them. */
    words: string;
    /** Each clause's expression source, unescaped. Absent when the line has no such clause. */
    conditions: Partial<Record<OptionClauseKey, string>>;
};

export type OptionLineSplit = { ok: true; parts: OptionLineParts } | { ok: false; message: string };

/**
 * An option line's words and its clauses.
 *
 * A clause only counts when it, and any clause after it, runs to the end of the line. So
 * `- Go [now if you like] and wait` is words, while `- Go [show if met]` is a clause with a keyword
 * this format does not have - an error rather than words, because a mistyped keyword silently
 * becoming part of what the player reads is the failure worth stopping.
 */
export function splitOptionLine(text: string): OptionLineSplit {
    for (let start = 0; start < text.length; start += 1) {
        if (!isClauseStart(text, start)) {
            continue;
        }
        const scanned = scanClauses(text, start);
        if (scanned.kind === "words") {
            continue;
        }
        if (scanned.kind === "error") {
            return { ok: false, message: scanned.message };
        }
        const conditions: Partial<Record<OptionClauseKey, string>> = {};
        for (const clause of scanned.clauses) {
            const key = clauseKey(clause.keyword);
            if (!key) {
                return {
                    ok: false,
                    message: `"[${clause.keyword} if …]" is not an option clause. An option takes [hide if <expression>] `
                        + `and [disable if <expression>]; write \\[ for a bracket that belongs to the words.`,
                };
            }
            if (conditions[key] !== undefined) {
                return { ok: false, message: `The option has two [${clause.keyword} if …] clauses. Join them with && or ||.` };
            }
            if (!clause.source) {
                return { ok: false, message: `[${clause.keyword} if …] needs an expression.` };
            }
            conditions[key] = clause.source;
        }
        return { ok: true, parts: { words: text.slice(0, start).trimEnd(), conditions } };
    }
    return { ok: true, parts: { words: text, conditions: {} } };
}

/** The clauses for these sources, each led by a space, or "" when there are none. */
export function spellOptionClauses(conditions: Partial<Record<OptionClauseKey, string>>): string {
    return CLAUSE_ORDER
        .filter(key => conditions[key] !== undefined)
        .map(key => ` [${OPTION_CLAUSE_KEYWORDS[key]} if ${escapeText(conditions[key] as string, { asProse: false })}]`)
        .join("");
}

/** Escaped option words with every would-be clause opener escaped, so the words read back as words. */
export function escapeOptionWords(words: string): string {
    let out = "";
    for (let index = 0; index < words.length; index += 1) {
        if (words[index] === "\\") {
            // An escape already written is copied whole, so its second character is never re-read.
            out += words.slice(index, index + 2);
            index += 1;
            continue;
        }
        if (words[index] === "[" && CLAUSE_OPENER.test(words.slice(index))) {
            out += "\\";
        }
        out += words[index];
    }
    return out;
}

function clauseKey(keyword: string): OptionClauseKey | null {
    for (const key of CLAUSE_ORDER) {
        if (OPTION_CLAUSE_KEYWORDS[key] === keyword) {
            return key;
        }
    }
    return null;
}

/** An unescaped `[<word> if ` that follows a space - a clause cannot touch the words before it. */
function isClauseStart(text: string, index: number): boolean {
    return text[index] === "["
        && index > 0
        && text[index - 1] === " "
        && !isEscapedAt(text, index)
        && CLAUSE_OPENER.test(text.slice(index));
}

type ScannedClause = { keyword: string; source: string };

type ScanResult =
    | { kind: "clauses"; clauses: ScannedClause[] }
    /** The bracket closed and words followed: not a clause, the line's words go on. */
    | { kind: "words" }
    | { kind: "error"; message: string };

/** Every clause from `start` to the end of the line. */
function scanClauses(text: string, start: number): ScanResult {
    const clauses: ScannedClause[] = [];
    let index = start;
    while (index < text.length) {
        const opener = CLAUSE_OPENER.exec(text.slice(index));
        if (!opener) {
            return { kind: "words" };
        }
        const bodyStart = index + opener[0].length;
        const close = closingBracket(text, bodyStart);
        if (close < 0) {
            return {
                kind: "error",
                message: `"[${opener[1]} if" is never closed. End the clause with ], or write \\[ for a bracket that belongs to the words.`,
            };
        }
        clauses.push({ keyword: opener[1], source: unescapeText(text.slice(bodyStart, close)).trim() });
        index = close + 1;
        while (text[index] === " ") {
            index += 1;
        }
    }
    return { kind: "clauses", clauses };
}

/**
 * The index of the `]` that closes a clause whose expression starts at `from`, or -1.
 *
 * Brackets inside the expression nest, and nothing inside a string literal counts. A backslash skips
 * the character after it either way - it is the file's escape outside a string and the expression's
 * inside one, and both mean the same thing for a scan: that character is not structure.
 */
function closingBracket(text: string, from: number): number {
    let depth = 0;
    let inString = false;
    for (let index = from; index < text.length; index += 1) {
        const char = text[index];
        if (char === "\\") {
            index += 1;
            continue;
        }
        if (inString) {
            inString = char !== "\"";
            continue;
        }
        if (char === "\"") {
            inString = true;
        } else if (char === "[") {
            depth += 1;
        } else if (char === "]") {
            if (depth === 0) {
                return index;
            }
            depth -= 1;
        }
    }
    return -1;
}

function isEscapedAt(text: string, index: number): boolean {
    let slashes = 0;
    for (let i = index - 1; i >= 0 && text[i] === "\\"; i -= 1) {
        slashes += 1;
    }
    return slashes % 2 === 1;
}
