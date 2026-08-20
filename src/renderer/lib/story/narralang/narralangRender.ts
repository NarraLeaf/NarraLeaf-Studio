/**
 * The generic renderer: a {@link NarralangShape} plus a {@link NarralangDialect} is a line of script.
 *
 * Design doc: `docs/plans/2026-08-15-001-plan-narralang.md`.
 *
 * There is no statement-specific code here and there must never be. Everything that used to be a
 * `case` - the verb's word, which preposition a modifier hangs off, what order the modifiers come in,
 * whether a value is quoted - is a lookup into the dialect, so a project changing any of it changes a
 * table and this file stays as it is. The day a rule cannot be expressed as a slot declaration is the
 * day the dialect needs a new field, not the day this file grows a branch.
 *
 * The renderer is also the half that must stay pure: it never reports a coverage issue, because by
 * the time a shape exists the question "can NarraLang say this row?" has already been answered. See
 * {@link ./narralangExtract}.
 */

import { narralangWord, type NarralangDialect, type NarralangSlotSyntax } from "./narralangDialect";
import type { NarralangShape, NarralangValue } from "./narralangShape";
import { narralangLiteral, narralangName, narralangNumber, narralangSeconds, narralangString } from "./narralangSyntax";
import { printNarralangText } from "./narralangText";

/** One value, spelled. Every arm is a lookup or a shared formatter - nothing statement-specific. */
function renderValue(value: NarralangValue, dialect: NarralangDialect): string {
    switch (value.kind) {
        case "name":
            return narralangName(value.name, dialect);
        case "names":
            return value.names.map((name) => narralangName(name, dialect)).join(" ");
        case "builtin":
            return `${dialect.prefix.builtin}${narralangWord(dialect, value.word)}`;
        case "word":
            return narralangWord(dialect, value.word);
        case "timedWord": {
            const word = narralangWord(dialect, value.word);
            return value.ms === undefined ? word : `${word} ${narralangSeconds(value.ms)}`;
        }
        case "string":
            return narralangString(value.value, dialect);
        case "number":
            return narralangNumber(value.value);
        case "seconds":
            return narralangSeconds(value.ms);
        case "color":
            return value.value;
        case "literal":
            return narralangLiteral(value.value, dialect);
        case "expression":
            return value.source;
        case "pairs":
            return value.entries
                .map((entry) => `${narralangName(entry.key, dialect)} ${narralangNumber(entry.value)}`)
                .join(" ");
        case "text":
            return printNarralangText(value.text, dialect);
    }
}

/**
 * Assemble the tokens of one statement.
 *
 * Tokens are space-joined, and a slot that renders to nothing contributes none - which is what makes
 * "a modifier that resolved to nothing leaves no trailing space" true once rather than per statement.
 * Trailing whitespace is invisible in a diff and would make two exports of the same scene differ.
 */
function renderStatement(
    verbKeyword: string,
    slots: readonly NarralangSlotSyntax[],
    values: NarralangShape & { form: "statement" },
    dialect: NarralangDialect,
): string {
    const tokens: string[] = [];
    if (verbKeyword !== "") {
        tokens.push(verbKeyword);
    }
    for (const syntax of slots) {
        const value = values.slots[syntax.slot];
        if (value === undefined) {
            continue;
        }
        const rendered = renderValue(value, dialect);
        if (rendered === "" && !syntax.keepEmpty) {
            continue;
        }
        if (syntax.attach !== undefined) {
            if (tokens.length === 0) {
                tokens.push(syntax.attach);
            } else {
                tokens[tokens.length - 1] += syntax.attach;
            }
        }
        if (syntax.lead !== undefined) {
            tokens.push(syntax.lead);
        }
        tokens.push(rendered);
    }
    return tokens.join(" ");
}

/**
 * One row's line, or `null` when the row prints nothing at all.
 *
 * `null` covers both "prints nothing" shapes; the walk is what tells them apart, because the
 * difference between them is where the children go, not what this line says.
 */
export function renderNarralangShape(shape: NarralangShape, dialect: NarralangDialect): string | null {
    switch (shape.form) {
        case "statement": {
            const syntax = dialect.verbs[shape.verb];
            const line = renderStatement(syntax.keyword, syntax.slots, shape, dialect);
            return shape.opensBlock ? `${line}${dialect.block.open}` : line;
        }
        case "note":
            return `${dialect.prefix.note} ${printNarralangText(shape.text, dialect)}`;
        case "raw":
            // Doubled so the line cannot be confused with an ordinary disabled row: it is not a row an
            // author switched off, it is one nothing was ever able to read.
            return `${dialect.prefix.disabled}${dialect.prefix.disabled} ${shape.source}`;
        case "silent":
        case "transparent":
            return null;
    }
}
