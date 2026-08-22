/**
 * Questions about the node catalogue, answered from the registry instead of from a grep.
 *
 * The catalogue is 600-odd nodes spread over fifty files under `blueprint-nodes/built-in`, and
 * every fact worth knowing about one - which pins it has, which of them carry execution, what its
 * inspector fields are called, where it is allowed to appear - is a field on its definition. This
 * module only selects and formats; it never restates.
 *
 * Comments in English per project convention.
 */

import type { BlueprintOwnerRef } from "@shared/types/blueprint/document";
import type { BlueprintGraphKind } from "@shared/types/blueprint/graph";
import { blueprintNodeRegistry } from "@/lib/ui-editor/blueprint-nodes";
import type {
    BlueprintNodeDef,
    BlueprintNodeEditorCatalogEntry,
    BlueprintPaletteContext,
} from "@/lib/ui-editor/blueprint-nodes/types";

export type NodeQuery = {
    search?: string;
    category?: string;
    graphKind?: BlueprintGraphKind;
    ownerKind?: BlueprintOwnerRef["kind"];
    widgetElementType?: string;
    /** Nodes kept for old graphs but not offered in the palette are hidden unless asked for. */
    includeHidden?: boolean;
    limit?: number;
};

export type NodeSummary = {
    type: string;
    displayName: string;
    category: string;
    isPure: boolean;
    isLatent: boolean;
    graphKinds: BlueprintGraphKind[];
    hideInPalette: boolean;
    keywords: string[];
};

export function listNodeCategories(): { category: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const def of blueprintNodeRegistry.list()) {
        counts.set(def.category, (counts.get(def.category) ?? 0) + 1);
    }
    return [...counts.entries()]
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => a.category.localeCompare(b.category));
}

export function queryNodes(query: NodeQuery): NodeSummary[] {
    const needle = query.search?.trim().toLowerCase();
    const allowed = query.ownerKind ? paletteTypesFor(query) : null;
    const out: NodeSummary[] = [];
    for (const def of blueprintNodeRegistry.list()) {
        if (!query.includeHidden && def.hideInPalette) {
            continue;
        }
        if (query.category && def.category.toLowerCase() !== query.category.toLowerCase()) {
            continue;
        }
        if (query.graphKind && !def.graphKinds.includes(query.graphKind)) {
            continue;
        }
        if (allowed && !allowed.has(def.type)) {
            continue;
        }
        if (needle && !matches(def, needle)) {
            continue;
        }
        out.push(summarize(def));
    }
    out.sort(
        (a, b) =>
            a.category.localeCompare(b.category)
            || a.displayName.localeCompare(b.displayName)
            || a.type.localeCompare(b.type),
    );
    return query.limit && query.limit > 0 ? out.slice(0, query.limit) : out;
}

function matches(def: BlueprintNodeDef, needle: string): boolean {
    const haystack = [def.type, def.displayName, def.category, ...(def.keywords ?? [])]
        .join(" ")
        .toLowerCase();
    return needle.split(/\s+/).every(word => haystack.includes(word));
}

function summarize(def: BlueprintNodeDef): NodeSummary {
    return {
        type: def.type,
        displayName: def.displayName,
        category: def.category,
        isPure: def.isPure,
        isLatent: def.isLatent === true,
        graphKinds: def.graphKinds,
        hideInPalette: def.hideInPalette === true,
        keywords: def.keywords ?? [],
    };
}

/**
 * Palette entries for a synthetic owner, which is how "may I use this node here" gets answered
 * without a project open. The ids are placeholders: owner *kind* decides scope, the ids do not.
 */
function paletteTypesFor(query: NodeQuery): Set<string> {
    const owner = syntheticOwner(query.ownerKind as BlueprintOwnerRef["kind"]);
    const context: BlueprintPaletteContext = {
        graphKind: query.graphKind ?? "event",
        owner,
        widgetElementType: query.widgetElementType,
        listItemContextAvailable: true,
    };
    return new Set(blueprintNodeRegistry.listPaletteEntries(context).map(entry => entry.type));
}

export function syntheticOwner(kind: BlueprintOwnerRef["kind"]): BlueprintOwnerRef {
    switch (kind) {
        case "surfaceMain":
            return { kind, surfaceId: "surface" };
        case "widgetMain":
            return { kind, surfaceId: "surface", elementId: "element" };
        case "widgetValue":
            return { kind, surfaceId: "surface", elementId: "element", propPath: "value" };
        case "componentWidgetMain":
            return { kind, componentId: "component", elementId: "element" };
        case "sharedAsset":
            return { kind, assetId: "asset" };
        case "storyAction":
            return { kind, blueprintId: "blueprint" };
        default:
            return { kind: "globalMain" };
    }
}

export type NodeDetail = {
    type: string;
    displayName: string;
    category: string;
    keywords: string[];
    graphKinds: BlueprintGraphKind[];
    isPure: boolean;
    isLatent: boolean;
    hideInPalette: boolean;
    requiresListItemContext: boolean;
    role?: string;
    scope?: unknown;
    pins: {
        id: string;
        kind: "input" | "output";
        semantic: "exec" | "data";
        valueType?: string;
        label?: string;
        optional?: boolean;
        acceptsLiteral?: boolean;
        assetRef?: unknown;
    }[];
    fields: {
        key: string;
        label: string;
        kind: string;
        options?: { value: string; label: string }[];
        optionsFrom?: string;
        jsonSchema?: unknown;
    }[];
    dynamicPins?: {
        storageKey: string;
        generatedIdPrefix: string;
        valueType: string;
        fixedDataInputIds: readonly string[];
        addButtonLabel?: string;
        generatesOutputs: boolean;
    };
    saveSchemaPins?: { kind: "input" | "output" };
    magicElementTarget?: unknown;
};

export function describeNode(type: string, params?: Record<string, unknown>): NodeDetail | null {
    const def = blueprintNodeRegistry.get(type);
    if (!def) {
        return null;
    }
    const entry: BlueprintNodeEditorCatalogEntry = blueprintNodeRegistry.resolveCatalogEntryForNode(type, params);
    return {
        type: def.type,
        displayName: def.displayName,
        category: def.category,
        keywords: def.keywords ?? [],
        graphKinds: def.graphKinds,
        isPure: def.isPure,
        isLatent: def.isLatent === true,
        hideInPalette: def.hideInPalette === true,
        requiresListItemContext: def.requiresListItemContext === true,
        role: def.role,
        scope: def.scope,
        pins: entry.pins.map(pin => ({
            id: pin.id,
            kind: pin.kind,
            semantic: pin.semantic,
            valueType: pin.valueType,
            label: pin.label,
            optional: pin.optional,
            acceptsLiteral: pin.allowInlineLiteral,
            assetRef: pin.assetRef,
        })),
        fields: (entry.inspectorParams ?? []).map(param => ({
            key: param.key,
            label: param.label,
            kind: param.kind,
            options: param.options?.map(option => ({ value: option.value, label: option.label })),
            optionsFrom: param.dynamicOptionsSource,
            jsonSchema: param.jsonSchema,
        })),
        dynamicPins: def.dynamicInputPins
            ? {
                  storageKey: def.dynamicInputPins.storageKey,
                  generatedIdPrefix: def.dynamicInputPins.generatedIdPrefix,
                  valueType: def.dynamicInputPins.valueType,
                  fixedDataInputIds: def.dynamicInputPins.fixedDataInputIds,
                  addButtonLabel: def.dynamicInputPins.addButtonLabel,
                  generatesOutputs: (def.dynamicInputPins.generatedPinTemplates ?? []).some(
                      template => template.kind === "output",
                  ),
              }
            : undefined,
        saveSchemaPins: def.saveSchemaPins,
        magicElementTarget: def.magicElementTarget,
    };
}

export function formatNodeList(nodes: readonly NodeSummary[]): string {
    if (nodes.length === 0) {
        return "No node matches.";
    }
    const width = Math.min(52, Math.max(...nodes.map(node => node.type.length)));
    const lines: string[] = [];
    let category = "";
    for (const node of nodes) {
        if (node.category !== category) {
            category = node.category;
            lines.push("", category);
        }
        const flags = [
            node.isPure ? "pure" : null,
            node.isLatent ? "async" : null,
            node.hideInPalette ? "hidden" : null,
            node.graphKinds.includes("event") ? null : `graphs:${node.graphKinds.join("/")}`,
        ].filter(Boolean);
        lines.push(
            `  ${node.type.padEnd(width)}  ${node.displayName}${flags.length > 0 ? `  [${flags.join(" ")}]` : ""}`,
        );
    }
    lines.push("", `${nodes.length} node${nodes.length === 1 ? "" : "s"}.`);
    return lines.join("\n").trimStart();
}

export function formatNodeDetail(detail: NodeDetail): string {
    const lines: string[] = [];
    lines.push(`${detail.type}`);
    lines.push(`  name       ${detail.displayName}`);
    lines.push(`  category   ${detail.category}`);
    lines.push(`  graphs     ${detail.graphKinds.join(", ")}`);
    const traits = [
        detail.isPure ? "pure" : "effectful",
        detail.isLatent ? "async (not allowed in function graphs)" : null,
        detail.hideInPalette ? "hidden from the palette" : null,
        detail.requiresListItemContext ? "needs a list item template scope" : null,
        detail.role ? `role: ${detail.role}` : null,
    ].filter(Boolean);
    lines.push(`  traits     ${traits.join(", ")}`);
    if (detail.scope) {
        lines.push(`  scope      ${JSON.stringify(detail.scope)}`);
    }
    if (detail.keywords.length > 0) {
        lines.push(`  keywords   ${detail.keywords.join(", ")}`);
    }

    for (const side of ["input", "output"] as const) {
        const pins = detail.pins.filter(pin => pin.kind === side);
        if (pins.length === 0) {
            continue;
        }
        lines.push("", `  ${side === "input" ? "inputs" : "outputs"}`);
        const width = Math.max(...pins.map(pin => pin.id.length));
        for (const pin of pins) {
            const bits = [
                pin.semantic === "exec" ? "exec" : `data:${pin.valueType ?? "any"}`,
                pin.optional ? "optional" : null,
                pin.acceptsLiteral ? "takes a literal" : null,
                pin.assetRef ? "asset id" : null,
            ].filter(Boolean);
            lines.push(`    ${pin.id.padEnd(width)}  ${bits.join(", ")}${pin.label ? `  - ${pin.label}` : ""}`);
        }
    }

    if (detail.fields.length > 0) {
        lines.push("", "  fields (write these as `key = value` under the node)");
        const width = Math.max(...detail.fields.map(field => field.key.length));
        for (const field of detail.fields) {
            const source = field.optionsFrom
                ? `choose from the project's ${field.optionsFrom}`
                : field.options
                  ? `one of: ${field.options.map(option => option.value).join(", ")}`
                  : field.kind;
            lines.push(`    ${field.key.padEnd(width)}  ${source}${field.label ? `  - ${field.label}` : ""}`);
        }
    }

    if (detail.dynamicPins) {
        lines.push(
            "",
            "  extra pins",
            `    Add pins by listing their ids in the "${detail.dynamicPins.storageKey}" param `
                + `(generated ids look like ${detail.dynamicPins.generatedIdPrefix}_1).`,
        );
    }
    if (detail.saveSchemaPins) {
        lines.push(
            "",
            "  extra pins",
            `    One ${detail.saveSchemaPins.kind} pin per field in the project's save schema, `
                + "named field:<fieldId>.",
        );
    }
    return lines.join("\n");
}
