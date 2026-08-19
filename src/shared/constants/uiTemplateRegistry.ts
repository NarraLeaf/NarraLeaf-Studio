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

/**
 * No mirror is offered by name for this registry, unlike the plugin one, and the difference is not
 * an oversight: this store needs more than the index from wherever it points.
 *
 * A template's document, its graphs and every resource it declares resolve against the index's own
 * directory (`registryBaseDir` in `uiTemplateRegistryClient`), so they follow the setting to the
 * mirror. The community mirror at gh-mirror.mewbaka.cn serves `index.json` and answers 403 to
 * everything else beside it - measured, and stated in its own refusal - so pointing this key at it
 * yields a store that lists templates, draws no previews and fails every apply. That is the exact
 * "browsable but unusable" state the download rewrites exist to prevent, and offering it by name
 * would be Studio recommending it.
 *
 * An author whose network needs one can still type an address here, and a mirror that carries the
 * whole repository can be offered by name once there is one.
 */

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

/**
 * How long a fetched index may be reused by the calls that only need it to
 * resolve a path.
 *
 * Short on purpose: the index is what tells Studio which files a template is
 * made of, so a stale one means fetching yesterday's document. Long enough that
 * one visit to the store — browse, enter a theme, add a screen — reads it once
 * instead of four times; short enough that a template published while the store
 * is open is one Refresh away. Refresh itself never reads the memo.
 */
export const UI_TEMPLATE_INDEX_MAX_AGE_MS = 60_000;

/** How many card previews one request may ask for, so a single message cannot
 * turn into an unbounded run of requests to the registry host. */
export const UI_TEMPLATE_MAX_PREVIEWS_PER_REQUEST = 64;
