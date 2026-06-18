import type { Blueprint, BlueprintDocument, BlueprintPrivateOwnerRecord } from "@shared/types/blueprint/document";
import type { UIDocument, UIElement, UISurface } from "@shared/types/ui-editor/document";
import { collectSubtreeElementIds } from "./uiDocumentTreeMove";
import { resolveSurfaceRootElementId } from "@/lib/ui-editor/runtime/resolveSurfaceRoot";
import { EventEmitter } from "../ui/EventEmitter";
import { Service } from "../Service";
import { IUIEditorHistoryService, Services, WorkspaceContext } from "../services";
import { UIDocumentService } from "./UIDocumentService";
import { UIGraphService } from "./UIGraphService";
import { UIBlueprintLifecycleCoordinator } from "./UIBlueprintLifecycleCoordinator";
import { assertValidBlueprintDocument } from "./blueprint/documentValidation";

const DEFAULT_HISTORY_LIMIT = 100;
const DEFAULT_MERGE_WINDOW_MS = 800;

export type UIEditorBlueprintSurfaceSnapshot = {
    ownerRecords: Record<string, BlueprintPrivateOwnerRecord>;
    blueprints: Record<string, Blueprint>;
};

export type UIEditorUIDocumentSurfaceSnapshot = Pick<UIDocument, "schemaVersion" | "id" | "name" | "meta"> & {
    surfaces: UISurface[];
    elements: Record<string, UIElement>;
};

export type UIEditorHistorySnapshot = {
    document: UIEditorUIDocumentSurfaceSnapshot;
    blueprint: UIEditorBlueprintSurfaceSnapshot;
};

export type UIEditorHistoryRecordOptions = {
    surfaceId: string;
    before: UIEditorHistorySnapshot;
    after: UIEditorHistorySnapshot;
    mergeKey?: string;
    mergeWindowMs?: number;
};

export type UIEditorHistoryEvents = {
    historyChanged: { surfaceId: string };
};

type UIEditorHistoryEntry = {
    surfaceId: string;
    before: UIEditorHistorySnapshot;
    after: UIEditorHistorySnapshot;
    mergeKey?: string;
    createdAt: number;
    updatedAt: number;
};

type UIEditorSurfaceHistory = {
    undo: UIEditorHistoryEntry[];
    redo: UIEditorHistoryEntry[];
};

export function cloneUIHistoryDocument(document: UIDocument): UIDocument {
    return JSON.parse(JSON.stringify(document)) as UIDocument;
}

function cloneBlueprint<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function isSurfaceBlueprintOwnerKey(surfaceId: string, ownerKey: string): boolean {
    return ownerKey === `surfaceMain:${surfaceId}` ||
        ownerKey.startsWith(`widgetMain:${surfaceId}:`) ||
        ownerKey.startsWith(`widgetValue:${surfaceId}:`);
}

export function captureBlueprintSurfaceSnapshot(
    blueprintDocument: BlueprintDocument,
    surfaceId: string,
): UIEditorBlueprintSurfaceSnapshot {
    const ownerRecords: Record<string, BlueprintPrivateOwnerRecord> = {};
    const blueprints: Record<string, Blueprint> = {};

    for (const [ownerKey, ownerRecord] of Object.entries(blueprintDocument.ownerRecords)) {
        if (!isSurfaceBlueprintOwnerKey(surfaceId, ownerKey)) {
            continue;
        }
        ownerRecords[ownerKey] = cloneBlueprint(ownerRecord);
        for (const blueprintId of ownerRecord.privateBlueprintIds) {
            const blueprint = blueprintDocument.blueprints[blueprintId];
            if (blueprint) {
                blueprints[blueprintId] = cloneBlueprint(blueprint);
            }
        }
    }

    return { ownerRecords, blueprints };
}

export function applyBlueprintSurfaceSnapshot(
    document: BlueprintDocument,
    surfaceId: string,
    target: UIEditorBlueprintSurfaceSnapshot,
): void {
    const targetOwnerKeys = new Set(Object.keys(target.ownerRecords));
    const targetBlueprintIds = new Set(Object.keys(target.blueprints));

    for (const [ownerKey, ownerRecord] of Object.entries(document.ownerRecords)) {
        if (!isSurfaceBlueprintOwnerKey(surfaceId, ownerKey) || targetOwnerKeys.has(ownerKey)) {
            continue;
        }
        for (const blueprintId of ownerRecord.privateBlueprintIds) {
            if (!targetBlueprintIds.has(blueprintId)) {
                delete document.blueprints[blueprintId];
            }
        }
        delete document.ownerRecords[ownerKey];
    }

    for (const [ownerKey, targetOwnerRecord] of Object.entries(target.ownerRecords)) {
        const previousOwnerRecord = document.ownerRecords[ownerKey];
        const targetIds = new Set(targetOwnerRecord.privateBlueprintIds);
        if (previousOwnerRecord) {
            for (const blueprintId of previousOwnerRecord.privateBlueprintIds) {
                if (!targetIds.has(blueprintId) && !targetBlueprintIds.has(blueprintId)) {
                    delete document.blueprints[blueprintId];
                }
            }
        }
        document.ownerRecords[ownerKey] = cloneBlueprint(targetOwnerRecord);
    }

    for (const [blueprintId, targetBlueprint] of Object.entries(target.blueprints)) {
        if (!document.blueprints[blueprintId]) {
            document.blueprints[blueprintId] = cloneBlueprint(targetBlueprint);
        }
    }
}

function areSnapshotsEqual(a: UIEditorHistorySnapshot, b: UIEditorHistorySnapshot): boolean {
    return JSON.stringify(a.document) === JSON.stringify(b.document) &&
        JSON.stringify(a.blueprint) === JSON.stringify(b.blueprint);
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

    return next;
}

export class UIEditorHistoryService
    extends Service<UIEditorHistoryService>
    implements IUIEditorHistoryService
{
    private readonly histories = new Map<string, UIEditorSurfaceHistory>();
    private readonly events = new EventEmitter<UIEditorHistoryEvents>();
    private limit = DEFAULT_HISTORY_LIMIT;
    private isRestoring = false;

    protected init(_ctx: WorkspaceContext): void {}

    public getLimit(): number {
        return this.limit;
    }

    public setLimit(limit: number): void {
        const next = Math.max(1, Math.floor(limit));
        if (!Number.isFinite(next) || next === this.limit) {
            return;
        }
        this.limit = next;
        for (const [surfaceId, history] of this.histories) {
            this.trim(history);
            this.events.emit("historyChanged", { surfaceId });
        }
    }

    public captureSnapshot(surfaceId: string): UIEditorHistorySnapshot {
        const uidoc = this.getContext().services.get<UIDocumentService>(Services.UIDocument);
        const graph = this.getContext().services.get<UIGraphService>(Services.UIGraph);
        return {
            document: captureUIDocumentSurfaceSnapshot(uidoc.getDocument(), surfaceId),
            blueprint: captureBlueprintSurfaceSnapshot(graph.getDocument().blueprintDocument, surfaceId),
        };
    }

    public record(options: UIEditorHistoryRecordOptions): void {
        if (this.isRestoring || areSnapshotsEqual(options.before, options.after)) {
            return;
        }

        const history = this.ensureHistory(options.surfaceId);
        const now = Date.now();
        const mergeWindowMs = options.mergeWindowMs ?? DEFAULT_MERGE_WINDOW_MS;
        const previous = history.undo[history.undo.length - 1];
        if (
            options.mergeKey &&
            previous?.mergeKey === options.mergeKey &&
            previous.surfaceId === options.surfaceId &&
            now - previous.updatedAt <= mergeWindowMs
        ) {
            previous.after = options.after;
            previous.updatedAt = now;
            history.redo = [];
            this.events.emit("historyChanged", { surfaceId: options.surfaceId });
            return;
        }

        history.undo.push({
            surfaceId: options.surfaceId,
            before: options.before,
            after: options.after,
            mergeKey: options.mergeKey,
            createdAt: now,
            updatedAt: now,
        });
        this.trim(history);
        history.redo = [];
        this.events.emit("historyChanged", { surfaceId: options.surfaceId });
    }

    public canUndo(surfaceId: string): boolean {
        return (this.histories.get(surfaceId)?.undo.length ?? 0) > 0;
    }

    public canRedo(surfaceId: string): boolean {
        return (this.histories.get(surfaceId)?.redo.length ?? 0) > 0;
    }

    public undo(surfaceId: string): boolean {
        const history = this.histories.get(surfaceId);
        const entry = history?.undo.pop();
        if (!entry || !history) {
            return false;
        }
        this.restore(entry.surfaceId, entry.before);
        history.redo.push(entry);
        this.events.emit("historyChanged", { surfaceId });
        return true;
    }

    public redo(surfaceId: string): boolean {
        const history = this.histories.get(surfaceId);
        const entry = history?.redo.pop();
        if (!entry || !history) {
            return false;
        }
        this.restore(entry.surfaceId, entry.after);
        history.undo.push(entry);
        this.events.emit("historyChanged", { surfaceId });
        return true;
    }

    public clear(surfaceId?: string): void {
        if (surfaceId) {
            this.histories.delete(surfaceId);
            this.events.emit("historyChanged", { surfaceId });
            return;
        }
        const ids = [...this.histories.keys()];
        this.histories.clear();
        ids.forEach(id => this.events.emit("historyChanged", { surfaceId: id }));
    }

    public on<K extends keyof UIEditorHistoryEvents>(
        event: K,
        handler: (data: UIEditorHistoryEvents[K]) => void,
    ): () => void {
        return this.events.on(event, handler);
    }

    public override dispose(_ctx: WorkspaceContext): void {
        this.histories.clear();
        this.events.clear();
    }

    private restore(surfaceId: string, snapshot: UIEditorHistorySnapshot): void {
        const uidoc = this.getContext().services.get<UIDocumentService>(Services.UIDocument);
        const graph = this.getContext().services.get<UIGraphService>(Services.UIGraph);
        const lifecycle = this.getContext().services.get<UIBlueprintLifecycleCoordinator>(Services.UIBlueprintLifecycle);

        this.isRestoring = true;
        try {
            uidoc.restoreDocumentFromHistory(
                applyUIDocumentSurfaceSnapshot(uidoc.getDocument(), snapshot.document, surfaceId),
                { skipAfterMutateHook: true },
            );
            graph.applyGraphMutation(document => {
                applyBlueprintSurfaceSnapshot(document.blueprintDocument, surfaceId, snapshot.blueprint);
                assertValidBlueprintDocument(document.blueprintDocument);
            });
            lifecycle.syncFromUidoc();
        } finally {
            this.isRestoring = false;
        }
    }

    private ensureHistory(surfaceId: string): UIEditorSurfaceHistory {
        let history = this.histories.get(surfaceId);
        if (!history) {
            history = { undo: [], redo: [] };
            this.histories.set(surfaceId, history);
        }
        return history;
    }

    private trim(history: UIEditorSurfaceHistory): void {
        if (history.undo.length <= this.limit) {
            return;
        }
        history.undo.splice(0, history.undo.length - this.limit);
    }
}
