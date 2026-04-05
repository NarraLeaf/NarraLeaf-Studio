import type { UIElement, UIDocument } from "@shared/types/ui-editor/document";
import { Service } from "../Service";
import { Services, IUIBlueprintLifecycleCoordinator, WorkspaceContext } from "../services";
import { UIDocumentService } from "./UIDocumentService";
import { LocalBlueprintService } from "./LocalBlueprintService";
import { widgetMainOwnerKey } from "./blueprint/ownerKeys";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";

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
        for (const surface of doc.surfaces) {
            for (const [elementId, el] of Object.entries(doc.elements)) {
                if (elementId === surface.rootElementId) {
                    continue;
                }
                if (this.owningSurfaceId(elementId, doc) !== surface.id) {
                    continue;
                }
                const mod = widgetModuleRegistry.get(el.type);
                if (!mod?.supportsBlueprintLogic) {
                    continue;
                }
                localBp.ensureWidgetMain(surface.id, elementId, el.name);
                validWidgetKeys.add(widgetMainOwnerKey(surface.id, elementId));
            }
        }

        for (const key of [...Object.keys(localBp.getBlueprintDocument().ownerRecords)]) {
            const m = /^widgetMain:([^:]+):(.+)$/.exec(key);
            if (m && !validWidgetKeys.has(key)) {
                localBp.removeWidgetMain(m[1], m[2]);
            }
        }
    }

    private owningSurfaceId(elementId: string, doc: UIDocument): string | null {
        let cur: string | null = elementId;
        while (cur) {
            const el: UIElement | undefined = doc.elements[cur];
            if (!el) {
                return null;
            }
            if (el.parentId === null) {
                const surf = doc.surfaces.find(s => s.rootElementId === cur);
                return surf?.id ?? null;
            }
            cur = el.parentId;
        }
        return null;
    }
}
