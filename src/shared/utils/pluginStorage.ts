/**
 * Plugin project-storage namespacing.
 *
 * Plugin stores live alongside core service stores in `editor/services/*.json`.
 * Namespacing every plugin store under a parseable, plugin-scoped prefix does
 * two things: it stops a plugin from colliding with (or overwriting) a core
 * store by picking a matching namespace, and it makes plugin-storage usage
 * attributable on disk so the dependency scanner can record it — even when the
 * owning plugin is not installed.
 *
 * Layout stays flat (no nested directories, since the store writer only creates
 * the top-level services dir) and the delimiter `__` cannot appear in a plugin
 * id (ids are `[a-z0-9.-]`), so the owner is unambiguously recoverable.
 */

export const PLUGIN_STORE_PREFIX = "plugin__";
const PLUGIN_STORE_DELIMITER = "__";

/** Build the concrete store namespace for a plugin's chosen sub-namespace. */
export function pluginStoreNamespace(pluginId: string, namespace: string): string {
    return `${PLUGIN_STORE_PREFIX}${pluginId}${PLUGIN_STORE_DELIMITER}${sanitizeStoreSegment(namespace)}`;
}

/**
 * Recover the owning plugin id from a store namespace (a filename stem, without
 * `.json`), or null when the store is not plugin-owned (e.g. a core store).
 */
export function parsePluginStoreOwner(storeNamespace: string): string | null {
    if (!storeNamespace.startsWith(PLUGIN_STORE_PREFIX)) {
        return null;
    }
    const rest = storeNamespace.slice(PLUGIN_STORE_PREFIX.length);
    const delimiter = rest.indexOf(PLUGIN_STORE_DELIMITER);
    if (delimiter <= 0) {
        return null;
    }
    return rest.slice(0, delimiter);
}

/** Keep the plugin-chosen segment to a safe, single-path-component filename. */
function sanitizeStoreSegment(value: string): string {
    const sanitized = value
        .replace(/[^A-Za-z0-9._-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
    return sanitized || "default";
}
