import type { TranslationKey } from "@shared/i18n/catalog";
import type { ReferenceSite } from "@/lib/workspace/services/refactor/renameModel";

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

/** Where a site is: `story › scene`, a blueprint, or the Variables panel. */
export function referenceSitePlace(site: ReferenceSite, t: Translate): string {
    if (site.slot === "blueprintNode") {
        return t("refactor.site.blueprint" as TranslationKey, { name: site.blueprintName || t("refactor.site.unnamedBlueprint" as TranslationKey) });
    }
    if (site.slot === "registry") {
        return t("refactor.slot.registry" as TranslationKey);
    }
    if (site.slot === "characterName") {
        return t("refactor.slot.characterName" as TranslationKey);
    }
    if (site.storyName && site.sceneName) {
        return `${site.storyName} › ${site.sceneName}`;
    }
    return site.sceneName ?? site.storyName ?? "";
}

/** What a site is: `Line 3 · Condition`. */
export function referenceSiteDetail(site: ReferenceSite, t: Translate): string {
    const slot = t(`refactor.slot.${site.slot}` as TranslationKey);
    return site.line ? `${t("refactor.site.line" as TranslationKey, { line: site.line })} · ${slot}` : slot;
}

/** The key a site groups under in a list: one group per scene, one for everything outside scenes. */
export function referenceSiteGroupKey(site: ReferenceSite): string {
    return site.sceneId ? `${site.storyId}\u0000${site.sceneId}` : site.slot === "blueprintNode" ? "\u0000blueprint" : "\u0000project";
}
