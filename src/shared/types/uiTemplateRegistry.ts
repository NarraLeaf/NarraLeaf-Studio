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
};

export type UITemplateRegistryIndex = {
    formatVersion: number;
    repository: string;
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
