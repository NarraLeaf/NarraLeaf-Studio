import type { CustomFieldProps } from "@/apps/workspace/modules/properties/framework/types";
import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import type { InspectorContext, UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { AppearanceAuthoringPanel } from "@/lib/ui-editor/widget-modules/shared/appearance/AppearanceAuthoringPanel";
import { buildRectangleLayoutAndTransformFields } from "@/lib/ui-editor/widget-modules/shared/chrome/rectangleLayoutAndTransformFields";
import { ReadonlyBlueprintSection } from "@/lib/ui-editor/widget-modules/shared/blueprint/ReadonlyBlueprintSection";
import { getContainerProps } from "./helpers";
import { buildContainerLayoutLeadingFields } from "./inspectorLayoutFields";

export function createContainerInspector(ctx: InspectorContext) {
    type D = UIInspectorData;
    const { element, documentService } = ctx;

    function ContainerAppearanceField(props: CustomFieldProps<D>) {
        const appearance = getContainerProps(props.data.element).appearance;
        return (
            <AppearanceAuthoringPanel
                kind="container"
                appearance={appearance ?? null}
                onReplace={next => {
                    documentService.updateElementProps(props.data.element.id, {
                        ...props.data.element.props,
                        appearance: next,
                    });
                }}
                inspectorData={props.data}
                draftResetKey={props.data.element.id}
            />
        );
    }

    return createPropertyEditorSchema<D>({
        id: `ui-inspector:nl.container:${element.id}`,
        title: element.name ?? "Container",
        fields: [],
        tabs: [
            {
                id: "properties",
                title: "Properties",
                fields: [
                    ...(buildContainerLayoutLeadingFields(ctx) as ReturnType<typeof defineField<D, any>>[]),
                    ...(buildRectangleLayoutAndTransformFields(ctx) as ReturnType<typeof defineField<D, any>>[]),
                    defineField<D, any>({
                        id: "section.appearanceAuthoring",
                        type: "section",
                        title: "Appearance",
                        helpText: "Variants and conditional rows (last matching row wins per property).",
                        fields: [
                            defineField<D, any>({
                                id: "container.appearance.panel",
                                type: "custom",
                                component: ContainerAppearanceField,
                            }),
                        ],
                    }),
                ],
            },
            {
                id: "interaction",
                title: "Interaction",
                fields: [
                    defineField<D, any>({
                        id: "section.blueprint",
                        type: "section",
                        title: "Blueprint",
                        fields: [
                            defineField<D, any>({
                                id: "interaction.blueprint.readonly",
                                type: "custom",
                                component: ReadonlyBlueprintSection,
                            }),
                        ],
                    }),
                ],
            },
        ],
    });
}
