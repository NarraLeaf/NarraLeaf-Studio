/**
 * A scene as text - and the check that decides which rows may become text at all.
 *
 * ## The echo check
 *
 * Every line this printer writes is read straight back through `buildLineBlock` and the result is
 * compared with the row it came from. A line whose row does not come back identically is NOT
 * written: the row becomes an opaque `»` line, and its payload goes verbatim into the `#data`
 * footer.
 *
 * That one rule is what makes the format safe to hand an agent. Without it, a printer that spelled a
 * row incompletely would hand back a file whose lines look editable and silently drop whatever the
 * spelling missed - change the duration on a line and lose the Story Motion the rest of it stood
 * for. With it, coverage is a property of the file's construction rather than a claim about the
 * printer: what is written as a line can be edited as a line, and what could not be is preserved
 * whole and marked as such.
 *
 * It costs one build per row, which is nothing next to reading the project.
 *
 * ## The command half is not written here
 *
 * `projectStoryCommandLine` already turns a committed row into the line an author would have typed -
 * it is what the row list prints under every row - so the printer asks it rather than growing a
 * second inverse for forty commands. What it cannot spell, the echo check catches.
 *
 * Comments in English per project convention.
 */

import type { StoryBlock, StoryBlockId, StoryScene } from "@shared/types/story";
import { describeStoryBlock } from "@/lib/story/storyRowProjection";
import {
    projectStoryCommandLine,
    type StoryCommandLineLookups,
} from "@/apps/workspace/modules/story/scene-editor/storyCommandLine";
import type { StoryCommandContext } from "@/apps/workspace/modules/story/scene-editor/storyCommandValues";
import { buildLineBlock } from "./compile";
import { conditionSource, type ConditionLookups } from "./condition";
import { sameRowContent } from "./equal";
import { proseLineOf, type ProseLookups } from "./prose";
import {
    ANCHOR_CLOSE,
    ANCHOR_OPEN,
    BRANCH_ELSE,
    BRANCH_PREFIX,
    DIRECTIVE_DATA,
    DIRECTIVE_FORMAT,
    DIRECTIVE_SCENE,
    DIRECTIVE_STORY,
    EMPTY_ROW,
    escapeText,
    FLAG_DISABLED,
    INDENT_UNIT,
    NOTE_PREFIX,
    OPAQUE_PREFIX,
    OPTION_PREFIX,
    STORY_FILE_FORMAT_VERSION,
    type StoryLineShape,
} from "./shapes";

export type PrintInput = {
    scene: StoryScene;
    storyName: string;
    context: StoryCommandContext;
    rowLookups: StoryCommandLineLookups;
    prose: ProseLookups;
    conditions: ConditionLookups;
};

export type PrintResult = {
    text: string;
    /** How many rows were written as lines, and how many had to be preserved instead. */
    stats: { rows: number; opaque: number };
    /** Which rows are opaque, so `show` can say what the file will not let an agent edit. */
    opaqueRows: { anchor: string; label: string }[];
};

/** The shortest anchor that names one row, per row - see the note on `resolveAnchor`. */
function anchorLengths(scene: StoryScene): Map<StoryBlockId, string> {
    const ids = Object.keys(scene.blocks ?? {});
    const anchors = new Map<StoryBlockId, string>();
    for (const id of ids) {
        let length = 8;
        while (length < id.length && ids.filter(other => other.startsWith(id.slice(0, length))).length > 1) {
            length += 4;
        }
        anchors.set(id, id.slice(0, Math.min(length, id.length)));
    }
    return anchors;
}

export function printStoryScene(input: PrintInput): PrintResult {
    const { scene } = input;
    const anchors = anchorLengths(scene);
    const data: Record<string, StoryBlock> = {};
    const opaqueRows: { anchor: string; label: string }[] = [];
    const body: string[] = [];
    let rows = 0;

    const walk = (blockIds: readonly StoryBlockId[], depth: number): void => {
        for (const blockId of blockIds) {
            const block = scene.blocks[blockId];
            if (!block) {
                continue;
            }
            rows += 1;
            const anchor = anchors.get(block.id) ?? block.id;
            const line = spellRow(block, input);
            if (line) {
                body.push(`${INDENT_UNIT.repeat(depth)}${markerFor(line.shape)}${line.text}${anchorSuffix(anchor, block)}`);
            } else {
                data[anchor] = block;
                const label = escapeText(describeStoryBlock(block, { ...input.rowLookups, scene }), { asProse: false });
                opaqueRows.push({ anchor, label });
                body.push(`${INDENT_UNIT.repeat(depth)}${OPAQUE_PREFIX}${label}${anchorSuffix(anchor, block)}`);
            }
            walk(block.childrenIds ?? [], depth + 1);
        }
    };
    walk(scene.rootBlockIds ?? [], 0);

    const header = [
        `${DIRECTIVE_FORMAT} ${STORY_FILE_FORMAT_VERSION}`,
        `${DIRECTIVE_STORY} ${input.storyName}`,
        `${DIRECTIVE_SCENE} ${scene.name} ${ANCHOR_OPEN}${scene.id}${ANCHOR_CLOSE}`,
    ];
    const footer = Object.keys(data).length > 0
        // One row per line rather than one blob: a diff of two exports should point at the row that
        // changed, not at a line four thousand characters wide.
        ? [
            "",
            DIRECTIVE_DATA,
            "{",
            ...Object.entries(data).map(
                ([anchor, block], index, all) =>
                    `${JSON.stringify(anchor)}: ${JSON.stringify(block)}${index === all.length - 1 ? "" : ","}`,
            ),
            "}",
        ]
        : [];

    return {
        text: [...header, "", ...body, ...footer, ""].join("\n"),
        stats: { rows, opaque: Object.keys(data).length },
        opaqueRows,
    };
}

function anchorSuffix(anchor: string, block: StoryBlock): string {
    const flags = block.disabled ? ` ${FLAG_DISABLED}` : "";
    return `  ${ANCHOR_OPEN}${anchor}${flags}${ANCHOR_CLOSE}`;
}

function markerFor(shape: StoryLineShape): string {
    switch (shape) {
        case "note":
            return NOTE_PREFIX;
        case "option":
            return OPTION_PREFIX;
        case "branch":
            return BRANCH_PREFIX;
        default:
            return "";
    }
}

// ---------------------------------------------------------------------------
// One row
// ---------------------------------------------------------------------------

type SpelledLine = { shape: StoryLineShape; text: string };

/**
 * The line a row reads as, or null when it has none that survives the echo check.
 *
 * Three sources, one gate. Which source answered is not interesting; whether the answer reads back
 * as this very row is the whole question.
 */
function spellRow(block: StoryBlock, input: PrintInput): SpelledLine | null {
    const candidate = candidateLine(block, input);
    if (!candidate) {
        return null;
    }
    if (candidate.shape === "empty") {
        // Nothing to check: the row holds nothing, so a line that holds nothing is exact.
        return { shape: "empty", text: EMPTY_ROW };
    }
    const echoed = buildLineBlock(
        {
            lineNumber: 0,
            depth: 0,
            shape: candidate.shape,
            text: candidate.text,
            anchorId: block.id,
            disabled: block.disabled === true,
        },
        {
            previous: block,
            context: input.context,
            prose: input.prose,
            conditions: input.conditions,
            data: {},
            // Nothing should reach for one - every field a fresh id would fill is carried from
            // `previous` - and a line that does is a line that does not echo, which is the answer.
            mintId: () => "",
        },
    );
    if (!echoed.ok || !sameRowContent(echoed.block, block)) {
        return null;
    }
    return candidate;
}

function candidateLine(block: StoryBlock, input: PrintInput): SpelledLine | null {
    const prose = proseLineOf(block, input.prose);
    if (prose) {
        return prose;
    }
    if (block.kind === "control" && block.payload.control === "conditionBranch") {
        if (block.payload.branch === "else") {
            return { shape: "branch", text: BRANCH_ELSE };
        }
        const source = conditionSource(block.payload.condition, input.conditions);
        return source === null ? null : { shape: "branch", text: escapeText(source, { asProse: false }) };
    }
    // The two containers the row list draws as headers rather than as command lines, though both are
    // written by a command. `/if` holds no condition of its own - the branches below it do - so its
    // line is the bare verb.
    if (block.kind === "control" && block.payload.control === "condition") {
        return { shape: "command", text: "/if" };
    }
    if (block.kind === "nodeAction" && block.payload.action === "choice") {
        const prompt = block.payload.prompt?.value ?? "";
        return { shape: "command", text: prompt ? `/menu ${prompt}` : "/menu" };
    }
    const projected = projectStoryCommandLine(block, input.rowLookups);
    if (!projected) {
        return null;
    }
    return { shape: "command", text: projected.source };
}
