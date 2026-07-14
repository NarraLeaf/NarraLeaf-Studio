import { createElement } from "react";
import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type {
    UIStageSlotId,
    UIStageSurface,
    UISurface,
} from "@shared/types/ui-editor/document";
import { DEFAULT_APP_SURFACE_NAME, MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import { DEFAULT_UI_STAGE_SLOT_ID, UI_STAGE_SLOT_IDS, UI_STAGE_SLOT_LABELS } from "@shared/types/ui-editor/stageSlots";
import { colorValueToCss, parseColorValue } from "../framework/utils/colorUtils";
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
import { PageAnimationEditor } from "@/lib/ui-editor/widget-modules/shared/page-animation/PageAnimationEditor";
import { normalizeUIPageAnimationSettings, type UIPageAnimationSettings } from "@shared/types/ui-editor/pageAnimation";
import type { Translator } from "@shared/i18n";

/** Translator function, threaded into schema builders since they run outside React. */
type TranslateFn = Translator["t"];

export type SceneEditorContext = {
    surface: UISurface;
    documentService: UIDocumentService;
};

const GAME_UI_SLOT_LABELS: Record<UIStageSlotId, string> = UI_STAGE_SLOT_LABELS;

const GAME_UI_SLOT_OPTIONS: { value: UIStageSlotId; label: string }[] = UI_STAGE_SLOT_IDS.map(slotId => ({
    value: slotId,
    label: UI_STAGE_SLOT_LABELS[slotId],
}));

const DEFAULT_GAME_UI_SLOT_ID: UIStageSlotId = DEFAULT_UI_STAGE_SLOT_ID;

const isGameUi = (surface: UISurface): surface is UIStageSurface => surface.kind === "stageSurface";

const getInterfaceTypeLabel = (surface: UISurface, t: TranslateFn): string => {
    if (surface.id === MAIN_APP_SURFACE_ID) {
        return DEFAULT_APP_SURFACE_NAME;
    }
    return isGameUi(surface) ? t("properties.scene.typeGameUi") : t("properties.scene.typePage");
};

const getGameUiSlotLabel = (surface: UISurface): string => {
    if (!isGameUi(surface)) {
        return "-";
    }
    return GAME_UI_SLOT_LABELS[surface.mount.slotId] ?? surface.mount.slotId;
};

function SurfacePageAnimationField({ data }: CustomFieldProps<SceneEditorContext>) {
    const settings = normalizeUIPageAnimationSettings(data.surface.settings?.pageAnimation);
    const update = (next: UIPageAnimationSettings) => {
        data.documentService.updateSurface(data.surface.id, surface => {
            surface.settings = {
                ...(surface.settings ?? {}),
                pageAnimation: next,
            };
        });
    };

    return createElement(PageAnimationEditor, { settings, onChange: update });
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
                    getValue: data => getGameUiSlotLabel(data.surface),
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
            getValue: data =>
                parseColorValue(data.surface.settings?.backgroundColor, {
                    hex: "#000000",
                    alpha: 1,
                }),
            setValue: (data, value) => {
                const normalizedValue = colorValueToCss({
                    hex: value.hex,
                    alpha: value.alpha ?? 1,
                });
                data.documentService.updateSurface(data.surface.id, surface => {
                    surface.settings = {
                        ...(surface.settings ?? {}),
                        backgroundColor: normalizedValue,
                    };
                });
            },
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
            options: GAME_UI_SLOT_OPTIONS,
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
