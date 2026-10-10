/**
 * Command surface for `project/app/blueprint.js`.
 *
 * Kept apart from the Node wrapper that bundles it so the commands can be tested directly, and so
 * everything that touches the filesystem sits in one file rather than being spread through the
 * parser and the compiler.
 *
 * Every command declares its flags rather than reading whatever it recognises out of a bag. A flag
 * nobody declared is a typo, and a typo that is silently ignored is worse than one that stops the
 * run: `--projct` used to reach `requireProject` as an absent `--project`, and the report then read
 * "this command needs --project <dir>" with the path sitting right there on the line.
 *
 * Comments in English per project convention.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes";
import { builtInPluginOwnerOf, registerBuiltInPluginBlueprintNodes } from "./builtinPluginNodes";
import { emitCommandResult } from "../agent-core/commandResult";
import { BLUEPRINT_GRAPH_KINDS, BLUEPRINT_OWNER_KINDS, listNodeCategories } from "./catalog";
import { formatDiagnostics } from "./check";
import {
    blueprintApplyCommand,
    blueprintCategoriesCommand,
    blueprintCheckProjectCommand,
    blueprintCheckSourceCommand,
    blueprintListCommand,
    blueprintNodeCommand,
    blueprintNodesCommand,
    blueprintShowCommand,
    blueprintStructsCommand,
    blueprintTargetsCommand,
    unscopedWidgetWarning,
    type BlueprintProjectInput,
} from "./core";
import { ownerRefToIndexKey } from "@services/ui-editor/blueprint/ownerKeys";
import type { UIElement } from "@shared/types/ui-editor/document";
import { readAssetNameContext } from "./project";
import { planBlueprintRemoval, removeBlueprint, type RemovalElement } from "./remove";
import { printBlueprint } from "./dsl/print";
import { formatBlueprintSource } from "./format";
import {
    assertWritableSchema,
    loadSaveSchema,
    loadPageParams,
    ProjectIoError,
    elementTypeResolver,
    readUiDocumentTargets,
    readUiGraphs,
    readVariableRegistry,
    resolveBlueprintFile,
    resolveProjectDir,
    SCRATCH_DIR_NAME,
    scratchDir,
    scratchFileNameFor,
    writeUiGraphs,
} from "./project";

export type CliIo = {
    out: (text: string) => void;
    err: (text: string) => void;
};

const USAGE = `blueprint - query the node catalogue, write blueprints as text, check them.

  nodes [search words]        List node types. --category --graph-kind --owner --widget --all --limit
  node <type|name>            Everything about one node type: pins, fields, scope.
  categories                  Node categories and how many nodes each holds.
  structs                     The shapes the engine hands out (an ending, a history entry) and their fields.

  targets [search]            Surfaces and elements of a project, for owner= lines. Needs --project.
  list [search]               Blueprints a project holds. Needs --project. --with-graphs
  show                        Print a project's blueprints in the text format. Needs --project.
                              --blueprint <name|id> --owner <ownerKey> --out [file]
  check [file.bp]             Check a text file, or the whole project when given no file.
  format <file.bp>            Lay a file's graphs out the way Studio's Format graph does, in place.
                              --project <dir> (sizes save nodes' pins) --direction horizontal|vertical
                              --out <file>
  apply <file.bp>             Compile a text file into the project. Needs --project.
                              Writes nothing without --write.
  remove                      Take one blueprint out of a project. Needs --project.
                              --blueprint <name|id>. Writes nothing without --write.

Common flags
  --project <dir>             Project directory (the one holding editor/ui/uigraphs.json).
  --json                      Machine-readable output.

A file named without a directory - quit.bp rather than ./quit.bp - lives in ${SCRATCH_DIR_NAME}/ at the
root of this checkout, which git ignores. So the editing loop is three commands and one short name:

  show --project <dir> --blueprint "Quit" --out quit.bp
  check quit.bp --project <dir>
  apply quit.bp --project <dir> --write

Exit codes: 0 clean, 1 problems found, 2 bad usage or unreadable input.`;

type FlagKind = "string" | "boolean";

type CommandSpec = {
    flags: Record<string, FlagKind>;
    run: (args: Args, io: CliIo) => number;
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
    nodes: {
        flags: {
            category: "string",
            "graph-kind": "string",
            owner: "string",
            widget: "string",
            all: "boolean",
            limit: "string",
        },
        run: commandNodes,
    },
    node: { flags: {}, run: commandNode },
    categories: { flags: {}, run: commandCategories },
    structs: { flags: {}, run: commandStructs },
    targets: { flags: { project: "string" }, run: commandTargets },
    list: { flags: { project: "string", "with-graphs": "boolean" }, run: commandList },
    show: {
        flags: { project: "string", blueprint: "string", owner: "string", out: "string" },
        run: commandShow,
    },
    check: { flags: { project: "string" }, run: commandCheck },
    format: { flags: { project: "string", direction: "string", out: "string" }, run: commandFormat },
    apply: { flags: { project: "string", write: "boolean" }, run: commandApply },
    remove: { flags: { project: "string", blueprint: "string", write: "boolean" }, run: commandRemove },
};

export function runCli(argv: readonly string[], io: CliIo): number {
    registerCoreBlueprintNodes();
    registerBuiltInPluginBlueprintNodes();
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
        return spec.run(args, io);
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

function commandNodes(args: Args, io: CliIo): number {
    const widget = stringFlag(args, "widget");
    // Said before the other flags are judged, so a bad `--category` beside it does not hide it.
    const warning = unscopedWidgetWarning(widget);
    if (warning) {
        io.err(warning);
    }
    const query = {
        search: args.positional.join(" ") || undefined,
        category: enumFlag(
            args,
            "category",
            listNodeCategories().map(item => item.category),
        ),
        graphKind: enumFlag(args, "graph-kind", BLUEPRINT_GRAPH_KINDS),
        ownerKind: enumFlag(args, "owner", BLUEPRINT_OWNER_KINDS),
        widgetElementType: widget,
        includeHidden: args.flags.all === true,
    };
    return emitCommandResult(
        blueprintNodesCommand({ ...query, limit: numberFlag(args, "limit"), json: args.flags.json === true, skipWidgetWarning: true }),
        io,
    );
}

function commandNode(args: Args, io: CliIo): number {
    const wanted = args.positional.join(" ");
    if (!wanted) {
        throw new UsageError("Which node type? `blueprint node <type>`.");
    }
    return emitCommandResult(
        blueprintNodeCommand(wanted, { json: args.flags.json === true, nodeOwnerOf: builtInPluginOwnerOf }),
        io,
    );
}

function commandCategories(args: Args, io: CliIo): number {
    return emitCommandResult(blueprintCategoriesCommand({ json: args.flags.json === true }), io);
}

function commandStructs(args: Args, io: CliIo): number {
    return emitCommandResult(blueprintStructsCommand({ json: args.flags.json === true }), io);
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

/** Everything a graph is judged against, read off disk. */
function readProjectInput(projectDir: string, blueprintDocument = readUiGraphs(projectDir).blueprintDocument): BlueprintProjectInput {
    return {
        blueprintDocument,
        targets: readUiDocumentTargets(projectDir),
        variables: readVariableRegistry(projectDir),
        assetNameContext: readAssetNameContext(projectDir),
    };
}

function commandTargets(args: Args, io: CliIo): number {
    const projectDir = requireProject(args);
    return emitCommandResult(
        blueprintTargetsCommand(readUiDocumentTargets(projectDir), {
            search: args.positional.join(" "),
            json: args.flags.json === true,
        }),
        io,
    );
}

function commandList(args: Args, io: CliIo): number {
    const projectDir = requireProject(args);
    const file = readUiGraphs(projectDir);
    return emitCommandResult(
        blueprintListCommand(file.blueprintDocument, {
            search: args.positional.join(" "),
            withGraphs: args.flags["with-graphs"] === true,
            json: args.flags.json === true,
        }),
        io,
    );
}

function commandShow(args: Args, io: CliIo): number {
    const projectDir = requireProject(args);
    loadSaveSchema(projectDir);
    loadPageParams(projectDir);
    const file = readUiGraphs(projectDir);
    const wanted = stringFlag(args, "blueprint");
    const shown = blueprintShowCommand(file.blueprintDocument, { blueprint: wanted, owner: stringFlag(args, "owner") });
    const out = args.flags.out;
    if (shown.text === undefined || out === undefined) {
        return emitCommandResult(shown, io);
    }
    for (const text of shown.err) {
        io.err(text);
    }
    const blueprints = shown.blueprints;
    const fileName =
        typeof out === "string" && out.length > 0
            ? out
            : scratchFileNameFor(blueprints.length === 1 ? blueprints[0].name : (wanted ?? "blueprints"));
    const outPath = resolveBlueprintFile(fileName, { forWriting: true });
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, shown.text, "utf8");
    io.out(
        `Wrote ${blueprints.length} blueprint(s) to ${outPath}.\n`
            + `Edit it, then: blueprint check ${path.basename(outPath)} --project <dir>`,
    );
    return 0;
}

function commandCheck(args: Args, io: CliIo): number {
    const given = args.positional[0];
    const projectDir = stringFlag(args, "project") ? requireProject(args) : null;
    if (projectDir) {
        loadSaveSchema(projectDir);
        loadPageParams(projectDir);
    }

    if (!given) {
        if (!projectDir) {
            throw new UsageError("Give a file to check, or --project <dir> to check a whole project.");
        }
        const file = readUiGraphs(projectDir);
        return emitCommandResult(
            blueprintCheckProjectCommand(readProjectInput(projectDir, file.blueprintDocument), {
                fileName: file.filePath,
                json: args.flags.json === true,
            }),
            io,
        );
    }

    const resolved = resolveBlueprintFile(given, { forWriting: false });
    const source = readTextFile(resolved);
    return emitCommandResult(
        blueprintCheckSourceCommand(source, projectDir ? readProjectInput(projectDir) : null, {
            fileName: reportPath(resolved),
            json: args.flags.json === true,
        }),
        io,
    );
}

function commandFormat(args: Args, io: CliIo): number {
    const given = args.positional[0];
    if (!given) {
        throw new UsageError("Which file? `blueprint format <file.bp> --project <dir>`.");
    }
    const direction = enumFlag(args, "direction", ["horizontal", "vertical"] as const);
    const projectDir = stringFlag(args, "project") ? requireProject(args) : null;
    if (projectDir) {
        // Save nodes grow a pin for every field the project's saves carry, and a card is only
        // sized right with those pins on it.
        loadSaveSchema(projectDir);
        loadPageParams(projectDir);
    }
    const resolved = resolveBlueprintFile(given, { forWriting: false });
    const source = readTextFile(resolved);
    const targets = projectDir ? readUiDocumentTargets(projectDir) : null;
    const result = formatBlueprintSource(source, {
        direction,
        compile: projectDir && targets
            ? {
                  existing: readUiGraphs(projectDir).blueprintDocument,
                  resolveElementType: elementTypeResolver(targets),
                  uiElements: targets.raw as Readonly<Record<string, UIElement>>,
                  uiStructs: targets.structs,
              }
            : {},
    });
    const errors = result.diagnostics.filter(item => item.severity === "error");
    if (errors.length > 0) {
        io.err(formatDiagnostics(errors, { fileName: reportPath(resolved), source }));
        io.err("Nothing was written.");
        return 1;
    }
    const outFlag = stringFlag(args, "out");
    const target = outFlag ? resolveBlueprintFile(outFlag, { forWriting: true }) : resolved;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, result.text, "utf8");
    if (args.flags.json === true) {
        io.out(JSON.stringify({ file: target, layers: result.layers }, null, 2));
        return 0;
    }
    const lines = result.layers.map(layer => {
        const left = [
            layer.after.crossings > 0 ? `${layer.after.crossings} crossing(s)` : null,
            layer.after.throughCards > 0 ? `${layer.after.throughCards} wire(s) under a card` : null,
            layer.after.backwards > 0 ? `${layer.after.backwards} backwards (a loop)` : null,
        ].filter(Boolean);
        return `  ${layer.blueprint} / ${layer.layer}: ${layer.cards} card(s)${left.length > 0 ? `, ${left.join(", ")}` : ""}`;
    });
    io.out(
        [
            `Formatted ${result.layers.length} layer(s) into ${target}.`,
            ...lines,
            `Then: blueprint check ${path.basename(target)} --project <dir>`,
        ].join("\n"),
    );
    return 0;
}

function commandApply(args: Args, io: CliIo): number {
    const given = args.positional[0];
    if (!given) {
        throw new UsageError("Which file? `blueprint apply <file.bp> --project <dir> --write`.");
    }
    const projectDir = requireProject(args);
    loadSaveSchema(projectDir);
    loadPageParams(projectDir);
    const resolved = resolveBlueprintFile(given, { forWriting: false });
    const source = readTextFile(resolved);
    const file = readUiGraphs(projectDir);
    const write = args.flags.write === true;
    const result = blueprintApplyCommand(source, readProjectInput(projectDir, file.blueprintDocument), {
        fileName: reportPath(resolved),
        documentLabel: file.filePath,
        write,
        writtenNote:
            "Studio does not reload this file on its own - if the project is open, close and reopen it, "
            + "and do not write while it is open or the next save will overwrite this.",
        beforeApply: () => {
            try {
                assertWritableSchema(file);
                return null;
            } catch (error) {
                if (error instanceof ProjectIoError) {
                    return error.message;
                }
                throw error;
            }
        },
    });
    if (result.applied && write) {
        writeUiGraphs(file);
    }
    return emitCommandResult(result, io);
}

function commandRemove(args: Args, io: CliIo): number {
    const wanted = stringFlag(args, "blueprint");
    if (!wanted) {
        throw new UsageError("Which blueprint? `blueprint remove --blueprint <name|id> --project <dir> --write`.");
    }
    const projectDir = requireProject(args);
    const file = readUiGraphs(projectDir);
    // A removal names one blueprint exactly or not at all. `show` widens a part of a name to every
    // blueprint it is part of, which is the right answer to "print it" and the wrong one to "delete it".
    const matched = Object.values(file.blueprintDocument.blueprints)
        .filter(item => item.id === wanted || item.name === wanted);
    if (matched.length !== 1) {
        io.err(
            matched.length === 0
                ? `No blueprint has the id or the whole name "${wanted}". Run \`blueprint list --project <dir>\`.`
                : `${matched.length} blueprints are called "${wanted}": `
                      + `${matched.map(item => `${item.id} (${ownerRefToIndexKey(item.owner)})`).join(", ")}. `
                      + "Name one by its id.",
        );
        return 2;
    }
    const blueprint = matched[0];
    const elements = readUiDocumentTargets(projectDir).raw as Readonly<Record<string, RemovalElement>>;
    const plan = planBlueprintRemoval(file.blueprintDocument, blueprint, elements);
    if (plan.refusals.length > 0) {
        io.err(plan.refusals.map(reason => `error  blueprint.remove_refused  ${reason}`).join("\n"));
        io.err("Nothing was written.");
        return 1;
    }
    const what = `remove "${blueprint.name}" (${ownerRefToIndexKey(blueprint.owner)})`;
    if (args.flags.write !== true) {
        io.out(`Would ${what} from ${file.filePath}. Pass --write to do it.`);
        return 0;
    }
    assertWritableSchema(file);
    removeBlueprint(file.blueprintDocument, blueprint, plan);
    writeUiGraphs(file);
    io.out(
        `Wrote ${file.filePath}: ${what}.\n`
            + "Studio does not reload this file on its own - if the project is open, close and reopen it, "
            + "and do not write while it is open or the next save will overwrite this.",
    );
    return 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A path as it should read in a report: short when it is nearby, absolute when it is not. */
function reportPath(filePath: string): string {
    const relative = path.relative(process.cwd(), filePath);
    return relative.startsWith("..") ? filePath : relative;
}

function readTextFile(filePath: string): string {
    try {
        return fs.readFileSync(filePath, "utf8");
    } catch (error) {
        const hint =
            path.dirname(filePath) === scratchDir()
                ? ` A bare filename means ${SCRATCH_DIR_NAME}/ in this checkout - pass `
                  + `./${path.basename(filePath)} for the working directory.`
                : "";
        throw new ProjectIoError(`Cannot read ${filePath}: ${(error as Error).message}.${hint}`);
    }
}

function requireProject(args: Args): string {
    const dir = stringFlag(args, "project");
    if (!dir) {
        throw new UsageError("This command needs --project <dir>.");
    }
    return resolveProjectDir(dir);
}

function stringFlag(args: Args, name: string): string | undefined {
    const value = args.flags[name];
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * A flag whose value has to be one of a known set.
 *
 * Unvalidated, `--owner widget` was read as an owner kind nobody declared and fell through to
 * `globalMain`, so the answer was a palette for the wrong owner with nothing on it to say so.
 */
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
        throw new UsageError(`"--${name}" wants a number, not "${String(value)}".`);
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

/** The closest of a set of known words, when one of them is close enough to have been meant. */
function didYouMean(input: string, known: readonly string[]): string {
    const scored = known
        .map(candidate => ({
            candidate,
            distance: editDistance(input.toLowerCase(), candidate.toLowerCase()),
        }))
        .sort((a, b) => a.distance - b.distance);
    const best = scored[0];
    return best && best.distance <= Math.max(2, Math.floor(input.length / 3))
        ? `Did you mean "${best.candidate}"?`
        : "";
}

function editDistance(a: string, b: string): number {
    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
        const current = [i];
        for (let j = 1; j <= b.length; j += 1) {
            current[j] = Math.min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
            );
        }
        previous = current;
    }
    return previous[b.length];
}

/**
 * Tokens to command, positionals and flags.
 *
 * Which flags are boolean has to be told rather than guessed: `apply --write my.bp` would otherwise
 * read the filename as the value of `--write` and then report that no file was given.
 */
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

export { COMMANDS, printBlueprint, USAGE };
