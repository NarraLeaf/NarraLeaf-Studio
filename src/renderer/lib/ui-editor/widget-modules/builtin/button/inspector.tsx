import type { CustomFieldProps } from "@/apps/workspace/modules/properties/framework/types";
import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import type { UIInspectorData, InspectorContext } from "@/lib/ui-editor/widget-modules/types";
import { AppearanceAuthoringPanel } from "@/lib/ui-editor/widget-modules/shared/appearance/AppearanceAuthoringPanel";
import { ReadonlyBlueprintSection } from "@/lib/ui-editor/widget-modules/shared/blueprint/ReadonlyBlueprintSection";
import { getButtonProps } from "./helpers";
import type { ButtonWidgetProps } from "./types";

export function createButtonInspector(ctx: InspectorContext) {
    type D = UIInspectorData;
    const { element, documentService } = ctx;

    const patch = (partial: Partial<ButtonWidgetProps>) => {
        documentService.updateElementProps(element.id, {
            ...element.props,
            ...partial,
        });
    };

    function ButtonAppearanceField(props: CustomFieldProps<D>) {
        const appearance = getButtonProps(props.data.element).appearance;
        return (
            <AppearanceAuthoringPanel
                kind="button"
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
        id: `ui-inspector:nl.button:${element.id}`,
        title: element.name ?? "Button",
        fields: [],
        tabs: [
            {
                id: "properties",
                title: "Properties",
                fields: [
                    defineField<D, any>({
                        id: "section.appearanceAuthoring",
                        type: "section",
                        title: "Appearance",
                        helpText: "Variants and conditional rows (last matching row wins per property).",
                        fields: [
                            defineField<D, any>({
                                id: "button.appearance.panel",
                                type: "custom",
                                component: ButtonAppearanceField,
                            }),
                        ],
                    }),
                    defineField<D, any>({
                        id: "section.behavior",
                        type: "section",
                        title: "Behavior",
                        fields: [
                            defineField<D, any>({
                                id: "button.interactionDisabled",
                                type: "checkbox",
                                label: "Interaction disabled (runtime preview)",
                                getValue: (d: D) => Boolean(getButtonProps(d.element).interactionDisabled),
                                setValue: (_d: D, v: boolean) => patch({ interactionDisabled: v }),
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
