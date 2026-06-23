import type { UIDocument } from "@shared/types/ui-editor/document";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import { resolveInsertTargetParent } from "@/lib/ui-editor/tree/resolveInsertTargetParent";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import {
    buildUiEditorClipboardPayload,
    clearUiEditorClipboard,
    getUiEditorClipboard,
    setUiEditorClipboard,
} from "./uiEditorClipboard";
import {
    filterSelectionToTopLevelMovers,
    getMoversToGroupIntoLeaderContainer,
    getSelectionLeaderId,
    getSelectionPrimaryId,
} from "./uiEditorSelection";
import { collectSubtreeElementIds } from "@/lib/workspace/services/ui-editor/uiDocumentTreeMove";
import { resolveSurfaceRootElementId } from "@/lib/ui-editor/runtime/resolveSurfaceRoot";
import type { Blueprint } from "@shared/types/blueprint/document";

export type UIEditorPasteTarget = {
    parentId: string;
    beforeChildId: string | null;
};

function getWidgetMainBlueprintSnapshot(localBp: LocalBlueprintService, surfaceId: string, elementId: string): Blueprint | undefined {
    const bpId = localBp.getWidgetMainBlueprintId(surfaceId, elementId);
    if (!bpId) {
        return undefined;
    }
    const raw = localBp.getBlueprintDocument().blueprints[bpId];
    return raw ? (JSON.parse(JSON.stringify(raw)) as Blueprint) : undefined;
}

function getWidgetValueBlueprintSnapshot(
    localBp: LocalBlueprintService,
    surfaceId: string,
    elementId: string,
    propPath: string,
): Blueprint | undefined {
    const bpId = localBp.getWidgetValueBlueprintId(surfaceId, elementId, propPath);
    if (!bpId) {
        return undefined;
    }
    const raw = localBp.getBlueprintDocument().blueprints[bpId];
    return raw ? (JSON.parse(JSON.stringify(raw)) as Blueprint) : undefined;
}

function isElementInSubtree(document: UIDocument, elementId: string, rootId: string): boolean {
    let cur: string | null | undefined = elementId;
    while (cur) {
        if (cur === rootId) {
            return true;
        }
        cur = document.elements[cur]?.parentId ?? null;
    }
    return false;
}

function pickPasteAnchorTopLevelId(
    document: UIDocument,
    selection: UIElementSelection,
    topLevelIds: string[],
): string | null {
    const primaryId = getSelectionPrimaryId(selection);
    if (primaryId) {
        const primaryTop = topLevelIds.find(topId => isElementInSubtree(document, primaryId, topId));
        if (primaryTop) {
            return primaryTop;
        }
    }
    return topLevelIds[topLevelIds.length - 1] ?? null;
}

export function resolvePasteTargetAfterSelection(
    document: UIDocument,
    surfaceId: string,
    selection: UIElementSelection | null,
): UIEditorPasteTarget | null {
    const effectiveRootId = resolveSurfaceRootElementId(document, surfaceId);
    if (!effectiveRootId) {
        return null;
    }
    if (!selection || selection.surfaceId !== surfaceId || selection.elementIds.length === 0) {
        return { parentId: effectiveRootId, beforeChildId: null };
    }

    const allowed = collectSubtreeElementIds(document, effectiveRootId);
    const topLevelIds = filterSelectionToTopLevelMovers(document, selection).filter(id => {
        const el = document.elements[id];
        return el != null && el.type !== "nl.root" && allowed.has(id);
    });
    const anchorId = pickPasteAnchorTopLevelId(document, selection, topLevelIds);
    const anchor = anchorId ? document.elements[anchorId] : null;
    if (!anchor?.parentId) {
        return { parentId: effectiveRootId, beforeChildId: null };
    }

    const parent = document.elements[anchor.parentId];
    if (!parent || !allowed.has(parent.id)) {
        return { parentId: effectiveRootId, beforeChildId: null };
    }

    const sameParentTopIds = new Set(
        topLevelIds.filter(id => document.elements[id]?.parentId === parent.id),
    );
    let insertAfterIndex = -1;
    parent.childrenIds.forEach((childId, index) => {
        if (sameParentTopIds.has(childId)) {
            insertAfterIndex = Math.max(insertAfterIndex, index);
        }
    });
    if (insertAfterIndex < 0) {
        insertAfterIndex = parent.childrenIds.indexOf(anchor.id);
    }

    const beforeChildId =
        insertAfterIndex >= 0 && insertAfterIndex < parent.childrenIds.length - 1
            ? parent.childrenIds[insertAfterIndex + 1]
            : null;

    return { parentId: parent.id, beforeChildId };
}

export function uiEditorCopySelection(
    documentService: UIDocumentService,
    localBp: LocalBlueprintService,
    surfaceId: string,
    selection: UIElementSelection | null,
): boolean {
    if (!selection || selection.surfaceId !== surfaceId || selection.elementIds.length === 0) {
        return false;
    }
    const doc = documentService.getDocument();
    const payload = buildUiEditorClipboardPayload({
        document: doc,
        surfaceId,
        selectedElementIds: selection.elementIds,
        getWidgetMainBlueprint: (sid, eid) => getWidgetMainBlueprintSnapshot(localBp, sid, eid),
        getWidgetValueBlueprint: (sid, eid, propPath) =>
            getWidgetValueBlueprintSnapshot(localBp, sid, eid, propPath),
    });
    if (!payload) {
        return false;
    }
    setUiEditorClipboard(payload);
    return true;
}

export function uiEditorCutSelection(
    documentService: UIDocumentService,
    localBp: LocalBlueprintService,
    stateService: UIEditorStateService,
    surfaceId: string,
    selection: UIElementSelection | null,
): boolean {
    const ok = uiEditorCopySelection(documentService, localBp, surfaceId, selection);
    if (!ok || !selection || selection.elementIds.length === 0) {
        return false;
    }
    const doc = documentService.getDocument();
    const tops = filterSelectionToTopLevelMovers(doc, selection);
    if (tops.length === 0) {
        return false;
    }
    stateService.setSelection({ type: null, data: null });
    documentService.deleteElements(tops);
    return true;
}

export function uiEditorPaste(
    documentService: UIDocumentService,
    localBp: LocalBlueprintService,
    stateService: UIEditorStateService,
    surfaceId: string,
    input: { hitElementId?: string | null; primaryElementId?: string | null },
): boolean {
    const payload = getUiEditorClipboard();
    if (!payload) {
        return false;
    }
    const doc = documentService.getDocument();
    const resolved = resolveInsertTargetParent(doc, surfaceId, {
        hitElementId: input.hitElementId,
        primaryElementId: input.primaryElementId,
    });
    if (!resolved) {
        return false;
    }
    const result = documentService.pasteClipboardPayload(surfaceId, resolved.parentId, null, payload);
    if (!result.ok || result.newRootIds.length === 0) {
        return false;
    }
    const primary = result.newRootIds[result.newRootIds.length - 1];
    stateService.setUIElementSelection({
        editor: "ui",
        surfaceId,
        elementIds: result.newRootIds,
        primaryId: primary,
    });
    void localBp;
    return true;
}

export function uiEditorPasteAfterSelection(
    documentService: UIDocumentService,
    localBp: LocalBlueprintService,
    stateService: UIEditorStateService,
    surfaceId: string,
    selection: UIElementSelection | null,
): boolean {
    const payload = getUiEditorClipboard();
    if (!payload) {
        return false;
    }
    const doc = documentService.getDocument();
    const target = resolvePasteTargetAfterSelection(doc, surfaceId, selection);
    if (!target) {
        return false;
    }
    const result = documentService.pasteClipboardPayload(surfaceId, target.parentId, target.beforeChildId, payload);
    if (!result.ok || result.newRootIds.length === 0) {
        return false;
    }
    const primary = result.newRootIds[result.newRootIds.length - 1];
    stateService.setUIElementSelection({
        editor: "ui",
        surfaceId,
        elementIds: result.newRootIds,
        primaryId: primary,
    });
    void localBp;
    return true;
}

/** Paste using an explicit parent (e.g. context menu on outline row). */
export function uiEditorPasteIntoParent(
    documentService: UIDocumentService,
    localBp: LocalBlueprintService,
    stateService: UIEditorStateService,
    surfaceId: string,
    targetParentId: string,
    beforeChildId: string | null = null,
): boolean {
    const payload = getUiEditorClipboard();
    if (!payload) {
        return false;
    }
    const result = documentService.pasteClipboardPayload(surfaceId, targetParentId, beforeChildId, payload);
    if (!result.ok || result.newRootIds.length === 0) {
        return false;
    }
    const primary = result.newRootIds[result.newRootIds.length - 1];
    stateService.setUIElementSelection({
        editor: "ui",
        surfaceId,
        elementIds: result.newRootIds,
        primaryId: primary,
    });
    void localBp;
    return true;
}

export function uiEditorDuplicateSelection(
    documentService: UIDocumentService,
    localBp: LocalBlueprintService,
    stateService: UIEditorStateService,
    surfaceId: string,
    selection: UIElementSelection | null,
): boolean {
    if (!selection || selection.surfaceId !== surfaceId || selection.elementIds.length === 0) {
        return false;
    }
    const copied = uiEditorCopySelection(documentService, localBp, surfaceId, selection);
    if (!copied) {
        return false;
    }
    const doc = documentService.getDocument();
    const tops = filterSelectionToTopLevelMovers(doc, selection);
    if (tops.length === 0) {
        return false;
    }
    const first = doc.elements[tops[0]];
    const parentId = first?.parentId;
    if (!parentId) {
        return false;
    }
    const parent = doc.elements[parentId];
    if (!parent) {
        return false;
    }
    const lastTop = tops[tops.length - 1];
    const idx = parent.childrenIds.indexOf(lastTop);
    const beforeChildId = idx >= 0 && idx < parent.childrenIds.length - 1 ? parent.childrenIds[idx + 1] : null;
    return uiEditorPasteIntoParent(documentService, localBp, stateService, surfaceId, parentId, beforeChildId);
}

export function uiEditorDeleteSelection(
    documentService: UIDocumentService,
    stateService: UIEditorStateService,
    surfaceId: string,
    selection: UIElementSelection | null,
): boolean {
    if (!selection || selection.surfaceId !== surfaceId || selection.elementIds.length === 0) {
        return false;
    }
    const doc = documentService.getDocument();
    const tops = filterSelectionToTopLevelMovers(doc, selection);
    if (tops.length === 0) {
        return false;
    }
    stateService.setSelection({ type: null, data: null });
    documentService.deleteElements(tops);
    return true;
}

export function uiEditorGroupIntoLeaderContainer(
    documentService: UIDocumentService,
    stateService: UIEditorStateService,
    surfaceId: string,
    selection: UIElementSelection | null,
): boolean {
    if (!selection || selection.surfaceId !== surfaceId) {
        return false;
    }
    const doc = documentService.getDocument();
    const leader = getSelectionLeaderId(selection);
    if (!leader) {
        return false;
    }
    const movers = getMoversToGroupIntoLeaderContainer(doc, selection);
    if (movers.length === 0) {
        return false;
    }
    const result = documentService.moveElementsInSurface(surfaceId, movers, leader, null);
    if (!result.ok) {
        return false;
    }
    stateService.setUIElementSelection({
        editor: "ui",
        surfaceId,
        elementIds: selection.elementIds,
        primaryId: getSelectionPrimaryId(selection) ?? leader,
    });
    return true;
}

export function uiEditorSelectAllInSurface(documentService: UIDocumentService, stateService: UIEditorStateService, surfaceId: string): void {
    const doc = documentService.getDocument();
    const effectiveRootId = resolveSurfaceRootElementId(doc, surfaceId);
    if (!effectiveRootId) {
        return;
    }
    const root = doc.elements[effectiveRootId];
    if (!root) {
        return;
    }
    const allowed = collectSubtreeElementIds(doc, effectiveRootId);
    const ids: string[] = [];
    const walk = (id: string) => {
        const el = doc.elements[id];
        if (!el || !allowed.has(id)) {
            return;
        }
        if (el.type !== "nl.root") {
            ids.push(id);
        }
        el.childrenIds.forEach(walk);
    };
    walk(effectiveRootId);
    if (ids.length === 0) {
        stateService.setSelection({ type: null, data: null });
        return;
    }
    stateService.setUIElementSelection({
        editor: "ui",
        surfaceId,
        elementIds: ids,
        primaryId: ids[ids.length - 1],
    });
}

export function uiEditorClearClipboard(): void {
    clearUiEditorClipboard();
}
