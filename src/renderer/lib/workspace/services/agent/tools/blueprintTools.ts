/**
 * The `.bp` text-format tools: the node catalogue (plugin nodes included), the blueprint list, a
 * blueprint printed as text, and blueprints written back from it.
 *
 * Each is the `blueprint` command line's body (`@/lib/agent-core`) over the live blueprint document
 * `UIGraphService` holds. Studio's own services have already registered every node, page parameter
 * and save field the bodies read, so nothing is seeded here.
 *
 * A write is one step of undo. Blueprints that all belong to one page (its own, its widgets', its
 * bound values) or to one component definition's widgets go on that editor's stack, whose snapshot
 * carries those blueprints with the page (`UIEditorHistoryService.captureSnapshot`). Anything else -
 * the global blueprint, a story action's, or blueprints spread over several pages - goes on the
 * project's stack as a command over exactly the owner records and blueprints the write touched.
 *
 * Comments in English per project convention.
 */

import { getInterface } from "@/lib/app/bridge";
import {
    applyBlueprintsToDocument,
    BLUEPRINT_OWNER_KINDS,
    blueprintListCommand,
    blueprintNodeCommand,
    blueprintNodesCommand,
    blueprintShowCommand,
    checkBlueprintSource,
    commandText,
    formatBlueprintDiagnostics,
    listNodeCategories,
} from "@/lib/agent-core";
import type { Blueprint, BlueprintDocument, BlueprintOwnerRef, BlueprintPrivateOwnerRecord } from "@shared/types/blueprint/document";
import { buildUIComponentEditorSurfaceId } from "@shared/types/ui-editor/componentInstanceKey";
import { readTypedBlueprintOwnerKey } from "@shared/blueprint/ownerKey";
import { ownerRefToIndexKey } from "../../ui-editor/blueprint/ownerKeys";
import { Services, type WorkspaceContext } from "../../services";
import type { BlueprintNodeCatalogService } from "../../ui-editor/BlueprintNodeCatalogService";
import type { UIGraphService } from "../../ui-editor/UIGraphService";
import type { HistoryService } from "../../history/HistoryService";
import { projectHistoryScope } from "../../history/historyScopes";
import {
    answer,
    readOptionalBoolean,
    readOptionalInteger,
    readOptionalString,
    readString,
    refuse,
    type AgentToolHandler,
} from "../agentCall";
import { AGENT_HISTORY_LABEL } from "../agentLookups";
import { readSource } from "./storyTextTools";
import { blueprintInputOf, capText, checkFailed, cloneJson, liveBlueprintDocument, uiDocumentService } from "./textFormat";

// ── Catalogue ────────────────────────────────────────────────────────────────────────────────────

export const blueprintNodes: AgentToolHandler = async args => {
    const query = readOptionalString(args, "query");
    const categoryArg = readOptionalString(args, "category");
    const ownerArg = readOptionalString(args, "owner");
    const widget = readOptionalString(args, "widget");
    const limit = readOptionalInteger(args, "limit", { min: 0, max: 1000 });
    const categories = listNodeCategories().map(item => item.category);
    const category = categoryArg ? categories.find(item => item.toLowerCase() === categoryArg.toLowerCase()) : undefined;
    if (categoryArg && !category) {
        throw refuse("invalid_args", `"${categoryArg}" is not a node category. The categories are: ${categories.join(", ")}.`);
    }
    const ownerKind = ownerArg ? BLUEPRINT_OWNER_KINDS.find(item => item.toLowerCase() === ownerArg.toLowerCase()) : undefined;
    if (ownerArg && !ownerKind) {
        throw refuse("invalid_args", `"${ownerArg}" is not an owner kind. The owner kinds are: ${BLUEPRINT_OWNER_KINDS.join(", ")}.`);
    }
    const result = blueprintNodesCommand({ search: query, category, ownerKind, widgetElementType: widget, limit });
    const text = [...result.err, commandText(result)].join("\n");
    return answer(capText(text, "Pass `query`, `category` or a lower `limit`."));
};

export const blueprintNode: AgentToolHandler = async (args, { ctx }) => {
    const type = readString(args, "type");
    const catalog = ctx.services.get<BlueprintNodeCatalogService>(Services.BlueprintNodeCatalog);
    const nodeOwnerOf = (nodeType: string) => catalog.getNodeOwner(nodeType);
    // Whether the owning plugin ships with Studio changes one line of the answer, and is only
    // worth a round trip to main when the node belongs to a plugin at all.
    let bundled: ReadonlySet<string> | null = null;
    const first = blueprintNodeCommand(type, { nodeOwnerOf });
    if (first.exitCode === 0 && first.out.some(line => line.includes("  plugin "))) {
        const listed = await getInterface().plugins.list().catch(() => null);
        if (listed?.success) {
            bundled = new Set(listed.data.plugins.filter(plugin => plugin.builtIn).map(plugin => plugin.pluginId));
        }
    }
    const result = bundled
        ? blueprintNodeCommand(type, { nodeOwnerOf, isBundledPlugin: pluginId => bundled!.has(pluginId) })
        : first;
    if (result.exitCode !== 0) {
        throw refuse("not_found", result.err.join(" "), "Call blueprint_nodes to search the catalogue.");
    }
    return answer([...result.err, commandText(result)].join("\n"), { type });
};

export const blueprintList: AgentToolHandler = async (args, { ctx }) => {
    const query = readOptionalString(args, "query");
    // Most owners hold an empty blueprint (a widget gets one when its graph is first opened), so an
    // unfiltered list leaves them out; a query lists every match, empty or not.
    const result = blueprintListCommand(liveBlueprintDocument(ctx), { search: query, withGraphs: !query });
    const text = commandText(result).replace(" (--with-graphs).", query ? "." : "; pass `query` to list the empty ones too.");
    return answer(capText(text, "Pass `query` to narrow it."));
};

/** What `blueprint_show` matches stored owner keys against, for a `blueprint` that names no blueprint. */
export function ownerQueryOf(wanted: string): string {
    const owner = readTypedBlueprintOwnerKey(wanted);
    return owner ? ownerRefToIndexKey(owner) : wanted;
}

export const blueprintShow: AgentToolHandler = async (args, { ctx, request, follow }) => {
    const wanted = readString(args, "blueprint");
    const document = liveBlueprintDocument(ctx);
    let shown = blueprintShowCommand(document, { blueprint: wanted });
    if (shown.exitCode !== 0) {
        // An owner key names all of that owner's blueprints - escaped as stored, or written the way
        // its ids read (`widgetMain:narraleaf-studio:main-surface:<element>`, whose surface id holds
        // the separator). Either way it is turned into the stored spelling before it is matched.
        shown = blueprintShowCommand(document, { owner: ownerQueryOf(wanted) });
    }
    if (shown.exitCode !== 0) {
        throw refuse("not_found", `No blueprint matches "${wanted}".`, "Call blueprint_list for the blueprints and their owners.");
    }
    follow.describeCall(request.callId, shown.blueprints.map(item => item.name).join(", "));
    return answer(capText([...shown.err, commandText(shown)].join("\n"), "Name one blueprint by id."), {
        blueprints: shown.blueprints.map(item => ({ id: item.id, name: item.name, owner: ownerRefToIndexKey(item.owner) })),
    });
};

// ── blueprint_apply ──────────────────────────────────────────────────────────────────────────────

/** The undo stack an owner's blueprints belong to: a page's or component's, or none (the project's). */
export function historySurfaceOf(owner: BlueprintOwnerRef): string | null {
    switch (owner.kind) {
        case "surfaceMain":
        case "widgetMain":
        case "widgetValue":
            return owner.surfaceId;
        case "componentWidgetMain":
            return buildUIComponentEditorSurfaceId(owner.componentId);
        default:
            return null;
    }
}

/** The one editor stack every blueprint in a write belongs to, or null when there is none. */
export function sharedHistorySurface(blueprints: readonly Blueprint[]): string | null {
    const surfaces = new Set(blueprints.map(blueprint => historySurfaceOf(blueprint.owner)));
    const [only] = surfaces;
    return surfaces.size === 1 && only ? only : null;
}

type BlueprintSlice = {
    owners: Record<string, BlueprintPrivateOwnerRecord | null>;
    blueprints: Record<string, Blueprint | null>;
};

function captureSlice(document: BlueprintDocument, ownerKeys: readonly string[], blueprintIds: ReadonlySet<string>): BlueprintSlice {
    return {
        owners: Object.fromEntries(ownerKeys.map(key => [key, document.ownerRecords[key] ? cloneJson(document.ownerRecords[key]) : null])),
        blueprints: Object.fromEntries([...blueprintIds].map(id => [id, document.blueprints[id] ? cloneJson(document.blueprints[id]) : null])),
    };
}

function restoreSlice(document: BlueprintDocument, slice: BlueprintSlice): void {
    for (const [key, record] of Object.entries(slice.owners)) {
        if (record) {
            document.ownerRecords[key] = cloneJson(record);
        } else {
            delete document.ownerRecords[key];
        }
    }
    for (const [id, blueprint] of Object.entries(slice.blueprints)) {
        if (blueprint) {
            document.blueprints[id] = cloneJson(blueprint);
        } else {
            delete document.blueprints[id];
        }
    }
}

/**
 * Write compiled blueprints into the live document as one step of undo; see the file comment for
 * which stack it goes on.
 */
export function commitBlueprints(ctx: WorkspaceContext, blueprints: readonly Blueprint[]): void {
    const graph = ctx.services.get<UIGraphService>(Services.UIGraph);
    const ownerRecords = Object.fromEntries(blueprints.map(blueprint => [ownerRefToIndexKey(blueprint.owner), { blueprintId: blueprint.id }]));
    // Copied on every application: the document edits the records it holds in place.
    const write = () => graph.applyGraphMutation(document => {
        applyBlueprintsToDocument(document.blueprintDocument, cloneJson(blueprints) as Blueprint[], cloneJson(ownerRecords));
    });

    const surfaceId = sharedHistorySurface(blueprints);
    if (surfaceId) {
        uiDocumentService(ctx).runSurfaceHistoryTransaction(surfaceId, write, { label: AGENT_HISTORY_LABEL });
        return;
    }
    const live = graph.getDocument().blueprintDocument;
    const ownerKeys = Object.keys(ownerRecords);
    const blueprintIds = new Set([
        ...blueprints.map(blueprint => blueprint.id),
        ...ownerKeys.map(key => live.ownerRecords[key]?.blueprintId).filter((id): id is string => Boolean(id)),
    ]);
    const before = captureSlice(live, ownerKeys, blueprintIds);
    write();
    const after = captureSlice(graph.getDocument().blueprintDocument, ownerKeys, blueprintIds);
    const restore = (slice: BlueprintSlice) => graph.applyGraphMutation(document => restoreSlice(document.blueprintDocument, slice));
    ctx.services.get<HistoryService>(Services.History).pushCommand(projectHistoryScope(), {
        label: AGENT_HISTORY_LABEL,
        undo: () => restore(before),
        redo: () => restore(after),
    });
}

export const blueprintApply: AgentToolHandler = async (args, { ctx, request, follow }) => {
    const source = readSource(args);
    const dryRun = readOptionalBoolean(args, "dryRun") ?? false;
    const live = liveBlueprintDocument(ctx);
    const input = await blueprintInputOf(ctx, live);
    const check = checkBlueprintSource(source, input);
    const report = formatBlueprintDiagnostics(check.diagnostics, { source });
    if (!check.ok) {
        throw checkFailed(report, "Fix the errors and apply again; blueprint_node lists a node's pins.");
    }
    const blueprints = check.blueprints;
    if (blueprints.length === 0) {
        throw refuse("invalid_args", "The source holds no `blueprint` block, so there is nothing to write.");
    }
    follow.describeCall(request.callId, blueprints.map(blueprint => blueprint.name).join(", "));
    const added = blueprints.filter(blueprint => !live.blueprints[blueprint.id]).map(blueprint => blueprint.name);
    const replaced = blueprints.filter(blueprint => live.blueprints[blueprint.id]).map(blueprint => blueprint.name);

    if (!dryRun) {
        commitBlueprints(ctx, blueprints);
        follow.noteWrite({ kind: "blueprint", blueprintId: blueprints[0].id, name: blueprints[0].name });
    }
    const quote = (names: readonly string[]) => names.map(name => `"${name}"`).join(", ");
    const what = [added.length > 0 ? `add ${quote(added)}` : null, replaced.length > 0 ? `replace ${quote(replaced)}` : null]
        .filter(Boolean)
        .join(", and ");
    const lines = [
        ...(check.diagnostics.length > 0 ? [report, ""] : []),
        dryRun ? `Would ${what || "change nothing"} (dry run: nothing written).` : `Wrote the project's blueprints: ${what || "no change"}. One step of undo in Studio.`,
    ];
    return answer(capText(lines.join("\n"), "Apply fewer blueprints per call."), {
        dryRun,
        written: !dryRun,
        added,
        replaced,
        blueprints: blueprints.map(blueprint => ({ id: blueprint.id, name: blueprint.name, owner: ownerRefToIndexKey(blueprint.owner) })),
    });
};
