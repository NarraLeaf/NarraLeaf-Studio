import { useEffect, useState, useSyncExternalStore } from "react";
import type { TranslationKey } from "@shared/i18n";
import type { UIElement } from "@shared/types/ui-editor/document";
import {
    readUITextSite,
    uiTextSourceOf,
    type UITextSite,
    type UITextSource,
} from "@shared/types/ui-editor/textSource";
import { uiTextSampleCauseOf } from "@shared/types/ui-editor/textSample";
import type { CustomFieldProps } from "@/apps/workspace/modules/properties/framework/types";
import { FIELD_INPUT_CLASS } from "@/apps/workspace/modules/properties/fieldControlClass";
import { selfReadOnly } from "@/apps/workspace/modules/properties/framework/fields/fieldReadOnlyStrategy";
import { FieldLabel } from "@/lib/components/elements/FieldLabel";
import { DraftTextInput } from "@/lib/components/inputs/DraftTextInput";
import { useTranslation } from "@/lib/i18n";
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
    ComponentParamBindingRow,
    ListItemFieldBindingRow,
    useBlueprintValueBinding,
    type BlueprintValueFieldConfig,
} from "@/lib/ui-editor/widget-modules/shared/blueprint/BlueprintValueField";
import { plainTextEditPatch, type MarkedLabelProps } from "./markedLabel";
import { LABEL_TEXT_AREA_CLASS, TextRunMarksEditor } from "./TextRunMarks";
import { TextWritersList, useElementTextWriters } from "./TextWritersList";
import { TextSourceSegments } from "./WordsSourceField";

/** What a widget tells the source field about where its words live. */
export type LabelSourceFieldConfig = {
    /** The site the words sit on (`textSites.ts`): the prop holding them and the prop naming their key. */
    site: UITextSite;
    /**
     * The words' Blueprint Value, when the widget offers one. Its `propPath` is the prop holding the
     * words (`text`, `label`) - the prop a value binding writes and a key replaces. Without one the
     * choice is between the element's own words and a key (a text input's placeholder).
     */
    blueprint?: BlueprintValueFieldConfig;
    /** How the words and their marks are read and written. */
    label: MarkedLabelProps;
    /** The words are one line: the boxes are single-line and carry no marks (a placeholder). */
    singleLine?: boolean;
    /**
     * The words carry no marks over several lines: the box is a plain multi-line one rather than the
     * marks editor (a plugin widget's prop, which its renderer is handed as a string).
     */
    withoutMarks?: boolean;
};

function liveElementOf(data: UIInspectorData): UIElement {
    return data.documentService.getDocument().elements[data.element.id] ?? data.element;
}

/**
 * A widget's words, and where they come from: the element's own, a translation key, or a Blueprint
 * Value - chosen in one field, one at a time. The text widget's text, the button's label, the
 * text input's placeholder (which offers no Blueprint Value) and every prop a plugin's widget declares
 * as words (`pluginTextSection.tsx`, no Blueprint Value either) are all this field.
 *
 * The choice is not stored; it is read off the element in the order the game resolves the words
 * (`uiTextSourceOf`). Choosing writes that order's answer: a key is set, or cleared, or a binding made.
 * The element's own words are translated whenever the project has a second language, so there is
 * nothing to switch on for them.
 *
 * Under a key the box edits the key's source text, which is what the game shows in the project's
 * source language and what the canvas draws. A key is shared, so the words change everywhere it is
 * used, as they do in the game.
 *
 * Inside a component's definition the words can also show one of the component's text parameters
 * (`ComponentParamBindingRow`), each placement giving its own - the component's counterpart of a list
 * row's field, picked the same way above the choice.
 *
 * Where a Blueprint Value or a component parameter answers the words, the element's own words are
 * sample text (`textSample.ts`): edited here, drawn on the canvas, and stated to be shown in the editor
 * only - a package carries none of them, and nothing translates them. The blueprints that write the
 * words while the game runs are listed under the field, each opening at its node (`TextWritersList`),
 * whatever the words' source.
 *
 * Read-only aware (`selfReadOnly`): on a frozen project the source row and the boxes are inert, while
 * the key list still opens to be read and a bound blueprint still opens to be looked at.
 */
export function createLabelSourceField(config: LabelSourceFieldConfig) {
    const { site } = config;
    const propPath = site.textProp;
    const keyProp = site.keyProp ?? "localizationKey";
    const keyOf = (element: UIElement) => readUITextSite(element, site).key;
    const ownWords = (element: UIElement) => config.label.read(element).text;

    /**
     * The patch that turns a keyed element back into one that holds its own words.
     *
     * The words are the key's, so the element keeps showing what it showed: switching where the
     * words come from does not change them. `localizationKey` is written as undefined, which a saved
     * document drops.
     */
    function leaveKeyPatch(data: UIInspectorData): Record<string, unknown> {
        const live = liveElementOf(data);
        const key = keyOf(live);
        const keyText = key ? getDesignTimeLocalizationKeys()?.[key] : undefined;
        return {
            ...(keyText !== undefined ? plainTextEditPatch(config.label, live, keyText) : {}),
            [keyProp]: undefined,
        };
    }

    /** Pick a key: the words are read from it from now on, and from nothing else. */
    function chooseKey(data: UIInspectorData, name: string | undefined): void {
        const live = liveElementOf(data);
        if (!name) {
            return;
        }
        const binding = live.valueBindings?.[propPath];
        if (binding?.kind === "blueprintValue") {
            data.documentService.clearElementBlueprintValueBinding(live.id, propPath);
        } else if (binding?.kind === "listItemField") {
            data.documentService.setElementListItemFieldBinding(live.id, propPath, null);
        } else if (binding?.kind === "componentParam") {
            data.documentService.setElementComponentParamBinding(live.id, propPath, null);
        }
        data.documentService.updateElementProps(live.id, { [keyProp]: name });
    }

    const KeyPicker = createLocalizationKeyField({
        getKey: keyOf,
        setKey: chooseKey,
        // Choosing no key is choosing another source, which the row above the picker does.
        allowNone: false,
        // A new key usually names the words the element already shows.
        getInitialSourceText: ownWords,
    });

    return selfReadOnly(function LabelSourceField(props: CustomFieldProps<UIInspectorData>) {
        const { t } = useTranslation();
        const { data } = props;
        const readOnly = props.readOnly === true || props.disabled === true;
        useUIDocumentRevision(data.documentService);
        const keys = useSyncExternalStore(
            subscribeDesignTimeLocalizationKeys,
            getDesignTimeLocalizationKeys,
            getDesignTimeLocalizationKeys,
        );
        const blueprintState = useBlueprintValueBinding(config.blueprint ?? null, data);
        const live = blueprintState.live;
        const source = uiTextSourceOf(live, site);
        const writers = useElementTextWriters(live.id);
        const sampleCause = uiTextSampleCauseOf(live, site);
        const writersList = <TextWritersList writers={writers} />;

        // "Translation key" picked before a key is: nothing is written until one is chosen, so the
        // element goes on being read from where it was. Forgotten on another element.
        const [pickingKey, setPickingKey] = useState(false);
        useEffect(() => setPickingKey(false), [live.id]);
        const shown: UITextSource | null = source === "key" ? "key" : pickingKey && source !== null ? "key" : source;

        // A list row's field answers the words through the same binding slot as a Blueprint Value, so
        // only a site that offers one offers the field too.
        const fieldRow = config.blueprint ? (
            <ListItemFieldBindingRow
                data={data}
                liveElement={live}
                propPath={propPath}
                valueType={config.blueprint.valueType}
                disabled={readOnly}
                onBound={fieldId => {
                    if (fieldId) {
                        setPickingKey(false);
                        data.documentService.updateElementProps(live.id, leaveKeyPatch(data));
                    }
                }}
            />
        ) : null;

        // One of the component's text parameters answers the words, a placement at a time.
        const paramRow = config.blueprint ? (
            <ComponentParamBindingRow
                data={data}
                liveElement={live}
                propPath={propPath}
                disabled={readOnly}
                onBound={paramId => {
                    if (paramId) {
                        setPickingKey(false);
                        data.documentService.updateElementProps(live.id, leaveKeyPatch(data));
                    }
                }}
            />
        ) : null;

        const choose = (next: UITextSource) => {
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
            if (source === "key") {
                data.documentService.updateElementProps(live.id, leaveKeyPatch(data));
            }
            blueprintState.create();
        };

        const key = keyOf(live);
        const keyText = source === "key" ? keys?.[key] ?? ownWords(live) : "";

        // The element's own words, in the box the site edits them in: as the words a player reads, or
        // as sample text where something else decides them.
        const ownWordsEditor = config.singleLine ? (
            <DraftTextInput
                className={`w-full ${FIELD_INPUT_CLASS}`}
                value={ownWords(live)}
                readOnly={readOnly}
                draftResetKey={live.id}
                readCommittedValue={() => ownWords(liveElementOf(data))}
                onCommit={next =>
                    data.documentService.updateElementProps(
                        live.id,
                        plainTextEditPatch(config.label, liveElementOf(data), next),
                    )
                }
            />
        ) : config.withoutMarks ? (
            <DraftTextInput
                multiline
                className={LABEL_TEXT_AREA_CLASS}
                value={ownWords(live)}
                rows={4}
                readOnly={readOnly}
                draftResetKey={live.id}
                readCommittedValue={() => ownWords(liveElementOf(data))}
                onCommit={next =>
                    data.documentService.updateElementProps(
                        live.id,
                        plainTextEditPatch(config.label, liveElementOf(data), next),
                    )
                }
            />
        ) : (
            <TextRunMarksEditor
                documentService={data.documentService}
                element={live}
                label={config.label}
                readOnly={readOnly}
            />
        );
        const sampleBlock = (hint: TranslationKey) => (
            <div className="space-y-1">
                <FieldLabel as="div">{t("widgets.sampleText.label")}</FieldLabel>
                {ownWordsEditor}
                <p className="text-xs text-fg-subtle">{t(hint)}</p>
            </div>
        );

        if (shown === null && sampleCause === "componentParam") {
            // Each placement draws the value it gives the parameter. The element's own words are what
            // this editor draws, where there is no placement, so they are edited as sample text.
            return (
                <div className="space-y-2">
                    {paramRow}
                    {fieldRow}
                    {sampleBlock("widgets.sampleText.hintComponentParam")}
                    {writersList}
                </div>
            );
        }

        if (shown === null) {
            // Bound to a field of its list row, which answers the words; the picker is the whole control.
            // The canvas draws the list's own rows there, which are the sample, so the element's own
            // words are offered nowhere.
            return (
                <div className="space-y-2">
                    {paramRow}
                    {fieldRow}
                    {writersList}
                </div>
            );
        }

        return (
            <div className="space-y-2">
                {paramRow}
                {fieldRow}
                <TextSourceSegments
                    value={shown}
                    onChange={choose}
                    disabled={readOnly}
                    blueprint={config.blueprint ? { unavailable: blueprintState.createUnavailable } : undefined}
                />
                {shown === "literal" ? ownWordsEditor : null}
                {shown === "key" ? (
                    <>
                        <KeyPicker {...props} readOnly={props.readOnly} />
                        {source === "key" ? (
                            <div>
                                <FieldLabel as="div">{t("widgets.localization.sourceText")}</FieldLabel>
                                <DraftTextInput
                                    multiline={!config.singleLine}
                                    className={config.singleLine ? `w-full ${FIELD_INPUT_CLASS}` : LABEL_TEXT_AREA_CLASS}
                                    value={keyText}
                                    rows={config.singleLine ? undefined : 4}
                                    readOnly={readOnly}
                                    draftResetKey={`${live.id}:${key}`}
                                    readCommittedValue={() => getDesignTimeLocalizationKeys()?.[key] ?? ownWords(liveElementOf(data))}
                                    onCommit={next => {
                                        writeDesignTimeLocalizationKeySourceText(key, next);
                                    }}
                                />
                            </div>
                        ) : null}
                    </>
                ) : null}
                {shown === "blueprint" && config.blueprint ? (
                    <>
                        <BlueprintValueBoundCard state={blueprintState} valueLabel={config.blueprint.valueLabel} />
                        {sampleBlock("widgets.sampleText.hintBlueprintValue")}
                    </>
                ) : null}
                {writersList}
            </div>
        );
    });
}
