/**
 * Owner-level event definitions for surface-level and global-level blueprints.
 * Parallel to widgetLogic.ts which defines per-widget-type logic APIs;
 * this module covers surfaceMain and globalMain owner scopes.
 */

export type LifecycleEventDispatchKind = "lifecycle" | "interaction";

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

const KEYBOARD_EVENTS: readonly LifecycleEventDef[] = [
    {
        id: "keyDown",
        displayName: "Key down",
        dispatchKind: "interaction",
        headNodeTypes: ["blueprint.event.head.keyDown", "blueprint.event.head.anyKeyDown"],
    },
    {
        id: "keyUp",
        displayName: "Key up",
        dispatchKind: "interaction",
        headNodeTypes: ["blueprint.event.head.keyUp", "blueprint.event.head.anyKeyUp"],
    },
];

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
    {
        id: "gameReady",
        displayName: "Game ready",
        description: "Fires after the NarraLeaf live game runtime is available for preference writes.",
        dispatchKind: "lifecycle",
        headNodeTypes: ["blueprint.event.head.gameReady"],
    },
    ...KEYBOARD_EVENTS,
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
    {
        id: "surfaceUnmount",
        displayName: "Page unmount",
        dispatchKind: "lifecycle",
        headNodeTypes: ["blueprint.event.head.surfaceUnmount"],
    },
    {
        id: "beforeSurfaceExit",
        displayName: "Before surface exit",
        description: "Fires before the current Page surface starts its exit animation.",
        dispatchKind: "lifecycle",
        headNodeTypes: ["blueprint.event.head.beforeSurfaceExit"],
    },
    {
        id: "afterSurfaceEnter",
        displayName: "After surface enter",
        description: "Fires after the current Page surface finishes its enter animation.",
        dispatchKind: "lifecycle",
        headNodeTypes: ["blueprint.event.head.afterSurfaceEnter"],
    },
    {
        id: "mouseClick",
        displayName: "Mouse click",
        description: "Fires for any mouse click inside the current Page surface.",
        dispatchKind: "interaction",
        headNodeTypes: ["blueprint.event.head.mouseClick"],
    },
    {
        id: "rightClick",
        displayName: "Right click",
        description: "Fires for any right click inside the current Page surface.",
        dispatchKind: "interaction",
        headNodeTypes: ["blueprint.event.head.rightClick"],
    },
    ...KEYBOARD_EVENTS,
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
