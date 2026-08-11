import { isBuiltinAppTagId, type ProjectAppTag } from "@shared/types/appTag";

/**
 * What a build variant is called on screen.
 *
 * Every variant but one is called what the author named it. The release variant is not authored - it
 * is synthesized, and `@shared/types/appTag` spells it "Release" because that module has no catalog
 * to read - so the word an author sees has to be substituted at the point of display.
 *
 * That substitution lives here rather than at each surface because it was written three times and
 * one of them was missed: the build dialog's variant picker listed "Release" while the panel beside
 * it said the translated word, which is one variant under two names in one language, with nothing on
 * screen to say they are the same thing. A surface that shows a variant's name calls this.
 *
 * The translated word is passed in rather than read here, so a component gets it from its own
 * `useTranslation` and re-renders when the language changes, while an imperative caller passes
 * `translate(...)`. Both spell the key `project.appTags.releaseName`.
 */
export function appTagDisplayName(tag: ProjectAppTag, releaseName: string): string {
    return isBuiltinAppTagId(tag.id) ? releaseName.trim() || tag.name : tag.name;
}

/** The same substitution across a list - what a picker's options are built from. */
export function displayedAppTags(
    tags: readonly ProjectAppTag[],
    releaseName: string,
): ProjectAppTag[] {
    return tags.map(tag => (
        isBuiltinAppTagId(tag.id) ? { ...tag, name: appTagDisplayName(tag, releaseName) } : tag
    ));
}
