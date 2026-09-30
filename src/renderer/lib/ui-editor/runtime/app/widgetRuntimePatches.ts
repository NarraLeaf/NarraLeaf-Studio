import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import {
    mergeWidgetPatch,
    type DevModeWidgetRuntimePatch,
} from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";

/**
 * The runtime patches of every scope a game is drawing, by scope and then by widget address.
 *
 * Held twice by its owner, and the two are not equals. The ref is the table: every write lands in
 * it synchronously (see {@link applyWidgetRuntimePatch}), the drawings read it first, and every
 * host API on a scope reads its widgets back out of it at the moment a graph asks. The state is
 * only what makes a write re-render, and it is always set to the object the ref already holds.
 *
 * So nothing may assign the ref *from* the state. An effect doing that runs after the commit of
 * the render that state came from - and a graph resumed in between (a `Delay` ending, a key press)
 * has already written a newer table into the ref, which the effect then quietly puts back. The
 * next write merges over the older table, and the one in between is gone from the screen for good.
 */
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
            [elementId]: mergeWidgetPatch(current[runtimeScopeId]?.[elementId], patch),
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
