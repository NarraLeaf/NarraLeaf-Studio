import type { PluginInstallPermission } from "./pluginPermissions";

/**
 * The store's view of a plugin, mirroring one entry of the registry
 * `index.json` (NarraLeaf/Plugins `schema/index.schema.json`). This is the raw,
 * untrusted registry data - installed / update state is derived in the renderer
 * by cross-referencing the installed plugin list, so the main process stays a
 * dumb pass-through.
 */
export type PluginRegistryRelease = {
    /** `<id>@<version>` git tag the release was cut from. */
    tag: string;
    /** Human-facing GitHub release page. */
    page: string;
    /** Deterministic `.zip` asset URL. The only address Studio downloads from. */
    download: string;
};

export type PluginRegistryEntry = {
    id: string;
    name: string;
    version: string;
    description: string;
    publisher: string;
    /** Which entry targets the plugin declares. */
    targets: ("studio" | "runtime")[];
    categories: string[];
    keywords: string[];
    license: string;
    /**
     * Absolute `https` URL of the plugin's thumbnail, as published by the
     * registry. Unlike an installed plugin's icon this one has not been through
     * Studio's square/size checks — it is a remote image the store shows while
     * browsing — so the UI boxes it and falls back to the monogram if it fails
     * to load. The installed copy is validated at install time.
     */
    icon?: string;
    homepage?: string;
    /** Advisory semver range; Studio does not enforce it. */
    studioVersion?: string;
    /** Copied from the manifest; surfaced before install. */
    permissions: PluginInstallPermission[];
    release: PluginRegistryRelease;
};

export type PluginRegistryIndex = {
    formatVersion: number;
    repository: string;
    plugins: PluginRegistryEntry[];
};

/** Response of a store fetch: the parsed index plus the URL it came from. */
export type PluginRegistryFetchResult = {
    registryUrl: string;
    index: PluginRegistryIndex;
};
