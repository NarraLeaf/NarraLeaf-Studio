import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { DevModeWidgetRuntimePatch } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";

export type WidgetPatchesByScope = Record<string, Record<string, DevModeWidgetRuntimePatch>>;

/**
 * Two patches for one drawing, later winning.
 *
 * `props` is merged rather than replaced: each write states only the properties it changed, and a
 * shallow spread would drop everything an earlier write had put there. Every other field is one
 * fact, so last-writer-wins is what they mean.
 */
function mergeOnePatch(
    previous: DevModeWidgetRuntimePatch | undefined,
    patch: DevModeWidgetRuntimePatch,
): DevModeWidgetRuntimePatch {
    const merged: DevModeWidgetRuntimePatch = { ...(previous ?? {}), ...patch };
    if (previous?.props || patch.props) {
        merged.props = { ...(previous?.props ?? {}), ...(patch.props ?? {}) };
    }
    return merged;
}

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
            [elementId]: mergeOnePatch(current[runtimeScopeId]?.[elementId], patch),
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
