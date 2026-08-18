import type { UIStageSlotId } from "@shared/types/ui-editor/document";
import { isUIStageSlotId, UI_STAGE_SLOT_IDS } from "@shared/types/ui-editor/stageSlots";
import type { InterpolationParams, TranslationKey } from "@shared/i18n";

export type TranslateFn = (key: TranslationKey, params?: InterpolationParams) => string;

/**
 * What to call a stage slot, and what to say it holds.
 *
 * An author meets the same five slots in four places - the Create Game UI dialog, the surface list,
 * the properties panel and the template store - so their names come from one catalogue family
 * (`uiEditor.stageSlot.*` / `uiEditor.stageSlotDescription.*`). They used to be English literals
 * sitting beside the slot ids in `@shared/types/ui-editor/stageSlots`, which is how the create
 * dialog came to read "Dialog / The main conversation or narration interface." under a Chinese
 * interface: nothing about that string ever reached the translator.
 *
 * Takes its translator as an argument, like `getSurfaceDisplayLabel` next door: components pass the
 * `t` they already hold, imperative callers pass `translate`.
 */
export function getStageSlotLabel(slotId: string, t: TranslateFn): string {
  // A hand-edited document can name a slot that no longer exists; show the raw id rather than a
  // blank, which is what the old label lookup did with its `?? slotId` tail.
  return isUIStageSlotId(slotId) ? t(`uiEditor.stageSlot.${slotId}`) : slotId;
}

export function getStageSlotDescription(slotId: UIStageSlotId, t: TranslateFn): string {
  return t(`uiEditor.stageSlotDescription.${slotId}`);
}

export type StageSlotOption = {
  value: UIStageSlotId;
  label: string;
  description: string;
};

/** The five slots in stage order, named in the active locale. */
export function getStageSlotOptions(t: TranslateFn): StageSlotOption[] {
  return UI_STAGE_SLOT_IDS.map((value) => ({
    value,
    label: getStageSlotLabel(value, t),
    description: getStageSlotDescription(value, t)
  }));
}
