/**
 * The NarraLang parser: a script becomes story blocks.
 *
 * Design doc: `docs/plans/2026-08-15-001-plan-narralang.md`, milestone M3.
 *
 * ## The three files, backwards
 *
 * {@link ./narralangLex} cuts a line into tokens, {@link ./narralangMatch} runs the dialect table
 * backwards to fill a verb's slots, and {@link ./narralangBuild} lowers the result into a payload.
 * This file is the walk between them: indentation, prefixes, the prose/statement decision, and the
 * one structure the document has that the script does not - the container a condition's branches hang
 * off.
 *
 * ## A line that does not parse is never prose
 *
 * The reader's rule is "a line is a statement if its first token is a keyword AND the rest parses as
 * that statement". The second half is what lets prose beginning with a keyword be prose; it must NOT
 * become a way for a broken command to turn into narration, because that is a story silently changing
 * meaning. So a line that opens with a keyword and does not parse becomes an `invalid` block carrying
 * its source verbatim, plus a diagnostic - the same bargain the row editor's own `invalid` strikes.
 *
 * ## Identity is not this file's business
 *
 * Every block comes out with a fresh UUID. Matching a parse against the ids of a document it came
 * from is the text view's job (it holds the line to block mapping in memory); a parser that guessed at
 * identity would rebind rows by position, which is how an edit above a scene renames everything below
 * it.
 *
 * ## No locale, ever
 *
 * Same rule as the printer: no `translate`, no localised table. Names resolve through the caller's
 * lookups, which are the mirror of the ones the printer resolves ids through.
 */

import type {
    StoryBlock,
    StoryBlockId,
    StoryExpression,
    StoryScene,
    StoryVariableRef,
} from "@shared/types/story";
import {
    EMPTY_STORY_EXPRESSION_SCOPE,
    isAdvisoryStoryExpressionIssue,
    parseStoryExpression,
    type StoryExpressionScope,
} from "@shared/utils/storyExpressionParser";

import {
    buildNarralangBlock,
    buildNarralangSegment,
    narralangVerbPreference,
    NARRALANG_CONTAINER_VERBS,
    type NarralangBlockDraft,
    type NarralangBuildContext,
    type NarralangBuildWarning,
    type NarralangParseLookups,
    type NarralangResolution,
    type NarralangStageEntry,
} from "./narralangBuild";
import { NARRALANG_DEFAULT_DIALECT, narralangDialectKeywords, type NarralangDialect } from "./narralangDialect";
import { parseNarralangText, tokenizeNarralangLine, type NarralangToken } from "./narralangLex";
import {
    isNarralangBareWord,
    matchNarralangSlots,
    narralangSlotsSpecificity,
    narralangVerbsByFirstWord,
    narralangWordFromSpelling,
} from "./narralangMatch";
import { renderNarralangShape } from "./narralangRender";
import type { NarralangShape, NarralangSlots, NarralangVerb } from "./narralangShape";

export type { NarralangParseLookups, NarralangAppearanceRef, NarralangResolution } from "./narralangBuild";

// --- Diagnostics ------------------------------------------------------------------------------------

/**
 * Why a line could not be read.
 *
 * Coarse and closed, like the printer's {@link NarralangIssueReason}: a diagnostic is shown against a
 * line in an editor, so it names the class of problem rather than the field.
 */
export type NarralangParseReason =
    /** The line opens with a keyword and does not parse as that statement. */
    | "unknownStatement"
    /** A name nothing in the project answers to. */
    | "unknownName"
    /** A name several things answer to. The parser must not pick one. */
    | "ambiguousName"
    /** Several statements fit the line and nothing tells them apart. */
    | "ambiguousStatement"
    /** A word outside the vocabulary the slot accepts. */
    | "badWord"
    /** A statement missing something it cannot do without. */
    | "missingValue"
    /** Two slots that cannot both be filled. */
    | "conflictingValues"
    /** Indentation that is not a whole number of levels, or that skips one. */
    | "badIndent"
    /** An `else` / `else if` with no `if` above it. */
    | "danglingBranch"
    /** A rich-text tag this dialect does not name, or one left open. */
    | "badTag"
    /** Expression source that does not resolve. The tree is kept so the row can be repaired. */
    | "badExpression";

export type NarralangDiagnostic = {
    /** 1-based, so it can be handed to an editor unchanged. */
    readonly line: number;
    readonly column: number;
    readonly reason: NarralangParseReason;
    /** A short, already-resolved noun for the thing at fault. Never an id. */
    readonly detail?: string;
};

export type NarralangParseResult = {
    /** The scene name off the header, or `null` when the text carried none. */
    readonly name: string | null;
    readonly rootBlockIds: StoryBlockId[];
    readonly blocks: Record<StoryBlockId, StoryBlock>;
    readonly diagnostics: NarralangDiagnostic[];
};

export type NarralangParseOptions = {
    /**
     * Where a new block's id comes from. Injectable so a test can be deterministic; the default is a
     * UUID v4, which is what `assertValidStoryEntityId` demands of anything that reaches the store.
     */
    readonly createId?: () => string;
    /**
     * What `visited(…)`, `picked(…)` and a blueprint call resolve against. Variables are supplied by
     * the parse itself (declarations in the text, then the caller's table), so only the tables this
     * file cannot know need passing.
     */
    readonly expressionScope?: Partial<StoryExpressionScope>;
};

// --- Lines ------------------------------------------------------------------------------------------

type LineNode = {
    readonly id: StoryBlockId;
    readonly line: number;
    readonly column: number;
    readonly prefix: "none" | "disabled" | "raw" | "note";
    /** The line's content, with indent and prefix removed. */
    readonly body: string;
    /** The same, with a trailing block marker taken off. Equal to {@link body} when there was none. */
    readonly bodyInBlock: string;
    readonly hadBlockMarker: boolean;
    readonly children: LineNode[];
};

/** How many whole indent units a line opens with. */
function indentDepth(line: string, unit: string): number {
    let depth = 0;
    while (line.startsWith(unit, depth * unit.length)) {
        depth += 1;
    }
    return depth;
}

function stripPrefix(body: string, marker: string): string | null {
    if (marker === "" || !body.startsWith(marker)) {
        return null;
    }
    const rest = body.slice(marker.length);
    return rest.startsWith(" ") ? rest.slice(1) : rest;
}

/**
 * The indentation tree.
 *
 * Indentation is the only nesting mechanism NarraLang has, so this is the whole of the structure. A
 * dialect that also closes a block with a brace still indents its body (the printer emits both), so a
 * line that is only the closing marker carries nothing and is dropped.
 */
function readLineTree(
    text: string,
    dialect: NarralangDialect,
    createId: () => string,
    report: (line: number, column: number, reason: NarralangParseReason, detail?: string) => void,
): LineNode[] {
    const roots: LineNode[] = [];
    const stack: { depth: number; children: LineNode[] }[] = [{ depth: -1, children: roots }];
    const unit = dialect.indent === "" ? "  " : dialect.indent;
    const close = dialect.block.close;
    const lines = text.split("\n");
    // A scene's rows sit one level in, under their header. The first content line sets the level
    // everything else is measured against, so a body that was extracted from a header - or one an
    // author pasted with its indentation - reads the same as one that starts at the margin.
    const base = indentDepth(lines.find((line) => line.trim() !== "") ?? "", unit);

    lines.forEach((raw, index) => {
        const lineNumber = index + 1;
        if (raw.trim() === "") {
            return;
        }
        // A dialect that closes a block with a brace still indents its body, so the closing line is
        // structure the indentation has already stated - and it sits OUTSIDE the levels, which is why
        // it is dropped before the indentation is measured.
        if (close !== null && close !== "" && raw.trim() === close.trim()) {
            return;
        }
        let depth = indentDepth(raw, unit) - base;
        let offset = (depth + base) * unit.length;
        if (depth < 0) {
            report(lineNumber, offset + 1, "badIndent");
            depth = 0;
        }
        if (/^\s/.test(raw.slice(offset))) {
            report(lineNumber, offset + 1, "badIndent");
            offset = raw.length - raw.trimStart().length;
        }
        const rest = raw.slice(offset);
        if (close !== null && close !== "" && rest.trimEnd() === close.trim()) {
            return;
        }
        const parentDepth = stack[stack.length - 1].depth;
        if (depth > parentDepth + 1) {
            report(lineNumber, offset + 1, "badIndent");
            depth = parentDepth + 1;
        }
        while (stack.length > 1 && stack[stack.length - 1].depth >= depth) {
            stack.pop();
        }

        const disabledMarker = dialect.prefix.disabled;
        const rawSource = stripPrefix(rest, `${disabledMarker}${disabledMarker}`);
        const disabled = rawSource === null ? stripPrefix(rest, disabledMarker) : null;
        const note = rawSource === null && disabled === null ? stripPrefix(rest, dialect.prefix.note) : null;
        const prefix = rawSource !== null ? "raw" : disabled !== null ? "disabled" : note !== null ? "note" : "none";
        const body = rawSource ?? disabled ?? note ?? rest;
        const open = dialect.block.open;
        const hadBlockMarker = open !== "" && body.endsWith(open);

        const node: LineNode = {
            id: createId(),
            line: lineNumber,
            column: offset + 1,
            prefix,
            body,
            bodyInBlock: hadBlockMarker ? body.slice(0, -open.length) : body,
            hadBlockMarker,
            children: [],
        };
        stack[stack.length - 1].children.push(node);
        stack.push({ depth, children: node.children });
    });
    return roots;
}

// --- The parse --------------------------------------------------------------------------------------

type ParseState = {
    readonly dialect: NarralangDialect;
    readonly lookups: NarralangParseLookups;
    readonly blocks: Record<StoryBlockId, StoryBlock>;
    readonly diagnostics: NarralangDiagnostic[];
    readonly stage: Map<string, NarralangStageEntry>;
    readonly variables: Map<string, StoryVariableRef>;
    readonly createId: () => string;
    readonly scope: StoryExpressionScope;
};

/** One scene's script as blocks, in a given dialect. */
export function parseNarralangSceneWithDialect(
    text: string,
    lookups: NarralangParseLookups,
    dialect: NarralangDialect,
    options: NarralangParseOptions = {},
): NarralangParseResult {
    const createId = options.createId ?? (() => crypto.randomUUID());
    const diagnostics: NarralangDiagnostic[] = [];
    const report = (line: number, column: number, reason: NarralangParseReason, detail?: string): void => {
        diagnostics.push(detail === undefined ? { line, column, reason } : { line, column, reason, detail });
    };

    const { name, body } = splitSceneHeader(text, dialect);
    const roots = readLineTree(body.text, dialect, createId, (line, column, reason, detail) =>
        report(line + body.lineOffset, column, reason, detail));

    const state: ParseState = {
        dialect,
        lookups,
        blocks: {},
        diagnostics,
        stage: new Map(),
        variables: new Map(),
        createId,
        scope: buildScope(),
    };
    scanSymbols(state, roots);
    const rootBlockIds = buildBlocks(state, roots, null, null, body.lineOffset);
    // A line is read several ways before one of them wins, and a defect in a part every reading shares
    // - a rich-text tag nothing names - is reported once per reading. One line, one complaint.
    const seen = new Set<string>();
    const unique: NarralangDiagnostic[] = [];
    for (const diagnostic of diagnostics) {
        const key = `${diagnostic.line}:${diagnostic.column}:${diagnostic.reason}:${diagnostic.detail ?? ""}`;
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(diagnostic);
        }
    }
    return { name, rootBlockIds, blocks: state.blocks, diagnostics: unique };

    function buildScope(): StoryExpressionScope {
        const lookup = (candidate: string): StoryVariableRef | null => {
            const local = state.variables.get(candidate.trim().toLowerCase());
            if (local) {
                return local;
            }
            const external = lookups.variableRef?.(candidate);
            return external === null || external === undefined || external === "ambiguous" ? null : external;
        };
        return {
            ...EMPTY_STORY_EXPRESSION_SCOPE,
            ...options.expressionScope,
            lookup,
            lookupIn: (scope, candidate) => {
                const found = lookup(candidate);
                return found && found.scope === scope ? found : null;
            },
        };
    }
}

/** One scene's script as blocks. */
export function parseNarralangScene(
    text: string,
    lookups: NarralangParseLookups,
    options?: NarralangParseOptions,
): NarralangParseResult {
    return parseNarralangSceneWithDialect(text, lookups, NARRALANG_DEFAULT_DIALECT, options);
}

/**
 * A parse applied to a scene, so a caller holding one gets a scene back.
 *
 * The scene keeps its own id and runtime name: those are identity, and a script never carried them.
 */
export function applyNarralangParse(scene: StoryScene, result: NarralangParseResult): StoryScene {
    return {
        ...scene,
        name: result.name ?? scene.name,
        rootBlockIds: result.rootBlockIds,
        blocks: result.blocks,
    };
}

type SceneHeader = { name: string | null; body: { text: string; lineOffset: number } };

function splitSceneHeader(text: string, dialect: NarralangDialect): SceneHeader {
    const lines = text.split("\n");
    const first = lines.findIndex((line) => line.trim() !== "");
    if (first < 0) {
        return { name: null, body: { text, lineOffset: 0 } };
    }
    const header = lines[first].trim();
    const keyword = dialect.sceneKeyword;
    if (keyword === "" || !header.startsWith(`${keyword} `) || !header.endsWith(dialect.block.open.trim())) {
        return { name: null, body: { text, lineOffset: 0 } };
    }
    const inner = header.slice(keyword.length, header.length - dialect.block.open.trim().length);
    const tokens = tokenizeNarralangLine(inner, dialect);
    return {
        name: tokens[0]?.text ?? null,
        body: { text: lines.slice(first + 1).join("\n"), lineOffset: first + 1 },
    };
}

// --- Symbols -------------------------------------------------------------------------------------------

const CREATORS: Partial<Record<NarralangVerb, NarralangStageEntry["kind"]>> = {
    imageCreate: "image",
    textCreate: "text",
    layerCreate: "layer",
    videoCreate: "video",
    vfxCreate: "vfx",
};

/**
 * What the names in this text refer to, read before anything is built.
 *
 * Two tables, and both exist because a reference can point at a row further down the file: a `menu`
 * branch may set a variable declared under it, and an `if` body may address an image the scene
 * created outside the branch. It is also what tells the seven `show` verbs apart - see
 * {@link ./narralangBuild}.
 *
 * Deliberately a cheap scan rather than a first full parse: it only needs the verb's keyword and the
 * first name after it, and doing it with the real matcher would need the tables it is building.
 */
function scanSymbols(state: ParseState, nodes: readonly LineNode[]): void {
    for (const node of nodes) {
        if (node.prefix === "none") {
            scanLine(state, node);
        }
        scanSymbols(state, node.children);
    }
}

function scanLine(state: ParseState, node: LineNode): void {
    const tokens = tokenizeNarralangLine(node.bodyInBlock, state.dialect);
    if (tokens.length === 0 || tokens[0].quote !== "none") {
        return;
    }
    const entry = matchKeyword(state.dialect, tokens);
    if (!entry) {
        return;
    }
    const subject = tokens[entry.words.length];
    if (!subject || subject.text === "") {
        return;
    }
    const created = CREATORS[entry.verb];
    if (created !== undefined) {
        if (!state.stage.has(subject.text)) {
            state.stage.set(subject.text, { kind: created, blockId: node.id });
        }
        return;
    }
    if (entry.verb === "declaration") {
        state.variables.set(subject.text.trim().toLowerCase(), { scope: scopeOf(state.dialect, tokens), variableId: node.id });
        return;
    }
    // A character has no creator row: the first row that names one is what a later reference binds
    // to, which is the same rule `displayableSourceIdentity` applies to a character action block.
    const character = state.lookups.characterId?.(subject.text);
    if (character && character !== "ambiguous" && !state.stage.has(subject.text)) {
        state.stage.set(subject.text, { kind: "character", blockId: node.id });
    }
}

/**
 * Which scope a declaration line names, off the dialect rather than off the word `in`.
 *
 * The scan happens before anything is matched, so it has to read the table itself - and reading it is
 * what keeps a renamed preposition from silently filing every variable under the default scope.
 */
function scopeOf(dialect: NarralangDialect, tokens: readonly NarralangToken[]): StoryVariableRef["scope"] {
    const lead = dialect.verbs.declaration.slots.find((slot) => slot.slot === "scope")?.lead;
    if (lead === undefined) {
        return "scene";
    }
    const words = lead.split(" ");
    for (let index = 1; index < tokens.length; index += 1) {
        if (!words.every((word, offset) => isNarralangBareWord(tokens[index + offset], word))) {
            continue;
        }
        const word = tokens[index + words.length];
        const scope = word === undefined ? undefined : narralangWordFromSpelling(dialect, word.text);
        return scope === "saved" || scope === "persistent" ? scope : "scene";
    }
    return "scene";
}

/** The verb whose keyword these tokens open with, longest first. */
function matchKeyword(dialect: NarralangDialect, tokens: readonly NarralangToken[]) {
    const candidates = narralangVerbsByFirstWord(dialect).get(tokens[0]?.text ?? "") ?? [];
    return candidates.find((entry) => entry.words.every((word, index) => isNarralangBareWord(tokens[index], word)));
}

// --- Blocks -----------------------------------------------------------------------------------------------

/**
 * A run of lines as blocks.
 *
 * The one place the tree here differs from the tree in the document: `if` / `else if` / `else` are
 * siblings in a script and children of a `condition` container in the document, so a branch opens one
 * and the branches after it join it. That is the exact inverse of the `transparent` shape the printer
 * uses to hide the container again.
 */
function buildBlocks(
    state: ParseState,
    nodes: readonly LineNode[],
    parentId: StoryBlockId | null,
    parentVerb: NarralangVerb | null,
    lineOffset: number,
): StoryBlockId[] {
    const out: StoryBlockId[] = [];
    let condition: StoryBlock | null = null;
    for (const node of nodes) {
        const parsed = parseLine(state, node, parentVerb, lineOffset);
        if (!parsed) {
            continue;
        }
        const { block, verb } = parsed;
        const branch = verb === "conditionIf" || verb === "conditionElseIf" || verb === "conditionElse";
        if (!branch) {
            condition = null;
        } else if (verb === "conditionIf" || condition === null) {
            if (verb !== "conditionIf") {
                report(state, node, lineOffset, "danglingBranch");
            }
            const container: StoryBlock = {
                id: state.createId(),
                kind: "control",
                parentId,
                childrenIds: [],
                payload: { control: "condition" },
            };
            state.blocks[container.id] = container;
            out.push(container.id);
            condition = container;
        }

        const owner = branch && condition ? condition : null;
        const row: StoryBlock = { ...block, parentId: owner ? owner.id : parentId } as StoryBlock;
        state.blocks[row.id] = row;
        if (owner) {
            owner.childrenIds.push(row.id);
        } else {
            out.push(row.id);
        }
        row.childrenIds = buildBlocks(state, node.children, row.id, verb, lineOffset);
    }
    return out;
}

type ParsedLine = { block: StoryBlock; verb: NarralangVerb | null };

function parseLine(state: ParseState, node: LineNode, parentVerb: NarralangVerb | null, lineOffset: number): ParsedLine | null {
    const disabled = node.prefix === "disabled" ? { disabled: true } : {};
    if (node.prefix === "raw") {
        // An unparsed command line, carried through as one. Re-reading it as script would change what
        // it means, which is the whole reason the printer doubles the marker on the way out.
        return {
            block: { id: node.id, kind: "invalid", parentId: null, childrenIds: [], payload: { source: node.body }, ...disabled },
            verb: null,
        };
    }
    if (node.prefix === "note") {
        const text = parseNarralangText(node.body, "note", state.dialect, (issue, offset, detail) =>
            report(state, node, lineOffset, "badTag", detail ?? issue, offset));
        const draft = draftContext(state, node.id);
        return {
            block: {
                id: node.id,
                kind: "note",
                parentId: null,
                childrenIds: [],
                payload: { text: buildNarralangSegment(draft, text, "note") },
                ...disabled,
            },
            verb: null,
        };
    }

    // Under a `menu`, every child IS an option - that is what the document model says a choice's
    // children are - so a line whose text happens to read as a statement is still its option.
    const statement = parentVerb === "choice" ? null : parseStatement(state, node, lineOffset);
    if (statement && "block" in statement) {
        return {
            block: { ...statement.block, ...disabled } as StoryBlock,
            verb: statement.verb,
        };
    }
    if (statement !== null || opensWithKeyword(state, node)) {
        // A keyword that did not parse is an error, never a line of narration.
        report(state, node, lineOffset, statement?.reason ?? "unknownStatement", statement?.detail);
        return {
            block: { id: node.id, kind: "invalid", parentId: null, childrenIds: [], payload: { source: node.body }, ...disabled },
            verb: null,
        };
    }
    return {
        block: { ...parseProse(state, node, parentVerb, lineOffset), ...disabled } as StoryBlock,
        verb: parentVerb === "choice" ? "choiceOption" : null,
    };
}

function opensWithKeyword(state: ParseState, node: LineNode): boolean {
    const tokens = tokenizeNarralangLine(node.bodyInBlock, state.dialect);
    const first = tokens[0];
    return first !== undefined && first.quote === "none" && first.escaped === undefined
        && narralangDialectKeywords(state.dialect).has(first.text);
}

type ParsedStatement = { block: StoryBlock; verb: NarralangVerb };

/** What the line failed at, when it opened with a keyword and no reading of it built. */
type StatementFailure = { reason: NarralangParseReason; detail?: string };

/** One way the line fits a verb, with everything the ranking needs to compare it to another. */
type Reading = {
    block: StoryBlock;
    verb: NarralangVerb;
    score: number;
    warnings: readonly NarralangBuildWarning[];
};

/**
 * The line as a statement, or `null` when it is not one.
 *
 * Every reading of the line is built, and the ones that cannot become a payload are dropped - which is
 * how the seven verbs spelled `show` are told apart, and how `at left with fade` learns that its
 * `with` is the row's transition rather than the transform's. What is left is ranked: a reading that
 * prints back as the line it came from beats one that does not, a purpose-built verb beats the raw
 * channel, and a tie is reported rather than settled by declaration order.
 */
function parseStatement(state: ParseState, node: LineNode, lineOffset: number): ParsedStatement | StatementFailure | null {
    const attempts = node.hadBlockMarker ? [node.bodyInBlock, node.body] : [node.body];
    const failures: StatementFailure[] = [];
    for (const [index, source] of attempts.entries()) {
        const insideBlock = node.hadBlockMarker && index === 0;
        const tokens = tokenizeNarralangLine(source, state.dialect);
        if (tokens.length === 0 || tokens[0].quote !== "none") {
            continue;
        }
        const entries = narralangVerbsByFirstWord(state.dialect).get(tokens[0].text) ?? [];
        const ranked: Reading[] = [];
        for (const entry of entries) {
            if (!entry.words.every((word, i) => isNarralangBareWord(tokens[i], word))) {
                continue;
            }
            // A block marker is structure only on a row that takes children; on any other verb it was
            // part of the line's own text and this reading is wrong.
            if (insideBlock && !NARRALANG_CONTAINER_VERBS.has(entry.verb)) {
                continue;
            }
            const matches = matchNarralangSlots(
                tokens,
                entry.words.length,
                entry.syntax.slots,
                source,
                state.dialect,
                (issue, offset, detail) => report(state, node, lineOffset, "badTag", detail ?? issue, offset),
            );
            for (const slots of matches) {
                const draft = draftContext(state, node.id);
                const built = buildNarralangBlock(draft, entry.verb, slots);
                if (!built.ok) {
                    failures.push(built.detail === undefined
                        ? { reason: built.reason }
                        : { reason: built.reason, detail: built.detail });
                    continue;
                }
                ranked.push({
                    block: blockOf(node.id, built.draft),
                    verb: entry.verb,
                    score: scoreOf(state, entry.verb, slots, insideBlock, source),
                    warnings: built.warnings,
                });
            }
        }
        if (ranked.length === 0) {
            continue;
        }
        ranked.sort((a, b) => b.score - a.score);
        if (ranked.length > 1 && ranked[0].score === ranked[1].score && ranked[0].verb !== ranked[1].verb) {
            report(state, node, lineOffset, "ambiguousStatement", ranked[0].verb);
        }
        // Only the reading that won says anything: the others were readings of a line that meant
        // something else, and their complaints are about a statement the author never wrote.
        for (const warning of ranked[0].warnings) {
            report(state, node, lineOffset, warning.reason, warning.detail);
        }
        return { block: ranked[0].block, verb: ranked[0].verb };
    }
    return failures.length === 0 ? null : summarize(failures);
}

/**
 * One diagnostic for a line every reading of which refused.
 *
 * When the refusals agree, theirs is the message: `jump '天台'` failing on a scene nobody has is a
 * far better thing to read than "this is not a statement". When they disagree - seven verbs are
 * spelled `show`, and each refused a subject that was not its own - naming one of them would be
 * naming a statement the author may not have meant, so the line is reported as a whole.
 */
function summarize(failures: readonly StatementFailure[]): StatementFailure {
    // Ranked by how much the refusal knows. "Two things answer to this name" is a fact about the
    // project; "this statement wants a subject" is a fact about a reading of the line that was
    // probably not the one meant.
    const rank: Partial<Record<NarralangParseReason, number>> = {
        ambiguousName: 4,
        conflictingValues: 3,
        badWord: 2,
        unknownName: 1,
        missingValue: 0,
    };
    const best = failures.reduce((left, right) => ((rank[right.reason] ?? 0) > (rank[left.reason] ?? 0) ? right : left));
    const rivals = failures.filter((failure) => (rank[failure.reason] ?? 0) === (rank[best.reason] ?? 0));
    const agreed = rivals.every((failure) => failure.reason === best.reason && failure.detail === best.detail);
    return agreed ? best : { reason: "unknownStatement" };
}

/**
 * How well a reading fits, in three tiers.
 *
 * A reading that prints back as the line it came from beats one that does not - the printer is the
 * only oracle the parser has for "is this what the author's document said?". Then a purpose-built verb
 * beats the raw channel that accepts everything. Then the reading that threw the least information
 * away: a token that is a member of a closed vocabulary was written because the value was that word.
 *
 * Two readings that tie in all three differ only in which slot a modifier hung off, and there the
 * dialect's own declaration order decides - a project that wants the other reading moves the slot.
 */
function scoreOf(state: ParseState, verb: NarralangVerb, slots: NarralangSlots, opensBlock: boolean, source: string): number {
    const shape: NarralangShape = opensBlock
        ? { form: "statement", verb, slots, opensBlock: true }
        : { form: "statement", verb, slots };
    const printed = renderNarralangShape(shape, state.dialect);
    const exact = printed === (opensBlock ? `${source}${state.dialect.block.open}` : source);
    return (exact ? 1000 : 0) + narralangVerbPreference(verb) * 100 + narralangSlotsSpecificity(slots);
}

// --- Prose ---------------------------------------------------------------------------------------------

/**
 * The default line.
 *
 * Three forms, decided by structure rather than by anything on the line itself: a line under a `menu`
 * is one of its options, a line carrying an unescaped speaker separator is dialogue, and everything
 * else is narration. That ordering is what lets the text of a narration line hold anything at all.
 */
function parseProse(state: ParseState, node: LineNode, parentVerb: NarralangVerb | null, lineOffset: number): StoryBlock {
    const draft = draftContext(state, node.id);
    const reportTag = (issue: string, offset: number, detail?: string): void =>
        report(state, node, lineOffset, "badTag", detail ?? issue, offset);

    if (parentVerb === "choice") {
        const source = node.bodyInBlock;
        const tokens = tokenizeNarralangLine(source, state.dialect);
        const optionSlots = state.dialect.verbs.choiceOption.slots;
        const leading = optionSlots.filter((slot) => slot.lead !== undefined);
        const cut = firstLeadToken(tokens, leading.map((slot) => slot.lead ?? ""));
        const textSource = cut === null ? source : source.slice(0, tokens[cut].start).replace(/ $/, "");
        const slots: NarralangSlots = cut === null
            ? {}
            : matchNarralangSlots(tokens, cut, leading, source, state.dialect, reportTag)[0] ?? {};
        const built = buildNarralangBlock(draft, "choiceOption", {
            ...slots,
            text: { kind: "text", text: parseNarralangText(textSource, "option", state.dialect, reportTag) },
        });
        if (built.ok) {
            for (const warning of built.warnings) {
                report(state, node, lineOffset, warning.reason, warning.detail);
            }
            return blockOf(node.id, built.draft);
        }
        report(state, node, lineOffset, built.reason, built.detail);
    }

    const split = splitSpeaker(node.body, state.dialect);
    if (split) {
        const tokens = tokenizeNarralangLine(split.head, state.dialect);
        const dialogueSlots = state.dialect.verbs.dialogue.slots.filter((slot) => slot.slot !== "text");
        const slots = matchNarralangSlots(tokens, 0, dialogueSlots, split.head, state.dialect, reportTag)[0];
        if (slots) {
            const built = buildNarralangBlock(draft, "dialogue", {
                ...slots,
                text: { kind: "text", text: parseNarralangText(split.text, "dialogueText", state.dialect, reportTag) },
            });
            if (built.ok) {
                return blockOf(node.id, built.draft);
            }
            report(state, node, lineOffset, built.reason, built.detail);
        }
    }

    const built = buildNarralangBlock(draft, "narration", {
        text: { kind: "text", text: parseNarralangText(node.body, "narration", state.dialect, reportTag) },
    });
    if (!built.ok) {
        report(state, node, lineOffset, built.reason, built.detail);
        return { id: node.id, kind: "invalid", parentId: null, childrenIds: [], payload: { source: node.body } };
    }
    return blockOf(node.id, built.draft);
}

/** The first token that opens one of these leads - where an option's text stops. */
function firstLeadToken(tokens: readonly NarralangToken[], leads: readonly string[]): number | null {
    for (let index = 0; index < tokens.length; index += 1) {
        for (const lead of leads) {
            const words = lead.split(" ");
            if (words.every((word, offset) => isNarralangBareWord(tokens[index + offset], word))) {
                return index;
            }
        }
    }
    return null;
}

/**
 * Split a line at its speaker separator, or `null` when it has none.
 *
 * The FIRST unescaped one, which is why the printer escapes every occurrence in narration rather than
 * only the first: a line with two of them would otherwise split in the wrong place.
 */
function splitSpeaker(body: string, dialect: NarralangDialect): { head: string; text: string } | null {
    const separator = dialect.speakerSeparator;
    const mark = dialect.escape;
    if (separator === "") {
        return null;
    }
    let index = 0;
    while (index < body.length) {
        if (mark !== "" && body.startsWith(mark, index)) {
            index += mark.length + 1;
            continue;
        }
        if (body.startsWith(separator, index)) {
            const after = index + separator.length;
            if (after >= body.length) {
                return { head: body.slice(0, index), text: "" };
            }
            if (body[after] === " ") {
                return { head: body.slice(0, index), text: body.slice(after + 1) };
            }
        }
        index += 1;
    }
    return null;
}

// --- Plumbing ---------------------------------------------------------------------------------------------

function blockOf(id: StoryBlockId, draft: NarralangBlockDraft): StoryBlock {
    return { id, parentId: null, childrenIds: [], ...draft } as StoryBlock;
}

function draftContext(state: ParseState, blockId: StoryBlockId): NarralangBuildContext {
    return {
        lookups: state.lookups,
        blockId,
        createTextId: state.createId,
        stage: (name) => state.stage.get(name) ?? null,
        variable: (name) => variableRef(state, name),
        expression: (source) => parseExpression(state, source),
    };
}

function variableRef(state: ParseState, name: string): NarralangResolution<StoryVariableRef> {
    const local = state.variables.get(name.trim().toLowerCase());
    if (local) {
        return local;
    }
    return state.lookups.variableRef?.(name) ?? null;
}

function parseExpression(state: ParseState, source: string): { expression: StoryExpression; ok: boolean } {
    const parsed = parseStoryExpression(source, state.scope);
    return { expression: parsed.expression, ok: parsed.issues.every(isAdvisoryStoryExpressionIssue) };
}

function report(
    state: ParseState,
    node: LineNode,
    lineOffset: number,
    reason: NarralangParseReason,
    detail?: string,
    offset = 0,
): void {
    const line = node.line + lineOffset;
    const column = node.column + offset;
    state.diagnostics.push(detail === undefined ? { line, column, reason } : { line, column, reason, detail });
}
