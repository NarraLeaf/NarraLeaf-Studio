/**
 * UI template store (registry) constants.
 *
 * The registry is the NarraLeaf/UI-Templates repository's generated `index.json`
 * (see its `schema/index.schema.json`). Unlike the plugin store, a UI template is
 * NOT a release artifact: Studio fetches the document JSON — and any resources a
 * template declares — directly from the repository's raw blob, then applies them
 * into the currently open project. Nothing is installed to userData.
 */

/** Official index, on the registry's `master` branch. Empty setting = this. */
export const DEFAULT_UI_TEMPLATE_REGISTRY_URL =
    "https://raw.githubusercontent.com/NarraLeaf/UI-Templates/master/index.json";

/** The only `formatVersion` this client knows how to read; a newer index is refused. */
export const UI_TEMPLATE_REGISTRY_FORMAT_VERSION = 1;

/** Abort a registry index / document / resource request that stalls past this. */
export const UI_TEMPLATE_REGISTRY_FETCH_TIMEOUT_MS = 15_000;

/** Refuse a template document (uidoc / uigraphs JSON) larger than this. */
export const UI_TEMPLATE_MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;

/** Refuse a single declared resource larger than this before buffering it. */
export const UI_TEMPLATE_MAX_ASSET_BYTES = 8 * 1024 * 1024;

/** Refuse a template that declares more resources than this. */
export const UI_TEMPLATE_MAX_ASSETS = 32;
