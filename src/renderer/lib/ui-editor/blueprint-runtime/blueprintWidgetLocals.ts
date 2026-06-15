import type { Blueprint } from "@shared/types/blueprint/document";

function defaultLocalsFromBlueprint(bp: Blueprint): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const v of Object.values(bp.members?.variables ?? {})) {
        const d = v.defaultValue;
        out[v.id] = d === undefined ? null : d;
    }
    return out;
}

function widgetLocalsKey(surfaceId: string, elementId: string, blueprintId: string): string {
    return `${surfaceId}\0${elementId}\0${blueprintId}`;
}

const store = new Map<string, Record<string, unknown>>();

/**
 * Mutable per-widget blueprint execution locals: one map per (surface, element, blueprint) until release.
 * Syncs variable ids with the current blueprint definition without wiping values for existing vars.
 */
export function acquireBlueprintWidgetLocals(surfaceId: string, elementId: string, blueprintId: string, bp: Blueprint): Record<string, unknown> {
    const key = widgetLocalsKey(surfaceId, elementId, blueprintId);
    let locals = store.get(key);
    if (!locals) {
        locals = defaultLocalsFromBlueprint(bp);
        store.set(key, locals);
    } else {
        const defaults = defaultLocalsFromBlueprint(bp);
        for (const id of Object.keys(locals)) {
            if (!(id in defaults)) {
                delete locals[id];
            }
        }
        for (const [id, v] of Object.entries(defaults)) {
            if (!(id in locals)) {
                locals[id] = v;
            }
        }
    }
    return locals;
}

export function releaseBlueprintWidgetLocals(surfaceId: string, elementId: string, blueprintId: string): void {
    store.delete(widgetLocalsKey(surfaceId, elementId, blueprintId));
}
