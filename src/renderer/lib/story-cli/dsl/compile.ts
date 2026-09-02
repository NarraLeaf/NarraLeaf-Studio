/**
 * {@link StoryFileAst} to a scene, through the pipeline the row editor commits through.
 *
 * A command line is parsed, resolved and built by `parseCommandLine` → `resolveCommandLine` →
 * `spec.build`, which is the same three calls Enter makes in Studio. So a line that commits there
 * lands the same block here, and a command added to the registry needs no work in this file at all.
 *
 * ## Two passes, because a scene refers to itself
 *
 * `/show hero` resolves against the objects standing on the stage, and `/goto intro` against the
 * labels in the scene - both of which the file being read is what defines. One pass would resolve
 * those against the scene as it was BEFORE the edit, so a row added in this file could not be named
 * by another row in the same file. So the file is compiled twice: once against the stored scene, and
 * again against the scene the first pass produced. Only the second pass's diagnostics are kept.
 *
 * ## What the anchor buys
 *
 * A line carrying an anchor is a line that already has a row, and that row supplies everything the
 * text cannot say - a segment's `textId` (which every translation of the line is filed under), a
 * dialogue row's voice clip, an option's hidden/disabled conditions. A line with no anchor is new
 * and gets a fresh id. Nothing is ever matched by position.
 *
 * ## A file describes the whole scene
 *
 * Rows the file does not mention are gone when it is applied - the same bargain `.bp` and `.ui`
 * strike. Which is exactly why an unspellable row is printed as an opaque line rather than left out:
 * a row nobody can see in the file is a row that silently disappears.
 *
 * Comments in English per project convention.
 */

import type {
    StoryBlock,
    StoryBlockId,
    StoryDocument,
    StoryScene,
} from "@shared/types/story";
import { canAcceptChildren } from "@services/story/storyModel";
import {
    canCommit,
    missingCoreParams,
    parseCommandLine,
} from "@/apps/workspace/modules/story/scene-editor/storyCommandParser";
import {
    expressionScope,
    resolveCommandLine,
} from "@/apps/workspace/modules/story/scene-editor/storyCommandResolution";
import type { StoryCommandContext } from "@/apps/workspace/modules/story/scene-editor/storyCommandValues";
import { getCommandSpec } from "@/apps/workspace/modules/story/scene-editor/commands/registry";
import { errorAt, type StoryFileAst, type StoryFileDiagnostic, type StoryFileLine } from "./ast";
import { conditionFromSource, type ConditionLookups } from "./condition";
import { sameRowContent } from "./equal";
import { buildProseBlock, type ProseLookups } from "./prose";
import { BRANCH_ELSE, unescapeText } from "./shapes";

export type CompileInput = {
    ast: StoryFileAst;
    /** The scene the file was printed from, or null when the file describes a new one. */
    existing: StoryScene | null;
    document: StoryDocument | null;
    /** Rebuilt per pass against the scene as it stands, so a row can name one the file just added. */
    contextFor: (scene: StoryScene | null) => StoryCommandContext;
    prose: ProseLookups;
    conditions: ConditionLookups;
    mintId: () => string;
};

export type CompileResult = {
    scene: StoryScene | null;
    diagnostics: StoryFileDiagnostic[];
};

export function compileStoryFile(input: CompileInput): CompileResult {
    // First pass against the stored scene, discarded except for the scene it produces; second pass
    // against that, which is the one whose diagnostics an author reads. See the note above.
    const first = compilePass(input, input.contextFor(input.existing));
    return compilePass(input, input.contextFor(first.scene ?? input.existing));
}

function compilePass(input: CompileInput, context: StoryCommandContext): CompileResult {
    const diagnostics: StoryFileDiagnostic[] = [];
    const byAnchor = anchorTable(input.existing);
    const blocks: Record<StoryBlockId, StoryBlock> = {};
    const rootBlockIds: StoryBlockId[] = [];
    /** The open block at each depth, so a line knows what it hangs under. */
    const openAt: (StoryBlock | null)[] = [];
    const usedIds = new Set<StoryBlockId>();

    for (const line of input.ast.lines) {
        const previous = resolveAnchor(line, byAnchor, input.ast, diagnostics);
        const built = buildLineBlock(line, {
            previous,
            context,
            prose: input.prose,
            conditions: input.conditions,
            data: input.ast.data,
            mintId: input.mintId,
        });
        if (!built.ok) {
            diagnostics.push(...built.diagnostics);
            continue;
        }
        // A row nobody edited is returned as it was, not as it was rebuilt. The two say the same
        // thing either way, but they are not the same BYTES: a payload assembled by spreading
        // objects comes out in a different key order, so writing the rebuild would move every row
        // of the scene in the file on disk and turn a one-line edit into a scene-wide diff.
        const block = previous && sameRowContent(built.block, previous)
            ? ({ ...previous, id: built.block.id } as StoryBlock)
            : built.block;
        if (usedIds.has(block.id)) {
            diagnostics.push(
                errorAt(
                    "compile.duplicate_anchor",
                    `Two lines carry the anchor for the same row. An anchor names one row; delete one of them or `
                        + `remove its anchor to make it a new row.`,
                    line.lineNumber,
                ),
            );
            continue;
        }
        usedIds.add(block.id);

        const parent = parentFor(line, openAt, diagnostics);
        const placed: StoryBlock = {
            ...block,
            parentId: parent?.id ?? null,
            childrenIds: [],
            ...(line.disabled ? { disabled: true } : {}),
        } as StoryBlock;
        blocks[placed.id] = placed;
        if (parent) {
            blocks[parent.id] = { ...blocks[parent.id], childrenIds: [...blocks[parent.id].childrenIds, placed.id] } as StoryBlock;
        } else {
            rootBlockIds.push(placed.id);
        }
        // Whatever was open deeper than this line is closed by it.
        openAt.length = line.depth;
        openAt[line.depth] = canAcceptChildren(placed) ? placed : null;
    }

    diagnostics.push(...checkStructure(blocks, input.ast));

    const base = input.existing;
    const scene: StoryScene | null = base
        ? { ...base, name: input.ast.sceneName ?? base.name, rootBlockIds, blocks: inStoredOrder(blocks, base) }
        : null;
    return { scene, diagnostics };
}

/**
 * The rows keyed in the order the document already had them, with new rows after.
 *
 * `blocks` is a map and its key order means nothing to anything that reads a scene - but it is what
 * decides the order of four thousand lines in `storydoc.json`, and this compiler assembles the map
 * in FILE order. Writing that back would move every row of the record on a one-line edit, and a
 * reviewer would have to read a scene-wide diff to find it. So the stored order is kept for every
 * row that survived, which leaves the file on disk changed only where the story changed.
 */
function inStoredOrder(
    blocks: Record<StoryBlockId, StoryBlock>,
    existing: StoryScene,
): Record<StoryBlockId, StoryBlock> {
    const ordered: Record<StoryBlockId, StoryBlock> = {};
    for (const id of Object.keys(existing.blocks ?? {})) {
        if (blocks[id]) {
            ordered[id] = blocks[id];
        }
    }
    for (const [id, block] of Object.entries(blocks)) {
        if (!ordered[id]) {
            ordered[id] = block;
        }
    }
    return ordered;
}

// ---------------------------------------------------------------------------
// One line
// ---------------------------------------------------------------------------

type LineContext = {
    previous: StoryBlock | null;
    context: StoryCommandContext;
    prose: ProseLookups;
    conditions: ConditionLookups;
    data: Record<string, StoryBlock>;
    mintId: () => string;
};

type LineResult =
    | { ok: true; block: StoryBlock }
    | { ok: false; diagnostics: StoryFileDiagnostic[] };

export function buildLineBlock(line: StoryFileLine, ctx: LineContext): LineResult {
    switch (line.shape) {
        case "opaque":
            return buildOpaque(line, ctx);
        case "branch":
            return buildBranch(line, ctx);
        case "command":
            return buildCommand(line, ctx);
        default: {
            const built = buildProseBlock({ shape: line.shape, text: line.text }, {
                previous: ctx.previous,
                mintId: ctx.mintId,
                lookups: ctx.prose,
            });
            return built.ok
                ? { ok: true, block: built.block }
                : {
                    ok: false,
                    diagnostics: [
                        errorAt(
                            `compile.${built.reason}`,
                            `${built.detail}. Rename one of them, or write the line without a speaker binding.`,
                            line.lineNumber,
                        ),
                    ],
                };
        }
    }
}

/**
 * An opaque line: the row it stands for, taken verbatim.
 *
 * The label is never read. It is there so a person and an agent can see that the row exists and
 * roughly what it is; the payload comes from `#data`, or from the row the anchor already names when
 * the file is being checked against the scene it was printed from. A label edited by hand changes
 * nothing, which is the property that makes the whole escape hatch safe.
 */
function buildOpaque(line: StoryFileLine, ctx: LineContext): LineResult {
    if (!line.anchorId) {
        return {
            ok: false,
            diagnostics: [
                errorAt(
                    "compile.opaque_without_anchor",
                    "An opaque row has no anchor, so there is nothing to restore it from. Only \"story show\" writes "
                        + "these lines; a new row has to be written as a command or as prose.",
                    line.lineNumber,
                ),
            ],
        };
    }
    const stored = ctx.data[line.anchorId] ?? ctx.previous;
    if (!stored) {
        return {
            ok: false,
            diagnostics: [
                errorAt(
                    "compile.opaque_missing",
                    `Nothing in #data answers to "${line.anchorId}", and no row in the scene does either. The `
                        + "payload this line stands for is not in the file.",
                    line.lineNumber,
                ),
            ],
        };
    }
    return { ok: true, block: stored };
}

function buildBranch(line: StoryFileLine, ctx: LineContext): LineResult {
    const source = unescapeText(line.text).trim();
    const base = {
        id: ctx.previous?.id ?? ctx.mintId(),
        parentId: null,
        childrenIds: [],
    };
    if (source === BRANCH_ELSE) {
        return {
            ok: true,
            block: { ...base, kind: "control", payload: { control: "conditionBranch", branch: "else" } },
        };
    }
    if (!source) {
        return {
            ok: false,
            diagnostics: [
                errorAt("compile.empty_branch", `A branch needs a condition, or the word "${BRANCH_ELSE}".`, line.lineNumber),
            ],
        };
    }
    const condition = conditionFromSource(source, expressionScope(ctx.context));
    if (!condition.ok) {
        return {
            ok: false,
            diagnostics: [errorAt("compile.bad_condition", condition.message, line.lineNumber)],
        };
    }
    // The branch keeps whichever of `if` / `elseIf` it already was, because the two differ only in
    // where they sit and the order of the lines already says that. A new branch is an `if`; the
    // structure check below is what reports a second one.
    const branch = ctx.previous?.kind === "control" && ctx.previous.payload.control === "conditionBranch"
        ? ctx.previous.payload.branch
        : "if";
    return {
        ok: true,
        block: {
            ...base,
            kind: "control",
            payload: { control: "conditionBranch", branch: branch === "else" ? "if" : branch, condition: condition.condition },
        },
    };
}

function buildCommand(line: StoryFileLine, ctx: LineContext): LineResult {
    const source = line.text;
    const parsed = parseCommandLine(source);
    if (parsed.kind !== "command") {
        return {
            ok: false,
            diagnostics: [errorAt("compile.not_a_command", `"${source}" does not read as a command.`, line.lineNumber)],
        };
    }
    const diagnostics: StoryFileDiagnostic[] = parsed.issues.map(issue =>
        errorAt(`compile.${issue.code}`, describeParseIssue(issue, source), line.lineNumber),
    );
    if (!parsed.def) {
        return { ok: false, diagnostics };
    }
    const spec = getCommandSpec(parsed.def.commandId);
    const { args, issues } = resolveCommandLine(parsed, ctx.context);
    for (const issue of issues) {
        diagnostics.push(
            errorAt(
                `compile.${issue.code}`,
                `${issue.code}: "${(issue as { value?: string }).value ?? ""}" in ${source}`.trim(),
                line.lineNumber,
            ),
        );
    }
    // The editor lets an unfinished line sit as a draft row until the author fills it in. A file has
    // no draft state - it is applied whole - so the same line is an error here, naming the slot.
    //
    // Except where the spec says the row it scaffolds is what holds the value: `/if` builds only the
    // container, and the condition an author types on that line is written onto the branch created
    // under it. In a file those branches are lines of their own, so the container is written bare and
    // its "missing" core param is on the next line down.
    if (!canCommit(parsed) && !spec?.scaffold) {
        const missing = missingCoreParams(parsed).map(param => param.name);
        diagnostics.push(
            errorAt(
                "compile.missing_core",
                missing.length > 0
                    ? `/${parsed.token} needs ${missing.map(name => `"${name}"`).join(", ")}.`
                    : `/${parsed.token} is incomplete.`,
                line.lineNumber,
            ),
        );
    }
    if (diagnostics.length > 0) {
        return { ok: false, diagnostics };
    }
    if (!spec?.build) {
        return {
            ok: false,
            diagnostics: [
                errorAt(
                    "compile.no_build",
                    `/${parsed.token} builds no row. It is a retired command kept so old rows still read.`,
                    line.lineNumber,
                ),
            ],
        };
    }
    const built = spec.build(args, { generateId: ctx.mintId, context: ctx.context });
    // The row the anchor names keeps its id, so a line an agent edited is the same row - and with it
    // every save anchor filed under it. Everything else comes from the line.
    return { ok: true, block: ctx.previous ? carryIdentity(built, ctx.previous) : built };
}

/**
 * What a rebuilt row takes from the row it replaces: its id, and its text's identity.
 *
 * A `build` mints a fresh id for the block and a fresh `textId` for any segment it writes, because
 * from its own point of view it is making a new row. Here it is not - the line carried an anchor -
 * and the `textId` is the unit every translation of that line is filed under. Minting a new one
 * because someone edited a prompt would unlink each of those with nothing recording what they were.
 * The prose reader does the same for the same reason; this is that rule for the rows a command
 * writes.
 */
function carryIdentity(built: StoryBlock, previous: StoryBlock): StoryBlock {
    const next = { ...built, id: previous.id } as StoryBlock;
    for (const slot of ["text", "prompt"] as const) {
        const carried = segmentAt(previous, slot);
        const fresh = segmentAt(next, slot);
        if (carried && fresh) {
            (next.payload as Record<string, unknown>)[slot] = { ...fresh, textId: carried.textId, role: carried.role };
        }
    }
    return next;
}

function segmentAt(block: StoryBlock, slot: "text" | "prompt"): { textId: string; role: string } | null {
    const value = (block.payload as Record<string, unknown> | undefined)?.[slot];
    return value && typeof value === "object" && "textId" in value
        ? (value as { textId: string; role: string })
        : null;
}

function describeParseIssue(issue: { code: string } & Record<string, unknown>, source: string): string {
    switch (issue.code) {
        case "unknownCommand":
            return `No command "/${String(issue.token)}". Run "story commands" for the catalogue.`;
        case "unknownParam":
            return `"${String(issue.key)}=" is not a parameter of this command. Run "story command ${source.slice(1).split(/\s/)[0]}".`;
        case "duplicateParam":
            return `"${String(issue.key)}=" is written twice.`;
        case "extraPositional":
            return `"${String(issue.value)}" has no slot to fill.`;
        case "badValue":
            return `"${String(issue.value)}" is not a value this slot takes.`;
        case "unterminatedQuote":
            return "A quote is opened and never closed.";
        default:
            return issue.code;
    }
}

// ---------------------------------------------------------------------------
// Anchors and structure
// ---------------------------------------------------------------------------

function anchorTable(scene: StoryScene | null): Map<string, StoryBlock> {
    const table = new Map<string, StoryBlock>();
    for (const block of Object.values(scene?.blocks ?? {})) {
        table.set(block.id, block);
    }
    return table;
}

/**
 * The row an anchor names, or null.
 *
 * An anchor is a PREFIX of a block id, because a whole one is thirty-six characters on every line of
 * a file an agent has to read and edit. A prefix that names two rows is refused rather than resolved
 * to the first - the printer lengthens an anchor until it is unique, so a colliding one in a file
 * means the file was edited into that state.
 */
function resolveAnchor(
    line: StoryFileLine,
    table: Map<string, StoryBlock>,
    ast: StoryFileAst,
    diagnostics: StoryFileDiagnostic[],
): StoryBlock | null {
    if (!line.anchorId) {
        return null;
    }
    const exact = table.get(line.anchorId);
    if (exact) {
        return exact;
    }
    const matches = [...table.values()].filter(block => block.id.startsWith(line.anchorId as string));
    if (matches.length > 1) {
        diagnostics.push(
            errorAt(
                "compile.ambiguous_anchor",
                `The anchor "${line.anchorId}" names ${matches.length} rows. Lengthen it, or run "story show" again.`,
                line.lineNumber,
            ),
        );
        return null;
    }
    if (matches.length === 1) {
        return matches[0];
    }
    // Not in the scene: an opaque row carries its own payload in `#data`, and every other shape is
    // simply a new row whose anchor no longer names anything. Neither is worth an error - a scene
    // edited in Studio between `show` and `apply` is the ordinary way to get here.
    return ast.data[line.anchorId] ?? null;
}

function parentFor(
    line: StoryFileLine,
    openAt: (StoryBlock | null)[],
    diagnostics: StoryFileDiagnostic[],
): StoryBlock | null {
    if (line.depth === 0) {
        return null;
    }
    const parent = openAt[line.depth - 1];
    if (parent) {
        return parent;
    }
    diagnostics.push(
        errorAt(
            "compile.bad_indent",
            "This line is indented under a row that takes no children. Two spaces per level, and only a "
                + "condition, a branch, a loop, a group, a menu or an option holds rows.",
            line.lineNumber,
        ),
    );
    return null;
}

/**
 * The three placements the tree itself decides, which no single line can check.
 *
 * A branch outside a condition, an option outside a menu, and a condition with no branch: each is a
 * shape the editor can only produce deliberately, and each compiles to something that does not run.
 */
function checkStructure(
    blocks: Record<StoryBlockId, StoryBlock>,
    ast: StoryFileAst,
): StoryFileDiagnostic[] {
    const diagnostics: StoryFileDiagnostic[] = [];
    const lineOf = new Map<StoryBlockId, number>();
    for (const line of ast.lines) {
        if (line.anchorId) {
            const block = Object.values(blocks).find(candidate => candidate.id.startsWith(line.anchorId as string));
            if (block) {
                lineOf.set(block.id, line.lineNumber);
            }
        }
    }

    for (const block of Object.values(blocks)) {
        const parent = block.parentId ? blocks[block.parentId] : null;
        const line = lineOf.get(block.id);
        if (block.kind === "control" && block.payload.control === "conditionBranch") {
            if (!parent || parent.kind !== "control" || parent.payload.control !== "condition") {
                diagnostics.push(
                    errorAt("compile.branch_outside_condition", "A \"?\" branch only sits under an /if row.", line),
                );
            }
            continue;
        }
        if (block.kind === "nodeAction" && block.payload.action === "choiceOption") {
            if (!parent || parent.kind !== "nodeAction" || parent.payload.action !== "choice") {
                diagnostics.push(
                    errorAt("compile.option_outside_menu", "A \"-\" option only sits under a /menu row.", line),
                );
            }
            continue;
        }
        if (block.kind === "control" && block.payload.control === "condition" && block.childrenIds.length === 0) {
            diagnostics.push(
                errorAt("compile.condition_without_branch", "An /if row with no \"?\" branch under it runs nothing.", line),
            );
        }
    }
    return diagnostics;
}
