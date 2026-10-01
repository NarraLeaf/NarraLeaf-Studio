import { useEffect, useState, useSyncExternalStore } from "react";
import type { CustomFieldProps } from "@/apps/workspace/modules/properties/framework/types";
import { selfReadOnly } from "@/apps/workspace/modules/properties/framework/fields/fieldReadOnlyStrategy";
import { IconButtonSegGroup } from "@/apps/workspace/modules/properties/framework/fields/IconButtonSegGroup";
import { FieldLabel } from "@/lib/components/elements/FieldLabel";
import { Switch } from "@/lib/components/elements/Switch";
import { DraftTextInput } from "@/lib/components/inputs/DraftTextInput";
import { useTranslation, translate } from "@/lib/i18n";
import { useUIDocumentRevision } from "@/lib/ui-editor/hooks/useUIDocumentRevision";
import {
    getDesignTimeLocalizationKeys,
    subscribeDesignTimeLocalizationKeys,
    writeDesignTimeLocalizationKeySourceText,
} from "@/lib/ui-editor/runtime/localization/designTimeKeys";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { createLocalizationKeyField } from "@/lib/ui-editor/widget-modules/shared/LocalizationKeyField";
import {
    BlueprintValueBoundCard,
    ListItemFieldBindingRow,
    useBlueprintValueBinding,
    type BlueprintValueFieldConfig,
} from "@/lib/ui-editor/widget-modules/shared/blueprint/BlueprintValueField";
import { LABEL_TEXT_AREA_CLASS, TextRunMarksEditor } from "@/lib/ui-editor/widget-modules/shared/text/TextRunMarks";
import { getTextProps, TEXT_MARKED_LABEL, textSourceOf, textValuePatch, type TextSource } from "./helpers";

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

function liveElementOf(data: UIInspectorData) {
    return data.documentService.getDocument().elements[data.element.id] ?? data.element;
}

/**
 * The patch that turns a keyed text back into one that holds its own words.
 *
 * The words are the key's, so the element keeps showing what it showed: switching where the text
 * comes from does not change the text. `localizationKey` is written as undefined, which a saved
 * document drops.
 */
function leaveKeyPatch(data: UIInspectorData): Record<string, unknown> {
    const live = liveElementOf(data);
    const key = getTextProps(live).localizationKey?.trim();
    const keyText = key ? getDesignTimeLocalizationKeys()?.[key] : undefined;
    return {
        ...(keyText !== undefined ? textValuePatch(live, keyText) : {}),
        localizationKey: undefined,
    };
}

/**
 * "Localize text" belongs to the element's own words: it translates them through the element's own
 * unit. Under a key or a Blueprint Value it would be a setting nobody can see - and under a
 * Blueprint Value one that replaces the bound text with a translation of words nothing shows.
 */
function leaveLiteralPatch(data: UIInspectorData): Record<string, unknown> {
    return getTextProps(liveElementOf(data)).localizable ? { localizable: undefined } : {};
}

/** Pick a key: the text is read from it from now on, and from nothing else. */
function chooseKey(data: UIInspectorData, name: string | undefined): void {
    const live = liveElementOf(data);
    if (!name) {
        return;
    }
    const binding = live.valueBindings?.text;
    if (binding?.kind === "blueprintValue") {
        data.documentService.clearElementBlueprintValueBinding(live.id, "text");
    } else if (binding?.kind === "listItemField") {
        data.documentService.setElementListItemFieldBinding(live.id, "text", null);
    }
    data.documentService.updateElementProps(live.id, { ...leaveLiteralPatch(data), localizationKey: name });
}

const TextKeyPicker = createLocalizationKeyField({
    getKey: element => getTextProps(element).localizationKey ?? "",
    setKey: chooseKey,
    // Choosing no key is choosing another source, which the row above the picker does.
    allowNone: false,
    // A new key usually names the words the element already shows.
    getInitialSourceText: element => getTextProps(element).text,
});

/**
 * The text widget's text, and where it comes from: one of the element's own words, a translation
 * key, or a Blueprint Value - chosen here, one at a time.
 *
 * The choice is not stored; it is read off the element in the order the game resolves a text
 * (`textSourceOf`), so a document written before this control existed opens on the source its game
 * already shows. Choosing writes that order's answer: a key is set, or cleared, or a binding made.
 *
 * Under a key the box edits the key's source text, which is what the game shows in the project's
 * source language and what the canvas draws. A key is shared, so the words change everywhere it is
 * used, as they do in the game.
 *
 * Read-only aware (`selfReadOnly`): on a frozen project the source row and the boxes are inert, while
 * the key list still opens to be read and a bound blueprint still opens to be looked at.
 */
export const TextSourceField = selfReadOnly(function TextSourceField(props: CustomFieldProps<UIInspectorData>) {
    const { t } = useTranslation();
    const { data } = props;
    const readOnly = props.readOnly === true || props.disabled === true;
    useUIDocumentRevision(data.documentService);
    const keys = useSyncExternalStore(
        subscribeDesignTimeLocalizationKeys,
        getDesignTimeLocalizationKeys,
        getDesignTimeLocalizationKeys,
    );
    const keysApply = keys !== null;
    const blueprintState = useBlueprintValueBinding(TEXT_BLUEPRINT_VALUE_CONFIG, data);
    const live = blueprintState.live;
    const source = textSourceOf(live, keysApply);

    // "Translation key" picked before a key is: nothing is written until one is chosen, so the
    // element goes on being read from where it was. Forgotten on another element.
    const [pickingKey, setPickingKey] = useState(false);
    useEffect(() => setPickingKey(false), [live.id]);
    const shown: TextSource | null = source === "key" ? "key" : pickingKey && source !== null ? "key" : source;

    const fieldRow = (
        <ListItemFieldBindingRow
            data={data}
            liveElement={live}
            propPath="text"
            valueType="string"
            disabled={readOnly}
            onBound={fieldId => {
                if (fieldId) {
                    setPickingKey(false);
                    data.documentService.updateElementProps(live.id, { ...leaveKeyPatch(data), ...leaveLiteralPatch(data) });
                }
            }}
        />
    );

    if (shown === null) {
        // Bound to a field of its list row, which answers the text; the picker is the whole control.
        return <div className="space-y-2">{fieldRow}</div>;
    }

    const choose = (next: TextSource) => {
        if (next === shown) {
            return;
        }
        if (next === "key") {
            setPickingKey(true);
            return;
        }
        setPickingKey(false);
        if (next === "literal") {
            if (source === "key") {
                data.documentService.updateElementProps(live.id, leaveKeyPatch(data));
            } else if (source === "blueprint") {
                blueprintState.clear();
            }
            return;
        }
        // Blueprint Value: the blueprint's literal starts from the words the element shows.
        const patch = { ...(source === "key" ? leaveKeyPatch(data) : {}), ...leaveLiteralPatch(data) };
        if (Object.keys(patch).length > 0) {
            data.documentService.updateElementProps(live.id, patch);
        }
        blueprintState.create();
    };

    const key = getTextProps(live).localizationKey?.trim() ?? "";
    const keyText = source === "key" ? keys?.[key] ?? getTextProps(live).text : "";

    return (
        <div className="space-y-2">
            {fieldRow}
            {/* Words without icons: three worded segments have to share the inspector's column in
                every interface language, and "Translation key" with an icon beside it wraps. */}
            <IconButtonSegGroup
                mode="single"
                density="compact"
                segmentWidth="content"
                value={shown}
                disabled={readOnly}
                onChange={next => {
                    if (typeof next === "string") {
                        choose(next as TextSource);
                    }
                }}
                options={[
                    {
                        id: "literal",
                        icon: null,
                        label: t("widgetChrome.blueprint.literal"),
                    },
                    {
                        id: "key",
                        icon: null,
                        label: t("widgets.localization.translationKey"),
                        disabled: !keysApply,
                        tip: keysApply ? undefined : t("widgets.localization.noSourceLanguage"),
                    },
                    {
                        id: "blueprint",
                        icon: null,
                        label: t("widgetChrome.blueprint.blueprintValue"),
                        disabled: shown !== "blueprint" && blueprintState.createUnavailable !== null,
                        tip: shown !== "blueprint" && blueprintState.createUnavailable
                            ? blueprintState.createUnavailable
                            : undefined,
                    },
                ]}
            />
            {shown === "literal" ? (
                <>
                    <TextRunMarksEditor
                        documentService={data.documentService}
                        element={live}
                        label={TEXT_MARKED_LABEL}
                        readOnly={readOnly}
                    />
                    <div className="flex items-center gap-2">
                        <Switch
                            size="sm"
                            checked={Boolean(getTextProps(live).localizable)}
                            disabled={readOnly}
                            aria-label={t("widgets.text.localizeText")}
                            onCheckedChange={checked =>
                                data.documentService.updateElementProps(live.id, { localizable: checked })
                            }
                        />
                        <span className="text-sm text-fg-muted">{t("widgets.text.localizeText")}</span>
                    </div>
                </>
            ) : null}
            {shown === "key" ? (
                <>
                    <TextKeyPicker {...props} readOnly={props.readOnly} />
                    {source === "key" ? (
                        <div>
                            <FieldLabel as="div">{t("widgets.localization.sourceText")}</FieldLabel>
                            <DraftTextInput
                                multiline
                                className={LABEL_TEXT_AREA_CLASS}
                                value={keyText}
                                rows={4}
                                readOnly={readOnly}
                                draftResetKey={`${live.id}:${key}`}
                                readCommittedValue={() => getDesignTimeLocalizationKeys()?.[key] ?? getTextProps(liveElementOf(data)).text}
                                onCommit={next => {
                                    writeDesignTimeLocalizationKeySourceText(key, next);
                                }}
                            />
                        </div>
                    ) : null}
                </>
            ) : null}
            {shown === "blueprint" ? <BlueprintValueBoundCard state={blueprintState} valueLabel="text" /> : null}
        </div>
    );
});
