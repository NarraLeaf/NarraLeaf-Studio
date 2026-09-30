import { getLocaleMeta, type LocaleCode } from "@shared/i18n/locales";
import { resolveLocalizedText, type LocalizedTextPack } from "@shared/types/localizedText";
import type { PluginRegistryEntry } from "@shared/types/pluginRegistry";

/**
 * A registry entry with its `name` and `description` in the interface language.
 *
 * The registry keys an entry's `locales` by BCP-47 tag (`zh-CN`, `en`) rather than by Studio's
 * language ids (`zh`, `ja`), and its top-level pair is in whichever language the plugin's author
 * wrote first - English for one plugin, Chinese for the next. So the interface language is looked
 * up by its tag, the one `Intl` formats with: the exact tag (`zh-CN`), then its base language
 * (`zh`), then the top-level text. Each field falls back on its own, and tags compare without
 * regard to case, as BCP-47 defines them.
 *
 * A language pack's locale answers through the tag it declares, so a pack built on Chinese reads
 * an entry's `zh-CN` text.
 */
export function localizePluginRegistryEntry(entry: PluginRegistryEntry, locale: LocaleCode): PluginRegistryEntry {
    if (!entry.locales) {
        return entry;
    }
    const packs: LocalizedTextPack = {};
    for (const [tag, pack] of Object.entries(entry.locales)) {
        packs[tag.toLowerCase()] = pack;
    }
    const text = resolveLocalizedText(
        { name: entry.name, description: entry.description, locales: packs },
        getLocaleMeta(locale).intl.toLowerCase(),
    );
    return { ...entry, name: text.name, description: text.description };
}
