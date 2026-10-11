import type { Blueprint, BlueprintDocument, BlueprintPrivateOwnerRecord } from "@shared/types/blueprint/document";
import type { TranslationKey } from "@shared/i18n";
import { ownerKeyBelongsToComponent, ownerKeyBelongsToSurface } from "@shared/blueprint/ownerKey";
import type { UIComponentDefinition, UIDocument, UIElement, UILayout, UISurface } from "@shared/types/ui-editor/document";
import { getUIComponentLink } from "@shared/types/ui-editor/document";
import {
    buildUIComponentEditorSurfaceId,
    readUIComponentEditorSurfaceComponentId,
} from "@shared/types/ui-editor/componentInstanceKey";
import type { UIStructDef } from "@shared/types/ui-editor/struct";
import { pruneUIStructs, readUIElementStructIds } from "@shared/types/ui-editor/structLibrary";
import { collectSubtreeElementIds } from "./uiDocumentTreeMove";
import { resolveSurfaceRootElementId } from "@/lib/ui-editor/runtime/resolveSurfaceRoot";
import { EventEmitter } from "../ui/EventEmitter";
import { HistoryService } from "../history/HistoryService";
import { DEFAULT_HISTORY_LIMIT, DEFAULT_MERGE_WINDOW_MS, type HistoryLabel, type HistoryScopeId } from "../history/historyModel";
import {
    HistoryScopeKind,
    historyScopeSubject,
    uiComponentHistoryScope,
    uiSurfaceHistoryScope,
} from "../history/historyScopes";
import { Service } from "../Service";
import { IUIEditorHistoryService, Services, WorkspaceContext } from "../services";
import { UIDocumentService } from "./UIDocumentService";
import { UIGraphService } from "./UIGraphService";
import { UIBlueprintLifecycleCoordinator } from "./UIBlueprintLifecycleCoordinator";
import { assertValidBlueprintDocument } from "./blueprint/documentValidation";

export type UIEditorBlueprintSurfaceSnapshot = {
    ownerRecords: Record<string, BlueprintPrivateOwnerRecord>;
    blueprints: Record<string, Blueprint>;
};

export type UIEditorUIDocumentSurfaceSnapshot = Pick<UIDocument, "schemaVersion" | "id" | "name" | "meta"> & {
    surfaces: UISurface[];
    elements: Record<string, UIElement>;
    /** The library shapes these elements name; see {@link captureNamedUIStructs}. */
    structs?: Record<string, UIStructDef>;
};

/**
 * One component definition as it stood: the whole record - its elements, params, size - or null when
 * the document held no definition by that id.
 *
 * The record and nothing else, because nothing else is part of a definition. Every placement of it
 * on a page holds only the component's id and its own param values, and draws the definition from
 * the document's library each time, so putting the record back is what puts every placement back.
 */
export type UIEditorComponentDocumentSnapshot = {
    componentId: string;
    component: UIComponentDefinition | null;
    /** The library shapes the definition's elements name; see {@link captureNamedUIStructs}. */
    structs?: Record<string, UIStructDef>;
    /**
     * Where each placement of the definition stood, by element id - only in the two snapshots of an
     * edit that moved them along with the definition.
     *
     * The exception to "the record and nothing else": making an element the root changes the
     * definition's size, and each placement is given a new box so it keeps drawing what it drew
     * (`promoteElementToComponentRoot`). Taking that step back has to give the boxes back with the
     * record, or every placement would draw the old definition squeezed into the new box. Absent on
     * every other step, so no other undo touches a page.
     */
    placements?: Record<string, UILayout>;
};

/** Where every placement of `componentId` on the project's pages stands, for a snapshot's `placements`. */
export function captureUIComponentPlacements(document: UIDocument, componentId: string): Record<string, UILayout> {
    const out: Record<string, UILayout> = {};
    for (const element of Object.values(document.elements)) {
        if (getUIComponentLink(element)?.componentId === componentId) {
            out[element.id] = cloneBlueprint(element.layout);
        }
    }
    return out;
}

/**
 * The shapes in the document's library that these elements name.
 *
 * A list's fields live in the library rather than on the list (`structLibrary.ts`), so a snapshot of
 * a page's elements alone held the pointer and not what it points at: renaming a field changed no
 * element, recorded no step, and could not be undone, and undoing a change of shape put back a
 * pointer to a shape the library had already dropped. Only the shapes these elements name, because a
 * page's undo must not reach into another page's lists - and a shape two lists share is never
 * reshaped in place (`applyUIStructFieldsForOwner` forks it), so putting one back changes nothing for
 * the other.
 */
function captureNamedUIStructs(
    document: Pick<UIDocument, "structs">,
    elements: Iterable<UIElement>,
): Record<string, UIStructDef> {
    const out: Record<string, UIStructDef> = {};
    for (const element of elements) {
        for (const id of readUIElementStructIds(element)) {
            const struct = document.structs?.[id];
            if (struct) {
                out[id] = cloneBlueprint(struct);
            }
        }
    }
    return out;
}

/** Put a snapshot's shapes back into `document`'s library and drop the ones nothing names now. */
function restoreNamedUIStructs(document: UIDocument, structs: Record<string, UIStructDef> | undefined): void {
    if (!structs) {
        return;
    }
    const library = { ...(document.structs ?? {}) };
    for (const [id, struct] of Object.entries(structs)) {
        library[id] = cloneBlueprint(struct);
    }
    document.structs = pruneUIStructs({ ...document, structs: library });
}

export type UIEditorHistorySnapshot = {
    document: UIEditorUIDocumentSurfaceSnapshot | UIEditorComponentDocumentSnapshot;
    blueprint: UIEditorBlueprintSurfaceSnapshot;
};

/**
 * The stack an editor's surface id undoes in.
 *
 * A page is its own scope. A component editor runs on a pseudo surface, `component-editor:<id>`,
 * that is in no page's document; its edits are edits to the definition, and land in the
 * definition's own scope (`ui-component:<id>`), one per component and so one per component tab.
 * Everything that speaks to this service in surface ids - the canvas keybindings, the drag commit's
 * transaction, the tab claiming the active scope - goes through here, so a component tab needs
 * nothing of its own to be undoable.
 */
export function uiEditorHistoryScope(surfaceId: string): HistoryScopeId {
    const componentId = readUIComponentEditorSurfaceComponentId(surfaceId);
    return componentId ? uiComponentHistoryScope(componentId) : uiSurfaceHistoryScope(surfaceId);
}

/** The editor surface id a scope of this service belongs to, or null for any other scope. */
function surfaceIdOfScope(scopeId: HistoryScopeId): string | null {
    const componentId = historyScopeSubject(scopeId, HistoryScopeKind.UIComponent);
    if (componentId) {
        return buildUIComponentEditorSurfaceId(componentId);
    }
    return historyScopeSubject(scopeId, HistoryScopeKind.UISurface);
}

function isComponentDocumentSnapshot(
    document: UIEditorHistorySnapshot["document"],
): document is UIEditorComponentDocumentSnapshot {
    return "componentId" in document;
}

export type UIEditorHistoryRecordOptions = {
    surfaceId: string;
    before: UIEditorHistorySnapshot;
    after: UIEditorHistorySnapshot;
    mergeKey?: string;
    mergeWindowMs?: number;
    /** What the step is called in the Edit menu, when it is more than an edit to the surface. */
    label?: HistoryLabel;
};

export type UIEditorHistoryEvents = {
    historyChanged: { surfaceId: string };
};

export function cloneUIHistoryDocument(document: UIDocument): UIDocument {
    return JSON.parse(JSON.stringify(document)) as UIDocument;
}

function cloneBlueprint<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

/** Which owner slots a snapshot slices out of the blueprint document. */
type OwnerKeyFilter = (ownerKey: string) => boolean;

function surfaceOwnerKeys(surfaceId: string): OwnerKeyFilter {
    return ownerKey => ownerKeyBelongsToSurface(ownerKey, surfaceId);
}

function componentOwnerKeys(componentId: string): OwnerKeyFilter {
    return ownerKey => ownerKeyBelongsToComponent(ownerKey, componentId);
}

export function captureBlueprintSurfaceSnapshot(
    blueprintDocument: BlueprintDocument,
    surfaceId: string,
): UIEditorBlueprintSurfaceSnapshot {
    return captureBlueprintOwnerSnapshot(blueprintDocument, surfaceOwnerKeys(surfaceId));
}

/** The private blueprints of one component definition's widgets. */
export function captureBlueprintComponentSnapshot(
    blueprintDocument: BlueprintDocument,
    componentId: string,
): UIEditorBlueprintSurfaceSnapshot {
    return captureBlueprintOwnerSnapshot(blueprintDocument, componentOwnerKeys(componentId));
}

function captureBlueprintOwnerSnapshot(
    blueprintDocument: BlueprintDocument,
    belongs: OwnerKeyFilter,
): UIEditorBlueprintSurfaceSnapshot {
    const ownerRecords: Record<string, BlueprintPrivateOwnerRecord> = {};
    const blueprints: Record<string, Blueprint> = {};

    for (const [ownerKey, ownerRecord] of Object.entries(blueprintDocument.ownerRecords)) {
        if (!belongs(ownerKey)) {
            continue;
        }
        ownerRecords[ownerKey] = cloneBlueprint(ownerRecord);
        const blueprint = blueprintDocument.blueprints[ownerRecord.blueprintId];
        if (blueprint) {
            blueprints[ownerRecord.blueprintId] = cloneBlueprint(blueprint);
        }
    }

    return { ownerRecords, blueprints };
}

export function applyBlueprintSurfaceSnapshot(
    document: BlueprintDocument,
    surfaceId: string,
    target: UIEditorBlueprintSurfaceSnapshot,
): void {
    applyBlueprintOwnerSnapshot(document, surfaceOwnerKeys(surfaceId), target);
}

export function applyBlueprintComponentSnapshot(
    document: BlueprintDocument,
    componentId: string,
    target: UIEditorBlueprintSurfaceSnapshot,
): void {
    applyBlueprintOwnerSnapshot(document, componentOwnerKeys(componentId), target);
}

function applyBlueprintOwnerSnapshot(
    document: BlueprintDocument,
    belongs: OwnerKeyFilter,
    target: UIEditorBlueprintSurfaceSnapshot,
): void {
    const targetOwnerKeys = new Set(Object.keys(target.ownerRecords));
    const targetBlueprintIds = new Set(Object.keys(target.blueprints));

    for (const [ownerKey, ownerRecord] of Object.entries(document.ownerRecords)) {
        if (!belongs(ownerKey) || targetOwnerKeys.has(ownerKey)) {
            continue;
        }
        if (!targetBlueprintIds.has(ownerRecord.blueprintId)) {
            delete document.blueprints[ownerRecord.blueprintId];
        }
        delete document.ownerRecords[ownerKey];
    }

    for (const [ownerKey, targetOwnerRecord] of Object.entries(target.ownerRecords)) {
        const previousOwnerRecord = document.ownerRecords[ownerKey];
        if (
            previousOwnerRecord
            && previousOwnerRecord.blueprintId !== targetOwnerRecord.blueprintId
            && !targetBlueprintIds.has(previousOwnerRecord.blueprintId)
        ) {
            delete document.blueprints[previousOwnerRecord.blueprintId];
        }
        document.ownerRecords[ownerKey] = cloneBlueprint(targetOwnerRecord);
    }

    for (const [blueprintId, targetBlueprint] of Object.entries(target.blueprints)) {
        if (!document.blueprints[blueprintId]) {
            document.blueprints[blueprintId] = cloneBlueprint(targetBlueprint);
        }
    }
}

/**
 * A snapshot's document half as compared for "did anything change".
 *
 * A definition's `updatedAt` is left out: every write to a definition stamps it, so a write that
 * changes nothing else - a field committed with the value it already had - would otherwise be an
 * undo step that visibly does nothing, and the author would press Ctrl+Z twice to get anywhere.
 */
function comparableDocument(document: UIEditorHistorySnapshot["document"]): string {
    if (!isComponentDocumentSnapshot(document) || !document.component) {
        return JSON.stringify(document);
    }
    const { updatedAt: _updatedAt, ...rest } = document.component;
    return JSON.stringify({ ...document, component: rest });
}

function areSnapshotsEqual(a: UIEditorHistorySnapshot, b: UIEditorHistorySnapshot): boolean {
    return comparableDocument(a.document) === comparableDocument(b.document) &&
        JSON.stringify(a.blueprint) === JSON.stringify(b.blueprint);
}

export function captureUIDocumentComponentSnapshot(
    document: UIDocument,
    componentId: string,
): UIEditorComponentDocumentSnapshot {
    const component = (document.components ?? []).find(item => item.id === componentId);
    return {
        componentId,
        component: component ? cloneBlueprint(component) : null,
        structs: captureNamedUIStructs(document, Object.values(component?.elements ?? {})),
    };
}

/**
 * `current` with one definition put back as the snapshot holds it, everything else untouched.
 *
 * In its own place in the library, so the component panel does not reorder under the author. A
 * definition the snapshot holds and the document no longer does is appended, which is what undoing
 * in the scope of a definition deleted since would do - the same as a page's scope.
 */
export function applyUIDocumentComponentSnapshot(
    currentDocument: UIDocument,
    target: UIEditorComponentDocumentSnapshot,
): UIDocument {
    const next = cloneUIHistoryDocument(currentDocument);
    const components = [...(next.components ?? [])];
    const index = components.findIndex(component => component.id === target.componentId);
    if (target.component && index >= 0) {
        components[index] = cloneBlueprint(target.component);
    } else if (target.component) {
        components.push(cloneBlueprint(target.component));
    } else if (index >= 0) {
        components.splice(index, 1);
    }
    next.components = components;
    restoreNamedUIStructs(next, target.structs);
    for (const [elementId, layout] of Object.entries(target.placements ?? {})) {
        const placement = next.elements[elementId];
        // Still a placement of this definition: one unlinked since keeps the box it has now.
        if (placement && getUIComponentLink(placement)?.componentId === target.componentId) {
            placement.layout = cloneBlueprint(layout);
        }
    }
    return next;
}

export function captureUIDocumentSurfaceSnapshot(
    document: UIDocument,
    surfaceId: string,
): UIEditorUIDocumentSurfaceSnapshot {
    const surface = document.surfaces.find(next => next.id === surfaceId);
    const elements: Record<string, UIElement> = {};
    if (surface) {
        const rootElementId = resolveSurfaceRootElementId(document, surfaceId);
        if (rootElementId) {
            for (const elementId of collectSubtreeElementIds(document, rootElementId)) {
                const element = document.elements[elementId];
                if (element) {
                    elements[elementId] = cloneBlueprint(element);
                }
            }
        }
    }

    return {
        schemaVersion: document.schemaVersion,
        id: document.id,
        name: document.name,
        surfaces: surface ? [cloneBlueprint(surface)] : [],
        elements,
        structs: captureNamedUIStructs(document, Object.values(elements)),
        meta: document.meta ? cloneBlueprint(document.meta) : undefined,
    };
}

export function applyUIDocumentSurfaceSnapshot(
    currentDocument: UIDocument,
    targetDocument: UIDocument | UIEditorUIDocumentSurfaceSnapshot,
    surfaceId: string,
): UIDocument {
    const next = cloneUIHistoryDocument(currentDocument);
    const currentRootId = resolveSurfaceRootElementId(next, surfaceId);
    if (currentRootId) {
        const currentIds = collectSubtreeElementIds(next, currentRootId);
        for (const elementId of currentIds) {
            delete next.elements[elementId];
        }
    }

    const targetSurface = targetDocument.surfaces.find(surface => surface.id === surfaceId);
    const currentSurfaceIndex = next.surfaces.findIndex(surface => surface.id === surfaceId);
    if (targetSurface && currentSurfaceIndex >= 0) {
        next.surfaces[currentSurfaceIndex] = cloneBlueprint(targetSurface);
    } else if (targetSurface) {
        next.surfaces.push(cloneBlueprint(targetSurface));
    } else if (currentSurfaceIndex >= 0) {
        next.surfaces.splice(currentSurfaceIndex, 1);
    }

    const targetRootId = resolveSurfaceRootElementId(targetDocument as UIDocument, surfaceId);
    const targetElementIds = targetRootId
        ? collectSubtreeElementIds(targetDocument as UIDocument, targetRootId)
        : Object.keys(targetDocument.elements);
    for (const elementId of targetElementIds) {
        const element = targetDocument.elements[elementId];
        if (element) {
            next.elements[elementId] = cloneBlueprint(element);
        }
    }
    restoreNamedUIStructs(next, "structs" in targetDocument ? targetDocument.structs : undefined);

    return next;
}

/**
 * Undo for the UI editor: one stack per page, and one per component definition.
 *
 * What is left here after the stacks moved to {@link HistoryService} is the part that is actually
 * about the interface: which slice of the two documents belongs to a page or to a definition, and
 * how to put that slice back without disturbing the others. The stack itself - depth, merging, redo
 * invalidation, "is a restore in progress" - is shared with every other editor now, so a change to
 * how undo behaves is one change rather than five.
 *
 * The public shape speaks in editor surface ids on purpose: callers should not have to learn scope
 * ids to ask whether Ctrl+Z will do something. A component editor's pseudo surface id
 * (`component-editor:<id>`) is one of them, and names the definition's slice and scope - see
 * {@link uiEditorHistoryScope}.
 */
export class UIEditorHistoryService
    extends Service<UIEditorHistoryService>
    implements IUIEditorHistoryService
{
    /** Editor surfaces this service has registered a scope for, so it can re-limit and clear them. */
    private readonly registered = new Map<string, () => void>();
    private readonly events = new EventEmitter<UIEditorHistoryEvents>();
    private limit = DEFAULT_HISTORY_LIMIT;
    private unsubscribe: (() => void) | null = null;

    protected init(_ctx: WorkspaceContext): void {
        this.unsubscribe?.();
        // One bridge from the shared "some stack changed" event to this service's surface-shaped
        // one, so the editor's existing subscribers keep working.
        this.unsubscribe = this.history().on("changed", ({ scopeId }) => {
            const surfaceId = surfaceIdOfScope(scopeId);
            if (surfaceId) {
                this.events.emit("historyChanged", { surfaceId });
            }
        });
    }

    public getLimit(): number {
        return this.limit;
    }

    public setLimit(limit: number): void {
        const next = Math.max(1, Math.floor(limit));
        if (!Number.isFinite(next) || next === this.limit) {
            return;
        }
        this.limit = next;
        for (const surfaceId of this.registered.keys()) {
            this.history().setScopeLimit(uiEditorHistoryScope(surfaceId), next);
        }
    }

    /**
     * The slice of the two documents `surfaceId` undoes.
     *
     * `withPlacements` adds where the definition's placements stand, for a component editor's step
     * that moves them along with the definition (see `UIEditorComponentDocumentSnapshot.placements`).
     */
    public captureSnapshot(surfaceId: string, options: { withPlacements?: boolean } = {}): UIEditorHistorySnapshot {
        const uidoc = this.getContext().services.get<UIDocumentService>(Services.UIDocument);
        const graph = this.getContext().services.get<UIGraphService>(Services.UIGraph);
        const componentId = readUIComponentEditorSurfaceComponentId(surfaceId);
        if (componentId) {
            const document = uidoc.getDocument();
            return {
                document: {
                    ...captureUIDocumentComponentSnapshot(document, componentId),
                    ...(options.withPlacements ? { placements: captureUIComponentPlacements(document, componentId) } : {}),
                },
                blueprint: captureBlueprintComponentSnapshot(graph.getDocument().blueprintDocument, componentId),
            };
        }
        return {
            document: captureUIDocumentSurfaceSnapshot(uidoc.getDocument(), surfaceId),
            blueprint: captureBlueprintSurfaceSnapshot(graph.getDocument().blueprintDocument, surfaceId),
        };
    }

    public record(options: UIEditorHistoryRecordOptions): void {
        this.ensureScope(options.surfaceId);
        this.history().pushSnapshot<UIEditorHistorySnapshot>(uiEditorHistoryScope(options.surfaceId), {
            label: options.label ?? { key: "workspace.history.entry.surfaceEdit" as TranslationKey },
            before: options.before,
            after: options.after,
            mergeKey: options.mergeKey,
            mergeWindowMs: options.mergeWindowMs ?? DEFAULT_MERGE_WINDOW_MS,
            equals: areSnapshotsEqual,
        });
    }

    /**
     * Put `surfaceId`'s slice of the two documents back as `snapshot` holds it - the path undo takes,
     * blueprints included - and record nothing.
     *
     * For an edit that has to be all or nothing: a batch that fails part way is put back to the
     * snapshot taken before it, and a restore of the interface document alone would leave every widget
     * the batch deleted with a fresh, empty blueprint in place of its own.
     */
    public restoreSnapshot(surfaceId: string, snapshot: UIEditorHistorySnapshot): void {
        this.history().withoutRecording(() => this.restore(surfaceId, snapshot));
    }

    public canUndo(surfaceId: string): boolean {
        return this.history().canUndo(uiEditorHistoryScope(surfaceId));
    }

    public canRedo(surfaceId: string): boolean {
        return this.history().canRedo(uiEditorHistoryScope(surfaceId));
    }

    public undo(surfaceId: string): boolean {
        this.ensureScope(surfaceId);
        return this.history().undo(uiEditorHistoryScope(surfaceId));
    }

    public redo(surfaceId: string): boolean {
        this.ensureScope(surfaceId);
        return this.history().redo(uiEditorHistoryScope(surfaceId));
    }

    public clear(surfaceId?: string): void {
        if (surfaceId) {
            this.history().clearScope(uiEditorHistoryScope(surfaceId));
            return;
        }
        this.history().clearMatching(scopeId => surfaceIdOfScope(scopeId) !== null);
        for (const dispose of this.registered.values()) {
            dispose();
        }
        this.registered.clear();
    }

    public on<K extends keyof UIEditorHistoryEvents>(
        event: K,
        handler: (data: UIEditorHistoryEvents[K]) => void,
    ): () => void {
        return this.events.on(event, handler);
    }

    public override dispose(_ctx: WorkspaceContext): void {
        this.unsubscribe?.();
        this.unsubscribe = null;
        for (const dispose of this.registered.values()) {
            dispose();
        }
        this.registered.clear();
        this.events.clear();
    }

    private history(): HistoryService {
        return this.getContext().services.get<HistoryService>(Services.History);
    }

    /**
     * Publish this surface's readers once.
     *
     * Registered for the life of the workspace rather than the life of the editor tab: the two
     * documents a snapshot slices are service-owned and readable whether or not anything is showing
     * them, so there is no window in which an entry recorded here cannot be applied.
     */
    private ensureScope(surfaceId: string): void {
        if (this.registered.has(surfaceId)) {
            return;
        }
        const dispose = this.history().registerScope<UIEditorHistorySnapshot>({
            id: uiEditorHistoryScope(surfaceId),
            label: { key: "workspace.history.scope.uiSurface" as TranslationKey },
            capture: () => this.captureSnapshot(surfaceId),
            apply: snapshot => this.restore(surfaceId, snapshot),
            limit: this.limit,
        });
        this.registered.set(surfaceId, dispose);
    }

    private restore(surfaceId: string, snapshot: UIEditorHistorySnapshot): void {
        const uidoc = this.getContext().services.get<UIDocumentService>(Services.UIDocument);
        const graph = this.getContext().services.get<UIGraphService>(Services.UIGraph);
        const lifecycle = this.getContext().services.get<UIBlueprintLifecycleCoordinator>(Services.UIBlueprintLifecycle);
        const target = snapshot.document;

        // The document first and the blueprints after, then one reconciliation: the reconciler
        // collects every private blueprint whose widget is gone, so it must not run between the
        // two - after a deleted widget's restore it would see the widget and its logic both back.
        if (isComponentDocumentSnapshot(target)) {
            uidoc.restoreDocumentFromHistory(
                applyUIDocumentComponentSnapshot(uidoc.getDocument(), target),
                { skipAfterMutateHook: true },
            );
            graph.applyGraphMutation(document => {
                applyBlueprintComponentSnapshot(document.blueprintDocument, target.componentId, snapshot.blueprint);
                assertValidBlueprintDocument(document.blueprintDocument);
            });
        } else {
            uidoc.restoreDocumentFromHistory(
                applyUIDocumentSurfaceSnapshot(uidoc.getDocument(), target, surfaceId),
                { skipAfterMutateHook: true },
            );
            graph.applyGraphMutation(document => {
                applyBlueprintSurfaceSnapshot(document.blueprintDocument, surfaceId, snapshot.blueprint);
                assertValidBlueprintDocument(document.blueprintDocument);
            });
        }
        lifecycle.syncFromUidoc();
    }
}
