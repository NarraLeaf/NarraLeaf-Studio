/**
 * The bodies of the `story` commands, as functions of documents.
 *
 * `cli.ts` reads the project off disk and writes what comes back; Studio's agent bridge passes the
 * live story document and a `ProjectData` built from its services (`buildStoryProjectContext`) and
 * hands the same text to an agent.
 *
 * ## The command vocabulary
 *
 * Printed rows use whatever command vocabulary `commandI18nStore` resolves to. The command line pins
 * it to the canonical English tokens before anything runs (see `cli.ts`); a caller inside Studio
 * inherits the author's setting unless it pins it too. Reading is unaffected either way - a
 * translated spelling still parses.
 *
 * Flag validation stays with the command line; a body takes values that are already in range.
 *
 * Comments in English per project convention.
 */

import type { StoryDocument, StoryScene } from "@shared/types/story";
import { describeStoryBlock } from "@/lib/story/storyRowProjection";
import { commandWriter, type CommandResult } from "../agent-core/commandResult";
import { applySceneToDocument, findingsIntroduced, formatApplySummary, formatCarriedFindings, summariseApply, type ApplySummary } from "./apply";
import {
    COMMAND_CATEGORIES,
    describeCommand,
    formatCategories,
    formatCommandDetail,
    formatCommandList,
    nearestCommands,
    queryCommands,
} from "./catalog";
import {
    checkStorySource,
    checkStoredStories,
    formatDiagnostics,
    hasErrors,
    lintStoredStories,
    type CheckResult,
    type StoredStories,
    type StoryLintStory,
} from "./check";
import { printStoryScene } from "./dsl/print";
import { describeSceneSettings } from "./dsl/sceneSettings";
import { LINE_SHAPES_HELP } from "./dsl/shapes";
import { buildLookups } from "./lookups";
import { buildContext, findScene, orderedScenes, type ProjectData, type StorySummary } from "./model";
import { formatTargets } from "./targets";

/** How many commands a bare `commands` prints before it says only how many more there are. */
export const DEFAULT_COMMAND_LIMIT = 60;

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

/** `story commands [search]`. `category` is one of `COMMAND_CATEGORIES`. */
export function storyCommandsCommand(
    options: { search?: string; category?: string; limit?: number; json?: boolean } = {},
): CommandResult {
    const io = commandWriter();
    const commands = queryCommands({ search: options.search || undefined, category: options.category });
    if (options.json === true) {
        io.out(JSON.stringify(commands, null, 2));
        return io.finish(0);
    }
    io.out(formatCommandList(commands, options.limit ?? DEFAULT_COMMAND_LIMIT));
    return io.finish(0);
}

/** `story command <token>`. Leaves with 2, naming close spellings, for a token nothing declares. */
export function storyCommandCommand(query: string, options: { json?: boolean } = {}): CommandResult {
    const io = commandWriter();
    const detail = describeCommand(query);
    if (!detail) {
        io.err(`No story command "${query}".`);
        const near = nearestCommands(query);
        io.err(near.length > 0 ? `Close by: ${near.map(token => `/${token}`).join(", ")}` : "Run `story commands` for the catalogue.");
        return io.finish(2);
    }
    io.out(options.json === true ? JSON.stringify(detail, null, 2) : formatCommandDetail(detail));
    return io.finish(0);
}

/** `story categories`. */
export function storyCategoriesCommand(options: { json?: boolean } = {}): CommandResult {
    const io = commandWriter();
    io.out(options.json === true ? JSON.stringify(COMMAND_CATEGORIES, null, 2) : formatCategories());
    return io.finish(0);
}

/** `story lines`: the line shapes a `.story` file uses besides commands. */
export function storyLinesCommand(options: { json?: boolean } = {}): CommandResult {
    const io = commandWriter();
    io.out(options.json === true ? JSON.stringify({ help: LINE_SHAPES_HELP }, null, 2) : LINE_SHAPES_HELP);
    return io.finish(0);
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

/**
 * `story stories [search]`. `documentOf` is asked only for the stories the search keeps, for their
 * scene counts; it may throw, which ends the command.
 */
export function storyStoriesCommand(
    stories: readonly StorySummary[],
    documentOf: (storyId: string) => StoryDocument,
    options: { search?: string; json?: boolean } = {},
): CommandResult {
    const io = commandWriter();
    if (options.json === true) {
        io.out(JSON.stringify(stories, null, 2));
        return io.finish(0);
    }
    if (stories.length === 0) {
        io.out("This project holds no stories.");
        return io.finish(0);
    }
    const search = (options.search ?? "").toLowerCase();
    const width = Math.max(...stories.map(story => story.name.length)) + 2;
    for (const story of stories) {
        if (search && !story.name.toLowerCase().includes(search)) {
            continue;
        }
        const scenes = orderedScenes(documentOf(story.id)).length;
        const dlc = story.dlcId ? "  (ships with a DLC)" : "";
        io.out(`  ${story.name.padEnd(width)}${scenes} scene${scenes === 1 ? "" : "s"}${dlc}`);
    }
    return io.finish(0);
}

/** `story scenes [search]`: one story's scenes in chapter order, with row counts and the entry scene. */
export function storyScenesCommand(document: StoryDocument, options: { search?: string; json?: boolean } = {}): CommandResult {
    const io = commandWriter();
    const scenes = orderedScenes(document);
    if (options.json === true) {
        io.out(JSON.stringify(scenes.map(scene => ({ id: scene.id, name: scene.name, rows: Object.keys(scene.blocks ?? {}).length })), null, 2));
        return io.finish(0);
    }
    const search = (options.search ?? "").toLowerCase();
    const width = Math.max(...scenes.map(scene => scene.name.length), 4) + 2;
    for (const scene of scenes) {
        if (search && !scene.name.toLowerCase().includes(search)) {
            continue;
        }
        const rows = Object.keys(scene.blocks ?? {}).length;
        const entry = document.entrySceneId === scene.id ? "  entry scene" : "";
        io.out(`  ${scene.name.padEnd(width)}${String(rows).padStart(5)} row${rows === 1 ? " " : "s"}${entry}`);
    }
    return io.finish(0);
}

/** `story targets [search]`: every name a line can resolve in this story, by slot. */
export function storyTargetsCommand(
    data: ProjectData,
    document: StoryDocument,
    options: { search?: string; json?: boolean } = {},
): CommandResult {
    const io = commandWriter();
    const context = buildContext(data, document, null);
    const sceneSettings = orderedScenes(document).map(scene => ({ scene: scene.name, ...describeSceneSettings(scene, context) }));
    io.out(options.json === true ? JSON.stringify(context, null, 2) : formatTargets(context, options.search ?? "", sceneSettings));
    return io.finish(0);
}

export type StoryShowResult = CommandResult & {
    /** The scene printed; null when none matched. */
    scene: StoryScene | null;
    /** The `.story` text (what `out` holds). Absent when no scene matched. */
    text?: string;
    stats?: { rows: number; opaque: number };
    /** Rows the format cannot spell, kept verbatim as `»` lines. */
    opaqueRows?: { anchor: string; label: string }[];
};

/**
 * `story show`: one scene in the `.story` text format - the one `scene` names (id, whole name or part
 * of one), or the story's first scene when none is named.
 */
export function storyShowCommand(
    data: ProjectData,
    story: { name: string; document: StoryDocument },
    options: { scene?: string } = {},
): StoryShowResult {
    const io = commandWriter();
    const document = story.document;
    const query = options.scene;
    const scene = query ? findScene(document, query) : orderedScenes(document)[0] ?? null;
    if (!scene) {
        io.err(query ? `No scene matches "${query}". Run "story scenes" for the list.` : "This story has no scenes.");
        return { ...io.finish(2), scene: null };
    }
    const context = buildContext(data, document, scene);
    const lookups = buildLookups(data, document, scene, context);
    const printed = printStoryScene({
        scene,
        storyName: story.name,
        context,
        rowLookups: lookups.rowLookups,
        prose: lookups.prose,
        conditions: lookups.conditions,
    });
    io.out(printed.text);
    return { ...io.finish(0), scene, text: printed.text, stats: printed.stats, opaqueRows: printed.opaqueRows };
}

/** The lines `show --out` adds about rows the format keeps verbatim. Empty when there are none. */
export function formatOpaqueRowNotice(printed: { stats: { opaque: number }; opaqueRows: { anchor: string; label: string }[] }): string[] {
    const lines: string[] = [];
    if (printed.stats.opaque > 0) {
        lines.push(
            `${printed.stats.opaque} of them have no spelling in this format and are kept verbatim. Editing a » line `
                + "changes nothing; change those rows in Studio.",
        );
        for (const row of printed.opaqueRows.slice(0, 10)) {
            lines.push(`  ${row.anchor}  ${row.label}`);
        }
        if (printed.opaqueRows.length > 10) {
            lines.push(`  ... and ${printed.opaqueRows.length - 10} more`);
        }
    }
    return lines;
}

export type StoryCheckResult = CommandResult & { check: CheckResult };

/** `story check` with no file: the document layer over every stored story. */
export async function storyCheckProjectCommand(stored: StoredStories): Promise<StoryCheckResult> {
    const io = commandWriter();
    const check = await checkStoredStories(stored);
    io.out(formatDiagnostics(check.diagnostics, { notRun: check.notRun }));
    return { ...io.finish(hasErrors(check.diagnostics) ? 1 : 0), check };
}

/**
 * `story check <file.story>`: the file layer, then the document layer with the file's scene
 * substituted into `story`. `scene` overrides the file's `#scene` directive.
 */
export async function storyCheckSourceCommand(
    source: string,
    input: { data: ProjectData; story: StoryLintStory; scene?: StoryScene | null },
    options: { fileName?: string } = {},
): Promise<StoryCheckResult> {
    const io = commandWriter();
    const check = await checkStorySource(source, { data: input.data, story: input.story, scene: input.scene ?? null });
    io.out(formatDiagnostics(check.diagnostics, { fileName: options.fileName, notRun: check.notRun }));
    return { ...io.finish(hasErrors(check.diagnostics) ? 1 : 0), check };
}

export type StoryApplyInput = {
    data: ProjectData;
    /** The story the file belongs to, as stored now. */
    story: StoryLintStory;
    /**
     * The whole project as stored, for the baseline the document layer is judged against. Asked for
     * only when the edited project has findings at all.
     */
    stored: () => StoredStories;
    /** The schema version the story is stored at, when it was migrated on read; said out loud if it differs. */
    storedSchemaVersion?: number | null;
};

export type StoryApplyOptions = {
    fileName?: string;
    /** Whether the caller will keep the change; only changes the wording. */
    write?: boolean;
    /** Said after the summary when `write` - the command line's "close the project" note. */
    writtenNote?: string;
    /**
     * Keep the new document, when `write`. Called after everything is judged and before the summary
     * is printed; a message refuses (said on stderr, leaving with 2). The command line writes the
     * file here, so a refused write never prints "Written.".
     */
    commit?: (document: StoryDocument) => string | null;
};

export type StoryApplyResult = CommandResult & {
    check: CheckResult;
    /** The story document with the scene replaced; absent when nothing may be written. */
    document?: StoryDocument;
    /** The scene as it goes in (keeping its stored name). */
    scene?: StoryScene;
    summary?: ApplySummary;
};

/**
 * `story apply <file.story>`: check the file, judge the document layer against the project as it
 * stands (only findings this file introduces stop it), and return the story document with the scene
 * replaced. Returns a NEW document; nothing is mutated. A scene rename in the file is reported and
 * not applied.
 */
export async function storyApplyCommand(
    source: string,
    input: StoryApplyInput,
    options: StoryApplyOptions = {},
): Promise<StoryApplyResult> {
    const io = commandWriter();
    const check = await checkStorySource(source, { data: input.data, story: input.story, scene: null });

    // The document layer is judged against the project as it stands, so a finding that was already
    // there is not this write's problem. Skipped when the edited project has no findings at all:
    // nothing can have been introduced, and the baseline run reads every story in the project.
    const baseline = check.projectFindings.length > 0 ? await lintStoredStories(input.stored()) : [];
    const findings = findingsIntroduced(baseline, check.projectFindings);
    const reported = [...check.fileDiagnostics, ...findings.introduced];
    io.out(formatDiagnostics(reported, { fileName: options.fileName, notRun: check.notRun }));
    if (findings.carried > 0) {
        io.out("");
        io.out(formatCarriedFindings(findings.carried));
    }
    if (!check.scene || hasErrors(reported)) {
        io.err("Nothing written.");
        return { ...io.finish(1), check };
    }

    const document = input.story.document;
    const existing = document.scenes?.[check.scene.id];
    if (!existing) {
        io.err(`This story no longer holds scene ${check.scene.id}.`);
        return { ...io.finish(2), check };
    }
    const data = input.data;
    const existingContext = buildContext(data, document, existing);
    const lookups = buildLookups(data, document, existing, existingContext);
    const summary = summariseApply(
        existing,
        check.scene,
        blockId => describeStoryBlock(existing.blocks[blockId], { ...lookups.rowLookups, scene: existing }),
        {
            before: describeSceneSettings(existing, existingContext),
            after: describeSceneSettings(check.scene, existingContext),
            stated: check.settingsStated ?? { background: false, music: false },
        },
    );

    // A document read at an older schema was migrated on the way in, and writing it back is what
    // makes that migration permanent. Said out loud rather than done quietly: it changes rows this
    // file never mentioned, which is not what "apply one scene" sounds like.
    const storedVersion = input.storedSchemaVersion ?? null;
    if (storedVersion !== null && storedVersion !== document.schemaVersion) {
        io.out(
            `This story is stored at schema ${storedVersion} and will be written at `
                + `${document.schemaVersion}. The migration runs over the whole document, not just `
                + "this scene.",
        );
    }
    // The rename is reported and not applied, so the scene keeps the name the document gave it.
    const scene = { ...check.scene, name: existing.name };
    const next = applySceneToDocument(document, scene);
    if (options.write === true && options.commit) {
        const refusal = options.commit(next);
        if (refusal !== null) {
            io.err(refusal);
            return { ...io.finish(2), check };
        }
    }
    io.out("");
    io.out(formatApplySummary(summary, options.write === true));
    if (options.write === true && options.writtenNote) {
        io.out(options.writtenNote);
    }
    return { ...io.finish(0), check, document: next, scene, summary };
}
