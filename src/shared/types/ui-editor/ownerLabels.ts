/**
 * What a blueprint belongs to, in the words an author navigates by.
 *
 * Simplifies the internal globalMain/surfaceMain/widgetMain/storyAction taxonomy into terms an
 * intermediate creator can read. Keys rather than words: these land in a panel row, a tab title and
 * the section beside a control, all of which are translated, and a literal here printed English
 * into every one of them.
 */

import type { TranslationKey } from "@shared/i18n";
import type { BlueprintOwnerRef } from "@shared/types/blueprint/document";

const LABEL_KEYS: Record<BlueprintOwnerRef["kind"], TranslationKey> = {
    globalMain: "uiEditor.ownerLabel.globalMain",
    surfaceMain: "uiEditor.ownerLabel.surfaceMain",
    widgetMain: "uiEditor.ownerLabel.widgetMain",
    widgetValue: "uiEditor.ownerLabel.widgetValue",
    // A component definition's logic is the same thing to an author as a control's own, and saying
    // it differently would only ask them to tell two words apart that mean one thing.
    componentWidgetMain: "uiEditor.ownerLabel.widgetMain",
    storyAction: "uiEditor.ownerLabel.storyAction",
};

/** The translation key naming `kind`. Pass it through the caller's own `t`. */
export function ownerLabelKey(kind: BlueprintOwnerRef["kind"]): TranslationKey {
    return LABEL_KEYS[kind];
}

/**
 * The names a story blueprint is created with, before an author names it.
 *
 * Stored English words rather than anything the author wrote, so a surface that names a story
 * blueprint shows its owner label instead when the name is one of these - printing them would put
 * English into every locale and say nothing an author chose.
 */
const FACTORY_STORY_BLUEPRINT_NAMES: ReadonlySet<string> = new Set(["Story Action", "Story Value", "Story Condition"]);

/** Whether `name` is one a story blueprint is created with rather than one an author gave it. */
export function isFactoryStoryBlueprintName(name: string | undefined): boolean {
    return name !== undefined && FACTORY_STORY_BLUEPRINT_NAMES.has(name);
}
