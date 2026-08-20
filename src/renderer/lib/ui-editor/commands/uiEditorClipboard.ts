import type { AssetTransferManifestEntry } from "@shared/types/assetTransfer";
import type { Blueprint } from "@shared/types/blueprint/document";
import type { UIDocument, UIElement, UIElementId } from "@shared/types/ui-editor/document";
import { collectSubtreeElementIds, filterToTopLevelMovers } from "@/lib/workspace/services/ui-editor/uiDocumentTreeMove";
import { resolveSurfaceRootElementId } from "@/lib/ui-editor/runtime/resolveSurfaceRoot";
import { isComponentEditorRootElement } from "@/lib/ui-editor/componentEditorRoot";

export const UI_EDITOR_CLIPBOARD_VERSION = 1 as const;

/**
 * What a payload calls itself.
 *
 * Present because the payload can now arrive off the system clipboard, written by another Studio of
 * another version: the format name says it is ours, and this says what it is. A payload without it
 * was written in this window and never left it.
 */
export const UI_EDITOR_CLIPBOARD_KIND = "narraleaf.ui.elements" as const;

/**
 * The project a copy was made in.
 *
 * `path` is the identity, and the only field compared - normalised through `normalizeProjectPath`,
 * the one key every project-path comparison in Studio agrees on. The identifier and the name travel
 * for display: two projects can carry the same identifier, so it settles nothing.
 */
export type UIEditorClipboardSource = {
    path: string;
    identifier: string;
    name: string;
};

/** The files a copied selection references, as a manifest plus the token that stands for them. */
export type UIEditorClipboardAssets = {
    token: string;
    entries: AssetTransferManifestEntry[];
};

export type UIEditorClipboardPayload = {
    v: typeof UI_EDITOR_CLIPBOARD_VERSION;
    /** Absent on a payload that never left this window. See {@link UI_EDITOR_CLIPBOARD_KIND}. */
    kind?: typeof UI_EDITOR_CLIPBOARD_KIND;
    /**
     * Identifies this copy, so a paste can tell the clipboard's payload from the one this window
     * holds in memory. Equal ids mean the two are the same copy and the in-memory one is used
     * verbatim, which is what keeps a same-project paste exactly what it has always been.
     */
    copyId?: string;
    /** Absent on a payload written before the field existed, which can only be this window's own. */
    source?: UIEditorClipboardSource;
    /** Absent when the copied selection references no importable file. */
    assets?: UIEditorClipboardAssets;
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
 * A payload read back off the system clipboard, or null when what is there is not one.
 *
 * Rebuilt rather than trusted. The JSON was written by another process - another project's window,
 * or another Studio of another version - and the paste that consumes it indexes into `elements`,
 * walks `childrenIds` and clones `layout`. An entry that is not shaped like an element is dropped
 * here rather than allowed to throw half-way through a document mutation.
 *
 * Only the structure is judged. Every *id* inside is left exactly as it arrived: whether a
 * reference resolves in this project is the paste's question, and one it answers by importing what
 * it can and reporting what it cannot - never by emptying a field.
 */
export function readUiEditorClipboardPayload(json: string): UIEditorClipboardPayload | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== "object") {
        return null;
    }
    const candidate = parsed as Record<string, unknown>;
    if (candidate.kind !== UI_EDITOR_CLIPBOARD_KIND || candidate.v !== UI_EDITOR_CLIPBOARD_VERSION) {
        return null;
    }
    const elements = readElementTable(candidate.elements);
    const topLevelElementIds = readStringArray(candidate.topLevelElementIds).filter(id => elements[id]);
    if (topLevelElementIds.length === 0) {
        return null;
    }
    const sourceSurfaceId = typeof candidate.sourceSurfaceId === "string" ? candidate.sourceSurfaceId : "";
    const source = readSource(candidate.source);
    const assets = readAssets(candidate.assets);
    return {
        v: UI_EDITOR_CLIPBOARD_VERSION,
        kind: UI_EDITOR_CLIPBOARD_KIND,
        ...(typeof candidate.copyId === "string" && candidate.copyId ? { copyId: candidate.copyId } : {}),
        ...(source ? { source } : {}),
        ...(assets ? { assets } : {}),
        sourceSurfaceId,
        topLevelElementIds,
        elements,
        widgetMainBlueprints: readBlueprintTable(candidate.widgetMainBlueprints),
        widgetValueBlueprints: readBlueprintTable(candidate.widgetValueBlueprints),
    };
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
    /** Identifies this copy. Omitted only where nothing will ever compare two payloads. */
    copyId?: string;
    /** The project the copy is made in, so a window pasting it can tell whose ids these are. */
    source?: UIEditorClipboardSource;
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
        kind: UI_EDITOR_CLIPBOARD_KIND,
        ...(input.copyId ? { copyId: input.copyId } : {}),
        ...(input.source ? { source: input.source } : {}),
        sourceSurfaceId: surfaceId,
        topLevelElementIds: topLevel,
        elements,
        widgetMainBlueprints,
        widgetValueBlueprints,
    };
}

function readStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

/**
 * The elements of a parsed payload, keeping only what the paste can actually copy.
 *
 * The four fields below are the ones `pasteClipboardPayload` reads without asking first; everything
 * else on an element is optional there and is carried through untouched, including props this
 * Studio has never heard of - a widget contributed by a plugin the pasting project also has must
 * survive the trip whole.
 */
function readElementTable(value: unknown): Record<UIElementId, UIElement> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    const elements: Record<UIElementId, UIElement> = {};
    for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
        if (!id || !entry || typeof entry !== "object") {
            continue;
        }
        const element = entry as Partial<UIElement>;
        if (typeof element.type !== "string" || !Array.isArray(element.childrenIds) || !element.layout) {
            continue;
        }
        elements[id] = {
            ...(element as UIElement),
            id,
            childrenIds: element.childrenIds.filter((childId): childId is string => typeof childId === "string"),
        };
    }
    return elements;
}

/** The blueprints of a parsed payload: those that carry an id, an owner and a program. */
function readBlueprintTable(value: unknown): Record<string, Blueprint> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    const blueprints: Record<string, Blueprint> = {};
    for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
        if (!id || !entry || typeof entry !== "object") {
            continue;
        }
        const blueprint = entry as Partial<Blueprint>;
        if (!blueprint.owner || !blueprint.program) {
            continue;
        }
        blueprints[id] = { ...(blueprint as Blueprint), id };
    }
    return blueprints;
}

function readSource(value: unknown): UIEditorClipboardSource | undefined {
    if (!value || typeof value !== "object") {
        return undefined;
    }
    const record = value as Record<string, unknown>;
    const path = typeof record.path === "string" ? record.path : "";
    if (!path.trim()) {
        return undefined;
    }
    return {
        path,
        identifier: typeof record.identifier === "string" ? record.identifier : "",
        name: typeof record.name === "string" ? record.name : "",
    };
}

function readAssets(value: unknown): UIEditorClipboardAssets | undefined {
    if (!value || typeof value !== "object") {
        return undefined;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.token !== "string" || !record.token || !Array.isArray(record.entries)) {
        return undefined;
    }
    const entries: AssetTransferManifestEntry[] = [];
    for (const entry of record.entries) {
        const manifest = entry as Partial<AssetTransferManifestEntry> | null;
        if (!manifest || typeof manifest.assetId !== "string" || !manifest.assetId) {
            continue;
        }
        entries.push({
            assetId: manifest.assetId,
            fileName: typeof manifest.fileName === "string" ? manifest.fileName : "",
            type: typeof manifest.type === "string" ? manifest.type : "",
            ...(typeof manifest.size === "number" ? { size: manifest.size } : {}),
        });
    }
    return { token: record.token, entries };
}
