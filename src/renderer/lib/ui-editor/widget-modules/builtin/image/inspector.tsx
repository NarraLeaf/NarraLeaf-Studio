import { useLayoutEffect } from "react";
import type { CustomFieldProps } from "@/apps/workspace/modules/properties/framework/types";
import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import type { AppearanceModel } from "@shared/types/ui-editor/appearance";
import { isAppearanceModel } from "@shared/types/ui-editor/appearance";
import type { InspectorContext, UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { AppearanceAuthoringPanel } from "@/lib/ui-editor/widget-modules/shared/appearance/AppearanceAuthoringPanel";
import {
    ensureImageAppearanceHasAllKeys,
    isUsableAppearanceModel,
} from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { ReadonlyBlueprintSection } from "@/lib/ui-editor/widget-modules/shared/blueprint/ReadonlyBlueprintSection";
import { i18nStore } from "@/lib/i18n";

/** Module-level so FieldRenderer keeps a stable component identity across schema rebuilds (preserves variant selection). */
function ImageAppearanceField(props: CustomFieldProps<UIInspectorData>) {
    const rawAppearance = (props.data.element.props as { appearance?: unknown } | undefined)?.appearance;
    const appearance: AppearanceModel | null | undefined = isAppearanceModel(rawAppearance)
        ? rawAppearance
        : undefined;
    const { documentService } = props.data;
    const element = props.data.element;

    useLayoutEffect(() => {
        if (!isUsableAppearanceModel(appearance)) {
            return;
        }
        const next = ensureImageAppearanceHasAllKeys(appearance, element);
        if (next !== appearance) {
            documentService.updateElementProps(element.id, {
                ...element.props,
                appearance: next,
            });
        }
    }, [appearance, documentService, element]);

    return (
        <AppearanceAuthoringPanel
            key={element.id}
            kind="image"
            appearance={appearance ?? null}
            onReplace={next => {
                documentService.updateElementProps(element.id, {
                    ...element.props,
                    appearance: next,
                });
            }}
            inspectorData={props.data}
            draftResetKey={element.id}
        />
    );
}

export function createImageInspector(ctx: InspectorContext) {
    type D = UIInspectorData;
    const { t } = i18nStore.getTranslator();
    const { element } = ctx;

    return createPropertyEditorSchema<D>({
        id: `ui-inspector:nl.image:${element.id}`,
        title: element.name ?? t("widgets.image.title"),
        fields: [],
        tabs: [
            {
                id: "properties",
                title: t("widgets.tabs.properties"),
                fields: [
                    defineField<D, any>({
                        id: "section.appearanceAuthoring",
                        type: "section",
                        title: t("widgets.appearance.title"),
                        collapsible: true,
                        defaultCollapsed: true,
                        helpText: t("widgets.appearance.modulesHelp"),
                        fields: [
                            defineField<D, any>({
                                id: "image.appearance.panel",
                                type: "custom",
                                component: ImageAppearanceField,
                            }),
                        ],
                    }),
                ],
            },
            {
                id: "interaction",
                title: t("widgets.tabs.interaction"),
                fields: [
                    defineField<D, any>({
                        id: "interaction.blueprint.readonly",
                        type: "custom",
                        label: t("widgets.blueprint.controlLabel"),
                        component: ReadonlyBlueprintSection,
                    }),
                ],
            },
        ],
    });
}
