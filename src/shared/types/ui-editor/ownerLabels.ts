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

/**
 * What the story calls the editor of a blueprint it runs, by how the row uses it - the title the
 * blueprint's tab gets when it is opened from that row.
 */
const STORY_BLUEPRINT_TITLE_KEYS: Readonly<Record<"action" | "value" | "condition", TranslationKey>> = {
    action: "storyInspector.blueprint.storyActionTitle",
    value: "story.interpolation.storyValueTitle",
    condition: "story.condition.title",
};

/**
 * A blueprint's name as a list or a tab that names blueprints shows it: as stored, unless it is a
 * story blueprint still carrying the name it was created with, which reads as the title its tab is
 * given from the story - so opening it from Quick Open or a search result names the tab as opening it
 * from its row does, in the interface language.
 */
export function blueprintDisplayName(
    blueprint: { name: string; owner?: BlueprintOwnerRef },
    t: (key: TranslationKey) => string,
): string {
    const { owner } = blueprint;
    if (owner?.kind === "storyAction" && isFactoryStoryBlueprintName(blueprint.name)) {
        return t(STORY_BLUEPRINT_TITLE_KEYS[owner.mode ?? "action"]);
    }
    return blueprint.name;
}

/**
 * The layers Studio seeds, by layer id: a Blueprint Value's `init` layer and a story blueprint's
 * `onCall` layer, each named after the event that starts it.
 *
 * Stored English for the reason the factory blueprint names above are, so a surface that names a
 * layer shows that event's own title instead - the words the event's card on the canvas already
 * uses - for as long as the layer still has the name it was created with. A layer an author renamed,
 * or one of their own that happens to share the id, keeps its name.
 */
const FACTORY_LAYER_NAMES: Readonly<Record<string, { name: string; key: TranslationKey }>> = {
    init: { name: "Init", key: "blueprint.node.init" },
    onCall: { name: "On Call", key: "blueprint.node.onCall" },
};

/** The key a seeded layer's name is shown with, or undefined for a name an author gave it. */
export function factoryLayerNameKey(layerId: string, name: string | undefined): TranslationKey | undefined {
    const factory = Object.prototype.hasOwnProperty.call(FACTORY_LAYER_NAMES, layerId) ? FACTORY_LAYER_NAMES[layerId] : undefined;
    return factory && factory.name === name ? factory.key : undefined;
}
