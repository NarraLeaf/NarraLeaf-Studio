/**
 * Command surface for `project/app/ui.js`.
 *
 * Kept apart from the Node wrapper that bundles it so the commands can be tested directly, and so
 * everything that touches the filesystem sits in one file rather than being spread through the
 * parser, the compiler and the catalogue.
 *
 * Every command declares its flags rather than reading whatever it recognises out of a bag, the same
 * way `blueprint` does and for the same reason: a flag nobody declared is a typo, and a typo that is
 * silently ignored reports the wrong problem.
 *
 * This tool owns `editor/ui/uidoc.json` and reads `uigraphs.json`. Attaching a graph to a widget is
 * `blueprint apply`'s job, and the seam between the two is the element id: a `.ui` file names its own
 * ids, so the blueprint that hangs off an element can be written before or after the element itself.
 * The one write into `uigraphs.json` is `remove`'s: a component definition's own blueprints have no
 * owner once the definition is gone, so they go in the same step instead of being left for Studio to
 * collect the next time it opens the project.
 *
 * Comments in English per project convention.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
    assertWritableSchema as assertWritableBlueprintSchema,
    ProjectIoError as BlueprintProjectIoError,
    readUiGraphs,
    SCRATCH_DIR_NAME,
    UI_GRAPHS_RELATIVE_PATH,
    writeUiGraphs,
} from "../blueprint-cli/project";
import { SCRIPTS_DIR, SCRIPTS_GENERATED_DIR, SCRIPTS_MODULES_DIR } from "@shared/project/scriptsDirectory";
import { WIDGET_STAGE_SLOTS, WIDGET_SURFACE_KINDS } from "./catalog";
import { emitCommandResult } from "../agent-core/commandResult";
import {
    DEFAULT_USAGE_LIMIT,
    uiApplyCommand,
    uiCheckProjectCommand,
    uiCheckSourceCommand,
    uiShowCommand,
    uiStructsCommand,
    uiSurfacesCommand,
    uiUsageCommand,
    uiWidgetCommand,
    uiWidgetsCommand,
} from "./core";
import {
    assertWritableSchema,
    ProjectIoError,
    readBlueprintIndex,
    readSkeletonDocument,
    readTextKeys,
    readUiDocument,
    repoRoot,
    resolveProjectDir,
    resolveUiFile,
    scratchFileNameFor,
    writeUiDocument,
} from "./project";
import { CliPluginError, loadCliPlugin } from "./plugins";
import {
    describeComponentRemoval,
    planComponentRemoval,
    removeComponentDefinition,
    REMOVE_REFUSED_CODE,
    type ProjectTextFile,
} from "./remove";
import { didYouMean } from "./text";
import { registerBuiltInPluginStructs } from "@/lib/blueprint-cli/builtinPluginNodes";

export type CliIo = {
    out: (text: string) => void;
    err: (text: string) => void;
};

const USAGE = `ui - query the widget catalogue, read an interface, write one as text.

  widgets [search words]      List widget types. --insertable --surface-kind --slot
  widget <type>               Everything about one type: props, bindable props, events, parts.
  structs                     The list-item shapes that ship with Studio. --project adds a project's.
  usage <type>                How the shipped skeleton uses this widget.
                              --project --prop <key> --limit <n> --shallow

  surfaces [search]           Surfaces, components and the owner= lines blueprint wants. Needs --project.
  show                        Print a project's interface in the text format. Needs --project.
                              --surface <name|id> --component <name|id> --out [file]
                              --compact leaves out props at their widget's default (+defaults) and
                              appearance groups that only repeat a prop; apply restores them.
  check [file.ui]             Check a text file, or the whole project when given no file.
  apply <file.ui>             Compile a text file into the project. Needs --project.
                              Writes nothing without --write.
  remove                      Take a component definition out of a project, with its elements and its
                              blueprints. Needs --project. --component <name|id>. Refused, naming
                              what uses it, while anything does. Writes nothing without --write.

Common flags
  --project <dir>             Project directory (the one holding editor/ui/uidoc.json).
  --plugin <dir>              A plugin's directory. Its widgets join the catalogue for this run, so
                              a project using them can be checked. Repeatable. Runs its studio entry.
  --json                      Machine-readable output.

A file named without a directory - title.ui rather than ./title.ui - lives in ${SCRATCH_DIR_NAME}/ at the
root of this checkout, which git ignores. So the editing loop is three commands and one short name:

  show --project <dir> --surface Title --out title.ui
  check title.ui --project <dir>
  apply title.ui --project <dir> --write

Exit codes: 0 clean, 1 problems found, 2 bad usage or unreadable input.`;

/** `list` is a flag that may be given more than once, each time with a value. */
type FlagKind = "string" | "boolean" | "list";

type CommandSpec = {
    flags: Record<string, FlagKind>;
    run: (args: Args, io: CliIo) => number;
};

type Args = {
    command: string;
    positional: string[];
    flags: Record<string, string | boolean>;
    /** The values of the flags given more than once by design, in the order given. */
    lists: Record<string, string[]>;
};

/** Bad usage, as opposed to a project that cannot be read. Both leave with 2. */
class UsageError extends Error {}

const COMMON_FLAGS: Record<string, FlagKind> = { json: "boolean", help: "boolean", plugin: "list" };

const COMMANDS: Record<string, CommandSpec> = {
    widgets: {
        flags: { insertable: "boolean", "surface-kind": "string", slot: "string" },
        run: commandWidgets,
    },
    widget: { flags: {}, run: commandWidget },
    structs: { flags: { project: "string" }, run: commandStructs },
    usage: {
        flags: { project: "string", prop: "string", limit: "string", shallow: "boolean" },
        run: commandUsage,
    },
    surfaces: { flags: { project: "string" }, run: commandSurfaces },
    show: {
        flags: { project: "string", surface: "string", component: "string", out: "string", compact: "boolean" },
        run: commandShow,
    },
    check: { flags: { project: "string" }, run: commandCheck },
    apply: { flags: { project: "string", write: "boolean" }, run: commandApply },
    remove: { flags: { project: "string", component: "string", write: "boolean" }, run: commandRemove },
};

export function runCli(argv: readonly string[], io: CliIo): number {
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
        const args = parseArgs(argv, booleanFlagsOf(spec), listFlagsOf(spec));
        validateFlags(args, spec);
        loadPlugins(args, io);
        return spec.run(args, io);
    } catch (error) {
        if (
            error instanceof ProjectIoError
            || error instanceof BlueprintProjectIoError
            || error instanceof UsageError
            || error instanceof CliPluginError
        ) {
            io.err(error.message);
            return 2;
        }
        throw error;
    }
}

/**
 * Load every `--plugin` before the command reads anything, so its widgets are in the catalogue the
 * command asks. What the loader had to leave out is said on stderr, where it cannot be mistaken for
 * the command's own output.
 */
function loadPlugins(args: Args, io: CliIo): void {
    // The plugins bundled with Studio declare row shapes a shipped list may name; they are known
    // without being asked for, as their nodes are to the blueprint tool.
    registerBuiltInPluginStructs();
    for (const dir of args.lists.plugin ?? []) {
        const loaded = loadCliPlugin(dir);
        for (const note of loaded.notes) {
            io.err(note);
        }
    }
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

function commandWidgets(args: Args, io: CliIo): number {
    const stageSlot = enumFlag(args, "slot", WIDGET_STAGE_SLOTS);
    return emitCommandResult(
        uiWidgetsCommand({
            search: args.positional.join(" ") || undefined,
            insertableOnly: args.flags.insertable === true,
            surfaceKind: enumFlag(args, "surface-kind", WIDGET_SURFACE_KINDS),
            stageSlot,
            json: args.flags.json === true,
        }),
        io,
    );
}

function commandWidget(args: Args, io: CliIo): number {
    const type = args.positional.join(" ");
    if (!type) {
        throw new UsageError("Which widget type? `ui widget <type>`.");
    }
    return emitCommandResult(uiWidgetCommand(type, { json: args.flags.json === true }), io);
}

function commandStructs(args: Args, io: CliIo): number {
    const projectDir = optionalProject(args);
    const document = projectDir ? readUiDocument(projectDir).document : null;
    return emitCommandResult(uiStructsCommand(document, { json: args.flags.json === true }), io);
}

function commandUsage(args: Args, io: CliIo): number {
    const type = args.positional.join(" ");
    if (!type) {
        throw new UsageError("Which widget type? `ui usage <type>`.");
    }
    const projectDir = optionalProject(args);
    const document = projectDir ? readUiDocument(projectDir).document : readSkeletonDocument(repoRoot());
    if (!document) {
        throw new ProjectIoError(
            "No interface to read. Pass --project, or run this from the repository so the shipped skeleton "
                + "template can be found.",
        );
    }
    const json = args.flags.json === true;
    const prop = stringFlag(args, "prop");
    return emitCommandResult(
        uiUsageCommand(document, type, {
            json,
            prop,
            // Only read when it is used: `--json` and `--prop` print every occurrence.
            limit: json || prop ? undefined : numberFlag(args, "limit") ?? DEFAULT_USAGE_LIMIT,
            shallow: args.flags.shallow === true,
        }),
        io,
    );
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

function commandSurfaces(args: Args, io: CliIo): number {
    const projectDir = requireProject(args);
    const { document } = readUiDocument(projectDir);
    const blueprints = readBlueprintIndex(projectDir);
    return emitCommandResult(
        uiSurfacesCommand({ document, blueprints }, { search: args.positional.join(" "), json: args.flags.json === true }),
        io,
    );
}

function commandShow(args: Args, io: CliIo): number {
    const projectDir = requireProject(args);
    const { document } = readUiDocument(projectDir);
    const blueprints = readBlueprintIndex(projectDir);
    const shown = uiShowCommand(
        { document, blueprints, textKeys: readTextKeys(projectDir) },
        {
            surface: stringFlag(args, "surface"),
            component: stringFlag(args, "component"),
            compact: args.flags.compact === true,
            projectHint: projectDir,
        },
    );
    const out = args.flags.out;
    if (shown.text === undefined || out === undefined) {
        return emitCommandResult(shown, io);
    }
    const fileName = typeof out === "string" && out.length > 0 ? out : scratchFileNameFor(shown.subject);
    const outPath = resolveUiFile(fileName, { forWriting: true });
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, shown.text, "utf8");
    io.out(`Wrote ${outPath}.\nEdit it, then: ui check ${path.basename(outPath)} --project <dir>`);
    return 0;
}

function commandCheck(args: Args, io: CliIo): number {
    const given = args.positional[0];
    if (!given) {
        // No file means "check what is already there", which needs the project and nothing else.
        const projectDir = requireProject(args);
        const documentFile = readUiDocument(projectDir);
        return emitCommandResult(
            uiCheckProjectCommand(
                { document: documentFile.document, blueprints: readBlueprintIndex(projectDir) },
                { fileName: documentFile.filePath },
            ),
            io,
        );
    }

    const projectDir = optionalProject(args);
    const documentFile = projectDir ? readUiDocument(projectDir) : null;
    const blueprints = projectDir ? readBlueprintIndex(projectDir) : null;
    const file = resolveUiFile(given, { forWriting: false });
    const source = readSource(file);
    const textKeys = projectDir ? readTextKeys(projectDir) : null;
    return emitCommandResult(
        uiCheckSourceCommand(
            source,
            documentFile && blueprints ? { document: documentFile.document, blueprints, textKeys } : null,
            { fileName: file },
        ),
        io,
    );
}

function commandApply(args: Args, io: CliIo): number {
    const given = args.positional[0];
    if (!given) {
        throw new UsageError("Which file? `ui apply <file.ui> --project <dir>`.");
    }
    const projectDir = requireProject(args);
    const documentFile = readUiDocument(projectDir);
    const blueprints = readBlueprintIndex(projectDir);
    const file = resolveUiFile(given, { forWriting: false });
    const source = readSource(file);
    const write = args.flags.write === true;
    const result = uiApplyCommand(
        source,
        { document: documentFile.document, blueprints, textKeys: readTextKeys(projectDir) },
        {
            fileName: file,
            write,
            beforeApply: () => {
                try {
                    assertWritableSchema(documentFile);
                    return null;
                } catch (error) {
                    if (error instanceof ProjectIoError) {
                        return error.message;
                    }
                    throw error;
                }
            },
            writtenNote:
                "Close the project in Studio before doing this: nothing reloads the file on its own, and a running "
                + "Studio writes its own copy over yours on the next save.",
        },
    );
    if (result.applied && write) {
        writeUiDocument(documentFile);
    }
    return emitCommandResult(result, io);
}

function commandRemove(args: Args, io: CliIo): number {
    const wanted = stringFlag(args, "component");
    if (!wanted) {
        throw new UsageError("Which component? `ui remove --component <name|id> --project <dir>`.");
    }
    const projectDir = requireProject(args);
    const documentFile = readUiDocument(projectDir);
    // A removal names one definition exactly or not at all: `show` takes the first of two components
    // with the same name, which is the right answer to "print it" and the wrong one to "delete it".
    const matched = (documentFile.document.components ?? [])
        .filter(component => component.id === wanted || component.name === wanted);
    if (matched.length !== 1) {
        io.err(
            matched.length === 0
                ? `No component definition has the id or the whole name "${wanted}". Run \`ui surfaces --project <dir>\`.`
                : `${matched.length} component definitions are called "${wanted}": `
                      + `${matched.map(component => component.id).join(", ")}. Name one by its id.`,
        );
        return 2;
    }
    const graphs = fs.existsSync(path.join(projectDir, UI_GRAPHS_RELATIVE_PATH)) ? readUiGraphs(projectDir) : null;
    const plan = planComponentRemoval({
        document: documentFile.document,
        blueprints: graphs?.blueprintDocument ?? null,
        component: matched[0],
        files: readProjectTexts(projectDir),
    });
    if (plan.refusals.length > 0) {
        io.err(plan.refusals.map(reason => `error  ${REMOVE_REFUSED_CODE}  ${reason}`).join("\n"));
        io.err("Nothing was written.");
        return 1;
    }
    const what = describeComponentRemoval(plan);
    if (args.flags.write !== true) {
        io.out(`Would remove ${what}. Pass --write to do it.`);
        return 0;
    }
    // Both documents are checked before either is written, so a refusal never leaves one written.
    assertWritableSchema(documentFile);
    if (graphs) {
        assertWritableBlueprintSchema(graphs);
    }
    removeComponentDefinition(documentFile.document, graphs?.blueprintDocument ?? null, plan);
    // The blueprints first: a definition left behind without its blueprints is one Studio gives fresh
    // empty ones to, while blueprints left behind without their definition are orphans nothing reads.
    if (graphs) {
        writeUiGraphs(graphs);
    }
    writeUiDocument(documentFile);
    io.out(
        `Removed ${what}.\n`
            + "Close the project in Studio before doing this: nothing reloads the files on their own, and a running "
            + "Studio writes its own copy over yours on the next save.",
    );
    return 0;
}

/** Directories under `editor/` that hold what Studio derives, not what an author wrote. */
const DERIVED_EDITOR_DIRS: ReadonlySet<string> = new Set(["cache"]);

/** What a project file is read as when looking for an id in it; anything else is skipped. */
const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
    ".json", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".md", ".txt", ".toml", ".yaml", ".yml",
]);

/**
 * The project's other authored files, as text: everything under `editor/` but the two interface
 * documents and Studio's caches, and the author's scripts but not their generated declarations or
 * installed packages. These are what `remove` searches for a component's ids, so anything that names
 * the definition - a script reading one of its elements, a story or service table that kept an id -
 * stops the removal rather than being left pointing at nothing.
 */
function readProjectTexts(projectDir: string): ProjectTextFile[] {
    const out: ProjectTextFile[] = [];
    const skip = new Set([
        path.join(projectDir, "editor", "ui", "uidoc.json"),
        path.join(projectDir, UI_GRAPHS_RELATIVE_PATH),
    ]);
    const walk = (dir: string, skipDirs: ReadonlySet<string>): void => {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!skipDirs.has(entry.name)) {
                    walk(full, new Set());
                }
                continue;
            }
            if (!entry.isFile() || skip.has(full) || !TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
                continue;
            }
            try {
                out.push({
                    path: path.relative(projectDir, full).split(path.sep).join("/"),
                    text: fs.readFileSync(full, "utf8"),
                });
            } catch {
                // An unreadable file cannot name anything this tool could act on.
            }
        }
    };
    walk(path.join(projectDir, "editor"), DERIVED_EDITOR_DIRS);
    walk(path.join(projectDir, SCRIPTS_DIR), new Set([SCRIPTS_GENERATED_DIR, SCRIPTS_MODULES_DIR]));
    return out;
}

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

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

function listFlagsOf(spec: CommandSpec): Set<string> {
    return new Set(
        Object.entries({ ...COMMON_FLAGS, ...spec.flags })
            .filter(([, kind]) => kind === "list")
            .map(([name]) => name),
    );
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
    for (const [name, values] of Object.entries(args.lists)) {
        if (values.some(value => value.length === 0)) {
            throw new UsageError(`"--${name}" needs a value.`);
        }
    }
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

export function parseArgs(
    argv: readonly string[],
    booleanFlags: ReadonlySet<string> = new Set(),
    listFlags: ReadonlySet<string> = new Set(),
): Args {
    const flags: Record<string, string | boolean> = {};
    const lists: Record<string, string[]> = {};
    const positional: string[] = [];
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        if (!token.startsWith("--")) {
            positional.push(token);
            continue;
        }
        const body = token.slice(2);
        const equals = body.indexOf("=");
        const name = equals >= 0 ? body.slice(0, equals) : body;
        if (listFlags.has(name)) {
            // A list flag always takes a value: the one after `=`, or the next token. Missing is an
            // empty value, which validation refuses by name.
            const next = argv[i + 1];
            const value = equals >= 0 ? body.slice(equals + 1) : next !== undefined && !next.startsWith("--") ? next : "";
            if (equals < 0 && value !== "") {
                i += 1;
            }
            (lists[name] ??= []).push(value);
            continue;
        }
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
    return { command: positional.shift() ?? "", positional, flags, lists };
}

export { COMMANDS, USAGE };
