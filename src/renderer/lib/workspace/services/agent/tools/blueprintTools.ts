/**
 * The `.bp` text-format tools: the node catalogue (plugin nodes included), the blueprint list, a
 * blueprint printed as text, and blueprints written back from it.
 *
 * Each is the `blueprint` command line's body (`@/lib/agent-core`) over the live blueprint document
 * `UIGraphService` holds. Studio's own services have already registered every node, page parameter
 * and save field the bodies read, so nothing is seeded here.
 *
 * A write is one step of undo on each written blueprint's own stack - the stack the blueprint editor
 * records on and Ctrl+Z reads in its tab, which follow mode opens - through the same transaction the
 * editor's compound edits use (`LocalBlueprintService.runBlueprintHistoryTransaction`). Anywhere
 * else, the blueprint's own stack would go on holding whole-blueprint snapshots from before the
 * write: the author's next Ctrl+Z in that tab would put one back, wiping the agent's write and the
 * author's own last edit with it, while the agent's step sat orphaned on another stack.
 *
 * Each blueprint `blueprint_show` prints carries a `revision` (see {@link blueprintRevision}), and a
 * write that names one is refused when the blueprint changed since, as the page and scene writes are.
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
import type { Blueprint, BlueprintDocument } from "@shared/types/blueprint/document";
import { readTypedBlueprintOwnerKey } from "@shared/blueprint/ownerKey";
import { fnv1aHex } from "@shared/utils/contentHash";
import { ownerRefToIndexKey } from "../../ui-editor/blueprint/ownerKeys";
import { Services, type WorkspaceContext } from "../../services";
import type { BlueprintNodeCatalogService } from "../../ui-editor/BlueprintNodeCatalogService";
import type { LocalBlueprintService } from "../../ui-editor/LocalBlueprintService";
import type { UIGraphService } from "../../ui-editor/UIGraphService";
import {
    answer,
    readOptionalBoolean,
    readOptionalInteger,
    readOptionalString,
    readString,
    refuse,
    type AgentToolHandler,
} from "../agentCall";
import { readSource } from "./storyTextTools";
import { blueprintInputOf, capText, checkFailed, cloneJson, liveBlueprintDocument, revisionComment } from "./textFormat";

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
    const blueprints = shown.blueprints.map(item => ({
        id: item.id,
        name: item.name,
        owner: ownerRefToIndexKey(item.owner),
        revision: blueprintRevision(document, item.id),
    }));
    // One blueprint: its revision opens the text, as the page and scene reads do. Several (an owner
    // key): each has its own, and one baseRevision covers one blueprint.
    const header = blueprints.length === 1
        ? revisionComment(blueprints[0].revision, "blueprint_apply")
        : `# revisions: ${blueprints.map(item => `"${item.name}" ${item.revision}`).join(", ")} - apply one block per call to pass one as baseRevision`;
    return answer(`${header}\n${capText([...shown.err, commandText(shown)].join("\n"), "Name one blueprint by id.")}`, {
        blueprints,
        revision: blueprints.length === 1 ? blueprints[0].revision : null,
    });
};

/** Every key of `value` sorted and `undefined` left out, so equal content prints the same text. */
function stableJson(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(item => (item === undefined ? "null" : stableJson(item))).join(",")}]`;
    }
    if (value !== null && typeof value === "object") {
        const record = value as Record<string, unknown>;
        return `{${Object.keys(record)
            .filter(key => record[key] !== undefined)
            .sort()
            .map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`)
            .join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}

/**
 * A blueprint's revision, for `blueprint_apply`'s `baseRevision`: a number that changes whenever the
 * blueprint, or the owner record that points at it, does. Zero for a blueprint that does not exist.
 *
 * Derived from the content rather than counted, because the graph document keeps no per-blueprint
 * counter and a hash needs none: equal content is the same revision however it was reached, so an
 * edit that was undone, or a write that changed nothing, does not turn a read stale.
 */
export function blueprintRevision(document: BlueprintDocument, blueprintId: string): number {
    const blueprint = document.blueprints[blueprintId];
    if (!blueprint) {
        return 0;
    }
    const owner = document.ownerRecords[ownerRefToIndexKey(blueprint.owner)] ?? null;
    return Number.parseInt(fnv1aHex(stableJson({ blueprint, owner })), 16);
}

// ── blueprint_apply ──────────────────────────────────────────────────────────────────────────────

/**
 * Write compiled blueprints into the live document: each one a step of undo on its own stack, as the
 * blueprint editor records its edits. See the file comment for why no other stack will do.
 */
export function commitBlueprints(ctx: WorkspaceContext, blueprints: readonly Blueprint[]): void {
    const graph = ctx.services.get<UIGraphService>(Services.UIGraph);
    const local = ctx.services.get<LocalBlueprintService>(Services.LocalBlueprint);
    for (const blueprint of blueprints) {
        const ownerKey = ownerRefToIndexKey(blueprint.owner);
        local.runBlueprintHistoryTransaction(
            blueprint.id,
            // Copied: the document edits the records it holds in place.
            () => graph.applyGraphMutation(document => {
                applyBlueprintsToDocument(document.blueprintDocument, [cloneJson(blueprint)], { [ownerKey]: { blueprintId: blueprint.id } });
            }),
            { ownerKey },
        );
    }
}

/**
 * Refuse a write over a blueprint that changed since the agent read it. One revision covers one
 * blueprint, so a source writing several existing blueprints cannot carry one, the way one page
 * revision cannot cover a `.ui` source with several pages.
 */
export function assertBlueprintRevision(document: BlueprintDocument, blueprints: readonly Blueprint[], baseRevision: number | undefined): void {
    if (baseRevision === undefined) {
        return;
    }
    const existing = blueprints.filter(blueprint => document.blueprints[blueprint.id]);
    for (const blueprint of existing) {
        const current = blueprintRevision(document, blueprint.id);
        if (current !== baseRevision) {
            const several = existing.length > 1 ? " One baseRevision cannot cover several blueprints; apply one block per call to use it." : "";
            throw refuse(
                "stale_revision",
                `Blueprint "${blueprint.name}" changed since you read it (revision ${baseRevision}, now ${current}). Nothing was written.${several}`,
                "Call blueprint_show again and redo the edit against what it prints.",
            );
        }
    }
}

export const blueprintApply: AgentToolHandler = async (args, { ctx, request, follow }) => {
    const source = readSource(args);
    const baseRevision = readOptionalInteger(args, "baseRevision");
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
    // Checked against the live document after the awaits above, right before the write: an edit the
    // author made while the source was being checked counts.
    assertBlueprintRevision(liveBlueprintDocument(ctx), blueprints, baseRevision);
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
    const after = liveBlueprintDocument(ctx);
    const written = blueprints.map(blueprint => ({
        id: blueprint.id,
        name: blueprint.name,
        owner: ownerRefToIndexKey(blueprint.owner),
        ...(dryRun ? {} : { revision: blueprintRevision(after, blueprint.id) }),
    }));
    const undo = blueprints.length === 1
        ? "One step of undo in its blueprint editor."
        : "One step of undo in each blueprint's editor.";
    const lines = [
        ...(check.diagnostics.length > 0 ? [report, ""] : []),
        dryRun ? `Would ${what || "change nothing"} (dry run: nothing written).` : `Wrote the project's blueprints: ${what || "no change"}. ${undo}`,
        ...(!dryRun ? [`Revision: ${written.map(item => `"${item.name}" ${item.revision}`).join(", ")}.`] : []),
    ];
    return answer(capText(lines.join("\n"), "Apply fewer blueprints per call."), {
        dryRun,
        written: !dryRun,
        added,
        replaced,
        blueprints: written,
    });
};
