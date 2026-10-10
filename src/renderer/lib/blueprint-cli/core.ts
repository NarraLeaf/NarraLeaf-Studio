/**
 * The bodies of the `blueprint` commands, as functions of documents.
 *
 * `cli.ts` reads the project off disk and writes what comes back; Studio's agent bridge passes the
 * live documents and hands the same text to an agent. The node catalogue is the shared
 * `blueprintNodeRegistry` in both: the command line seeds it with the core nodes and the bundled
 * plugins' (`registerCoreBlueprintNodes`, `registerBuiltInPluginBlueprintNodes`), and in Studio
 * `BlueprintNodeCatalogService` stores every node - plugin ones included - in that same registry. Who
 * owns a node is the one thing the registry does not record, so it is passed in (`nodeOwnerOf`).
 *
 * Flag validation stays with the command line; a body takes values that are already in range.
 *
 * Comments in English per project convention.
 */

import { listScriptLayers } from "@shared/blueprint/blueprintLayers";
import type { Blueprint, BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIElement } from "@shared/types/ui-editor/document";
import { getUIPageParams } from "@shared/types/ui-editor/pageParams";
import { ownerRefToIndexKey } from "@services/ui-editor/blueprint/ownerKeys";
import { commandWriter, type CommandResult } from "../agent-core/commandResult";
import {
    describeNode,
    formatNodeDetail,
    formatNodeList,
    formatStructList,
    knownWidgetElementTypes,
    listBuiltinStructs,
    listNodeCategories,
    queryNodes,
    resolveNodeType,
    type NodeQuery,
} from "./catalog";
import { checkBlueprintSource, checkProjectDocument, formatDiagnostics, type CheckOptions, type CheckResult } from "./check";
import { printBlueprints } from "./dsl/print";
import {
    applyBlueprintsToDocument,
    elementTypeResolver,
    widgetElementResolver,
    widgetElementTypeResolver,
    type ApplyResult,
    type AssetNameContext,
    type ProjectVariables,
    type UiDocumentTargets,
} from "./model";

/** How many nodes a bare `nodes` prints before it says only how many more there are. */
export const DEFAULT_NODE_LIST_LIMIT = 60;

/**
 * What a body that judges graphs against a project takes. Build it with
 * `agent-core`'s `buildBlueprintProjectContext`, or field by field from `model.ts`.
 */
export type BlueprintProjectInput = {
    /** `uigraphs.json`'s `blueprintDocument`, migrated (`readableBlueprintDocument`). */
    blueprintDocument: BlueprintDocument;
    /** The interface's surfaces, components and elements (`uiDocumentTargetsOf(uidoc)`). */
    targets: UiDocumentTargets;
    /** The project-level variable registry (`projectVariablesOf`). */
    variables: ProjectVariables;
    /** The interface and every variable a story row writes (`assetNameContextOf`). */
    assetNameContext: AssetNameContext;
};

/** The options `checkBlueprintSource` takes, filled from a project. */
export function checkOptionsFor(input: BlueprintProjectInput): CheckOptions {
    return {
        existing: input.blueprintDocument,
        persistentVariables: input.variables.persistent,
        savedVariables: input.variables.saved,
        resolveWidgetElementType: widgetElementTypeResolver(input.targets),
        resolveElementType: elementTypeResolver(input.targets),
        resolveWidgetElement: widgetElementResolver(input.targets),
        uiElements: input.targets.raw as Readonly<Record<string, UIElement>>,
        uiStructs: input.targets.structs,
        assetNameContext: input.assetNameContext,
    };
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

/** The `--widget` warning: no node is scoped to this widget type. Null when one is, or none was named. */
export function unscopedWidgetWarning(widget: string | undefined): string | null {
    if (!widget || knownWidgetElementTypes().includes(widget)) {
        return null;
    }
    return `No node in the catalogue is scoped to "${widget}". Widget types that scope one: `
        + `${knownWidgetElementTypes().join(", ")}.`;
}

export type BlueprintNodesQuery = Omit<NodeQuery, "limit"> & {
    /** How many to print; 0 prints all. Defaults to {@link DEFAULT_NODE_LIST_LIMIT} (not with `json`). */
    limit?: number;
    json?: boolean;
    /** Leave out the unscoped-widget warning, for a caller that has already said it. */
    skipWidgetWarning?: boolean;
};

/** `blueprint nodes [search]`. */
export function blueprintNodesCommand(query: BlueprintNodesQuery): CommandResult {
    const io = commandWriter();
    const { limit, json, skipWidgetWarning, ...nodeQuery } = query;
    const warning = skipWidgetWarning ? null : unscopedWidgetWarning(nodeQuery.widgetElementType);
    if (warning) {
        io.err(warning);
    }
    const all = queryNodes(nodeQuery);
    if (json === true) {
        io.out(JSON.stringify(limit ? all.slice(0, limit) : all, null, 2));
        return io.finish(0);
    }
    // A bare `nodes` matches 600-odd of them, and a wall of those answers no question worth asking.
    // The total and the way to lift the cap go in the trailer, so nothing is quietly dropped.
    const effective = limit ?? DEFAULT_NODE_LIST_LIMIT;
    io.out(formatNodeList(effective > 0 ? all.slice(0, effective) : all, { total: all.length }));
    return io.finish(0);
}

export type BlueprintNodeOptions = {
    json?: boolean;
    /** The plugin that owns a node type, or undefined for one of Studio's own. */
    nodeOwnerOf?: (type: string) => string | undefined;
    /** Whether that plugin ships with Studio. Defaults to true, which is all the command line knows. */
    isBundledPlugin?: (pluginId: string) => boolean;
};

/** `blueprint node <type|name>`. Leaves with 2, naming close matches, for a type nothing declares. */
export function blueprintNodeCommand(wanted: string, options: BlueprintNodeOptions = {}): CommandResult {
    const io = commandWriter();
    const resolved = resolveNodeType(wanted);
    if (!resolved) {
        io.err(`No node type "${wanted}".`);
        const near = queryNodes({ search: wanted, includeHidden: true, limit: 8 });
        if (near.length > 0) {
            io.err(`Close by: ${near.map(node => node.type).join(", ")}`);
        }
        return io.finish(2);
    }
    if (resolved !== wanted) {
        io.err(`"${wanted}" -> ${resolved}`);
    }
    const detail = describeNode(resolved);
    if (!detail) {
        io.err(`No node type "${resolved}".`);
        return io.finish(2);
    }
    const plugin = options.nodeOwnerOf?.(resolved);
    if (options.json === true) {
        io.out(JSON.stringify(plugin ? { ...detail, plugin } : detail, null, 2));
        return io.finish(0);
    }
    io.out(formatNodeDetail(detail));
    if (plugin) {
        // Said rather than left to the category name: a project using this node needs that plugin
        // installed and switched on, and the bundled ones do not all ship switched on.
        const bundled = options.isBundledPlugin?.(plugin) ?? true;
        io.out(
            bundled
                ? `  plugin     ${plugin} (bundled with Studio; a project using it depends on it)`
                : `  plugin     ${plugin} (a project using it depends on it)`,
        );
    }
    return io.finish(0);
}

/** `blueprint categories`. */
export function blueprintCategoriesCommand(options: { json?: boolean } = {}): CommandResult {
    const io = commandWriter();
    const categories = listNodeCategories();
    if (options.json === true) {
        io.out(JSON.stringify(categories, null, 2));
        return io.finish(0);
    }
    const width = Math.max(...categories.map(item => item.category.length));
    io.out(categories.map(item => `${item.category.padEnd(width)}  ${item.count}`).join("\n"));
    return io.finish(0);
}

/** `blueprint structs`. */
export function blueprintStructsCommand(options: { json?: boolean } = {}): CommandResult {
    const io = commandWriter();
    const structs = listBuiltinStructs();
    io.out(options.json === true ? JSON.stringify(structs, null, 2) : formatStructList(structs).join("\n"));
    return io.finish(0);
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

/** `blueprint targets [search]`: the owner= lines a `.bp` file names its owners with. */
export function blueprintTargetsCommand(targets: UiDocumentTargets, options: { search?: string; json?: boolean } = {}): CommandResult {
    const io = commandWriter();
    if (options.json === true) {
        io.out(JSON.stringify(targets, null, 2));
        return io.finish(0);
    }
    // A project of any size holds hundreds of elements, and the id being looked for is nearly always
    // the one whose name is already known.
    const search = options.search ?? "";
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
        // A page's declared parameters, as a node that opens it names its inputs (`param_<id>`) and
        // `Get Page Param` names the one it reads (`paramId = <id>`).
        const pageParams = getUIPageParams({ kind: surface.kind === "stageSurface" ? "stageSurface" : "appSurface", params: surface.params })
            .map(param => `${param.id}${param.name === param.id ? "" : ` "${param.name}"`}:${param.type}`
                + (param.struct ? `<${param.struct}>` : ""));
        lines.push(
            `${surface.name}  owner=surfaceMain surface=${surface.id}`
                // After a `#`, as a label: what follows the owner fields is copied into a `.bp` file without it.
                + (pageParams.length > 0 ? `  # params: ${pageParams.join(", ")}` : ""),
        );
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
        return io.finish(0);
    }
    lines.push(
        search
            ? `${shown} of ${targets.elements.length} elements match "${search}".`
            : `${targets.surfaces.length} surface(s), ${targets.components.length} component(s), `
                  + `${targets.elements.length} element(s).`,
    );
    io.out(lines.join("\n"));
    return io.finish(0);
}

/** `blueprint list [search]`. `withGraphs` leaves out the blueprints that hold no node. */
export function blueprintListCommand(
    document: BlueprintDocument,
    options: { search?: string; withGraphs?: boolean; json?: boolean } = {},
): CommandResult {
    const io = commandWriter();
    const all = Object.values(document.blueprints).map(blueprint => ({
        id: blueprint.id,
        name: blueprint.name,
        ownerKey: ownerRefToIndexKey(blueprint.owner),
        scripts: listScriptLayers(blueprint.graphs).length,
        events: countGraphs(blueprint, "events"),
        functions: countGraphs(blueprint, "functions"),
        nodes: countNodes(blueprint),
    }));
    all.sort((a, b) => a.ownerKey.localeCompare(b.ownerKey));
    const search = options.search ?? "";
    const needle = search.toLowerCase();
    let rows = needle
        ? all.filter(row => `${row.name} ${row.ownerKey} ${row.id}`.toLowerCase().includes(needle))
        : all;
    // Most owners hold an empty blueprint: a widget gets one the moment anyone opens its graph, and
    // it stays whether or not a node was ever dropped into it. They are noise to everything but a
    // census, and they outnumber the rest six to one in the shipped skeleton.
    if (options.withGraphs === true) {
        rows = rows.filter(row => row.nodes > 0);
    }
    if (options.json === true) {
        io.out(JSON.stringify(rows, null, 2));
        return io.finish(0);
    }
    if (rows.length === 0) {
        io.out(search ? `No blueprint matches "${search}".` : "This project holds no blueprints.");
        return io.finish(0);
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
    return io.finish(0);
}

export type BlueprintShowResult = CommandResult & {
    /** The printed text as it would be written to a file. Absent when nothing matched. */
    text?: string;
    /** The blueprints printed. */
    blueprints: Blueprint[];
};

/**
 * `blueprint show`: the blueprints `blueprint` names (an id or whole name first, else a part of a
 * name) and/or whose owner key contains `owner`, in the `.bp` text format. All of them when neither
 * is given. Requires the page parameters and save fields to be published (see `model.ts`).
 */
export function blueprintShowCommand(
    document: BlueprintDocument,
    options: { blueprint?: string; owner?: string } = {},
): BlueprintShowResult {
    const io = commandWriter();
    let blueprints = Object.values(document.blueprints);
    if (options.blueprint) {
        blueprints = matchBlueprints(blueprints, options.blueprint);
    }
    if (options.owner) {
        const needle = options.owner.toLowerCase();
        blueprints = blueprints.filter(item => ownerRefToIndexKey(item.owner).toLowerCase().includes(needle));
    }
    if (blueprints.length === 0) {
        io.err("No blueprint matches. Run `blueprint list --project <dir>` to see what is there.");
        return { ...io.finish(2), blueprints };
    }
    const printed = printBlueprints(blueprints);
    for (const diagnostic of printed.diagnostics) {
        io.err(`${diagnostic.severity}  ${diagnostic.code}  ${diagnostic.message}`);
    }
    io.out(printed.text.trimEnd());
    return { ...io.finish(0), text: printed.text, blueprints };
}

/** `blueprint check` with no file: every stored blueprint against the project. */
export function blueprintCheckProjectCommand(
    input: BlueprintProjectInput,
    options: { fileName?: string; json?: boolean } = {},
): CommandResult {
    const io = commandWriter();
    const diagnostics = checkProjectDocument(input.blueprintDocument, {
        persistentVariables: input.variables.persistent,
        savedVariables: input.variables.saved,
        resolveWidgetElement: widgetElementResolver(input.targets),
        uiElements: input.targets.raw as Readonly<Record<string, UIElement>>,
        uiStructs: input.targets.structs,
        assetNameContext: input.assetNameContext,
    });
    io.out(
        options.json === true
            ? JSON.stringify(diagnostics, null, 2)
            : formatDiagnostics(diagnostics, { fileName: options.fileName }),
    );
    return io.finish(diagnostics.some(item => item.severity === "error") ? 1 : 0);
}

export type BlueprintCheckSourceResult = CommandResult & { check: CheckResult };

/**
 * `blueprint check <file.bp>`: the file against the project, or on its own when `input` is null
 * (widget scope, element types, variables and asset names then go unchecked).
 */
export function blueprintCheckSourceCommand(
    source: string,
    input: BlueprintProjectInput | null,
    options: { fileName?: string; json?: boolean } = {},
): BlueprintCheckSourceResult {
    const io = commandWriter();
    const check = checkBlueprintSource(
        source,
        input ? checkOptionsFor(input) : { existing: null, persistentVariables: [], savedVariables: [] },
    );
    io.out(
        options.json === true
            ? JSON.stringify(check.diagnostics, null, 2)
            : formatDiagnostics(check.diagnostics, { fileName: options.fileName, source }),
    );
    return { ...io.finish(check.ok ? 0 : 1), check };
}

export type BlueprintApplyOptions = {
    /** Labels the diagnostics report. */
    fileName?: string;
    /** What the document is called in the closing line: the command line passes the uigraphs path. */
    documentLabel?: string;
    /** Whether the caller will keep the change; only changes the wording. */
    write?: boolean;
    /** Said after "Wrote ..." when `write` - the command line's "Studio does not reload" note. */
    writtenNote?: string;
    /**
     * Called once the file has checked clean and before anything changes. A message refuses: it is
     * said on stderr and the command leaves with 2.
     */
    beforeApply?: () => string | null;
};

export type BlueprintApplyResult = CommandResult & {
    check: CheckResult;
    /** What changed in `input.blueprintDocument`; absent when the file did not check clean. */
    applied?: ApplyResult;
};

/**
 * `blueprint apply <file.bp>`: check the file against the project and, when it is clean, put its
 * blueprints into `input.blueprintDocument` IN PLACE, each replacing whatever held its owner. The
 * caller keeps or discards the result (the command line writes it with `--write`; a dry run passes
 * a copy).
 */
export function blueprintApplyCommand(
    source: string,
    input: BlueprintProjectInput,
    options: BlueprintApplyOptions = {},
): BlueprintApplyResult {
    const io = commandWriter();
    const check = checkBlueprintSource(source, checkOptionsFor(input));
    const report = formatDiagnostics(check.diagnostics, { fileName: options.fileName, source });
    if (!check.ok) {
        io.err(report);
        io.err("Nothing was written.");
        return { ...io.finish(1), check };
    }
    if (check.diagnostics.length > 0) {
        io.err(report);
    }
    const refusal = options.beforeApply?.() ?? null;
    if (refusal !== null) {
        io.err(refusal);
        return { ...io.finish(2), check };
    }
    const applied = applyBlueprintsToDocument(input.blueprintDocument, check.blueprints, {
        ...Object.fromEntries(
            check.blueprints.map(blueprint => [ownerRefToIndexKey(blueprint.owner), { blueprintId: blueprint.id }]),
        ),
    });
    const what = [
        applied.added.length > 0 ? `add ${quoteAll(applied.added)}` : null,
        applied.replaced.length > 0 ? `replace ${quoteAll(applied.replaced)}` : null,
    ]
        .filter(Boolean)
        .join(", and ");
    const label = options.documentLabel ?? "the project";
    if (options.write !== true) {
        io.out(`Would ${what || "change nothing"} in ${label}. Pass --write to do it.`);
        return { ...io.finish(0), check, applied };
    }
    io.out(`Wrote ${label}: ${what || "no change"}.${options.writtenNote ? `\n${options.writtenNote}` : ""}`);
    return { ...io.finish(0), check, applied };
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
export function matchBlueprints(blueprints: readonly Blueprint[], wanted: string): Blueprint[] {
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
