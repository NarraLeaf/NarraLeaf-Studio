import type { UISurfaceKind, UIStageSlotId } from "./ui-editor/document";

/**
 * The store's view of a UI template, mirroring one entry of the registry
 * `index.json` (NarraLeaf/UI-Templates `schema/index.schema.json`). This is the
 * raw, untrusted registry data; applied / placement state is derived in the
 * renderer, so the main process stays a dumb read-only pass-through.
 *
 * A template is a `UIDocument` + `UIGraphDocument` pair, plus an optional set of
 * declared resources. The registry never carries the documents inline — only the
 * repository-relative paths to fetch them from, resolved against the index URL.
 */

/** Where an imported surface should land. Overrides whatever the (possibly
 * migrated) document's own mount says, resolving the placement ambiguity of
 * templates authored on older schemas. */
export type UITemplateSurfacePlacement = {
    kind: UISurfaceKind;
    /** Required for `stageSurface`; the game-UI slot the surface mounts into. */
    slotId?: UIStageSlotId;
};

/** One resource a template ships alongside its document, fetched from the same
 * directory and re-imported into the project's asset store on apply. */
export type UITemplateAssetRef = {
    /** The `assetId` the document references; remapped to a fresh project id on import. */
    id: string;
    /** Repository-relative path, resolved against the template directory. */
    path: string;
};

/**
 * A theme: one look, and the set of screens drawn in it.
 *
 * The store browses themes first and templates second, because an author picks a
 * look once and then takes several screens from it — a flat list made them read
 * past four other looks to find the second screen of the one they chose.
 *
 * Its `preview` is a poster rendered from the theme's own templates and committed
 * beside it. That is deliberately unlike a template card, which renders live: at
 * the browse level the cost is one small image per theme instead of every
 * template's full document, and a theme's look changes far more rarely than a
 * single screen's contents.
 */
export type UIThemeDescriptor = {
    id: string;
    name: string;
    version: string;
    description: string;
    publisher: string;
    /** Source directory in the repository, e.g. `themes/narraleaf.coffee`. */
    path: string;
    /** Theme-relative path to the poster image. */
    preview?: string;
    /** How many templates in the index declare this theme. */
    templateCount: number;
};

/**
 * One theme poster, ready for an `<img src>`.
 *
 * A `data:` URL rather than the registry's own URL, because Studio's renderers
 * do not reach the network: main fetches and caches the bytes, and a hostile
 * index therefore cannot aim an `<img>` anywhere or use one as a per-user beacon.
 */
export type UIThemePreview = {
    id: string;
    dataUrl: string;
};

export type UITemplateRegistryEntry = {
    id: string;
    name: string;
    version: string;
    description: string;
    publisher: string;
    categories: string[];
    /** Source directory in the repository, e.g. `templates/narraleaf.save-load`. */
    path: string;
    /** Template-relative path to the `UIDocument` JSON. */
    document: string;
    /** Template-relative path to the `UIGraphDocument` JSON. */
    graphs: string;
    /** Template-relative path to an optional preview image. */
    preview?: string;
    /** Intended placement for the template's surface(s). */
    surface: UITemplateSurfacePlacement;
    /** Declared resources; empty for asset-free templates. */
    assets: UITemplateAssetRef[];
    /** The theme this template belongs to; absent on an unthemed template. */
    theme?: string;
};

export type UITemplateRegistryIndex = {
    formatVersion: number;
    repository: string;
    /** Themes the registry publishes; empty on a registry that predates them. */
    themes: UIThemeDescriptor[];
    templates: UITemplateRegistryEntry[];
};

/** Response of a store fetch: the parsed index plus the URL it came from. */
export type UITemplateFetchResult = {
    registryUrl: string;
    index: UITemplateRegistryIndex;
};

/** One fetched resource, handed to the renderer to re-import into the project. */
export type UITemplateFetchedAsset = {
    /** The document's original `assetId` for this resource. */
    id: string;
    /** File name (basename of the declared path), used to seed the imported asset. */
    fileName: string;
    /** Best-effort MIME type, inferred from the file extension. */
    mime: string;
    /** Base64-encoded bytes; decoded and ingested by the renderer. */
    dataBase64: string;
};

/**
 * One template's `UIDocument` on its own, for drawing a store card.
 *
 * Separate from {@link UITemplateBundle} because a card only has to be *looked*
 * at: pulling the full bundle for every card would download every template's
 * logic graph and every byte of its resources just to render a thumbnail.
 */
export type UITemplatePreview = {
    id: string;
    /** Raw `UIDocument` JSON, pre-migration. */
    document: unknown;
};

/**
 * The full payload the main process returns for one template: the two documents
 * as raw JSON (migrated in the renderer, never here) plus any fetched resources.
 */
export type UITemplateBundle = {
    id: string;
    surface: UITemplateSurfacePlacement;
    /** Raw `UIDocument` JSON, pre-migration. */
    document: unknown;
    /** Raw `UIGraphDocument` JSON, pre-migration. */
    graphs: unknown;
    assets: UITemplateFetchedAsset[];
};
