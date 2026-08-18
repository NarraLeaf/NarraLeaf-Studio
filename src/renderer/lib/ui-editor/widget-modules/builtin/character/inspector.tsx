import { useEffect, useMemo, useState } from "react";
import type { UICharacterWidgetProps } from "@shared/types/ui-editor/character";
import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import type { CustomFieldProps } from "@/apps/workspace/modules/properties/framework/types";
import { useOptionalWorkspace } from "@/apps/workspace/context";
import { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import type { Character } from "@/lib/workspace/services/character/Character";
import { Services } from "@/lib/workspace/services/services";
import { Select } from "@/lib/components/elements/Select";
import type { InspectorContext, UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { i18nStore, useTranslation } from "@/lib/i18n";
import { PortraitCropBox } from "@/apps/workspace/modules/characters/editors/components/PortraitCropBox";
import { useCharacterPreviewSrcs } from "@/lib/workspace/hooks/useCharacterPreviewSrcs";
import { cropLayoutStyle } from "@shared/types/ui-editor/character";
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


/**
 * Drag the window over the character instead of typing four numbers.
 *
 * The box is locked to the *widget's* own shape rather than to a square, because the crop is shown
 * through `object-fit`: a crop of a different shape than the box it lands in is simply cropped a
 * second time, and the author would be framing something other than what they see. Square is still
 * what the dialog avatar's crop box uses, and this is the same component saying so explicitly.
 *
 * Which character is drawn underneath is the widget's own `characterId` when it names one, and
 * otherwise the first character in the project — a frame worn by the whole cast still has to be
 * framed against somebody, and any of them will do for placing a head.
 */
function CharacterCropField({ data }: CustomFieldProps<UIInspectorData>) {
    const { t } = useTranslation();
    const element = liveElement(data);
    const widget = liveProps(data);
    const workspace = useOptionalWorkspace();
    const previewId = useMemo(() => {
        if (widget.characterId) {
            return widget.characterId;
        }
        const service = workspace?.isInitialized
            ? workspace.context?.services.get<CharacterService>(Services.Character) ?? null
            : null;
        return service?.listCharacter()[0]?.profile.getId() ?? null;
    }, [widget.characterId, workspace]);
    const preview = useCharacterPreviewSrcs(previewId);
    const src = preview.srcs.find((entry): entry is string => typeof entry === "string") ?? null;
    const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);

    useEffect(() => {
        if (!src || typeof window === "undefined") {
            setNatural(null);
            return;
        }
        let cancelled = false;
        const image = new window.Image();
        image.onload = () => {
            if (!cancelled) {
                setNatural({ width: image.naturalWidth, height: image.naturalHeight });
            }
        };
        image.src = src;
        return () => { cancelled = true; };
    }, [src]);

    const box = { width: element.layout.width, height: element.layout.height };
    const aspect = box.height > 0 ? box.width / box.height : 1;

    if (!src) {
        return <span className="text-xs text-fg-subtle">{t("widgets.character.cropNoPreview")}</span>;
    }

    return (
        <div className="flex flex-col gap-2">
            <div className="relative h-48 w-full overflow-hidden rounded-md border border-edge bg-surface-sunken">
                <img
                    src={src}
                    alt=""
                    draggable={false}
                    className="pointer-events-none absolute inset-0 h-full w-full object-contain"
                />
                <PortraitCropBox
                    natural={natural}
                    value={widget.crop}
                    aspect={aspect}
                    title={t("widgets.character.crop")}
                    onCommit={crop => patch(data, { crop })}
                />
            </div>
            {/* What the frame will actually show, at the size the frame is. */}
            <div
                className="relative overflow-hidden rounded-md border border-edge bg-surface-sunken"
                style={{ width: 96, height: 96 / (aspect || 1) }}
            >
                <div style={{ position: "absolute", ...cropLayoutStyle({
                    crop: widget.crop,
                    fit: widget.fit,
                    box: { width: 96, height: 96 / (aspect || 1) },
                    picture: natural,
                }) }}>
                    <img src={src} alt="" draggable={false} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "fill" }} />
                </div>
            </div>
        </div>
    );
}


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
                            defineField<D, any>({
                                id: "character.crop",
                                type: "custom",
                                component: CharacterCropField,
                            }),
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
