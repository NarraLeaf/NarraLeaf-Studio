/**
 * The `.ui` text-format tools: the widget catalogue, real usages, the page list, a page printed as
 * text, and pages written back from it.
 *
 * Each is the `ui` command line's body (`@/lib/agent-core`) over the live interface document,
 * answering with the text the command line prints. A write is checked whole first, then committed
 * through `UIDocumentService` as one step of undo: on that page's (or component's) own stack when
 * the source replaces exactly one that already exists and touches nothing shared, on the project's
 * stack otherwise - a new page, several pages, or the shared struct and action tables belong to no
 * one editor.
 *
 * Comments in English per project convention.
 */

import { getInterface } from "@/lib/app/bridge";
import {
    applyCompiledUi,
    checkUiSource,
    commandText,
    findComponent,
    findSurface,
    formatUiApplyResult,
    formatUiDiagnostics,
    indexBlueprintDocument,
    showUi,
    uiSurfacesCommand,
    uiUsageCommand,
    uiWidgetCommand,
    uiWidgetsCommand,
    WIDGET_STAGE_SLOTS,
    WIDGET_SURFACE_KINDS,
    type UiApplyChanges,
    type UiCompileResult,
} from "@/lib/agent-core";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { WorkspaceContext } from "../../services";
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
import type { UIPatchTarget } from "../uiPatch";
import { readSource } from "./storyTextTools";
import { assertUiRevision, uiContentRevision } from "./uiTools";
import {
    capText,
    checkFailed,
    cloneJson,
    forAgent,
    liveBlueprintDocument,
    revisionComment,
    uiAgentContextOf,
    uiDocumentService,
} from "./textFormat";

// ── Catalogue ────────────────────────────────────────────────────────────────────────────────────

export const uiWidgets: AgentToolHandler = async args => {
    const insertable = readOptionalBoolean(args, "insertable");
    const surfaceKind = readOptionalString(args, "surfaceKind");
    const slot = readOptionalString(args, "slot");
    if (surfaceKind && !(WIDGET_SURFACE_KINDS as readonly string[]).includes(surfaceKind)) {
        throw refuse("invalid_args", `\`surfaceKind\` must be one of: ${WIDGET_SURFACE_KINDS.join(", ")}.`);
    }
    if (slot && !(WIDGET_STAGE_SLOTS as readonly string[]).includes(slot)) {
        throw refuse("invalid_args", `\`slot\` must be one of: ${WIDGET_STAGE_SLOTS.join(", ")}.`);
    }
    const result = uiWidgetsCommand({ insertableOnly: insertable === true, surfaceKind, stageSlot: slot });
    return answer(capText(commandText(result), "Pass `surfaceKind` or `slot`."));
};

export const uiWidget: AgentToolHandler = async args => {
    const type = readString(args, "type");
    const result = uiWidgetCommand(type);
    if (result.exitCode !== 0) {
        throw refuse("not_found", result.err.join(" "), "Call ui_widgets for the catalogue.");
    }
    return answer(commandText(result), { type });
};

/**
 * The shipped skeleton's interface, which `ui_usage` searches unless told to search the project.
 *
 * Read through main (the renderer cannot reach the app's own files) the way "add the starter title
 * page" reads it, once per workspace; a failed read is not remembered, so the next call tries again.
 */
const skeletonDocuments = new WeakMap<WorkspaceContext, Promise<UIDocument | null>>();

async function skeletonInterface(ctx: WorkspaceContext): Promise<UIDocument | null> {
    let pending = skeletonDocuments.get(ctx);
    if (!pending) {
        pending = getInterface().projectTemplates.readInterface("skeleton").then(
            read => (read.success ? uiDocumentService(ctx).prepareTemplateDocumentForPreview(read.data.uiDocument) : null),
            () => null,
        );
        skeletonDocuments.set(ctx, pending);
    }
    const document = await pending;
    if (!document) {
        skeletonDocuments.delete(ctx);
    }
    return document;
}

export const uiUsage: AgentToolHandler = async (args, { ctx }) => {
    const type = readString(args, "type");
    const prop = readOptionalString(args, "prop");
    const limit = readOptionalInteger(args, "limit", { min: 0, max: 100 });
    const shallow = readOptionalBoolean(args, "shallow");
    const fromProject = readOptionalBoolean(args, "fromProject") === true;
    let document = fromProject ? uiDocumentService(ctx).getDocument() : await skeletonInterface(ctx);
    let note = "";
    if (!document) {
        document = uiDocumentService(ctx).getDocument();
        note = "The shipped skeleton could not be read, so these are from this project.\n";
    }
    const result = uiUsageCommand(document, type, { prop, limit, shallow: shallow === true });
    return answer(capText(note + commandText(result), "Lower `limit`, or pass `shallow` or `prop`."), {
        type,
        source: fromProject || note ? "project" : "skeleton",
    });
};

export const uiSurfaces: AgentToolHandler = async (args, { ctx }) => {
    const query = readOptionalString(args, "query");
    const result = uiSurfacesCommand(
        { document: uiDocumentService(ctx).getDocument(), blueprints: indexBlueprintDocument(liveBlueprintDocument(ctx)) },
        { search: query },
    );
    return answer(capText(commandText(result), "Pass `query` (a page, component, element path or widget type) to narrow it."));
};

// ── ui_show ──────────────────────────────────────────────────────────────────────────────────────

export const uiShow: AgentToolHandler = async (args, { ctx, request, follow }) => {
    const surfaceRef = readOptionalString(args, "surface");
    const componentRef = readOptionalString(args, "component");
    if (surfaceRef && componentRef) {
        throw refuse("invalid_args", "Give `surface` or `component`, not both.");
    }
    const context = await uiAgentContextOf(ctx);
    const document = context.document;
    let target: UIPatchTarget | null = null;
    let name: string;
    if (surfaceRef) {
        const surface = findSurface(document, surfaceRef);
        if (!surface) {
            throw refuse("not_found", `No page "${surfaceRef}".`, "Call ui_surfaces for the pages in this project.");
        }
        target = { kind: "surface", surfaceId: surface.id };
        name = surface.name;
    } else if (componentRef) {
        const component = findComponent(document, componentRef);
        if (!component) {
            throw refuse("not_found", `No component "${componentRef}".`, "Call ui_surfaces for the components in this project.");
        }
        target = { kind: "component", componentId: component.id };
        name = component.name;
    } else {
        name = document.name || "interface";
    }
    follow.describeCall(request.callId, name);
    const shown = showUi(context, target?.kind === "surface"
        ? { surface: target.surfaceId }
        : target?.kind === "component" ? { component: target.componentId } : {});
    if (shown.exitCode !== 0) {
        throw refuse("not_found", shown.err.join(" "));
    }
    const text = commandText(shown);
    if (!target) {
        // The whole interface has no one revision: each page and component keeps its own.
        return answer(
            capText(text, "Pass `surface` or `component` to print one page (and get its revision)."),
            { subject: name, revision: null },
        );
    }
    const revision = uiContentRevision(ctx, target);
    return answer(`${revisionComment(revision, "ui_apply")}\n${capText(text, "This page is very large; edit it with ui_patch instead.")}`, {
        ...(target.kind === "surface" ? { surface: { id: target.surfaceId, name } } : { component: { id: target.componentId, name } }),
        revision,
    });
};

// ── ui_apply ─────────────────────────────────────────────────────────────────────────────────────

/** The pages and components a compiled source replaces (those that exist) and adds (those that do not). */
export function compiledTargets(document: UIDocument, compiled: UiCompileResult): {
    existing: UIPatchTarget[];
    added: UIPatchTarget[];
} {
    const existing: UIPatchTarget[] = [];
    const added: UIPatchTarget[] = [];
    for (const item of compiled.surfaces) {
        const target: UIPatchTarget = { kind: "surface", surfaceId: item.surface.id };
        (document.surfaces.some(surface => surface.id === item.surface.id) ? existing : added).push(target);
    }
    for (const item of compiled.components) {
        const target: UIPatchTarget = { kind: "component", componentId: item.component.id };
        ((document.components ?? []).some(component => component.id === item.component.id) ? existing : added).push(target);
    }
    return { existing, added };
}

/**
 * Whether an apply lands on exactly one editor's stack: it replaces one page or component that
 * exists and changes nothing that page's undo cannot see - no shared table, no entry page, no
 * document name.
 */
export function singleScopeOf(compiled: UiCompileResult, targets: ReturnType<typeof compiledTargets>, changes: UiApplyChanges): UIPatchTarget | null {
    const shared = changes.structsWritten.length > 0
        || changes.structsRemoved.length > 0
        || changes.actionsWritten.length > 0
        || changes.entryPage !== undefined
        || compiled.documentName !== undefined
        || compiled.documentId !== undefined;
    return !shared && targets.added.length === 0 && targets.existing.length === 1 ? targets.existing[0] : null;
}

function targetName(document: UIDocument, target: UIPatchTarget): string {
    return target.kind === "surface"
        ? document.surfaces.find(surface => surface.id === target.surfaceId)?.name ?? target.surfaceId
        : (document.components ?? []).find(component => component.id === target.componentId)?.name ?? target.componentId;
}

export const uiApply: AgentToolHandler = async (args, { ctx, request, follow }) => {
    const source = readSource(args);
    const baseRevision = readOptionalInteger(args, "baseRevision");
    const dryRun = readOptionalBoolean(args, "dryRun") ?? false;
    const uidoc = uiDocumentService(ctx);
    const context = await uiAgentContextOf(ctx);
    const live = context.document;

    const check = checkUiSource(source, context);
    const report = formatUiDiagnostics(check.diagnostics, { source });
    if (!check.ok || !check.compiled) {
        throw checkFailed(report, "Fix the errors and apply again; ui_widget lists a widget's props.");
    }
    const compiled = check.compiled;
    const targets = compiledTargets(live, compiled);
    const names = [...targets.existing, ...targets.added].map(target => target.kind === "surface"
        ? compiled.surfaces.find(item => item.surface.id === target.surfaceId)?.surface.name
        : compiled.components.find(item => item.component.id === target.componentId)?.component.name);
    follow.describeCall(request.callId, names.filter(Boolean).join(", ") || "interface");
    for (const target of targets.existing) {
        try {
            assertUiRevision(ctx, target, baseRevision);
        } catch (error) {
            if (targets.existing.length > 1 && error instanceof Error) {
                error.message = `"${targetName(live, target)}": ${error.message} One baseRevision cannot cover several pages; apply one block per call to use it.`;
            }
            throw error;
        }
    }

    // Applied to a copy first, always: it is the dry run's answer, and for a real write it says
    // whether the change touches anything outside one page before deciding where the undo step goes.
    // The compiled records are copied too, because applying hands them to the document by reference.
    const preview = applyCompiledUi(cloneJson(live), cloneJson(compiled));
    const dropped = [
        ...compiled.surfaces.filter(item => item.dropped.length > 0).map(item => ({ surface: item.surface.name, names: item.dropped.map(entry => entry.name) })),
        ...compiled.components.filter(item => item.dropped.length > 0).map(item => ({ component: item.component.name, names: item.dropped.map(entry => entry.name) })),
    ];
    let changes = preview;
    if (!dryRun) {
        const single = singleScopeOf(compiled, targets, preview);
        let applied = null as UiApplyChanges | null;
        const mutate = (document: UIDocument) => {
            applied = applyCompiledUi(document, compiled);
        };
        if (single) {
            uidoc.applyCompiledUi({
                surfaceIds: single.kind === "surface" ? [single.surfaceId] : [],
                componentIds: single.kind === "component" ? [single.componentId] : [],
                label: AGENT_HISTORY_LABEL,
                mutate,
            });
        } else {
            uidoc.applyAgentMutation(null, AGENT_HISTORY_LABEL, mutate);
        }
        changes = applied ?? preview;
        const first = targets.existing[0] ?? targets.added[0];
        if (first) {
            const elementIds = first.kind === "surface"
                ? Object.keys(compiled.surfaces.find(item => item.surface.id === first.surfaceId)?.elements ?? {})
                : Object.keys(compiled.components.find(item => item.component.id === first.componentId)?.component.elements ?? {});
            const name = targetName(uidoc.getDocument(), first);
            follow.noteWrite(first.kind === "surface"
                ? { kind: "surface", surfaceId: first.surfaceId, name, elementIds }
                : { kind: "component", componentId: first.componentId, name, elementIds });
        }
    }

    const revisions = dryRun ? [] : [...targets.existing, ...targets.added].map(target => ({
        ...(target.kind === "surface" ? { surface: target.surfaceId } : { component: target.componentId }),
        name: targetName(uidoc.getDocument(), target),
        revision: uiContentRevision(ctx, target),
    }));
    const lines = [report, "", forAgent(formatUiApplyResult(changes, !dryRun))];
    for (const item of dropped) {
        lines.push(`Deleted from ${"surface" in item ? `page "${item.surface}"` : `component "${item.component}"`}: ${item.names.join(", ")}`);
    }
    if (revisions.length > 0) {
        lines.push(`Revision: ${revisions.map(item => `"${item.name}" ${item.revision}`).join(", ")}.`);
    }
    return answer(capText(lines.join("\n"), "Apply one page per call."), {
        dryRun,
        written: !dryRun,
        surfacesAdded: changes.surfacesAdded,
        surfacesReplaced: changes.surfacesReplaced,
        componentsAdded: changes.componentsAdded,
        componentsReplaced: changes.componentsReplaced,
        elementsWritten: changes.elementsWritten,
        elementsRemoved: changes.elementsRemoved,
        dropped,
        structsWritten: changes.structsWritten,
        structsRemoved: changes.structsRemoved,
        actionsWritten: changes.actionsWritten,
        entryPage: changes.entryPage ?? null,
        revisions,
    });
};
