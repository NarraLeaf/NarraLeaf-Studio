import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import type { SelectFieldDefinition } from "@/apps/workspace/modules/properties/framework/types";
import type { InspectorContext, UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { createBlueprintValueField } from "@/lib/ui-editor/widget-modules/shared/blueprint/BlueprintValueField";
import { ReadonlyBlueprintSection } from "@/lib/ui-editor/widget-modules/shared/blueprint/ReadonlyBlueprintSection";
import { getUIFrameTargetInvalidReason } from "@shared/types/ui-editor/frame";
import { getFrameProps, type FrameWidgetProps } from "./helpers";

const NO_PAGE_VALUE = "__nl-frame-no-page__";

function patchFrameProps(data: UIInspectorData, patch: Partial<FrameWidgetProps>): void {
    const current = getFrameProps(data.element);
    data.documentService.updateElementProps(data.element.id, {
        ...data.element.props,
        ...current,
        ...patch,
    });
}

const FrameParamsBlueprintValueField = createBlueprintValueField({
    propPath: "params",
    valueType: "json",
    valueLabel: "params",
    title: "Page Props Value",
    clearLabel: "Static",
    getDisplayName: ({ liveElement }) => `${liveElement.name ?? "Page"} props`,
    getLiteralValue: ({ liveElement }) => getFrameProps(liveElement).params,
});

function pageOptions(data: UIInspectorData) {
    const sourceSurfaceId = data.surfaceId ?? "";
    const document = data.documentService.getDocument();
    return [
        { value: NO_PAGE_VALUE, label: "None" },
        ...document
            .surfaces
            .filter(surface => surface.kind === "appSurface")
            .filter(surface => {
                const reason = getUIFrameTargetInvalidReason({
                    document,
                    sourceSurfaceId,
                    frameElementId: data.element.id,
                    targetSurfaceId: surface.id,
                });
                return reason === null;
            })
            .map(surface => ({ value: surface.id, label: surface.name })),
    ];
}

export function createFrameInspector(ctx: InspectorContext) {
    type D = UIInspectorData;
    const { element } = ctx;

    return createPropertyEditorSchema<D>({
        id: `ui-inspector:nl.frame:${element.id}`,
        title: element.name ?? "Page",
        fields: [],
        tabs: [
            {
                id: "properties",
                title: "Properties",
                fields: [
                    defineField<D, SelectFieldDefinition<D>>({
                        id: "frame.targetSurfaceId",
                        type: "select",
                        label: "Page",
                        options: pageOptions,
                        getValue: data => getFrameProps(data.element).targetSurfaceId ?? NO_PAGE_VALUE,
                        setValue: (data, value) => {
                            const targetSurfaceId = value === NO_PAGE_VALUE ? null : String(value);
                            const doc = data.documentService.getDocument();
                            const target = targetSurfaceId
                                ? doc.surfaces.find(surface => surface.id === targetSurfaceId)
                                : null;
                            patchFrameProps(data, { targetSurfaceId });
                            if (target?.kind === "appSurface") {
                                const width = Math.max(1, Math.abs(data.element.layout.width));
                                data.documentService.updateElementLayout(data.element.id, {
                                    height: Math.round(width * (target.designSize.height / target.designSize.width)),
                                    lockAspectRatio: true,
                                });
                            }
                        },
                    }),
                    defineField<D, any>({
                        id: "frame.params",
                        type: "custom",
                        label: "Props",
                        component: FrameParamsBlueprintValueField,
                    }),
                    defineField<D, any>({
                        id: "interaction.blueprint.readonly",
                        type: "custom",
                        label: "Page component logic",
                        component: ReadonlyBlueprintSection,
                    }),
                ],
            },
        ],
    });
}
