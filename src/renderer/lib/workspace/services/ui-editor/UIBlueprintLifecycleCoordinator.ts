import type { UIElement, UIDocument } from "@shared/types/ui-editor/document";
import { Service } from "../Service";
import { Services, IUIBlueprintLifecycleCoordinator, WorkspaceContext } from "../services";
import { UIDocumentService } from "./UIDocumentService";
import { LocalBlueprintService } from "./LocalBlueprintService";
import {
    componentWidgetMainOwnerKey,
    decodeWidgetValueOwnerKey,
    widgetMainOwnerKey,
    widgetValueOwnerKey,
} from "./blueprint/ownerKeys";
import { getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";

/**
 * Keeps local instance BlueprintDocument (in uigraphs.json) aligned with UIDocument surfaces and widgets.
 */
export class UIBlueprintLifecycleCoordinator
    extends Service<UIBlueprintLifecycleCoordinator>
    implements IUIBlueprintLifecycleCoordinator
{
    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const uidoc = ctx.services.get<UIDocumentService>(Services.UIDocument);
        const bp = ctx.services.get<LocalBlueprintService>(Services.LocalBlueprint);
        await depend([uidoc, bp]);
    }

    public activate(ctx: WorkspaceContext): void {
        const uidoc = ctx.services.get<UIDocumentService>(Services.UIDocument);
        uidoc.setAfterMutateHook(() => {
            try {
                this.syncFromUidoc();
            } catch (err) {
                console.warn("[UIBlueprintLifecycleCoordinator] sync failed", err);
            }
        });
        this.syncFromUidoc();
    }

    public dispose(ctx: WorkspaceContext): void {
        const uidoc = ctx.services.get<UIDocumentService>(Services.UIDocument);
        uidoc.setAfterMutateHook(null);
    }

    public syncFromUidoc(): void {
        const uidoc = this.getContext().services.get<UIDocumentService>(Services.UIDocument);
        const localBp = this.getContext().services.get<LocalBlueprintService>(Services.LocalBlueprint);
        const doc = uidoc.getDocument();
        const surfaceIds = new Set(doc.surfaces.map(s => s.id));

        const bpDoc = localBp.getBlueprintDocument();
        for (const key of [...Object.keys(bpDoc.ownerRecords)]) {
            const m = /^surfaceMain:(.+)$/.exec(key);
            if (m && !surfaceIds.has(m[1])) {
                localBp.removeSurfaceAndWidgetOwners(m[1]);
            }
        }

        for (const surface of doc.surfaces) {
            localBp.ensureSurfaceMain(surface.id, surface.name);
        }

        const validWidgetKeys = new Set<string>();
        const validWidgetValueKeys = new Set<string>();
        const validComponentWidgetKeys = new Set<string>();
        // One pass over the elements, with each element's owning surface resolved once. This used to
        // be a surface-by-element nested loop that re-walked every element's parent chain for every
        // surface - and it runs after *every* uidoc mutation, so the cost of nudging one button grew
        // with the square of the project. Adding pages from the template store is what makes that
        // visible.
        const owningSurfaceIds = resolveOwningSurfaceIds(doc);
        for (const [elementId, el] of Object.entries(doc.elements)) {
            const surfaceId = owningSurfaceIds.get(elementId);
            if (!surfaceId) {
                continue;
            }
            for (const propPath of Object.keys(el.valueBindings ?? {})) {
                validWidgetValueKeys.add(widgetValueOwnerKey(surfaceId, elementId, propPath));
            }
            const logicApi = getWidgetLogicApi(el.type);
            if (!logicApi?.supportsPrivateBlueprint) {
                continue;
            }
            localBp.ensureWidgetMain(surfaceId, elementId, el.name, el.type);
            validWidgetKeys.add(widgetMainOwnerKey(surfaceId, elementId));
        }
        for (const component of doc.components ?? []) {
            for (const [elementId, el] of Object.entries(component.elements)) {
                const logicApi = getWidgetLogicApi(el.type);
                if (!logicApi?.supportsPrivateBlueprint) {
                    continue;
                }
                localBp.ensureComponentWidgetMain(component.id, elementId, el.name, el.type);
                validComponentWidgetKeys.add(componentWidgetMainOwnerKey(component.id, elementId));
            }
        }

        for (const key of [...Object.keys(localBp.getBlueprintDocument().ownerRecords)]) {
            const m = /^widgetMain:([^:]+):(.+)$/.exec(key);
            if (m && !validWidgetKeys.has(key)) {
                localBp.removeWidgetMain(m[1], m[2]);
            }
            const cm = /^componentWidgetMain:([^:]+):(.+)$/.exec(key);
            if (cm && !validComponentWidgetKeys.has(key)) {
                localBp.removeComponentWidgetMain(cm[1], cm[2]);
            }
            const widgetValue = decodeWidgetValueOwnerKey(key);
            if (widgetValue && !validWidgetValueKeys.has(key)) {
                localBp.removeWidgetValueBlueprint(widgetValue.surfaceId, widgetValue.elementId, widgetValue.propPath);
            }
        }
    }

}

/**
 * The surface every element belongs to, for the whole document, in one pass.
 *
 * Each parent chain is walked at most once: the walk stops as soon as it reaches an element whose
 * answer is already known, then writes that answer back down the chain it came up. Elements that
 * reach no surface (orphans, and a parent cycle if a document is ever damaged) are simply absent.
 */
export function resolveOwningSurfaceIds(doc: UIDocument): Map<string, string> {
    const surfaceIdByRootElementId = new Map<string, string>();
    for (const surface of doc.surfaces) {
        surfaceIdByRootElementId.set(surface.rootElementId, surface.id);
    }

    const resolved = new Map<string, string | null>();
    for (const startId of Object.keys(doc.elements)) {
        if (resolved.has(startId)) {
            continue;
        }
        const chain: string[] = [];
        const onChain = new Set<string>();
        let cursor: string | null = startId;
        let answer: string | null = null;
        while (cursor) {
            if (resolved.has(cursor)) {
                answer = resolved.get(cursor) ?? null;
                break;
            }
            if (onChain.has(cursor)) {
                // A parentId cycle: nothing here belongs to a surface.
                break;
            }
            const element: UIElement | undefined = doc.elements[cursor];
            if (!element) {
                break;
            }
            chain.push(cursor);
            onChain.add(cursor);
            if (element.parentId === null) {
                answer = surfaceIdByRootElementId.get(cursor) ?? null;
                break;
            }
            cursor = element.parentId;
        }
        for (const elementId of chain) {
            resolved.set(elementId, answer);
        }
    }

    const owners = new Map<string, string>();
    for (const [elementId, surfaceId] of resolved) {
        if (surfaceId) {
            owners.set(elementId, surfaceId);
        }
    }
    return owners;
}
