import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { VariableRegistryEntry } from "@shared/types/variables/registry";
import { translate } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n";
import { Services, type WorkspaceContext } from "../../services";
import { LocalBlueprintService } from "../../ui-editor/LocalBlueprintService";
import { UIGraphService } from "../../ui-editor/UIGraphService";
import { UIDocumentService } from "../../ui-editor/UIDocumentService";
import { BlueprintNodeCatalogService } from "../../ui-editor/BlueprintNodeCatalogService";
import { VariableRegistryService } from "../../variables/VariableRegistryService";
import { parseBlueprintOwnerKey } from "../blueprintOwnerKey";
import type { SearchIndexEntry } from "../searchIndexModel";
import type { SearchSource } from "../searchSource";

/** Longest literal kept from a node's params; anything longer is a payload, not a name. */
const MAX_NODE_LITERAL_LENGTH = 80;
/** How many literals one node contributes before the walker gives up on it. */
const MAX_NODE_LITERALS = 6;
/** Depth the walker descends into nested param objects/arrays. */
const MAX_NODE_LITERAL_DEPTH = 2;

const UUID_SHAPED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The authored strings inside a node's params, in declaration order - a comment's text, a variable
 * name, a literal line of dialogue.
 *
 * Deliberately narrow: numbers and booleans carry no identity, and ids (UUID-shaped strings) are
 * the thing the author never types. What is left is what one `Set Image Asset` node has that the
 * seven beside it do not, which is the entire point of collecting them.
 */
function collectNodeLiterals(params: Record<string, unknown> | undefined): string[] {
    const out: string[] = [];
    const visit = (value: unknown, depth: number): void => {
        if (out.length >= MAX_NODE_LITERALS) {
            return;
        }
        if (typeof value === "string") {
            const trimmed = value.trim();
            if (trimmed && trimmed.length <= MAX_NODE_LITERAL_LENGTH && !UUID_SHAPED.test(trimmed)) {
                out.push(trimmed);
            }
            return;
        }
        if (depth >= MAX_NODE_LITERAL_DEPTH || !value || typeof value !== "object") {
            return;
        }
        for (const child of Array.isArray(value) ? value : Object.values(value)) {
            visit(child, depth + 1);
        }
    };
    visit(params, 0);
    return out;
}

/** Localized names for the parts of a blueprint the index cannot name for itself. */
export interface BlueprintEntryLabels {
    /** Shown for an event graph the author never named. */
    unnamedEvent: string;
    /** Shown for a function graph the author never named. */
    unnamedFunction: string;
}

export interface BlueprintExtractionOptions {
    /** Catalog display name for a node type (`Set Image Asset`), falling back to the raw type. */
    resolveNodeLabel: (nodeType: string) => string | undefined;
    /**
     * Human name for an owner slot key - the surface or element the blueprint hangs on. Without it a
     * node hit says only which blueprint it is in, and blueprints are named after their element
     * ("Image"), which is exactly as much provenance as no provenance.
     */
    resolveOwnerLabel?: (ownerKey: string) => string | undefined;
    /**
     * The project variable registry, BOTH scopes.
     *
     * Both, because the registry is the only declaration site either project scope has once the
     * declaration migration has run - a saved variable that lives there and nowhere else was
     * previously unreachable from search entirely, while its persistent sibling was indexed.
     *
     * Story declaration rows are deliberately NOT merged in here: the story source already indexes
     * every one of them (`storyvar:…`) with a jump straight to the declaring row, which is a strictly
     * better target than the global blueprint these rows would land on. Unioning the two surfaces
     * would put the same variable in the result list twice, the second time pointing somewhere the
     * author did not declare it.
     */
    registryVariables?: VariableRegistryEntry[];
    labels: BlueprintEntryLabels;
}

/** The dedup key of a node row: exactly the two strings the row puts on screen. */
function nodeRowKey(entry: SearchIndexEntry): string {
    return `${entry.text}\u0000${entry.detail}`;
}

/**
 * Blueprint slice: the blueprints themselves ("blueprint"), member + persistent variable names
 * ("variable"), and graph nodes ("blueprintNode"). Only blueprints reachable through an owner record
 * are indexed - an unowned blueprint has no editor surface to jump to.
 *
 * **Node rows carry where they are and what they say.** Indexing bare node *type* names produced a
 * result list of clones - eight `Set Image Asset` rows, identical down to the detail line, none of
 * them telling the author which one to pick. So a node's detail line is now its own literal params
 * followed by `owner › graph`, and nodes that still come out identical after that are collapsed to
 * one row carrying {@link SearchIndexEntry.count}. Type names stay searchable (they are still the
 * row title), because "where do I set image assets" is a real question - it just needs an answer
 * the author can read.
 *
 * The collapsing itself is the framework's, declared by {@link blueprintSource.dedupKey}: this
 * function emits one entry per node, in document order, and the dedup pass keeps the first of each
 * indistinguishable set. Node rows are appended after every blueprint and variable row, which is
 * where they have always been.
 */
export function extractBlueprintEntries(
    document: BlueprintDocument,
    options: BlueprintExtractionOptions,
): SearchIndexEntry[] {
    const { resolveNodeLabel, resolveOwnerLabel, registryVariables = [], labels } = options;
    const entries: SearchIndexEntry[] = [];

    // blueprintId → ownerKey (active blueprint first so it wins over historical siblings).
    const ownerKeyByBlueprintId = new Map<string, string>();
    for (const [ownerKey, record] of Object.entries(document.ownerRecords)) {
        for (const blueprintId of [record.activeBlueprintId, ...record.privateBlueprintIds]) {
            if (blueprintId && !ownerKeyByBlueprintId.has(blueprintId)) {
                ownerKeyByBlueprintId.set(blueprintId, ownerKey);
            }
        }
    }

    // Registry variables are project-level (M-VAR), surfaced against the global blueprint when one
    // exists. The id carries the scope because the two scopes have separate entry id spaces and a
    // search row from one must not be able to shadow one from the other.
    const globalRecord = document.ownerRecords["globalMain"];
    if (globalRecord) {
        for (const definition of registryVariables) {
            if (!definition.name) {
                continue;
            }
            entries.push({
                id: `bpvar:${definition.scope}:${definition.id}`,
                group: "variable",
                text: definition.name,
                target: {
                    kind: "blueprint",
                    blueprintId: globalRecord.activeBlueprintId,
                    ownerKey: "globalMain",
                },
            });
        }
    }

    const nodeEntries: SearchIndexEntry[] = [];

    for (const blueprint of Object.values(document.blueprints)) {
        const ownerKey = ownerKeyByBlueprintId.get(blueprint.id);
        if (!ownerKey) {
            continue;
        }
        const ownerLabel = resolveOwnerLabel?.(ownerKey);

        if (blueprint.name) {
            entries.push({
                id: `bp:${blueprint.id}`,
                group: "blueprint",
                text: blueprint.name,
                detail: ownerLabel,
                target: { kind: "blueprint", blueprintId: blueprint.id, ownerKey },
            });
        }

        for (const variable of Object.values(blueprint.members?.variables ?? {})) {
            if (!variable.name) {
                continue;
            }
            entries.push({
                id: `bpvar:${blueprint.id}:${variable.id}`,
                group: "variable",
                text: variable.name,
                detail: ownerLabel ? `${blueprint.name} › ${ownerLabel}` : blueprint.name,
                target: { kind: "blueprint", blueprintId: blueprint.id, ownerKey },
            });
        }

        if (blueprint.program.kind !== "graph") {
            continue;
        }
        type GraphSlot = {
            focus: "event" | "function";
            graphId: string;
            name: string;
            ir: { nodes?: Record<string, { id: string; type: string; params?: Record<string, unknown> }> } | undefined;
        };
        const graphSlots: GraphSlot[] = [
            ...Object.entries(blueprint.program.graphs.events).map(([graphId, slot]) => ({
                focus: "event" as const,
                graphId,
                name: slot.name || labels.unnamedEvent,
                ir: slot.graph,
            })),
            ...Object.entries(blueprint.program.graphs.functions).map(([graphId, slot]) => ({
                focus: "function" as const,
                graphId,
                name: slot.name || labels.unnamedFunction,
                ir: slot.graph,
            })),
        ];

        for (const { focus, graphId, name: graphName, ir } of graphSlots) {
            const where = ownerLabel ? `${ownerLabel} › ${graphName}` : `${blueprint.name} › ${graphName}`;
            for (const node of Object.values(ir?.nodes ?? {})) {
                const label = resolveNodeLabel(node.type) ?? node.type;
                if (!label) {
                    continue;
                }
                const literals = collectNodeLiterals(node.params);
                const [distinguishing, ...rest] = literals;
                nodeEntries.push({
                    id: `bpnode:${blueprint.id}:${graphId}:${node.id}`,
                    group: "blueprintNode",
                    text: label,
                    detail: distinguishing ? `${distinguishing} · ${where}` : where,
                    aux: rest.length > 0 ? rest.join(" ") : undefined,
                    target: {
                        kind: "blueprint",
                        blueprintId: blueprint.id,
                        ownerKey,
                        focusNodeId: node.id,
                        ...(focus === "event" ? { focusEventId: graphId } : { focusFunctionId: graphId }),
                    },
                });
            }
        }
    }

    entries.push(...nodeEntries);
    return entries;
}

/**
 * Name the surface/element a blueprint hangs on, so a node hit can say where it lives.
 *
 * Blueprints are named after the thing they belong to ("Image", "Button"), which reads as no
 * provenance at all once a project has more than one screen - the owner is the part that
 * actually locates it.
 */
function resolveBlueprintOwnerLabel(ctx: WorkspaceContext, ownerKey: string): string | undefined {
    const owner = parseBlueprintOwnerKey(ownerKey);
    if (!owner) {
        return undefined;
    }
    if (owner.ownerKind === "globalMain") {
        return translate("blueprint.owner.global" as TranslationKey);
    }
    if (owner.ownerKind === "storyAction") {
        return translate("blueprint.owner.storyAction" as TranslationKey);
    }
    let document;
    try {
        document = ctx.services.get<UIDocumentService>(Services.UIDocument).getDocument();
    } catch {
        return undefined;
    }
    const parts: string[] = [];
    if (owner.surfaceId) {
        const surface = document.surfaces.find(candidate => candidate.id === owner.surfaceId);
        if (surface?.name) {
            parts.push(surface.name);
        }
    }
    if (owner.componentId) {
        const component = (document.components ?? []).find(candidate => candidate.id === owner.componentId);
        if (component?.name) {
            parts.push(component.name);
        }
    }
    if (owner.elementId) {
        const element = document.elements[owner.elementId];
        const name = element?.name || element?.type;
        if (name) {
            parts.push(name);
        }
    }
    return parts.length > 0 ? parts.join(" › ") : undefined;
}

/**
 * Every blueprint in the project, in one slice.
 *
 * One slice rather than one per blueprint because they all live in a single document, and its only
 * change event (`onGraphsChanged`) fires for the document as a whole - there is nothing finer to
 * subscribe to, so a finer partition would only be a more expensive way to rebuild everything.
 *
 * The one source that dedups: sibling event layers are commonly all named "Layer 1" and sibling
 * widgets all "Image", so identity has to be judged across the whole document, not per graph.
 */
export const blueprintSource: SearchSource = {
    id: "blueprint",
    groups: ["blueprint", "variable", "blueprintNode"],
    dependsOn: [Services.UIGraph, Services.LocalBlueprint, Services.BlueprintNodeCatalog, Services.UIDocument, Services.VariableRegistry],
    extract: ctx => {
        const blueprintService = ctx.services.get<LocalBlueprintService>(Services.LocalBlueprint);
        const catalog = ctx.services.get<BlueprintNodeCatalogService>(Services.BlueprintNodeCatalog);
        return extractBlueprintEntries(blueprintService.getBlueprintDocument(), {
            resolveNodeLabel: type => {
                try {
                    return catalog.resolveCatalogEntry(type).displayName;
                } catch {
                    return undefined;
                }
            },
            resolveOwnerLabel: ownerKey => resolveBlueprintOwnerLabel(ctx, ownerKey),
            registryVariables: [...blueprintService.listPersistentVariables(), ...blueprintService.listSavedVariables()],
            labels: {
                unnamedEvent: translate("blueprint.memberTree.unnamedEvent" as TranslationKey),
                unnamedFunction: translate("blueprint.memberTree.unnamedFunction" as TranslationKey),
            },
        });
    },
    // Two documents feed this slice and they go stale independently. The blueprint document lives
    // inside the graph document, so its mutations surface there - but the variable registry is its
    // own file, and a registry edit does NOT bump the graph revision. Watching only the graph left a
    // variable renamed in the variables panel showing its old name in search until something
    // unrelated happened to touch a blueprint.
    watch: (ctx, signal) => {
        const graphs = ctx.services
            .get<UIGraphService>(Services.UIGraph)
            .onGraphsChanged(() => signal.invalidate());
        const registry = ctx.services
            .get<VariableRegistryService>(Services.VariableRegistry)
            .onRegistryChanged(() => signal.invalidate());
        return () => {
            graphs();
            registry();
        };
    },
    dedupKey: entry => (entry.group === "blueprintNode" ? nodeRowKey(entry) : null),
};
