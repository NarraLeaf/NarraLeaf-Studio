import type { PluginManifestLocalized, PluginManifestLocalizedText } from "../types/plugins";

/**
 * The fields these helpers read. Structural, so the build dialog's narrowed plugin shape and a
 * Dev Mode exclusion can be handed in as they are.
 */
type LocalizableManifest = {
    name?: string;
    description?: string;
    localized?: PluginManifestLocalized;
};

function localizedText(manifest: LocalizableManifest, locale: string | undefined): PluginManifestLocalizedText | undefined {
    const table = manifest.localized;
    if (!locale || !table || !Object.prototype.hasOwnProperty.call(table, locale)) {
        return undefined;
    }
    return table[locale];
}

/**
 * The name Studio shows for a plugin to an author whose editor is in `locale`.
 *
 * The manifest's `localized` table is looked up by the exact locale code, and each field falls back
 * on its own, so a plugin that translates only its name keeps its plain description. Without a
 * locale - the main process, a command line, anything that names the plugin to a file or a log
 * rather than to a person - the plain field is returned, because that is the plugin's identity.
 */
export function pluginDisplayName(manifest: LocalizableManifest & { name: string }, locale: string | undefined): string;
export function pluginDisplayName(manifest: LocalizableManifest, locale: string | undefined): string | undefined;
export function pluginDisplayName(manifest: LocalizableManifest, locale: string | undefined): string | undefined {
    return localizedText(manifest, locale)?.name || manifest.name;
}

/** The description to show in `locale`; see {@link pluginDisplayName}. */
export function pluginDisplayDescription(manifest: LocalizableManifest, locale: string | undefined): string | undefined {
    return localizedText(manifest, locale)?.description || manifest.description;
}
