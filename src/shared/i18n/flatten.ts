/**
 * Shared catalog flattening. Both the translator (built-in catalogs) and the
 * runtime locale registry (plugin overlays) turn a nested message tree into a
 * `dotted.key -> string` map with the same rules, so the logic lives here to
 * keep them identical.
 */

export type FlatMessages = Map<string, string>;

/** Recursively flatten a nested message object into `out` as `dotted.key -> string`. */
export function flatten(node: unknown, prefix: string, out: FlatMessages): void {
    if (typeof node === "string") {
        out.set(prefix, node);
        return;
    }
    if (node && typeof node === "object") {
        for (const [key, value] of Object.entries(node)) {
            flatten(value, prefix ? `${prefix}.${key}` : key, out);
        }
    }
}

/** Flatten a whole catalog (nested or already-flat dotted) into a fresh map. */
export function flattenCatalog(catalog: unknown): FlatMessages {
    const out: FlatMessages = new Map();
    flatten(catalog, "", out);
    return out;
}
