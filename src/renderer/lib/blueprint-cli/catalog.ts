/**
 * Questions about the node catalogue, answered from the registry instead of from a grep.
 *
 * The catalogue is 600-odd nodes spread over sixty-odd files under `blueprint-nodes/built-in`, and
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

/**
 * One placeholder owner of every kind there is.
 *
 * A record rather than a switch with a default, so that a kind added to `BlueprintOwnerRef` fails
 * to compile here instead of quietly arriving as `globalMain` - which is what `--owner` was doing
 * with every value it did not recognise, answering confidently about the wrong owner.
 */
const SYNTHETIC_OWNERS: Record<BlueprintOwnerRef["kind"], BlueprintOwnerRef> = {
    globalMain: { kind: "globalMain" },
    surfaceMain: { kind: "surfaceMain", surfaceId: "surface" },
    widgetMain: { kind: "widgetMain", surfaceId: "surface", elementId: "element" },
    widgetValue: { kind: "widgetValue", surfaceId: "surface", elementId: "element", propPath: "value" },
    componentWidgetMain: { kind: "componentWidgetMain", componentId: "component", elementId: "element" },
    sharedAsset: { kind: "sharedAsset", assetId: "asset" },
    storyAction: { kind: "storyAction", blueprintId: "blueprint" },
};

/** Every owner kind a blueprint can belong to, in the order `--owner` offers them. */
export const BLUEPRINT_OWNER_KINDS = Object.keys(SYNTHETIC_OWNERS) as BlueprintOwnerRef["kind"][];

/** Every graph kind a node can declare. */
export const BLUEPRINT_GRAPH_KINDS: BlueprintGraphKind[] = ["event", "function", "macro"];

export function syntheticOwner(kind: BlueprintOwnerRef["kind"]): BlueprintOwnerRef {
    return SYNTHETIC_OWNERS[kind] ?? SYNTHETIC_OWNERS.globalMain;
}

/**
 * Widget element types the catalogue knows about, gathered from the scopes nodes declare.
 *
 * There is no list of these to import - an element type is a string on a widget module - but a
 * `--widget` value only changes an answer by matching a scope, so the set of types that appear in
 * one is exactly the set worth accepting.
 */
export function knownWidgetElementTypes(): string[] {
    const out = new Set<string>();
    for (const def of blueprintNodeRegistry.list()) {
        for (const clause of scopeClauses(def.scope)) {
            for (const type of clause.widgetElementTypes ?? []) {
                out.add(type);
            }
        }
    }
    return [...out].sort();
}

type ScopeClause = { widgetElementTypes?: readonly string[] };

function scopeClauses(scope: unknown): ScopeClause[] {
    if (!scope || typeof scope !== "object") {
        return [];
    }
    const record = scope as { anyOf?: ScopeClause[] } & ScopeClause;
    return record.anyOf ? [...record.anyOf, record] : [record];
}

/**
 * The node type a person meant.
 *
 * Exact first. Then the display name, because that is what the palette shows and what a blueprint
 * gets described by - `blueprint node "Play Sound"` used to fail while printing the answer in its
 * own near-miss list. A search that leaves exactly one node standing is that node.
 */
export function resolveNodeType(input: string): string | null {
    const wanted = input.trim();
    if (!wanted) {
        return null;
    }
    if (blueprintNodeRegistry.get(wanted)) {
        return wanted;
    }
    const lower = wanted.toLowerCase();
    const byType = blueprintNodeRegistry.list().find(def => def.type.toLowerCase() === lower);
    if (byType) {
        return byType.type;
    }
    const byName = blueprintNodeRegistry.list().filter(def => def.displayName.toLowerCase() === lower);
    if (byName.length === 1) {
        return byName[0].type;
    }
    const searched = queryNodes({ search: wanted, includeHidden: true });
    return searched.length === 1 ? searched[0].type : null;
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
        /**
         * The pins one add writes, spelled with the first index so they can be copied.
         *
         * A node with grouped pins writes several at once - `Show Confirm` writes a label input and
         * a pressed output together - and the ids carry the suffix, not just the prefix. Saying
         * "generated ids look like button_1" would be wrong for every node in this shape, which is
         * every node that has templates.
         */
        generatedPins: {
            id: string;
            kind: "input" | "output";
            semantic: "exec" | "data";
            valueType?: string;
            label: string;
            acceptsLiteral: boolean;
        }[];
        /** Param holding the author-visible label of each generated pin, when the node has one. */
        labelParamKey?: string;
        /** Param holding a per-pin value type, and what may be written in it. */
        valueTypeParamKey?: string;
        valueTypeOptions?: readonly string[];
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
        dynamicPins: def.dynamicInputPins ? describeDynamicPins(def.dynamicInputPins) : undefined,
        saveSchemaPins: def.saveSchemaPins,
        magicElementTarget: def.magicElementTarget,
    };
}

/**
 * What one add on a variadic node writes, spelled out.
 *
 * The editor generates these ids from the templates rather than from the prefix alone, so the
 * prefix on its own does not say what to write in a file. Rendered at index 1 because that is the
 * first one an author would add, and because a concrete id can be copied.
 */
function describeDynamicPins(
    config: NonNullable<BlueprintNodeDef["dynamicInputPins"]>,
): NonNullable<NodeDetail["dynamicPins"]> {
    const templates = config.generatedPinTemplates ?? [];
    const generatedPins = templates.length
        ? templates.map(template => ({
              id: `${config.generatedIdPrefix}_1_${template.idSuffix}`,
              kind: template.kind ?? ("input" as const),
              semantic: template.semantic ?? ("data" as const),
              valueType: template.semantic === "exec" ? undefined : (template.valueType ?? config.valueType),
              label: template.label,
              acceptsLiteral: template.allowInlineLiteral ?? false,
          }))
        : [
              {
                  id: `${config.generatedIdPrefix}_1`,
                  kind: "input" as const,
                  semantic: "data" as const,
                  valueType: config.valueType,
                  label: config.labelPrefix ?? "Input",
                  acceptsLiteral: config.allowInlineLiteral,
              },
          ];
    return {
        storageKey: config.storageKey,
        generatedIdPrefix: config.generatedIdPrefix,
        valueType: config.valueType,
        fixedDataInputIds: config.fixedDataInputIds,
        addButtonLabel: config.addButtonLabel,
        generatesOutputs: generatedPins.some(pin => pin.kind === "output"),
        generatedPins,
        labelParamKey: config.pinLabelParamKey,
        valueTypeParamKey: config.pinValueTypeParamKey,
        valueTypeOptions: config.pinValueTypeOptions,
    };
}

export function formatNodeList(
    nodes: readonly NodeSummary[],
    options: { total?: number } = {},
): string {
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
    const total = options.total ?? nodes.length;
    lines.push(
        "",
        total > nodes.length
            ? `${nodes.length} of ${total} nodes. Narrow the search, or --limit 0 for all of them.`
            : `${nodes.length} node${nodes.length === 1 ? "" : "s"}.`,
    );
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
        const dynamic = detail.dynamicPins;
        lines.push("", "  extra pins");
        lines.push(`    List the ids you want in the "${dynamic.storageKey}" param. One add writes:`);
        for (const pin of dynamic.generatedPins) {
            const bits = [
                pin.kind,
                pin.semantic === "exec" ? "exec" : `data:${pin.valueType ?? "any"}`,
                pin.acceptsLiteral ? "takes a literal" : null,
            ].filter(Boolean);
            lines.push(`      ${pin.id}  ${bits.join(", ")}  - ${pin.label}`);
        }
        if (dynamic.generatedPins.length > 1) {
            lines.push("    Every id of a group goes in that list, and the number is what pairs them up.");
        }
        if (dynamic.labelParamKey) {
            lines.push(`    Labels by pin id go in "${dynamic.labelParamKey}".`);
        }
        if (dynamic.valueTypeParamKey) {
            const options = dynamic.valueTypeOptions?.length
                ? ` (one of: ${dynamic.valueTypeOptions.join(", ")})`
                : "";
            lines.push(`    Value types by pin id go in "${dynamic.valueTypeParamKey}"${options}.`);
        }
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
