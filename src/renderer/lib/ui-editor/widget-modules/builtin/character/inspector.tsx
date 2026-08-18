import { useMemo } from "react";
import type { UICharacterCrop, UICharacterWidgetProps } from "@shared/types/ui-editor/character";
import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import type { CustomFieldProps } from "@/apps/workspace/modules/properties/framework/types";
import { useOptionalWorkspace } from "@/apps/workspace/context";
import { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import type { Character } from "@/lib/workspace/services/character/Character";
import { Services } from "@/lib/workspace/services/services";
import { Select } from "@/lib/components/elements/Select";
import type { InspectorContext, UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { i18nStore, useTranslation } from "@/lib/i18n";
import { getUICharacterWidgetProps, patchCharacterProps } from "./helpers";

/** Always read through the live document: a schema closure can outlive the props it captured. */
function liveElement(data: UIInspectorData) {
    return data.documentService.getDocument().elements[data.element.id] ?? data.element;
}

function liveProps(data: UIInspectorData): UICharacterWidgetProps {
    return getUICharacterWidgetProps(liveElement(data));
}

function patch(data: UIInspectorData, partial: Partial<UICharacterWidgetProps>): void {
    const live = liveElement(data);
    data.documentService.updateElementProps(live.id, patchCharacterProps(live, partial));
}

/**
 * Whose picture to draw.
 *
 * The first option is the one most frames want: unset, so the frame draws whichever character the
 * story put it on stage for. Naming one is for a frame that is about a particular character, and it
 * is also what the editor canvas previews — there is no running story here to ask.
 */
function CharacterField({ data }: CustomFieldProps<UIInspectorData>) {
    const { t } = useTranslation();
    const workspace = useOptionalWorkspace();
    const characters = useMemo(() => {
        const service = workspace?.isInitialized
            ? workspace.context?.services.get<CharacterService>(Services.Character) ?? null
            : null;
        return (service?.listCharacter() ?? []).map((character: Character) => ({
            value: character.profile.getId(),
            label: character.profile.getName(),
        }));
    }, [workspace]);
    const value = liveProps(data).characterId;

    return (
        <div className="flex flex-col gap-1">
            <Select
                size="sm"
                value={value ?? ""}
                onChange={next => patch(data, { characterId: next ? String(next) : null })}
                options={[{ value: "", label: t("widgets.character.whoseFramed") }, ...characters]}
            />
            <span className="text-xs text-fg-muted">{t("widgets.character.whoseHint")}</span>
        </div>
    );
}

const CROP_EDGES: { key: keyof UICharacterCrop; label: "cropX" | "cropY" | "cropW" | "cropH" }[] = [
    { key: "x", label: "cropX" },
    { key: "y", label: "cropY" },
    { key: "w", label: "cropW" },
    { key: "h", label: "cropH" },
];

export function createCharacterInspector(ctx: InspectorContext) {
    type D = UIInspectorData;
    const { t } = i18nStore.getTranslator();
    const { element } = ctx;

    return createPropertyEditorSchema<D>({
        id: `ui-inspector:nl.character:${element.id}`,
        title: element.name ?? t("widgets.character.title"),
        fields: [],
        tabs: [
            {
                id: "properties",
                title: t("widgets.tabs.properties"),
                fields: [
                    defineField<D, any>({
                        id: "section.characterSource",
                        type: "section",
                        title: t("widgets.character.sectionSource"),
                        fields: [
                            defineField<D, any>({
                                id: "character.whose",
                                type: "custom",
                                label: t("widgets.character.whose"),
                                component: CharacterField,
                            }),
                        ],
                    }),
                    defineField<D, any>({
                        id: "section.characterFraming",
                        type: "section",
                        title: t("widgets.character.sectionFraming"),
                        fields: [
                            ...CROP_EDGES.map(edge => defineField<D, any>({
                                id: `character.crop.${edge.key}`,
                                type: "number",
                                label: t(`widgets.character.${edge.label}`),
                                min: 0,
                                max: 1,
                                step: 0.01,
                                getValue: (d: D) => liveProps(d).crop[edge.key],
                                setValue: (d: D, value: number) =>
                                    patch(d, { crop: { ...liveProps(d).crop, [edge.key]: value } }),
                            })),
                            defineField<D, any>({
                                id: "character.fit",
                                type: "select",
                                label: t("widgets.character.fit"),
                                options: [
                                    { value: "cover", label: t("widgets.character.fitCover") },
                                    { value: "contain", label: t("widgets.character.fitContain") },
                                ],
                                getValue: (d: D) => liveProps(d).fit,
                                setValue: (d: D, value: string) =>
                                    patch(d, { fit: value === "contain" ? "contain" : "cover" }),
                            }),
                            defineField<D, any>({
                                id: "character.flipX",
                                type: "switch",
                                label: t("widgets.character.flipX"),
                                getValue: (d: D) => liveProps(d).flipX,
                                setValue: (d: D, value: boolean) => patch(d, { flipX: value }),
                            }),
                        ],
                    }),
                ],
            },
        ],
    });
}
