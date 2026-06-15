import { useCallback, useMemo } from "react";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import type { PropertyFieldBindingMeta } from "./bindingMeta";
import { useOpenBlueprintTarget } from "@/apps/workspace/modules/blueprint-lite/hooks/useOpenBlueprintTarget";
import { useBlueprintDocumentRevision } from "@/apps/workspace/modules/blueprint-lite/hooks/useBlueprintDocumentRevision";
import { buildDefaultSurfaceStateKeyForWidgetProp } from "@/lib/workspace/services/ui-editor/blueprint/defaultFieldKeys";
import type { BlueprintFieldValueSource } from "@shared/types/blueprint/document";

export type FieldStateScope = "surface" | "global";

export type PropertyBindingUiStatus = "literal" | "bound" | "broken";

export type PropertyBindingState = {
    status: PropertyBindingUiStatus;
    /** When bound or broken, field display name if it still exists. */
    fieldLabel: string | null;
    /** Resolved state key for the bound field, when applicable. */
    stateKey: string | null;
    /** Which scope the bound field's value source targets. */
    stateScope: FieldStateScope | null;
    /** @deprecated Use stateKey instead. */
    surfaceStateKey: string | null;
    brokenReason: string | undefined;
    canBind: boolean;
    uiLocked: boolean;
    /** Fields on the widget main blueprint, sorted by name (for bind picker). */
    fieldCandidates: { id: string; name: string }[];
    bindToExistingField: (fieldId: string) => void;
    createAndBindWithName: (name: string, scope?: FieldStateScope) => void;
    unbind: () => void;
    goToField: () => void;
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
                fieldName: null as string | null,
                stateKey: null as string | null,
                stateScope: null as FieldStateScope | null,
            };
        }
        const localBp = context.services.get<LocalBlueprintService>(Services.LocalBlueprint);
        const blueprintId = localBp.getWidgetMainBlueprintId(surfaceId, elementId);
        if (!blueprintId) {
            return { blueprintId: undefined, binding: undefined, fieldName: null, stateKey: null, stateScope: null };
        }
        const b = localBp.findWidgetPropBinding(blueprintId, surfaceId, elementId, bindingMeta.propPath);
        const doc = localBp.getBlueprintDocument();
        const bp = doc.blueprints[blueprintId];
        const fieldId = b?.source.kind === "field" ? b.source.fieldId : undefined;
        const field = fieldId ? bp?.members?.fields?.[fieldId] : undefined;
        const vs = field?.valueSource;
        let stateKey: string | null = null;
        let stateScope: FieldStateScope | null = null;
        if (vs?.kind === "surfaceState") {
            stateKey = vs.key ?? null;
            stateScope = "surface";
        } else if (vs?.kind === "globalState") {
            stateKey = vs.key ?? null;
            stateScope = "global";
        }
        return {
            blueprintId,
            binding: b,
            fieldName: field?.name ?? null,
            stateKey,
            stateScope,
        };
    }, [bindingMeta.propPath, context, elementId, isInitialized, revision, surfaceId]);

    const status: PropertyBindingUiStatus = useMemo(() => {
        if (!snapshot.binding) {
            return "literal";
        }
        if (snapshot.binding.status === "broken") {
            return "broken";
        }
        if (!snapshot.fieldName && snapshot.binding.source.kind === "field") {
            return "broken";
        }
        return "bound";
    }, [snapshot.binding, snapshot.fieldName]);

    const fieldCandidates = useMemo(() => {
        if (!isInitialized || !context || !snapshot.blueprintId) {
            return [];
        }
        const localBp = context.services.get<LocalBlueprintService>(Services.LocalBlueprint);
        const list = localBp.listFields(snapshot.blueprintId);
        return [...list]
            .map(f => ({ id: f.id, name: f.name }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [context, isInitialized, revision, snapshot.blueprintId]);

    const bindToExistingField = useCallback(
        (fieldId: string) => {
            if (!isInitialized || !context || !surfaceId || !snapshot.blueprintId || !fieldId) {
                return;
            }
            const localBp = context.services.get<LocalBlueprintService>(Services.LocalBlueprint);
            const fallback = bindingMeta.readLiteral(data);
            localBp.setWidgetPropBinding({
                blueprintId: snapshot.blueprintId,
                surfaceId,
                elementId,
                propPath: bindingMeta.propPath,
                fieldId,
                fallback: fallback as string | number | boolean | null,
            });
        },
        [bindingMeta, context, data, elementId, isInitialized, snapshot.blueprintId, surfaceId],
    );

    const createAndBindWithName = useCallback(
        (name: string, scope: FieldStateScope = "surface") => {
            const trimmed = name.trim();
            if (!isInitialized || !context || !surfaceId || !snapshot.blueprintId || !trimmed) {
                return;
            }
            const localBp = context.services.get<LocalBlueprintService>(Services.LocalBlueprint);
            const stateKey = buildDefaultSurfaceStateKeyForWidgetProp({
                elementId,
                propPath: bindingMeta.propPath,
            });
            const valueSource: BlueprintFieldValueSource =
                scope === "global"
                    ? { kind: "globalState", key: stateKey }
                    : { kind: "surfaceState", key: stateKey };
            const field = localBp.createField(snapshot.blueprintId, {
                name: trimmed,
                kind: "constant",
                valueSource,
            });
            const fallback = bindingMeta.readLiteral(data);
            localBp.setWidgetPropBinding({
                blueprintId: snapshot.blueprintId,
                surfaceId,
                elementId,
                propPath: bindingMeta.propPath,
                fieldId: field.id,
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

    const goToField = useCallback(() => {
        if (!surfaceId || !snapshot.blueprintId || snapshot.binding?.source.kind !== "field") {
            return;
        }
        openTarget({
            blueprintId: snapshot.blueprintId,
            ownerKind: "widgetMain",
            surfaceId,
            elementId,
            focusFieldId: snapshot.binding.source.fieldId,
            title: `Blueprint · ${data.element.name ?? data.element.type}`,
        });
    }, [data.element.name, data.element.type, openTarget, snapshot.binding, snapshot.blueprintId, surfaceId, elementId]);

    const uiLocked = status === "bound";

    return {
        status,
        fieldLabel: snapshot.fieldName,
        stateKey: snapshot.stateKey,
        stateScope: snapshot.stateScope,
        surfaceStateKey: snapshot.stateScope === "surface" ? snapshot.stateKey : null,
        brokenReason: snapshot.binding?.brokenReason,
        canBind: Boolean(surfaceId && snapshot.blueprintId),
        uiLocked,
        fieldCandidates,
        bindToExistingField,
        createAndBindWithName,
        unbind,
        goToField,
    };
}
