/**
 * Command surface for `project/app/story.js`.
 *
 * Kept apart from the Node wrapper that bundles it so the commands can be tested directly, and so
 * everything that touches the filesystem sits in one file rather than being spread through the
 * parser, the compiler and the catalogue.
 *
 * Every command declares its flags rather than reading whatever it recognises out of a bag, the same
 * way `blueprint` and `ui` do and for the same reason: a flag nobody declared is a typo, and a typo
 * that is silently ignored reports the wrong problem.
 *
 * ## The command vocabulary is pinned to the source locale
 *
 * The story editor accepts a translated command word (`/背景` reads as `/bg`) and a committed row
 * prints itself in whichever vocabulary the author chose. That is right on a surface a person reads
 * and wrong in a file: a `.story` file written on one machine has to say the same thing on every
 * other, and a test asserting on printed output cannot depend on a preference. So the first thing
 * this tool does is turn command localisation off, which makes every printed token the canonical
 * English one. Reading is unaffected - a translated spelling still parses, because the accept table
 * is built from the same pass.
 *
 * ## This tool owns story documents, and nothing else
 *
 * `editor/story/stories/<id>/storydoc.json` and the library index beside it. The interface and the
 * blueprints that a story row points at belong to `ui` and `blueprint`; those are read here, never
 * written. The seams are ids: a `/quit` names a page, a Story Action row names a blueprint.
 *
 * Comments in English per project convention.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { commandI18nStore } from "@/lib/i18n/commandLocale";
import { SCRATCH_DIR_NAME } from "../blueprint-cli/project";
import { didYouMean } from "../ui-cli/text";
import {
    COMMAND_CATEGORIES,
    describeCommand,
    formatCategories,
    formatCommandDetail,
    formatCommandList,
    nearestCommands,
    queryCommands,
} from "./catalog";
import { applyScene, findingsIntroduced, formatApplySummary, formatCarriedFindings, summariseApply } from "./apply";
import { checkProject, checkStoryFile, formatDiagnostics, hasErrors, lintStoredProject } from "./check";
import { printStoryScene } from "./dsl/print";
import { LINE_SHAPES_HELP } from "./dsl/shapes";
import { buildLookups } from "./lookups";
import {
    buildContext,
    findScene,
    findStory,
    listStories,
    orderedScenes,
    ProjectIoError,
    readProjectData,
    readStoryDocument,
    resolveProjectDir,
    resolveStoryFile,
    scratchFileNameFor,
    writeStoryDocument,
    type StorySummary,
} from "./project";
import { describeStoryBlock } from "@/lib/story/storyRowProjection";
import { formatTargets } from "./targets";

export type CliIo = {
    out: (text: string) => void;
    err: (text: string) => void;
};

/** How many commands a bare `commands` prints before it says only how many more there are. */
const DEFAULT_COMMAND_LIMIT = 60;

const USAGE = `story - query the command catalogue, read a project's scenes, write them as text.

  commands [search words]     List story commands. --category <name> --limit <n>
  command <token>             Everything about one command: params, types, what it builds.
  categories                  The command categories and how many each holds.
  lines                       The line shapes a .story file uses besides commands.

  stories [search]            Stories in a project. Needs --project.
  scenes [search]             Scenes in a story. Needs --project. --story <name|id>
  targets [search]            Characters, variables, assets, pages and the rest, as values a
                              line can name. Needs --project.
  show                        Print a scene in the text format. Needs --project.
                              --story <name|id> --scene <name|id> --out [file]
  check [file.story]          Check a text file, or the whole project when given no file.
                              --deep also compiles the scene. --rules to list what ran.
  apply <file.story>          Compile a text file into the project. Needs --project.
                              Writes nothing without --write.

Common flags
  --project <dir>             Project directory (the one holding editor/story/).
  --json                      Machine-readable output.

A file named without a directory - ch1.story rather than ./ch1.story - lives in ${SCRATCH_DIR_NAME}/ at the
root of this checkout, which git ignores. So the editing loop is three commands and one short name:

  show --project <dir> --scene "Classroom" --out ch1.story
  check ch1.story --project <dir>
  apply ch1.story --project <dir> --write

The .story format is for driving this tool. Studio offers authors no text-based way to write a
story, and nothing here appears in its interface; a green check says the scene is well-formed, never
that it plays right.

Exit codes: 0 clean, 1 problems found, 2 bad usage or unreadable input.`;

type FlagKind = "string" | "boolean";

type CommandSpec = {
    flags: Record<string, FlagKind>;
    run: (args: Args, io: CliIo) => number | Promise<number>;
};

type Args = {
    command: string;
    positional: string[];
    flags: Record<string, string | boolean>;
};

/** Bad usage, as opposed to a project that cannot be read. Both leave with 2. */
class UsageError extends Error {}

const COMMON_FLAGS: Record<string, FlagKind> = { json: "boolean", help: "boolean" };

const COMMANDS: Record<string, CommandSpec> = {
    commands: { flags: { category: "string", limit: "string" }, run: commandCommands },
    command: { flags: {}, run: commandCommand },
    categories: { flags: {}, run: commandCategories },
    lines: { flags: {}, run: commandLines },
    stories: { flags: { project: "string" }, run: commandStories },
    scenes: { flags: { project: "string", story: "string" }, run: commandScenes },
    targets: { flags: { project: "string", story: "string" }, run: commandTargets },
    show: {
        flags: { project: "string", story: "string", scene: "string", out: "string" },
        run: commandShow,
    },
    check: { flags: { project: "string", story: "string", scene: "string" }, run: commandCheck },
    apply: {
        flags: { project: "string", story: "string", write: "boolean" },
        run: commandApply,
    },
};

export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
    // Before anything reads a token or prints one. See the note at the top of this file.
    commandI18nStore.setPreference(false);
    const command = argv.find(token => !token.startsWith("--")) ?? "";
    const askedForHelp = command === "help" || argv.includes("--help") || argv.includes("-h");
    if (askedForHelp || !command) {
        io.out(USAGE);
        // Asking is answered; being given nothing at all is not.
        return askedForHelp ? 0 : 2;
    }
    const spec = COMMANDS[command];
    if (!spec) {
        io.err(`Unknown command "${command}". ${didYouMean(command, Object.keys(COMMANDS))}`.trim());
        io.out(USAGE);
        return 2;
    }
    try {
        const args = parseArgs(argv, booleanFlagsOf(spec));
        validateFlags(args, spec);
        return await spec.run(args, io);
    } catch (error) {
        if (error instanceof ProjectIoError || error instanceof UsageError) {
            io.err(error.message);
            return 2;
        }
        throw error;
    }
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

function commandCommands(args: Args, io: CliIo): number {
    const commands = queryCommands({
        search: args.positional.join(" ") || undefined,
        category: enumFlag(args, "category", COMMAND_CATEGORIES),
    });
    if (args.flags.json === true) {
        io.out(JSON.stringify(commands, null, 2));
        return 0;
    }
    io.out(formatCommandList(commands, numberFlag(args, "limit") ?? DEFAULT_COMMAND_LIMIT));
    return 0;
}

function commandCommand(args: Args, io: CliIo): number {
    const query = args.positional.join(" ");
    if (!query) {
        throw new UsageError("Which command? `story command <token>`.");
    }
    const detail = describeCommand(query);
    if (!detail) {
        io.err(`No story command "${query}".`);
        const near = nearestCommands(query);
        io.err(near.length > 0 ? `Close by: ${near.map(token => `/${token}`).join(", ")}` : "Run `story commands` for the catalogue.");
        return 2;
    }
    io.out(args.flags.json === true ? JSON.stringify(detail, null, 2) : formatCommandDetail(detail));
    return 0;
}

function commandCategories(args: Args, io: CliIo): number {
    io.out(args.flags.json === true ? JSON.stringify(COMMAND_CATEGORIES, null, 2) : formatCategories());
    return 0;
}

function commandLines(args: Args, io: CliIo): number {
    io.out(args.flags.json === true ? JSON.stringify({ help: LINE_SHAPES_HELP }, null, 2) : LINE_SHAPES_HELP);
    return 0;
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

function commandStories(args: Args, io: CliIo): number {
    const projectDir = requireProject(args);
    const stories = listStories(projectDir);
    if (args.flags.json === true) {
        io.out(JSON.stringify(stories, null, 2));
        return 0;
    }
    if (stories.length === 0) {
        io.out("This project holds no stories.");
        return 0;
    }
    const search = args.positional.join(" ").toLowerCase();
    const width = Math.max(...stories.map(story => story.name.length)) + 2;
    for (const story of stories) {
        if (search && !story.name.toLowerCase().includes(search)) {
            continue;
        }
        const document = readStoryDocument(projectDir, story.id).document;
        const scenes = orderedScenes(document).length;
        const dlc = story.dlcId ? "  (ships with a DLC)" : "";
        io.out(`  ${story.name.padEnd(width)}${scenes} scene${scenes === 1 ? "" : "s"}${dlc}`);
    }
    return 0;
}

/** The story a command works on, with the ambiguity reported rather than resolved by position. */
function requireStory(args: Args, projectDir: string): StorySummary {
    const stories = listStories(projectDir);
    const query = stringFlag(args, "story");
    const story = findStory(stories, query);
    if (story) {
        return story;
    }
    if (stories.length === 0) {
        throw new ProjectIoError("This project holds no stories.");
    }
    throw new UsageError(
        query
            ? `No story matches "${query}". This project has: ${stories.map(item => item.name).join(", ")}.`
            : `This project has ${stories.length} stories, so --story is needed: `
                + `${stories.map(item => item.name).join(", ")}.`,
    );
}

function commandScenes(args: Args, io: CliIo): number {
    const projectDir = requireProject(args);
    const story = requireStory(args, projectDir);
    const document = readStoryDocument(projectDir, story.id).document;
    const scenes = orderedScenes(document);
    if (args.flags.json === true) {
        io.out(JSON.stringify(scenes.map(scene => ({ id: scene.id, name: scene.name, rows: Object.keys(scene.blocks ?? {}).length })), null, 2));
        return 0;
    }
    const search = args.positional.join(" ").toLowerCase();
    const width = Math.max(...scenes.map(scene => scene.name.length), 4) + 2;
    for (const scene of scenes) {
        if (search && !scene.name.toLowerCase().includes(search)) {
            continue;
        }
        const rows = Object.keys(scene.blocks ?? {}).length;
        const entry = document.entrySceneId === scene.id ? "  entry scene" : "";
        io.out(`  ${scene.name.padEnd(width)}${String(rows).padStart(5)} row${rows === 1 ? " " : "s"}${entry}`);
    }
    return 0;
}

function commandTargets(args: Args, io: CliIo): number {
    const projectDir = requireProject(args);
    const data = readProjectData(projectDir);
    const story = requireStory(args, projectDir);
    const document = readStoryDocument(projectDir, story.id).document;
    const context = buildContext(data, document, null);
    if (args.flags.json === true) {
        io.out(JSON.stringify(context, null, 2));
        return 0;
    }
    io.out(formatTargets(context, args.positional.join(" ")));
    return 0;
}

function commandShow(args: Args, io: CliIo): number {
    const projectDir = requireProject(args);
    const data = readProjectData(projectDir);
    const story = requireStory(args, projectDir);
    const document = readStoryDocument(projectDir, story.id).document;
    const query = stringFlag(args, "scene");
    const scene = query ? findScene(document, query) : orderedScenes(document)[0] ?? null;
    if (!scene) {
        throw new UsageError(
            query ? `No scene matches "${query}". Run "story scenes" for the list.` : "This story has no scenes.",
        );
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

    const out = args.flags.out;
    if (out === undefined) {
        io.out(printed.text);
        return 0;
    }
    // `--out` with nothing after it means "put it where dumps go", named after the scene.
    const named = typeof out === "string" ? out : scratchFileNameFor(scene.name);
    const file = resolveStoryFile(named, { forWriting: true });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, printed.text, "utf8");
    io.out(`${file}  ${printed.stats.rows} rows`);
    if (printed.stats.opaque > 0) {
        io.out(
            `${printed.stats.opaque} of them have no spelling in this format and are kept verbatim. Editing a » line `
                + "changes nothing; change those rows in Studio.",
        );
        for (const row of printed.opaqueRows.slice(0, 10)) {
            io.out(`  ${row.anchor}  ${row.label}`);
        }
        if (printed.opaqueRows.length > 10) {
            io.out(`  ... and ${printed.opaqueRows.length - 10} more`);
        }
    }
    return 0;
}

async function commandCheck(args: Args, io: CliIo): Promise<number> {
    const projectDir = requireProject(args);
    const given = args.positional.join(" ");
    if (!given) {
        const result = await checkProject(projectDir);
        io.out(formatDiagnostics(result.diagnostics, { notRun: result.notRun }));
        return hasErrors(result.diagnostics) ? 1 : 0;
    }
    const story = requireStory(args, projectDir);
    const file = resolveStoryFile(given, { forWriting: false });
    const document = readStoryDocument(projectDir, story.id).document;
    const query = stringFlag(args, "scene");
    const result = await checkStoryFile(readSource(file), {
        projectDir,
        storyId: story.id,
        scene: query ? findScene(document, query) : null,
    });
    io.out(formatDiagnostics(result.diagnostics, { fileName: file, notRun: result.notRun }));
    return hasErrors(result.diagnostics) ? 1 : 0;
}

async function commandApply(args: Args, io: CliIo): Promise<number> {
    const projectDir = requireProject(args);
    const given = args.positional.join(" ");
    if (!given) {
        throw new UsageError("Which file? `story apply <file.story> --project <dir>`.");
    }
    const story = requireStory(args, projectDir);
    const file = resolveStoryFile(given, { forWriting: false });
    const documentFile = readStoryDocument(projectDir, story.id);
    const result = await checkStoryFile(readSource(file), { projectDir, storyId: story.id, scene: null });

    // The document layer is judged against the project as it stands, so a finding that was already
    // there is not this write's problem. Skipped when the edited project has no findings at all:
    // nothing can have been introduced, and the baseline run reads every story in the project.
    const baseline = result.projectFindings.length > 0 ? await lintStoredProject(projectDir) : [];
    const findings = findingsIntroduced(baseline, result.projectFindings);
    const reported = [...result.fileDiagnostics, ...findings.introduced];
    io.out(formatDiagnostics(reported, { fileName: file, notRun: result.notRun }));
    if (findings.carried > 0) {
        io.out("");
        io.out(formatCarriedFindings(findings.carried));
    }
    if (!result.scene || hasErrors(reported)) {
        io.err("Nothing written.");
        return 1;
    }

    const existing = documentFile.document.scenes?.[result.scene.id];
    if (!existing) {
        throw new ProjectIoError(`This story no longer holds scene ${result.scene.id}.`);
    }
    const data = readProjectData(projectDir);
    const lookups = buildLookups(data, documentFile.document, existing, buildContext(data, documentFile.document, existing));
    const summary = summariseApply(existing, result.scene, blockId =>
        describeStoryBlock(existing.blocks[blockId], { ...lookups.rowLookups, scene: existing }));

    // A document read at an older schema was migrated on the way in, and writing it back is what
    // makes that migration permanent. Said out loud rather than done quietly: it changes rows this
    // file never mentioned, which is not what "apply one scene" sounds like.
    const storedVersion = readStoredSchemaVersion(documentFile.filePath);
    if (storedVersion !== null && storedVersion !== documentFile.document.schemaVersion) {
        io.out(
            `This story is stored at schema ${storedVersion} and will be written at `
                + `${documentFile.document.schemaVersion}. The migration runs over the whole document, not just `
                + "this scene.",
        );
    }
    // The rename is reported and not applied, so the scene keeps the name the document gave it.
    const next = applyScene(documentFile, { ...result.scene, name: existing.name });
    if (args.flags.write === true) {
        writeStoryDocument(next);
    }
    io.out("");
    io.out(formatApplySummary(summary, args.flags.write === true));
    if (args.flags.write === true) {
        io.out(
            "Close the project in Studio before doing this: nothing reloads the file on its own, and a running "
                + "Studio writes its own copy over yours on the next save.",
        );
    }
    return 0;
}

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

/** The schema version on disk, before the read migrated it. Null when it cannot be read at all. */
function readStoredSchemaVersion(filePath: string): number | null {
    try {
        const stored = JSON.parse(fs.readFileSync(filePath, "utf8")) as { schemaVersion?: number };
        return typeof stored.schemaVersion === "number" ? stored.schemaVersion : null;
    } catch {
        return null;
    }
}

function readSource(file: string): string {
    try {
        return fs.readFileSync(file, "utf8");
    } catch (error) {
        throw new ProjectIoError(`Cannot read ${file}: ${(error as Error).message}`);
    }
}

function requireProject(args: Args): string {
    const dir = stringFlag(args, "project");
    if (!dir) {
        throw new UsageError(`"${args.command}" needs --project <dir>.`);
    }
    return resolveProjectDir(dir);
}

function optionalProject(args: Args): string | null {
    const dir = stringFlag(args, "project");
    return dir ? resolveProjectDir(dir) : null;
}

function stringFlag(args: Args, name: string): string | undefined {
    const value = args.flags[name];
    return typeof value === "string" ? value : undefined;
}

function enumFlag<T extends string>(args: Args, name: string, allowed: readonly T[]): T | undefined {
    const value = stringFlag(args, name);
    if (value === undefined) {
        return undefined;
    }
    const found = allowed.find(item => item.toLowerCase() === value.toLowerCase());
    if (!found) {
        throw new UsageError(`"--${name} ${value}" is not one of: ${allowed.join(", ")}.`);
    }
    return found;
}

function numberFlag(args: Args, name: string): number | undefined {
    const value = args.flags[name];
    if (value === undefined) {
        return undefined;
    }
    const parsed = Number(value);
    if (typeof value === "boolean" || !Number.isFinite(parsed) || parsed < 0) {
        throw new UsageError(`"--${name}" wants a number, got "${String(value)}".`);
    }
    return parsed;
}

function booleanFlagsOf(spec: CommandSpec): Set<string> {
    return new Set(
        Object.entries({ ...COMMON_FLAGS, ...spec.flags })
            .filter(([, kind]) => kind === "boolean")
            .map(([name]) => name),
    );
}

function validateFlags(args: Args, spec: CommandSpec): void {
    const declared = { ...COMMON_FLAGS, ...spec.flags };
    for (const [name, value] of Object.entries(args.flags)) {
        const kind = declared[name];
        if (!kind) {
            const suggestion = didYouMean(name, Object.keys(declared));
            throw new UsageError(
                `Unknown flag "--${name}" for "${args.command}".${suggestion ? ` ${suggestion}` : ""}\n`
                    + `"${args.command}" takes: ${Object.keys(declared)
                        .map(item => `--${item}`)
                        .join(" ")}`,
            );
        }
        // `show --out` is the one flag that means something on its own: put the dump where dumps go.
        if (kind === "string" && value === true && !(args.command === "show" && name === "out")) {
            throw new UsageError(`"--${name}" needs a value.`);
        }
    }
}

export function parseArgs(argv: readonly string[], booleanFlags: ReadonlySet<string> = new Set()): Args {
    const flags: Record<string, string | boolean> = {};
    const positional: string[] = [];
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        if (!token.startsWith("--")) {
            positional.push(token);
            continue;
        }
        const body = token.slice(2);
        const equals = body.indexOf("=");
        if (equals >= 0) {
            flags[body.slice(0, equals)] = body.slice(equals + 1);
            continue;
        }
        if (booleanFlags.has(body)) {
            flags[body] = true;
            continue;
        }
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
            flags[body] = next;
            i += 1;
            continue;
        }
        flags[body] = true;
    }
    return { command: positional.shift() ?? "", positional, flags };
}

export { COMMANDS, USAGE, readSource, requireProject, optionalProject, stringFlag, UsageError };
