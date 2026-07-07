import type {
    BindingDefinition,
    Blueprint,
    BlueprintDocument,
    BlueprintField,
    BlueprintFieldValueSource,
    BlueprintFrontendKind,
    BlueprintGraphNode,
    BlueprintPersistentVariable,
    BlueprintPrivateOwnerRecord,
    BlueprintVariable,
    LiteralValue,
} from "@shared/types/blueprint/document";
import {
    BLUEPRINT_GRAPH_IR_META_KIND,
    BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_CALL,
    BLUEPRINT_NODE_TYPE_LITERAL_FLOAT,
    BLUEPRINT_NODE_TYPE_LITERAL_JSON,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LOCAL_GET,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
    BLUEPRINT_NODE_PARAM_VARIABLE_VALUE_TYPE,
    BLUEPRINT_NODE_TYPE_PERSISTENT_GET,
    BLUEPRINT_NODE_TYPE_PERSISTENT_SET,
} from "@shared/types/blueprint/graph";
import type { UIDocument, UIElement, UIElementValueBindingValueType } from "@shared/types/ui-editor/document";
import type { UIGraphDocument } from "@shared/types/ui-editor/graph";
import { RendererError } from "@shared/utils/error";
import { EventEmitter } from "../ui/EventEmitter";
import { Service } from "../Service";
import { Services, ILocalBlueprintService, WorkspaceContext } from "../services";
import { FileSystemService } from "../core/FileSystem";
import { ProjectService } from "../core/ProjectService";
import { UuidService } from "../core/UuidService";
import { UIGraphService } from "./UIGraphService";
import { UIDocumentService } from "./UIDocumentService";
import {
    createMainBlueprint,
    createTypeScriptMainBlueprint,
    emptyMemberIndex,
} from "./blueprint/blueprintFactories";
import { assertValidBlueprintDocument } from "./blueprint/documentValidation";
import type { BlueprintEventGraph, BlueprintFunctionGraph, BlueprintGraphIr } from "@shared/types/blueprint/document";
import {
    ensureBlueprintEventGraphIrStructure,
    ensureBlueprintFunctionGraphIrStructure,
    ensureBlueprintGraphIr,
} from "./blueprint/graphEditing";
import { planSubtreeDuplicateBlueprintRemap, type SubtreeDuplicateRemapPlan } from "./blueprint/blueprintCopyRemap";
import {
    buildReadonlyWidgetMainSummary,
    type ReadonlyBlueprintWidgetSummary,
} from "./blueprint/readonlyBlueprintSummary";
import {
    componentWidgetMainOwnerKey,
    ownerRefToIndexKey,
    storyActionOwnerKey,
    surfaceMainOwnerKey,
    widgetMainOwnerKey,
    widgetValueOwnerKey,
} from "./blueprint/ownerKeys";
import {
    buildReadonlySurfaceMainSummary,
    type ReadonlyBlueprintSurfaceSummary,
} from "./blueprint/readonlyBlueprintSummary";
import {
    getActiveBlueprintId,
    parsePrivateOwnerKeyToRef,
    registerPrivateBlueprintAsActive,
    setPrivateOwnerActive,
} from "./blueprint/ownerRecords";

const DEFAULT_BLUEPRINT_HISTORY_LIMIT = 100;
const DEFAULT_BLUEPRINT_MERGE_WINDOW_MS = 800;

export type BlueprintHistoryRecordOptions = {
    mergeKey?: string;
    mergeWindowMs?: number;
};

type BlueprintHistoryScope = {
    blueprintId: string;
    ownerKey?: string;
};

type UIBehaviorSnapshot = {
    elements: Record<string, UIElement["behavior"] | undefined>;
};

export type BlueprintEditorHistorySnapshot = {
    blueprintId: string;
    ownerKey: string | null;
    ownerRecord: BlueprintPrivateOwnerRecord | null;
    blueprint: Blueprint | null;
    uiBehavior: UIBehaviorSnapshot;
};

type BlueprintHistoryEntry = {
    blueprintId: string;
    ownerKey: string | null;
    before: BlueprintEditorHistorySnapshot;
    after: BlueprintEditorHistorySnapshot;
    mergeKey?: string;
    createdAt: number;
    updatedAt: number;
};

type BlueprintHistoryStack = {
    undo: BlueprintHistoryEntry[];
    redo: BlueprintHistoryEntry[];
};

type LocalBlueprintHistoryEvents = {
    blueprintHistoryChanged: { blueprintId: string; ownerKey: string | null };
};

function cloneBlueprintHistoryValue<T>(value: T): T {
    return value == null ? value : JSON.parse(JSON.stringify(value)) as T;
}

function captureUIBehaviorSnapshot(document: UIDocument): UIBehaviorSnapshot {
    const elements: UIBehaviorSnapshot["elements"] = {};
    for (const [elementId, element] of Object.entries(document.elements)) {
        elements[elementId] = cloneBlueprintHistoryValue(element.behavior);
    }
    return { elements };
}

function applyUIBehaviorSnapshot(current: UIDocument, target: UIBehaviorSnapshot): UIDocument {
    const next = cloneBlueprintHistoryValue(current);
    for (const [elementId, behavior] of Object.entries(target.elements)) {
        const element = next.elements[elementId];
        if (!element) {
            continue;
        }
        if (behavior === undefined) {
            delete element.behavior;
        } else {
            element.behavior = cloneBlueprintHistoryValue(behavior);
        }
    }
    return next;
}

function areBlueprintHistorySnapshotsEqual(
    a: BlueprintEditorHistorySnapshot,
    b: BlueprintEditorHistorySnapshot,
): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

function areUIBehaviorSnapshotsEqual(a: UIBehaviorSnapshot, b: UIBehaviorSnapshot): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

function createValueGraphIr(input: {
    headNodeType: string;
    valueType: UIElementValueBindingValueType;
    literalValue: unknown;
    generateId: () => string;
}): BlueprintGraphIr {
    const headId = input.generateId();
    const literalId = input.generateId();
    const returnId = input.generateId();
    const head: BlueprintGraphNode = {
        id: headId,
        type: input.headNodeType,
        params: {},
        meta: { editorLayout: { x: 80, y: 120 } },
    };
    const literalType =
        input.valueType === "json"
            ? BLUEPRINT_NODE_TYPE_LITERAL_JSON
            : input.valueType === "float"
              ? BLUEPRINT_NODE_TYPE_LITERAL_FLOAT
              : BLUEPRINT_NODE_TYPE_LITERAL_STRING;
    const literal: BlueprintGraphNode = {
        id: literalId,
        type: literalType,
        params: { value: normalizeBlueprintValueLiteral(input.literalValue, input.valueType) },
        meta: { editorLayout: { x: 300, y: 40 } },
    };
    const returnNode: BlueprintGraphNode = {
        id: returnId,
        type: BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE,
        params: {},
        meta: { editorLayout: { x: 540, y: 120 } },
    };
    return {
        nodes: {
            [headId]: head,
            [literalId]: literal,
            [returnId]: returnNode,
        },
        edges: [
            {
                from: { nodeId: headId, port: "then" },
                to: { nodeId: returnId, port: "in" },
            },
            {
                from: { nodeId: literalId, port: "value" },
                to: { nodeId: returnId, port: "value" },
            },
        ],
        meta: { [BLUEPRINT_GRAPH_IR_META_KIND]: "event" },
    };
}

function normalizeBlueprintValueLiteral(value: unknown, valueType: UIElementValueBindingValueType): unknown {
    if (valueType === "string") {
        return value == null ? "" : String(value);
    }
    if (valueType === "float") {
        const n = typeof value === "number" ? value : Number(value);
        return Number.isFinite(n) ? n : 0;
    }
    if (value === undefined) {
        return {};
    }
    try {
        return JSON.parse(JSON.stringify(value)) as unknown;
    } catch {
        return {};
    }
}

/**
 * Blueprint M2: mutations to local instance BlueprintDocument inside uigraphs.json.
 */
export class LocalBlueprintService extends Service<LocalBlueprintService> implements ILocalBlueprintService {
    private readonly histories = new Map<string, BlueprintHistoryStack>();
    private readonly events = new EventEmitter<LocalBlueprintHistoryEvents>();
    private historySuppressionDepth = 0;
    private isRestoringHistory = false;
    private historyLimit = DEFAULT_BLUEPRINT_HISTORY_LIMIT;

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const fs = ctx.services.get<FileSystemService>(Services.FileSystem);
        const project = ctx.services.get<ProjectService>(Services.Project);
        const uuid = ctx.services.get<UuidService>(Services.Uuid);
        const graph = ctx.services.get<UIGraphService>(Services.UIGraph);
        await depend([fs, project, uuid, graph]);
    }

    public getBlueprintDocument(): BlueprintDocument {
        return this.getContext().services.get<UIGraphService>(Services.UIGraph).getDocument().blueprintDocument;
    }

    public applyBlueprintMutation(mutator: (bp: BlueprintDocument, doc: UIGraphDocument) => void): void {
        const graph = this.getContext().services.get<UIGraphService>(Services.UIGraph);
        graph.applyGraphMutation(doc => {
            mutator(doc.blueprintDocument, doc);
            assertValidBlueprintDocument(doc.blueprintDocument);
        });
    }

    public getBlueprintHistoryLimit(): number {
        return this.historyLimit;
    }

    public setBlueprintHistoryLimit(limit: number): void {
        const next = Math.max(1, Math.floor(limit));
        if (!Number.isFinite(next) || next === this.historyLimit) {
            return;
        }
        this.historyLimit = next;
        for (const [blueprintId, history] of this.histories) {
            this.trimBlueprintHistory(history);
            const ownerKey = this.resolveBlueprintOwnerKey({ blueprintId });
            this.events.emit("blueprintHistoryChanged", { blueprintId, ownerKey });
        }
    }

    public captureBlueprintHistorySnapshot(
        blueprintId: string,
        ownerKey?: string,
    ): BlueprintEditorHistorySnapshot {
        const bpDoc = this.getBlueprintDocument();
        const blueprint = bpDoc.blueprints[blueprintId] ?? null;
        const resolvedOwnerKey = ownerKey ?? this.resolveBlueprintOwnerKey({ blueprintId });
        const ownerRecord = resolvedOwnerKey ? bpDoc.ownerRecords[resolvedOwnerKey] ?? null : null;
        const uidoc = this.getContext().services.get<UIDocumentService>(Services.UIDocument);
        return {
            blueprintId,
            ownerKey: resolvedOwnerKey,
            ownerRecord: cloneBlueprintHistoryValue(ownerRecord),
            blueprint: cloneBlueprintHistoryValue(blueprint),
            uiBehavior: captureUIBehaviorSnapshot(uidoc.getDocument()),
        };
    }

    public runBlueprintHistoryTransaction<T>(
        blueprintId: string,
        action: () => T,
        options: BlueprintHistoryRecordOptions & { ownerKey?: string } = {},
    ): T {
        const before = this.captureBlueprintHistorySnapshot(blueprintId, options.ownerKey);
        this.historySuppressionDepth += 1;
        let result: T;
        try {
            result = action();
        } finally {
            this.historySuppressionDepth -= 1;
        }
        this.recordBlueprintHistory({
            blueprintId,
            ownerKey: options.ownerKey ?? before.ownerKey ?? undefined,
            before,
            after: this.captureBlueprintHistorySnapshot(blueprintId, options.ownerKey ?? before.ownerKey ?? undefined),
            mergeKey: options.mergeKey,
            mergeWindowMs: options.mergeWindowMs,
        });
        return result;
    }

    public canUndoBlueprint(blueprintId: string): boolean {
        return (this.histories.get(blueprintId)?.undo.length ?? 0) > 0;
    }

    public canRedoBlueprint(blueprintId: string): boolean {
        return (this.histories.get(blueprintId)?.redo.length ?? 0) > 0;
    }

    public undoBlueprint(blueprintId: string): boolean {
        const history = this.histories.get(blueprintId);
        const entry = history?.undo.pop();
        if (!entry || !history) {
            return false;
        }
        this.restoreBlueprintHistorySnapshot(entry.before);
        history.redo.push(entry);
        this.events.emit("blueprintHistoryChanged", { blueprintId, ownerKey: entry.ownerKey });
        return true;
    }

    public redoBlueprint(blueprintId: string): boolean {
        const history = this.histories.get(blueprintId);
        const entry = history?.redo.pop();
        if (!entry || !history) {
            return false;
        }
        this.restoreBlueprintHistorySnapshot(entry.after);
        history.undo.push(entry);
        this.events.emit("blueprintHistoryChanged", { blueprintId, ownerKey: entry.ownerKey });
        return true;
    }

    public clearBlueprintHistory(blueprintId?: string): void {
        if (blueprintId) {
            const ownerKey = this.resolveBlueprintOwnerKey({ blueprintId });
            this.histories.delete(blueprintId);
            this.events.emit("blueprintHistoryChanged", { blueprintId, ownerKey });
            return;
        }
        const ids = [...this.histories.keys()];
        this.histories.clear();
        ids.forEach(id => {
            const ownerKey = this.resolveBlueprintOwnerKey({ blueprintId: id });
            this.events.emit("blueprintHistoryChanged", { blueprintId: id, ownerKey });
        });
    }

    public onBlueprintHistoryChanged(
        handler: (event: { blueprintId: string; ownerKey: string | null }) => void,
    ): () => void {
        return this.events.on("blueprintHistoryChanged", handler);
    }

    public ensureSurfaceMain(surfaceId: string, displayName?: string): string {
        const uuid = this.getContext().services.get<UuidService>(Services.Uuid);
        const key = surfaceMainOwnerKey(surfaceId);
        let outId = "";
        this.applyBlueprintMutation(doc => {
            const active = getActiveBlueprintId(doc, key);
            if (active && doc.blueprints[active]) {
                outId = active;
                if (displayName !== undefined) {
                    doc.blueprints[active].name = displayName;
                }
                return;
            }
            const id = uuid.generate();
            const blueprint = createMainBlueprint({
                id,
                name: displayName ?? "Surface",
                owner: { kind: "surfaceMain", surfaceId },
            });
            doc.blueprints[id] = blueprint;
            registerPrivateBlueprintAsActive(doc, key, id, "visual");
            outId = id;
        });
        return outId;
    }

    public removeSurfaceAndWidgetOwners(surfaceId: string): void {
        const prefixWidget = `widgetMain:${surfaceId}:`;
        const prefixWidgetValue = `widgetValue:${surfaceId}:`;
        const surfaceKey = surfaceMainOwnerKey(surfaceId);
        this.applyBlueprintMutation(doc => {
            const toRemoveBlueprintIds = new Set<string>();
            for (const [k, rec] of Object.entries(doc.ownerRecords)) {
                if (k === surfaceKey || k.startsWith(prefixWidget) || k.startsWith(prefixWidgetValue)) {
                    for (const bid of rec.privateBlueprintIds) {
                        toRemoveBlueprintIds.add(bid);
                    }
                    delete doc.ownerRecords[k];
                }
            }
            for (const id of toRemoveBlueprintIds) {
                delete doc.blueprints[id];
            }
            this.stripBindingsForSurface(doc, surfaceId);
        });
    }

    public ensureWidgetMain(surfaceId: string, elementId: string, displayName?: string, widgetType?: string): string {
        const uuid = this.getContext().services.get<UuidService>(Services.Uuid);
        const key = widgetMainOwnerKey(surfaceId, elementId);
        let outId = "";
        this.applyBlueprintMutation(doc => {
            const active = getActiveBlueprintId(doc, key);
            if (active && doc.blueprints[active]) {
                outId = active;
                if (displayName !== undefined) {
                    doc.blueprints[active].name = displayName ?? doc.blueprints[active].name;
                }
                return;
            }
            const id = uuid.generate();
            const blueprint = createMainBlueprint({
                id,
                name: displayName ?? "Widget",
                owner: { kind: "widgetMain", surfaceId, elementId },
            });
            doc.blueprints[id] = blueprint;
            registerPrivateBlueprintAsActive(doc, key, id, "visual");
            outId = id;
        });
        return outId;
    }

    public removeWidgetMain(surfaceId: string, elementId: string): void {
        const key = widgetMainOwnerKey(surfaceId, elementId);
        this.applyBlueprintMutation(doc => {
            const rec = doc.ownerRecords[key];
            if (rec) {
                for (const bid of rec.privateBlueprintIds) {
                    delete doc.blueprints[bid];
                }
                delete doc.ownerRecords[key];
            }
            this.stripBindingsForElement(doc, surfaceId, elementId);
        });
    }

    public getWidgetMainBlueprintId(surfaceId: string, elementId: string): string | undefined {
        const key = widgetMainOwnerKey(surfaceId, elementId);
        return getActiveBlueprintId(this.getBlueprintDocument(), key);
    }

    public ensureComponentWidgetMain(
        componentId: string,
        elementId: string,
        displayName?: string,
        widgetType?: string,
    ): string {
        const uuid = this.getContext().services.get<UuidService>(Services.Uuid);
        const key = componentWidgetMainOwnerKey(componentId, elementId);
        let outId = "";
        this.applyBlueprintMutation(doc => {
            const active = getActiveBlueprintId(doc, key);
            if (active && doc.blueprints[active]) {
                outId = active;
                if (displayName !== undefined) {
                    doc.blueprints[active].name = displayName || doc.blueprints[active].name;
                }
                return;
            }
            const id = uuid.generate();
            const blueprint = createMainBlueprint({
                id,
                name: displayName ?? "Component Widget",
                owner: { kind: "componentWidgetMain", componentId, elementId },
            });
            doc.blueprints[id] = blueprint;
            registerPrivateBlueprintAsActive(doc, key, id, "visual");
            outId = id;
        });
        return outId;
    }

    public removeComponentWidgetMain(componentId: string, elementId: string): void {
        const key = componentWidgetMainOwnerKey(componentId, elementId);
        this.applyBlueprintMutation(doc => {
            const rec = doc.ownerRecords[key];
            if (!rec) {
                return;
            }
            for (const bid of rec.privateBlueprintIds) {
                delete doc.blueprints[bid];
            }
            delete doc.ownerRecords[key];
        });
    }

    public getComponentWidgetMainBlueprintId(componentId: string, elementId: string): string | undefined {
        const key = componentWidgetMainOwnerKey(componentId, elementId);
        return getActiveBlueprintId(this.getBlueprintDocument(), key);
    }

    public ensureWidgetValueBlueprint(input: {
        surfaceId: string;
        elementId: string;
        propPath: string;
        valueType: UIElementValueBindingValueType;
        displayName?: string;
        literalValue?: unknown;
    }): string {
        const uuid = this.getContext().services.get<UuidService>(Services.Uuid);
        const { surfaceId, elementId, propPath } = input;
        const key = widgetValueOwnerKey(surfaceId, elementId, propPath);
        let outId = "";
        this.applyBlueprintMutation(doc => {
            const active = getActiveBlueprintId(doc, key);
            if (active && doc.blueprints[active]) {
                outId = active;
                if (input.displayName !== undefined) {
                    doc.blueprints[active].name = input.displayName || doc.blueprints[active].name;
                }
                return;
            }
            const id = uuid.generate();
            const blueprint = createMainBlueprint({
                id,
                name: input.displayName ?? "Value",
                owner: { kind: "widgetValue", surfaceId, elementId, propPath },
            });
            blueprint.meta = { ...(blueprint.meta ?? {}), valueType: input.valueType };
            if (blueprint.program.kind === "graph") {
                blueprint.program.graphs.events = {
                    init: {
                        id: "init",
                        name: "Init",
                        graph: createValueGraphIr({
                            headNodeType: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
                            valueType: input.valueType,
                            literalValue: input.literalValue,
                            generateId: () => uuid.generate(),
                        }),
                    },
                };
            }
            doc.blueprints[id] = blueprint;
            registerPrivateBlueprintAsActive(doc, key, id, "visual");
            outId = id;
        });
        return outId;
    }

    public removeWidgetValueBlueprint(surfaceId: string, elementId: string, propPath: string): void {
        const key = widgetValueOwnerKey(surfaceId, elementId, propPath);
        this.applyBlueprintMutation(doc => {
            const rec = doc.ownerRecords[key];
            if (!rec) {
                return;
            }
            for (const bid of rec.privateBlueprintIds) {
                delete doc.blueprints[bid];
            }
            delete doc.ownerRecords[key];
        });
    }

    public getWidgetValueBlueprintId(surfaceId: string, elementId: string, propPath: string): string | undefined {
        const key = widgetValueOwnerKey(surfaceId, elementId, propPath);
        return getActiveBlueprintId(this.getBlueprintDocument(), key);
    }

    /**
     * Ensure the implicit Story Action Blueprint exists for a story action. Self-referential owner:
     * the owner key equals the blueprint id. Seeds a single "On Call" event graph. Returns the id.
     */
    public ensureStoryActionBlueprint(input?: { blueprintId?: string; displayName?: string; mode?: "action" | "value" }): string {
        const uuid = this.getContext().services.get<UuidService>(Services.Uuid);
        const id = input?.blueprintId || uuid.generate();
        const key = storyActionOwnerKey(id);
        let outId = id;
        this.applyBlueprintMutation(doc => {
            const active = getActiveBlueprintId(doc, key);
            if (active && doc.blueprints[active]) {
                outId = active;
                return;
            }
            const blueprint = createMainBlueprint({
                id,
                name: input?.displayName ?? (input?.mode === "value" ? "Story Value" : "Story Action"),
                owner: { kind: "storyAction", blueprintId: id, ...(input?.mode ? { mode: input.mode } : {}) },
            });
            if (blueprint.program.kind === "graph") {
                // Value mode (inline interpolation) opens ready to return a value: On Call → Return Value
                // ← "" string literal. Action mode (a story action block) runs for side effects, so it
                // only needs the On Call head.
                const graph = input?.mode === "value"
                    ? createValueGraphIr({
                          headNodeType: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_CALL,
                          valueType: "string",
                          literalValue: "",
                          generateId: () => uuid.generate(),
                      })
                    : (() => {
                          const headId = uuid.generate();
                          return {
                              nodes: { [headId]: { id: headId, type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_CALL, params: {} } },
                              edges: [],
                              meta: { [BLUEPRINT_GRAPH_IR_META_KIND]: "event" },
                          };
                      })();
                blueprint.program.graphs.events = {
                    onCall: { id: "onCall", name: "On Call", graph },
                };
            }
            doc.blueprints[id] = blueprint;
            registerPrivateBlueprintAsActive(doc, key, id, "visual");
            outId = id;
        });
        return outId;
    }

    public removeStoryActionBlueprint(blueprintId: string): void {
        const key = storyActionOwnerKey(blueprintId);
        this.applyBlueprintMutation(doc => {
            const rec = doc.ownerRecords[key];
            if (!rec) {
                return;
            }
            for (const bid of rec.privateBlueprintIds) {
                delete doc.blueprints[bid];
            }
            delete doc.ownerRecords[key];
        });
    }

    public getStoryActionBlueprintId(blueprintId: string): string | undefined {
        return getActiveBlueprintId(this.getBlueprintDocument(), storyActionOwnerKey(blueprintId));
    }

    /** All project-level persistent variable definitions (shared with the Story editor). */
    public listPersistentVariables(): BlueprintDocument["persistentVariables"][string][] {
        return Object.values(this.getBlueprintDocument().persistentVariables ?? {});
    }

    public getSurfaceMainBlueprintId(surfaceId: string): string | undefined {
        const key = surfaceMainOwnerKey(surfaceId);
        return getActiveBlueprintId(this.getBlueprintDocument(), key);
    }

    public listPrivateBlueprintIdsForOwnerKey(ownerKey: string): string[] {
        const rec = this.getBlueprintDocument().ownerRecords[ownerKey];
        return rec ? [...rec.privateBlueprintIds] : [];
    }

    public setActivePrivateBlueprintForOwnerKey(ownerKey: string, blueprintId: string): void {
        this.applyBlueprintEdit({ blueprintId, ownerKey }, doc => {
            setPrivateOwnerActive(doc, ownerKey, blueprintId);
        });
    }

    public createSiblingPrivateBlueprintForOwnerKey(ownerKey: string, frontend: BlueprintFrontendKind): string {
        const ownerRef = parsePrivateOwnerKeyToRef(ownerKey);
        if (!ownerRef) {
            throw new RendererError(`Invalid private owner key: ${ownerKey}`);
        }
        if (ownerRef.kind === "widgetValue" && frontend === "typescript") {
            throw new RendererError("Blueprint Value only supports visual blueprints");
        }
        const uuid = this.getContext().services.get<UuidService>(Services.Uuid);
        const id = uuid.generate();
        const name =
            frontend === "typescript"
                ? `Script ${id.slice(0, 6)}`
                : `Blueprint ${id.slice(0, 6)}`;
        this.applyBlueprintEdit({ blueprintId: id, ownerKey }, doc => {
            const blueprint =
                frontend === "typescript"
                    ? createTypeScriptMainBlueprint({ id, name, owner: ownerRef })
                    : createMainBlueprint({ id, name, owner: ownerRef });
            doc.blueprints[id] = blueprint;
            registerPrivateBlueprintAsActive(doc, ownerKey, id, frontend);
        });
        return id;
    }

    public getReadonlySurfaceMainSummary(surfaceId: string): ReadonlyBlueprintSurfaceSummary {
        return buildReadonlySurfaceMainSummary(this.getBlueprintDocument(), surfaceId);
    }

    public setFieldValueSource(
        blueprintId: string,
        fieldId: string,
        valueSource: BlueprintFieldValueSource | undefined,
    ): void {
        this.applyBlueprintEdit({ blueprintId }, doc => {
            const bp = doc.blueprints[blueprintId];
            const field = bp?.members?.fields?.[fieldId];
            if (!field) {
                return;
            }
            field.valueSource = valueSource;
        }, { mergeKey: `field-source:${blueprintId}:${fieldId}` });
    }

    public createField(
        blueprintId: string,
        input: { name: string; kind?: BlueprintField["kind"]; valueSource?: BlueprintFieldValueSource },
    ): BlueprintField {
        const uuid = this.getContext().services.get<UuidService>(Services.Uuid);
        const field: BlueprintField = {
            id: uuid.generate(),
            name: input.name,
            kind: input.kind ?? "constant",
            valueSource: input.valueSource,
        };
        this.applyBlueprintEdit({ blueprintId }, doc => {
            const bp = doc.blueprints[blueprintId];
            if (!bp) {
                throw new RendererError(`Blueprint not found: ${blueprintId}`);
            }
            bp.members = bp.members ?? emptyMemberIndex();
            bp.members.fields[field.id] = field;
        });
        return field;
    }

    public renameField(blueprintId: string, fieldId: string, name: string): void {
        this.applyBlueprintEdit({ blueprintId }, doc => {
            const bp = doc.blueprints[blueprintId];
            const f = bp?.members?.fields?.[fieldId];
            if (!f) {
                return;
            }
            f.name = name;
        }, { mergeKey: `field-name:${blueprintId}:${fieldId}` });
    }

    public deleteField(blueprintId: string, fieldId: string): void {
        this.applyBlueprintEdit({ blueprintId }, doc => {
            const bp = doc.blueprints[blueprintId];
            if (!bp?.members?.fields?.[fieldId]) {
                return;
            }
            delete bp.members.fields[fieldId];
            for (const bind of Object.values(bp.bindings ?? {})) {
                if (
                    bind.source.kind === "field" &&
                    bind.source.blueprintId === blueprintId &&
                    bind.source.fieldId === fieldId
                ) {
                    bind.status = "broken";
                    bind.brokenReason = "field_removed";
                }
            }
        });
    }

    public setWidgetPropBinding(params: {
        blueprintId: string;
        surfaceId: string;
        elementId: string;
        propPath: string;
        fieldId: string;
        fallback?: BindingDefinition["fallback"];
    }): string {
        const uuid = this.getContext().services.get<UuidService>(Services.Uuid);
        let resolvedBindingId = "";
        this.applyBlueprintEdit({ blueprintId: params.blueprintId }, doc => {
            const bp = doc.blueprints[params.blueprintId];
            if (!bp) {
                throw new RendererError(`Blueprint not found: ${params.blueprintId}`);
            }
            bp.bindings = bp.bindings ?? {};
            const existing = Object.entries(bp.bindings).find(
                ([, b]) =>
                    b.target.kind === "widgetProp" &&
                    b.target.surfaceId === params.surfaceId &&
                    b.target.elementId === params.elementId &&
                    b.target.propPath === params.propPath,
            );
            if (existing) {
                const [eid] = existing;
                bp.bindings[eid] = {
                    ...bp.bindings[eid],
                    source: {
                        kind: "field",
                        blueprintId: params.blueprintId,
                        fieldId: params.fieldId,
                    },
                    fallback: params.fallback,
                    status: "active",
                    brokenReason: undefined,
                };
                resolvedBindingId = eid;
                return;
            }
            const bindingId = uuid.generate();
            bp.bindings[bindingId] = {
                id: bindingId,
                target: {
                    kind: "widgetProp",
                    surfaceId: params.surfaceId,
                    elementId: params.elementId,
                    propPath: params.propPath,
                },
                source: {
                    kind: "field",
                    blueprintId: params.blueprintId,
                    fieldId: params.fieldId,
                },
                mode: "replace",
                fallback: params.fallback,
                status: "active",
            };
            resolvedBindingId = bindingId;
        });
        return resolvedBindingId;
    }

    public clearWidgetPropBinding(blueprintId: string, surfaceId: string, elementId: string, propPath: string): void {
        this.applyBlueprintEdit({ blueprintId }, doc => {
            const bp = doc.blueprints[blueprintId];
            if (!bp?.bindings) {
                return;
            }
            for (const [bid, b] of Object.entries(bp.bindings)) {
                if (
                    b.target.kind === "widgetProp" &&
                    b.target.surfaceId === surfaceId &&
                    b.target.elementId === elementId &&
                    b.target.propPath === propPath
                ) {
                    delete bp.bindings[bid];
                }
            }
        });
    }

    public findWidgetPropBinding(
        blueprintId: string,
        surfaceId: string,
        elementId: string,
        propPath: string,
    ): BindingDefinition | undefined {
        const bp = this.getBlueprintDocument().blueprints[blueprintId];
        if (!bp?.bindings) {
            return undefined;
        }
        return Object.values(bp.bindings).find(
            b =>
                b.target.kind === "widgetProp" &&
                b.target.surfaceId === surfaceId &&
                b.target.elementId === elementId &&
                b.target.propPath === propPath,
        );
    }

    private applyBlueprintEdit(
        scope: BlueprintHistoryScope,
        mutator: (bp: BlueprintDocument, doc: UIGraphDocument) => void,
        options: BlueprintHistoryRecordOptions = {},
    ): void {
        if (this.isRestoringHistory || this.historySuppressionDepth > 0) {
            this.applyBlueprintMutation(mutator);
            return;
        }
        const before = this.captureBlueprintHistorySnapshot(scope.blueprintId, scope.ownerKey);
        this.applyBlueprintMutation(mutator);
        this.recordBlueprintHistory({
            blueprintId: scope.blueprintId,
            ownerKey: scope.ownerKey ?? before.ownerKey ?? undefined,
            before,
            after: this.captureBlueprintHistorySnapshot(scope.blueprintId, scope.ownerKey ?? before.ownerKey ?? undefined),
            mergeKey: options.mergeKey,
            mergeWindowMs: options.mergeWindowMs,
        });
    }

    private recordBlueprintHistory(options: {
        blueprintId: string;
        ownerKey?: string;
        before: BlueprintEditorHistorySnapshot;
        after: BlueprintEditorHistorySnapshot;
        mergeKey?: string;
        mergeWindowMs?: number;
    }): void {
        if (this.isRestoringHistory || areBlueprintHistorySnapshotsEqual(options.before, options.after)) {
            return;
        }

        const history = this.ensureBlueprintHistory(options.blueprintId);
        const now = Date.now();
        const mergeWindowMs = options.mergeWindowMs ?? DEFAULT_BLUEPRINT_MERGE_WINDOW_MS;
        const previous = history.undo[history.undo.length - 1];
        const ownerKey = options.ownerKey ?? options.before.ownerKey ?? options.after.ownerKey ?? null;
        if (
            options.mergeKey &&
            previous?.mergeKey === options.mergeKey &&
            previous.blueprintId === options.blueprintId &&
            now - previous.updatedAt <= mergeWindowMs
        ) {
            previous.after = options.after;
            previous.updatedAt = now;
            history.redo = [];
            this.events.emit("blueprintHistoryChanged", { blueprintId: options.blueprintId, ownerKey });
            return;
        }

        history.undo.push({
            blueprintId: options.blueprintId,
            ownerKey,
            before: options.before,
            after: options.after,
            mergeKey: options.mergeKey,
            createdAt: now,
            updatedAt: now,
        });
        this.trimBlueprintHistory(history);
        history.redo = [];
        this.events.emit("blueprintHistoryChanged", { blueprintId: options.blueprintId, ownerKey });
    }

    private restoreBlueprintHistorySnapshot(snapshot: BlueprintEditorHistorySnapshot): void {
        const graph = this.getContext().services.get<UIGraphService>(Services.UIGraph);
        const uidoc = this.getContext().services.get<UIDocumentService>(Services.UIDocument);

        this.isRestoringHistory = true;
        try {
            graph.applyGraphMutation(document => {
                const bpDoc = document.blueprintDocument;
                if (snapshot.ownerKey) {
                    if (snapshot.ownerRecord) {
                        bpDoc.ownerRecords[snapshot.ownerKey] = cloneBlueprintHistoryValue(snapshot.ownerRecord)!;
                    } else {
                        delete bpDoc.ownerRecords[snapshot.ownerKey];
                    }
                }
                if (snapshot.blueprint) {
                    bpDoc.blueprints[snapshot.blueprint.id] = cloneBlueprintHistoryValue(snapshot.blueprint)!;
                } else {
                    delete bpDoc.blueprints[snapshot.blueprintId];
                }
                assertValidBlueprintDocument(bpDoc);
            });
            const currentUIDocument = uidoc.getDocument();
            if (!areUIBehaviorSnapshotsEqual(captureUIBehaviorSnapshot(currentUIDocument), snapshot.uiBehavior)) {
                uidoc.restoreDocumentFromHistory(
                    applyUIBehaviorSnapshot(currentUIDocument, snapshot.uiBehavior),
                    { skipAfterMutateHook: true },
                );
            }
        } finally {
            this.isRestoringHistory = false;
        }
    }

    private ensureBlueprintHistory(blueprintId: string): BlueprintHistoryStack {
        let history = this.histories.get(blueprintId);
        if (!history) {
            history = { undo: [], redo: [] };
            this.histories.set(blueprintId, history);
        }
        return history;
    }

    private trimBlueprintHistory(history: BlueprintHistoryStack): void {
        if (history.undo.length <= this.historyLimit) {
            return;
        }
        history.undo.splice(0, history.undo.length - this.historyLimit);
    }

    private resolveBlueprintOwnerKey(scope: BlueprintHistoryScope): string | null {
        if (scope.ownerKey) {
            return scope.ownerKey;
        }
        const doc = this.getBlueprintDocument();
        const blueprint = doc.blueprints[scope.blueprintId];
        if (blueprint) {
            return ownerRefToIndexKey(blueprint.owner);
        }
        const found = Object.entries(doc.ownerRecords).find(([, record]) =>
            record.privateBlueprintIds.includes(scope.blueprintId),
        );
        return found?.[0] ?? null;
    }

    private stripBindingsForSurface(doc: BlueprintDocument, surfaceId: string): void {
        for (const bp of Object.values(doc.blueprints)) {
            if (!bp.bindings) {
                continue;
            }
            for (const [bid, b] of Object.entries(bp.bindings)) {
                if (b.target.kind === "widgetProp" && b.target.surfaceId === surfaceId) {
                    delete bp.bindings[bid];
                }
            }
        }
    }

    private stripBindingsForElement(doc: BlueprintDocument, surfaceId: string, elementId: string): void {
        for (const bp of Object.values(doc.blueprints)) {
            if (!bp.bindings) {
                continue;
            }
            for (const [bid, b] of Object.entries(bp.bindings)) {
                if (
                    b.target.kind === "widgetProp" &&
                    b.target.surfaceId === surfaceId &&
                    b.target.elementId === elementId
                ) {
                    delete bp.bindings[bid];
                }
            }
        }
    }

    /** List fields for a widget main blueprint (for minimal inspector). */
    public listFields(blueprintId: string): BlueprintField[] {
        const m = this.getBlueprintDocument().blueprints[blueprintId]?.members?.fields;
        return m ? Object.values(m) : [];
    }

    public createPersistentVariable(
        historyBlueprintId: string,
        input?: { name?: string; valueType?: string; defaultValue?: LiteralValue },
    ): BlueprintPersistentVariable {
        const uuid = this.getContext().services.get<UuidService>(Services.Uuid);
        const id = uuid.generate();
        const valueType = input?.valueType?.trim();
        const v: BlueprintPersistentVariable = {
            id,
            storageKey: id,
            name: input?.name?.trim() || `persist_${id.slice(0, 8)}`,
            valueType: valueType || undefined,
            defaultValue: input?.defaultValue,
        };
        this.applyBlueprintEdit({ blueprintId: historyBlueprintId }, doc => {
            doc.persistentVariables = doc.persistentVariables ?? {};
            doc.persistentVariables[v.id] = v;
        });
        return v;
    }

    public renamePersistentVariable(historyBlueprintId: string, variableId: string, name: string): void {
        this.applyBlueprintEdit({ blueprintId: historyBlueprintId }, doc => {
            const v = doc.persistentVariables?.[variableId];
            if (!v) {
                return;
            }
            const next = name.trim();
            v.name = next.length > 0 ? next : v.name;
        }, { mergeKey: `persistent-variable-name:${variableId}` });
    }

    public setPersistentVariableDefault(
        historyBlueprintId: string,
        variableId: string,
        defaultValue: LiteralValue | undefined,
    ): void {
        this.applyBlueprintEdit({ blueprintId: historyBlueprintId }, doc => {
            const v = doc.persistentVariables?.[variableId];
            if (!v) {
                return;
            }
            v.defaultValue = defaultValue;
        }, { mergeKey: `persistent-variable-default:${variableId}` });
    }

    public deletePersistentVariable(historyBlueprintId: string, variableId: string): void {
        this.applyBlueprintEdit({ blueprintId: historyBlueprintId }, doc => {
            if (!doc.persistentVariables?.[variableId]) {
                return;
            }
            this.clearPersistentVariableNodeRefs(doc, variableId);
            delete doc.persistentVariables[variableId];
        });
    }

    public createBlueprintVariable(
        blueprintId: string,
        input?: { name?: string; valueType?: string; defaultValue?: LiteralValue },
    ): BlueprintVariable {
        const uuid = this.getContext().services.get<UuidService>(Services.Uuid);
        const id = uuid.generate();
        const valueType = input?.valueType?.trim();
        const v: BlueprintVariable = {
            id,
            name: input?.name?.trim() || `var_${id.slice(0, 8)}`,
            valueType: valueType || undefined,
            defaultValue: input?.defaultValue,
        };
        this.applyBlueprintEdit({ blueprintId }, doc => {
            const bp = doc.blueprints[blueprintId];
            if (!bp) {
                throw new RendererError(`Blueprint not found: ${blueprintId}`);
            }
            bp.members = bp.members ?? emptyMemberIndex();
            bp.members.variables[v.id] = v;
        });
        return v;
    }

    public renameBlueprintVariable(blueprintId: string, variableId: string, name: string): void {
        this.applyBlueprintEdit({ blueprintId }, doc => {
            const v = doc.blueprints[blueprintId]?.members?.variables?.[variableId];
            if (!v) {
                return;
            }
            const next = name.trim();
            v.name = next.length > 0 ? next : v.name;
        }, { mergeKey: `variable-name:${blueprintId}:${variableId}` });
    }

    public setBlueprintVariableDefault(
        blueprintId: string,
        variableId: string,
        defaultValue: LiteralValue | undefined,
    ): void {
        this.applyBlueprintEdit({ blueprintId }, doc => {
            const v = doc.blueprints[blueprintId]?.members?.variables?.[variableId];
            if (!v) {
                return;
            }
            v.defaultValue = defaultValue;
        }, { mergeKey: `variable-default:${blueprintId}:${variableId}` });
    }

    public deleteBlueprintVariable(blueprintId: string, variableId: string): void {
        this.applyBlueprintEdit({ blueprintId }, doc => {
            const bp = doc.blueprints[blueprintId];
            if (!bp?.members?.variables?.[variableId]) {
                return;
            }
            if (bp.program.kind === "graph") {
                for (const slot of Object.values(bp.program.graphs.events ?? {})) {
                    const ir = ensureBlueprintGraphIr(slot?.graph);
                    for (const node of Object.values(ir.nodes ?? {})) {
                        if (
                            (node.type === BLUEPRINT_NODE_TYPE_LOCAL_SET ||
                                node.type === BLUEPRINT_NODE_TYPE_LOCAL_GET) &&
                            node.params?.variableId === variableId
                        ) {
                            const next = { ...(node.params ?? {}) };
                            delete next.variableId;
                            node.params = next;
                        }
                    }
                }
            }
            delete bp.members.variables[variableId];
        });
    }

    private clearPersistentVariableNodeRefs(doc: BlueprintDocument, variableId: string): void {
        for (const bp of Object.values(doc.blueprints)) {
            if (bp.program.kind !== "graph") {
                continue;
            }
            const slots = [
                ...Object.values(bp.program.graphs.events ?? {}),
                ...Object.values(bp.program.graphs.functions ?? {}),
                ...Object.values(bp.program.graphs.macros ?? {}),
            ];
            for (const slot of slots) {
                if (!slot.graph) {
                    continue;
                }
                const ir = ensureBlueprintGraphIr(slot.graph);
                for (const node of Object.values(ir.nodes ?? {})) {
                    if (
                        (node.type === BLUEPRINT_NODE_TYPE_PERSISTENT_GET ||
                            node.type === BLUEPRINT_NODE_TYPE_PERSISTENT_SET) &&
                        node.params?.persistentVariableId === variableId
                    ) {
                        const next = { ...(node.params ?? {}) };
                        delete next.persistentVariableId;
                        delete next[BLUEPRINT_NODE_PARAM_VARIABLE_VALUE_TYPE];
                        node.params = next;
                    }
                }
            }
        }
    }

    /**
     * Ensure an inline event graph slot exists under Blueprint.program.graphs.events[eventId].
     * Upserts by eventId; preserves existing graph IR when present.
     */
    public ensureEventGraph(blueprintId: string, eventId: string, displayName?: string): void {
        this.applyBlueprintEdit({ blueprintId }, doc => {
            const bp = doc.blueprints[blueprintId];
            if (!bp) {
                throw new RendererError(`Blueprint not found: ${blueprintId}`);
            }
            if (bp.program.kind !== "graph") {
                throw new RendererError(`Blueprint ${blueprintId} is not a graph program`);
            }
            const uuid = this.getContext().services.get<UuidService>(Services.Uuid);
            const prev = bp.program.graphs.events[eventId];
            const graphIr = ensureBlueprintEventGraphIrStructure(prev?.graph ?? undefined, () => uuid.generate());
            const next: BlueprintEventGraph = {
                id: eventId,
                name: displayName ?? prev?.name,
                graph: graphIr,
                meta: prev?.meta,
            };
            bp.program.graphs.events[eventId] = next;
        });
    }

    public adoptLegacyEventGraphToSlot(
        blueprintId: string,
        slotId: string,
        legacyEventId: string,
        displayName?: string,
    ): void {
        this.applyBlueprintEdit({ blueprintId }, doc => {
            const bp = doc.blueprints[blueprintId];
            if (!bp || bp.program.kind !== "graph") {
                return;
            }
            if (bp.program.graphs.events[slotId]) {
                return;
            }
            const legacy = bp.program.graphs.events[legacyEventId];
            if (!legacy) {
                return;
            }
            bp.program.graphs.events[slotId] = {
                ...legacy,
                id: slotId,
                name: legacy.name ?? displayName,
            };
            if (legacyEventId !== slotId) {
                delete bp.program.graphs.events[legacyEventId];
            }
        });
    }

    public renameEventGraph(blueprintId: string, eventId: string, displayName: string): void {
        this.applyBlueprintEdit({ blueprintId }, doc => {
            const bp = doc.blueprints[blueprintId];
            if (!bp || bp.program.kind !== "graph") {
                return;
            }
            const slot = bp.program.graphs.events?.[eventId];
            if (!slot) {
                return;
            }
            const next = displayName.trim();
            slot.name = next.length > 0 ? next : slot.name;
        }, { mergeKey: `event-name:${blueprintId}:${eventId}` });
    }

    public removeEventGraph(blueprintId: string, eventId: string): void {
        this.applyBlueprintEdit({ blueprintId }, doc => {
            const bp = doc.blueprints[blueprintId];
            if (!bp || bp.program.kind !== "graph") {
                return;
            }
            delete bp.program.graphs.events[eventId];
        });
    }

    public listEventGraphIds(blueprintId: string): string[] {
        const bp = this.getBlueprintDocument().blueprints[blueprintId];
        if (!bp || bp.program.kind !== "graph") {
            return [];
        }
        return Object.keys(bp.program.graphs.events ?? {});
    }

    public ensureFunctionGraph(blueprintId: string, functionId: string, displayName?: string): void {
        this.applyBlueprintEdit({ blueprintId }, doc => {
            const bp = doc.blueprints[blueprintId];
            if (!bp) {
                throw new RendererError(`Blueprint not found: ${blueprintId}`);
            }
            if (bp.program.kind !== "graph") {
                throw new RendererError(`Blueprint ${blueprintId} is not a graph program`);
            }
            const uuid = this.getContext().services.get<UuidService>(Services.Uuid);
            const prev = bp.program.graphs.functions[functionId];
            const graphIr = ensureBlueprintFunctionGraphIrStructure(prev?.graph ?? undefined, () => uuid.generate());
            const next: BlueprintFunctionGraph = {
                id: functionId,
                name: displayName ?? prev?.name,
                graph: graphIr,
                meta: prev?.meta,
            };
            bp.program.graphs.functions[functionId] = next;
        });
    }

    public removeFunctionGraph(blueprintId: string, functionId: string): void {
        this.applyBlueprintEdit({ blueprintId }, doc => {
            const bp = doc.blueprints[blueprintId];
            if (!bp || bp.program.kind !== "graph") {
                return;
            }
            delete bp.program.graphs.functions[functionId];
        });
    }

    public listFunctionGraphIds(blueprintId: string): string[] {
        const bp = this.getBlueprintDocument().blueprints[blueprintId];
        if (!bp || bp.program.kind !== "graph") {
            return [];
        }
        return Object.keys(bp.program.graphs.functions ?? {});
    }

    public updateEventGraphIr(
        blueprintId: string,
        eventId: string,
        updater: (ir: BlueprintGraphIr) => void,
        options: BlueprintHistoryRecordOptions = {},
    ): void {
        this.applyBlueprintEdit({ blueprintId }, doc => {
            const bp = doc.blueprints[blueprintId];
            if (!bp || bp.program.kind !== "graph") {
                return;
            }
            const slot = bp.program.graphs.events[eventId];
            if (!slot) {
                return;
            }
            const ir = ensureBlueprintGraphIr(slot.graph);
            updater(ir);
            slot.graph = ir;
        }, options);
    }

    public updateFunctionGraphIr(
        blueprintId: string,
        functionId: string,
        updater: (ir: BlueprintGraphIr) => void,
        options: BlueprintHistoryRecordOptions = {},
    ): void {
        this.applyBlueprintEdit({ blueprintId }, doc => {
            const bp = doc.blueprints[blueprintId];
            if (!bp || bp.program.kind !== "graph") {
                return;
            }
            const slot = bp.program.graphs.functions[functionId];
            if (!slot) {
                return;
            }
            const ir = ensureBlueprintGraphIr(slot.graph);
            updater(ir);
            slot.graph = ir;
        }, options);
    }

    public updateScriptModuleSource(
        blueprintId: string,
        code: string,
        options: BlueprintHistoryRecordOptions = {},
    ): void {
        this.applyBlueprintEdit({ blueprintId }, doc => {
            const bp = doc.blueprints[blueprintId];
            if (!bp || bp.program.kind !== "scriptModule") {
                return;
            }
            bp.program.source.code = code;
            bp.program.source.diagnostics = undefined;
        }, {
            mergeKey: options.mergeKey ?? `script-source:${blueprintId}`,
            mergeWindowMs: options.mergeWindowMs ?? 1200,
        });
    }

    public getReadonlyWidgetMainSummary(surfaceId: string, element: UIElement): ReadonlyBlueprintWidgetSummary {
        return buildReadonlyWidgetMainSummary(this.getBlueprintDocument(), surfaceId, element);
    }

    public getReadonlyComponentWidgetMainSummary(
        componentId: string,
        element: UIElement,
    ): ReadonlyBlueprintWidgetSummary {
        return buildReadonlyWidgetMainSummary(this.getBlueprintDocument(), `component:${componentId}`, element, {
            componentId,
        });
    }

    /** Rules-only remap plan for duplicating a widget subtree (no UI). */
    public planSubtreeDuplicateBlueprintRemap(input: {
        surfaceId: string;
        oldElementIds: string[];
        generateId: () => string;
    }): SubtreeDuplicateRemapPlan {
        const { surfaceId } = input;
        const uidoc = this.getContext().services.get<UIDocumentService>(Services.UIDocument);
        return planSubtreeDuplicateBlueprintRemap({
            oldElementIds: input.oldElementIds,
            generateId: input.generateId,
            getWidgetMainBlueprintId: (elementId: string) => this.getWidgetMainBlueprintId(surfaceId, elementId),
            getWidgetValueBlueprintIds: (elementId: string) => {
                const el = uidoc.getDocument().elements[elementId];
                return Object.keys(el?.valueBindings ?? {})
                    .map(propPath => this.getWidgetValueBlueprintId(surfaceId, elementId, propPath))
                    .filter((id): id is string => Boolean(id));
            },
        });
    }

}
