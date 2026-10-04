import { useEffect, useState, useSyncExternalStore } from "react";
import type { TranslationKey } from "@shared/i18n";
import type { UIElement } from "@shared/types/ui-editor/document";
import {
    readUITextSite,
    uiTextSourceOf,
    type UITextSite,
    type UITextSource,
} from "@shared/types/ui-editor/textSource";
import type { CustomFieldProps } from "@/apps/workspace/modules/properties/framework/types";
import { FIELD_INPUT_CLASS } from "@/apps/workspace/modules/properties/fieldControlClass";
import { selfReadOnly } from "@/apps/workspace/modules/properties/framework/fields/fieldReadOnlyStrategy";
import { IconButtonSegGroup } from "@/apps/workspace/modules/properties/framework/fields/IconButtonSegGroup";
import { FieldLabel } from "@/lib/components/elements/FieldLabel";
import { Switch } from "@/lib/components/elements/Switch";
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
    ListItemFieldBindingRow,
    useBlueprintValueBinding,
    type BlueprintValueFieldConfig,
} from "@/lib/ui-editor/widget-modules/shared/blueprint/BlueprintValueField";
import { plainTextEditPatch, type MarkedLabelProps } from "./markedLabel";
import { LABEL_TEXT_AREA_CLASS, TextRunMarksEditor } from "./TextRunMarks";

/** What a widget tells the source field about where its words live. */
export type LabelSourceFieldConfig = {
    /**
     * The site the words sit on (`textSites.ts`): the prop holding them, the prop naming their key,
     * and the switch that translates the element's own words.
     */
    site: UITextSite;
    /**
     * The words' Blueprint Value, when the widget offers one. Its `propPath` is the prop holding the
     * words (`text`, `label`) - the prop a value binding writes and a key replaces. Without one the
     * choice is between the element's own words and a key (a text input's placeholder).
     */
    blueprint?: BlueprintValueFieldConfig;
    /** How the words and their marks are read and written. */
    label: MarkedLabelProps;
    /**
     * The switch under the element's own words that translates them through its own unit (`Localize
     * text`, `Localize label`), for a site that has one.
     */
    localizeLabel?: TranslationKey;
    /** The words are one line: the boxes are single-line and carry no marks (a placeholder). */
    singleLine?: boolean;
};

function liveElementOf(data: UIInspectorData): UIElement {
    return data.documentService.getDocument().elements[data.element.id] ?? data.element;
}

/**
 * A widget's words, and where they come from: the element's own, a translation key, or a Blueprint
 * Value - chosen in one field, one at a time. The text widget's text, the button's label and the
 * text input's placeholder (which offers no Blueprint Value) are all this field.
 *
 * The choice is not stored; it is read off the element in the order the game resolves the words
 * (`uiTextSourceOf`), so a document written before this control existed opens on the source its game
 * already shows. Choosing writes that order's answer: a key is set, or cleared, or a binding made.
 *
 * Under a key the box edits the key's source text, which is what the game shows in the project's
 * source language and what the canvas draws. A key is shared, so the words change everywhere it is
 * used, as they do in the game.
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

    /**
     * The "localize" switch belongs to the element's own words: it translates them through the
     * element's own unit. Under a key or a Blueprint Value it would be a setting nobody can see - and
     * under a Blueprint Value one that replaces the bound words with a translation of words nothing
     * shows.
     */
    function leaveLiteralPatch(data: UIInspectorData): Record<string, unknown> {
        return site.unitProp && readUITextSite(liveElementOf(data), site).localizable ? { [site.unitProp]: undefined } : {};
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
        }
        data.documentService.updateElementProps(live.id, { ...leaveLiteralPatch(data), [keyProp]: name });
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
        const keysApply = keys !== null;
        const blueprintState = useBlueprintValueBinding(config.blueprint ?? null, data);
        const live = blueprintState.live;
        const source = uiTextSourceOf(live, site, keysApply);

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
                        data.documentService.updateElementProps(live.id, { ...leaveKeyPatch(data), ...leaveLiteralPatch(data) });
                    }
                }}
            />
        ) : null;

        if (shown === null) {
            // Bound to a field of its list row, which answers the words; the picker is the whole control.
            return <div className="space-y-2">{fieldRow}</div>;
        }

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
            const patch = { ...(source === "key" ? leaveKeyPatch(data) : {}), ...leaveLiteralPatch(data) };
            if (Object.keys(patch).length > 0) {
                data.documentService.updateElementProps(live.id, patch);
            }
            blueprintState.create();
        };

        const key = keyOf(live);
        const keyText = source === "key" ? keys?.[key] ?? ownWords(live) : "";

        return (
            <div className="space-y-2">
                {fieldRow}
                {/* Words without icons: up to three worded segments have to share the inspector's column
                    in every interface language, and "Translation key" with an icon beside it wraps. */}
                <IconButtonSegGroup
                    mode="single"
                    density="compact"
                    segmentWidth="content"
                    value={shown}
                    disabled={readOnly}
                    onChange={next => {
                        if (typeof next === "string") {
                            choose(next as UITextSource);
                        }
                    }}
                    options={[
                        {
                            id: "literal",
                            icon: null,
                            label: t("widgets.localization.direct"),
                        },
                        {
                            id: "key",
                            icon: null,
                            label: t("widgets.localization.translationKey"),
                            disabled: !keysApply,
                            tip: keysApply ? undefined : t("widgets.localization.noSourceLanguage"),
                        },
                        ...(config.blueprint
                            ? [{
                                id: "blueprint",
                                icon: null,
                                label: t("widgetChrome.blueprint.blueprintValue"),
                                disabled: shown !== "blueprint" && blueprintState.createUnavailable !== null,
                                tip: shown !== "blueprint" && blueprintState.createUnavailable
                                    ? blueprintState.createUnavailable
                                    : undefined,
                            }]
                            : []),
                    ]}
                />
                {shown === "literal" ? (
                    <>
                        {config.singleLine ? (
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
                        ) : (
                            <TextRunMarksEditor
                                documentService={data.documentService}
                                element={live}
                                label={config.label}
                                readOnly={readOnly}
                            />
                        )}
                        {site.unitProp && config.localizeLabel ? (
                            <div className="flex items-center gap-2">
                                <Switch
                                    size="sm"
                                    checked={readUITextSite(live, site).localizable}
                                    disabled={readOnly}
                                    aria-label={t(config.localizeLabel)}
                                    onCheckedChange={checked =>
                                        data.documentService.updateElementProps(live.id, { [site.unitProp as string]: checked })
                                    }
                                />
                                <span className="text-sm text-fg-muted">{t(config.localizeLabel)}</span>
                            </div>
                        ) : null}
                    </>
                ) : null}
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
                    <BlueprintValueBoundCard state={blueprintState} valueLabel={config.blueprint.valueLabel} />
                ) : null}
            </div>
        );
    });
}
