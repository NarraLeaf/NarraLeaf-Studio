import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";
import type { UIElement, UILayout } from "@shared/types/ui-editor/document";
import { evaluateFieldValue } from "@/lib/workspace/services/ui-editor/blueprint/fieldEvaluation";
import type { SurfaceStateStore } from "./SurfaceStateStore";
import type { BindingDebugCoalescer } from "./BindingDebugCoalescer";
import { isAppearanceCapableElementType } from "./appearanceCapableWidgets";

function coerceLayoutField(key: keyof UILayout, value: unknown): unknown {
    if (key === "visible" || key === "lockAspectRatio") {
        return Boolean(value);
    }
    if (key === "opacity") {
        const n = Number(value);
        return Number.isFinite(n) ? n : value;
    }
    if (key === "width" || key === "height" || key === "x" || key === "y" || key === "rotation") {
        const n = Number(value);
        return Number.isFinite(n) ? n : value;
    }
    return value;
}

function applyWidgetPropPath(element: UIElement, propPath: string, value: unknown): void {
    if (propPath.startsWith("layout.")) {
        const sub = propPath.slice("layout.".length) as keyof UILayout;
        const coerced = coerceLayoutField(sub, value);
        element.layout = { ...element.layout, [sub]: coerced } as UILayout;
        return;
    }
    element.props = { ...(element.props ?? {}), [propPath]: value };
}

/**
 * Clone element and apply active widgetProp bindings for this surface using surface state + fields.
 */
export function mergeElementWithBlueprintBindings(
    element: UIElement,
    surfaceId: string,
    blueprintDocument: BlueprintDocument,
    surfaceState: SurfaceStateStore,
    emitDebug: (event: BlueprintDebugEvent) => void,
    coalescer?: BindingDebugCoalescer,
): UIElement {
    const next: UIElement = {
        ...element,
        layout: { ...element.layout },
        props: element.props ? { ...element.props } : {},
    };

    const skipWidgetPropMerge = isAppearanceCapableElementType(next.type);

    for (const bp of Object.values(blueprintDocument.blueprints)) {
        if (!bp.bindings) {
            continue;
        }
        for (const bind of Object.values(bp.bindings)) {
            if (bind.target.kind !== "widgetProp") {
                continue;
            }
            if (bind.target.surfaceId !== surfaceId || bind.target.elementId !== element.id) {
                continue;
            }
            if (skipWidgetPropMerge) {
                continue;
            }
            if (bind.status === "broken") {
                continue;
            }
            if (bind.source.kind !== "field") {
                continue;
            }
            const srcBp = blueprintDocument.blueprints[bind.source.blueprintId];
            const field = srcBp?.members?.fields?.[bind.source.fieldId];
            const vs = field?.valueSource;
            if (vs?.kind === "surfaceState") {
                const raw = surfaceState.get(vs.key);
                if (!coalescer || coalescer.shouldEmitStateRead(vs.key, raw)) {
                    emitDebug({ type: "state.read", scope: "surface", key: vs.key });
                }
            }

            const evaluated = evaluateFieldValue(field, surfaceState);
            const hasSource = Boolean(field?.valueSource);
            const resolved = hasSource && evaluated !== undefined ? evaluated : bind.fallback;
            if (resolved === undefined) {
                continue;
            }
            applyWidgetPropPath(next, bind.target.propPath, resolved);
            if (!coalescer || coalescer.shouldEmitBindingEval(bind.id, resolved)) {
                emitDebug({ type: "binding.evaluated", bindingId: bind.id });
            }
        }
    }

    return next;
}
