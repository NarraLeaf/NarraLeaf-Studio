import { useLayoutEffect } from "react";
import type { CustomFieldProps } from "@/apps/workspace/modules/properties/framework/types";
import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import type { InspectorContext, UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { AppearanceAuthoringPanel } from "@/lib/ui-editor/widget-modules/shared/appearance/AppearanceAuthoringPanel";
import {
    createInitialContainerAppearance,
    ensureContainerAppearanceHasAllKeys,
    isUsableAppearanceModel,
} from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { ReadonlyBlueprintSection } from "@/lib/ui-editor/widget-modules/shared/blueprint/ReadonlyBlueprintSection";
import { i18nStore } from "@/lib/i18n";
import { getContainerProps } from "./helpers";
import { buildContainerLayoutLeadingFields } from "./inspectorLayoutFields";

/** Module-level so FieldRenderer keeps a stable component identity across schema rebuilds (preserves variant selection). */
function ContainerAppearanceField(props: CustomFieldProps<UIInspectorData>) {
    const flat = getContainerProps(props.data.element);
    const appearance = flat.appearance;
    const { documentService } = props.data;
    const element = props.data.element;

    // Deferred, not refused, while the workspace is read-only: this is bookkeeping nobody asked for
    // - it fills in appearance keys a document predates - and running it on a frozen project raised
    // "Nothing is being saved right now" about a write the author never made, just for selecting an
    // element. `readOnly` is an input of the effect, so it happens as soon as writing is possible
    // again; the model that was out of date still is.
    //
    // It also CREATES the model when the element has none, the way the text module always has.
    // Elements authored through the services (every element of a bundled template, and everything
    // imported from the template store) carry flat props only, and refusing to author appearance for
    // them left "This element has no valid appearance data" on 91 of the skeleton's 307 elements -
    // with no way for the author to get out of it. The synthesized model is a faithful projection of
    // the flat props, so nothing renders differently the moment it appears.
    useLayoutEffect(() => {
        if (props.readOnly) {
            return;
        }
        const f = getContainerProps(element);
        const next = isUsableAppearanceModel(appearance)
            ? ensureContainerAppearanceHasAllKeys(appearance, f)
            : createInitialContainerAppearance(f);
        if (next !== appearance) {
            documentService.updateElementProps(element.id, {
                appearance: next,
            });
        }
    }, [appearance, documentService, element, props.readOnly]);

    // The panel renders from a synthesized model on the frame before the effect commits one, and on
    // a frozen project where the effect deliberately never runs.
    const panelAppearance = isUsableAppearanceModel(appearance) ? appearance : createInitialContainerAppearance(flat);

    return (
        <AppearanceAuthoringPanel
            key={element.id}
            kind="container"
            appearance={panelAppearance}
            onReplace={next => {
                documentService.updateElementProps(props.data.element.id, {
                    appearance: next,
                });
            }}
            inspectorData={props.data}
            draftResetKey={props.data.element.id}
            readOnly={props.readOnly}
        />
    );
}

export function createContainerInspector(ctx: InspectorContext) {
    type D = UIInspectorData;
    const { t } = i18nStore.getTranslator();
    const { element } = ctx;

    return createPropertyEditorSchema<D>({
        id: `ui-inspector:nl.container:${element.id}`,
        title: element.name ?? t("widgets.container.title"),
        fields: [],
        tabs: [
            {
                id: "properties",
                title: t("widgets.tabs.properties"),
                fields: [
                    ...(buildContainerLayoutLeadingFields(ctx) as ReturnType<typeof defineField<D, any>>[]),
                    defineField<D, any>({
                        id: "section.appearanceAuthoring",
                        type: "section",
                        title: t("widgets.appearance.title"),
                        collapsible: true,
                        defaultCollapsed: true,
                        helpText: t("widgets.appearance.modulesHelp"),
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
