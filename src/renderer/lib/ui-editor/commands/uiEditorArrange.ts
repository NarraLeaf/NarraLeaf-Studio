import type { UIDocument } from "@shared/types/ui-editor/document";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import {
    sortElementIdsByPreorder,
} from "@/lib/workspace/services/ui-editor/uiDocumentTreeMove";
import { resolveSurfaceRootElementId } from "@/lib/ui-editor/runtime/resolveSurfaceRoot";
import { filterSelectionToTopLevelMovers } from "./uiEditorSelection";

const ROOT_WIDGET_TYPE = "nl.root";

/** @internal Exported for unit tests */
export function isContiguousSiblingBlock(childrenIds: readonly string[], blockSet: ReadonlySet<string>): boolean {
    const indices: number[] = [];
    for (let i = 0; i < childrenIds.length; i++) {
        if (blockSet.has(childrenIds[i])) {
            indices.push(i);
        }
    }
    if (indices.length === 0 || indices.length !== blockSet.size) {
        return false;
    }
    const min = indices[0];
    const max = indices[indices.length - 1];
    for (let i = min; i <= max; i++) {
        if (!blockSet.has(childrenIds[i])) {
            return false;
        }
    }
    return true;
}

/** Movers occupy trailing indices [len-k .. len-1]. */
function moversAlreadyAtFrontEnd(childrenIds: readonly string[], moverSet: ReadonlySet<string>): boolean {
    const idxs: number[] = [];
    for (let i = 0; i < childrenIds.length; i++) {
        if (moverSet.has(childrenIds[i])) {
            idxs.push(i);
        }
    }
    if (idxs.length === 0) {
        return false;
    }
    const k = idxs.length;
    const start = childrenIds.length - k;
    if (idxs[0] !== start) {
        return false;
    }
    for (let j = 0; j < k; j++) {
        if (idxs[j] !== start + j) {
            return false;
        }
    }
    return true;
}

/** Movers occupy leading indices [0 .. k-1]. */
function moversAlreadyAtBack(childrenIds: readonly string[], moverSet: ReadonlySet<string>): boolean {
    const idxs: number[] = [];
    for (let i = 0; i < childrenIds.length; i++) {
        if (moverSet.has(childrenIds[i])) {
            idxs.push(i);
        }
    }
    if (idxs.length === 0) {
        return false;
    }
    const k = idxs.length;
    if (idxs[0] !== 0) {
        return false;
    }
    for (let j = 0; j < k; j++) {
        if (idxs[j] !== j) {
            return false;
        }
    }
    return true;
}

/**
 * Move contiguous sibling block one step toward the front (later in `childrenIds`, higher paint order).
 * @internal Exported for unit tests
 */
export function computeBringForwardOrder(childrenIds: readonly string[], blockIds: readonly string[]): string[] | null {
    const set = new Set(blockIds);
    if (!isContiguousSiblingBlock(childrenIds, set)) {
        return null;
    }
    let min = -1;
    let max = -1;
    for (let i = 0; i < childrenIds.length; i++) {
        if (set.has(childrenIds[i])) {
            if (min < 0) {
                min = i;
            }
            max = i;
        }
    }
    if (max >= childrenIds.length - 1) {
        return null;
    }
    const next = childrenIds[max + 1];
    const without = childrenIds.filter(id => !set.has(id));
    const blockOrdered = childrenIds.filter(id => set.has(id));
    const posNext = without.indexOf(next);
    if (posNext < 0) {
        return null;
    }
    return [...without.slice(0, posNext + 1), ...blockOrdered, ...without.slice(posNext + 1)];
}

/**
 * Move contiguous sibling block one step toward the back (earlier in `childrenIds`).
 * @internal Exported for unit tests
 */
export function computeSendBackwardOrder(childrenIds: readonly string[], blockIds: readonly string[]): string[] | null {
    const set = new Set(blockIds);
    if (!isContiguousSiblingBlock(childrenIds, set)) {
        return null;
    }
    let min = childrenIds.length;
    for (let i = 0; i < childrenIds.length; i++) {
        if (set.has(childrenIds[i])) {
            min = Math.min(min, i);
        }
    }
    if (min <= 0) {
        return null;
    }
    const prev = childrenIds[min - 1];
    const without = childrenIds.filter(id => !set.has(id));
    const blockOrdered = childrenIds.filter(id => set.has(id));
    const posPrev = without.indexOf(prev);
    if (posPrev < 0) {
        return null;
    }
    return [...without.slice(0, posPrev), ...blockOrdered, ...without.slice(posPrev)];
}

function getArrangeMovers(document: UIDocument, selection: UIElementSelection): string[] {
    const tops = filterSelectionToTopLevelMovers(document, selection);
    return tops.filter(id => {
        const el = document.elements[id];
        return el != null && el.type !== ROOT_WIDGET_TYPE;
    });
}

function groupMoversByParent(document: UIDocument, movers: string[]): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const id of movers) {
        const el = document.elements[id];
        const p = el?.parentId;
        if (p == null) {
            continue;
        }
        const list = map.get(p);
        if (list) {
            list.push(id);
        } else {
            map.set(p, [id]);
        }
    }
    return map;
}

export type UiEditorArrangeOp = "bringToFront" | "sendToBack" | "bringForward" | "sendBackward";

export type UiEditorArrangeAvailability = {
    bringToFront: boolean;
    sendToBack: boolean;
    bringForward: boolean;
    sendBackward: boolean;
};

/**
 * Whether each arrange action should be enabled for the current selection (same rules as the commands).
 */
export function getUiEditorArrangeAvailability(
    document: UIDocument,
    surfaceId: string,
    selection: UIElementSelection | null,
): UiEditorArrangeAvailability {
    const none: UiEditorArrangeAvailability = {
        bringToFront: false,
        sendToBack: false,
        bringForward: false,
        sendBackward: false,
    };
    if (!selection || selection.surfaceId !== surfaceId || selection.elementIds.length === 0) {
        return none;
    }
    const movers = getArrangeMovers(document, selection);
    if (movers.length === 0) {
        return none;
    }
    const effectiveRoot = resolveSurfaceRootElementId(document, surfaceId);
    if (!effectiveRoot) {
        return none;
    }
    const byParent = groupMoversByParent(document, movers);

    let bringToFront = false;
    let sendToBack = false;
    let bringForward = true;
    let sendBackward = true;

    for (const [parentId, ids] of byParent) {
        const parent = document.elements[parentId];
        if (!parent) {
            bringForward = false;
            sendBackward = false;
            continue;
        }
        const ordered = sortElementIdsByPreorder(document, effectiveRoot, ids);
        const moverSet = new Set(ordered);
        const { childrenIds } = parent;

        if (!moversAlreadyAtFrontEnd(childrenIds, moverSet)) {
            bringToFront = true;
        }
        const firstNonMover = childrenIds.find(cid => !moverSet.has(cid));
        if (firstNonMover != null && !moversAlreadyAtBack(childrenIds, moverSet)) {
            sendToBack = true;
        }

        const nextF = computeBringForwardOrder(childrenIds, ordered);
        const nextB = computeSendBackwardOrder(childrenIds, ordered);
        if (nextF == null) {
            bringForward = false;
        }
        if (nextB == null) {
            sendBackward = false;
        }
    }

    return { bringToFront, sendToBack, bringForward, sendBackward };
}

export function uiEditorArrange(
    documentService: UIDocumentService,
    surfaceId: string,
    selection: UIElementSelection | null,
    op: UiEditorArrangeOp,
): boolean {
    if (!selection || selection.surfaceId !== surfaceId) {
        return false;
    }
    const doc0 = documentService.getDocument();
    const movers0 = getArrangeMovers(doc0, selection);
    if (movers0.length === 0) {
        return false;
    }
    const effectiveRoot = resolveSurfaceRootElementId(doc0, surfaceId);
    if (!effectiveRoot) {
        return false;
    }
    const byParent = groupMoversByParent(doc0, movers0);
    let changed = false;

    if (op === "bringToFront" || op === "sendToBack") {
        for (const [parentId, ids] of byParent) {
            const doc = documentService.getDocument();
            const parent = doc.elements[parentId];
            if (!parent) {
                continue;
            }
            const ordered = sortElementIdsByPreorder(doc, effectiveRoot, ids);
            const moverSet = new Set(ordered);
            if (op === "bringToFront") {
                if (moversAlreadyAtFrontEnd(parent.childrenIds, moverSet)) {
                    continue;
                }
                const r = documentService.moveElementsInSurface(surfaceId, ordered, parentId, null);
                if (r.ok) {
                    changed = true;
                }
            } else {
                const firstNonMover = parent.childrenIds.find(cid => !moverSet.has(cid));
                if (firstNonMover == null || moversAlreadyAtBack(parent.childrenIds, moverSet)) {
                    continue;
                }
                const r = documentService.moveElementsInSurface(surfaceId, ordered, parentId, firstNonMover);
                if (r.ok) {
                    changed = true;
                }
            }
        }
        return changed;
    }

    for (const [parentId, ids] of byParent) {
        const doc = documentService.getDocument();
        const parent = doc.elements[parentId];
        if (!parent) {
            continue;
        }
        const ordered = sortElementIdsByPreorder(doc, effectiveRoot, ids);
        const next =
            op === "bringForward"
                ? computeBringForwardOrder(parent.childrenIds, ordered)
                : computeSendBackwardOrder(parent.childrenIds, ordered);
        if (next == null) {
            continue;
        }
        documentService.reorderChildren(parentId, next);
        changed = true;
    }
    return changed;
}
