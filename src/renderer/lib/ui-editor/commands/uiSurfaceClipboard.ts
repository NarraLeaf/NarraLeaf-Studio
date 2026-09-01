import { MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import type { InterpolationParams, PluralKey, TranslationKey } from "@shared/i18n";
import type { Blueprint, BlueprintDocument, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { anchorSurfaceId } from "@shared/blueprint/ownerShape";
import type { UIDocument, UIElement, UIElementId, UISurface } from "@shared/types/ui-editor/document";
import { collectSubtreeElementIds } from "@/lib/workspace/services/ui-editor/uiDocumentTreeMove";
import {
    readUiClipboardElementTable,
    UI_EDITOR_CLIPBOARD_VERSION,
    type UIEditorClipboardAssets,
    type UIEditorClipboardPayload,
    type UIEditorClipboardSource,
} from "./uiEditorClipboard";

/**
 * A whole interface - a page or a Game UI - on the machine's clipboard.
 *
 * The element clipboard next door carries a selection out of one surface; this carries the surface
 * itself, which is the unit an author reuses between projects: a title screen, a settings page, a
 * dialog layout. What travels is the shape {@link UIDocumentService.importTemplateBundle} already
 * reads - a `UIDocument` holding the one surface and its elements, plus the blueprints that belong
 * to it - so a page arriving from another project is imported by the same code that imports one
 * from the template store, under fresh surface, element and blueprint ids, with every reference
 * between them repointed together.
 *
 * The foreign-paste rules are the element clipboard's, unchanged (`uiEditorForeignPaste`):
 *
 *  - **Assets are made to resolve**, imported under the ids they already have, so the surface's
 *    props keep pointing at the files they pointed at.
 *  - **Everything else keeps its id and is reported.** A library component this project does not
 *    have stays named by the instance that uses it (`ui/component-missing`); a Page widget
 *    embedding a page that did not travel keeps its target (`ui/frame-target-missing`).
 *
 * Library components are deliberately *not* carried. A component definition is a second element
 * tree with its own blueprints, and shipping one would put a component into the receiving project's
 * library that its author never added - the same trade the element clipboard makes, for the same
 * reason.
 */

export const UI_SURFACE_CLIPBOARD_VERSION = 1 as const;

/** What a payload calls itself, so a payload written by another Studio can be recognised. */
export const UI_SURFACE_CLIPBOARD_KIND = "narraleaf.ui.surfaces" as const;

export type UISurfaceClipboardPayload = {
    v: typeof UI_SURFACE_CLIPBOARD_VERSION;
    kind: typeof UI_SURFACE_CLIPBOARD_KIND;
    /** Identifies this copy, so a paste can tell the clipboard's payload from this window's own. */
    copyId?: string;
    /** The project the copy was made in. Its `path` is the identity; the rest is for display. */
    source?: UIEditorClipboardSource;
    /** Absent when the copied surface references no importable file. */
    assets?: UIEditorClipboardAssets;
    /** The copied surfaces and their elements, in the shape a template bundle's document has. */
    document: UIDocument;
    /** Their blueprints, in the shape a template bundle's graphs have. */
    graphs: { blueprintDocument: BlueprintDocument };
};

let inMemoryClipboard: UISurfaceClipboardPayload | null = null;
const listeners = new Set<() => void>();

export function getUiSurfaceClipboard(): UISurfaceClipboardPayload | null {
    return inMemoryClipboard;
}

export function setUiSurfaceClipboard(payload: UISurfaceClipboardPayload | null): void {
    if (inMemoryClipboard === payload) {
        return;
    }
    inMemoryClipboard = payload;
    listeners.forEach(listener => listener());
}

/**
 * Watch what this window holds, because a control depends on whether it holds anything.
 *
 * The surfaces panel offers Paste only when there is an interface to paste, so it has to hear both
 * ways one can appear: a copy made in this window, and a copy made in another that this window
 * reads off the machine's clipboard when it comes forward.
 */
export function subscribeUiSurfaceClipboard(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * Snapshot one surface, its elements and its blueprints.
 *
 * Returns null for the main page: it is the one surface the project must have exactly one of, so
 * it can be neither duplicated nor imported, and a payload that pastes as nothing is worse than a
 * copy gesture that is simply not offered.
 */
export function buildUiSurfaceClipboardPayload(input: {
    document: UIDocument;
    surfaceId: string;
    blueprintDocument: BlueprintDocument | null;
    copyId?: string;
    source?: UIEditorClipboardSource;
}): UISurfaceClipboardPayload | null {
    const { document, surfaceId, blueprintDocument } = input;
    if (surfaceId === MAIN_APP_SURFACE_ID) {
        return null;
    }
    const surface = document.surfaces.find(candidate => candidate.id === surfaceId);
    if (!surface || !document.elements[surface.rootElementId]) {
        return null;
    }
    const elements: Record<UIElementId, UIElement> = {};
    for (const elementId of collectSubtreeElementIds(document, surface.rootElementId)) {
        const element = document.elements[elementId];
        if (element) {
            elements[elementId] = cloneJson(element);
        }
    }
    return {
        v: UI_SURFACE_CLIPBOARD_VERSION,
        kind: UI_SURFACE_CLIPBOARD_KIND,
        ...(input.copyId ? { copyId: input.copyId } : {}),
        ...(input.source ? { source: input.source } : {}),
        document: {
            schemaVersion: document.schemaVersion,
            id: document.id,
            name: document.name,
            surfaces: [cloneJson(surface)],
            elements,
            meta: {},
        },
        graphs: { blueprintDocument: collectSurfaceBlueprints(blueprintDocument, surfaceId) },
    };
}

/**
 * A payload read back off the system clipboard, or null when what is there is not one.
 *
 * Rebuilt rather than trusted, for the reason the element clipboard's reader gives: the JSON was
 * written by another process, and the import walks `childrenIds`, clones `layout` and indexes into
 * `elements`. The main page is dropped here as well as at import time, so a payload naming it
 * cannot make a paste that reports a surface it did not add.
 *
 * Only the structure is judged. Every id inside is left exactly as it arrived; whether a reference
 * resolves in this project is the paste's question.
 */
export function readUiSurfaceClipboardPayload(json: string): UISurfaceClipboardPayload | null {
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
    if (candidate.kind !== UI_SURFACE_CLIPBOARD_KIND || candidate.v !== UI_SURFACE_CLIPBOARD_VERSION) {
        return null;
    }
    const document = readSurfaceDocument(candidate.document);
    if (!document) {
        return null;
    }
    const source = readSource(candidate.source);
    const assets = readAssets(candidate.assets);
    return {
        v: UI_SURFACE_CLIPBOARD_VERSION,
        kind: UI_SURFACE_CLIPBOARD_KIND,
        ...(typeof candidate.copyId === "string" && candidate.copyId ? { copyId: candidate.copyId } : {}),
        ...(source ? { source } : {}),
        ...(assets ? { assets } : {}),
        document,
        graphs: { blueprintDocument: readBlueprintDocument(candidate.graphs) },
    };
}

/**
 * The payload a paste should use: the machine's clipboard, or this window's own.
 *
 * The same rule the element clipboard follows. The clipboard outranks the in-window copy whenever
 * the two are different copies, because the clipboard is what the author last filled - possibly in
 * another project's window. When they are the same copy the in-window payload is used verbatim. A
 * clipboard holding something else leaves this window's copy standing rather than clearing it.
 */
export function chooseUiSurfacePastePayload(
    inMemory: UISurfaceClipboardPayload | null,
    fromClipboard: UISurfaceClipboardPayload | null,
): UISurfaceClipboardPayload | null {
    if (!fromClipboard) {
        return inMemory;
    }
    if (inMemory?.copyId && fromClipboard.copyId === inMemory.copyId) {
        return inMemory;
    }
    return fromClipboard;
}

/**
 * The copied surface seen as a selection of elements.
 *
 * Everything the foreign-paste rules ask of a payload - which files it names, which of its
 * references this project cannot answer - is a question about elements and the graphs beside them,
 * and `uiEditorForeignPaste` already answers it. A surface differs only in where those two live, so
 * it is presented in the shape those functions read rather than counted a second time here.
 *
 * The blueprints go in under one key because none of those functions draws the distinction between
 * a widget's main graph and a Value graph; they walk whatever is there.
 */
export function asUiElementSelection(payload: UISurfaceClipboardPayload): UIEditorClipboardPayload {
    return {
        v: UI_EDITOR_CLIPBOARD_VERSION,
        ...(payload.source ? { source: payload.source } : {}),
        ...(payload.assets ? { assets: payload.assets } : {}),
        sourceSurfaceId: payload.document.surfaces[0]?.id ?? "",
        topLevelElementIds: payload.document.surfaces.map(surface => surface.rootElementId),
        elements: payload.document.elements,
        widgetMainBlueprints: payload.graphs.blueprintDocument.blueprints,
        widgetValueBlueprints: {},
    };
}

/** What a paste of interfaces left the author with. */
export type UiSurfacePasteOutcome = {
    /** Interfaces that are now in this project. */
    added: number;
    /**
     * Stage slots that already held a Game UI, named in the active locale.
     *
     * A Game UI keeps the slot it had in the project it was copied from, so a slot this project has
     * already filled is the one case where the interface stays behind. Nothing is replaced and
     * nothing is moved elsewhere; the author is told which slot, and the rest of the paste stands.
     */
    slotsInUse: string[];
    /** The project the copy was made in, when the paste can name it. */
    project: string | null;
    /** Files that were not in this project and now are. */
    imported: number;
    /** Fields still naming something this project does not have, counted per field. */
    unresolved: number;
};

/** The translator {@link describeUiSurfacePaste} renders through, passed in like `getStageSlotLabel`'s. */
export type UiSurfacePasteTranslator = {
    t: (key: TranslationKey, params?: InterpolationParams) => string;
    tn: (key: PluralKey, count: number, params?: InterpolationParams) => string;
};

/**
 * What the paste did, as one line. Anything that came to nothing is left out.
 *
 * Counts only. Every unresolved reference is also reported per site by the project lint -
 * `assets/missing` for a file, `ui/component-missing` for an instance of a component this project
 * does not have - and that is the report which can jump to the widget holding it.
 */
export function describeUiSurfacePaste(
    outcome: UiSurfacePasteOutcome,
    translator: UiSurfacePasteTranslator,
): string {
    const parts: string[] = [];
    if (outcome.added > 0) {
        parts.push(outcome.project
            ? translator.tn("uiEditor.crossProject.surfacePastedFrom", outcome.added, { project: outcome.project })
            : translator.tn("uiEditor.crossProject.surfacePasted", outcome.added));
    }
    for (const slot of outcome.slotsInUse) {
        parts.push(translator.t("uiEditor.crossProject.slotTaken", { slot }));
    }
    if (outcome.imported > 0) {
        parts.push(translator.tn("uiEditor.crossProject.imported", outcome.imported));
    }
    if (outcome.unresolved > 0) {
        parts.push(translator.tn("uiEditor.crossProject.unresolved", outcome.unresolved));
    }
    if (parts.length === 0) {
        parts.push(translator.t("uiEditor.crossProject.surfaceNotAdded"));
    }
    return parts.join(" · ");
}

/** How loudly {@link describeUiSurfacePaste} reads: anything the author has to act on is a warning. */
export function getUiSurfacePasteLevel(outcome: UiSurfacePasteOutcome): "info" | "warning" {
    return outcome.added === 0 || outcome.slotsInUse.length > 0 || outcome.unresolved > 0 ? "warning" : "info";
}

function cloneJson<T>(value: T): T {
    return value == null ? value : JSON.parse(JSON.stringify(value)) as T;
}

/**
 * The blueprints belonging to one surface, as a document of their own.
 *
 * A surface's logic is not on the surface: it lives in the blueprint document, filed under owner
 * keys naming `(surfaceId, elementId)`. Only the records whose blueprints are owned by this surface
 * travel - a global graph, a story action's graph and every other surface's stay where they are,
 * which keeps a copy from putting the whole project's logic on the system clipboard.
 *
 * A record whose active blueprint is not among the ones it lists is dropped rather than carried:
 * that is the invariant `assertValidBlueprintDocument` enforces on the far side, and one broken
 * record there costs the import every blueprint the surface has.
 */
function collectSurfaceBlueprints(source: BlueprintDocument | null, surfaceId: string): BlueprintDocument {
    const blueprints: Record<string, Blueprint> = {};
    const ownerRecords: BlueprintDocument["ownerRecords"] = {};
    for (const [ownerKey, record] of Object.entries(source?.ownerRecords ?? {})) {
        const owned = (record.privateBlueprintIds ?? [])
            .map(blueprintId => source?.blueprints[blueprintId])
            .filter((blueprint): blueprint is Blueprint => Boolean(blueprint));
        if (owned.length === 0 || !ownsSurface(owned[0].owner, surfaceId)) {
            continue;
        }
        if (!owned.some(blueprint => blueprint.id === record.activeBlueprintId)) {
            continue;
        }
        for (const blueprint of owned) {
            blueprints[blueprint.id] = cloneJson(blueprint);
        }
        ownerRecords[ownerKey] = {
            ...cloneJson(record),
            privateBlueprintIds: owned.map(blueprint => blueprint.id),
        };
    }
    return {
        schemaVersion: source?.schemaVersion ?? BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        blueprints,
        ownerRecords,
    };
}

function ownsSurface(owner: BlueprintOwnerRef, surfaceId: string): boolean {
    return anchorSurfaceId(owner) === surfaceId;
}

/**
 * The document of a parsed payload, keeping only surfaces an import can actually place.
 *
 * A surface needs an id, a root element that is in the table, and a kind the placement rules know;
 * anything else would reach `importTemplateBundle` as a surface it silently skips, which the report
 * would then have to guess at.
 */
function readSurfaceDocument(value: unknown): UIDocument | null {
    if (!value || typeof value !== "object") {
        return null;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.schemaVersion !== "number" || !Array.isArray(record.surfaces)) {
        return null;
    }
    const elements = readUiClipboardElementTable(record.elements);
    const surfaces: UISurface[] = [];
    for (const entry of record.surfaces) {
        const surface = entry as Partial<UISurface> | null;
        if (!surface || typeof surface !== "object") {
            continue;
        }
        if (typeof surface.id !== "string" || !surface.id || surface.id === MAIN_APP_SURFACE_ID) {
            continue;
        }
        if (typeof surface.rootElementId !== "string" || !elements[surface.rootElementId]) {
            continue;
        }
        if (surface.kind !== "appSurface" && surface.kind !== "stageSurface") {
            continue;
        }
        surfaces.push(surface as UISurface);
    }
    if (surfaces.length === 0) {
        return null;
    }
    return {
        schemaVersion: record.schemaVersion,
        id: typeof record.id === "string" ? record.id : "",
        name: typeof record.name === "string" ? record.name : "",
        surfaces,
        elements,
        meta: {},
    };
}

/**
 * The blueprints of a parsed payload.
 *
 * Shallow: the migration and the full validation run inside `importTemplateBundle`, which drops a
 * graph document it cannot read and keeps the surface. What matters here is only that the two
 * tables are objects, so nothing downstream has to guard an `Object.entries` of a string.
 */
function readBlueprintDocument(value: unknown): BlueprintDocument {
    const empty: BlueprintDocument = {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        blueprints: {},
        ownerRecords: {},
    };
    if (!value || typeof value !== "object") {
        return empty;
    }
    const candidate = (value as { blueprintDocument?: unknown }).blueprintDocument;
    if (!candidate || typeof candidate !== "object") {
        return empty;
    }
    const record = candidate as Record<string, unknown>;
    if (!isPlainRecord(record.blueprints) || !isPlainRecord(record.ownerRecords)) {
        return empty;
    }
    return candidate as BlueprintDocument;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
    const entries = record.entries.flatMap(entry => {
        const manifest = entry as { assetId?: unknown; fileName?: unknown; type?: unknown; size?: unknown } | null;
        if (!manifest || typeof manifest.assetId !== "string" || !manifest.assetId) {
            return [];
        }
        return [{
            assetId: manifest.assetId,
            fileName: typeof manifest.fileName === "string" ? manifest.fileName : "",
            type: typeof manifest.type === "string" ? manifest.type : "",
            ...(typeof manifest.size === "number" ? { size: manifest.size } : {}),
        }];
    });
    return { token: record.token, entries };
}
