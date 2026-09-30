import type { BindingDefinition, BlueprintDocument } from "@shared/types/blueprint/document";
import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";
import type { UIElement, UILayout } from "@shared/types/ui-editor/document";
import type { UIListElementExtra, UIListItemScope } from "@shared/types/ui-editor/list";
import { evaluateFieldValue } from "@/lib/workspace/services/ui-editor/blueprint/fieldEvaluation";
import type { BlueprintStateReader } from "@/lib/workspace/services/ui-editor/blueprint/fieldEvaluation";
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
    if (propPath === "variant") {
        const variantId = typeof value === "string" ? value.trim() : "";
        element.extra = {
            ...(element.extra ?? {}),
            runtimeVariantOverrideId: variantId || undefined,
        } satisfies UIListElementExtra;
        return;
    }
    if (propPath.startsWith("layout.")) {
        const sub = propPath.slice("layout.".length) as keyof UILayout;
        const coerced = coerceLayoutField(sub, value);
        element.layout = { ...element.layout, [sub]: coerced } as UILayout;
        return;
    }
    element.props = { ...(element.props ?? {}), [propPath]: value };
}

/** Where a widgetProp binding points, as one string. */
function widgetPropBindingKey(surfaceId: string, elementId: string): string {
    // A separator no id may contain, so `a:b` + `c` and `a` + `b:c` cannot collide.
    return `${surfaceId}\u0000${elementId}`;
}

/**
 * Every widgetProp binding in a document, grouped by the element it targets.
 *
 * Built because the alternative is what this used to do: every element, on every render, walked
 * every blueprint and every binding in the document looking for the ones aimed at itself. That is
 * O(elements x bindings) per render pass and a page switch is a dozen passes - and it was not free
 * even for a project with no bindings at all, because `Object.values` still allocated an array per
 * blueprint per element. Measured on a shipped build, it was the single hottest function in a page
 * switch (124 ms of a 900 ms switch) on a project whose blueprints declare **zero** bindings.
 *
 * **Order is preserved exactly**, blueprint by blueprint and binding within blueprint, because two
 * bindings may target the same prop and the last one applied wins - so a different order would be a
 * different answer.
 *
 * Cached against the document object's identity. That is safe for every caller there is: the one
 * place a `SurfaceBlueprintBindingContext` is built (`GameApp`) reads `bundle.ui.localBlueprints`,
 * and a bundle is replaced whole - a hot reload hands over a new document rather than editing the
 * one in hand. A host that ever does mutate a document in place would already be defeating the
 * `useMemo` that builds the context around it.
 */
const widgetPropBindingIndexCache = new WeakMap<BlueprintDocument, Map<string, BindingDefinition[]>>();

function widgetPropBindingIndex(document: BlueprintDocument): Map<string, BindingDefinition[]> {
    const cached = widgetPropBindingIndexCache.get(document);
    if (cached) {
        return cached;
    }
    const index = new Map<string, BindingDefinition[]>();
    for (const bp of Object.values(document.blueprints)) {
        if (!bp.bindings) {
            continue;
        }
        for (const bind of Object.values(bp.bindings)) {
            if (bind.target.kind !== "widgetProp") {
                continue;
            }
            const key = widgetPropBindingKey(bind.target.surfaceId, bind.target.elementId);
            const existing = index.get(key);
            if (existing) {
                existing.push(bind);
            } else {
                index.set(key, [bind]);
            }
        }
    }
    widgetPropBindingIndexCache.set(document, index);
    return index;
}

/**
 * Clone element and apply active widgetProp bindings for this surface using surface + global state and fields.
 *
 * **The element comes back untouched when nothing is bound to it**, which is the ordinary case and
 * used to cost a clone of the element, its layout and its props all the same. Returning the input is
 * what `applyWidgetRuntimePatches` beside it already does, and it is safe for the same reason:
 * everything downstream of here treats an element as read-only, and the render snapshot is cloned
 * before any renderer sees it.
 */
export function mergeElementWithBlueprintBindings(
    element: UIElement,
    surfaceId: string,
    blueprintDocument: BlueprintDocument,
    surfaceState: SurfaceStateStore,
    emitDebug: (event: BlueprintDebugEvent) => void,
    coalescer?: BindingDebugCoalescer,
    globalState?: BlueprintStateReader,
    listItemScope?: UIListItemScope | null,
): UIElement {
    const bindings = widgetPropBindingIndex(blueprintDocument)
        .get(widgetPropBindingKey(surfaceId, element.id));
    if (!bindings) {
        return element;
    }

    const next: UIElement = {
        ...element,
        layout: { ...element.layout },
        props: element.props ? { ...element.props } : {},
    };

    const skipWidgetPropMerge = isAppearanceCapableElementType(next.type);

    for (const bind of bindings) {
        if (skipWidgetPropMerge && bind.target.propPath !== "variant") {
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
        } else if (vs?.kind === "globalState" && globalState) {
            const raw = globalState.get(vs.key);
            if (!coalescer || coalescer.shouldEmitStateRead(vs.key, raw)) {
                emitDebug({ type: "state.read", scope: "global", key: vs.key });
            }
        }

        const evaluated = evaluateFieldValue(field, surfaceState, globalState, listItemScope ?? null);
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

    return next;
}
