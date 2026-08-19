/** Bundled project templates live here, relative to the app's resources directory. */
export const PROJECT_TEMPLATES_DIR = "templates";

/** The manifest file inside one template directory. */
export const PROJECT_TEMPLATE_MANIFEST = "template.json";

/** The tree copied verbatim over a freshly written project. */
export const PROJECT_TEMPLATE_CONTENT_DIR = "content";

/** The id the wizard uses for "no template" — a plain, empty project. */
export const EMPTY_PROJECT_TEMPLATE_ID = "empty";

/**
 * The tree holding a template's content written in one particular language.
 *
 * A sibling of `content/` rather than a subdirectory of it, because it is the same
 * project said again rather than a part of it: the base tree stays the one that is
 * copied when nothing matches, and a variant that lived inside it would be copied
 * along with it. Which languages exist is declared in the manifest (`contentLocales`)
 * - the directory alone is not the offer.
 */
export function projectTemplateContentDirForLocale(locale: string): string {
    return `${PROJECT_TEMPLATE_CONTENT_DIR}.${locale}`;
}
