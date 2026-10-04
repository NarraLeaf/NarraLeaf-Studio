import { translate } from "@/lib/i18n";
import type { BlueprintValueFieldConfig } from "@/lib/ui-editor/widget-modules/shared/blueprint/BlueprintValueField";
import { createLabelSourceField } from "@/lib/ui-editor/widget-modules/shared/text/LabelSourceField";
import { createSampleTextField } from "@/lib/ui-editor/widget-modules/shared/text/SampleTextField";
import { requireUITextSite } from "@shared/types/ui-editor/textSource";
import { TextRunMarksEditor } from "@/lib/ui-editor/widget-modules/shared/text/TextRunMarks";
import { getTextProps, TEXT_MARKED_LABEL, TEXT_SITE } from "./helpers";

/** The text prop's Blueprint Value, as every text-shaped widget offers it. */
export const TEXT_BLUEPRINT_VALUE_CONFIG: BlueprintValueFieldConfig = {
    propPath: TEXT_SITE.textProp,
    valueType: "string",
    valueLabel: "text",
    title: "widgets.blueprintValue.textTitle",
    getDisplayName: ({ liveElement }) =>
        translate("widgets.blueprintValue.nameText", {
            name: liveElement.name ?? translate("widgets.defaults.text.name"),
        }),
    getLiteralValue: ({ liveElement }) => getTextProps(liveElement).text,
    renderLiteralEditor: ({ data, liveElement, readOnly }) => (
        <TextRunMarksEditor
            documentService={data.documentService}
            element={liveElement}
            label={TEXT_MARKED_LABEL}
            readOnly={readOnly}
        />
    ),
};

/**
 * The text widget's text, and where it comes from: its own words, a translation key, or a Blueprint
 * Value (`createLabelSourceField`).
 */
export const TextSourceField = createLabelSourceField({
    site: TEXT_SITE,
    blueprint: TEXT_BLUEPRINT_VALUE_CONFIG,
    label: TEXT_MARKED_LABEL,
    localizeLabel: "widgets.text.localizeText",
});

/**
 * The dialogue line's words: sample words the canvas shows, since the game draws the story's current
 * line in its place (`createSampleTextField`).
 */
export const DialogSentenceSampleTextField = createSampleTextField({
    site: requireUITextSite("nl.dialog.sentence"),
    label: TEXT_MARKED_LABEL,
    blueprint: TEXT_BLUEPRINT_VALUE_CONFIG,
});

/** The NVL line's words, on the same terms as the dialogue line's. */
export const NvlTextsSampleTextField = createSampleTextField({
    site: requireUITextSite("nl.nvl.texts"),
    label: TEXT_MARKED_LABEL,
    blueprint: TEXT_BLUEPRINT_VALUE_CONFIG,
});
