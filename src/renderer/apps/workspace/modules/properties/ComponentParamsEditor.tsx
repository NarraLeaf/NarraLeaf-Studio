/**
 * The two halves of component params in the inspector: declaring them on the definition, and
 * supplying them on one placement.
 *
 * They live in one file because they are one contract read from both ends - the declare side's
 * `defaultValue` is what the supply side falls back to, and the supply side's field list is exactly
 * what the declare side wrote. Splitting them would put the two spellings of that list in two
 * places.
 *
 * A text parameter (`type: "text"`) is words a player reads, and a placement gives it the way a
 * text's words are given: written directly, or as a translation key, chosen with the same choice and
 * the same key picker a text's inspector offers (`TextParamValueField`). An audio track parameter
 * (`type: "audioTrack"`) is picked from the project's tracks by name (`AudioTrackParamValueField`):
 * its stored value is the track's id, which for a track the author made is a UUID nobody should type.
 *
 * Comments in English per project convention.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ComponentType } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
    getUIComponentLink,
    getUIComponentParams,
    isUIComponentAudioTrackParam,
    isUIComponentTextParam,
    readUIComponentParamType,
    type UIComponentDefinition,
    type UIComponentParam,
} from "@shared/types/ui-editor/document";
import { audioTrackDisplayName, type ProjectAudioTrack } from "@shared/types/audioTrack";
import { useProjectAudioTracks } from "@/lib/ui-editor/widget-modules/shared/sound/useProjectAudioTracks";
// SectionCard is missing from the elements barrel, so it comes from its own module.
import { FieldLabel, IconButton, Input } from "@/lib/components/elements";
import { SectionCard } from "@/lib/components/elements/SectionCard";
import { Select } from "@/lib/components/elements/Select";
import { DraftTextInput } from "@/lib/components/inputs/DraftTextInput";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { createLocalizationKeyField } from "@/lib/ui-editor/widget-modules/shared/LocalizationKeyField";
import { LABEL_TEXT_AREA_CLASS } from "@/lib/ui-editor/widget-modules/shared/text/TextRunMarks";
import {
    getDesignTimeLocalizationKeys,
    subscribeDesignTimeLocalizationKeys,
    writeDesignTimeLocalizationKeySourceText,
} from "@/lib/ui-editor/runtime/localization/designTimeKeys";
import { useTranslation } from "@/lib/i18n";
import { formatBlueprintValueTypeLabel } from "@/lib/ui-editor/blueprint-nodes/structTypeLabels";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { IconButtonSegGroup } from "./framework/fields/IconButtonSegGroup";
import type { CustomFieldProps } from "./framework/types";
import { interfaceDocumentFreezeScope } from "../ui-editor/uiLiveSession";

/**
 * A text field that keeps what is typed and commits it when focus leaves - the same bargain the
 * inspector's other text fields make.
 *
 * Not a nicety here: `setComponentParams` trims what it stores, so a per-keystroke write would echo
 * "Save " back as "Save" and the author could never type a space into a param name at all.
 */
export function DraftInput({
    value,
    placeholder,
    disabled,
    title,
    ariaLabel,
    onCommit,
}: {
    value: string;
    placeholder?: string;
    disabled?: boolean;
    title?: string;
    ariaLabel?: string;
    onCommit: (next: string) => void;
}) {
    const [draft, setDraft] = useState(value);
    const [editing, setEditing] = useState(false);

    /**
     * An edit elsewhere should land in the field - but not on top of what is being typed into it.
     *
     * `editing` is state rather than a ref so that leaving the field re-runs this: the write is
     * normalised on the way in (names are trimmed), and when the normalised result equals what was
     * already stored, `value` does not change and nothing else would put the field back.
     */
    useEffect(() => {
        if (!editing) {
            setDraft(value);
        }
    }, [editing, value]);

    return (
        <Input
            size="sm"
            fullWidth
            className="min-w-0"
            value={draft}
            placeholder={placeholder}
            disabled={disabled}
            data-tip={title}
            aria-label={ariaLabel}
            onFocus={() => setEditing(true)}
            onChange={event => setDraft(event.target.value)}
            onBlur={() => {
                setEditing(false);
                if (draft !== value) {
                    onCommit(draft);
                }
            }}
            onKeyDown={event => {
                if (event.key === "Enter") {
                    event.currentTarget.blur();
                }
            }}
        />
    );
}

/**
 * A fresh param id.
 *
 * Generated rather than typed because the id is what a blueprint node and every instance value point
 * at: if the author edited it, renaming a param in the inspector would silently unpoint both. The
 * name is the editable half and carries no identity at all.
 */
function nextParamId(existing: UIComponentParam[]): string {
    const taken = new Set(existing.map(param => param.id));
    for (let index = 1; ; index++) {
        const id = `param${index}`;
        if (!taken.has(id)) {
            return id;
        }
    }
}

export function ComponentParamsEditor({
    component,
    documentService,
}: {
    component: UIComponentDefinition;
    documentService: UIDocumentService;
}) {
    const { t } = useTranslation();
    const freeze = useFreezeGuard(interfaceDocumentFreezeScope());
    // Keyed on the list as well as the definition: the document is edited in place, so the definition
    // is the same object after an edit, and only its `params` array is replaced.
    const params = useMemo(() => getUIComponentParams(component), [component, component.params]);

    const write = useCallback(
        (next: UIComponentParam[]) => {
            documentService.setComponentParams(component.id, next);
        },
        [component.id, documentService],
    );

    const patchParam = useCallback(
        (id: string, patch: Partial<UIComponentParam>) => {
            write(params.map(param => (param.id === id ? { ...param, ...patch } : param)));
        },
        [params, write],
    );

    const typeOptions = (["string", "text", "audioTrack"] as const).map(type => ({
        value: type,
        label: formatBlueprintValueTypeLabel(type, t, "option"),
    }));

    return (
        <SectionCard
            title={t("properties.componentParams.title")}
            actions={
                <IconButton
                    size="sm"
                    aria-label={t("properties.componentParams.add")}
                    {...freeze.writes(false, t("properties.componentParams.add"))}
                    onClick={() =>
                        write([
                            ...params,
                            { id: nextParamId(params), name: "", type: "string", defaultValue: "" },
                        ])
                    }
                >
                    <Plus className="h-4 w-4" />
                </IconButton>
            }
            bodyClassName="space-y-3"
        >
            {params.length === 0 ? (
                <p className="text-2xs text-fg-subtle">{t("properties.componentParams.none")}</p>
            ) : (
                params.map(param => (
                    <div key={param.id} className="space-y-1.5">
                        <div className="flex items-center gap-2">
                            <DraftInput
                                value={param.name}
                                placeholder={t("properties.componentParams.namePlaceholder")}
                                {...freeze.writes()}
                                onCommit={next => patchParam(param.id, { name: next })}
                            />
                            {/* What the parameter holds. A string reaches the definition through a
                                blueprint; text is words a widget inside it can show, translated per
                                placement; an audio track is a track's id, picked by name. Switching
                                keeps every value: all three are stored as strings. */}
                            <Select
                                size="sm"
                                className="w-24 shrink-0"
                                value={readUIComponentParamType(param)}
                                options={typeOptions}
                                portalMenu
                                ariaLabel={t("properties.componentParams.type")}
                                disabled={freeze.frozen}
                                onChange={value => patchParam(param.id, { type: readUIComponentParamType({ type: value }) })}
                            />
                            <IconButton
                                size="sm"
                                className="shrink-0"
                                aria-label={t("properties.componentParams.remove")}
                                {...freeze.writes(false, t("properties.componentParams.remove"))}
                                onClick={() => write(params.filter(item => item.id !== param.id))}
                            >
                                <Trash2 className="h-4 w-4" />
                            </IconButton>
                        </div>
                        {isUIComponentAudioTrackParam(param) ? (
                            <AudioTrackDefaultField
                                value={param.defaultValue}
                                disabled={freeze.frozen}
                                onChange={next => patchParam(param.id, { defaultValue: next })}
                            />
                        ) : (
                            <DraftInput
                                value={param.defaultValue}
                                placeholder={t("properties.componentParams.defaultPlaceholder")}
                                ariaLabel={t("properties.componentParams.defaultPlaceholder")}
                                {...freeze.writes()}
                                onCommit={next => patchParam(param.id, { defaultValue: next })}
                            />
                        )}
                    </div>
                ))
            )}
        </SectionCard>
    );
}

/**
 * The key picker for one text parameter of the selected placement - the same picker a text's
 * inspector uses, reading and writing the placement's `paramKeys` instead of a widget's prop.
 *
 * One per param id, made once: the picker is a component, and a fresh one each render would remount
 * it (and its open create-key dialog) on every keystroke elsewhere in the panel.
 */
const keyPickerByParam = new Map<string, ComponentType<CustomFieldProps<UIInspectorData>>>();

function keyPickerFor(paramId: string): ComponentType<CustomFieldProps<UIInspectorData>> {
    let picker = keyPickerByParam.get(paramId);
    if (!picker) {
        picker = createLocalizationKeyField({
            getKey: element => getUIComponentLink(element)?.paramKeys?.[paramId] ?? "",
            setKey: (data, name) => {
                if (name) {
                    data.documentService.setComponentInstanceParamKey(data.element.id, paramId, name);
                }
            },
            // Choosing no key is choosing to write the words directly, which the row above does.
            allowNone: false,
            // A new key usually names the words the placement already shows.
            getInitialSourceText: element => getUIComponentLink(element)?.params?.[paramId] ?? "",
        });
        keyPickerByParam.set(paramId, picker);
    }
    return picker;
}

/** The tracks as select options, by name, with the stored value kept when it names no track. */
function audioTrackOptions(
    tracks: readonly ProjectAudioTrack[],
    stored: string,
    t: ReturnType<typeof useTranslation>["t"],
): { value: string; label: string }[] {
    const options = tracks.map(track => ({ value: track.id, label: audioTrackDisplayName(track, t) }));
    if (!tracks.some(track => track.id === stored)) {
        // A track that has been deleted, or none chosen yet: said in words, never as the stored id.
        options.unshift({
            value: stored,
            label: stored ? t("properties.componentParams.trackMissing") : t("properties.componentParams.trackNone"),
        });
    }
    return options;
}

/** The track an audio track parameter falls back to, picked from the project's tracks. */
function AudioTrackDefaultField({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (next: string) => void }) {
    const { t } = useTranslation();
    const tracks = useProjectAudioTracks();
    return (
        <Select
            size="sm"
            fullWidth
            value={value}
            options={audioTrackOptions(tracks, value, t)}
            portalMenu
            ariaLabel={t("properties.componentParams.defaultPlaceholder")}
            disabled={disabled}
            onChange={next => onChange(String(next))}
        />
    );
}

/** The select value standing for "no value of its own": the definition's default applies. */
const TRACK_PARAM_INHERIT = "__inherit__";

/**
 * One audio track parameter of the selected placement, picked from the project's tracks by name.
 *
 * The first option is the definition's default, named after the track it is, which is what a
 * placement that has chosen nothing plays on; choosing it again removes the placement's own value
 * rather than copying the default's id, so the placement keeps following the definition.
 */
function AudioTrackParamValueField({
    data,
    param,
    readOnly,
}: {
    data: UIInspectorData;
    param: UIComponentParam;
    readOnly: boolean;
}) {
    const { t } = useTranslation();
    const tracks = useProjectAudioTracks();
    const live = data.documentService.getDocument().elements[data.element.id] ?? data.element;
    const supplied = getUIComponentLink(live)?.params?.[param.id];
    const label = param.name.trim() || param.id;
    const defaultTrack = tracks.find(track => track.id === param.defaultValue);
    const inherit = {
        value: TRACK_PARAM_INHERIT,
        label: t("storyInspector.audio.trackDefault", {
            name: defaultTrack
                ? audioTrackDisplayName(defaultTrack, t)
                : t(param.defaultValue ? "properties.componentParams.trackMissing" : "properties.componentParams.trackNone"),
        }),
    };
    const own = typeof supplied === "string" && supplied ? supplied : null;
    const options = [inherit, ...audioTrackOptions(tracks, own ?? "", t).filter(option => own || option.value !== "")];
    return (
        <div>
            <FieldLabel as="div">{label}</FieldLabel>
            <Select
                size="sm"
                fullWidth
                value={own ?? TRACK_PARAM_INHERIT}
                options={options}
                portalMenu
                ariaLabel={label}
                disabled={readOnly}
                onChange={next => {
                    const value = String(next);
                    if (value === TRACK_PARAM_INHERIT) {
                        // Neither words nor a key: the placement falls back to the definition's default.
                        data.documentService.setComponentInstanceParamKey(live.id, param.id, null);
                    } else {
                        data.documentService.setComponentInstanceParam(live.id, param.id, value);
                    }
                }}
            />
        </div>
    );
}

type TextParamSource = "literal" | "key";

/**
 * One text parameter's value on the selected placement: written directly or read from a translation
 * key, the choice a text's words make (`createLabelSourceField`), with the same two labels and the
 * same key picker. A placement that has written nothing shows the definition's default in the box,
 * as a placeholder. Under a key the box below the picker edits the key's source text, which every
 * user of the key shows.
 */
function TextParamValueField({
    data,
    param,
    readOnly,
}: {
    data: UIInspectorData;
    param: UIComponentParam;
    readOnly: boolean;
}) {
    const { t } = useTranslation();
    const keys = useSyncExternalStore(
        subscribeDesignTimeLocalizationKeys,
        getDesignTimeLocalizationKeys,
        getDesignTimeLocalizationKeys,
    );
    const live = data.documentService.getDocument().elements[data.element.id] ?? data.element;
    const link = getUIComponentLink(live);
    const key = link?.paramKeys?.[param.id] ?? "";
    const words = link?.params?.[param.id];
    // "Translation key" picked before a key is: nothing is written until one is chosen.
    const [pickingKey, setPickingKey] = useState(false);
    useEffect(() => setPickingKey(false), [live.id, param.id]);
    const shown: TextParamSource = key || pickingKey ? "key" : "literal";
    const KeyPicker = keyPickerFor(param.id);
    const label = param.name.trim() || param.id;

    const choose = (next: TextParamSource) => {
        if (next === shown) {
            return;
        }
        if (next === "key") {
            setPickingKey(true);
            return;
        }
        setPickingKey(false);
        // Leaving a key keeps the words on screen: the placement takes the key's words as its own.
        if (key) {
            data.documentService.setComponentInstanceParam(live.id, param.id, keys?.[key] ?? "");
        }
    };

    return (
        <div className="space-y-2">
            <FieldLabel as="div">{label}</FieldLabel>
            <IconButtonSegGroup
                mode="single"
                density="compact"
                segmentWidth="content"
                value={shown}
                disabled={readOnly}
                onChange={next => {
                    if (next === "literal" || next === "key") {
                        choose(next);
                    }
                }}
                options={[
                    { id: "literal", icon: null, label: t("widgets.localization.direct") },
                    { id: "key", icon: null, label: t("widgets.localization.translationKey") },
                ]}
            />
            {shown === "literal" ? (
                <DraftInput
                    value={words ?? ""}
                    // The declared default is the placeholder, not the value, as for a string param.
                    placeholder={typeof words === "string" ? "" : param.defaultValue}
                    ariaLabel={label}
                    disabled={readOnly}
                    onCommit={next => data.documentService.setComponentInstanceParam(live.id, param.id, next)}
                />
            ) : (
                <>
                    <KeyPicker data={data} onChange={() => undefined} readOnly={readOnly} />
                    {key ? (
                        <div>
                            <FieldLabel as="div">{t("widgets.localization.sourceText")}</FieldLabel>
                            <DraftTextInput
                                multiline
                                className={LABEL_TEXT_AREA_CLASS}
                                value={keys?.[key] ?? ""}
                                rows={2}
                                readOnly={readOnly}
                                draftResetKey={`${live.id}:${param.id}:${key}`}
                                readCommittedValue={() => getDesignTimeLocalizationKeys()?.[key] ?? ""}
                                onCommit={next => {
                                    writeDesignTimeLocalizationKeySourceText(key, next);
                                }}
                            />
                        </div>
                    ) : null}
                </>
            )}
        </div>
    );
}

/**
 * The supply half, shown on a selected instance.
 *
 * `updateElementProps` refuses linked instances by design - an instance is the definition, moved -
 * so these values are the one thing about a placement that is not the definition's, and the only
 * thing besides its layout that this inspector can write.
 */
export function LinkedComponentParamsField({ data, readOnly }: { data: UIInspectorData; readOnly?: boolean }) {
    const { t } = useTranslation();
    const freeze = useFreezeGuard(interfaceDocumentFreezeScope());
    const { element, documentService } = data;
    const link = getUIComponentLink(element);
    const component = link ? documentService.getComponent(link.componentId) : null;
    const params = getUIComponentParams(component);

    if (!link || params.length === 0) {
        return null;
    }

    return (
        <SectionCard title={t("properties.componentParams.title")} bodyClassName="space-y-3">
            {params.map(param => {
                if (isUIComponentTextParam(param)) {
                    return (
                        <TextParamValueField
                            key={param.id}
                            data={data}
                            param={param}
                            readOnly={readOnly === true || freeze.frozen}
                        />
                    );
                }
                if (isUIComponentAudioTrackParam(param)) {
                    return (
                        <AudioTrackParamValueField
                            key={param.id}
                            data={data}
                            param={param}
                            readOnly={readOnly === true || freeze.frozen}
                        />
                    );
                }
                const supplied = link.params?.[param.id];
                return (
                    <div key={param.id}>
                        <FieldLabel as="div">{param.name.trim() || param.id}</FieldLabel>
                        <DraftInput
                            value={supplied ?? ""}
                            // The declared default is the placeholder, not the value: an instance
                            // that has not overridden a param stores nothing, and prefilling the
                            // field would turn opening the inspector into an edit. It is dropped
                            // once the instance HAS stored something, because an override of "" is
                            // a value and the default showing through would say the opposite.
                            placeholder={typeof supplied === "string" ? "" : param.defaultValue}
                            {...freeze.writes()}
                            onCommit={next =>
                                documentService.setComponentInstanceParam(element.id, param.id, next)
                            }
                        />
                    </div>
                );
            })}
        </SectionCard>
    );
}
