import type { Blueprint } from "@shared/types/blueprint/document";
import type { UIDocument, UIElement, UIElementId } from "@shared/types/ui-editor/document";
import { collectSubtreeElementIds, filterToTopLevelMovers } from "@/lib/workspace/services/ui-editor/uiDocumentTreeMove";
import { resolveSurfaceRootElementId } from "@/lib/ui-editor/runtime/resolveSurfaceRoot";
import { isComponentEditorRootElement } from "@/lib/ui-editor/componentEditorRoot";

export const UI_EDITOR_CLIPBOARD_VERSION = 1 as const;

export type UIEditorClipboardPayload = {
    v: typeof UI_EDITOR_CLIPBOARD_VERSION;
    sourceSurfaceId: string;
    /** Top-level roots in the copied selection (original ids). */
    topLevelElementIds: UIElementId[];
    /** All elements in the copied subtrees, keyed by original id. */
    elements: Record<UIElementId, UIElement>;
    /** Widget main blueprints keyed by original blueprint id (deduped). */
    widgetMainBlueprints: Record<string, Blueprint>;
    /** Blueprint Value blueprints keyed by original blueprint id (deduped). */
    widgetValueBlueprints: Record<string, Blueprint>;
};

let inMemoryClipboard: UIEditorClipboardPayload | null = null;

export function getUiEditorClipboard(): UIEditorClipboardPayload | null {
    return inMemoryClipboard;
}

export function setUiEditorClipboard(payload: UIEditorClipboardPayload | null): void {
    inMemoryClipboard = payload;
}

export function clearUiEditorClipboard(): void {
    inMemoryClipboard = null;
}

export function hasUiEditorClipboard(): boolean {
    return inMemoryClipboard != null;
}

/**
 * Collect every element id in the union of subtrees rooted at `topLevelIds` (inclusive).
 */
export function collectSubtreeIdsForRoots(document: UIDocument, effectiveRootId: string, topLevelIds: string[]): Set<string> {
    const allowed = collectSubtreeElementIds(document, effectiveRootId);
    const out = new Set<string>();
    const walk = (id: string) => {
        if (!allowed.has(id) || out.has(id)) {
            return;
        }
        out.add(id);
        const el = document.elements[id];
        el?.childrenIds.forEach(walk);
    };
    for (const id of topLevelIds) {
        walk(id);
    }
    return out;
}

export function buildUiEditorClipboardPayload(input: {
    document: UIDocument;
    surfaceId: string;
    selectedElementIds: string[];
    getWidgetMainBlueprint: (surfaceId: string, elementId: string) => Blueprint | undefined;
    getWidgetValueBlueprint?: (surfaceId: string, elementId: string, propPath: string) => Blueprint | undefined;
}): UIEditorClipboardPayload | null {
    const { document, surfaceId, selectedElementIds, getWidgetMainBlueprint, getWidgetValueBlueprint } = input;
    if (selectedElementIds.length === 0) {
        return null;
    }
    const effectiveRootId = resolveSurfaceRootElementId(document, surfaceId);
    if (!effectiveRootId) {
        return null;
    }
    const topLevel = filterToTopLevelMovers(document, selectedElementIds).filter(id => {
        const el = document.elements[id];
        return el && el.type !== "nl.root" && !isComponentEditorRootElement(el);
    });
    if (topLevel.length === 0) {
        return null;
    }
    const subtree = collectSubtreeIdsForRoots(document, effectiveRootId, topLevel);
    const elements: Record<string, UIElement> = {};
    const widgetMainBlueprints: Record<string, Blueprint> = {};
    const widgetValueBlueprints: Record<string, Blueprint> = {};

    for (const id of subtree) {
        const el = document.elements[id];
        if (!el || el.type === "nl.root" || isComponentEditorRootElement(el)) {
            continue;
        }
        elements[id] = JSON.parse(JSON.stringify(el)) as UIElement;
        const bp = getWidgetMainBlueprint(surfaceId, id);
        if (bp && !widgetMainBlueprints[bp.id]) {
            widgetMainBlueprints[bp.id] = JSON.parse(JSON.stringify(bp)) as Blueprint;
        }
        for (const propPath of Object.keys(el.valueBindings ?? {})) {
            const valueBp = getWidgetValueBlueprint?.(surfaceId, id, propPath);
            if (valueBp && !widgetValueBlueprints[valueBp.id]) {
                widgetValueBlueprints[valueBp.id] = JSON.parse(JSON.stringify(valueBp)) as Blueprint;
            }
        }
    }

    return {
        v: UI_EDITOR_CLIPBOARD_VERSION,
        sourceSurfaceId: surfaceId,
        topLevelElementIds: topLevel,
        elements,
        widgetMainBlueprints,
        widgetValueBlueprints,
    };
}
