/**
 * Links into narraleaf.com's documentation, in the reader's language where there is one.
 *
 * Its own module because the URL shape is a rule rather than a constant, and the rule was already
 * written out twice before anything else needed a docs link. Anywhere that builds one should call
 * {@link docsUrl} rather than concatenating an origin and a path.
 */

const DOCS_ORIGIN = "https://www.narraleaf.com";

/**
 * The locales narraleaf.com publishes docs in.
 *
 * Deliberately its own short list rather than Studio's `SUPPORTED_LOCALES`: a plugin can register a
 * locale in Studio (see `shared/i18n/locales.ts`), and the docs site has never heard of it. Anything
 * not here reads the English page, which is a working link rather than a 404.
 */
const DOCS_LOCALES = new Set(["en", "zh"]);

/**
 * A documentation URL for a path, in `locale` if the site publishes it.
 *
 * The site hides its default locale, so English lives at `/docs/…` and every other language at
 * `/<locale>/docs/…` - that asymmetry is the site's routing (`hideLocale: "default-locale"`), not a
 * convention worth reinventing at each call site. `path` is the English path, leading slash and all.
 */
export function docsUrl(path: string, locale: string): string {
    const prefix = locale !== "en" && DOCS_LOCALES.has(locale) ? `/${locale}` : "";
    return `${DOCS_ORIGIN}${prefix}${path}`;
}

/** The Studio manual's front page - where somebody who wants to read about Studio should land. */
export function studioDocsUrl(locale: string): string {
    return docsUrl("/docs/studio", locale);
}
