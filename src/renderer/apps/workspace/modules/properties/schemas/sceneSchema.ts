import { createElement, type ReactNode } from "react";
import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type {
    UIStageSlotId,
    UIStageSurfaceMount,
    UIStageSurface,
    UISurface,
} from "@shared/types/ui-editor/document";
import { MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import { colorValueToCss, parseColorValue } from "../framework/utils/colorUtils";
import type {
    ColorPickerFieldDefinition,
    CustomFieldDefinition,
    InfoFieldDefinition,
    NumberFieldDefinition,
    SelectFieldDefinition,
    TextFieldDefinition,
} from "../framework/types";
import { SurfaceBlueprintEntrySection } from "../blueprint/SurfaceBlueprintEntrySection";
import { collectLinkDiagnostics } from "@/lib/ui-editor/diagnostics/rules/linkDiagnostics";
import { collectStageDiagnostics } from "@/lib/ui-editor/diagnostics/rules/stageDiagnostics";

export type SceneEditorContext = {
    surface: UISurface;
    documentService: UIDocumentService;
};

const STAGE_MOUNT_LABELS: Record<UIStageSurfaceMount["kind"], string> = {
    slot: "Slot",
    persistent: "Persistent",
    layer: "Layer",
};

const STAGE_MOUNT_OPTIONS: { value: UIStageSurfaceMount["kind"]; label: string }[] = [
    { value: "slot", label: "Slot" },
    { value: "persistent", label: "Persistent" },
    { value: "layer", label: "Layer" },
];

const STAGE_SLOT_LABELS: Record<UIStageSlotId, string> = {
    dialog: "Dialog",
    menu: "Menu",
    notification: "Notification",
    none: "None",
};

const STAGE_SLOT_OPTIONS: { value: UIStageSlotId; label: string }[] = [
    { value: "dialog", label: "Dialog" },
    { value: "menu", label: "Menu" },
    { value: "notification", label: "Notification" },
    { value: "none", label: "None" },
];

const DEFAULT_STAGE_SLOT_ID: UIStageSlotId = "dialog";

const isStageSurface = (surface: UISurface): surface is UIStageSurface => surface.kind === "stageSurface";
const NONE_LINK_VALUE = "none";

const getStageMountLabel = (surface: UISurface): string => {
    if (!isStageSurface(surface)) {
        return "-";
    }
    if (surface.mount.kind === "slot") {
        return `Slot · ${STAGE_SLOT_LABELS[surface.mount.slotId] ?? surface.mount.slotId}`;
    }
    return STAGE_MOUNT_LABELS[surface.mount.kind];
};

export const scenePropertySchema = createPropertyEditorSchema<SceneEditorContext>({
    id: "scene-properties",
    title: "Scene Properties",
    fields: [
        defineField<SceneEditorContext, InfoFieldDefinition<SceneEditorContext>>({
            id: "scene.info",
            type: "info",
            label: "Scene",
            items: [
                {
                    label: "Kind",
                    getValue: (data) => data.surface.kind,
                },
                {
                    label: "Host",
                    getValue: (data) => data.surface.host,
                },
                {
                    label: "Mount",
            getValue: data => getStageMountLabel(data.surface),
            hidden: data => !isStageSurface(data.surface),
                },
            ],
        }),
        defineField<SceneEditorContext, TextFieldDefinition<SceneEditorContext>>({
            id: "scene.name",
            type: "text",
            label: "Name",
            getValue: (data) => data.surface.name,
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
            getValue: (data) =>
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
        defineField<SceneEditorContext, SelectFieldDefinition<SceneEditorContext>>({
            id: "scene.linkedSurface",
            type: "select",
            label: "Linked App Surface",
            helpText:
                "App Surface link: this stage surface renders the linked app surface’s element tree (same document). Use for settings, menus, or other pages that should exist both in-app and on stage. Duplicate the surface instead if you need an independent copy.",
            options: (data) => {
                const document = data.documentService.getDocument();
                const appSurfaces = document.surfaces.filter(surface => surface.kind === "appSurface");
                return [
                    { value: NONE_LINK_VALUE, label: "None" },
                    ...appSurfaces.map(surface => ({
                        value: surface.id,
                        label: surface.name,
                        disabled: surface.id === data.surface.id,
                    })),
                ];
            },
            getValue: (data) => {
                if (!isStageSurface(data.surface)) {
                    return NONE_LINK_VALUE;
                }
                return data.surface.link?.kind === "appSurface" ? data.surface.link.surfaceId : NONE_LINK_VALUE;
            },
            setValue: (data, value) => {
                if (!isStageSurface(data.surface)) {
                    return;
                }
                const nextValue = String(value);
                data.documentService.updateSurface(data.surface.id, surface => {
                    if (surface.kind !== "stageSurface") {
                        return;
                    }
                    if (nextValue === NONE_LINK_VALUE) {
                        delete surface.link;
                        return;
                    }
                    surface.link = {
                        kind: "appSurface",
                        surfaceId: nextValue,
                    };
                });
            },
            hidden: (data) => !isStageSurface(data.surface),
        }),
        defineField<SceneEditorContext, InfoFieldDefinition<SceneEditorContext>>({
            id: "scene.stageLinkWarnings",
            type: "info",
            label: "Link / mount checks",
            hidden: data => {
                if (!isStageSurface(data.surface)) {
                    return true;
                }
                const document = data.documentService.getDocument();
                const link = collectLinkDiagnostics(document, data.surface);
                const stage = collectStageDiagnostics(data.surface);
                return link.length === 0 && stage.length === 0;
            },
            items: [
                {
                    label: "Issues",
                    getValue: (data): ReactNode => {
                        const document = data.documentService.getDocument();
                        const parts = [...collectLinkDiagnostics(document, data.surface), ...collectStageDiagnostics(data.surface)];
                        const text =
                            parts.map(p => p.message).join(" · ") + (parts[0]?.hint ? ` — ${parts[0].hint}` : "");
                        return createElement("span", { className: "text-amber-400/95 text-xs leading-snug" }, text);
                    },
                },
            ],
        }),
        defineField<SceneEditorContext, SelectFieldDefinition<SceneEditorContext>>({
            id: "scene.mountKind",
            type: "select",
            label: "Mount Kind",
            options: STAGE_MOUNT_OPTIONS,
            getValue: (data) => (isStageSurface(data.surface) ? data.surface.mount.kind : STAGE_MOUNT_OPTIONS[0].value),
            setValue: (data, value) => {
                if (!isStageSurface(data.surface)) {
                    return;
                }
                const nextKind = value as UIStageSurfaceMount["kind"];
                if (data.surface.mount.kind === nextKind) {
                    return;
                }
                data.documentService.updateSurface(data.surface.id, surface => {
                    if (surface.kind !== "stageSurface") {
                        return;
                    }
                    surface.mount =
                        nextKind === "slot"
                            ? {
                                  kind: "slot",
                                  slotId:
                                      surface.mount.kind === "slot"
                                          ? surface.mount.slotId
                                          : DEFAULT_STAGE_SLOT_ID,
                              }
                            : ({ kind: nextKind } as UIStageSurfaceMount);
                });
            },
            hidden: (data) => !isStageSurface(data.surface),
        }),
        defineField<SceneEditorContext, SelectFieldDefinition<SceneEditorContext>>({
            id: "scene.slotId",
            type: "select",
            label: "Slot ID",
            options: STAGE_SLOT_OPTIONS,
            getValue: (data) =>
                isStageSurface(data.surface) && data.surface.mount.kind === "slot"
                    ? data.surface.mount.slotId
                    : DEFAULT_STAGE_SLOT_ID,
            setValue: (data, value) => {
                if (!isStageSurface(data.surface)) {
                    return;
                }
                const nextSlot = value as UIStageSlotId;
                data.documentService.updateSurface(data.surface.id, surface => {
                    if (surface.kind !== "stageSurface") {
                        return;
                    }
                    if (surface.mount.kind !== "slot") {
                        return;
                    }
                    if (surface.mount.slotId === nextSlot) {
                        return;
                    }
                    surface.mount = {
                        ...surface.mount,
                        slotId: nextSlot,
                    };
                });
            },
            hidden: (data) => !isStageSurface(data.surface) || data.surface.mount.kind !== "slot",
        }),
        defineField<SceneEditorContext, CustomFieldDefinition<SceneEditorContext>>({
            id: "scene.blueprintEntry",
            type: "custom",
            label: "Blueprint",
            component: SurfaceBlueprintEntrySection,
        }),
    ],
});
