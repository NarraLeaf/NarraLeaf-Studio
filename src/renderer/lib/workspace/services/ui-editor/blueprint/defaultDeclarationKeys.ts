/**
 * Default surface-state keys for widget property bindings (M3-min).
 * Scoped by element id so two widgets with the same propPath do not share one key by accident.
 */

/**
 * Build the default `surfaceState` key used when creating a declaration from a widget property binding.
 * Format: `w:<elementId>:<propPath>` (propPath may contain dots, e.g. `layout.visible`).
 */
export function buildDefaultSurfaceStateKeyForWidgetProp(params: { elementId: string; propPath: string }): string {
    return `w:${params.elementId}:${params.propPath}`;
}
