/**
 * A project template that ships inside Studio (`resources/templates/<id>/`).
 *
 * Unlike a UI template — which is fetched from a registry and applied into an open
 * project — a project template is what a project is *made from*, so it has to be
 * on disk before there is any network or any project. See
 * `main/app/application/managers/projectTemplates.ts`.
 */
export type ProjectTemplateDescriptor = {
    id: string;
    /** Fallback display name; `locales` overrides it for the active language. */
    name: string;
    description: string;
    version: string;
    /**
     * Per-locale name/description, keyed by locale code.
     *
     * Templates are content rather than chrome — they are added and removed by
     * editing `resources/`, without touching the app's own catalogs — so their
     * wording travels with them instead of living in `src/shared/i18n`.
     */
    locales: Record<string, { name?: string; description?: string }>;
    /** The stage size the template's interface and scenes were authored against. */
    designSize?: { width: number; height: number };
};

/** Pick the best name/description for a locale, falling back to the manifest's own. */
export function resolveProjectTemplateText(
    template: ProjectTemplateDescriptor,
    locale: string,
): { name: string; description: string } {
    const exact = template.locales[locale];
    // "zh-CN" should still find a "zh" pack.
    const base = locale.includes("-") ? template.locales[locale.split("-")[0]] : undefined;
    return {
        name: exact?.name ?? base?.name ?? template.name,
        description: exact?.description ?? base?.description ?? template.description,
    };
}
