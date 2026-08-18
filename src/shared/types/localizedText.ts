/**
 * Wording that travels with content rather than living in `src/shared/i18n`.
 *
 * Studio's own chrome is translated through the catalogs, which are compiled in.
 * Content is not: a UI template, a theme and a bundled project template are all
 * added by dropping files somewhere — into `resources/`, or into a registry
 * published after this build shipped — and none of them can add keys to a catalog
 * that is already compiled. So each carries its own translations, keyed by the
 * same language ids Studio uses.
 *
 * The fallback chain is the manifest's own top-level `name` / `description`,
 * which every manifest is required to have. A template with no `locales` at all
 * is therefore not a special case; it is the chain's last link.
 */

/** Per-locale overrides for a piece of content's display text. */
export type LocalizedTextPack = Record<string, { name?: string; description?: string } | undefined>;

/** Content that can be shown in the author's language. */
export type LocalizableDescriptor = {
  name: string;
  description: string;
  locales?: LocalizedTextPack;
};

/**
 * The best name and description for `locale`.
 *
 * Tries the exact code, then its base language, then the manifest's own text —
 * so a pack written for `zh` still answers an author running `zh-CN`, and one
 * written for `zh-CN` is not applied to `zh-TW`. Each field falls back
 * independently, because a pack that translates the name and not the description
 * should not force the name back to English too.
 */
export function resolveLocalizedText(
  descriptor: LocalizableDescriptor,
  locale: string
): { name: string; description: string } {
  const packs = descriptor.locales ?? {};
  const exact = packs[locale];
  const base = locale.includes("-") ? packs[locale.split("-")[0]] : undefined;
  return {
    name: exact?.name ?? base?.name ?? descriptor.name,
    description: exact?.description ?? base?.description ?? descriptor.description
  };
}

/** Coerce an untrusted `locales` object, dropping anything malformed. */
export function normalizeLocalizedTextPack(raw: unknown): LocalizedTextPack {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const pack: LocalizedTextPack = {};
  for (const [locale, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!locale.trim() || !value || typeof value !== "object") {
      continue;
    }
    const record = value as Record<string, unknown>;
    const name = typeof record.name === "string" && record.name.trim() ? record.name : undefined;
    const description =
      typeof record.description === "string" && record.description.trim()
        ? record.description
        : undefined;
    if (name || description) {
      pack[locale] = { name, description };
    }
  }
  return pack;
}
