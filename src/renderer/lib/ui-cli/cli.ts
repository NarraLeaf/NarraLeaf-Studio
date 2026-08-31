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
 * This tool owns `editor/ui/uidoc.json` and reads `uigraphs.json` without ever writing it. Attaching
 * a graph to a widget is `blueprint apply`'s job, and the seam between the two is the element id: a
 * `.ui` file names its own ids, so the blueprint that hangs off an element can be written before or
 * after the element itself.
 *
 * Comments in English per project convention.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { SCRATCH_DIR_NAME } from "../blueprint-cli/project";
import {
    describeWidget,
    formatStructs,
    formatWidgetDetail,
    formatWidgetList,
    listBuiltinStructs,
    nearestWidgetTypes,
    queryWidgets,
    WIDGET_STAGE_SLOTS,
    WIDGET_SURFACE_KINDS,
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
    resolveUiFile,
    scratchFileNameFor,
    writeUiDocument,
    type BlueprintIndex,
} from "./project";
import { didYouMean } from "./text";
import { findUsages, formatPropValues, formatUsages, readSkeletonDocument, repoRoot } from "./usage";

export type CliIo = {
    out: (text: string) => void;
    err: (text: string) => void;
};

/** How many occurrences a bare `usage` prints before it says only how many more there are. */
const DEFAULT_USAGE_LIMIT = 3;

const USAGE = `ui - query the widget catalogue, read an interface, write one as text.

  widgets [search words]      List widget types. --insertable --surface-kind --slot
  widget <type>               Everything about one type: props, bindable props, events, parts.
  structs                     The list-item shapes that ship with Studio. --project adds a project's.
  usage <type>                How the shipped skeleton uses this widget.
                              --project --prop <key> --limit <n> --shallow

  surfaces [search]           Surfaces, components and the owner= lines blueprint wants. Needs --project.
  show                        Print a project's interface in the text format. Needs --project.
                              --surface <name|id> --component <name|id> --out [file]
  check [file.ui]             Check a text file, or the whole project when given no file.
  apply <file.ui>             Compile a text file into the project. Needs --project.
                              Writes nothing without --write.

Common flags
  --project <dir>             Project directory (the one holding editor/ui/uidoc.json).
  --json                      Machine-readable output.

A file named without a directory - title.ui rather than ./title.ui - lives in ${SCRATCH_DIR_NAME}/ at the
root of this checkout, which git ignores. So the editing loop is three commands and one short name:

  show --project <dir> --surface Title --out title.ui
  check title.ui --project <dir>
  apply title.ui --project <dir> --write

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
        flags: { project: "string", surface: "string", component: "string", out: "string" },
        run: commandShow,
    },
    check: { flags: { project: "string" }, run: commandCheck },
    apply: { flags: { project: "string", write: "boolean" }, run: commandApply },
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

function commandWidgets(args: Args, io: CliIo): number {
    // A slot only exists on a stage surface, so naming one says which kind of surface this is even
    // when the caller did not spell it out.
    const stageSlot = enumFlag(args, "slot", WIDGET_STAGE_SLOTS);
    const widgets = queryWidgets({
        search: args.positional.join(" ") || undefined,
        insertableOnly: args.flags.insertable === true,
        surfaceKind:
            enumFlag(args, "surface-kind", WIDGET_SURFACE_KINDS) ?? (stageSlot ? "stageSurface" : undefined),
        stageSlot,
    });
    io.out(args.flags.json === true ? JSON.stringify(widgets, null, 2) : formatWidgetList(widgets));
    return 0;
}

function commandWidget(args: Args, io: CliIo): number {
    const type = args.positional.join(" ");
    if (!type) {
        throw new UsageError("Which widget type? `ui widget <type>`.");
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
    const sites = findUsages(document, type);
    if (args.flags.json === true) {
        io.out(
            JSON.stringify(
                sites.map(site => ({ owner: site.owner, path: site.path, element: site.element })),
                null,
                2,
            ),
        );
        return 0;
    }
    const prop = stringFlag(args, "prop");
    if (prop) {
        io.out(formatPropValues(sites, prop));
        return 0;
    }
    io.out(
        formatUsages(sites, numberFlag(args, "limit") ?? DEFAULT_USAGE_LIMIT, {
            withoutChildren: args.flags.shallow === true,
        }),
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
    // A project of any size has hundreds of elements, and the one being looked for usually has a
    // name already. The search word matches a surface, a component, an element path or a type.
    const search = args.positional.join(" ").toLowerCase();
    const matches = (...text: string[]): boolean =>
        search.length === 0 || text.some(item => item.toLowerCase().includes(search));

    const lines: string[] = [];
    let hidden = 0;
    for (const surface of document.surfaces) {
        const mount = surface.kind === "stageSurface" ? ` slot=${surface.mount.slotId}` : "";
        const answers = (surface.actions ?? []).map(action => action.actionId).join(", ");
        const wholeSurface = matches(surface.name, surface.id);
        const elements = collectTree(document.elements, surface.rootElementId)
            .map(element => ({ element, path: elementPath(document.elements, element) }))
            .filter(entry => wholeSurface || matches(entry.path, entry.element.type, entry.element.id));
        if (elements.length === 0 && !wholeSurface) {
            hidden += 1;
            continue;
        }
        lines.push(
            `${surface.name}  ${surface.kind}${mount}  ${surface.designSize.width}x${surface.designSize.height}`
                + `${answers ? `  answers ${answers}` : ""}`,
        );
        lines.push(`    owner=surfaceMain surface=${surface.id}`);
        for (const entry of elements) {
            lines.push(
                `    ${entry.path}  [${entry.element.type}]`
                    + `  owner=widgetMain surface=${surface.id} element=${entry.element.id}`
                    + describeAttached(blueprints, entry.element.id),
            );
        }
        lines.push("");
    }
    for (const component of document.components ?? []) {
        const params = (component.params ?? []).map(param => `${param.id}="${param.defaultValue}"`).join(" ");
        const pool = component.elements ?? {};
        const wholeComponent = matches(component.name, component.id);
        const elements = collectTree(pool, component.rootElementId)
            .map(element => ({ element, path: elementPath(pool, element) }))
            .filter(entry => wholeComponent || matches(entry.path, entry.element.type, entry.element.id));
        if (elements.length === 0 && !wholeComponent) {
            hidden += 1;
            continue;
        }
        lines.push(`${component.name}  component=${component.id}  (${params || "no params"})`);
        for (const entry of elements) {
            lines.push(
                `    ${entry.path}  [${entry.element.type}]`
                    + `  owner=componentWidgetMain component=${component.id} element=${entry.element.id}`
                    + describeAttached(blueprints, entry.element.id),
            );
        }
        lines.push("");
    }
    if (hidden > 0) {
        lines.push(`${hidden} surface(s) and component definition(s) matched nothing and are not listed.`);
    }
    io.out(lines.join("\n").trimEnd() || "Nothing matched.");
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
    let subject = document.name || "interface";
    if (surfaceName) {
        const surface = findSurface(document, surfaceName);
        if (!surface) {
            io.err(`No surface "${surfaceName}". Run \`ui surfaces --project ${projectDir}\`.`);
            return 2;
        }
        surfaceIds = [surface.id];
        componentIds = [];
        subject = surface.name;
    }
    if (componentName) {
        const component = findComponent(document, componentName);
        if (!component) {
            io.err(`No component "${componentName}". Run \`ui surfaces --project ${projectDir}\`.`);
            return 2;
        }
        componentIds = [component.id];
        surfaceIds = surfaceIds ?? [];
        subject = component.name;
    }
    const text = printUiDocument(document, {
        surfaceIds,
        componentIds,
        includeSharedTables: !surfaceName && !componentName,
        blueprintsByElement: blueprints.byElement,
    });

    const out = args.flags.out;
    if (out === undefined) {
        io.out(text.trimEnd());
        return 0;
    }
    const fileName = typeof out === "string" && out.length > 0 ? out : scratchFileNameFor(subject);
    const outPath = resolveUiFile(fileName, { forWriting: true });
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, text, "utf8");
    io.out(`Wrote ${outPath}.\nEdit it, then: ui check ${path.basename(outPath)} --project <dir>`);
    return 0;
}

function commandCheck(args: Args, io: CliIo): number {
    const given = args.positional[0];
    if (!given) {
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
    const file = resolveUiFile(given, { forWriting: false });
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
    const given = args.positional[0];
    if (!given) {
        throw new UsageError("Which file? `ui apply <file.ui> --project <dir>`.");
    }
    const projectDir = requireProject(args);
    const documentFile = readUiDocument(projectDir);
    const blueprints = readBlueprintIndex(projectDir);
    const file = resolveUiFile(given, { forWriting: false });
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

export { COMMANDS, USAGE };
