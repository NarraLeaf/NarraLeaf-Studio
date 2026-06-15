/**
 * Lifecycle event definitions for surface-level and global-level blueprints.
 * Parallel to widgetLogic.ts which defines per-widget-type logic APIs;
 * this module covers surfaceMain and globalMain owner scopes.
 */

export type LifecycleEventDispatchKind = "lifecycle";

export type LifecycleEventDef = {
    id: string;
    displayName: string;
    description?: string;
    dispatchKind: LifecycleEventDispatchKind;
    headNodeTypes: readonly string[];
};

export type OwnerLifecycleApi = {
    events: readonly LifecycleEventDef[];
};

// ---------------------------------------------------------------------------
// Global (app-level) lifecycle
// ---------------------------------------------------------------------------

export const GLOBAL_LIFECYCLE_EVENTS: readonly LifecycleEventDef[] = [
    {
        id: "appBoot",
        displayName: "App boot",
        dispatchKind: "lifecycle",
        headNodeTypes: ["blueprint.event.head.appBoot"],
    },
];

export const GLOBAL_LIFECYCLE_API: OwnerLifecycleApi = {
    events: GLOBAL_LIFECYCLE_EVENTS,
};

// ---------------------------------------------------------------------------
// Surface (page-level) lifecycle
// ---------------------------------------------------------------------------

export const SURFACE_LIFECYCLE_EVENTS: readonly LifecycleEventDef[] = [
    {
        id: "surfaceInit",
        displayName: "Page init",
        dispatchKind: "lifecycle",
        headNodeTypes: ["blueprint.event.head.surfaceInit"],
    },
];

export const SURFACE_LIFECYCLE_API: OwnerLifecycleApi = {
    events: SURFACE_LIFECYCLE_EVENTS,
};

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

export function getGlobalLifecycleEvent(eventId: string): LifecycleEventDef | undefined {
    return GLOBAL_LIFECYCLE_EVENTS.find(e => e.id === eventId);
}

export function getSurfaceLifecycleEvent(eventId: string): LifecycleEventDef | undefined {
    return SURFACE_LIFECYCLE_EVENTS.find(e => e.id === eventId);
}

/**
 * Resolve which event-head node types are valid for a surface lifecycle event.
 */
export function resolveSurfaceLifecycleEventHeadTypes(eventId: string): readonly string[] {
    const def = getSurfaceLifecycleEvent(eventId);
    return def?.headNodeTypes ?? [];
}

/**
 * Resolve which event-head node types are valid for a global lifecycle event.
 */
export function resolveGlobalLifecycleEventHeadTypes(eventId: string): readonly string[] {
    const def = getGlobalLifecycleEvent(eventId);
    return def?.headNodeTypes ?? [];
}
