import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIComponentDefinition, UIDocument, UIElement, UISurface } from "@shared/types/ui-editor/document";
import type { UIStructDef } from "@shared/types/ui-editor/struct";
import { readUIElementStructIds } from "@shared/types/ui-editor/structLibrary";
import {
    applyBlueprintComponentSnapshot,
    applyBlueprintSurfaceSnapshot,
    captureBlueprintComponentSnapshot,
    captureBlueprintSurfaceSnapshot,
    type UIEditorBlueprintSurfaceSnapshot,
} from "./UIEditorHistoryService";
import { collectSubtreeElementIds } from "./uiDocumentTreeMove";

/**
 * Whole pages and whole component definitions, taken out of a project and put back.
 *
 * What an undo step for a library operation holds - deleting a component, adding one, adding the
 * pages and components a template or a pasted page brings. Each of those adds or removes records
 * whole, so the step is not a snapshot of the library: it is the records themselves, read at the
 * moment they leave and written back exactly as they were. Edits anybody made to the rest of the
 * library in between are never touched.
 *
 * A record carries everything that leaves the project with it and nothing the project keeps:
 *
 *  - **its place in the order.** The component library and the page list are drawn in document order,
 *    so a definition put back at the end would quietly move in the panel.
 *  - **its widgets' private blueprints.** The lifecycle sweep collects a blueprint whose widget has
 *    gone (`UIBlueprintLifecycleCoordinator`) and gives a returning widget a fresh, empty one, so the
 *    authored graphs have to travel with the record.
 *  - **the item shapes its lists name.** A shape nothing names is pruned at the next edit of any
 *    list's fields (`pruneUIStructs`), and a list put back pointing at a pruned shape draws no rows.
 *
 * Instances on pages are not part of a definition's record: a placement stores the definition's id
 * and its own parameter values, and draws the definition from the library each time - so putting the
 * record back is what makes every placement draw again. Translations and assets stay in the project
 * whatever happens to the records that use them.
 *
 * Pure functions over the two documents; the document service decides when they run.
 */

export type UIComponentRecord = {
    index: number;
    component: UIComponentDefinition;
    blueprint: UIEditorBlueprintSurfaceSnapshot;
    structs: Record<string, UIStructDef>;
};

export type UISurfaceRecord = {
    index: number;
    surface: UISurface;
    /** The page's own tree, root included. */
    elements: Record<string, UIElement>;
    blueprint: UIEditorBlueprintSurfaceSnapshot;
    structs: Record<string, UIStructDef>;
};

export type UILibraryRecords = {
    surfaces: UISurfaceRecord[];
    components: UIComponentRecord[];
    /**
     * The entry page as the document named it, when the entry was one of these pages. Taking the page
     * out takes the pointer with it - a pointer at a page that is not there resolves to whichever page
     * happens to be first - and putting the page back puts the pointer back.
     */
    entrySurfaceId?: string;
};

export function isEmptyUILibraryRecords(records: UILibraryRecords): boolean {
    return records.surfaces.length === 0 && records.components.length === 0;
}

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

/** The shapes, present in the document, that these elements name. Built-in shapes are never stored. */
function namedStructs(document: UIDocument, elements: Iterable<UIElement>): Record<string, UIStructDef> {
    const out: Record<string, UIStructDef> = {};
    for (const element of elements) {
        for (const id of readUIElementStructIds(element)) {
            const struct = document.structs?.[id];
            if (struct) {
                out[id] = clone(struct);
            }
        }
    }
    return out;
}

const NO_BLUEPRINTS: UIEditorBlueprintSurfaceSnapshot = { ownerRecords: {}, blueprints: {} };

/**
 * The named definitions and pages as they stand, in document order. Ids the document lacks are
 * skipped. Without a blueprint document - a service with no graphs behind it - the records carry
 * no blueprints.
 */
export function captureUILibraryRecords(
    document: UIDocument,
    blueprintDocument: BlueprintDocument | null,
    ids: { surfaceIds?: readonly string[]; componentIds?: readonly string[] },
): UILibraryRecords {
    const surfaceIds = new Set(ids.surfaceIds ?? []);
    const componentIds = new Set(ids.componentIds ?? []);
    const surfaces: UISurfaceRecord[] = [];
    document.surfaces.forEach((surface, index) => {
        if (!surfaceIds.has(surface.id)) {
            return;
        }
        const elements: Record<string, UIElement> = {};
        for (const elementId of collectSubtreeElementIds(document, surface.rootElementId)) {
            const element = document.elements[elementId];
            if (element) {
                elements[elementId] = clone(element);
            }
        }
        surfaces.push({
            index,
            surface: clone(surface),
            elements,
            blueprint: blueprintDocument ? captureBlueprintSurfaceSnapshot(blueprintDocument, surface.id) : NO_BLUEPRINTS,
            structs: namedStructs(document, Object.values(elements)),
        });
    });
    const components: UIComponentRecord[] = [];
    (document.components ?? []).forEach((component, index) => {
        if (!componentIds.has(component.id)) {
            return;
        }
        components.push({
            index,
            component: clone(component),
            blueprint: blueprintDocument ? captureBlueprintComponentSnapshot(blueprintDocument, component.id) : NO_BLUEPRINTS,
            structs: namedStructs(document, Object.values(component.elements)),
        });
    });
    const entry = document.entrySurfaceId;
    return {
        surfaces,
        components,
        ...(entry && surfaceIds.has(entry) && surfaces.some(record => record.surface.id === entry)
            ? { entrySurfaceId: entry }
            : {}),
    };
}

/** Take the records' pages and definitions out of the interface document. */
export function removeUILibraryRecords(document: UIDocument, records: UILibraryRecords): void {
    const surfaceIds = new Set(records.surfaces.map(record => record.surface.id));
    const componentIds = new Set(records.components.map(record => record.component.id));
    if (surfaceIds.size > 0) {
        const removed = new Set<string>();
        for (const surface of document.surfaces) {
            if (surfaceIds.has(surface.id)) {
                collectSubtreeElementIds(document, surface.rootElementId).forEach(id => removed.add(id));
            }
        }
        document.surfaces = document.surfaces.filter(surface => !surfaceIds.has(surface.id));
        for (const id of removed) {
            delete document.elements[id];
        }
        if (records.entrySurfaceId && document.entrySurfaceId === records.entrySurfaceId) {
            delete document.entrySurfaceId;
        }
    }
    if (componentIds.size > 0) {
        document.components = (document.components ?? []).filter(component => !componentIds.has(component.id));
    }
}

/**
 * Put the records' pages and definitions back where they stood.
 *
 * In ascending order of their old positions, so each one lands at the index it had: everything
 * before it in the old order is either still there or has already been put back. A position past the
 * end - the library shrank since - is the end. A shape that is still in the document is left as it
 * is; only the pruned ones come back.
 */
export function insertUILibraryRecords(document: UIDocument, records: UILibraryRecords): void {
    const surfaces = [...document.surfaces];
    for (const record of [...records.surfaces].sort((a, b) => a.index - b.index)) {
        if (surfaces.some(surface => surface.id === record.surface.id)) {
            continue;
        }
        surfaces.splice(Math.min(record.index, surfaces.length), 0, clone(record.surface));
        for (const [elementId, element] of Object.entries(record.elements)) {
            document.elements[elementId] = clone(element);
        }
    }
    document.surfaces = surfaces;
    const components = [...(document.components ?? [])];
    for (const record of [...records.components].sort((a, b) => a.index - b.index)) {
        if (components.some(component => component.id === record.component.id)) {
            continue;
        }
        components.splice(Math.min(record.index, components.length), 0, clone(record.component));
    }
    if (records.components.length > 0 || document.components) {
        document.components = components;
    }
    const structs = [...records.surfaces, ...records.components].map(record => record.structs);
    for (const table of structs) {
        for (const [id, struct] of Object.entries(table)) {
            if (!document.structs?.[id]) {
                document.structs = { ...(document.structs ?? {}), [id]: clone(struct) };
            }
        }
    }
    if (records.entrySurfaceId && !document.entrySurfaceId) {
        document.entrySurfaceId = records.entrySurfaceId;
    }
}

/** Put the records' private blueprints back into the blueprint document. */
export function restoreUILibraryBlueprints(document: BlueprintDocument, records: UILibraryRecords): void {
    for (const record of records.surfaces) {
        applyBlueprintSurfaceSnapshot(document, record.surface.id, record.blueprint);
    }
    for (const record of records.components) {
        applyBlueprintComponentSnapshot(document, record.component.id, record.blueprint);
    }
}

/**
 * Take the records' private blueprints out of the blueprint document.
 *
 * The lifecycle sweep does the same after the interface document loses the records; this is the
 * explicit half, so the two documents agree whether or not a sweep is wired behind the service.
 */
export function removeUILibraryBlueprints(document: BlueprintDocument, records: UILibraryRecords): void {
    for (const record of records.surfaces) {
        applyBlueprintSurfaceSnapshot(document, record.surface.id, NO_BLUEPRINTS);
    }
    for (const record of records.components) {
        applyBlueprintComponentSnapshot(document, record.component.id, NO_BLUEPRINTS);
    }
}
