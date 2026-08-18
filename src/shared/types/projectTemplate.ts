import { resolveLocalizedText } from "./localizedText";
import { isStageSizeUsable, type StageSize } from "./stageSize";

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
  designSize?: StageSize;
  /**
   * Every stage size this template's content is laid out for, when it has more than one.
   *
   * A template's surfaces are positioned in absolute coordinates, so the size is not the
   * author's to choose freely - picking one the template was not drawn for produces a project
   * whose interface is off the edge of its own stage, silently. The wizard therefore offers
   * exactly what is listed here and nothing else.
   */
  designSizes?: StageSize[];
};

/**
 * The stage sizes a template may be created at, in offer order.
 *
 * Empty means the template says nothing about it, and the author picks freely - which is what
 * every template did before this field existed, and what a metadata-only template still means.
 */
export function projectTemplateStageSizes(template: ProjectTemplateDescriptor): StageSize[] {
  const declared = template.designSizes?.filter(isStageSizeUsable) ?? [];
  if (declared.length > 0) {
    return declared;
  }
  return template.designSize && isStageSizeUsable(template.designSize) ? [template.designSize] : [];
}

/**
 * Pick the best name/description for a locale.
 *
 * Delegates to the shared resolver so a bundled project template, a UI template
 * and a theme all answer the same way — two copies of this drift, and the drift
 * is invisible until an author sees one of the three in the wrong language.
 */
export function resolveProjectTemplateText(
  template: ProjectTemplateDescriptor,
  locale: string
): { name: string; description: string } {
  return resolveLocalizedText(template, locale);
}
