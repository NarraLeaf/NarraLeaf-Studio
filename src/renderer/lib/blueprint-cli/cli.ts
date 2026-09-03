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
import { listScriptLayers } from "@shared/blueprint/blueprintLayers";
import type { Blueprint } from "@shared/types/blueprint/document";
import type { UIElement } from "@shared/types/ui-editor/document";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes";
import { ownerRefToIndexKey } from "@services/ui-editor/blueprint/ownerKeys";
import {
    BLUEPRINT_GRAPH_KINDS,
    BLUEPRINT_OWNER_KINDS,
    describeNode,
    formatNodeDetail,
    formatNodeList,
    knownWidgetElementTypes,
    listNodeCategories,
    queryNodes,
    resolveNodeType,
} from "./catalog";
import { checkBlueprintSource, checkProjectDocument, formatDiagnostics } from "./check";
import { printBlueprint, printBlueprints } from "./dsl/print";
import {
    applyBlueprints,
    assertWritableSchema,
    loadSaveSchema,
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
    widgetElementResolver,
    widgetElementTypeResolver,
    writeUiGraphs,
} from "./project";

export type CliIo = {
    out: (text: string) => void;
    err: (text: string) => void;
};

/** How many nodes a bare `nodes` prints before it says only how many more there are. */
const DEFAULT_NODE_LIST_LIMIT = 60;

const USAGE = `blueprint - query the node catalogue, write blueprints as text, check them.

  nodes [search words]        List node types. --category --graph-kind --owner --widget --all --limit
  node <type|name>            Everything about one node type: pins, fields, scope.
  categories                  Node categories and how many nodes each holds.

  targets [search]            Surfaces and elements of a project, for owner= lines. Needs --project.
  list [search]               Blueprints a project holds. Needs --project. --with-graphs
  show                        Print a project's blueprints in the text format. Needs --project.
                              --blueprint <name|id> --owner <ownerKey> --out [file]
  check [file.bp]             Check a text file, or the whole project when given no file.
  apply <file.bp>             Compile a text file into the project. Needs --project.
                              Writes nothing without --write.

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
    targets: { flags: { project: "string" }, run: commandTargets },
    list: { flags: { project: "string", "with-graphs": "boolean" }, run: commandList },
    show: {
        flags: { project: "string", blueprint: "string", owner: "string", out: "string" },
        run: commandShow,
    },
    check: { flags: { project: "string" }, run: commandCheck },
    apply: { flags: { project: "string", write: "boolean" }, run: commandApply },
};

export function runCli(argv: readonly string[], io: CliIo): number {
    registerCoreBlueprintNodes();
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
    if (widget && !knownWidgetElementTypes().includes(widget)) {
        io.err(
            `No node in the catalogue is scoped to "${widget}". Widget types that scope one: `
                + `${knownWidgetElementTypes().join(", ")}.`,
        );
    }
    const all = queryNodes({
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
    });
    const limit = numberFlag(args, "limit");
    if (args.flags.json === true) {
        io.out(JSON.stringify(limit ? all.slice(0, limit) : all, null, 2));
        return 0;
    }
    // A bare `nodes` matches 600-odd of them, and a wall of those answers no question worth asking.
    // The total and the way to lift the cap go in the trailer, so nothing is quietly dropped.
    const effective = limit ?? DEFAULT_NODE_LIST_LIMIT;
    io.out(formatNodeList(effective > 0 ? all.slice(0, effective) : all, { total: all.length }));
    return 0;
}

function commandNode(args: Args, io: CliIo): number {
    const wanted = args.positional.join(" ");
    if (!wanted) {
        throw new UsageError("Which node type? `blueprint node <type>`.");
    }
    const resolved = resolveNodeType(wanted);
    if (!resolved) {
        io.err(`No node type "${wanted}".`);
        const near = queryNodes({ search: wanted, includeHidden: true, limit: 8 });
        if (near.length > 0) {
            io.err(`Close by: ${near.map(node => node.type).join(", ")}`);
        }
        return 2;
    }
    if (resolved !== wanted) {
        io.err(`"${wanted}" -> ${resolved}`);
    }
    const detail = describeNode(resolved);
    if (!detail) {
        io.err(`No node type "${resolved}".`);
        return 2;
    }
    io.out(args.flags.json === true ? JSON.stringify(detail, null, 2) : formatNodeDetail(detail));
    return 0;
}

function commandCategories(args: Args, io: CliIo): number {
    const categories = listNodeCategories();
    if (args.flags.json === true) {
        io.out(JSON.stringify(categories, null, 2));
        return 0;
    }
    const width = Math.max(...categories.map(item => item.category.length));
    io.out(categories.map(item => `${item.category.padEnd(width)}  ${item.count}`).join("\n"));
    return 0;
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

function commandTargets(args: Args, io: CliIo): number {
    const projectDir = requireProject(args);
    const targets = readUiDocumentTargets(projectDir);
    if (args.flags.json === true) {
        io.out(JSON.stringify(targets, null, 2));
        return 0;
    }
    // A project of any size holds hundreds of elements, and the id being looked for is nearly always
    // the one whose name is already known.
    const search = args.positional.join(" ");
    const needle = search.toLowerCase();
    const wanted = (text: string) => !needle || text.toLowerCase().includes(needle);
    const lines: string[] = [];
    let shown = 0;
    for (const surface of targets.surfaces) {
        const elements = targets.elements.filter(
            item =>
                item.surfaceId === surface.id
                && (wanted(surface.name) || wanted(`${item.path} ${item.type}`)),
        );
        if (!wanted(surface.name) && elements.length === 0) {
            continue;
        }
        lines.push(`${surface.name}  owner=surfaceMain surface=${surface.id}`);
        for (const element of elements) {
            lines.push(
                `    ${element.path}  [${element.type}]  owner=widgetMain surface=${surface.id} `
                    + `element=${element.id}`,
            );
        }
        shown += elements.length;
        lines.push("");
    }
    // Components after the surfaces, and with their params listed: a component blueprint's whole
    // reason to exist is that the instances differ, and the param ids are what says how.
    for (const component of targets.components) {
        const elements = targets.elements.filter(
            item =>
                item.componentId === component.id
                && (wanted(component.name) || wanted(`${item.path} ${item.type}`)),
        );
        if (!wanted(component.name) && elements.length === 0) {
            continue;
        }
        const params = component.params.length
            ? component.params.map(param => `${param.id}="${param.defaultValue}"`).join(" ")
            : "no params";
        lines.push(`${component.name}  component=${component.id}  (${params})`);
        for (const element of elements) {
            lines.push(
                `    ${element.path}  [${element.type}]  owner=componentWidgetMain `
                    + `component=${component.id} element=${element.id}`,
            );
        }
        shown += elements.length;
        lines.push("");
    }
    if (lines.length === 0) {
        io.out(search ? `Nothing here matches "${search}".` : "This project declares no surfaces.");
        return 0;
    }
    lines.push(
        search
            ? `${shown} of ${targets.elements.length} elements match "${search}".`
            : `${targets.surfaces.length} surface(s), ${targets.components.length} component(s), `
                  + `${targets.elements.length} element(s).`,
    );
    io.out(lines.join("\n"));
    return 0;
}

function commandList(args: Args, io: CliIo): number {
    const projectDir = requireProject(args);
    const file = readUiGraphs(projectDir);
    const all = Object.values(file.blueprintDocument.blueprints).map(blueprint => ({
        id: blueprint.id,
        name: blueprint.name,
        ownerKey: ownerRefToIndexKey(blueprint.owner),
        scripts: listScriptLayers(blueprint.graphs).length,
        events: countGraphs(blueprint, "events"),
        functions: countGraphs(blueprint, "functions"),
        nodes: countNodes(blueprint),
    }));
    all.sort((a, b) => a.ownerKey.localeCompare(b.ownerKey));
    const search = args.positional.join(" ");
    const needle = search.toLowerCase();
    let rows = needle
        ? all.filter(row => `${row.name} ${row.ownerKey} ${row.id}`.toLowerCase().includes(needle))
        : all;
    // Most owners hold an empty blueprint: a widget gets one the moment anyone opens its graph, and
    // it stays whether or not a node was ever dropped into it. They are noise to everything but a
    // census, and they outnumber the rest six to one in the shipped skeleton.
    if (args.flags["with-graphs"] === true) {
        rows = rows.filter(row => row.nodes > 0);
    }
    if (args.flags.json === true) {
        io.out(JSON.stringify(rows, null, 2));
        return 0;
    }
    if (rows.length === 0) {
        io.out(search ? `No blueprint matches "${search}".` : "This project holds no blueprints.");
        return 0;
    }
    const nameWidth = Math.max(...rows.map(row => row.name.length));
    const table = rows
        .map(
            row =>
                `${row.name.padEnd(nameWidth)}  ${String(row.nodes).padStart(4)} nodes  `
                + `${row.events} event(s)  ${row.ownerKey}`,
        )
        .join("\n");
    io.out(
        `${table}\n\n${rows.length} shown of ${all.length}; `
            + `${all.filter(row => row.nodes > 0).length} carry a graph (--with-graphs).`,
    );
    return 0;
}

function commandShow(args: Args, io: CliIo): number {
    const projectDir = requireProject(args);
    loadSaveSchema(projectDir);
    const file = readUiGraphs(projectDir);
    const wanted = stringFlag(args, "blueprint");
    const ownerKey = stringFlag(args, "owner");
    let blueprints = Object.values(file.blueprintDocument.blueprints);
    if (wanted) {
        blueprints = matchBlueprints(blueprints, wanted);
    }
    if (ownerKey) {
        const needle = ownerKey.toLowerCase();
        blueprints = blueprints.filter(item =>
            ownerRefToIndexKey(item.owner).toLowerCase().includes(needle),
        );
    }
    if (blueprints.length === 0) {
        io.err("No blueprint matches. Run `blueprint list --project <dir>` to see what is there.");
        return 2;
    }
    const printed = printBlueprints(blueprints);
    for (const diagnostic of printed.diagnostics) {
        io.err(`${diagnostic.severity}  ${diagnostic.code}  ${diagnostic.message}`);
    }
    const out = args.flags.out;
    if (out === undefined) {
        io.out(printed.text.trimEnd());
        return 0;
    }
    const fileName =
        typeof out === "string" && out.length > 0
            ? out
            : scratchFileNameFor(blueprints.length === 1 ? blueprints[0].name : (wanted ?? "blueprints"));
    const outPath = resolveBlueprintFile(fileName, { forWriting: true });
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, printed.text, "utf8");
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
    }
    const variables = projectDir ? readVariableRegistry(projectDir) : { persistent: [], saved: [] };

    if (!given) {
        if (!projectDir) {
            throw new UsageError("Give a file to check, or --project <dir> to check a whole project.");
        }
        const file = readUiGraphs(projectDir);
        const targets = readUiDocumentTargets(projectDir);
        const diagnostics = checkProjectDocument(file.blueprintDocument, {
            persistentVariables: variables.persistent,
            savedVariables: variables.saved,
            resolveWidgetElement: widgetElementResolver(targets),
            uiElements: targets.raw as Readonly<Record<string, UIElement>>,
        });
        io.out(
            args.flags.json === true
                ? JSON.stringify(diagnostics, null, 2)
                : formatDiagnostics(diagnostics, { fileName: file.filePath }),
        );
        return diagnostics.some(item => item.severity === "error") ? 1 : 0;
    }

    const resolved = resolveBlueprintFile(given, { forWriting: false });
    const source = readTextFile(resolved);
    const result = checkBlueprintSource(source, {
        existing: projectDir ? readUiGraphs(projectDir).blueprintDocument : null,
        persistentVariables: variables.persistent,
        savedVariables: variables.saved,
        resolveWidgetElementType: projectDir
            ? widgetElementTypeResolver(readUiDocumentTargets(projectDir))
            : undefined,
        resolveElementType: projectDir ? elementTypeResolver(readUiDocumentTargets(projectDir)) : undefined,
        resolveWidgetElement: projectDir
            ? widgetElementResolver(readUiDocumentTargets(projectDir))
            : undefined,
        uiElements: projectDir
            ? readUiDocumentTargets(projectDir).raw as Readonly<Record<string, UIElement>>
            : undefined,
    });
    io.out(
        args.flags.json === true
            ? JSON.stringify(result.diagnostics, null, 2)
            : formatDiagnostics(result.diagnostics, { fileName: reportPath(resolved), source }),
    );
    return result.ok ? 0 : 1;
}

function commandApply(args: Args, io: CliIo): number {
    const given = args.positional[0];
    if (!given) {
        throw new UsageError("Which file? `blueprint apply <file.bp> --project <dir> --write`.");
    }
    const projectDir = requireProject(args);
    loadSaveSchema(projectDir);
    const resolved = resolveBlueprintFile(given, { forWriting: false });
    const source = readTextFile(resolved);
    const file = readUiGraphs(projectDir);
    const variables = readVariableRegistry(projectDir);
    const result = checkBlueprintSource(source, {
        existing: file.blueprintDocument,
        persistentVariables: variables.persistent,
        savedVariables: variables.saved,
        resolveWidgetElementType: widgetElementTypeResolver(readUiDocumentTargets(projectDir)),
        resolveElementType: elementTypeResolver(readUiDocumentTargets(projectDir)),
        resolveWidgetElement: widgetElementResolver(readUiDocumentTargets(projectDir)),
        uiElements: readUiDocumentTargets(projectDir).raw as Readonly<Record<string, UIElement>>,
    });
    const report = formatDiagnostics(result.diagnostics, {
        fileName: reportPath(resolved),
        source,
    });
    if (!result.ok) {
        io.err(report);
        io.err("Nothing was written.");
        return 1;
    }
    if (result.diagnostics.length > 0) {
        io.err(report);
    }

    assertWritableSchema(file);
    const applied = applyBlueprints(file, result.blueprints, {
        ...Object.fromEntries(
            result.blueprints.map(blueprint => [
                ownerRefToIndexKey(blueprint.owner),
                { blueprintId: blueprint.id },
            ]),
        ),
    });
    const what = [
        applied.added.length > 0 ? `add ${quoteAll(applied.added)}` : null,
        applied.replaced.length > 0 ? `replace ${quoteAll(applied.replaced)}` : null,
    ]
        .filter(Boolean)
        .join(", and ");
    if (args.flags.write !== true) {
        io.out(`Would ${what || "change nothing"} in ${file.filePath}. Pass --write to do it.`);
        return 0;
    }
    writeUiGraphs(file);
    io.out(
        `Wrote ${file.filePath}: ${what || "no change"}.\n`
            + "Studio does not reload this file on its own - if the project is open, close and reopen it, "
            + "and do not write while it is open or the next save will overwrite this.",
    );
    return 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The blueprints a `--blueprint` value names.
 *
 * An id or a whole name first, so an exact answer is never widened. Falling back to a
 * case-insensitive part of a name is what makes `--blueprint quit` work, and printing both
 * blueprints when two matched is more use than printing neither.
 */
function matchBlueprints(blueprints: readonly Blueprint[], wanted: string): Blueprint[] {
    const exact = blueprints.filter(item => item.id === wanted || item.name === wanted);
    if (exact.length > 0) {
        return exact;
    }
    const needle = wanted.toLowerCase();
    return blueprints.filter(item => item.name.toLowerCase().includes(needle));
}

function quoteAll(names: readonly string[]): string {
    return names.map(name => `"${name}"`).join(", ");
}

function countGraphs(blueprint: Blueprint, kind: "events" | "functions"): number {
    return Object.keys(blueprint.graphs[kind] ?? {}).length;
}

function countNodes(blueprint: Blueprint): number {
    const graphs = blueprint.graphs;
    let total = 0;
    for (const pool of [graphs.events, graphs.functions]) {
        for (const graph of Object.values(pool ?? {})) {
            total += Object.keys(graph.graph?.nodes ?? {}).length;
        }
    }
    return total;
}

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
