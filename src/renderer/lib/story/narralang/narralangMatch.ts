/**
 * The dialect table, run backwards: tokens plus a verb's slot declarations become a
 * {@link NarralangShape}.
 *
 * Design doc: `docs/plans/2026-08-15-001-plan-narralang.md`.
 *
 * There is no statement-specific code here and there must never be, for the same reason
 * {@link ./narralangRender} has none. Each slot entry says three things - where it sits, the word
 * that introduces it, and the kind of value that follows - and those three are exactly what a matcher
 * needs: read the lead, read a value of the declared kind, fill the slot. A project that renames a
 * verb, moves a modifier onto another preposition or reorders the slots changes the table, and both
 * directions follow it.
 *
 * ## Every parse, not the first one
 *
 * A line can genuinely fit a verb's declarations in more than one way - `with` introduces both the
 * transform's transition and the row's own transition, and seven verbs are spelled `show`. Committing
 * to the first fit would silently pick one, so this file enumerates ALL of them and hands the set to
 * {@link ./narralangBuild}, which drops the ones that cannot become a payload. What survives is
 * ranked, and a tie is reported rather than guessed.
 */

import type { StoryTransitionWord } from "@/apps/workspace/modules/story/scene-editor/commands/transitions";

import { narralangWord, type NarralangDialect, type NarralangSlotSyntax, type NarralangVerbSyntax } from "./narralangDialect";
import {
    isNarralangColorToken,
    narralangTokenMs,
    narralangTokenNumber,
    parseNarralangText,
    type NarralangToken,
    type NarralangTextIssue,
} from "./narralangLex";
import type {
    NarralangProseContext,
    NarralangSlots,
    NarralangValue,
    NarralangValueKind,
    NarralangVerb,
    NarralangWord,
} from "./narralangShape";

// --- The closed vocabularies, as values ------------------------------------------------------------

const TRANSITION_WORDS = [
    "fade", "slide", "slide-left", "slide-right", "slide-up", "slide-down", "circle", "wipe", "iris",
    "blur", "blinds", "barn-door", "clock", "fan", "dots", "black", "darkness", "exposure", "zoom", "scale",
    "rotate", "opacity", "darken", "rule", "none",
] as const satisfies readonly StoryTransitionWord[];

/**
 * Every {@link NarralangWord}, as data.
 *
 * A list rather than a derived thing because a union of string literals has no runtime form. The
 * assertion below is what keeps it honest: adding a word to the type without adding it here stops the
 * build, rather than making the word silently unreadable in exactly one direction.
 */
export const NARRALANG_WORDS = [
    ...TRANSITION_WORDS,
    // Blend modes.
    "normal", "screen", "multiply", "lighten", "color-dodge", "overlay",
    // Variable scopes and value types.
    "scene", "saved", "persistent", "boolean", "number", "string", "json",
    // Placement, audio buses, stage singletons.
    "left", "center", "right", "bgm", "sound", "background", "backgroundLayer", "stageLayer",
    // Standalone modifiers and video fit.
    "loop", "once", "muted", "autoFit", "async", "click", "cover", "contain", "fill",
] as const satisfies readonly NarralangWord[];

/** Fails the build when a word joins the type without joining the list above. */
type AssertNever<T extends never> = T;
export type NarralangWordsAreComplete = AssertNever<Exclude<NarralangWord, (typeof NARRALANG_WORDS)[number]>>;

const SPELLING_CACHE = new WeakMap<NarralangDialect, ReadonlyMap<string, NarralangWord>>();

/** The word a spelling names in this dialect, or `undefined`. The inverse of {@link narralangWord}. */
export function narralangWordFromSpelling(dialect: NarralangDialect, text: string): NarralangWord | undefined {
    let table = SPELLING_CACHE.get(dialect);
    if (!table) {
        const built = new Map<string, NarralangWord>();
        for (const word of NARRALANG_WORDS) {
            built.set(narralangWord(dialect, word), word);
        }
        table = built;
        SPELLING_CACHE.set(dialect, built);
    }
    return table.get(text);
}

// --- Verb lookup ------------------------------------------------------------------------------------

export type NarralangVerbEntry = {
    readonly verb: NarralangVerb;
    readonly syntax: NarralangVerbSyntax;
    /** The keyword split into the tokens a line has to open with. */
    readonly words: readonly string[];
};

const VERB_CACHE = new WeakMap<NarralangDialect, ReadonlyMap<string, readonly NarralangVerbEntry[]>>();

/**
 * The verbs a first word can open, longest keyword first.
 *
 * Several verbs may answer to one keyword - the default dialect spells seven of them `show` - so this
 * is a list per word, not an entry. Which one a line means is decided after matching, never here.
 */
export function narralangVerbsByFirstWord(dialect: NarralangDialect): ReadonlyMap<string, readonly NarralangVerbEntry[]> {
    const cached = VERB_CACHE.get(dialect);
    if (cached) {
        return cached;
    }
    const table = new Map<string, NarralangVerbEntry[]>();
    for (const [verb, syntax] of Object.entries(dialect.verbs) as [NarralangVerb, NarralangVerbSyntax][]) {
        if (syntax.keyword === "") {
            continue;
        }
        const words = syntax.keyword.split(" ");
        const list = table.get(words[0]) ?? [];
        list.push({ verb, syntax, words });
        table.set(words[0], list);
    }
    for (const list of table.values()) {
        list.sort((a, b) => b.words.length - a.words.length);
    }
    VERB_CACHE.set(dialect, table);
    return table;
}

// --- Slot matching ------------------------------------------------------------------------------------

/**
 * Whether a token IS this word of the language.
 *
 * Escaped tokens are excluded on purpose: `\show me the money` is the one way an author says "this
 * line is prose", and a keyword that had to be decoded was never a keyword.
 */
export function isNarralangBareWord(token: NarralangToken | undefined, word: string): boolean {
    return token !== undefined && token.quote === "none" && token.escaped === undefined && token.text === word;
}

/**
 * How specific a value kind is.
 *
 * When one token fits two declared kinds - `stop bgm` is the bus if `bgm` is read as a word and a
 * handle called "bgm" if it is read as a name - the closed vocabulary wins. A name accepts anything,
 * so reading a member of a closed set as one is the reading that throws information away.
 */
const KIND_SPECIFICITY: Record<NarralangValueKind, number> = {
    builtin: 3,
    word: 3,
    timedWord: 3,
    color: 3,
    literal: 2,
    seconds: 2,
    number: 2,
    string: 2,
    pairs: 1,
    expression: 1,
    text: 1,
    name: 0,
    names: 0,
};

/** How specific a filled slot set is, summed. Used to rank two readings of one line. */
export function narralangSlotsSpecificity(slots: NarralangSlots): number {
    let total = 0;
    for (const value of Object.values(slots)) {
        if (value !== undefined) {
            total += KIND_SPECIFICITY[value.kind];
        }
    }
    return total;
}

/** How much searching one line may cost. A line that needs more than this is reported, not explored. */
const CANDIDATE_BUDGET = 256;

type MatchContext = {
    readonly tokens: readonly NarralangToken[];
    readonly raw: string;
    readonly dialect: NarralangDialect;
    readonly slots: readonly NarralangSlotSyntax[];
    readonly reportText: (issue: NarralangTextIssue, offset: number, detail?: string) => void;
    budget: number;
};

/**
 * Every way this line fills the verb's slots.
 *
 * Empty means the line is not this statement, which is the whole of the "first token is a keyword AND
 * the rest parses" rule the language rests on - a prose line opening with a keyword falls out here and
 * is read as prose.
 */
export function matchNarralangSlots(
    tokens: readonly NarralangToken[],
    from: number,
    slots: readonly NarralangSlotSyntax[],
    raw: string,
    dialect: NarralangDialect,
    reportText: (issue: NarralangTextIssue, offset: number, detail?: string) => void,
): NarralangSlots[] {
    const ctx: MatchContext = { tokens, raw, dialect, slots, reportText, budget: CANDIDATE_BUDGET };
    const out: NarralangSlots[] = [];
    walkSlots(ctx, from, 0, {}, out);
    return out;
}

function walkSlots(ctx: MatchContext, ti: number, si: number, filled: NarralangSlots, out: NarralangSlots[]): void {
    if (ctx.budget <= 0) {
        return;
    }
    if (ti >= ctx.tokens.length) {
        ctx.budget -= 1;
        out.push(filled);
        return;
    }
    for (let index = si; index < ctx.slots.length; index += 1) {
        const slot = ctx.slots[index];
        const marker = markerLength(ctx, slot, ti);
        if (marker === null) {
            continue;
        }
        for (const read of readValues(ctx, slot, ti + marker, index + 1)) {
            walkSlots(ctx, read.next, index + 1, { ...filled, [slot.slot]: read.value }, out);
        }
    }
}

/** How many tokens this slot's lead (or attached punctuation) takes here, or `null` when it is absent. */
function markerLength(ctx: MatchContext, slot: NarralangSlotSyntax, ti: number): number | null {
    const token = ctx.tokens[ti];
    if (slot.attach !== undefined) {
        return token?.attach === slot.attach ? 1 : null;
    }
    if (slot.lead === undefined) {
        // A positional slot cannot start on a marker token: that punctuation belongs to another slot.
        return token?.attach === undefined ? 0 : null;
    }
    const words = slot.lead.split(" ");
    for (let offset = 0; offset < words.length; offset += 1) {
        if (!isNarralangBareWord(ctx.tokens[ti + offset], words[offset])) {
            return null;
        }
    }
    return words.length;
}

/** Whether a token opens the lead of any slot from `index` on - where a greedy reader has to stop. */
function startsLaterMarker(ctx: MatchContext, ti: number, index: number): boolean {
    if (ctx.tokens[ti]?.attach !== undefined) {
        return true;
    }
    for (let i = index; i < ctx.slots.length; i += 1) {
        if (ctx.slots[i].lead !== undefined && markerLength(ctx, ctx.slots[i], ti) !== null) {
            return true;
        }
    }
    return false;
}

type Read = { value: NarralangValue; next: number };

/** Every value of the slot's declared kind(s) that can be read here. */
function readValues(ctx: MatchContext, slot: NarralangSlotSyntax, ti: number, nextIndex: number): Read[] {
    const kinds = Array.isArray(slot.value) ? slot.value : [slot.value];
    const out: Read[] = [];
    for (const kind of kinds) {
        out.push(...readValue(ctx, kind, ti, nextIndex, slot));
    }
    return out;
}

function readValue(
    ctx: MatchContext,
    kind: NarralangValueKind,
    ti: number,
    nextIndex: number,
    slot: NarralangSlotSyntax,
): Read[] {
    const token = ctx.tokens[ti];
    switch (kind) {
        case "name": {
            if (!token || !isNameToken(ctx, token, ti, nextIndex)) {
                return [];
            }
            return [{ value: { kind: "name", name: token.text }, next: ti + 1 }];
        }
        case "names": {
            const names: string[] = [];
            const reads: Read[] = [];
            for (let i = ti; i < ctx.tokens.length; i += 1) {
                if (!isNameToken(ctx, ctx.tokens[i], i, nextIndex)) {
                    break;
                }
                names.push(ctx.tokens[i].text);
                // Every length is a candidate: how many names a list takes is only decidable once the
                // rest of the line has been matched.
                reads.push({ value: { kind: "names", names: [...names] }, next: i + 1 });
            }
            return reads;
        }
        case "builtin": {
            const sigil = ctx.dialect.prefix.builtin;
            if (!token || token.quote !== "none" || sigil === "" || !token.text.startsWith(sigil)) {
                return [];
            }
            const word = narralangWordFromSpelling(ctx.dialect, token.text.slice(sigil.length));
            return word === undefined ? [] : [{ value: { kind: "builtin", word }, next: ti + 1 }];
        }
        case "word": {
            if (!token || token.quote !== "none") {
                return [];
            }
            const word = narralangWordFromSpelling(ctx.dialect, token.text);
            return word === undefined ? [] : [{ value: { kind: "word", word }, next: ti + 1 }];
        }
        case "timedWord": {
            if (!token || token.quote !== "none") {
                return [];
            }
            const word = narralangWordFromSpelling(ctx.dialect, token.text);
            if (word === undefined) {
                return [];
            }
            const reads: Read[] = [{ value: { kind: "timedWord", word }, next: ti + 1 }];
            const ms = ctx.tokens[ti + 1] === undefined ? null : narralangTokenMs(ctx.tokens[ti + 1]);
            if (ms !== null && !startsLaterMarker(ctx, ti + 1, nextIndex)) {
                reads.unshift({ value: { kind: "timedWord", word, ms }, next: ti + 2 });
            }
            return reads;
        }
        case "string":
            return token?.quote === "string" ? [{ value: { kind: "string", value: token.text }, next: ti + 1 }] : [];
        case "number": {
            const value = token === undefined ? null : narralangTokenNumber(token);
            return value === null ? [] : [{ value: { kind: "number", value }, next: ti + 1 }];
        }
        case "seconds": {
            const ms = token === undefined ? null : narralangTokenMs(token);
            return ms === null ? [] : [{ value: { kind: "seconds", ms }, next: ti + 1 }];
        }
        case "color":
            return token !== undefined && isNarralangColorToken(token)
                ? [{ value: { kind: "color", value: token.text }, next: ti + 1 }]
                : [];
        case "literal": {
            // A literal owns the rest of the slot: `1 + 2` is an expression, not the number one.
            const end = greedyEnd(ctx, ti, nextIndex);
            if (end !== ti + 1 || token === undefined) {
                return [];
            }
            if (token.quote === "string") {
                return [{ value: { kind: "literal", value: token.text }, next: end }];
            }
            if (token.quote !== "none") {
                return [];
            }
            if (token.text === "true" || token.text === "false") {
                return [{ value: { kind: "literal", value: token.text === "true" }, next: end }];
            }
            if (token.text === "null") {
                return [{ value: { kind: "literal", value: null }, next: end }];
            }
            const number = narralangTokenNumber(token);
            return number === null ? [] : [{ value: { kind: "literal", value: number }, next: end }];
        }
        case "expression": {
            const end = greedyEnd(ctx, ti, nextIndex);
            if (end === ti) {
                return [];
            }
            // Sliced raw rather than re-joined from tokens: an expression is a second language's
            // source, and its own spacing is what the author typed.
            const source = ctx.raw.slice(ctx.tokens[ti].start, ctx.tokens[end - 1].end);
            return [{ value: { kind: "expression", source }, next: end }];
        }
        case "pairs": {
            const entries: { key: string; value: number }[] = [];
            const reads: Read[] = [];
            let i = ti;
            while (i + 1 < ctx.tokens.length) {
                if (!isNameToken(ctx, ctx.tokens[i], i, nextIndex)) {
                    break;
                }
                const value = narralangTokenNumber(ctx.tokens[i + 1]);
                if (value === null) {
                    break;
                }
                entries.push({ key: ctx.tokens[i].text, value });
                reads.push({ value: { kind: "pairs", entries: [...entries] }, next: i + 2 });
                i += 2;
            }
            return reads;
        }
        case "text": {
            // Text runs to the end of the line - it is the one value that cannot be delimited, which
            // is why the grammar only ever puts it last.
            const context = proseContext(slot);
            const rest = ctx.raw.slice(ctx.tokens[ti].start);
            return [{
                value: { kind: "text", text: parseNarralangText(rest, context, ctx.dialect, ctx.reportText) },
                next: ctx.tokens.length,
            }];
        }
    }
}

/** Where a greedy reader has to stop: the next token that opens a later slot's lead, or the line's end. */
function greedyEnd(ctx: MatchContext, ti: number, nextIndex: number): number {
    let end = ti;
    while (end < ctx.tokens.length && !startsLaterMarker(ctx, end, nextIndex)) {
        end += 1;
    }
    return end;
}

/**
 * Whether a token can be read as a name here.
 *
 * A quoted one always can - that is what the quoting is for. A bare one may not be a number (the
 * printer quotes a name that opens with a digit for exactly this reason), may not carry attached
 * punctuation, and may not be the lead of a slot still to come, since the line would otherwise read
 * the modifier as part of the name and lose it.
 */
function isNameToken(ctx: MatchContext, token: NarralangToken | undefined, ti: number, nextIndex: number): boolean {
    if (!token || token.quote === "string") {
        return false;
    }
    if (token.quote === "name") {
        return true;
    }
    if (token.attach !== undefined || token.text === "") {
        return false;
    }
    if (startsLaterMarker(ctx, ti, nextIndex)) {
        return false;
    }
    return !/^[0-9-]/.test(token.text);
}

/** Which escaping a text slot was written under. The four contexts differ, and picking wrong is silent. */
function proseContext(slot: NarralangSlotSyntax): NarralangProseContext {
    if (slot.slot === "prompt") {
        return "narration";
    }
    return slot.attach !== undefined ? "dialogueText" : "narration";
}

// --- Dialect validation ---------------------------------------------------------------------------

export type NarralangDialectConflict = {
    readonly keyword: string;
    readonly verbs: readonly [NarralangVerb, NarralangVerb];
    /**
     * `identical` - no line can ever tell the two apart.
     * `subsumed` - every line the narrower verb accepts, the wider one accepts too.
     */
    readonly reason: "identical" | "subsumed";
};

/**
 * Verb pairs a line cannot choose between on shape alone.
 *
 * A table that makes two statements indistinguishable is a bug in the table, and it must be found by
 * looking at the table rather than by a scene coming back wrong - which is the failure this exists to
 * prevent. The default dialect has several of these on purpose (seven verbs are spelled `show`), and
 * the parser resolves them by resolving the SUBJECT: what a name turns out to be decides which verb
 * was meant. A conflict this reports and the subject cannot break is a parse error, not a guess.
 */
export function findNarralangDialectConflicts(dialect: NarralangDialect): NarralangDialectConflict[] {
    const conflicts: NarralangDialectConflict[] = [];
    const byKeyword = new Map<string, NarralangVerb[]>();
    for (const [verb, syntax] of Object.entries(dialect.verbs) as [NarralangVerb, NarralangVerbSyntax][]) {
        if (syntax.keyword === "") {
            continue;
        }
        byKeyword.set(syntax.keyword, [...(byKeyword.get(syntax.keyword) ?? []), verb]);
    }
    for (const [keyword, verbs] of byKeyword) {
        for (let i = 0; i < verbs.length; i += 1) {
            for (let j = i + 1; j < verbs.length; j += 1) {
                const left = dialect.verbs[verbs[i]].slots;
                const right = dialect.verbs[verbs[j]].slots;
                if (isSubsequence(left, right) && isSubsequence(right, left)) {
                    conflicts.push({ keyword, verbs: [verbs[i], verbs[j]], reason: "identical" });
                } else if (isSubsequence(left, right) || isSubsequence(right, left)) {
                    conflicts.push({ keyword, verbs: [verbs[i], verbs[j]], reason: "subsumed" });
                }
            }
        }
    }
    return conflicts;
}

/** Whether every slot of `inner` appears in `outer`, in order and compatibly typed. */
function isSubsequence(inner: readonly NarralangSlotSyntax[], outer: readonly NarralangSlotSyntax[]): boolean {
    let index = 0;
    for (const slot of inner) {
        while (index < outer.length && !slotsOverlap(slot, outer[index])) {
            index += 1;
        }
        if (index >= outer.length) {
            return false;
        }
        index += 1;
    }
    return true;
}

function slotsOverlap(left: NarralangSlotSyntax, right: NarralangSlotSyntax): boolean {
    if (left.lead !== right.lead || left.attach !== right.attach) {
        return false;
    }
    const leftKinds = new Set(Array.isArray(left.value) ? left.value : [left.value]);
    const rightKinds = Array.isArray(right.value) ? right.value : [right.value];
    return rightKinds.some((kind) => leftKinds.has(kind));
}
