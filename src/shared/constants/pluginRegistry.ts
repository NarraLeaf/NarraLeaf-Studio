/**
 * Plugin store (registry) constants.
 *
 * The registry is the NarraLeaf/Plugins repository's generated `index.json`
 * (see its `schema/index.schema.json`). Studio fetches it read-only to populate
 * the in-app store; downloads come from the per-plugin `release.download` URL the
 * index itself carries, never from a renderer-supplied address.
 */

/** Official index, on the registry's `master` branch. Empty setting = this. */
export const DEFAULT_PLUGIN_REGISTRY_URL =
    "https://raw.githubusercontent.com/NarraLeaf/Plugins/master/index.json";

/** The only `formatVersion` this client knows how to read; a newer index is refused. */
export const PLUGIN_REGISTRY_FORMAT_VERSION = 1;

/** Abort a registry index / package request that stalls past this. */
export const PLUGIN_REGISTRY_FETCH_TIMEOUT_MS = 15_000;

/** Refuse a plugin package larger than this, before writing anything to disk. */
export const PLUGIN_REGISTRY_MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
