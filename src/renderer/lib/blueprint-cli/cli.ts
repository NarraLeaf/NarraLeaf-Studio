/**
 * Command surface for `project/app/blueprint.js`.
 *
 * Kept apart from the Node wrapper that bundles it so the commands can be tested directly, and so
 * everything that touches the filesystem sits in one file rather than being spread through the
 * parser and the compiler.
 *
 * Comments in English per project convention.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Blueprint } from "@shared/types/blueprint/document";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes";
import { ownerRefToIndexKey } from "@services/ui-editor/blueprint/ownerKeys";
import { describeNode, formatNodeDetail, formatNodeList, listNodeCategories, queryNodes } from "./catalog";
import { checkBlueprintSource, checkProjectDocument, formatDiagnostics } from "./check";
import { printBlueprint, printBlueprints } from "./dsl/print";
import {
    applyBlueprints,
    assertWritableSchema,
    loadSaveSchema,
    ProjectIoError,
    readUiDocumentTargets,
    readUiGraphs,
    readVariableRegistry,
    resolveProjectDir,
    widgetElementResolver,
    widgetElementTypeResolver,
    writeUiGraphs,
} from "./project";

export type CliIo = {
    out: (text: string) => void;
    err: (text: string) => void;
};

const USAGE = `blueprint - query the node catalogue, write blueprints as text, check them.

  nodes [search words]        List node types. --category --graph-kind --owner --widget --all --limit
  node <type>                 Everything about one node type: pins, fields, scope.
  categories                  Node categories and how many nodes each holds.

  targets                     Surfaces and elements of a project, for owner= lines. Needs --project.
  list                        Blueprints a project holds. Needs --project.
  show                        Print a project's blueprints in the text format. Needs --project.
                              --blueprint <name|id> --owner <ownerKey> --out <file>
  check [file.bp]             Check a text file, or the whole project when given no file.
  apply <file.bp>             Compile a text file into the project. Needs --project.
                              Writes nothing without --write.

Common flags
  --project <dir>             Project directory (the one holding editor/ui/uigraphs.json).
  --json                      Machine-readable output.

Exit codes: 0 clean, 1 problems found, 2 bad usage or unreadable input.`;

type Args = {
    command: string;
    positional: string[];
    flags: Record<string, string | boolean>;
};

export function runCli(argv: readonly string[], io: CliIo): number {
    registerCoreBlueprintNodes();
    const args = parseArgs(argv);
    if (!args.command || args.flags.help === true || args.command === "help") {
        io.out(USAGE);
        return args.command ? 0 : 2;
    }
    try {
        switch (args.command) {
            case "nodes":
                return commandNodes(args, io);
            case "node":
                return commandNode(args, io);
            case "categories":
                return commandCategories(args, io);
            case "targets":
                return commandTargets(args, io);
            case "list":
                return commandList(args, io);
            case "show":
                return commandShow(args, io);
            case "check":
                return commandCheck(args, io);
            case "apply":
                return commandApply(args, io);
            default:
                io.err(`Unknown command "${args.command}".`);
                io.out(USAGE);
                return 2;
        }
    } catch (error) {
        if (error instanceof ProjectIoError) {
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
    const nodes = queryNodes({
        search: args.positional.join(" ") || undefined,
        category: stringFlag(args, "category"),
        graphKind: stringFlag(args, "graph-kind") as "event" | "function" | "macro" | undefined,
        ownerKind: stringFlag(args, "owner") as never,
        widgetElementType: stringFlag(args, "widget"),
        includeHidden: args.flags.all === true,
        limit: numberFlag(args, "limit"),
    });
    io.out(args.flags.json === true ? JSON.stringify(nodes, null, 2) : formatNodeList(nodes));
    return 0;
}

function commandNode(args: Args, io: CliIo): number {
    const type = args.positional[0];
    if (!type) {
        io.err("Which node type? `blueprint node <type>`.");
        return 2;
    }
    const detail = describeNode(type);
    if (!detail) {
        io.err(`No node type "${type}".`);
        const near = queryNodes({ search: type, includeHidden: true, limit: 8 });
        if (near.length > 0) {
            io.err(`Close by: ${near.map(node => node.type).join(", ")}`);
        }
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
    const lines: string[] = [];
    for (const surface of targets.surfaces) {
        lines.push(`${surface.name}  owner=surfaceMain surface=${surface.id}`);
        for (const element of targets.elements.filter(item => item.surfaceId === surface.id)) {
            lines.push(
                `    ${element.path}  [${element.type}]  owner=widgetMain surface=${surface.id} `
                    + `element=${element.id}`,
            );
        }
        lines.push("");
    }
    io.out(lines.join("\n").trimEnd() || "This project declares no surfaces.");
    return 0;
}

function commandList(args: Args, io: CliIo): number {
    const projectDir = requireProject(args);
    const file = readUiGraphs(projectDir);
    const rows = Object.values(file.blueprintDocument.blueprints).map(blueprint => ({
        id: blueprint.id,
        name: blueprint.name,
        ownerKey: ownerRefToIndexKey(blueprint.owner),
        programKind: blueprint.programKind,
        events: countGraphs(blueprint, "events"),
        functions: countGraphs(blueprint, "functions"),
        nodes: countNodes(blueprint),
    }));
    rows.sort((a, b) => a.ownerKey.localeCompare(b.ownerKey));
    if (args.flags.json === true) {
        io.out(JSON.stringify(rows, null, 2));
        return 0;
    }
    if (rows.length === 0) {
        io.out("This project holds no blueprints.");
        return 0;
    }
    const nameWidth = Math.max(...rows.map(row => row.name.length));
    io.out(
        rows
            .map(
                row =>
                    `${row.name.padEnd(nameWidth)}  ${String(row.nodes).padStart(4)} nodes  `
                    + `${row.events} event(s)  ${row.ownerKey}`,
            )
            .join("\n"),
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
        blueprints = blueprints.filter(item => item.id === wanted || item.name === wanted);
    }
    if (ownerKey) {
        blueprints = blueprints.filter(item => ownerRefToIndexKey(item.owner) === ownerKey);
    }
    if (blueprints.length === 0) {
        io.err("No blueprint matches. Run `blueprint list --project <dir>` to see what is there.");
        return 2;
    }
    const printed = printBlueprints(blueprints);
    for (const diagnostic of printed.diagnostics) {
        io.err(`${diagnostic.severity}  ${diagnostic.code}  ${diagnostic.message}`);
    }
    const outPath = stringFlag(args, "out");
    if (outPath) {
        fs.writeFileSync(path.resolve(outPath), printed.text, "utf8");
        io.out(`Wrote ${blueprints.length} blueprint(s) to ${path.resolve(outPath)}.`);
        return 0;
    }
    io.out(printed.text.trimEnd());
    return 0;
}

function commandCheck(args: Args, io: CliIo): number {
    const filePath = args.positional[0];
    const projectDir = stringFlag(args, "project") ? requireProject(args) : null;
    if (projectDir) {
        loadSaveSchema(projectDir);
    }
    const variables = projectDir ? readVariableRegistry(projectDir) : { persistent: [], saved: [] };

    if (!filePath) {
        if (!projectDir) {
            io.err("Give a file to check, or --project <dir> to check a whole project.");
            return 2;
        }
        const file = readUiGraphs(projectDir);
        const targets = readUiDocumentTargets(projectDir);
        const diagnostics = checkProjectDocument(file.blueprintDocument, {
            persistentVariables: variables.persistent,
            savedVariables: variables.saved,
            resolveWidgetElement: widgetElementResolver(targets),
        });
        io.out(
            args.flags.json === true
                ? JSON.stringify(diagnostics, null, 2)
                : formatDiagnostics(diagnostics, { fileName: file.filePath }),
        );
        return diagnostics.some(item => item.severity === "error") ? 1 : 0;
    }

    const resolved = path.resolve(filePath);
    const source = readTextFile(resolved);
    const result = checkBlueprintSource(source, {
        existing: projectDir ? readUiGraphs(projectDir).blueprintDocument : null,
        persistentVariables: variables.persistent,
        savedVariables: variables.saved,
        resolveWidgetElementType: projectDir
            ? widgetElementTypeResolver(readUiDocumentTargets(projectDir))
            : undefined,
        resolveWidgetElement: projectDir
            ? widgetElementResolver(readUiDocumentTargets(projectDir))
            : undefined,
    });
    io.out(
        args.flags.json === true
            ? JSON.stringify(result.diagnostics, null, 2)
            : formatDiagnostics(result.diagnostics, { fileName: path.relative(process.cwd(), resolved), source }),
    );
    return result.ok ? 0 : 1;
}

function commandApply(args: Args, io: CliIo): number {
    const filePath = args.positional[0];
    if (!filePath) {
        io.err("Which file? `blueprint apply <file.bp> --project <dir> --write`.");
        return 2;
    }
    const projectDir = requireProject(args);
    loadSaveSchema(projectDir);
    const resolved = path.resolve(filePath);
    const source = readTextFile(resolved);
    const file = readUiGraphs(projectDir);
    const variables = readVariableRegistry(projectDir);
    const result = checkBlueprintSource(source, {
        existing: file.blueprintDocument,
        persistentVariables: variables.persistent,
        savedVariables: variables.saved,
        resolveWidgetElementType: widgetElementTypeResolver(readUiDocumentTargets(projectDir)),
        resolveWidgetElement: widgetElementResolver(readUiDocumentTargets(projectDir)),
    });
    const report = formatDiagnostics(result.diagnostics, {
        fileName: path.relative(process.cwd(), resolved),
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
                { activeBlueprintId: blueprint.id, privateBlueprintIds: [blueprint.id] },
            ]),
        ),
    });
    if (args.flags.write !== true) {
        io.out(
            `Would add ${applied.added.length} and replace ${applied.replaced.length} blueprint(s) in `
                + `${file.filePath}. Pass --write to do it.`,
        );
        return 0;
    }
    writeUiGraphs(file);
    io.out(
        `Wrote ${file.filePath}: added ${applied.added.length}, replaced ${applied.replaced.length}.\n`
            + "Studio does not reload this file on its own - if the project is open, close and reopen it, "
            + "and do not write while it is open or the next save will overwrite this.",
    );
    return 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countGraphs(blueprint: Blueprint, kind: "events" | "functions"): number {
    if (blueprint.program.kind !== "graph") {
        return 0;
    }
    return Object.keys(blueprint.program.graphs[kind] ?? {}).length;
}

function countNodes(blueprint: Blueprint): number {
    if (blueprint.program.kind !== "graph") {
        return 0;
    }
    const graphs = blueprint.program.graphs;
    let total = 0;
    for (const pool of [graphs.events, graphs.functions]) {
        for (const graph of Object.values(pool ?? {})) {
            total += Object.keys(graph.graph?.nodes ?? {}).length;
        }
    }
    return total;
}

function readTextFile(filePath: string): string {
    try {
        return fs.readFileSync(filePath, "utf8");
    } catch (error) {
        throw new ProjectIoError(`Cannot read ${filePath}: ${(error as Error).message}`);
    }
}

function requireProject(args: Args): string {
    const dir = stringFlag(args, "project");
    if (!dir) {
        throw new ProjectIoError("This command needs --project <dir>.");
    }
    return resolveProjectDir(dir);
}

function stringFlag(args: Args, name: string): string | undefined {
    const value = args.flags[name];
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberFlag(args: Args, name: string): number | undefined {
    const value = stringFlag(args, name);
    if (value === undefined) {
        return undefined;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseArgs(argv: readonly string[]): Args {
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

export { printBlueprint, USAGE };
