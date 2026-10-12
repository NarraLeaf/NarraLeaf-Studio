/**
 * `check` - two layers over one file, or over a whole project.
 *
 * **The file layer** is the compiler in `dsl/compile.ts`: does every line read as something, against
 * the catalogue that exists and the names this project has. It answers with the parser's own issue
 * codes, so a slot that refuses a value here refuses it in Studio for the same stated reason.
 *
 * **The document layer** is the project linter - the very rules Studio's lint panel runs, over a
 * context built from the directory (`lib/lint/projectContext.ts`). It answers the questions no
 * single line can: a jump to a scene that is gone, a label declared twice, an ending nothing
 * reaches, a stage object shown but never created.
 *
 * Only the categories that context can honestly serve are run, and the rest are NAMED rather than
 * quietly skipped - the same bargain `blueprint check` strikes when it has no `--project` to check
 * widget scope against. A check that silently answers less than it appears to is worse than one that
 * says what it did not look at.
 *
 * Pure: every function takes the project's documents (`ProjectData` and the story documents) rather
 * than a directory, so Studio's agent bridge runs the same two layers over the live project. The
 * command line reads the documents in `cli.ts` and hands them in.
 *
 * Comments in English per project convention.
 */

import { LINT_RULES, resolveLintMessageParams, runLintRules, storyUnreadableFinding, type LintReportEntry } from "@/lib/lint";
import { buildProjectLintContext, headlessLintCategories } from "@/lib/lint/projectContext";
import { createTranslator } from "@shared/i18n";
import type { StoryDocument, StoryScene } from "@shared/types/story";
import type { StoryFileDiagnostic } from "./dsl/ast";
import { compileStoryFile } from "./dsl/compile";
import { parseStoryFile } from "./dsl/parse";
import { buildLookups } from "./lookups";
import { buildContext, type ProjectData, type StorySummary } from "./model";

export type CheckResult = {
    /** Everything this run found, the file layer first. What `check` prints. */
    diagnostics: StoryFileDiagnostic[];
    /** The file layer alone: the parser's and the compiler's own answers about these lines. */
    fileDiagnostics: StoryFileDiagnostic[];
    /**
     * The document layer alone, each finding carrying the identity two runs are compared by.
     * `apply` needs the halves apart: the file layer is always this file's doing, and the document
     * layer is only partly - see {@link findingsIntroduced}.
     */
    projectFindings: KeyedLintFinding[];
    /** The scene the file compiles to, absent when it could not be compiled at all. */
    scene: StoryScene | null;
    /** Rule categories this run did not cover, so the caller can say so. */
    notRun: readonly string[];
    /** Which scene settings the file's header states (`#background`, `#music`); absent with no file. */
    settingsStated?: { background: boolean; music: boolean };
};

/**
 * One project-lint finding, plus a key that means "the same finding" across two runs of the linter.
 *
 * The key is the rule and the site, and nothing that a write elsewhere in the scene can move: not
 * the row number (inserting a row above shifts every number below it), not the names or the excerpt
 * a location carries for display, and not the message's own parameters (a project-wide rule counting
 * something would change its count and read as a different finding, including when the count went
 * down). What is left is stable enough that a finding present before a write and after it is
 * recognised as the same one, and strict enough that a second finding of one rule on one row is not
 * mistaken for it - two findings sharing a key are told apart by counting them.
 */
export type KeyedLintFinding = {
    key: string;
    diagnostic: StoryFileDiagnostic;
};

/** Whether anything at error severity was found - which is what decides the exit code. */
export function hasErrors(diagnostics: readonly StoryFileDiagnostic[]): boolean {
    return diagnostics.some(diagnostic => diagnostic.severity === "error");
}

/** One story as the document layer reads it: its library entry and its (migrated) document. */
export type StoryLintStory = StorySummary & { document: StoryDocument };

/**
 * One `.story` file against the project it is meant for.
 *
 * The lint layer runs over the project with this file's scene SUBSTITUTED IN, not over the project
 * as it stands: the whole question is whether the edit is sound, and a jump written in the file to a
 * scene that does not exist has to be found before the file is applied rather than after. It reads
 * only the story the file belongs to, which is `story`.
 *
 * `scene` is the scene to check against when the caller named one; otherwise the file's `#scene`
 * directive picks it out of `story.document`.
 */
export async function checkStorySource(
    source: string,
    input: { data: ProjectData; story: StoryLintStory; scene: StoryScene | null },
): Promise<CheckResult> {
    const parsed = parseStoryFile(source);
    const settingsStated = { background: Boolean(parsed.ast.settings.background), music: Boolean(parsed.ast.settings.music) };
    const { data, story } = input;
    const document = story.document;
    const existing = input.scene ?? (parsed.ast.sceneId ? document.scenes?.[parsed.ast.sceneId] ?? null : null);
    if (!existing) {
        const diagnostics: StoryFileDiagnostic[] = [
            ...parsed.diagnostics,
            {
                code: "file.unknown_scene",
                severity: "error",
                message: parsed.ast.sceneId
                    ? `This story has no scene ${parsed.ast.sceneId}. It may have been deleted, or the file may `
                        + "belong to another story."
                    : "The file's #scene directive carries no id, so there is nothing to check it against.",
            },
        ];
        return { diagnostics, fileDiagnostics: diagnostics, projectFindings: [], scene: null, notRun: [], settingsStated };
    }

    const lookups = buildLookups(data, document, existing, buildContext(data, document, existing));
    const compiled = compileStoryFile({
        ast: parsed.ast,
        existing,
        document,
        contextFor: scene => buildContext(data, document, scene ?? existing),
        prose: lookups.prose,
        conditions: lookups.conditions,
        mintId: mintStoryId,
    });

    const fileDiagnostics = [...parsed.diagnostics, ...compiled.diagnostics];
    if (!compiled.scene || hasErrors(fileDiagnostics)) {
        // The document layer reads a whole project, and running it over one built from a file that
        // did not compile would report the file's own breakage a second time in a less useful place.
        return {
            diagnostics: fileDiagnostics,
            fileDiagnostics,
            projectFindings: [],
            scene: compiled.scene,
            notRun: notRunCategories(),
            settingsStated,
        };
    }
    const withEdit: StoryDocument = {
        ...document,
        scenes: { ...document.scenes, [compiled.scene.id]: compiled.scene },
    };
    const projectFindings = await lintStories(data, [{ ...story, document: withEdit }]);
    return {
        diagnostics: [...fileDiagnostics, ...projectFindings.map(finding => finding.diagnostic)],
        fileDiagnostics,
        projectFindings,
        scene: compiled.scene,
        notRun: notRunCategories(),
        settingsStated,
    };
}

/**
 * Every story in the project, as the document layer sees it. Used by `check` with no file.
 *
 * A story that will not open becomes a diagnostic rather than aborting the run, and the same one
 * Studio's lint panel shows: `story/unreadable`, an id no rule owns. Abandoning the whole check at
 * the first refused document would report a project of nine stories as unreadable because one of
 * them is, and the eight that do open are the ones the author can still act on. Those findings lead
 * the list for the same reason they lead the report - "this story would not open at all" is the
 * first thing a reader needs.
 */
export async function checkStoredStories(project: StoredStories): Promise<CheckResult> {
    const findings = await lintStoredStories(project);
    return {
        diagnostics: findings.map(finding => finding.diagnostic),
        fileDiagnostics: [],
        projectFindings: findings,
        scene: null,
        notRun: notRunCategories(),
    };
}

/** The project as stored: its lists, every story that opened, and every one that did not. */
export type StoredStories = {
    data: ProjectData;
    /** Every readable story, in library order. */
    stories: readonly StoryLintStory[];
    /** Stories the library lists whose document would not open, with what refused them. */
    unreadable?: readonly { summary: StorySummary; error: unknown }[];
};

/**
 * The document layer over the stories exactly as they are stored.
 *
 * This is the baseline `apply` measures its own run against. A project carries findings that have
 * nothing to do with the file being written - a stage name in chapter three, a label declared twice
 * in a scene nobody is editing - and a write that refused while any of them stood would mean one bad
 * row anywhere makes the whole project unwritable.
 */
export async function lintStoredStories(project: StoredStories): Promise<KeyedLintFinding[]> {
    const unreadable = (project.unreadable ?? []).map(entry => toKeyedFinding(storyUnreadableFinding(entry.summary, entry.error)));
    return [...unreadable, ...(await lintStories(project.data, project.stories))];
}

function notRunCategories(): string[] {
    const covered = new Set(headlessLintCategories);
    return [...new Set(LINT_RULES.map(rule => rule.category))].filter(category => !covered.has(category)).sort();
}

/** The project linter over the given story documents. */
async function lintStories(data: ProjectData, stories: readonly StoryLintStory[]): Promise<KeyedLintFinding[]> {
    const context = buildProjectLintContext({
        stories: stories.map(story => ({
            id: story.id,
            name: story.name,
            document: story.document,
            ...(story.dlcId ? { dlcId: story.dlcId } : {}),
        })),
        blueprintDocument: data.blueprintDocument,
        uiDocument: null,
        characters: data.characters.map(character => ({
            id: character.profile.getId(),
            name: character.profile.getName(),
            assetIds: [],
        })),
        assets: Object.values(data.assets).flatMap(shard =>
            Object.values(shard as Record<string, { id: string; type: string; name: string; tags?: string[] }>).map(
                asset => ({
                    id: asset.id,
                    type: asset.type as never,
                    name: asset.name,
                    meta: {},
                    tags: asset.tags ?? [],
                }),
            ),
        ),
        appTags: data.appTags as never,
        variableRegistry: [...data.persistentVariables, ...data.savedVariables],
    });

    const report = await runLintRules(context, {
        rules: LINT_RULES.filter(rule => headlessLintCategories.includes(rule.category)),
    });
    return report.entries.map(toKeyedFinding);
}

function toKeyedFinding(entry: LintReportEntry): KeyedLintFinding {
    return { key: findingKey(entry), diagnostic: toDiagnostic(entry) };
}

/** See {@link KeyedLintFinding} for what is deliberately left out of this. */
function findingKey(entry: LintReportEntry): string {
    const location = entry.location;
    const site = location.kind === "story"
        ? [location.storyId, location.sceneId ?? "", location.blockId ?? ""]
        : location.kind === "asset"
            ? [location.assetId]
            : location.kind === "blueprint"
                ? [location.blueprintId, location.graphId ?? "", location.nodeId ?? ""]
                : location.kind === "surface"
                    ? [location.surfaceId, location.elementId ?? ""]
                    : location.kind === "character"
                        ? [location.characterId]
                        : [];
    return [entry.ruleId, entry.messageKey, location.kind, ...site].join("\u0000");
}

/**
 * The catalogue a finding is worded from: English, always.
 *
 * Not the interface language. Everything else this tool prints - the compiler's diagnostics, the
 * summary lines, the rule id under each finding - is English, and in Studio the reader is the
 * author's agent, which reads its tool descriptions in English too. Worded in the interface
 * language, one `story_apply` answer came back half in Chinese and half in English for an author
 * whose Studio is in Chinese. The rule id printed beside it is what finds the same finding in the
 * author's own lint panel.
 */
const english = createTranslator("en");

function toDiagnostic(entry: LintReportEntry): StoryFileDiagnostic {
    const where = entry.location.kind === "story"
        ? [entry.location.sceneName, entry.location.line ? `row ${entry.location.line}` : null]
            .filter(Boolean)
            .join(", ")
        : "";
    const message = english.t(entry.messageKey, resolveLintMessageParams(
        entry,
        key => english.t(key),
        (base, count, params) => english.tn(base, count, params),
    ));
    return {
        code: entry.ruleId,
        // A rule's configured severity, mapped onto the two this tool reports: `info` is advice and
        // must not fail a run, so it joins the warnings.
        severity: entry.severity === "error" ? "error" : "warning",
        message: where ? `${message}  (${where})` : message,
    };
}

/** A block id. UUID v4, because `assertValidStoryEntityId` refuses anything else on the next load. */
export function mintStoryId(): string {
    return globalThis.crypto.randomUUID();
}

export function formatDiagnostics(
    diagnostics: readonly StoryFileDiagnostic[],
    options: { fileName?: string; notRun?: readonly string[] } = {},
): string {
    const lines: string[] = [];
    for (const diagnostic of [...diagnostics].sort((a, b) => (a.line ?? 0) - (b.line ?? 0))) {
        const where = diagnostic.line ? `${options.fileName ?? "line"}:${diagnostic.line}` : options.fileName ?? "";
        lines.push(`${diagnostic.severity === "error" ? "error" : "warn "}  ${where ? `${where}  ` : ""}${diagnostic.message}`);
        lines.push(`       ${diagnostic.code}`);
    }
    if (lines.length === 0) {
        lines.push("Clean.");
    }
    if (options.notRun && options.notRun.length > 0) {
        lines.push(
            "",
            `Not checked here: ${options.notRun.join(", ")}. Those rules read asset bytes or the reference `
                + "index, which only a running Studio builds - so this says nothing about them either way.",
        );
    }
    return lines.join("\n");
}
