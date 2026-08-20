import type { UIDocument } from "@shared/types/ui-editor/document";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import { normalizeProjectPath } from "@shared/utils/recentProject";
import { resolveInsertTargetParent } from "@/lib/ui-editor/tree/resolveInsertTargetParent";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import {
    buildUiEditorClipboardPayload,
    clearUiEditorClipboard,
    setUiEditorClipboard,
    type UIEditorClipboardPayload,
} from "./uiEditorClipboard";
import {
    importForeignUiAssets,
    publishUiClipboard,
    readUiClipboardEnvironment,
    reportForeignUiPaste,
    resolveUiPasteSource,
} from "./uiEditorClipboardBridge";
import {
    filterSelectionToTopLevelMovers,
    getContainersToUngroup,
    getMoversToGroupIntoLeaderContainer,
    getSelectionLeaderId,
    getSelectionPrimaryId,
    selectSurfaceForProperties,
} from "./uiEditorSelection";
import { collectSubtreeElementIds } from "@/lib/workspace/services/ui-editor/uiDocumentTreeMove";
import { resolveSurfaceRootElementId } from "@/lib/ui-editor/runtime/resolveSurfaceRoot";
import type { Blueprint } from "@shared/types/blueprint/document";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import { isComponentEditorRootElement } from "@/lib/ui-editor/componentEditorRoot";

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
        return el != null && el.type !== "nl.root" && !isComponentEditorRootElement(el) && allowed.has(id);
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

/**
 * Snapshot a selection without touching either clipboard.
 *
 * Duplicate needs the same snapshot a copy makes and none of what a copy *means*: pressing Ctrl+D
 * used to fill the clipboard, which is invisible while the clipboard is this window's own and is
 * not once it is the machine's - the author's copied text would be gone for a gesture that never
 * claimed to take it.
 */
function snapshotSelection(
    documentService: UIDocumentService,
    localBp: LocalBlueprintService,
    surfaceId: string,
    selection: UIElementSelection | null,
    stamp?: { copyId?: string; source?: UIEditorClipboardPayload["source"] },
): UIEditorClipboardPayload | null {
    if (!selection || selection.surfaceId !== surfaceId || selection.elementIds.length === 0) {
        return null;
    }
    return buildUiEditorClipboardPayload({
        document: documentService.getDocument(),
        surfaceId,
        selectedElementIds: selection.elementIds,
        getWidgetMainBlueprint: (sid, eid) => getWidgetMainBlueprintSnapshot(localBp, sid, eid),
        getWidgetValueBlueprint: (sid, eid, propPath) =>
            getWidgetValueBlueprintSnapshot(localBp, sid, eid, propPath),
        ...(stamp ?? {}),
    });
}

/**
 * Copy the selection: into this window, and onto the machine's clipboard.
 *
 * The in-window copy is what the gesture returns on, so copying stays synchronous and a paste in
 * this same window is exactly the paste it has always been. Reaching the other project windows is
 * one round trip through the main process and is left to run on its own - see
 * `uiEditorClipboardBridge`.
 */
export function uiEditorCopySelection(
    documentService: UIDocumentService,
    localBp: LocalBlueprintService,
    surfaceId: string,
    selection: UIElementSelection | null,
): boolean {
    const environment = readUiClipboardEnvironment(documentService);
    // Without a project behind it there is nothing to stamp and nowhere to publish to, and the copy
    // stays what it was: this window's own.
    const copyId = environment?.uuidService?.generate();
    const payload = snapshotSelection(documentService, localBp, surfaceId, selection, environment && copyId
        ? {
            copyId,
            source: {
                // The identity key rather than the spelling the author opened the project by: it is
                // never shown, only compared, and the story clipboard's stamp carries the same form.
                path: normalizeProjectPath(environment.projectPath),
                identifier: environment.projectIdentifier,
                name: environment.projectName,
            },
        }
        : undefined);
    if (!payload) {
        return false;
    }
    setUiEditorClipboard(payload);
    if (environment && copyId) {
        publishUiClipboard(environment, payload);
    }
    return true;
}

export function uiEditorCutSelection(
    documentService: UIDocumentService,
    localBp: LocalBlueprintService,
    stateService: UIEditorStateService,
    surfaceId: string,
    selection: UIElementSelection | null,
    uiService?: UIService | null,
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
    selectSurfaceForProperties(stateService, surfaceId, uiService);
    documentService.deleteElements(tops);
    return true;
}

/**
 * Write a payload into the surface and select what came out of it.
 *
 * The one place a clipboard payload becomes elements, whether it came from this window, from
 * another project's, or from the duplicate gesture that never went near a clipboard at all.
 */
function applyClipboardPayload(
    documentService: UIDocumentService,
    stateService: UIEditorStateService,
    surfaceId: string,
    target: UIEditorPasteTarget,
    payload: UIEditorClipboardPayload,
): boolean {
    const result = documentService.pasteClipboardPayload(surfaceId, target.parentId, target.beforeChildId, payload);
    if (!result.ok || result.newRootIds.length === 0) {
        return false;
    }
    stateService.setUIElementSelection({
        editor: "ui",
        surfaceId,
        elementIds: result.newRootIds,
        primaryId: result.newRootIds[result.newRootIds.length - 1],
    });
    return true;
}

/**
 * The whole of a paste, from wherever the payload turns out to be.
 *
 * Asynchronous because the machine's clipboard is held by the main process, and because a payload
 * from another project has its files imported before its elements are written - an asset that
 * arrives first makes its widget draw on the spot rather than after a second gesture.
 *
 * `resolveTarget` runs after those awaits rather than before them, against the document as it is by
 * then: a freeze, an undo or another editor's write can land while the clipboard is being read, and
 * a target picked before that could name an element the surface no longer has.
 */
async function pasteFromClipboard(
    documentService: UIDocumentService,
    stateService: UIEditorStateService,
    surfaceId: string,
    resolveTarget: () => UIEditorPasteTarget | null,
): Promise<boolean> {
    const source = await resolveUiPasteSource(documentService);
    if (!source) {
        return false;
    }
    if (!source.foreign) {
        const target = resolveTarget();
        return target ? applyClipboardPayload(documentService, stateService, surfaceId, target, source.payload) : false;
    }
    const report = await importForeignUiAssets(source);
    // Elements written into a frozen workspace reach the in-memory document, are refused at the
    // file-system boundary, and are gone again when the thaw re-reads it: a paste that looked like
    // it worked right up until the workspace came back.
    if (report.frozen || source.environment?.isFrozen()) {
        return false;
    }
    const target = resolveTarget();
    if (!target || !applyClipboardPayload(documentService, stateService, surfaceId, target, source.payload)) {
        return false;
    }
    reportForeignUiPaste(documentService, source, report);
    return true;
}

export function uiEditorPaste(
    documentService: UIDocumentService,
    localBp: LocalBlueprintService,
    stateService: UIEditorStateService,
    surfaceId: string,
    input: { hitElementId?: string | null; primaryElementId?: string | null },
): Promise<boolean> {
    void localBp;
    return pasteFromClipboard(documentService, stateService, surfaceId, () => {
        const resolved = resolveInsertTargetParent(documentService.getDocument(), surfaceId, {
            hitElementId: input.hitElementId,
            primaryElementId: input.primaryElementId,
        });
        return resolved ? { parentId: resolved.parentId, beforeChildId: null } : null;
    });
}

export function uiEditorPasteAfterSelection(
    documentService: UIDocumentService,
    localBp: LocalBlueprintService,
    stateService: UIEditorStateService,
    surfaceId: string,
    selection: UIElementSelection | null,
): Promise<boolean> {
    void localBp;
    return pasteFromClipboard(documentService, stateService, surfaceId, () =>
        resolvePasteTargetAfterSelection(documentService.getDocument(), surfaceId, selection));
}

/** Paste using an explicit parent (e.g. context menu on outline row). */
export function uiEditorPasteIntoParent(
    documentService: UIDocumentService,
    localBp: LocalBlueprintService,
    stateService: UIEditorStateService,
    surfaceId: string,
    targetParentId: string,
    beforeChildId: string | null = null,
): Promise<boolean> {
    void localBp;
    return pasteFromClipboard(documentService, stateService, surfaceId, () => ({ parentId: targetParentId, beforeChildId }));
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
    const payload = snapshotSelection(documentService, localBp, surfaceId, selection);
    if (!payload) {
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
    return applyClipboardPayload(documentService, stateService, surfaceId, { parentId, beforeChildId }, payload);
}

export function uiEditorDeleteSelection(
    documentService: UIDocumentService,
    stateService: UIEditorStateService,
    surfaceId: string,
    selection: UIElementSelection | null,
    uiService?: UIService | null,
): boolean {
    if (!selection || selection.surfaceId !== surfaceId || selection.elementIds.length === 0) {
        return false;
    }
    const doc = documentService.getDocument();
    const tops = filterSelectionToTopLevelMovers(doc, selection);
    if (tops.length === 0) {
        return false;
    }
    selectSurfaceForProperties(stateService, surfaceId, uiService);
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

/**
 * Dissolve every group in the selection, and select what came out of them.
 *
 * The way back out of `uiEditorGroupIntoLeaderContainer`. What stays selected is the selection with
 * each dissolved group replaced by its former children, filtered against the document afterwards so
 * that a nested group dissolved in the same pass does not leave a dead id behind. Ungrouping an
 * empty group leaves nothing to select, so the surface takes the properties panel as after a delete.
 */
export function uiEditorUngroupSelection(
    documentService: UIDocumentService,
    stateService: UIEditorStateService,
    surfaceId: string,
    selection: UIElementSelection | null,
    uiService?: UIService | null,
): boolean {
    if (!selection || selection.surfaceId !== surfaceId) {
        return false;
    }
    const containers = getContainersToUngroup(documentService.getDocument(), surfaceId, selection);
    if (containers.length === 0) {
        return false;
    }
    const dissolved = new Set(containers);
    const lifted = documentService.ungroupContainers(surfaceId, containers);

    const after = documentService.getDocument();
    const nextIds = [...new Set([...selection.elementIds.filter(id => !dissolved.has(id)), ...lifted])].filter(
        id => after.elements[id] != null,
    );
    if (nextIds.length === 0) {
        selectSurfaceForProperties(stateService, surfaceId, uiService);
        return true;
    }
    const previousPrimary = getSelectionPrimaryId(selection);
    stateService.setUIElementSelection({
        editor: "ui",
        surfaceId,
        elementIds: nextIds,
        primaryId:
            previousPrimary && nextIds.includes(previousPrimary)
                ? previousPrimary
                : nextIds[nextIds.length - 1],
    });
    return true;
}

export function uiEditorSelectAllInSurface(
    documentService: UIDocumentService,
    stateService: UIEditorStateService,
    surfaceId: string,
    uiService?: UIService | null,
): void {
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
        if (el.type !== "nl.root" && !isComponentEditorRootElement(el)) {
            ids.push(id);
        }
        el.childrenIds.forEach(walk);
    };
    walk(effectiveRootId);
    if (ids.length === 0) {
        selectSurfaceForProperties(stateService, surfaceId, uiService);
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
