/**
 * Static checking: read the text, compile it, and hand the result to the editor's own validator.
 *
 * There are two layers and they answer different questions. The compiler answers "is this written
 * against the catalogue that exists" - node types, pins, fields, whether two pins may be joined.
 * `validateBlueprintDocumentGraphs` answers "is this a graph that would run" - an event layer with
 * no head, a Fn call with no target, a variable ref that resolves to nothing. Neither is restated
 * here; this module runs both and puts their findings back on the author's own lines.
 *
 * Comments in English per project convention.
 */

import type { Blueprint, BlueprintDocument, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import type { UIElement } from "@shared/types/ui-editor/document";
import type { VariableRegistryEntry } from "@shared/types/variables/registry";
import {
    validateBlueprintDocumentGraphs,
} from "@services/ui-editor/blueprint/graphValidation";
import type { BpDiagnostic } from "./dsl/ast";
import { compileBlueprintDocument } from "./dsl/compile";
import { parseBlueprintText } from "./dsl/parse";

export type CheckOptions = {
    /** Merged in so cross-blueprint checks (a Fn call into another blueprint) can resolve. */
    existing?: BlueprintDocument | null;
    persistentVariables?: readonly VariableRegistryEntry[];
    savedVariables?: readonly VariableRegistryEntry[];
    newId?: () => string;
    /** See `BpCompileOptions.resolveWidgetElementType`. */
    resolveWidgetElementType?: (owner: BlueprintOwnerRef) => string | undefined;
    /**
     * The element a `widgetMain` blueprint belongs to.
     *
     * Without it the validator cannot tell which event heads that widget carries, and reports every
     * one of them as not allowed here - 150-odd refusals on a project that is fine.
     */
    resolveWidgetElement?: (owner: BlueprintOwnerRef) => { element: unknown; surfaceId: string } | undefined;
};

export type CheckResult = {
    diagnostics: BpDiagnostic[];
    blueprints: Blueprint[];
    /** True when nothing at error severity was found; compiled output is safe to write. */
    ok: boolean;
};

export function checkBlueprintSource(source: string, options: CheckOptions = {}): CheckResult {
    const parsed = parseBlueprintText(source);
    const diagnostics = [...parsed.diagnostics];

    const compiled = compileBlueprintDocument(parsed.document, {
        existing: options.existing,
        newId: options.newId,
        resolveWidgetElementType: options.resolveWidgetElementType,
    });
    diagnostics.push(...compiled.diagnostics);

    // Where each node was written, so a finding the deep validator reports against a node id lands
    // on a line rather than on an id the author has to go looking for.
    const nodeLines = new Map<string, number>();
    for (const blueprint of parsed.document.blueprints) {
        for (const graph of blueprint.graphs) {
            for (const node of graph.nodes) {
                nodeLines.set(nodeKey(blueprint.name, node.id), node.line);
            }
            nodeLines.set(nodeKey(blueprint.name, ""), graph.line);
        }
    }

    if (!diagnostics.some(item => item.severity === "error")) {
        diagnostics.push(...runGraphValidation(compiled.blueprints, options, nodeLines));
    }

    return {
        diagnostics,
        blueprints: compiled.blueprints,
        ok: !diagnostics.some(item => item.severity === "error"),
    };
}

/** Validate what a project already holds, with no text file involved. */
export function checkProjectDocument(
    document: BlueprintDocument,
    options: Omit<CheckOptions, "existing"> = {},
): BpDiagnostic[] {
    const out: BpDiagnostic[] = [];
    // Some findings are about the blueprint rather than about one graph in it - a duplicate Fn name
    // is the same fact however many layers were walked to notice it - and the validator reports them
    // once per graph. Deduplicated here so a project report counts problems, not passes over them.
    const seen = new Set<string>();
    for (const blueprint of Object.values(document.blueprints)) {
        for (const finding of validateBlueprintDocumentGraphs(
            document,
            blueprint.id,
            validationOptions(blueprint.owner, options),
        )) {
            const message = `${blueprint.name}: ${finding.message}`;
            const key = JSON.stringify([finding.severity, finding.code, message]);
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            out.push({ severity: finding.severity, code: finding.code ?? "graph", message });
        }
    }
    return out;
}

function runGraphValidation(
    blueprints: readonly Blueprint[],
    options: CheckOptions,
    nodeLines: ReadonlyMap<string, number>,
): BpDiagnostic[] {
    const document: BlueprintDocument = {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        blueprints: { ...(options.existing?.blueprints ?? {}) },
        ownerRecords: { ...(options.existing?.ownerRecords ?? {}) },
    };
    for (const blueprint of blueprints) {
        document.blueprints[blueprint.id] = blueprint;
    }

    const out: BpDiagnostic[] = [];
    for (const blueprint of blueprints) {
        for (const finding of validateBlueprintDocumentGraphs(
            document,
            blueprint.id,
            validationOptions(blueprint.owner, options),
        )) {
            // The compiler already reported this one, with the value types and the line the author
            // wrote it on. Two warnings for one edge would only make the second easier to ignore.
            if (finding.code === "edge.port_mismatch") {
                continue;
            }
            const nodeId = finding.target?.kind === "node" ? finding.target.nodeId : "";
            out.push({
                severity: finding.severity,
                code: finding.code ?? "graph",
                message: finding.message,
                line: nodeLines.get(nodeKey(blueprint.name, nodeId)),
            });
        }
    }
    return out;
}

function validationOptions(owner: BlueprintOwnerRef, options: CheckOptions) {
    const widget = options.resolveWidgetElement?.(owner);
    return {
        persistentVariables: options.persistentVariables,
        savedVariables: options.savedVariables,
        widgetElement: widget?.element as UIElement | undefined,
        widgetSurfaceId: widget?.surfaceId,
    };
}

/** Blueprint name plus node id, as one lookup key that cannot be spelled two ways. */
function nodeKey(blueprintName: string, nodeId: string): string {
    return JSON.stringify([blueprintName, nodeId]);
}

export type FormatOptions = {
    fileName?: string;
    source?: string;
};

export function formatDiagnostics(diagnostics: readonly BpDiagnostic[], options: FormatOptions = {}): string {
    if (diagnostics.length === 0) {
        return "No problems found.";
    }
    const lines = options.source?.split(/\r?\n/);
    const order = { error: 0, warning: 1, info: 2 };
    const sorted = [...diagnostics].sort(
        (a, b) => order[a.severity] - order[b.severity] || (a.line ?? 0) - (b.line ?? 0),
    );
    const out: string[] = [];
    for (const item of sorted) {
        const where = item.line ? `${options.fileName ?? "input"}:${item.line}` : (options.fileName ?? "");
        out.push(`${where ? `${where}  ` : ""}${item.severity}  ${item.code}  ${item.message}`);
        if (item.line && lines && lines[item.line - 1] !== undefined) {
            out.push(`    | ${lines[item.line - 1].trim()}`);
        }
        if (item.hint) {
            out.push(`    ${item.hint}`);
        }
    }
    const errors = diagnostics.filter(item => item.severity === "error").length;
    const warnings = diagnostics.filter(item => item.severity === "warning").length;
    const infos = diagnostics.length - errors - warnings;
    out.push("", `${errors} error(s), ${warnings} warning(s), ${infos} note(s).`);
    return out.join("\n");
}
