import type { BindingDefinition, BlueprintDeclaration, BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIElement } from "@shared/types/ui-editor/document";
import type { UIGraphDocument } from "@shared/types/ui-editor/graph";
import { RendererError } from "@shared/utils/error";
import { Service } from "../Service";
import { Services, ILocalBlueprintService, WorkspaceContext } from "../services";
import { FileSystemService } from "../core/FileSystem";
import { ProjectService } from "../core/ProjectService";
import { UuidService } from "../core/UuidService";
import { UIGraphService } from "./UIGraphService";
import { createMainBlueprint, emptyMemberIndex } from "./blueprint/blueprintFactories";
import { assertValidBlueprintDocument } from "./blueprint/documentValidation";
import type { BlueprintEventGraph } from "@shared/types/blueprint/document";
import { planSubtreeDuplicateBlueprintRemap, type SubtreeDuplicateRemapPlan } from "./blueprint/blueprintCopyRemap";
import {
    buildReadonlyWidgetMainSummary,
    type ReadonlyBlueprintWidgetSummary,
} from "./blueprint/readonlyBlueprintSummary";
import { surfaceMainOwnerKey, widgetMainOwnerKey } from "./blueprint/ownerKeys";

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
            const existing = doc.ownerIndex[key];
            if (existing && doc.blueprints[existing]) {
                outId = existing;
                if (displayName !== undefined) {
                    doc.blueprints[existing].name = displayName;
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
            doc.ownerIndex[key] = id;
            outId = id;
        });
        return outId;
    }

    public removeSurfaceAndWidgetOwners(surfaceId: string): void {
        const prefixWidget = `widgetMain:${surfaceId}:`;
        const surfaceKey = surfaceMainOwnerKey(surfaceId);
        this.applyBlueprintMutation(doc => {
            const toRemoveBlueprintIds = new Set<string>();
            for (const [k, bid] of Object.entries(doc.ownerIndex)) {
                if (k === surfaceKey || k.startsWith(prefixWidget)) {
                    toRemoveBlueprintIds.add(bid);
                    delete doc.ownerIndex[k];
                }
            }
            for (const id of toRemoveBlueprintIds) {
                delete doc.blueprints[id];
            }
            this.stripBindingsForSurface(doc, surfaceId);
        });
    }

    public ensureWidgetMain(surfaceId: string, elementId: string, displayName?: string): string {
        const uuid = this.getContext().services.get<UuidService>(Services.Uuid);
        const key = widgetMainOwnerKey(surfaceId, elementId);
        let outId = "";
        this.applyBlueprintMutation(doc => {
            const existing = doc.ownerIndex[key];
            if (existing && doc.blueprints[existing]) {
                outId = existing;
                if (displayName !== undefined) {
                    doc.blueprints[existing].name = displayName ?? doc.blueprints[existing].name;
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
            doc.ownerIndex[key] = id;
            outId = id;
        });
        return outId;
    }

    public removeWidgetMain(surfaceId: string, elementId: string): void {
        const key = widgetMainOwnerKey(surfaceId, elementId);
        this.applyBlueprintMutation(doc => {
            const bid = doc.ownerIndex[key];
            if (bid) {
                delete doc.blueprints[bid];
                delete doc.ownerIndex[key];
            }
            this.stripBindingsForElement(doc, surfaceId, elementId);
        });
    }

    public getWidgetMainBlueprintId(surfaceId: string, elementId: string): string | undefined {
        const key = widgetMainOwnerKey(surfaceId, elementId);
        return this.getBlueprintDocument().ownerIndex[key];
    }

    public createDeclaration(
        blueprintId: string,
        input: { name: string; kind?: BlueprintDeclaration["kind"] },
    ): BlueprintDeclaration {
        const uuid = this.getContext().services.get<UuidService>(Services.Uuid);
        const decl: BlueprintDeclaration = {
            id: uuid.generate(),
            name: input.name,
            kind: input.kind ?? "constant",
        };
        this.applyBlueprintMutation(doc => {
            const bp = doc.blueprints[blueprintId];
            if (!bp) {
                throw new RendererError(`Blueprint not found: ${blueprintId}`);
            }
            bp.members = bp.members ?? emptyMemberIndex();
            bp.members.declarations[decl.id] = decl;
        });
        return decl;
    }

    public renameDeclaration(blueprintId: string, declarationId: string, name: string): void {
        this.applyBlueprintMutation(doc => {
            const bp = doc.blueprints[blueprintId];
            const d = bp?.members?.declarations?.[declarationId];
            if (!d) {
                return;
            }
            d.name = name;
        });
    }

    public deleteDeclaration(blueprintId: string, declarationId: string): void {
        this.applyBlueprintMutation(doc => {
            const bp = doc.blueprints[blueprintId];
            if (!bp?.members?.declarations?.[declarationId]) {
                return;
            }
            delete bp.members.declarations[declarationId];
            for (const bind of Object.values(bp.bindings ?? {})) {
                if (
                    bind.source.kind === "declaration" &&
                    bind.source.blueprintId === blueprintId &&
                    bind.source.declarationId === declarationId
                ) {
                    bind.status = "broken";
                    bind.brokenReason = "declaration_removed";
                }
            }
        });
    }

    public setWidgetPropBinding(params: {
        blueprintId: string;
        surfaceId: string;
        elementId: string;
        propPath: string;
        declarationId: string;
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
                        kind: "declaration",
                        blueprintId: params.blueprintId,
                        declarationId: params.declarationId,
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
                    kind: "declaration",
                    blueprintId: params.blueprintId,
                    declarationId: params.declarationId,
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

    /** List declarations for a widget main blueprint (for minimal inspector). */
    public listDeclarations(blueprintId: string): BlueprintDeclaration[] {
        const m = this.getBlueprintDocument().blueprints[blueprintId]?.members?.declarations;
        return m ? Object.values(m) : [];
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
            const prev = bp.program.graphs.events[eventId];
            const graphIr = prev?.graph ?? { nodes: {}, edges: [], entries: {} };
            const next: BlueprintEventGraph = {
                id: eventId,
                name: displayName ?? prev?.name,
                graph: graphIr,
                meta: prev?.meta,
            };
            bp.program.graphs.events[eventId] = next;
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
