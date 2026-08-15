/**
 * The canonical NarraLang printer: a story scene as a script.
 *
 * Design doc: `docs/plans/2026-08-15-001-plan-narralang.md`.
 *
 * ## Three files, one pass
 *
 * A line is produced in two halves that never mix. {@link ./narralangExtract} turns a block into a
 * {@link NarralangShape} - the verb and its typed slot values, with no word of the language in it -
 * and reports every row it cannot shape. {@link ./narralangRender} spells a shape through a
 * {@link NarralangDialect}. This file is the walk between them: indentation, disabled prefixes, and
 * the two ways a row can print nothing.
 *
 * That split is what makes the language pluggable. A project renaming a verb, moving a modifier onto
 * a different preposition, or fencing rich text with `[i]` edits a table; nothing here and nothing in
 * the extractor changes.
 *
 * ## Printing and coverage are still one pass, on purpose
 *
 * "Which rows can NarraLang say?" and "what does NarraLang say for this row?" are the same question,
 * and answering them in two places is how they drift - the analyser keeps claiming a scene is
 * expressible after the printer has grown a case it cannot spell, or refuses one the printer handles
 * fine. So the issues come out of the extraction the walk already does, and a scene is expressible
 * exactly when it produced none. {@link narralangSceneExpressible} is a thin wrapper that throws the
 * text away, not a second implementation.
 *
 * The stake is real: a scene reported as expressible is one the text view will open for editing.
 *
 * ## No locale, ever
 *
 * Nothing in this module may call `translate` or read the localised command tables
 * (`localizedParams` / `localizedEnums` / `localizedUnits`). `projectStoryCommandLine` is the
 * display-side twin of this printer and does all three, which is why this is a separate printer and
 * not a flag on that one.
 */

import type { StoryBlockId, StoryDocument, StoryScene } from "@shared/types/story";
import { listSceneIdsInDocumentOrder } from "@shared/types/story";
import { storyMsToSeconds } from "@shared/utils/storyTime";

import { NARRALANG_DEFAULT_DIALECT, type NarralangDialect } from "./narralangDialect";
import {
    narralangShapeOf,
    type NarralangExtractContext,
    type NarralangIssue,
    type NarralangIssueReason,
    type NarralangLookups,
} from "./narralangExtract";
import { narralangName } from "./narralangSyntax";
import { renderNarralangShape } from "./narralangRender";

export type { NarralangIssue, NarralangIssueDetail, NarralangIssueReason, NarralangLookups } from "./narralangExtract";

export type NarralangSceneResult = {
    /** The script. Always produced, even for a scene with issues - export is one-way and best effort. */
    text: string;
    /**
     * Empty exactly when every row in the scene has a spelling. The text view opens read-only unless
     * this is empty; see the design doc's "the gate".
     */
    issues: NarralangIssue[];
};

// --- Walk ---------------------------------------------------------------------------------------

type Ctx = NarralangExtractContext & {
    dialect: NarralangDialect;
    lines: string[];
};

function emit(ctx: Ctx, depth: number, line: string): void {
    ctx.lines.push(line === "" ? "" : `${ctx.dialect.indent.repeat(depth)}${line}`);
}

function walk(ctx: Ctx, blockIds: readonly StoryBlockId[], depth: number): void {
    for (const blockId of blockIds) {
        const block = ctx.scene.blocks[blockId];
        if (!block) {
            continue;
        }
        const shape = narralangShapeOf(ctx, block);

        // A transparent row keeps its children at the current level - that is what makes `if` /
        // `elif` / `else` siblings in the text while they are children in the document. A silent one
        // printed nothing because it HAS no spelling, and its children keep the level they had.
        if (shape.form === "transparent") {
            walk(ctx, block.childrenIds, depth);
            continue;
        }

        const line = renderNarralangShape(shape, ctx.dialect);
        if (line !== null && line !== "") {
            emit(ctx, depth, block.disabled ? `${ctx.dialect.prefix.disabled} ${line}` : line);
        }
        if (block.childrenIds.length > 0) {
            walk(ctx, block.childrenIds, depth + 1);
        }
        // A dialect that opens a block with a brace has to close it. One that nests by indentation
        // alone says `null` and nothing is emitted.
        const close = ctx.dialect.block.close;
        if (close !== null && shape.form === "statement" && shape.opensBlock) {
            emit(ctx, depth, close);
        }
    }
}

// --- Entry points -------------------------------------------------------------------------------

/**
 * One scene as a script in a given dialect, plus every row in it that has no spelling.
 *
 * The dialect-taking form is the real entry point; the two-argument {@link printNarralangScene} is
 * this one bound to the default. Kept as a separate export rather than an optional third parameter so
 * the published signature every caller already writes against does not move.
 */
export function printNarralangSceneWithDialect(
    scene: StoryScene,
    lookups: NarralangLookups,
    dialect: NarralangDialect,
): NarralangSceneResult {
    const issues: NarralangIssue[] = [];
    const ctx: Ctx = {
        scene,
        lookups: { ...lookups, scene },
        dialect,
        lines: [],
        report: (blockId, reason, detail) => {
            issues.push(detail === undefined ? { blockId, reason } : { blockId, reason, detail });
        },
    };
    ctx.lines.push(`${dialect.sceneKeyword} ${narralangName(scene.name, dialect)}${dialect.block.open}`);
    ctx.lines.push("");
    walk(ctx, scene.rootBlockIds, 1);
    if (dialect.block.close !== null) {
        ctx.lines.push(dialect.block.close);
    }
    return { text: `${ctx.lines.join("\n").replace(/\n+$/, "")}\n`, issues };
}

/** One scene as a script, plus every row in it that has no spelling. */
export function printNarralangScene(scene: StoryScene, lookups: NarralangLookups): NarralangSceneResult {
    return printNarralangSceneWithDialect(scene, lookups, NARRALANG_DEFAULT_DIALECT);
}

/**
 * Whether the text view may open this scene for editing.
 *
 * Deliberately runs the printer rather than re-deciding: see the file header. The scene-level verdict
 * (not a per-row one) is the author's ruling - a partially editable buffer breaks the feel of a text
 * editor and is a way to lose work.
 */
export function narralangSceneExpressible(scene: StoryScene, lookups: NarralangLookups): boolean {
    return printNarralangScene(scene, lookups).issues.length === 0;
}

/** Every scene in the document, in authoring order, separated by a blank line. */
export function printNarralangStory(document: StoryDocument, lookups: NarralangLookups): NarralangSceneResult {
    return printNarralangStoryWithDialect(document, lookups, NARRALANG_DEFAULT_DIALECT);
}

/** {@link printNarralangStory}, in a given dialect. */
export function printNarralangStoryWithDialect(
    document: StoryDocument,
    lookups: NarralangLookups,
    dialect: NarralangDialect,
): NarralangSceneResult {
    const sceneIds = listSceneIdsInDocumentOrder(document);
    const texts: string[] = [];
    const issues: NarralangIssue[] = [];
    for (const sceneId of sceneIds) {
        const result = printNarralangSceneWithDialect(
            document.scenes[sceneId],
            { ...lookups, scenes: document.scenes, document },
            dialect,
        );
        texts.push(result.text);
        issues.push(...result.issues);
    }
    return { text: texts.join("\n"), issues };
}

/** Seconds, for callers that need the same rounding the printer uses (tests, the export report). */
export const narralangSecondsOf = storyMsToSeconds;
