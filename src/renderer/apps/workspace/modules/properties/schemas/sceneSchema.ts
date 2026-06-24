import { createElement } from "react";
import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type {
    UIStageSlotId,
    UIStageSurface,
    UISurface,
} from "@shared/types/ui-editor/document";
import { MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
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

export type SceneEditorContext = {
    surface: UISurface;
    documentService: UIDocumentService;
};

const GAME_UI_SLOT_LABELS: Record<UIStageSlotId, string> = {
    onStage: "On Stage",
    dialog: "Dialog",
    notification: "Notification",
    choice: "Choice",
};

const GAME_UI_SLOT_OPTIONS: { value: UIStageSlotId; label: string }[] = [
    { value: "onStage", label: "On Stage" },
    { value: "dialog", label: "Dialog" },
    { value: "notification", label: "Notification" },
    { value: "choice", label: "Choice" },
];

const DEFAULT_GAME_UI_SLOT_ID: UIStageSlotId = "onStage";

const isGameUi = (surface: UISurface): surface is UIStageSurface => surface.kind === "stageSurface";

const getInterfaceTypeLabel = (surface: UISurface): string => (isGameUi(surface) ? "Game UI" : "Page");

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

export const scenePropertySchema = createPropertyEditorSchema<SceneEditorContext>({
    id: "scene-properties",
    title: "Interface Properties",
    fields: [
        defineField<SceneEditorContext, InfoFieldDefinition<SceneEditorContext>>({
            id: "scene.info",
            type: "info",
            label: "Interface",
            items: [
                {
                    label: "Type",
                    getValue: data => getInterfaceTypeLabel(data.surface),
                },
                {
                    label: "Size",
                    getValue: data => `${data.surface.designSize.width}×${data.surface.designSize.height}`,
                },
                {
                    label: "Slot",
                    getValue: data => getGameUiSlotLabel(data.surface),
                    hidden: data => !isGameUi(data.surface),
                },
            ],
        }),
        defineField<SceneEditorContext, TextFieldDefinition<SceneEditorContext>>({
            id: "scene.name",
            type: "text",
            label: "Name",
            getValue: data => data.surface.name,
            setValue: (data, value) => {
                if (data.surface.id === MAIN_APP_SURFACE_ID) {
                    return;
                }
                if (value === data.surface.name) {
                    return;
                }
                data.documentService.updateSurface(data.surface.id, surface => {
                    surface.name = value;
                });
            },
        }),
        defineField<SceneEditorContext, ColorPickerFieldDefinition<SceneEditorContext>>({
            id: "scene.backgroundColor",
            type: "colorPicker",
            label: "Background Color",
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
            title: "Animation",
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
            label: "Slot",
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
            label: "Logic",
            component: SurfaceBlueprintEntrySection,
        }),
    ],
});
