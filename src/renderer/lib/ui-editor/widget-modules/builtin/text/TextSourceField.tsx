import { translate } from "@/lib/i18n";
import type { BlueprintValueFieldConfig } from "@/lib/ui-editor/widget-modules/shared/blueprint/BlueprintValueField";
import { createLabelSourceField } from "@/lib/ui-editor/widget-modules/shared/text/LabelSourceField";
import { TextRunMarksEditor } from "@/lib/ui-editor/widget-modules/shared/text/TextRunMarks";
import { getTextProps, TEXT_MARKED_LABEL } from "./helpers";

/** The text prop's Blueprint Value, as every text-shaped widget offers it. */
export const TEXT_BLUEPRINT_VALUE_CONFIG: BlueprintValueFieldConfig = {
    propPath: "text",
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
    blueprint: TEXT_BLUEPRINT_VALUE_CONFIG,
    label: TEXT_MARKED_LABEL,
    getLocalizationKey: element => getTextProps(element).localizationKey,
    getLocalizable: element => Boolean(getTextProps(element).localizable),
    localizeLabel: "widgets.text.localizeText",
});
