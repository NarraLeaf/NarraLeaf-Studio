import { createElement } from "react";
import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type {
    UIStageSlotId,
    UIStageSurface,
    UISurface,
} from "@shared/types/ui-editor/document";
import { DEFAULT_APP_SURFACE_NAME, MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import { DEFAULT_UI_STAGE_SLOT_ID } from "@shared/types/ui-editor/stageSlots";
import { getStageSlotLabel, getStageSlotOptions } from "@/lib/ui-editor/stageSlotLabel";
import { parseColorValue, serializeColorValue } from "../framework/utils/colorUtils";
import type {
    ColorPickerFieldDefinition,
    CustomFieldDefinition,
    CustomFieldProps,
    InfoFieldDefinition,
    SectionFieldDefinition,
    SelectFieldDefinition,
    TextFieldDefinition,
} from "../framework/types";
import { SurfaceBlueprintEntrySection } from "../blueprint/SurfaceBlueprintEntrySection";
import { SurfaceBackgroundImageField } from "../fields/SurfaceBackgroundImageField";
import { PageAnimationEditor } from "@/lib/ui-editor/widget-modules/shared/page-animation/PageAnimationEditor";
import { normalizeUIPageAnimationSettings, type UIPageAnimationSettings } from "@shared/types/ui-editor/pageAnimation";
import type { Translator } from "@shared/i18n";

/** Translator function, threaded into schema builders since they run outside React. */
type TranslateFn = Translator["t"];

export type SceneEditorContext = {
    surface: UISurface;
    documentService: UIDocumentService;
};

const DEFAULT_GAME_UI_SLOT_ID: UIStageSlotId = DEFAULT_UI_STAGE_SLOT_ID;

const isGameUi = (surface: UISurface): surface is UIStageSurface => surface.kind === "stageSurface";

const getInterfaceTypeLabel = (surface: UISurface, t: TranslateFn): string => {
    if (surface.id === MAIN_APP_SURFACE_ID) {
        return DEFAULT_APP_SURFACE_NAME;
    }
    return isGameUi(surface) ? t("properties.scene.typeGameUi") : t("properties.scene.typePage");
};

const getGameUiSlotLabel = (surface: UISurface, t: TranslateFn): string => {
    if (!isGameUi(surface)) {
        return "-";
    }
    return getStageSlotLabel(surface.mount.slotId, t);
};

function SurfacePageAnimationField({ data }: CustomFieldProps<SceneEditorContext>) {
    const settings = normalizeUIPageAnimationSettings(data.surface.settings?.pageAnimation);
    const update = (next: UIPageAnimationSettings) => {
        // The editor hands back the whole animation record, so the merge key is derived rather than
        // fixed: typing into "seconds" collapses into one undo entry, while moving on to the
        // direction beside it starts a new one.
        const changed = (Object.keys(next) as (keyof UIPageAnimationSettings)[])
            .filter(key => next[key] !== settings[key])
            .sort()
            .join(",");
        data.documentService.updateSurface(data.surface.id, surface => {
            surface.settings = {
                ...(surface.settings ?? {}),
                pageAnimation: next,
            };
        }, { mergeKey: `surface:${data.surface.id}:pageAnimation:${changed}` });
    };

    // A Surface owns the widgets on it the way a container owns its children, so it offers the same
    // two child timings: space them out as they arrive, and do not leave before they have.
    return createElement(PageAnimationEditor, { settings, onChange: update, showChildTiming: true });
}

export const scenePropertySchema = (t: TranslateFn) =>
    createPropertyEditorSchema<SceneEditorContext>({
    id: "scene-properties",
    title: t("properties.scene.title"),
    fields: [
        defineField<SceneEditorContext, InfoFieldDefinition<SceneEditorContext>>({
            id: "scene.info",
            type: "info",
            label: t("properties.scene.interface"),
            items: [
                {
                    label: t("properties.scene.type"),
                    getValue: data => getInterfaceTypeLabel(data.surface, t),
                },
                {
                    label: t("properties.layout.size"),
                    getValue: data => `${data.surface.designSize.width}×${data.surface.designSize.height}`,
                },
                {
                    label: t("properties.scene.slot"),
                    getValue: data => getGameUiSlotLabel(data.surface, t),
                    hidden: data => !isGameUi(data.surface),
                },
            ],
        }),
        defineField<SceneEditorContext, TextFieldDefinition<SceneEditorContext>>({
            id: "scene.name",
            type: "text",
            label: t("common.name"),
            getValue: data => data.surface.name,
            setValue: (data, value) => {
                if (value === data.surface.name) {
                    return;
                }
                data.documentService.renameSurface(data.surface.id, value);
            },
        }),
        defineField<SceneEditorContext, ColorPickerFieldDefinition<SceneEditorContext>>({
            id: "scene.backgroundColor",
            type: "colorPicker",
            label: t("properties.scene.backgroundColor"),
            allowOpacity: true,
            brandPalette: true,
            getValue: data =>
                parseColorValue(data.surface.settings?.backgroundColor, {
                    hex: "#000000",
                    alpha: 1,
                }),
            setValue: (data, value) => {
                const normalizedValue = serializeColorValue({
                    hex: value.hex,
                    alpha: value.alpha ?? 1,
                    ...(value.link ? { link: value.link } : {}),
                });
                data.documentService.updateSurface(data.surface.id, surface => {
                    surface.settings = {
                        ...(surface.settings ?? {}),
                        backgroundColor: normalizedValue,
                    };
                    // Dragged and typed into, so one entry per visit to the colour rather than one
                    // per intermediate shade the author passed through.
                }, { mergeKey: `surface:${data.surface.id}:backgroundColor` });
            },
        }),
        defineField<SceneEditorContext, CustomFieldDefinition<SceneEditorContext>>({
            id: "scene.backgroundImage",
            type: "custom",
            label: t("properties.scene.backgroundImage"),
            component: SurfaceBackgroundImageField,
            // A Game UI is drawn over the running scene, and its whole job is to let that scene
            // through. A full-bleed picture there would cover the one thing the slot exists to sit
            // on top of, so the offer is not made.
            hidden: data => isGameUi(data.surface),
        }),
        defineField<SceneEditorContext, SectionFieldDefinition<SceneEditorContext>>({
            id: "scene.pageAnimation",
            type: "section",
            title: t("properties.scene.animation"),
            fields: [
                defineField<SceneEditorContext, CustomFieldDefinition<SceneEditorContext>>({
                    id: "scene.pageAnimation.editor",
                    type: "custom",
                    component: SurfacePageAnimationField,
                }),
            ],
            hidden: data => isGameUi(data.surface),
        }),
        defineField<SceneEditorContext, SelectFieldDefinition<SceneEditorContext>>({
            id: "scene.gameUiSlot",
            type: "select",
            label: t("properties.scene.slot"),
            options: getStageSlotOptions(t),
            getValue: data => (isGameUi(data.surface) ? data.surface.mount.slotId : DEFAULT_GAME_UI_SLOT_ID),
            setValue: (data, value) => {
                if (!isGameUi(data.surface)) {
                    return;
                }
                const nextSlot = value as UIStageSlotId;
                data.documentService.updateSurface(data.surface.id, surface => {
                    if (surface.kind !== "stageSurface") {
                        return;
                    }
                    if (surface.mount.slotId === nextSlot) {
                        return;
                    }
                    surface.mount = {
                        kind: "slot",
                        slotId: nextSlot,
                    };
                });
            },
            hidden: data => !isGameUi(data.surface),
        }),
        defineField<SceneEditorContext, CustomFieldDefinition<SceneEditorContext>>({
            id: "scene.blueprintEntry",
            type: "custom",
            label: t("properties.scene.logic"),
            component: SurfaceBlueprintEntrySection,
        }),
    ],
});
