import type {
  Blueprint,
  BlueprintDocument,
  BlueprintPrivateOwnerRecord
} from "@shared/types/blueprint/document";
import type { TranslationKey } from "@shared/i18n";
import type { UIDocument, UIElement, UISurface } from "@shared/types/ui-editor/document";
import { collectSubtreeElementIds } from "./uiDocumentTreeMove";
import { resolveSurfaceRootElementId } from "@/lib/ui-editor/runtime/resolveSurfaceRoot";
import { EventEmitter } from "../ui/EventEmitter";
import { HistoryService } from "../history/HistoryService";
import { DEFAULT_HISTORY_LIMIT, DEFAULT_MERGE_WINDOW_MS } from "../history/historyModel";
import {
  HistoryScopeKind,
  historyScopeParts,
  isHistoryScopeOf,
  uiSurfaceHistoryScope
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

export type UIEditorUIDocumentSurfaceSnapshot = Pick<
  UIDocument,
  "schemaVersion" | "id" | "name" | "meta"
> & {
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

export function cloneUIHistoryDocument(document: UIDocument): UIDocument {
  return JSON.parse(JSON.stringify(document)) as UIDocument;
}

function cloneBlueprint<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isSurfaceBlueprintOwnerKey(surfaceId: string, ownerKey: string): boolean {
  return (
    ownerKey === `surfaceMain:${surfaceId}` ||
    ownerKey.startsWith(`widgetMain:${surfaceId}:`) ||
    ownerKey.startsWith(`widgetValue:${surfaceId}:`)
  );
}

export function captureBlueprintSurfaceSnapshot(
  blueprintDocument: BlueprintDocument,
  surfaceId: string
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
  target: UIEditorBlueprintSurfaceSnapshot
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
  return (
    JSON.stringify(a.document) === JSON.stringify(b.document) &&
    JSON.stringify(a.blueprint) === JSON.stringify(b.blueprint)
  );
}

export function captureUIDocumentSurfaceSnapshot(
  document: UIDocument,
  surfaceId: string
): UIEditorUIDocumentSurfaceSnapshot {
  const surface = document.surfaces.find((next) => next.id === surfaceId);
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
    meta: document.meta ? cloneBlueprint(document.meta) : undefined
  };
}

export function applyUIDocumentSurfaceSnapshot(
  currentDocument: UIDocument,
  targetDocument: UIDocument | UIEditorUIDocumentSurfaceSnapshot,
  surfaceId: string
): UIDocument {
  const next = cloneUIHistoryDocument(currentDocument);
  const currentRootId = resolveSurfaceRootElementId(next, surfaceId);
  if (currentRootId) {
    const currentIds = collectSubtreeElementIds(next, currentRootId);
    for (const elementId of currentIds) {
      delete next.elements[elementId];
    }
  }

  const targetSurface = targetDocument.surfaces.find((surface) => surface.id === surfaceId);
  const currentSurfaceIndex = next.surfaces.findIndex((surface) => surface.id === surfaceId);
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

/**
 * Surface-level undo for the UI editor.
 *
 * What is left here after the stacks moved to {@link HistoryService} is the part that is actually
 * about UI surfaces: which slice of the two documents belongs to a surface, and how to put that
 * slice back without disturbing the others. The stack itself - depth, merging, redo invalidation,
 * "is a restore in progress" - is shared with every other editor now, so a change to how undo
 * behaves is one change rather than five.
 *
 * The public shape is unchanged on purpose; callers speak in surface ids and should not have to
 * learn scope ids to ask whether Ctrl+Z will do something.
 */
export class UIEditorHistoryService
  extends Service<UIEditorHistoryService>
  implements IUIEditorHistoryService
{
  /** Surfaces this service has registered a scope for, so it can re-limit and clear them. */
  private readonly registered = new Map<string, () => void>();
  private readonly events = new EventEmitter<UIEditorHistoryEvents>();
  private limit = DEFAULT_HISTORY_LIMIT;
  private unsubscribe: (() => void) | null = null;

  protected init(_ctx: WorkspaceContext): void {
    this.unsubscribe?.();
    // One bridge from the shared "some stack changed" event to this service's surface-shaped
    // one, so the editor's existing subscribers keep working.
    this.unsubscribe = this.history().on("changed", ({ scopeId }) => {
      if (!isHistoryScopeOf(scopeId, HistoryScopeKind.UISurface)) {
        return;
      }
      const [surfaceId] = historyScopeParts(scopeId);
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
      this.history().setScopeLimit(uiSurfaceHistoryScope(surfaceId), next);
    }
  }

  public captureSnapshot(surfaceId: string): UIEditorHistorySnapshot {
    const uidoc = this.getContext().services.get<UIDocumentService>(Services.UIDocument);
    const graph = this.getContext().services.get<UIGraphService>(Services.UIGraph);
    return {
      document: captureUIDocumentSurfaceSnapshot(uidoc.getDocument(), surfaceId),
      blueprint: captureBlueprintSurfaceSnapshot(graph.getDocument().blueprintDocument, surfaceId)
    };
  }

  public record(options: UIEditorHistoryRecordOptions): void {
    this.ensureScope(options.surfaceId);
    this.history().pushSnapshot<UIEditorHistorySnapshot>(uiSurfaceHistoryScope(options.surfaceId), {
      label: { key: "workspace.history.entry.surfaceEdit" as TranslationKey },
      before: options.before,
      after: options.after,
      mergeKey: options.mergeKey,
      mergeWindowMs: options.mergeWindowMs ?? DEFAULT_MERGE_WINDOW_MS,
      equals: areSnapshotsEqual
    });
  }

  public canUndo(surfaceId: string): boolean {
    return this.history().canUndo(uiSurfaceHistoryScope(surfaceId));
  }

  public canRedo(surfaceId: string): boolean {
    return this.history().canRedo(uiSurfaceHistoryScope(surfaceId));
  }

  public undo(surfaceId: string): boolean {
    this.ensureScope(surfaceId);
    return this.history().undo(uiSurfaceHistoryScope(surfaceId));
  }

  public redo(surfaceId: string): boolean {
    this.ensureScope(surfaceId);
    return this.history().redo(uiSurfaceHistoryScope(surfaceId));
  }

  public clear(surfaceId?: string): void {
    if (surfaceId) {
      this.history().clearScope(uiSurfaceHistoryScope(surfaceId));
      return;
    }
    this.history().clearMatching((scopeId) =>
      isHistoryScopeOf(scopeId, HistoryScopeKind.UISurface)
    );
    for (const dispose of this.registered.values()) {
      dispose();
    }
    this.registered.clear();
  }

  public on<K extends keyof UIEditorHistoryEvents>(
    event: K,
    handler: (data: UIEditorHistoryEvents[K]) => void
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
   * documents a surface snapshot slices are service-owned and readable whether or not anything is
   * showing them, so there is no window in which an entry recorded here cannot be applied.
   */
  private ensureScope(surfaceId: string): void {
    if (this.registered.has(surfaceId)) {
      return;
    }
    const dispose = this.history().registerScope<UIEditorHistorySnapshot>({
      id: uiSurfaceHistoryScope(surfaceId),
      label: { key: "workspace.history.scope.uiSurface" as TranslationKey },
      capture: () => this.captureSnapshot(surfaceId),
      apply: (snapshot) => this.restore(surfaceId, snapshot),
      limit: this.limit
    });
    this.registered.set(surfaceId, dispose);
  }

  private restore(surfaceId: string, snapshot: UIEditorHistorySnapshot): void {
    const uidoc = this.getContext().services.get<UIDocumentService>(Services.UIDocument);
    const graph = this.getContext().services.get<UIGraphService>(Services.UIGraph);
    const lifecycle = this.getContext().services.get<UIBlueprintLifecycleCoordinator>(
      Services.UIBlueprintLifecycle
    );

    uidoc.restoreDocumentFromHistory(
      applyUIDocumentSurfaceSnapshot(uidoc.getDocument(), snapshot.document, surfaceId),
      { skipAfterMutateHook: true }
    );
    graph.applyGraphMutation((document) => {
      applyBlueprintSurfaceSnapshot(document.blueprintDocument, surfaceId, snapshot.blueprint);
      assertValidBlueprintDocument(document.blueprintDocument);
    });
    lifecycle.syncFromUidoc();
  }
}
