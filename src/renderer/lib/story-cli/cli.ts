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
import { emitCommandResult } from "../agent-core/commandResult";
import { COMMAND_CATEGORIES } from "./catalog";
import type { StoredStories } from "./check";
import {
    formatOpaqueRowNotice,
    storyApplyCommand,
    storyCategoriesCommand,
    storyCheckProjectCommand,
    storyCheckSourceCommand,
    storyCommandCommand,
    storyCommandsCommand,
    storyLinesCommand,
    storyScenesCommand,
    storyShowCommand,
    storyStoriesCommand,
    storyTargetsCommand,
} from "./core";
import {
    findScene,
    findStory,
    listStories,
    ProjectIoError,
    readAllStories,
    readProjectData,
    readStoryDocument,
    resolveProjectDir,
    resolveStoryFile,
    scratchFileNameFor,
    writeStoryDocument,
    type StorySummary,
} from "./project";

export type CliIo = {
    out: (text: string) => void;
    err: (text: string) => void;
};

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
    const search = args.positional.join(" ") || undefined;
    const category = enumFlag(args, "category", COMMAND_CATEGORIES);
    const json = args.flags.json === true;
    return emitCommandResult(
        // `--limit` is only read when it is used: `--json` prints every match.
        storyCommandsCommand({ search, category, json, limit: json ? undefined : numberFlag(args, "limit") }),
        io,
    );
}

function commandCommand(args: Args, io: CliIo): number {
    const query = args.positional.join(" ");
    if (!query) {
        throw new UsageError("Which command? `story command <token>`.");
    }
    return emitCommandResult(storyCommandCommand(query, { json: args.flags.json === true }), io);
}

function commandCategories(args: Args, io: CliIo): number {
    return emitCommandResult(storyCategoriesCommand({ json: args.flags.json === true }), io);
}

function commandLines(args: Args, io: CliIo): number {
    return emitCommandResult(storyLinesCommand({ json: args.flags.json === true }), io);
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

function commandStories(args: Args, io: CliIo): number {
    const projectDir = requireProject(args);
    return emitCommandResult(
        storyStoriesCommand(listStories(projectDir), storyId => readStoryDocument(projectDir, storyId).document, {
            search: args.positional.join(" "),
            json: args.flags.json === true,
        }),
        io,
    );
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
    return emitCommandResult(
        storyScenesCommand(document, { search: args.positional.join(" "), json: args.flags.json === true }),
        io,
    );
}

function commandTargets(args: Args, io: CliIo): number {
    const projectDir = requireProject(args);
    const data = readProjectData(projectDir);
    const story = requireStory(args, projectDir);
    const document = readStoryDocument(projectDir, story.id).document;
    return emitCommandResult(
        storyTargetsCommand(data, document, { search: args.positional.join(" "), json: args.flags.json === true }),
        io,
    );
}

function commandShow(args: Args, io: CliIo): number {
    const projectDir = requireProject(args);
    const data = readProjectData(projectDir);
    const story = requireStory(args, projectDir);
    const document = readStoryDocument(projectDir, story.id).document;
    const shown = storyShowCommand(data, { name: story.name, document }, { scene: stringFlag(args, "scene") });
    if (!shown.scene || shown.text === undefined || !shown.stats || !shown.opaqueRows) {
        // No scene is bad usage, as it always was: the message names what to run instead.
        throw new UsageError(shown.err.join("\n"));
    }
    const out = args.flags.out;
    if (out === undefined) {
        return emitCommandResult(shown, io);
    }
    // `--out` with nothing after it means "put it where dumps go", named after the scene.
    const named = typeof out === "string" ? out : scratchFileNameFor(shown.scene.name);
    const file = resolveStoryFile(named, { forWriting: true });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, shown.text, "utf8");
    io.out(`${file}  ${shown.stats.rows} rows`);
    for (const line of formatOpaqueRowNotice({ stats: shown.stats, opaqueRows: shown.opaqueRows })) {
        io.out(line);
    }
    return 0;
}

/** The whole project as stored, every story that opens and every one that does not. */
function readStoredStories(projectDir: string): StoredStories {
    const data = readProjectData(projectDir);
    const read = readAllStories(projectDir);
    return {
        data,
        stories: read.stories.map(entry => ({ ...entry.summary, document: entry.document })),
        unreadable: read.unreadable,
    };
}

async function commandCheck(args: Args, io: CliIo): Promise<number> {
    const projectDir = requireProject(args);
    const given = args.positional.join(" ");
    if (!given) {
        return emitCommandResult(await storyCheckProjectCommand(readStoredStories(projectDir)), io);
    }
    const story = requireStory(args, projectDir);
    const file = resolveStoryFile(given, { forWriting: false });
    const document = readStoryDocument(projectDir, story.id).document;
    const query = stringFlag(args, "scene");
    const source = readSource(file);
    const data = readProjectData(projectDir);
    return emitCommandResult(
        await storyCheckSourceCommand(
            source,
            { data, story: { ...story, document }, scene: query ? findScene(document, query) : null },
            { fileName: file },
        ),
        io,
    );
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
    const source = readSource(file);
    const data = readProjectData(projectDir);
    const write = args.flags.write === true;
    const result = await storyApplyCommand(
        source,
        {
            data,
            story: { ...story, document: documentFile.document },
            stored: () => readStoredStories(projectDir),
            storedSchemaVersion: readStoredSchemaVersion(documentFile.filePath),
        },
        {
            fileName: file,
            write,
            writtenNote:
                "Close the project in Studio before doing this: nothing reloads the file on its own, and a running "
                + "Studio writes its own copy over yours on the next save.",
            commit: document => {
                try {
                    writeStoryDocument({ ...documentFile, document });
                    return null;
                } catch (error) {
                    if (error instanceof ProjectIoError) {
                        return error.message;
                    }
                    throw error;
                }
            },
        },
    );
    return emitCommandResult(result, io);
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
