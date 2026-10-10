/**
 * The bodies of the `ui` commands, as functions of documents.
 *
 * `cli.ts` reads the project off disk, turns flags into the arguments below and writes what comes
 * back; Studio's agent bridge passes the live documents its services hold and hands the same text to
 * an agent. Neither side formats anything of its own, so `ui.md`, the in-Studio guide and the
 * terminal all describe one output.
 *
 * Flag validation stays with the command line: a body takes values that are already one of the
 * allowed set (`WIDGET_SURFACE_KINDS`, `WIDGET_STAGE_SLOTS`), which a bridge enforces with its own
 * schema.
 *
 * Comments in English per project convention.
 */

import type { UIDocument } from "@shared/types/ui-editor/document";
import { resolveEntrySurfaceId } from "@shared/types/ui-editor/entrySurface";
import { getUIPageParams } from "@shared/types/ui-editor/pageParams";
import type { UIStructDef } from "@shared/types/ui-editor/struct";
import { commandWriter, type CommandResult } from "../agent-core/commandResult";
import { applyCompiled, formatApplyResult, type ApplyResult } from "./apply";
import {
    describeWidget,
    formatStructs,
    formatWidgetDetail,
    formatWidgetList,
    listBuiltinStructs,
    nearestWidgetTypes,
    queryWidgets,
} from "./catalog";
import { checkProjectDocument, checkUiSource, formatDiagnostics, type UiCheckResult } from "./check";
import { printUiDocument } from "./dsl/print";
import { collectTree, elementPath, findComponent, findSurface, type BlueprintIndex, type TextKeys } from "./model";
import { findUsages, formatPropValues, formatUsages } from "./usage";
import { withWidgetModuleSource, type WidgetModuleSource } from "./widgetSource";

/** How many occurrences a bare `usage` prints before it says only how many more there are. */
export const DEFAULT_USAGE_LIMIT = 3;

/** What every body that reads a project takes. */
export type UiProjectInput = {
    /** The interface document (`editor/ui/uidoc.json`), at the current schema. */
    document: UIDocument;
    /** Which blueprints hang off which element, from `indexBlueprintDocument(uigraphs.blueprintDocument)`. */
    blueprints: BlueprintIndex;
    /** The project's translation keys (`textKeysOf`), or null when the project config could not be read. */
    textKeys: TextKeys | null;
};

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export type UiWidgetsQuery = {
    search?: string;
    insertableOnly?: boolean;
    /** One of `WIDGET_SURFACE_KINDS`. Naming a stage slot implies `stageSurface`. */
    surfaceKind?: string;
    /** One of `WIDGET_STAGE_SLOTS`. */
    stageSlot?: string;
    json?: boolean;
    widgets?: WidgetModuleSource;
};

/** `ui widgets`. */
export function uiWidgetsCommand(query: UiWidgetsQuery): CommandResult {
    return withWidgetModuleSource(query.widgets, () => {
        const io = commandWriter();
        const widgets = queryWidgets({
            search: query.search || undefined,
            insertableOnly: query.insertableOnly === true,
            // A slot only exists on a stage surface, so naming one says which kind of surface this is
            // even when the caller did not spell it out.
            surfaceKind: query.surfaceKind ?? (query.stageSlot ? "stageSurface" : undefined),
            stageSlot: query.stageSlot,
        });
        io.out(query.json === true ? JSON.stringify(widgets, null, 2) : formatWidgetList(widgets));
        return io.finish(0);
    });
}

/** `ui widget <type>`. Leaves with 2, naming close spellings, for a type nothing declares. */
export function uiWidgetCommand(type: string, options: { json?: boolean; widgets?: WidgetModuleSource } = {}): CommandResult {
    return withWidgetModuleSource(options.widgets, () => {
        const io = commandWriter();
        const detail = describeWidget(type);
        if (!detail) {
            io.err(`No widget type "${type}".`);
            const near = nearestWidgetTypes(type);
            io.err(near.length > 0 ? `Close by: ${near.join(", ")}` : "Run `ui widgets` for the catalogue.");
            return io.finish(2);
        }
        io.out(options.json === true ? JSON.stringify(detail, null, 2) : formatWidgetDetail(detail));
        return io.finish(0);
    });
}

/** `ui structs`: the shipped list-item shapes, then the project's when a document is given. */
export function uiStructsCommand(document: UIDocument | null, options: { json?: boolean } = {}): CommandResult {
    const io = commandWriter();
    const structs: UIStructDef[] = [...listBuiltinStructs()];
    if (document) {
        structs.push(...Object.values(document.structs ?? {}));
    }
    io.out(options.json === true ? JSON.stringify(structs, null, 2) : formatStructs(structs));
    return io.finish(0);
}

export type UiUsageOptions = {
    /** Print what this one prop is set to across every occurrence instead of the occurrences. */
    prop?: string;
    /** How many occurrences to print in full. Defaults to {@link DEFAULT_USAGE_LIMIT}. */
    limit?: number;
    /** Print each occurrence without its children. */
    shallow?: boolean;
    json?: boolean;
};

/**
 * `ui usage <type>` over `document` - the shipped skeleton's interface on the command line, whichever
 * interface document the caller chose in Studio.
 */
export function uiUsageCommand(document: UIDocument, type: string, options: UiUsageOptions = {}): CommandResult {
    const io = commandWriter();
    const sites = findUsages(document, type);
    if (options.json === true) {
        io.out(
            JSON.stringify(
                sites.map(site => ({ owner: site.owner, path: site.path, element: site.element })),
                null,
                2,
            ),
        );
        return io.finish(0);
    }
    if (options.prop) {
        io.out(formatPropValues(sites, options.prop));
        return io.finish(0);
    }
    io.out(formatUsages(sites, options.limit ?? DEFAULT_USAGE_LIMIT, { withoutChildren: options.shallow === true }));
    return io.finish(0);
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

/** `ui surfaces [search]`: surfaces, components, elements and the owner= lines blueprint wants. */
export function uiSurfacesCommand(
    input: Pick<UiProjectInput, "document" | "blueprints">,
    options: { search?: string; json?: boolean } = {},
): CommandResult {
    const io = commandWriter();
    const { document, blueprints } = input;
    const entrySurfaceId = resolveEntrySurfaceId(document);
    if (options.json === true) {
        io.out(JSON.stringify({ surfaces: document.surfaces, components: document.components ?? [], entrySurfaceId }, null, 2));
        return io.finish(0);
    }
    // A project of any size has hundreds of elements, and the one being looked for usually has a
    // name already. The search word matches a surface, a component, an element path or a type.
    const search = (options.search ?? "").toLowerCase();
    const matches = (...text: string[]): boolean =>
        search.length === 0 || text.some(item => item.toLowerCase().includes(search));

    const lines: string[] = [];
    let hidden = 0;
    for (const surface of document.surfaces) {
        const mount = surface.kind === "stageSurface" ? ` slot=${surface.mount.slotId}` : "";
        const answers = (surface.actions ?? []).map(action => action.actionId).join(", ");
        // A page's parameters, as the nodes that open it name their inputs and `param` lines spell them.
        const pageParams = getUIPageParams(surface)
            .map(param => `${param.id}${param.type === "string" ? "" : `:${param.type}`}${param.struct ? `<${param.struct}>` : ""}`)
            .join(" ");
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
                + `${surface.id === entrySurfaceId ? "  entry" : ""}`
                + `${answers ? `  answers ${answers}` : ""}`
                + `${pageParams ? `  (params ${pageParams})` : ""}`,
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
        // A text parameter is marked, since it is the one a `bind ... = param` may show.
        const params = (component.params ?? [])
            .map(param => `${param.id}${param.type === "text" ? ":text" : ""}="${param.defaultValue}"`)
            .join(" ");
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
    return io.finish(0);
}

function describeAttached(blueprints: BlueprintIndex, elementId: string): string {
    const attached = blueprints.byElement.get(elementId) ?? [];
    return attached.length > 0 ? `  # ${attached.map(item => item.name).join(", ")}` : "";
}

export type UiShowOptions = {
    /** Print only this surface (name or id). */
    surface?: string;
    /** Print only this component definition (name or id). */
    component?: string;
    /**
     * How to tell the reader to list what exists when a name matches nothing: the command line passes
     * the project directory, so the hint reads `ui surfaces --project <dir>`.
     */
    projectHint?: string;
};

export type UiShowResult = CommandResult & {
    /** The printed interface, as it would be written to a file (trailing newline kept). Absent on a miss. */
    text?: string;
    /** What was printed - the surface, the component or the document - for naming a file after it. */
    subject: string;
};

/**
 * `ui show`: the whole interface with its shared tables, or one surface, or one component, in the
 * `.ui` text format. `out` holds the text as a terminal prints it; `text` is the same with its
 * trailing newline, for writing to a file.
 */
export function uiShowCommand(input: UiProjectInput, options: UiShowOptions = {}): UiShowResult {
    const io = commandWriter();
    const { document } = input;
    let surfaceIds: string[] | undefined;
    let componentIds: string[] | undefined;
    let subject = document.name || "interface";
    const hint = `Run \`ui surfaces --project ${options.projectHint ?? "<dir>"}\`.`;
    if (options.surface) {
        const surface = findSurface(document, options.surface);
        if (!surface) {
            io.err(`No surface "${options.surface}". ${hint}`);
            return { ...io.finish(2), subject };
        }
        surfaceIds = [surface.id];
        componentIds = [];
        subject = surface.name;
    }
    if (options.component) {
        const component = findComponent(document, options.component);
        if (!component) {
            io.err(`No component "${options.component}". ${hint}`);
            return { ...io.finish(2), subject };
        }
        componentIds = [component.id];
        surfaceIds = surfaceIds ?? [];
        subject = component.name;
    }
    const text = printUiDocument(document, {
        surfaceIds,
        componentIds,
        includeSharedTables: !options.surface && !options.component,
        blueprintsByElement: input.blueprints.byElement,
        keyWords: input.textKeys?.keys,
    });
    io.out(text.trimEnd());
    return { ...io.finish(0), text, subject };
}

/** `ui check` with no file: the stored document's own problems. `fileName` labels the report. */
export function uiCheckProjectCommand(
    input: Pick<UiProjectInput, "document" | "blueprints">,
    options: { fileName?: string } = {},
): CommandResult {
    const io = commandWriter();
    const diagnostics = checkProjectDocument(input.document, input.blueprints);
    io.out(formatDiagnostics(diagnostics, { fileName: options.fileName }));
    return io.finish(diagnostics.some(item => item.severity === "error") ? 1 : 0);
}

export type UiCheckSourceResult = CommandResult & { check: UiCheckResult };

/**
 * `ui check <file.ui>`: the compiler's own findings, then the project's (bindings, components, page
 * targets, frames, keys, dropped elements) when a project is given. Without one, says which checks
 * could not run.
 */
export function uiCheckSourceCommand(
    source: string,
    input: UiProjectInput | null,
    options: { fileName?: string; widgets?: WidgetModuleSource } = {},
): UiCheckSourceResult {
    return withWidgetModuleSource(options.widgets, () => {
        const io = commandWriter();
        const check = checkUiSource(source, {
            existing: input?.document ?? null,
            blueprints: input?.blueprints ?? null,
            textKeys: input?.textKeys ?? null,
        });
        io.out(formatDiagnostics(check.diagnostics, { fileName: options.fileName, source }));
        if (!input) {
            io.out(
                "\nNo --project: bindings, components, Page widget targets and dropped elements were not checked, because none of them "
                    + "can be answered without the document this file is going into.",
            );
        }
        return { ...io.finish(check.ok ? 0 : 1), check };
    });
}

export type UiApplyOptions = {
    /** Labels the report. */
    fileName?: string;
    /** Whether the caller will write the document afterwards; only changes the wording. */
    write?: boolean;
    /**
     * Called once the file has checked clean and before anything is changed. A message refuses the
     * apply: it is said on stderr and the command leaves with 2, the file's diagnostics still printed.
     * The command line uses it for the schema-version gate, which must not pre-empt those diagnostics.
     */
    beforeApply?: () => string | null;
    /** Words to add after the summary when written - the command line's "close the project" note. */
    writtenNote?: string;
    widgets?: WidgetModuleSource;
};

export type UiApplyResult = CommandResult & {
    check: UiCheckResult;
    /** What changed in `input.document`, absent when the file did not check clean. */
    applied?: ApplyResult;
};

/**
 * `ui apply <file.ui>`: check the file against the project and, when it is clean, apply it to
 * `input.document` IN PLACE (`applyCompiled`). The caller decides whether to keep the result - the
 * command line writes it with `--write`, the bridge commits it as one undo step - so a caller that
 * wants a dry run passes a copy.
 */
export function uiApplyCommand(source: string, input: UiProjectInput, options: UiApplyOptions = {}): UiApplyResult {
    return withWidgetModuleSource(options.widgets, () => {
        const io = commandWriter();
        const check = checkUiSource(source, {
            existing: input.document,
            blueprints: input.blueprints,
            textKeys: input.textKeys,
        });
        io.out(formatDiagnostics(check.diagnostics, { fileName: options.fileName, source }));
        if (!check.ok || !check.compiled) {
            io.err("Nothing written.");
            return { ...io.finish(1), check };
        }
        const refusal = options.beforeApply?.() ?? null;
        if (refusal !== null) {
            io.err(refusal);
            return { ...io.finish(2), check };
        }
        const applied = applyCompiled(input.document, check.compiled);
        io.out("");
        io.out(formatApplyResult(applied, options.write === true));
        if (options.write === true && options.writtenNote) {
            io.out(options.writtenNote);
        }
        return { ...io.finish(0), check, applied };
    });
}
