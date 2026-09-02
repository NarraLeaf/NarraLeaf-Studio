import type {
    BindingDefinition,
    Blueprint,
    BlueprintDocument,
    BlueprintField,
    BlueprintFieldValueSource,
    BlueprintFrontendKind,
    BlueprintGraphNode,
    BlueprintPrivateOwnerRecord,
    BlueprintVariable,
    LiteralValue,
} from "@shared/types/blueprint/document";
import {
    BLUEPRINT_GRAPH_IR_META_KIND,
    BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_CALL,
    BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN,
    BLUEPRINT_NODE_TYPE_LITERAL_FLOAT,
    BLUEPRINT_NODE_TYPE_LITERAL_JSON,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LOCAL_GET,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
    BLUEPRINT_NODE_PARAM_VARIABLE_VALUE_TYPE,
    BLUEPRINT_NODE_TYPE_PERSISTENT_GET,
    BLUEPRINT_NODE_TYPE_PERSISTENT_SET,
    BLUEPRINT_NODE_TYPE_SAVED_GET,
    BLUEPRINT_NODE_TYPE_SAVED_SET,
} from "@shared/types/blueprint/graph";
import {
    captureBlueprintEventOrder,
    captureBlueprintFunctionOrder,
    listBlueprintEventIds,
    listBlueprintFunctionIds,
} from "@shared/blueprint/blueprintEventOrder";
import type { UIDocument, UIElement, UIElementValueBindingValueType } from "@shared/types/ui-editor/document";
import type { UIGraphDocument } from "@shared/types/ui-editor/graph";
import type { VariableRegistry, VariableRegistryEntry } from "@shared/types/variables/registry";
import type { SaveSchema } from "@shared/types/saveSchema";
import type { StoryVariableValueType } from "@shared/types/story/document";
import type { TranslationKey } from "@shared/i18n";
import { RendererError } from "@shared/utils/error";
import { EventEmitter } from "../ui/EventEmitter";
import { HistoryService } from "../history/HistoryService";
import { blueprintHistoryScope, HistoryScopeKind, historyScopeParts, isHistoryScopeOf } from "../history/historyScopes";
import { Service } from "../Service";
import { Services, ILocalBlueprintService, WorkspaceContext } from "../services";
import { FileSystemService } from "../core/FileSystem";
import { ProjectService } from "../core/ProjectService";
import { UuidService } from "../core/UuidService";
import { UIGraphService } from "./UIGraphService";
import { UIDocumentService } from "./UIDocumentService";
import { VariableRegistryService } from "../variables/VariableRegistryService";
import { SaveSchemaService } from "../saves/SaveSchemaService";
import {
    createMainBlueprint,
    createScriptMainBlueprint,
    renderStarterScript,
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
import { derivedBlueprintId } from "./blueprint/derivedBlueprintId";
import { ownerKeyBelongsToSurface } from "@shared/blueprint/ownerKey";
import { SCRIPTS_DIR } from "@shared/project/scriptsDirectory";
import { writeScriptDeclarations } from "./blueprint/scriptDeclarationFiles";
import type { BlueprintOwnerRef } from "@shared/types/blueprint/document";
import { anchorElementId, anchorSurfaceId, blueprintContract } from "@shared/blueprint/ownerShape";
import {
    buildReadonlySurfaceMainSummary,
    type ReadonlyBlueprintSurfaceSummary,
} from "./blueprint/readonlyBlueprintSummary";
import {
    getActiveBlueprintId,
    parsePrivateOwnerKeyToRef,
    registerPrivateBlueprintAsActive,
    removePrivateBlueprint,
    setPrivateOwnerActive,
} from "./blueprint/ownerRecords";

const DEFAULT_BLUEPRINT_HISTORY_LIMIT = 100;
const DEFAULT_BLUEPRINT_MERGE_WINDOW_MS = 800;

/**
 * The `historyBlueprintId` a caller passes when it edits registry variables with no blueprint open -
 * the variables panel, which is a project-level surface and has no blueprint of its own.
 *
 * The registry CRUD below rides the blueprint history channel, so it needs *an* id even when there
 * is no blueprint involved. An unknown id is harmless by construction:
 * `captureBlueprintHistorySnapshot` returns `blueprint: null` for it, and
 * `restoreBlueprintHistorySnapshot` then runs `delete bpDoc.blueprints[<that id>]`, which is a no-op
 * for an id no blueprint ever had. The registry half of the snapshot still captures and restores
 * normally, which is the part these edits need.
 *
 * That safety rests entirely on the id NOT naming a real blueprint - if it did, an undo of a
 * variable edit would delete that blueprint. Hence one exported constant with a namespaced,
 * non-uuid spelling rather than a string each call site invents.
 */
export const VARIABLE_PANEL_HISTORY_SCOPE_ID = "nls:variable-panel";

export type BlueprintHistoryRecordOptions = {
    mergeKey?: string;
    mergeWindowMs?: number;
};

type BlueprintHistoryScope = {
    blueprintId: string;
    ownerKey?: string;
};

export type BlueprintEditorHistorySnapshot = {
    blueprintId: string;
    ownerKey: string | null;
    ownerRecord: BlueprintPrivateOwnerRecord | null;
    blueprint: Blueprint | null;
    /**
     * The project-level variable registry, captured so persistent-variable CRUD (which lives in its
     * own service/file since M-VAR) undoes with the same Ctrl+Z as the blueprint edit that made it.
     */
    registry: VariableRegistry;
    /**
     * The project-level save schema, captured for the same reason the registry is: the fields are
     * edited from a popover on a save node's card, so adding one is a blueprint edit in every way
     * the author can see and has to undo with the same Ctrl+Z.
     */
    saveSchema: SaveSchema;
};

type LocalBlueprintHistoryEvents = {
    blueprintHistoryChanged: { blueprintId: string; ownerKey: string | null };
};

function cloneBlueprintHistoryValue<T>(value: T): T {
    return value == null ? value : JSON.parse(JSON.stringify(value)) as T;
}

function areBlueprintHistorySnapshotsEqual(
    a: BlueprintEditorHistorySnapshot,
    b: BlueprintEditorHistorySnapshot,
): boolean {
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
              : input.valueType === "boolean"
                ? BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN
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
    if (valueType === "boolean") {
        return value === true || value === "true";
    }
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
    private readonly events = new EventEmitter<LocalBlueprintHistoryEvents>();
    /** Blueprints this service has published a history scope for; the value unregisters it. */
    private readonly registeredHistoryScopes = new Map<string, () => void>();
    private historyLimit = DEFAULT_BLUEPRINT_HISTORY_LIMIT;
    private unsubscribeHistory: (() => void) | null = null;

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const fs = ctx.services.get<FileSystemService>(Services.FileSystem);
        const project = ctx.services.get<ProjectService>(Services.Project);
        const uuid = ctx.services.get<UuidService>(Services.Uuid);
        const graph = ctx.services.get<UIGraphService>(Services.UIGraph);
        const registry = ctx.services.get<VariableRegistryService>(Services.VariableRegistry);
        const saveSchema = ctx.services.get<SaveSchemaService>(Services.SaveSchema);
        await depend([fs, project, uuid, graph, registry, saveSchema]);

        // The declarations, refreshed for a project that already has scripts. Written on open
        // rather than only when one is created, because the point of the project half is that
        // renaming something in Studio turns the script that used the old name into an error the
        // author sees - which only holds if the file is rewritten after the rename.
        //
        // Not awaited, and its failure is swallowed by design: a project whose declarations could
        // not be written is still one the author can edit and still one that builds, since the type
        // check is a lint rather than a build step. Blocking the open on it would trade the whole
        // project for completion in one folder.
        if (this.hasScriptBlueprints()) {
            void writeScriptDeclarations(ctx).catch(error => {
                console.warn("[blueprint] could not write script declarations", error);
            });
        }

        // The stacks live in HistoryService; re-shape its "some stack changed" event into the
        // blueprint-shaped one this service's subscribers already listen for.
        this.unsubscribeHistory?.();
        this.unsubscribeHistory = this.history().on("changed", ({ scopeId }) => {
            if (!isHistoryScopeOf(scopeId, HistoryScopeKind.Blueprint)) {
                return;
            }
            const [blueprintId] = historyScopeParts(scopeId);
            if (blueprintId) {
                this.events.emit("blueprintHistoryChanged", {
                    blueprintId,
                    ownerKey: this.resolveBlueprintOwnerKey({ blueprintId }),
                });
            }
        });
    }

    /** Whether anything in this project is a script blueprint, and so needs declarations. */
    private hasScriptBlueprints(): boolean {
        return Object.values(this.getBlueprintDocument().blueprints ?? {})
            .some(blueprint => blueprint.program.kind === "scriptModule");
    }

    private history(): HistoryService {
        return this.getContext().services.get<HistoryService>(Services.History);
    }

    /**
     * Publish this blueprint's readers once.
     *
     * A blueprint's snapshot slices three service-owned stores (the graph document, element
     * behaviours, the variable registry), none of which need an editor to be mounted - so the scope
     * stays registered for the life of the workspace and an entry is always applicable.
     */
    private ensureBlueprintHistoryScope(blueprintId: string): void {
        if (this.registeredHistoryScopes.has(blueprintId)) {
            return;
        }
        const dispose = this.history().registerScope<BlueprintEditorHistorySnapshot>({
            id: blueprintHistoryScope(blueprintId),
            label: { key: "workspace.history.scope.blueprint" as TranslationKey },
            capture: () => this.captureBlueprintHistorySnapshot(blueprintId),
            apply: snapshot => this.restoreBlueprintHistorySnapshot(snapshot),
            limit: this.historyLimit,
        });
        this.registeredHistoryScopes.set(blueprintId, dispose);
    }

    private getSaveSchemaService(): SaveSchemaService {
        return this.getContext().services.get<SaveSchemaService>(Services.SaveSchema);
    }

    private getVariableRegistryService(): VariableRegistryService {
        return this.getContext().services.get<VariableRegistryService>(Services.VariableRegistry);
    }

    public getBlueprintDocument(): BlueprintDocument {
        return this.getContext().services.get<UIGraphService>(Services.UIGraph).getDocument().blueprintDocument;
    }

    /**
     * The blueprint id an `ensure*` call would have returned without writing anything, if any.
     *
     * The three `ensure*` helpers are called once per surface and once per eligible widget on every
     * uidoc mutation, and they are almost always no-ops - the owner record already exists. Going
     * through `applyBlueprintMutation` anyway is not free: each call bumps the graph revision, marks
     * uigraphs.json dirty, schedules a save of it, fires `graphsChanged` at every subscriber, and
     * revalidates the whole blueprint document. Dragging one element therefore rewrote the graph
     * document and re-rendered its readers dozens of times over.
     */
    private alreadyEnsured(
        ownerKey: string,
        displayName: string | undefined,
        // `ensureComponentWidgetMain` writes `displayName || existing`, so an empty name is a no-op
        // there; the other two write `displayName` straight through. Kept explicit rather than
        // guessed, because guessing wrong here means a rename that silently does not stick.
        emptyNameKeepsExisting: boolean,
    ): string | null {
        const doc = this.getBlueprintDocument();
        const activeId = getActiveBlueprintId(doc, ownerKey);
        if (!activeId) {
            return null;
        }
        const blueprint = doc.blueprints[activeId];
        if (!blueprint) {
            return null;
        }
        if (displayName === undefined) {
            return activeId;
        }
        if (emptyNameKeepsExisting && displayName === "") {
            return activeId;
        }
        return blueprint.name === displayName ? activeId : null;
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
        for (const blueprintId of this.registeredHistoryScopes.keys()) {
            this.history().setScopeLimit(blueprintHistoryScope(blueprintId), next);
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
        return {
            blueprintId,
            ownerKey: resolvedOwnerKey,
            ownerRecord: cloneBlueprintHistoryValue(ownerRecord),
            blueprint: cloneBlueprintHistoryValue(blueprint),
            registry: cloneBlueprintHistoryValue(this.getVariableRegistryService().getRegistry()),
            saveSchema: cloneBlueprintHistoryValue(this.getSaveSchemaService().getSchema()),
        };
    }

    public runBlueprintHistoryTransaction<T>(
        blueprintId: string,
        action: () => T,
        options: BlueprintHistoryRecordOptions & { ownerKey?: string } = {},
    ): T {
        const before = this.captureBlueprintHistorySnapshot(blueprintId, options.ownerKey);
        // The action's own edits must not each become a step - the transaction is the step.
        const result = this.history().withoutRecording(action);
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
        return this.history().canUndo(blueprintHistoryScope(blueprintId));
    }

    public canRedoBlueprint(blueprintId: string): boolean {
        return this.history().canRedo(blueprintHistoryScope(blueprintId));
    }

    public undoBlueprint(blueprintId: string): boolean {
        this.ensureBlueprintHistoryScope(blueprintId);
        return this.history().undo(blueprintHistoryScope(blueprintId));
    }

    public redoBlueprint(blueprintId: string): boolean {
        this.ensureBlueprintHistoryScope(blueprintId);
        return this.history().redo(blueprintHistoryScope(blueprintId));
    }

    public clearBlueprintHistory(blueprintId?: string): void {
        if (blueprintId) {
            this.history().clearScope(blueprintHistoryScope(blueprintId));
            return;
        }
        this.history().clearMatching(scopeId => isHistoryScopeOf(scopeId, HistoryScopeKind.Blueprint));
        for (const dispose of this.registeredHistoryScopes.values()) {
            dispose();
        }
        this.registeredHistoryScopes.clear();
    }

    public onBlueprintHistoryChanged(
        handler: (event: { blueprintId: string; ownerKey: string | null }) => void,
    ): () => void {
        return this.events.on("blueprintHistoryChanged", handler);
    }

    public ensureSurfaceMain(surfaceId: string, displayName?: string): string {
        const uuid = this.getContext().services.get<UuidService>(Services.Uuid);
        const key = surfaceMainOwnerKey(surfaceId);
        const settled = this.alreadyEnsured(key, displayName, false);
        if (settled) {
            return settled;
        }
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
            const id = derivedBlueprintId(key);
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
        // Asked of each key rather than matched as a prefix: rebuilding the opening of a key by
        // hand is a second encoder, and this one was wrong twice - it left the surface id
        // unescaped, and it would have swept up a surface whose id merely starts with this
        // one's. Deleting a surface is not the place to be approximately right.
        this.applyBlueprintMutation(doc => {
            const toRemoveBlueprintIds = new Set<string>();
            for (const [k, rec] of Object.entries(doc.ownerRecords)) {
                if (ownerKeyBelongsToSurface(k, surfaceId)) {
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
        const settled = this.alreadyEnsured(key, displayName, false);
        if (settled) {
            return settled;
        }
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
            const id = derivedBlueprintId(key);
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
        const settled = this.alreadyEnsured(key, displayName, true);
        if (settled) {
            return settled;
        }
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
            const id = derivedBlueprintId(key);
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
    public ensureStoryActionBlueprint(input?: { blueprintId?: string; displayName?: string; mode?: "action" | "value" | "condition" }): string {
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
            const defaultName =
                input?.mode === "value" ? "Story Value" : input?.mode === "condition" ? "Story Condition" : "Story Action";
            const blueprint = createMainBlueprint({
                id,
                name: input?.displayName ?? defaultName,
                owner: { kind: "storyAction", blueprintId: id, ...(input?.mode ? { mode: input.mode } : {}) },
            });
            if (blueprint.program.kind === "graph") {
                // Value mode (inline interpolation) opens ready to return a string: On Call → Return Value
                // ← "" literal. Condition mode returns a boolean: On Call → Return Value ← `false` literal
                // (type-checked to boolean while authoring). Action mode runs for side effects, so it only
                // needs the On Call head.
                const graph = input?.mode === "value"
                    ? createValueGraphIr({
                          headNodeType: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_CALL,
                          valueType: "string",
                          literalValue: "",
                          generateId: () => uuid.generate(),
                      })
                    : input?.mode === "condition"
                    ? createValueGraphIr({
                          headNodeType: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_CALL,
                          valueType: "boolean",
                          literalValue: false,
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
                captureBlueprintEventOrder(blueprint.program.graphs);
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

    /**
     * All project-level PERSISTENT variable definitions (shared with the Story editor); M-VAR registry.
     *
     * Scoped, not the whole registry: the registry also holds `saved` entries now, and the callers of
     * this - the blueprint member tree, the persistent node picker, the persistent merged view - all
     * mean persistent specifically. Handing them a saved variable would offer the persistent channel
     * a key belonging to the save file.
     */
    public listPersistentVariables(): VariableRegistryEntry[] {
        return this.getVariableRegistryService().listEntriesInScope("persistent");
    }

    /** All project-level SAVED variable definitions; the `saved` half of the same registry. */
    public listSavedVariables(): VariableRegistryEntry[] {
        return this.getVariableRegistryService().listEntriesInScope("saved");
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

    /**
     * Remove one revision of a slot, leaving any file it pointed at on disk.
     *
     * Undoable, like every other edit to this document - which matters here more than elsewhere,
     * because the thing being removed may be the only reference to a file the author has been
     * writing in.
     */
    public deletePrivateBlueprintForOwnerKey(ownerKey: string, blueprintId: string): void {
        this.applyBlueprintEdit({ blueprintId, ownerKey }, doc => {
            removePrivateBlueprint(doc, ownerKey, blueprintId);
        });
    }

    /**
     * Point a script at a different file.
     *
     * The one way a `scriptRef` can change after it is written. Without it a file renamed in the
     * author's own editor left the slot dangling for good: the panel said the file was missing and
     * offered nothing to do about it.
     */
    public setBlueprintScriptRef(blueprintId: string, scriptRef: string): void {
        this.applyBlueprintEdit({ blueprintId }, doc => {
            const bp = doc.blueprints[blueprintId];
            if (!bp || bp.program.kind !== "scriptModule") {
                throw new RendererError(`Not a script: ${blueprintId}`);
            }
            bp.program = { kind: "scriptModule", scriptRef };
        });
    }

    /**
     * Add a revision to a slot: a blueprint, a new script, or an existing file.
     *
     * `existingScriptRef` is how a file that is already in the project reaches a slot. Nothing is
     * written for it - the file is the author's, and a starter written over it would destroy work -
     * so the only act is the document edit that points at it. One file may be pointed at from
     * several slots; the scripts panel says how many.
     */
    public async createSiblingPrivateBlueprintForOwnerKey(
        ownerKey: string,
        frontend: BlueprintFrontendKind,
        options?: { existingScriptRef?: string },
    ): Promise<string> {
        const ownerRef = parsePrivateOwnerKeyToRef(ownerKey);
        if (!ownerRef) {
            throw new RendererError(`Invalid private owner key: ${ownerKey}`);
        }
        // Which frontends a slot admits follows from how it is entered: a value binding is re-run
        // whenever a dependency changes, and only the visual graph has a palette cut down to nodes
        // that are safe to re-run.
        if (blueprintContract(ownerRef).invocation === "valueBinding" && frontend === "typescript") {
            throw new RendererError("Blueprint Value only supports visual blueprints");
        }
        const uuid = this.getContext().services.get<UuidService>(Services.Uuid);
        const id = uuid.generate();
        const name = this.unusedBlueprintName(ownerRef, ownerKey);
        // The file first, and the blueprint only if it was written. The other order leaves a
        // blueprint pointing at a file that does not exist, which is the dangling state the model
        // allows for a file the author deleted - and reporting it as that would blame them for a
        // write of ours that failed.
        // The declarations first: an author who opens the new file wants completion in it, and the
        // project half is only current as of the last time this ran.
        if (frontend === "typescript") {
            await writeScriptDeclarations(this.getContext());
        }
        const scriptRef =
            frontend === "typescript"
                ? options?.existingScriptRef ?? (await this.createStarterScriptFile(ownerRef, name))
                : null;
        this.applyBlueprintEdit({ blueprintId: id, ownerKey }, doc => {
            const blueprint =
                scriptRef !== null
                    ? createScriptMainBlueprint({ id, name, owner: ownerRef, scriptRef })
                    : createMainBlueprint({ id, name, owner: ownerRef });
            doc.blueprints[id] = blueprint;
            registerPrivateBlueprintAsActive(doc, ownerKey, id, frontend);
        });
        return id;
    }

    /**
     * Write the file a new script blueprint will point at, and answer where it went.
     *
     * The one moment Studio writes an author's script. From here on the file is theirs: the
     * document holds the path, nothing holds the text, and nothing writes it again. See
     * `@shared/project/scriptsDirectory`.
     */
    private async createStarterScriptFile(owner: BlueprintOwnerRef, name: string): Promise<string> {
        const fs = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const scriptRef = this.unusedScriptRef(name, this.widgetTypeOfOwner(owner));
        const absolute = this.getContext().project.resolve(scriptRef.split("/"));
        const written = await fs.writeFileNoFollowOrCreate(
            absolute,
            renderStarterScript({ owner, widgetType: this.widgetTypeOfOwner(owner) }),
            "utf-8",
        );
        if (!written.ok) {
            throw new RendererError(`Could not create ${scriptRef}: ${written.error.message}`);
        }
        // A refusal is reported as success - the write gate turns a frozen workspace into a no-op -
        // so the flag is the only thing that separates "written" from "silently dropped". Creating
        // the blueprint on a dropped write is precisely the dangling reference this order avoids.
        if (written.refused) {
            throw new RendererError(`Could not create ${scriptRef}: this workspace is read-only`);
        }
        return scriptRef;
    }

    /**
     * What a new blueprint or script is called: the slot it fills.
     *
     * The old name was six characters of its own UUID, which names nothing an author can recognise
     * and - for a script - was then baked into a filename they open in their own editor. The slot
     * has a name already: the control, the page, or the project. Two revisions of one slot count up
     * rather than colliding, so the revision list never shows the same word twice.
     */
    private unusedBlueprintName(owner: BlueprintOwnerRef, ownerKey: string): string {
        const base = this.slotName(owner);
        const taken = new Set(
            this.listPrivateBlueprintIdsForOwnerKey(ownerKey)
                .map(id => this.getBlueprintDocument().blueprints[id]?.name)
                .filter((name): name is string => typeof name === "string"),
        );
        if (!taken.has(base)) {
            return base;
        }
        for (let index = 2; ; index += 1) {
            const candidate = `${base} ${index}`;
            if (!taken.has(candidate)) {
                return candidate;
            }
        }
    }

    /**
     * The author's own word for where this blueprint sits.
     *
     * Their name for the element or the page wherever there is one; otherwise the position itself.
     * English, like every other default this document stores - a blueprint name is authored data
     * that travels with the project, not an interface string that follows the reader's language.
     */
    private slotName(owner: BlueprintOwnerRef): string {
        const uidoc = this.getContext().services.get<UIDocumentService>(Services.UIDocument).getDocument();
        const elementId = anchorElementId(owner);
        if (elementId) {
            const element = uidoc.elements[elementId];
            const named = element?.name?.trim();
            if (named) {
                return named;
            }
            // `nl.button` reads as "Button": the type is the only thing an unnamed element has, and
            // its prefix is ours rather than anything the author wrote.
            const type = element?.type?.split(".").pop();
            return type ? type.charAt(0).toUpperCase() + type.slice(1) : "Logic";
        }
        const surfaceId = anchorSurfaceId(owner);
        if (surfaceId) {
            const named = uidoc.surfaces.find(surface => surface.id === surfaceId)?.name?.trim();
            if (named) {
                return named;
            }
        }
        if (owner.kind === "storyAction") {
            return owner.mode === "condition" ? "Condition" : owner.mode === "value" ? "Value" : "Story action";
        }
        return owner.kind === "globalMain" ? "App" : "Logic";
    }

    /**
     * A path under `scripts/` that no blueprint already points at.
     *
     * Named after the blueprint rather than after its id: the author opens this file in their own
     * editor, and a filename is as much interface as a title bar is. Two blueprints with one name
     * count up rather than colliding.
     */
    private unusedScriptRef(name: string, widgetType?: string): string {
        const taken = new Set(
            Object.values(this.getBlueprintDocument().blueprints ?? {})
                .map(bp => (bp.program.kind === "scriptModule" ? bp.program.scriptRef : null))
                .filter((ref): ref is string => typeof ref === "string"),
        );
        // A name written in a script the filename cannot carry - most of them - slugs to nothing.
        // The widget type is the next most specific thing that is always ASCII, and beats numbering
        // every such file `script-2.ts`.
        const slugify = (value: string) =>
            value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
        const slug = slugify(name) || slugify(widgetType?.split(".").pop() ?? "") || "script";
        let candidate = `${SCRIPTS_DIR}/${slug}.ts`;
        for (let index = 2; taken.has(candidate); index += 1) {
            candidate = `${SCRIPTS_DIR}/${slug}-${index}.ts`;
        }
        return candidate;
    }

    /** The widget type a starter script should be written against, when the owner names an element. */
    private widgetTypeOfOwner(owner: BlueprintOwnerRef): string | undefined {
        const elementId = anchorElementId(owner);
        if (!elementId) {
            return undefined;
        }
        const uidoc = this.getContext().services.get<UIDocumentService>(Services.UIDocument);
        return uidoc.getDocument().elements[elementId]?.type;
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
        if (this.history().isRestoring()) {
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
        this.ensureBlueprintHistoryScope(options.blueprintId);
        this.history().pushSnapshot<BlueprintEditorHistorySnapshot>(blueprintHistoryScope(options.blueprintId), {
            label: { key: "workspace.history.entry.blueprintEdit" as TranslationKey },
            before: options.before,
            after: options.after,
            mergeKey: options.mergeKey,
            mergeWindowMs: options.mergeWindowMs ?? DEFAULT_BLUEPRINT_MERGE_WINDOW_MS,
            equals: areBlueprintHistorySnapshotsEqual,
        });
    }

    private restoreBlueprintHistorySnapshot(snapshot: BlueprintEditorHistorySnapshot): void {
        const graph = this.getContext().services.get<UIGraphService>(Services.UIGraph);

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
        const registryService = this.getVariableRegistryService();
        if (JSON.stringify(registryService.getRegistry()) !== JSON.stringify(snapshot.registry)) {
            registryService.replaceRegistry(cloneBlueprintHistoryValue(snapshot.registry));
        }
        const saveSchemaService = this.getSaveSchemaService();
        if (JSON.stringify(saveSchemaService.getSchema()) !== JSON.stringify(snapshot.saveSchema)) {
            saveSchemaService.replaceSchema(cloneBlueprintHistoryValue(snapshot.saveSchema));
        }
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

    /**
     * Registry-variable CRUD is a thin history-wrapping delegation to the M-VAR registry service
     * (the data lives in `variables.json`, no longer in the blueprint document). Wrapping each edit in
     * a blueprint history transaction is what keeps a registry-variable change on the same undo stack
     * as the blueprint edit an author is making when they touch it - the snapshot captures the registry.
     *
     * The `saved` and `persistent` families are spelled out separately rather than parameterized by
     * scope: they differ where it matters (which node params a delete has to clear, which merge key an
     * edit coalesces under), and a single scope-taking method would have to branch on all of it anyway
     * while letting a call site pass the wrong scope by typo.
     */
    public createPersistentVariable(
        historyBlueprintId: string,
        input?: { name?: string; valueType?: string; defaultValue?: LiteralValue },
    ): VariableRegistryEntry {
        return this.runBlueprintHistoryTransaction(historyBlueprintId, () =>
            this.getVariableRegistryService().createEntry("persistent", input),
        );
    }

    public renamePersistentVariable(historyBlueprintId: string, variableId: string, name: string): void {
        this.runBlueprintHistoryTransaction(
            historyBlueprintId,
            () => this.getVariableRegistryService().renameEntry(variableId, name),
            { mergeKey: `persistent-variable-name:${variableId}` },
        );
    }

    public setPersistentVariableDefault(
        historyBlueprintId: string,
        variableId: string,
        defaultValue: LiteralValue | undefined,
    ): void {
        this.runBlueprintHistoryTransaction(
            historyBlueprintId,
            () => this.getVariableRegistryService().setEntryDefault(variableId, defaultValue),
            { mergeKey: `persistent-variable-default:${variableId}` },
        );
    }

    /**
     * Retype a persistent variable. No merge key: unlike a name or a default, a value type is picked
     * from a closed set in one gesture, so two consecutive retypes are two decisions and each deserves
     * its own undo step.
     */
    public setPersistentVariableValueType(
        historyBlueprintId: string,
        variableId: string,
        valueType: StoryVariableValueType,
        defaultValue?: LiteralValue,
    ): void {
        this.runBlueprintHistoryTransaction(historyBlueprintId, () =>
            this.getVariableRegistryService().setEntryValueType(variableId, valueType, defaultValue),
        );
    }

    /**
     * Clear every `Get`/`Set` node that named a registry variable, whichever scope declared it.
     *
     * **The derived half of a deletion, as one call, so that a machine applying an effect does the
     * same thing the author's own machine did.** Both scopes are swept rather than the one the entry
     * declared: an id belongs to exactly one entry, the node types differ between the scopes, and an
     * applier running after the entry has already left the registry has nothing left to ask.
     */
    public sweepVariableNodeRefs(variableId: string): void {
        this.applyBlueprintMutation(doc => {
            this.clearVariableNodeRefs(doc, {
                paramKey: "persistentVariableId",
                nodeTypes: [BLUEPRINT_NODE_TYPE_PERSISTENT_GET, BLUEPRINT_NODE_TYPE_PERSISTENT_SET],
                variableId,
            });
            this.clearVariableNodeRefs(doc, {
                paramKey: "savedVariableId",
                nodeTypes: [BLUEPRINT_NODE_TYPE_SAVED_GET, BLUEPRINT_NODE_TYPE_SAVED_SET],
                variableId,
            });
        });
    }

    /**
     * Remove a global variable, and the node refs that named it.
     *
     * ⚠ **Asked before anything is written**, and that order is the whole of why this is not one
     * call. A session that cannot carry the sweep refuses the deletion outright, and clearing the
     * node refs first would leave every `Get`/`Set` node empty while the variable stayed exactly
     * where it was.
     *
     * ⚠ **In a session the sweep is not done here.** It is derived from the effect - every machine
     * works out the same nodes from the same statement - so doing it alongside would be a second
     * write for work the effect already implies, and on a host a second message and a second press
     * of undo. See `LiveSessionService.applyVariableOp`.
     */
    public deletePersistentVariable(historyBlueprintId: string, variableId: string): boolean {
        const registry = this.getVariableRegistryService();
        if (!registry.canDeleteEntry()) {
            return false;
        }
        if (registry.isShared()) {
            return registry.deleteEntry(variableId);
        }
        this.runBlueprintHistoryTransaction(historyBlueprintId, () => {
            // Node-ref cleanup mutates the blueprint document; the variable itself leaves the registry.
            this.applyBlueprintMutation(doc => {
                this.clearVariableNodeRefs(doc, {
                    paramKey: "persistentVariableId",
                    nodeTypes: [BLUEPRINT_NODE_TYPE_PERSISTENT_GET, BLUEPRINT_NODE_TYPE_PERSISTENT_SET],
                    variableId,
                });
            });
            this.getVariableRegistryService().deleteEntry(variableId);
        });
        return true;
    }

    public createSavedRegistryVariable(
        historyBlueprintId: string,
        input?: { name?: string; valueType?: string; defaultValue?: LiteralValue },
    ): VariableRegistryEntry {
        return this.runBlueprintHistoryTransaction(historyBlueprintId, () =>
            this.getVariableRegistryService().createEntry("saved", input),
        );
    }

    public renameSavedRegistryVariable(historyBlueprintId: string, variableId: string, name: string): void {
        this.runBlueprintHistoryTransaction(
            historyBlueprintId,
            () => this.getVariableRegistryService().renameEntry(variableId, name),
            { mergeKey: `saved-variable-name:${variableId}` },
        );
    }

    public setSavedRegistryVariableDefault(
        historyBlueprintId: string,
        variableId: string,
        defaultValue: LiteralValue | undefined,
    ): void {
        this.runBlueprintHistoryTransaction(
            historyBlueprintId,
            () => this.getVariableRegistryService().setEntryDefault(variableId, defaultValue),
            { mergeKey: `saved-variable-default:${variableId}` },
        );
    }

    public setSavedRegistryVariableValueType(
        historyBlueprintId: string,
        variableId: string,
        valueType: StoryVariableValueType,
        defaultValue?: LiteralValue,
    ): void {
        this.runBlueprintHistoryTransaction(historyBlueprintId, () =>
            this.getVariableRegistryService().setEntryValueType(variableId, valueType, defaultValue),
        );
    }

    /**
     * Deleting a saved registry variable clears the node refs too, for the same reason the persistent
     * delete does: `Get Saved Var` / `Set Saved Var` address their variable by id through the
     * `savedVariableId` node param, so leaving one behind gives the author a node that fails at
     * runtime ("Pick a Saved variable") with nothing on screen saying why. Different param, different
     * node types, same failure - hence the shared, parameterized helper rather than a second copy.
     *
     * ⚠ Asked before anything is written, with {@link deletePersistentVariable}.
     */
    public deleteSavedRegistryVariable(historyBlueprintId: string, variableId: string): boolean {
        const registry = this.getVariableRegistryService();
        if (!registry.canDeleteEntry()) {
            return false;
        }
        if (registry.isShared()) {
            // Derived in a session, with {@link deletePersistentVariable}.
            return registry.deleteEntry(variableId);
        }
        this.runBlueprintHistoryTransaction(historyBlueprintId, () => {
            this.applyBlueprintMutation(doc => {
                this.clearVariableNodeRefs(doc, {
                    paramKey: "savedVariableId",
                    nodeTypes: [BLUEPRINT_NODE_TYPE_SAVED_GET, BLUEPRINT_NODE_TYPE_SAVED_SET],
                    variableId,
                });
            });
            this.getVariableRegistryService().deleteEntry(variableId);
        });
        return true;
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

    /**
     * Strip every graph node that named the deleted registry variable, project-wide.
     *
     * Scoped by node type as well as param key: the param key alone is not a safe filter, because a
     * plugin node is free to use a key of the same spelling for something else entirely.
     * `__variableValueType` goes with it - it is the picker's cached copy of the variable's type, and
     * a cached type for a variable that no longer exists is what would keep the node's pin looking
     * connectable after its identity was cleared.
     */
    private clearVariableNodeRefs(
        doc: BlueprintDocument,
        target: { paramKey: string; nodeTypes: readonly string[]; variableId: string },
    ): void {
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
                        target.nodeTypes.includes(node.type) &&
                        node.params?.[target.paramKey] === target.variableId
                    ) {
                        const next = { ...(node.params ?? {}) };
                        delete next[target.paramKey];
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
            const graphs = bp.program.graphs;
            const prev = graphs.events[eventId];
            const graphIr = ensureBlueprintEventGraphIrStructure(prev?.graph ?? undefined, () => uuid.generate());
            const next: BlueprintEventGraph = {
                id: eventId,
                name: displayName ?? prev?.name,
                graph: graphIr,
                meta: prev?.meta,
            };
            graphs.events[eventId] = next;
            // A new layer joins the end of the author's list; an upsert of an existing one
            // keeps its place, because the reconciliation only appends what is unlisted.
            captureBlueprintEventOrder(graphs);
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
            captureBlueprintEventOrder(bp.program.graphs);
        });
    }

    public listEventGraphIds(blueprintId: string): string[] {
        const bp = this.getBlueprintDocument().blueprints[blueprintId];
        if (!bp || bp.program.kind !== "graph") {
            return [];
        }
        return listBlueprintEventIds(bp.program.graphs);
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
            const graphs = bp.program.graphs;
            const prev = graphs.functions[functionId];
            const graphIr = ensureBlueprintFunctionGraphIrStructure(prev?.graph ?? undefined, () => uuid.generate());
            const next: BlueprintFunctionGraph = {
                id: functionId,
                name: displayName ?? prev?.name,
                graph: graphIr,
                meta: prev?.meta,
            };
            graphs.functions[functionId] = next;
            captureBlueprintFunctionOrder(graphs);
        });
    }

    public removeFunctionGraph(blueprintId: string, functionId: string): void {
        this.applyBlueprintEdit({ blueprintId }, doc => {
            const bp = doc.blueprints[blueprintId];
            if (!bp || bp.program.kind !== "graph") {
                return;
            }
            delete bp.program.graphs.functions[functionId];
            captureBlueprintFunctionOrder(bp.program.graphs);
        });
    }

    public listFunctionGraphIds(blueprintId: string): string[] {
        const bp = this.getBlueprintDocument().blueprints[blueprintId];
        if (!bp || bp.program.kind !== "graph") {
            return [];
        }
        return listBlueprintFunctionIds(bp.program.graphs);
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

    /**
     * Where a script blueprint's file is, or null when it is not a script blueprint.
     *
     * There is no matching setter for its TEXT, and that absence is the model: the file is the
     * author's, edited in their own editor, and a service that could write it back would undo an
     * edit made outside Studio the next time anything saved. This service moved a whole directory
     * out of its own reach to make that impossible - see `@shared/project/scriptsDirectory`.
     */
    public getScriptRef(blueprintId: string): string | null {
        const bp = this.getBlueprintDocument().blueprints?.[blueprintId];
        return bp?.program.kind === "scriptModule" ? bp.program.scriptRef : null;
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
