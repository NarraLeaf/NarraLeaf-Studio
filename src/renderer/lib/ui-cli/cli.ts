/**
 * Command surface for `project/app/ui.js`.
 *
 * Kept apart from the Node wrapper that bundles it so the commands can be tested directly, and so
 * everything that touches the filesystem sits in one file rather than being spread through the
 * parser, the compiler and the catalogue.
 *
 * This tool owns `editor/ui/uidoc.json` and reads `uigraphs.json` without ever writing it. Attaching
 * a graph to a widget is `blueprint apply`'s job, and the seam between the two is the element id: a
 * `.ui` file names its own ids, so the blueprint that hangs off an element can be written before or
 * after the element itself.
 *
 * Comments in English per project convention.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
    describeWidget,
    formatStructs,
    formatWidgetDetail,
    formatWidgetList,
    listBuiltinStructs,
    nearestWidgetTypes,
    queryWidgets,
} from "./catalog";
import { applyCompiled, formatApplyResult } from "./apply";
import { checkProjectDocument, checkUiSource, formatDiagnostics } from "./check";
import { printUiDocument } from "./dsl/print";
import {
    assertWritableSchema,
    collectTree,
    elementPath,
    findComponent,
    findSurface,
    ProjectIoError,
    readBlueprintIndex,
    readUiDocument,
    resolveProjectDir,
    writeUiDocument,
    type BlueprintIndex,
} from "./project";
import { findUsages, formatPropValues, formatUsages, readSkeletonDocument } from "./usage";

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

  surfaces                    Surfaces, components and the owner= lines blueprint needs. Needs --project.
  show                        Print a project's interface in the text format. Needs --project.
                              --surface <name|id> --component <name|id> --out <file>
  check [file.ui]             Check a text file, or the whole project when given no file.
  apply <file.ui>             Compile a text file into the project. Needs --project.
                              Writes nothing without --write.

Common flags
  --project <dir>             Project directory (the one holding editor/ui/uidoc.json).
  --json                      Machine-readable output.

Exit codes: 0 clean, 1 problems found, 2 bad usage or unreadable input.`;

type Args = {
    command: string;
    positional: string[];
    flags: Record<string, string | boolean>;
};

export function runCli(argv: readonly string[], io: CliIo): number {
    const args = parseArgs(argv);
    if (!args.command || args.flags.help === true || args.command === "help") {
        io.out(USAGE);
        return args.command ? 0 : 2;
    }
    try {
        switch (args.command) {
            case "widgets":
                return commandWidgets(args, io);
            case "widget":
                return commandWidget(args, io);
            case "structs":
                return commandStructs(args, io);
            case "usage":
                return commandUsage(args, io);
            case "surfaces":
                return commandSurfaces(args, io);
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

function commandWidgets(args: Args, io: CliIo): number {
    // A slot only exists on a stage surface, so naming one says which kind of surface this is even
    // when the caller did not spell it out.
    const stageSlot = stringFlag(args, "slot");
    const widgets = queryWidgets({
        search: args.positional.join(" ") || undefined,
        insertableOnly: args.flags.insertable === true,
        surfaceKind: stringFlag(args, "surface-kind") ?? (stageSlot ? "stageSurface" : undefined),
        stageSlot,
    });
    io.out(args.flags.json === true ? JSON.stringify(widgets, null, 2) : formatWidgetList(widgets));
    return 0;
}

function commandWidget(args: Args, io: CliIo): number {
    const type = args.positional[0];
    if (!type) {
        io.err("Which widget type? `ui widget <type>`.");
        return 2;
    }
    const detail = describeWidget(type);
    if (!detail) {
        io.err(`No widget type "${type}".`);
        const near = nearestWidgetTypes(type);
        io.err(near.length > 0 ? `Close by: ${near.join(", ")}` : "Run `ui widgets` for the catalogue.");
        return 2;
    }
    io.out(args.flags.json === true ? JSON.stringify(detail, null, 2) : formatWidgetDetail(detail));
    return 0;
}

function commandStructs(args: Args, io: CliIo): number {
    const structs = [...listBuiltinStructs()];
    const projectDir = optionalProject(args);
    if (projectDir) {
        structs.push(...Object.values(readUiDocument(projectDir).document.structs ?? {}));
    }
    io.out(args.flags.json === true ? JSON.stringify(structs, null, 2) : formatStructs(structs));
    return 0;
}

function commandUsage(args: Args, io: CliIo): number {
    const type = args.positional[0];
    if (!type) {
        io.err("Which widget type? `ui usage <type>`.");
        return 2;
    }
    const projectDir = optionalProject(args);
    const document = projectDir ? readUiDocument(projectDir).document : readSkeletonDocument(repoRoot());
    if (!document) {
        io.err(
            "No interface to read. Pass --project, or run this from the repository so the shipped skeleton "
                + "template can be found.",
        );
        return 2;
    }
    const sites = findUsages(document, type);
    if (args.flags.json === true) {
        io.out(JSON.stringify(sites.map(site => ({ owner: site.owner, path: site.path, element: site.element })), null, 2));
        return 0;
    }
    const prop = stringFlag(args, "prop");
    io.out(
        prop
            ? formatPropValues(sites, prop)
            : formatUsages(sites, numberFlag(args, "limit") ?? 3, { withoutChildren: args.flags.shallow === true }),
    );
    return 0;
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

function commandSurfaces(args: Args, io: CliIo): number {
    const projectDir = requireProject(args);
    const { document } = readUiDocument(projectDir);
    const blueprints = readBlueprintIndex(projectDir);
    if (args.flags.json === true) {
        io.out(JSON.stringify({ surfaces: document.surfaces, components: document.components ?? [] }, null, 2));
        return 0;
    }
    const lines: string[] = [];
    for (const surface of document.surfaces) {
        const mount = surface.kind === "stageSurface" ? ` slot=${surface.mount.slotId}` : "";
        const answers = (surface.actions ?? []).map(action => action.actionId).join(", ");
        lines.push(
            `${surface.name}  ${surface.kind}${mount}  ${surface.designSize.width}x${surface.designSize.height}`
                + `${answers ? `  answers ${answers}` : ""}`,
        );
        lines.push(`    owner=surfaceMain surface=${surface.id}`);
        for (const element of collectTree(document.elements, surface.rootElementId)) {
            lines.push(
                `    ${elementPath(document.elements, element)}  [${element.type}]`
                    + `  owner=widgetMain surface=${surface.id} element=${element.id}`
                    + describeAttached(blueprints, element.id),
            );
        }
        lines.push("");
    }
    for (const component of document.components ?? []) {
        const params = (component.params ?? []).map(param => `${param.id}="${param.defaultValue}"`).join(" ");
        lines.push(`${component.name}  component=${component.id}  (${params || "no params"})`);
        const pool = component.elements ?? {};
        for (const element of collectTree(pool, component.rootElementId)) {
            lines.push(
                `    ${elementPath(pool, element)}  [${element.type}]`
                    + `  owner=componentWidgetMain component=${component.id} element=${element.id}`
                    + describeAttached(blueprints, element.id),
            );
        }
        lines.push("");
    }
    io.out(lines.join("\n").trimEnd() || "This project declares no surfaces.");
    return 0;
}

function describeAttached(blueprints: BlueprintIndex, elementId: string): string {
    const attached = blueprints.byElement.get(elementId) ?? [];
    return attached.length > 0 ? `  # ${attached.map(item => item.name).join(", ")}` : "";
}

function commandShow(args: Args, io: CliIo): number {
    const projectDir = requireProject(args);
    const { document } = readUiDocument(projectDir);
    const blueprints = readBlueprintIndex(projectDir);
    const surfaceName = stringFlag(args, "surface");
    const componentName = stringFlag(args, "component");
    let surfaceIds: string[] | undefined;
    let componentIds: string[] | undefined;
    if (surfaceName) {
        const surface = findSurface(document, surfaceName);
        if (!surface) {
            io.err(`No surface "${surfaceName}". Run \`ui surfaces --project ${projectDir}\`.`);
            return 2;
        }
        surfaceIds = [surface.id];
        componentIds = [];
    }
    if (componentName) {
        const component = findComponent(document, componentName);
        if (!component) {
            io.err(`No component "${componentName}". Run \`ui surfaces --project ${projectDir}\`.`);
            return 2;
        }
        componentIds = [component.id];
        surfaceIds = surfaceIds ?? [];
    }
    const text = printUiDocument(document, {
        surfaceIds,
        componentIds,
        includeSharedTables: !surfaceName && !componentName,
        blueprintsByElement: blueprints.byElement,
    });
    const out = stringFlag(args, "out");
    if (out) {
        fs.writeFileSync(path.resolve(out), text, "utf8");
        io.out(`Wrote ${path.resolve(out)}.`);
        return 0;
    }
    io.out(text);
    return 0;
}

function commandCheck(args: Args, io: CliIo): number {
    const file = args.positional[0];
    if (!file) {
        // No file means "check what is already there", which needs the project and nothing else.
        const projectDir = requireProject(args);
        const documentFile = readUiDocument(projectDir);
        const diagnostics = checkProjectDocument(documentFile.document, readBlueprintIndex(projectDir));
        io.out(formatDiagnostics(diagnostics, { fileName: documentFile.filePath }));
        return diagnostics.some(item => item.severity === "error") ? 1 : 0;
    }

    const projectDir = optionalProject(args);
    const documentFile = projectDir ? readUiDocument(projectDir) : null;
    const blueprints = projectDir ? readBlueprintIndex(projectDir) : null;
    const source = readSource(file);
    const result = checkUiSource(source, { existing: documentFile?.document ?? null, blueprints });
    io.out(formatDiagnostics(result.diagnostics, { fileName: file, source }));
    if (!projectDir) {
        io.out(
            "\nNo --project: bindings, components and dropped elements were not checked, because none of them "
                + "can be answered without the document this file is going into.",
        );
    }
    return result.ok ? 0 : 1;
}

function commandApply(args: Args, io: CliIo): number {
    const file = args.positional[0];
    if (!file) {
        io.err("Which file? `ui apply <file.ui> --project <dir>`.");
        return 2;
    }
    const projectDir = requireProject(args);
    const documentFile = readUiDocument(projectDir);
    const blueprints = readBlueprintIndex(projectDir);
    const source = readSource(file);
    const result = checkUiSource(source, { existing: documentFile.document, blueprints });
    io.out(formatDiagnostics(result.diagnostics, { fileName: file, source }));
    if (!result.ok || !result.compiled) {
        io.err("Nothing written.");
        return 1;
    }
    assertWritableSchema(documentFile);
    const applied = applyCompiled(documentFile.document, result.compiled);
    if (args.flags.write === true) {
        writeUiDocument(documentFile);
    }
    io.out("");
    io.out(formatApplyResult(applied, args.flags.write === true));
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

/** The repository this tool was bundled from, set by the wrapper so `usage` can find the skeleton. */
function repoRoot(): string {
    return process.env.NLS_UI_CLI_ROOT ?? process.cwd();
}

function readSource(file: string): string {
    try {
        return fs.readFileSync(path.resolve(file), "utf8");
    } catch (error) {
        throw new ProjectIoError(`Cannot read ${file}: ${(error as Error).message}`);
    }
}

function requireProject(args: Args): string {
    const dir = stringFlag(args, "project");
    if (!dir) {
        throw new ProjectIoError("This command needs --project <dir>.");
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

function numberFlag(args: Args, name: string): number | undefined {
    const value = stringFlag(args, name);
    return value === undefined ? undefined : Number(value);
}

function parseArgs(argv: readonly string[]): Args {
    const positional: string[] = [];
    const flags: Record<string, string | boolean> = {};
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        if (!token.startsWith("--")) {
            positional.push(token);
            continue;
        }
        const name = token.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
            flags[name] = next;
            i += 1;
            continue;
        }
        flags[name] = true;
    }
    return { command: positional.shift() ?? "", positional, flags };
}
