import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { DevModeWidgetRuntimePatch } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";

export type WidgetPatchesByScope = Record<string, Record<string, DevModeWidgetRuntimePatch>>;

export function mergeWidgetRuntimePatch(
    current: WidgetPatchesByScope,
    runtimeScopeId: string,
    elementId: string,
    patch: DevModeWidgetRuntimePatch,
): WidgetPatchesByScope {
    return {
        ...current,
        [runtimeScopeId]: {
            ...(current[runtimeScopeId] ?? {}),
            [elementId]: {
                ...(current[runtimeScopeId]?.[elementId] ?? {}),
                ...patch,
            },
        },
    };
}

export function applyWidgetRuntimePatch(input: {
    setWidgetPatchesByScope: Dispatch<SetStateAction<WidgetPatchesByScope>>;
    widgetPatchesByScopeRef: MutableRefObject<WidgetPatchesByScope>;
    runtimeScopeId: string;
    elementId: string;
    patch: DevModeWidgetRuntimePatch;
}): void {
    const next = mergeWidgetRuntimePatch(
        input.widgetPatchesByScopeRef.current,
        input.runtimeScopeId,
        input.elementId,
        input.patch,
    );
    input.widgetPatchesByScopeRef.current = next;
    input.setWidgetPatchesByScope(next);
}
