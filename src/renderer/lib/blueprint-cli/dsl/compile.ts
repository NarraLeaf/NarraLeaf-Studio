/**
 * AST -> `BlueprintDocument` entries, checked against the live node registry as it goes.
 *
 * Every question the compiler asks - does this node type exist, does it have this pin, is this
 * param one the node declares, may these two pins be joined - is answered by the same registry the
 * editor's canvas asks, so a file that compiles clean is a file the editor would have let someone
 * draw. Nothing here restates the catalogue.
 *
 * Comments in English per project convention.
 */

import type {
    Blueprint,
    BlueprintDocument,
    BlueprintEventGraph,
    BlueprintFunctionGraph,
    BlueprintGraphEdge,
    BlueprintGraphIr,
    BlueprintGraphNode,
    BlueprintMemberIndex,
    BlueprintOwnerRef,
    BlueprintPrivateOwnerRecord,
    BlueprintVariable,
} from "@shared/types/blueprint/document";
import type { UIElement } from "@shared/types/ui-editor/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import {
    blueprintNodeRegistry,
    isBlueprintNodeAllowedInGraphContext,
} from "@/lib/ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import { buildBlueprintGraphContext } from "@/lib/ui-editor/blueprint-nodes/graphContext";
import type { BlueprintNodeDef } from "@/lib/ui-editor/blueprint-nodes/types";
import { isValidBlueprintPinConnection } from "@/lib/ui-editor/blueprint-nodes/connectionPolicy";
import {
    BLUEPRINT_NODE_PARAMS_INLINE_LITERAL_PINS_KEY,
} from "@/lib/ui-editor/blueprint-nodes/types";
import { ownerRefToIndexKey } from "@services/ui-editor/blueprint/ownerKeys";
import type { BpBlueprintAst, BpDiagnostic, BpDocumentAst, BpEndpointAst, BpGraphAst, BpNodeAst } from "./ast";
import { autoLayout } from "./layout";
import { valueToJs } from "./values";

export type BpCompileOptions = {
    /**
     * The document the result will be written into. Read for two things only: the id a blueprint
     * already has for this owner, and where its nodes already sit on the canvas - so recompiling a
     * file does not re-key the document or shuffle an author's layout.
     */
    existing?: BlueprintDocument | null;
    /** Overridable so tests do not depend on random ids. */
    newId?: () => string;
    /**
     * The element type behind a `widgetMain` / `componentWidgetMain` owner, when it can be looked
     * up. Which event heads a widget may carry depends on it (a button has `Mouse Click`, a plain
     * container does not), so without it that check is skipped rather than guessed at.
     */
    resolveWidgetElementType?: (owner: BlueprintOwnerRef) => string | undefined;
    /**
     * The type of any element in the project, by id.
     *
     * An `Element` node stores the type beside the id, and every reader of that reference checks it
     * before doing anything - so a reference written without one resolves to nothing at all, silently.
     * Given this, a file that names an element by id gets the type filled in rather than having to
     * carry a line no author would think to write.
     */
    resolveElementType?: (elementId: string) => string | undefined;
    /**
     * Every element in the project, by id, so that the scopes which depend on where an element sits
     * can be walked. Without it such a scope counts as reachable rather than as absent - see
     * `BlueprintGraphContextInput`.
     */
    uiElements?: Readonly<Record<string, UIElement>>;
};

export type BpCompileResult = {
    blueprints: Blueprint[];
    ownerRecords: Record<string, BlueprintPrivateOwnerRecord>;
    diagnostics: BpDiagnostic[];
};

const OWNER_REQUIRED_FIELDS: Record<string, string[]> = {
    globalMain: [],
    surfaceMain: ["surfaceId"],
    widgetMain: ["surfaceId", "elementId"],
    widgetValue: ["surfaceId", "elementId", "propPath"],
    componentWidgetMain: ["componentId", "elementId"],
    storyAction: ["blueprintId"],
};

export function compileBlueprintDocument(
    ast: BpDocumentAst,
    options: BpCompileOptions = {},
): BpCompileResult {
    const diagnostics: BpDiagnostic[] = [];
    const newId = options.newId ?? (() => randomUuid());
    const blueprints: Blueprint[] = [];
    const ownerRecords: Record<string, BlueprintPrivateOwnerRecord> = {};

    for (const blueprintAst of ast.blueprints) {
        const compiled = compileBlueprint(blueprintAst, options, newId, diagnostics);
        if (!compiled) {
            continue;
        }
        blueprints.push(compiled);
        ownerRecords[ownerRefToIndexKey(compiled.owner)] = {
            activeBlueprintId: compiled.id,
            privateBlueprintIds: [compiled.id],
        };
    }

    return { blueprints, ownerRecords, diagnostics };
}

function compileBlueprint(
    ast: BpBlueprintAst,
    options: BpCompileOptions,
    newId: () => string,
    diagnostics: BpDiagnostic[],
): Blueprint | null {
    const owner = buildOwnerRef(ast, diagnostics);
    if (!owner) {
        return null;
    }
    const previous = findExistingBlueprint(options.existing ?? null, ast.id, owner);
    const id = ast.id ?? previous?.id ?? newId();

    const events: Record<string, BlueprintEventGraph> = {};
    const eventIds: string[] = [];
    const functions: Record<string, BlueprintFunctionGraph> = {};
    const functionIds: string[] = [];

    for (const graphAst of ast.graphs) {
        const previousGraph = findExistingGraph(previous, graphAst);
        const graphId = graphAst.id ?? previousGraph?.id ?? newId();
        const ir = compileGraph(graphAst, owner, previousGraph?.graph ?? null, options, diagnostics);
        if (graphAst.kind === "event") {
            if (events[graphId]) {
                pushError(diagnostics, graphAst.line, "compile.duplicate_graph", `Two event layers share id "${graphId}".`);
                continue;
            }
            events[graphId] = { id: graphId, name: graphAst.name, graph: ir };
            eventIds.push(graphId);
        } else {
            if (functions[graphId]) {
                pushError(diagnostics, graphAst.line, "compile.duplicate_graph", `Two functions share id "${graphId}".`);
                continue;
            }
            functions[graphId] = { id: graphId, name: graphAst.name, graph: ir };
            functionIds.push(graphId);
        }
    }

    reportDroppedGraphs(previous, ast, eventIds, functionIds, diagnostics);

    const variables: Record<string, BlueprintVariable> = {};
    for (const variableAst of ast.variables) {
        const variableId = variableAst.id ?? previousVariableId(previous, variableAst.name) ?? newId();
        variables[variableId] = {
            id: variableId,
            name: variableAst.name,
            ...(variableAst.valueType ? { valueType: variableAst.valueType } : {}),
            ...(variableAst.defaultValue
                ? { defaultValue: valueToJs(variableAst.defaultValue) as BlueprintVariable["defaultValue"] }
                : {}),
        };
    }

    const blueprint: Blueprint = {
        id,
        name: ast.name,
        owner,
        frontend: "visual",
        programKind: "graph",
        program: { kind: "graph", graphs: { eventIds, events, functionIds, functions } },
        members: {
            variables,
            fields: (ast.fields as BlueprintMemberIndex["fields"]) ?? {},
            functions: (ast.functions as BlueprintMemberIndex["functions"]) ?? {},
        },
        bindings: (ast.bindings as Blueprint["bindings"]) ?? {},
    };
    if (ast.meta && typeof ast.meta === "object") {
        blueprint.meta = ast.meta as Record<string, unknown>;
    }
    return blueprint;
}

/**
 * A file describes a whole blueprint, so compiling one replaces every graph it holds - including the
 * layers the file did not mention. That is the right rule (there is nowhere else for "delete this
 * layer" to live) and a quiet way to lose work, so what is about to go is named.
 */
function reportDroppedGraphs(
    previous: Blueprint | null,
    ast: BpBlueprintAst,
    eventIds: readonly string[],
    functionIds: readonly string[],
    diagnostics: BpDiagnostic[],
): void {
    if (!previous || previous.program.kind !== "graph") {
        return;
    }
    const kept = new Set([...eventIds, ...functionIds]);
    const dropped: string[] = [];
    for (const [kind, pool] of [
        ["event", previous.program.graphs.events],
        ["function", previous.program.graphs.functions],
    ] as const) {
        for (const [id, graph] of Object.entries(pool ?? {})) {
            if (!kept.has(id)) {
                dropped.push(`${kind} "${graph.name ?? id}" (${id})`);
            }
        }
    }
    if (dropped.length > 0) {
        diagnostics.push({
            severity: "warning",
            code: "compile.graph_dropped",
            line: ast.line,
            message: `Replacing "${ast.name}" removes ${dropped.length} graph(s) the file does not `
                + `mention: ${dropped.join(", ")}.`,
            hint: "Run `blueprint show --project <dir> --blueprint <name>` first and edit that, or "
                + "name the layer in this file to keep it.",
        });
    }
}

function compileGraph(
    ast: BpGraphAst,
    owner: BlueprintOwnerRef,
    previous: BlueprintGraphIr | null,
    options: BpCompileOptions,
    diagnostics: BpDiagnostic[],
): BlueprintGraphIr {
    const nodes: Record<string, BlueprintGraphNode> = {};
    const params = new Map<string, Record<string, unknown>>();
    const declared = new Map<string, BpNodeAst>();

    for (const nodeAst of ast.nodes) {
        if (declared.has(nodeAst.id)) {
            pushError(
                diagnostics,
                nodeAst.line,
                "compile.duplicate_node",
                `Node id "${nodeAst.id}" is declared twice in "${ast.name}".`,
            );
            continue;
        }
        declared.set(nodeAst.id, nodeAst);
        params.set(nodeAst.id, compileParams(nodeAst, ast, owner, options, diagnostics));
    }

    const edges: BlueprintGraphEdge[] = [];
    const usedInputs = new Map<string, number>();
    const pushEdge = (
        fromRef: BpEndpointAst,
        toRef: BpEndpointAst,
        line: number,
        toPinOverride?: string,
    ): void => {
        const from = resolveEndpoint(fromRef, "output", declared, params, diagnostics);
        const to = toPinOverride
            ? resolveNamedPin(toRef, toPinOverride, "input", declared, params, diagnostics)
            : resolveEndpoint(toRef, "input", declared, params, diagnostics);
        if (!from || !to) {
            return;
        }
        const sourceAst = declared.get(from.nodeId) as BpNodeAst;
        const targetAst = declared.get(to.nodeId) as BpNodeAst;
        if (
            !isValidBlueprintPinConnection({
                sourceType: sourceAst.type,
                sourcePort: from.port,
                targetType: targetAst.type,
                targetPort: to.port,
                sourceParams: params.get(from.nodeId),
                targetParams: params.get(to.nodeId),
            })
        ) {
            // A warning, and the edge is kept. The canvas refuses to DRAW a pairing like this, but a
            // document that already holds one loads and runs, and the editor's own validator reports
            // it as a warning - the shipped skeleton contains one (an integer index feeding a json
            // Result). Refusing here would mean this tool could not write back a project Studio ships.
            diagnostics.push({
                severity: "warning",
                code: "compile.incompatible_pins",
                line,
                message: `${from.nodeId}.${from.port} would not be drawable onto ${to.nodeId}.${to.port}.`,
                hint: describePinPair(sourceAst.type, from.port, targetAst.type, to.port, params),
            });
        }
        const targetPin = catalogFor(to.nodeId, declared, params).pins.find(
            pin => pin.id === to.port && pin.kind === "input",
        );
        // Execution converges: several branches may end at the same node, and the skeleton does
        // exactly that. A data input takes one value, so a second edge into one is a mistake.
        if (targetPin?.semantic === "data") {
            const key = `${to.nodeId}.${to.port}`;
            usedInputs.set(key, (usedInputs.get(key) ?? 0) + 1);
            if ((usedInputs.get(key) as number) > 1) {
                pushError(
                    diagnostics,
                    line,
                    "compile.input_pin_taken",
                    `${key} is fed by more than one edge.`,
                    "A data input takes one value; fan-out belongs on the output side.",
                );
                return;
            }
        }
        edges.push({ from: { nodeId: from.nodeId, port: from.port }, to: { nodeId: to.nodeId, port: to.port } });
    };

    for (const nodeAst of ast.nodes) {
        for (const input of nodeAst.inputs) {
            pushEdge(input.source, { raw: nodeAst.id, line: input.line }, input.line, input.pin);
        }
    }
    for (const edge of ast.edges) {
        pushEdge(edge.from, edge.to, edge.line);
    }

    const placements = autoLayout(
        [...declared.keys()],
        edges.map(edge => ({ from: edge.from.nodeId, to: edge.to.nodeId })),
    );
    for (const [id, nodeAst] of declared) {
        const layout = nodeAst.layout ?? previous?.nodes?.[id]?.meta?.editorLayout ?? placements[id];
        nodes[id] = {
            id,
            type: nodeAst.type,
            params: params.get(id) ?? {},
            meta: { editorLayout: layout as { x: number; y: number } },
        };
    }

    const meta: Record<string, unknown> = { graphKind: ast.kind };
    if (ast.meta && typeof ast.meta === "object") {
        Object.assign(meta, ast.meta as Record<string, unknown>);
        meta.graphKind = ast.kind;
    }
    return { nodes, edges, meta };
}

function compileParams(
    nodeAst: BpNodeAst,
    graphAst: BpGraphAst,
    owner: BlueprintOwnerRef,
    options: BpCompileOptions,
    diagnostics: BpDiagnostic[],
): Record<string, unknown> {
    const raw: Record<string, unknown> = {};
    for (const param of nodeAst.params) {
        raw[param.key] = valueToJs(param.value);
    }

    const widgetElementType = isWidgetOwner(owner) ? options.resolveWidgetElementType?.(owner) : undefined;
    const widgetElement = "elementId" in owner ? options.uiElements?.[owner.elementId] : undefined;
    const definition = blueprintNodeRegistry.get(nodeAst.type);
    if (!definition) {
        pushError(
            diagnostics,
            nodeAst.line,
            "compile.unknown_node_type",
            `Unknown node type "${nodeAst.type}".`,
            suggestHint(nodeAst.type, blueprintNodeRegistry.list().map(def => def.type)),
        );
        return raw;
    }
    if (!definition.graphKinds.includes(graphAst.kind)) {
        pushError(
            diagnostics,
            nodeAst.line,
            "compile.wrong_graph_kind",
            `"${definition.displayName}" (${nodeAst.type}) is not allowed in a ${graphAst.kind} graph.`,
            `It is available in: ${definition.graphKinds.join(", ")}.`,
        );
    } else if (
        !isBlueprintNodeAllowedInGraphContext(definition, buildBlueprintGraphContext({
            graphKind: graphAst.kind,
            owner,
            widgetElementType,
            widgetElement,
            uiDocument: options.uiElements ? { elements: options.uiElements } : null,
            isComponentDefinitionGraph: owner.kind === "componentWidgetMain",
        }))
        && !(definition.role === "eventHead" && isWidgetOwner(owner) && !widgetElementType)
    ) {
        diagnostics.push({
            severity: "warning",
            code: "compile.out_of_scope",
            line: nodeAst.line,
            message: `"${definition.displayName}" (${nodeAst.type}) is not offered for owner ${owner.kind}.`,
            hint: "The palette hides it here; the editor may still refuse it. Check `blueprint node "
                + `${nodeAst.type}\` for its scope.`,
        });
    }

    const entry = blueprintNodeRegistry.resolveCatalogEntryForNode(nodeAst.type, raw);
    const paramKeys = new Set((entry.inspectorParams ?? []).map(item => item.key));
    const dataInputs = new Map(
        entry.pins.filter(pin => pin.kind === "input" && pin.semantic === "data").map(pin => [pin.id, pin]),
    );
    const writableKeys = [
        ...paramKeys,
        ...[...dataInputs.values()].filter(pin => pin.allowInlineLiteral).map(pin => pin.id),
    ];
    const inlineLiteralPins: string[] = Array.isArray(raw[BLUEPRINT_NODE_PARAMS_INLINE_LITERAL_PINS_KEY])
        ? [...(raw[BLUEPRINT_NODE_PARAMS_INLINE_LITERAL_PINS_KEY] as string[])]
        : [];

    for (const param of nodeAst.params) {
        if (param.key.startsWith("__")) {
            // Editor bookkeeping (dynamic pin lists, card state). Written verbatim; the registry
            // reads them back when it resolves this node's effective pins.
            continue;
        }
        if (paramKeys.has(param.key)) {
            continue;
        }
        const pin = dataInputs.get(param.key);
        if (pin) {
            if (pin.allowInlineLiteral && !inlineLiteralPins.includes(param.key)) {
                inlineLiteralPins.push(param.key);
            }
            continue;
        }
        // Only worth saying when the node has a vocabulary to have got wrong. A definition declares
        // the fields its inspector renders, not every key the editor may store: `Element` keeps the
        // surface and element it points at in params and declares neither, and the skeleton holds
        // ninety of them - warning about those would bury the one that is a typo.
        if (writableKeys.length === 0) {
            continue;
        }
        diagnostics.push({
            severity: "warning",
            code: "compile.unknown_param",
            line: param.line,
            message: `"${definition.displayName}" declares no field or input pin called "${param.key}".`,
            hint: describeParamOptions(entry),
        });
    }
    if (inlineLiteralPins.length > 0) {
        raw[BLUEPRINT_NODE_PARAMS_INLINE_LITERAL_PINS_KEY] = inlineLiteralPins;
    }
    fillElementReferenceType(nodeAst, definition, raw, options, diagnostics);
    return raw;
}

/**
 * Give an element reference the type its readers check for.
 *
 * Every node that follows an element reference asks what type it points at before it does anything -
 * a list node wants `nl.list`, a text node wants `nl.text` - so a reference carrying an id and no
 * type resolves to nothing. Nothing is reported when that happens: the graph runs, the node returns
 * undefined, and whatever read it just quietly does not fire. The editor writes the type as a matter
 * of course because it always knows it; a file written by hand has no reason to.
 */
function fillElementReferenceType(
    nodeAst: BpNodeAst,
    definition: BlueprintNodeDef,
    raw: Record<string, unknown>,
    options: BpCompileOptions,
    diagnostics: BpDiagnostic[],
): void {
    const elementId = raw.elementId;
    if (definition.role !== "elementLiteral" || typeof elementId !== "string" || !elementId || raw.elementType) {
        return;
    }
    const resolved = options.resolveElementType?.(elementId);
    if (resolved) {
        raw.elementType = resolved;
        return;
    }
    diagnostics.push({
        severity: "warning",
        code: "compile.element_type_unknown",
        line: nodeAst.line,
        message: `"${definition.displayName}" points at ${elementId}, which this project does not hold.`,
        hint: "Every node that follows an element reference checks its type first, so one that cannot "
            + "be resolved reads as nothing at all. Run `blueprint targets --project <dir>` for the ids.",
    });
}

type ResolvedEndpoint = { nodeId: string; port: string };

/**
 * Split `sfx.click.next` into a node and a pin, against the ids this graph actually declares.
 *
 * Neither half is a safe guess on its own: node ids may contain dots (`i18n.nConfirm.message`) and
 * pin ids may contain colons (a save-schema pin is `field:<fieldId>`). So the whole string is tried
 * as a node id first, then progressively shorter dotted prefixes, then colon-separated ones - the
 * form the printer falls back to when a dotted spelling would be ambiguous.
 */
function resolveEndpoint(
    ref: BpEndpointAst,
    kind: "input" | "output",
    declared: Map<string, BpNodeAst>,
    params: Map<string, Record<string, unknown>>,
    diagnostics: BpDiagnostic[],
): ResolvedEndpoint | null {
    if (declared.has(ref.raw)) {
        const implicit = defaultPin(ref.raw, kind, declared, params);
        if (implicit) {
            return { nodeId: ref.raw, port: implicit };
        }
        pushError(
            diagnostics,
            ref.line,
            "compile.ambiguous_pin",
            `"${ref.raw}" needs an explicit ${kind} pin.`,
            listPins(catalogFor(ref.raw, declared, params), kind),
        );
        return null;
    }
    for (const separator of [".", ":"]) {
        const positions: number[] = [];
        for (let at = ref.raw.indexOf(separator); at > 0; at = ref.raw.indexOf(separator, at + 1)) {
            positions.push(at);
        }
        // Longest node id first, so `i18n.nConfirm.message.value` finds the node rather than `i18n`.
        for (const at of separator === "." ? positions.reverse() : positions) {
            const candidate = ref.raw.slice(0, at);
            if (declared.has(candidate)) {
                return resolveNamedPin(
                    { raw: candidate, line: ref.line },
                    ref.raw.slice(at + 1),
                    kind,
                    declared,
                    params,
                    diagnostics,
                );
            }
        }
    }
    pushError(
        diagnostics,
        ref.line,
        "compile.unknown_node",
        `No node called "${ref.raw}" in this graph.`,
        suggestHint(ref.raw, [...declared.keys()]),
    );
    return null;
}

function resolveNamedPin(
    ref: BpEndpointAst,
    port: string,
    kind: "input" | "output",
    declared: Map<string, BpNodeAst>,
    params: Map<string, Record<string, unknown>>,
    diagnostics: BpDiagnostic[],
): ResolvedEndpoint | null {
    if (!declared.has(ref.raw)) {
        pushError(
            diagnostics,
            ref.line,
            "compile.unknown_node",
            `No node called "${ref.raw}" in this graph.`,
            suggestHint(ref.raw, [...declared.keys()]),
        );
        return null;
    }
    const entry = catalogFor(ref.raw, declared, params);
    const pin = entry.pins.find(item => item.id === port && item.kind === kind);
    if (!pin) {
        pushError(
            diagnostics,
            ref.line,
            "compile.unknown_pin",
            `"${entry.displayName}" has no ${kind} pin "${port}".`,
            listPins(entry, kind),
        );
        return null;
    }
    return { nodeId: ref.raw, port };
}

/** The pin an endpoint means when the author wrote only a node name. */
function defaultPin(
    nodeId: string,
    kind: "input" | "output",
    declared: Map<string, BpNodeAst>,
    params: Map<string, Record<string, unknown>>,
): string | null {
    const entry = catalogFor(nodeId, declared, params);
    const sameKind = entry.pins.filter(pin => pin.kind === kind);
    const exec = sameKind.filter(pin => pin.semantic === "exec");
    if (exec.length === 1) {
        return exec[0].id;
    }
    if (exec.length > 1) {
        return null;
    }
    const data = sameKind.filter(pin => pin.semantic === "data");
    return data.length === 1 ? data[0].id : null;
}

function catalogFor(
    nodeId: string,
    declared: Map<string, BpNodeAst>,
    params: Map<string, Record<string, unknown>>,
) {
    const node = declared.get(nodeId) as BpNodeAst;
    return blueprintNodeRegistry.resolveCatalogEntryForNode(node.type, params.get(nodeId));
}

function listPins(
    entry: ReturnType<typeof blueprintNodeRegistry.resolveCatalogEntryForNode>,
    kind: "input" | "output",
): string {
    const pins = entry.pins.filter(pin => pin.kind === kind);
    if (pins.length === 0) {
        return `"${entry.displayName}" has no ${kind} pins.`;
    }
    const rendered = pins
        .map(pin => `${pin.id} (${pin.semantic}${pin.valueType ? `:${pin.valueType}` : ""})`)
        .join(", ");
    return `${kind === "input" ? "Inputs" : "Outputs"}: ${rendered}`;
}

function describePinPair(
    sourceType: string,
    sourcePort: string,
    targetType: string,
    targetPort: string,
    params: Map<string, Record<string, unknown>>,
): string {
    void params;
    const source = blueprintNodeRegistry.resolveCatalogEntry(sourceType).pins.find(
        pin => pin.id === sourcePort && pin.kind === "output",
    );
    const target = blueprintNodeRegistry.resolveCatalogEntry(targetType).pins.find(
        pin => pin.id === targetPort && pin.kind === "input",
    );
    const describe = (pin: typeof source): string =>
        pin ? `${pin.semantic}${pin.valueType ? `:${pin.valueType}` : ""}` : "unknown";
    return `${describe(source)} -> ${describe(target)}. Execution pins join execution pins, and a `
        + "data pin only accepts a value type it can hold.";
}

function describeParamOptions(
    entry: ReturnType<typeof blueprintNodeRegistry.resolveCatalogEntryForNode>,
): string {
    const fields = (entry.inspectorParams ?? []).map(item => item.key);
    const pins = entry.pins
        .filter(pin => pin.kind === "input" && pin.semantic === "data")
        .map(pin => pin.id);
    const parts: string[] = [];
    if (fields.length > 0) {
        parts.push(`Fields: ${fields.join(", ")}`);
    }
    if (pins.length > 0) {
        parts.push(`Input pins that take a literal: ${pins.join(", ")}`);
    }
    return parts.length > 0 ? parts.join(". ") : "This node takes no fields.";
}

function isWidgetOwner(owner: BlueprintOwnerRef): boolean {
    return owner.kind === "widgetMain" || owner.kind === "componentWidgetMain";
}

function buildOwnerRef(ast: BpBlueprintAst, diagnostics: BpDiagnostic[]): BlueprintOwnerRef | null {
    const kind = ast.ownerKind;
    const required = OWNER_REQUIRED_FIELDS[kind];
    if (!required) {
        if (kind.length > 0) {
            pushError(
                diagnostics,
                ast.line,
                "compile.unknown_owner",
                `Unknown owner kind "${kind}".`,
                `One of: ${Object.keys(OWNER_REQUIRED_FIELDS).join(", ")}.`,
            );
        }
        return null;
    }
    const missing = required.filter(field => !ast.ownerFields[field]);
    if (missing.length > 0) {
        pushError(
            diagnostics,
            ast.line,
            "compile.missing_owner_field",
            `Owner "${kind}" needs ${missing.join(" and ")}.`,
            "Run `blueprint targets --project <dir>` to look the ids up.",
        );
        return null;
    }
    const fields = ast.ownerFields;
    switch (kind) {
        case "globalMain":
            return { kind: "globalMain" };
        case "surfaceMain":
            return { kind: "surfaceMain", surfaceId: fields.surfaceId };
        case "widgetMain":
            return { kind: "widgetMain", surfaceId: fields.surfaceId, elementId: fields.elementId };
        case "widgetValue":
            return {
                kind: "widgetValue",
                surfaceId: fields.surfaceId,
                elementId: fields.elementId,
                propPath: fields.propPath,
            };
        case "componentWidgetMain":
            return { kind: "componentWidgetMain", componentId: fields.componentId, elementId: fields.elementId };
        case "storyAction":
            return {
                kind: "storyAction",
                blueprintId: fields.blueprintId,
                ...(fields.mode ? { mode: fields.mode as "action" | "value" | "condition" } : {}),
            };
        default:
            return null;
    }
}

function findExistingBlueprint(
    document: BlueprintDocument | null,
    id: string | undefined,
    owner: BlueprintOwnerRef,
): Blueprint | null {
    if (!document) {
        return null;
    }
    if (id && document.blueprints[id]) {
        return document.blueprints[id];
    }
    const ownerKey = ownerRefToIndexKey(owner);
    const activeId = document.ownerRecords?.[ownerKey]?.activeBlueprintId;
    if (activeId && document.blueprints[activeId]) {
        return document.blueprints[activeId];
    }
    return (
        Object.values(document.blueprints).find(
            candidate => ownerRefToIndexKey(candidate.owner) === ownerKey,
        ) ?? null
    );
}

function findExistingGraph(
    previous: Blueprint | null,
    ast: BpGraphAst,
): { id: string; graph?: BlueprintGraphIr } | null {
    if (!previous || previous.program.kind !== "graph") {
        return null;
    }
    const pool = ast.kind === "event" ? previous.program.graphs.events : previous.program.graphs.functions;
    if (!pool) {
        return null;
    }
    if (ast.id && pool[ast.id]) {
        return pool[ast.id];
    }
    return Object.values(pool).find(graph => graph.name === ast.name) ?? null;
}

function previousVariableId(previous: Blueprint | null, name: string): string | undefined {
    const variables = previous?.members?.variables;
    if (!variables) {
        return undefined;
    }
    return Object.values(variables).find(variable => variable.name === name)?.id;
}

function pushError(
    diagnostics: BpDiagnostic[],
    line: number,
    code: string,
    message: string,
    hint?: string,
): void {
    diagnostics.push({ severity: "error", code, message, line, hint });
}

/** Closest few candidates by edit distance, for "no such node type" style messages. */
export function suggest(input: string, candidates: readonly string[], limit = 5): string[] {
    const needle = input.toLowerCase();
    const scored = candidates
        .map(candidate => {
            const lower = candidate.toLowerCase();
            const contains = lower.includes(needle) || needle.includes(lower);
            return { candidate, score: (contains ? 0 : 1000) + editDistance(needle, lower) };
        })
        .sort((a, b) => a.score - b.score || a.candidate.localeCompare(b.candidate));
    return scored.slice(0, limit).map(item => item.candidate);
}

function suggestHint(input: string, candidates: readonly string[]): string | undefined {
    const matches = suggest(input, candidates, 5);
    return matches.length > 0 ? `Did you mean: ${matches.join(", ")}?` : undefined;
}

function editDistance(a: string, b: string): number {
    const rows = a.length + 1;
    const cols = b.length + 1;
    let previous = Array.from({ length: cols }, (_, index) => index);
    for (let i = 1; i < rows; i += 1) {
        const current = [i];
        for (let j = 1; j < cols; j += 1) {
            current[j] = Math.min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
            );
        }
        previous = current;
    }
    return previous[cols - 1];
}

function randomUuid(): string {
    const globalCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (globalCrypto?.randomUUID) {
        return globalCrypto.randomUUID();
    }
    // Node exposes randomUUID on webcrypto from 19 onward; this is the pre-19 shape.
    const bytes = new Uint8Array(16);
    for (let i = 0; i < bytes.length; i += 1) {
        bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export { BLUEPRINT_DOCUMENT_SCHEMA_VERSION };
