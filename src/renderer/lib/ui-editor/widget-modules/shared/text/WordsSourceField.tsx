import { useEffect, useState, useSyncExternalStore } from "react";
import type { UITextSource } from "@shared/types/ui-editor/textSource";
import { FIELD_INPUT_CLASS } from "@/apps/workspace/modules/properties/fieldControlClass";
import { IconButtonSegGroup } from "@/apps/workspace/modules/properties/framework/fields/IconButtonSegGroup";
import { FieldLabel } from "@/lib/components/elements/FieldLabel";
import { DraftTextInput } from "@/lib/components/inputs/DraftTextInput";
import { useTranslation } from "@/lib/i18n";
import {
    getDesignTimeLocalizationKeys,
    subscribeDesignTimeLocalizationKeys,
    writeDesignTimeLocalizationKeySourceText,
} from "@/lib/ui-editor/runtime/localization/designTimeKeys";
import { LocalizationKeyPicker } from "../LocalizationKeyField";
import { LABEL_TEXT_AREA_CLASS } from "./TextRunMarks";

/**
 * The row that says where words come from - written directly, a translation key, and on a site that
 * offers one a Blueprint Value - in the same words wherever words are written: a widget's inspector
 * (`LabelSourceField`) and a plugin's own editor (`WordsSourceField`).
 */
export function TextSourceSegments({
    value,
    onChange,
    disabled,
    blueprint,
}: {
    value: UITextSource;
    onChange: (next: UITextSource) => void;
    disabled?: boolean;
    /** Offered when the site takes a Blueprint Value; `unavailable` says why it cannot be chosen now. */
    blueprint?: { unavailable: string | null };
}) {
    const { t } = useTranslation();
    return (
        // Words without icons: up to three worded segments have to share the inspector's column in
        // every interface language, and "Translation key" with an icon beside it wraps.
        <IconButtonSegGroup
            mode="single"
            density="compact"
            segmentWidth="content"
            value={value}
            disabled={disabled}
            onChange={next => {
                if (typeof next === "string") {
                    onChange(next as UITextSource);
                }
            }}
            options={[
                { id: "literal", icon: null, label: t("widgets.localization.direct") },
                { id: "key", icon: null, label: t("widgets.localization.translationKey") },
                ...(blueprint
                    ? [{
                        id: "blueprint",
                        icon: null,
                        label: t("widgetChrome.blueprint.blueprintValue"),
                        disabled: value !== "blueprint" && blueprint.unavailable !== null,
                        tip: value !== "blueprint" && blueprint.unavailable ? blueprint.unavailable : undefined,
                    }]
                    : []),
            ]}
        />
    );
}

/** Words as a plugin keeps them: written directly, or read from a translation key - one of the two. */
export type WordsSourceValue = {
    /** The words written directly; with a key, what shows if the key is not in the running game. */
    text: string;
    /** The translation key the words are read from, or null for words written directly. */
    key: string | null;
};

export type WordsSourceFieldProps = {
    value: WordsSourceValue;
    onChange: (next: WordsSourceValue) => void;
    /** Words over several lines; one line when absent. */
    multiline?: boolean;
    disabled?: boolean;
    /** Resets the box's draft when it changes - the id of whatever the words belong to. */
    draftResetKey?: string;
};

/**
 * Words a player reads, as a plugin's own editor writes them: the choice Studio's text and button
 * labels offer (`TextSourceSegments`), the project's keys with "Create new key…" (`LocalizationKeyPicker`)
 * and a key's source words edited in place, held by whoever passes `value` and `onChange`.
 *
 * Choosing a key writes the key's words beside it, as the net a running game shows if the key is not in
 * it; leaving a key writes the key's words as the words written directly. Either way, switching where
 * the words come from does not change what they say.
 */
export function WordsSourceField({ value, onChange, multiline, disabled, draftResetKey }: WordsSourceFieldProps) {
    const { t } = useTranslation();
    const keys = useSyncExternalStore(
        subscribeDesignTimeLocalizationKeys,
        getDesignTimeLocalizationKeys,
        getDesignTimeLocalizationKeys,
    );
    const source: UITextSource = value.key ? "key" : "literal";
    // "Translation key" picked before a key is: nothing is written until one is chosen.
    const [pickingKey, setPickingKey] = useState(false);
    useEffect(() => setPickingKey(false), [draftResetKey]);
    const shown: UITextSource = source === "key" || pickingKey ? "key" : "literal";

    const choose = (next: UITextSource) => {
        if (next === shown) {
            return;
        }
        if (next === "key") {
            setPickingKey(true);
            return;
        }
        setPickingKey(false);
        if (value.key) {
            const keyText = getDesignTimeLocalizationKeys()?.[value.key];
            onChange({ text: keyText ?? value.text, key: null });
        }
    };

    const keyText = value.key ? keys?.[value.key] ?? value.text : "";

    return (
        <div className="space-y-2">
            <TextSourceSegments value={shown} onChange={choose} disabled={disabled} />
            {shown === "literal" ? (
                <DraftTextInput
                    multiline={multiline}
                    className={multiline ? LABEL_TEXT_AREA_CLASS : `w-full ${FIELD_INPUT_CLASS}`}
                    rows={multiline ? 3 : undefined}
                    value={value.text}
                    disabled={disabled}
                    draftResetKey={draftResetKey}
                    onCommit={next => onChange({ text: next, key: null })}
                />
            ) : (
                <>
                    <LocalizationKeyPicker
                        value={value.key ?? ""}
                        allowNone={false}
                        initialSourceText={() => value.text}
                        disabled={disabled}
                        onChoose={name => {
                            if (name) {
                                setPickingKey(false);
                                // The words beside the key are the ones it shows now, so a game
                                // without the key, and a title that names the row, say the same.
                                onChange({ text: getDesignTimeLocalizationKeys()?.[name] ?? value.text, key: name });
                            }
                        }}
                    />
                    {value.key ? (
                        <div>
                            <FieldLabel as="div">{t("widgets.localization.sourceText")}</FieldLabel>
                            <DraftTextInput
                                multiline={multiline}
                                className={multiline ? LABEL_TEXT_AREA_CLASS : `w-full ${FIELD_INPUT_CLASS}`}
                                rows={multiline ? 3 : undefined}
                                value={keyText}
                                disabled={disabled}
                                draftResetKey={`${draftResetKey ?? ""}:${value.key}`}
                                readCommittedValue={() => getDesignTimeLocalizationKeys()?.[value.key ?? ""] ?? value.text}
                                onCommit={next => {
                                    if (value.key) {
                                        writeDesignTimeLocalizationKeySourceText(value.key, next);
                                    }
                                }}
                            />
                        </div>
                    ) : null}
                </>
            )}
        </div>
    );
}
