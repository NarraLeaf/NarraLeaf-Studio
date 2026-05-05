import type {
    BindingDefinition,
    BlueprintDocument,
    BlueprintField,
    BlueprintFieldValueSource,
    BlueprintFrontendKind,
    BlueprintVariable,
    LiteralValue,
} from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_LOCAL_GET,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
} from "@shared/types/blueprint/graph";
import type { UIElement } from "@shared/types/ui-editor/document";
import type { UIGraphDocument } from "@shared/types/ui-editor/graph";
import { RendererError } from "@shared/utils/error";
import { Service } from "../Service";
import { Services, ILocalBlueprintService, WorkspaceContext } from "../services";
import { FileSystemService } from "../core/FileSystem";
import { ProjectService } from "../core/ProjectService";
import { UuidService } from "../core/UuidService";
import { UIGraphService } from "./UIGraphService";
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
import { surfaceMainOwnerKey, widgetMainOwnerKey } from "./blueprint/ownerKeys";
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

/**
 * Blueprint M2: mutations to local instance BlueprintDocument inside uigraphs.json.
 */
export class LocalBlueprintService extends Service<LocalBlueprintService> implements ILocalBlueprintService {
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
        const surfaceKey = surfaceMainOwnerKey(surfaceId);
        this.applyBlueprintMutation(doc => {
            const toRemoveBlueprintIds = new Set<string>();
            for (const [k, rec] of Object.entries(doc.ownerRecords)) {
                if (k === surfaceKey || k.startsWith(prefixWidget)) {
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

    public getSurfaceMainBlueprintId(surfaceId: string): string | undefined {
        const key = surfaceMainOwnerKey(surfaceId);
        return getActiveBlueprintId(this.getBlueprintDocument(), key);
    }

    public listPrivateBlueprintIdsForOwnerKey(ownerKey: string): string[] {
        const rec = this.getBlueprintDocument().ownerRecords[ownerKey];
        return rec ? [...rec.privateBlueprintIds] : [];
    }

    public setActivePrivateBlueprintForOwnerKey(ownerKey: string, blueprintId: string): void {
        this.applyBlueprintMutation(doc => {
            setPrivateOwnerActive(doc, ownerKey, blueprintId);
        });
    }

    public createSiblingPrivateBlueprintForOwnerKey(ownerKey: string, frontend: BlueprintFrontendKind): string {
        const ownerRef = parsePrivateOwnerKeyToRef(ownerKey);
        if (!ownerRef) {
            throw new RendererError(`Invalid private owner key: ${ownerKey}`);
        }
        const uuid = this.getContext().services.get<UuidService>(Services.Uuid);
        let outId = "";
        this.applyBlueprintMutation(doc => {
            const id = uuid.generate();
            const name =
                frontend === "typescript"
                    ? `Script ${id.slice(0, 6)}`
                    : `Blueprint ${id.slice(0, 6)}`;
            const blueprint =
                frontend === "typescript"
                    ? createTypeScriptMainBlueprint({ id, name, owner: ownerRef })
                    : createMainBlueprint({ id, name, owner: ownerRef });
            doc.blueprints[id] = blueprint;
            registerPrivateBlueprintAsActive(doc, ownerKey, id, frontend);
            outId = id;
        });
        return outId;
    }

    public getReadonlySurfaceMainSummary(surfaceId: string): ReadonlyBlueprintSurfaceSummary {
        return buildReadonlySurfaceMainSummary(this.getBlueprintDocument(), surfaceId);
    }

    public setFieldValueSource(
        blueprintId: string,
        fieldId: string,
        valueSource: BlueprintFieldValueSource | undefined,
    ): void {
        this.applyBlueprintMutation(doc => {
            const bp = doc.blueprints[blueprintId];
            const field = bp?.members?.fields?.[fieldId];
            if (!field) {
                return;
            }
            field.valueSource = valueSource;
        });
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
        this.applyBlueprintMutation(doc => {
            const bp = doc.blueprints[blueprintId];
            if (!bp) {
                throw new RendererError(`Blueprint not found: ${blueprintId}`);
            }
            if (bp.owner.kind === "widgetMain") {
                throw new RendererError(
                    "Widget main blueprints cannot define binding fields; define fields on global or surface main blueprints instead.",
                );
            }
            bp.members = bp.members ?? emptyMemberIndex();
            bp.members.fields[field.id] = field;
        });
        return field;
    }

    public renameField(blueprintId: string, fieldId: string, name: string): void {
        this.applyBlueprintMutation(doc => {
            const bp = doc.blueprints[blueprintId];
            const f = bp?.members?.fields?.[fieldId];
            if (!f) {
                return;
            }
            f.name = name;
        });
    }

    public deleteField(blueprintId: string, fieldId: string): void {
        this.applyBlueprintMutation(doc => {
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
        this.applyBlueprintMutation(doc => {
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
        this.applyBlueprintMutation(doc => {
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

    public createBlueprintVariable(
        blueprintId: string,
        input?: { name?: string; defaultValue?: LiteralValue },
    ): BlueprintVariable {
        const uuid = this.getContext().services.get<UuidService>(Services.Uuid);
        const id = uuid.generate();
        const v: BlueprintVariable = {
            id,
            name: input?.name?.trim() || `var_${id.slice(0, 8)}`,
            defaultValue: input?.defaultValue,
        };
        this.applyBlueprintMutation(doc => {
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
        this.applyBlueprintMutation(doc => {
            const v = doc.blueprints[blueprintId]?.members?.variables?.[variableId];
            if (!v) {
                return;
            }
            const next = name.trim();
            v.name = next.length > 0 ? next : v.name;
        });
    }

    public setBlueprintVariableDefault(
        blueprintId: string,
        variableId: string,
        defaultValue: LiteralValue | undefined,
    ): void {
        this.applyBlueprintMutation(doc => {
            const v = doc.blueprints[blueprintId]?.members?.variables?.[variableId];
            if (!v) {
                return;
            }
            v.defaultValue = defaultValue;
        });
    }

    public deleteBlueprintVariable(blueprintId: string, variableId: string): void {
        this.applyBlueprintMutation(doc => {
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
     * Ensure an inline event graph slot exists under Blueprint.program.graphs.events[eventId].
     * Upserts by eventId; preserves existing graph IR when present.
     */
    public ensureEventGraph(blueprintId: string, eventId: string, displayName?: string): void {
        this.applyBlueprintMutation(doc => {
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
        this.applyBlueprintMutation(doc => {
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
        this.applyBlueprintMutation(doc => {
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
        });
    }

    public removeEventGraph(blueprintId: string, eventId: string): void {
        this.applyBlueprintMutation(doc => {
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
        this.applyBlueprintMutation(doc => {
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
        this.applyBlueprintMutation(doc => {
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

    public updateEventGraphIr(blueprintId: string, eventId: string, updater: (ir: BlueprintGraphIr) => void): void {
        this.applyBlueprintMutation(doc => {
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
        });
    }

    public updateFunctionGraphIr(
        blueprintId: string,
        functionId: string,
        updater: (ir: BlueprintGraphIr) => void,
    ): void {
        this.applyBlueprintMutation(doc => {
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
        });
    }

    public updateScriptModuleSource(blueprintId: string, code: string): void {
        this.applyBlueprintMutation(doc => {
            const bp = doc.blueprints[blueprintId];
            if (!bp || bp.program.kind !== "scriptModule") {
                return;
            }
            bp.program.source.code = code;
            bp.program.source.diagnostics = undefined;
        });
    }

    public getReadonlyWidgetMainSummary(surfaceId: string, element: UIElement): ReadonlyBlueprintWidgetSummary {
        return buildReadonlyWidgetMainSummary(this.getBlueprintDocument(), surfaceId, element);
    }

    /** Rules-only remap plan for duplicating a widget subtree (no UI). */
    public planSubtreeDuplicateBlueprintRemap(input: {
        surfaceId: string;
        oldElementIds: string[];
        generateId: () => string;
    }): SubtreeDuplicateRemapPlan {
        const { surfaceId } = input;
        return planSubtreeDuplicateBlueprintRemap({
            oldElementIds: input.oldElementIds,
            generateId: input.generateId,
            getWidgetMainBlueprintId: (elementId: string) => this.getWidgetMainBlueprintId(surfaceId, elementId),
        });
    }

}
