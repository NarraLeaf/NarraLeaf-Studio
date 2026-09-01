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
import { uiOwningSurfaceIds } from "@shared/live/uiParts";
import { decodeBlueprintOwnerKey } from "@shared/blueprint/ownerKey";

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
            // Decoded rather than matched with a pattern. Every part of an owner key is escaped, so a
            // built-in surface - whose id contains the separator - comes back from a regex still
            // escaped, never matches a real surface id, and is reported deleted on every pass.
            const owner = decodeBlueprintOwnerKey(key);
            if (owner?.kind === "surfaceMain" && !surfaceIds.has(owner.surfaceId)) {
                localBp.removeSurfaceAndWidgetOwners(owner.surfaceId);
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
            // Decoded, for the reason above and for a sharper one: these ids are handed straight
            // back to a remover that re-encodes them. An id taken off an escaped key and escaped a
            // second time names nothing, so an orphaned record on a built-in surface was never
            // collected - it was looked for under a name it could not have.
            const owner = decodeBlueprintOwnerKey(key);
            if (owner?.kind === "widgetMain" && !validWidgetKeys.has(key)) {
                localBp.removeWidgetMain(owner.surfaceId, owner.elementId);
            }
            if (owner?.kind === "componentWidgetMain" && !validComponentWidgetKeys.has(key)) {
                localBp.removeComponentWidgetMain(owner.componentId, owner.elementId);
            }
            const widgetValue = decodeWidgetValueOwnerKey(key);
            if (widgetValue && !validWidgetValueKeys.has(key)) {
                localBp.removeWidgetValueBlueprint(widgetValue.surfaceId, widgetValue.elementId, widgetValue.propPath);
            }
        }
    }

}

/**
 * The Surface every element belongs to, for the whole document, in one pass.
 *
 * ⚠ **Shared with a live session's digests rather than owned here**, and the two must go on being
 * one walk. A session fingerprints one Surface with its whole tree, and this reconciliation decides
 * which Surface a widget's private blueprint belongs to; two implementations of "which Surface is
 * this element under" would be two answers, and the one a digest disagreed over would eject a
 * machine from the room over a document nothing was wrong with.
 */
export const resolveOwningSurfaceIds = uiOwningSurfaceIds;
