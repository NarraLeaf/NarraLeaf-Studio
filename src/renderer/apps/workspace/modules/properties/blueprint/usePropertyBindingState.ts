import { useCallback, useMemo } from "react";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import type { PropertyFieldBindingMeta } from "./bindingMeta";
import { useOpenBlueprintTarget } from "@/apps/workspace/modules/blueprint-lite/hooks/useOpenBlueprintTarget";
import { useBlueprintDocumentRevision } from "@/apps/workspace/modules/blueprint-lite/hooks/useBlueprintDocumentRevision";

export type PropertyBindingUiStatus = "literal" | "bound" | "broken";

export type PropertyBindingState = {
    status: PropertyBindingUiStatus;
    /** When bound or broken, declaration display name if it still exists. */
    declarationLabel: string | null;
    brokenReason: string | undefined;
    canBind: boolean;
    uiLocked: boolean;
    /** Declarations on the widget main blueprint, sorted by name (for bind picker). */
    declarationCandidates: { id: string; name: string }[];
    bindToExistingDeclaration: (declarationId: string) => void;
    createAndBindWithName: (name: string) => void;
    unbind: () => void;
    goToDeclaration: () => void;
};

export function usePropertyBindingState(
    data: UIInspectorData,
    bindingMeta: PropertyFieldBindingMeta,
): PropertyBindingState {
    const { context, isInitialized } = useWorkspace();
    const openTarget = useOpenBlueprintTarget();
    const revision = useBlueprintDocumentRevision();

    const surfaceId = data.surfaceId;
    const elementId = data.element.id;

    const snapshot = useMemo(() => {
        if (!isInitialized || !context || !surfaceId) {
            return {
                blueprintId: undefined as string | undefined,
                binding: undefined as ReturnType<LocalBlueprintService["findWidgetPropBinding"]>,
                declName: null as string | null,
            };
        }
        const localBp = context.services.get<LocalBlueprintService>(Services.LocalBlueprint);
        const blueprintId = localBp.getWidgetMainBlueprintId(surfaceId, elementId);
        if (!blueprintId) {
            return { blueprintId: undefined, binding: undefined, declName: null };
        }
        const b = localBp.findWidgetPropBinding(blueprintId, surfaceId, elementId, bindingMeta.propPath);
        const doc = localBp.getBlueprintDocument();
        const bp = doc.blueprints[blueprintId];
        const declId = b?.source.kind === "declaration" ? b.source.declarationId : undefined;
        const decl = declId ? bp?.members?.declarations?.[declId] : undefined;
        return {
            blueprintId,
            binding: b,
            declName: decl?.name ?? null,
        };
    }, [bindingMeta.propPath, context, elementId, isInitialized, revision, surfaceId]);

    const status: PropertyBindingUiStatus = useMemo(() => {
        if (!snapshot.binding) {
            return "literal";
        }
        if (snapshot.binding.status === "broken") {
            return "broken";
        }
        if (!snapshot.declName && snapshot.binding.source.kind === "declaration") {
            return "broken";
        }
        return "bound";
    }, [snapshot.binding, snapshot.declName]);

    const declarationCandidates = useMemo(() => {
        if (!isInitialized || !context || !snapshot.blueprintId) {
            return [];
        }
        const localBp = context.services.get<LocalBlueprintService>(Services.LocalBlueprint);
        const list = localBp.listDeclarations(snapshot.blueprintId);
        return [...list]
            .map(d => ({ id: d.id, name: d.name }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [context, isInitialized, revision, snapshot.blueprintId]);

    const bindToExistingDeclaration = useCallback(
        (declarationId: string) => {
            if (!isInitialized || !context || !surfaceId || !snapshot.blueprintId || !declarationId) {
                return;
            }
            const localBp = context.services.get<LocalBlueprintService>(Services.LocalBlueprint);
            const fallback = bindingMeta.readLiteral(data);
            localBp.setWidgetPropBinding({
                blueprintId: snapshot.blueprintId,
                surfaceId,
                elementId,
                propPath: bindingMeta.propPath,
                declarationId,
                fallback: fallback as string | number | boolean | null,
            });
        },
        [bindingMeta, context, data, elementId, isInitialized, snapshot.blueprintId, surfaceId],
    );

    const createAndBindWithName = useCallback(
        (name: string) => {
            const trimmed = name.trim();
            if (!isInitialized || !context || !surfaceId || !snapshot.blueprintId || !trimmed) {
                return;
            }
            const localBp = context.services.get<LocalBlueprintService>(Services.LocalBlueprint);
            const decl = localBp.createDeclaration(snapshot.blueprintId, {
                name: trimmed,
                kind: "constant",
                valueSource: { kind: "surfaceState", key: bindingMeta.propPath },
            });
            const fallback = bindingMeta.readLiteral(data);
            localBp.setWidgetPropBinding({
                blueprintId: snapshot.blueprintId,
                surfaceId,
                elementId,
                propPath: bindingMeta.propPath,
                declarationId: decl.id,
                fallback: fallback as string | number | boolean | null,
            });
        },
        [bindingMeta, context, data, elementId, isInitialized, snapshot.blueprintId, surfaceId],
    );

    const unbind = useCallback(() => {
        if (!isInitialized || !context || !surfaceId || !snapshot.blueprintId) {
            return;
        }
        const localBp = context.services.get<LocalBlueprintService>(Services.LocalBlueprint);
        localBp.clearWidgetPropBinding(snapshot.blueprintId, surfaceId, elementId, bindingMeta.propPath);
    }, [bindingMeta.propPath, context, elementId, isInitialized, snapshot.blueprintId, surfaceId]);

    const goToDeclaration = useCallback(() => {
        if (!surfaceId || !snapshot.blueprintId || snapshot.binding?.source.kind !== "declaration") {
            return;
        }
        openTarget({
            blueprintId: snapshot.blueprintId,
            ownerKind: "widgetMain",
            surfaceId,
            elementId,
            focusDeclarationId: snapshot.binding.source.declarationId,
            title: `Blueprint · ${data.element.name ?? data.element.type}`,
        });
    }, [data.element.name, data.element.type, openTarget, snapshot.binding, snapshot.blueprintId, surfaceId, elementId]);

    const uiLocked = status === "bound";

    return {
        status,
        declarationLabel: snapshot.declName,
        brokenReason: snapshot.binding?.brokenReason,
        canBind: Boolean(surfaceId && snapshot.blueprintId),
        uiLocked,
        declarationCandidates,
        bindToExistingDeclaration,
        createAndBindWithName,
        unbind,
        goToDeclaration,
    };
}
