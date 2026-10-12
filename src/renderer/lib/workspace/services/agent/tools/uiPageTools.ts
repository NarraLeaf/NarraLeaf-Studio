/**
 * The page-level interface tools: `ui_page_rename`, `ui_page_delete` and `ui_page_set_entry`.
 *
 * A page here is any surface - a page or a Game UI - named by its name or id, as `ui_surfaces`
 * lists them. Each write is one step of undo: a rename on that page's own stack (it is an edit to
 * that page), a deletion and a new entry page on the project's (they are edits to no one page).
 *
 * Comments in English per project convention.
 */

import { anchorSurfaceId } from "@shared/blueprint/ownerShape";
import type { UISurface } from "@shared/types/ui-editor/document";
import { isEntrySurface, resolveEntrySurface } from "@shared/types/ui-editor/entrySurface";
import { Services } from "../../services";
import type { UIService } from "../../core/UIService";
import { answerJson, readString, refuse, type AgentToolHandler } from "../agentCall";
import { AGENT_HISTORY_LABEL, resolveSurface } from "../agentLookups";
import { blueprintReferencesTo, formatReferrers, storyReferencesTo, uiReferencesTo } from "../agentReferences";
import { liveBlueprintDocument, loadAllStories, uiDocumentService } from "./textFormat";

/** What a page is called in an answer: "page" or "Game UI". */
function kindWord(surface: UISurface): string {
    return surface.kind === "stageSurface" ? "Game UI" : "page";
}

function requireSurface(ref: string, surface: UISurface | undefined): UISurface {
    if (!surface) {
        throw refuse("not_found", `No page or Game UI "${ref}".`, "Call ui_surfaces for the pages in this project.");
    }
    return surface;
}

// ── ui_page_rename ───────────────────────────────────────────────────────────────────────────────

export const uiPageRename: AgentToolHandler = async (args, { ctx, request, follow }) => {
    const ref = readString(args, "page");
    const name = readString(args, "name");
    const uidoc = uiDocumentService(ctx);
    const surface = requireSurface(ref, resolveSurface(uidoc.getDocument(), ref));
    follow.describeCall(request.callId, surface.name);
    if (surface.name === name) {
        throw refuse("invalid_args", `The ${kindWord(surface)} is already called "${name}"; nothing to change.`);
    }
    // Pages are found by name - by agents, by blueprint tools and by the author's eye - so two that
    // share one could only ever be told apart by id afterwards.
    const clash = uidoc.getDocument().surfaces.find(other => other.id !== surface.id && other.name === name);
    if (clash) {
        throw refuse("invalid_args", `Another ${kindWord(clash)} is already called "${name}".`, "Pick a name no other page or Game UI has.");
    }
    const before = surface.name;
    uidoc.applyAgentMutation({ surfaceId: surface.id }, AGENT_HISTORY_LABEL, document => {
        const target = document.surfaces.find(item => item.id === surface.id);
        if (target) {
            target.name = name;
        }
    });
    follow.noteWrite({ kind: "surface", surfaceId: surface.id, name });
    return answerJson(
        { surface: { id: surface.id, name, kind: surface.kind } },
        `Renamed ${kindWord(surface)} "${before}" to "${name}". Blueprints and Go Page nodes that open it hold its id, so they follow. One step of undo.`,
    );
};

// ── ui_page_set_entry ────────────────────────────────────────────────────────────────────────────

export const uiPageSetEntry: AgentToolHandler = async (args, { ctx, request, follow }) => {
    const ref = readString(args, "page");
    const uidoc = uiDocumentService(ctx);
    const surface = requireSurface(ref, resolveSurface(uidoc.getDocument(), ref));
    follow.describeCall(request.callId, surface.name);
    if (surface.kind !== "appSurface") {
        throw refuse(
            "invalid_args",
            `"${surface.name}" is a Game UI: it is mounted while a story runs and cannot be what the game opens on.`,
            "Name a page (ui_surfaces lists pages under their own heading).",
        );
    }
    const previous = resolveEntrySurface(uidoc.getDocument());
    if (previous?.id === surface.id) {
        return answerJson(
            { entry: { id: surface.id, name: surface.name } },
            `"${surface.name}" already is the entry page; nothing changed.`,
        );
    }
    uidoc.setEntrySurface(surface.id);
    if (!isEntrySurface(uidoc.getDocument(), surface.id)) {
        throw refuse("unavailable", `"${surface.name}" could not be made the entry page (a live session may own the interface).`);
    }
    follow.noteWrite({ kind: "surface", surfaceId: surface.id, name: surface.name });
    return answerJson(
        { entry: { id: surface.id, name: surface.name }, previous: previous ? { id: previous.id, name: previous.name } : null },
        `The game now opens on "${surface.name}"${previous ? ` instead of "${previous.name}"` : ""}. One step of undo.`,
    );
};

// ── ui_page_delete ───────────────────────────────────────────────────────────────────────────────

/**
 * Delete a page or a Game UI, refusing while anything still leads to it.
 *
 * A Go Page node, a frame showing the page or a story row naming it holds the page's id, so deleting
 * a page any of those reach leaves a button that opens nothing - with nothing saying so until a
 * player presses it. The refusal lists every referrer so the agent can rewrite or delete those first.
 * The page's own elements and blueprints go with it and are not referrers.
 */
export const uiPageDelete: AgentToolHandler = async (args, { ctx, request, follow }) => {
    const ref = readString(args, "page");
    const uidoc = uiDocumentService(ctx);
    const document = uidoc.getDocument();
    const surface = requireSurface(ref, resolveSurface(document, ref));
    follow.describeCall(request.callId, surface.name);
    if (isEntrySurface(document, surface.id)) {
        throw refuse(
            "unavailable",
            `"${surface.name}" is the entry page: the game opens on it.`,
            "Make another page the entry with ui_page_set_entry first.",
        );
    }
    const { stories } = await loadAllStories(ctx);
    const referrers = [
        ...blueprintReferencesTo(liveBlueprintDocument(ctx), surface.id, blueprint => anchorSurfaceId(blueprint.owner) === surface.id),
        ...uiReferencesTo(document, surface.id, surface.id),
        ...storyReferencesTo(stories, surface.id),
    ];
    if (referrers.length > 0) {
        throw refuse(
            "unavailable",
            `${kindWord(surface)} "${surface.name}" is still named by ${referrers.length} reference(s):\n${formatReferrers(referrers)}`,
            "Point those elsewhere or remove them first (blueprint_show / blueprint_apply for a Go Page node, blueprint_remove for a blueprint whose element is gone, ui_patch for an element), then delete this one.",
        );
    }
    const removed = uidoc.deleteSurfaces([surface.id], AGENT_HISTORY_LABEL);
    if (removed.length === 0) {
        throw refuse("unavailable", `"${surface.name}" could not be deleted (a live session may own the interface).`);
    }
    try {
        // Loaded here rather than with the tool table: the template flow it lives in is heavy.
        const ui = ctx.services.get<UIService>(Services.UI);
        const { closeSurfaceTabs } = await import("@/apps/workspace/modules/ui-editor/panel/templates/addStarterTitlePage");
        closeSurfaceTabs(ui, surface.id);
    } catch {
        // No editor layout behind this workspace (a background one): there are no tabs to close.
    }
    return answerJson(
        { deleted: { id: surface.id, name: surface.name, kind: surface.kind } },
        `Deleted ${kindWord(surface)} "${surface.name}" with its elements and blueprints. One step of undo in Studio.`,
    );
};
