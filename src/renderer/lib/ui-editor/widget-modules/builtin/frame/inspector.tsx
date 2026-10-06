import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import type { CustomFieldProps, SelectFieldDefinition, SelectOption } from "@/apps/workspace/modules/properties/framework/types";
import type { InspectorContext, UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { createBlueprintValueField } from "@/lib/ui-editor/widget-modules/shared/blueprint/BlueprintValueField";
import { ReadonlyBlueprintSection } from "@/lib/ui-editor/widget-modules/shared/blueprint/ReadonlyBlueprintSection";
import { buildUIFrameGraph, findUIFrameHost } from "@shared/types/ui-editor/frame";
import { normalizeUIPageAnimationSettings, type UIPageAnimationSettings } from "@shared/types/ui-editor/pageAnimation";
import { PageAnimationEditor } from "@/lib/ui-editor/widget-modules/shared/page-animation/PageAnimationEditor";
import { i18nStore, translate, useTranslation } from "@/lib/i18n";
import { FieldLabel } from "@/lib/components/elements";
import { PageParamValueInput } from "@/apps/workspace/modules/properties/PageParamsEditor";
import { getUIPageParams, uiPageParamDefaultValue } from "@shared/types/ui-editor/pageParams";
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
    title: "widgets.blueprintValue.pagePropsTitle",
    clearLabel: "widgets.blueprintValue.static",
    getDisplayName: ({ liveElement }) =>
        translate("widgets.blueprintValue.nameProps", {
            name: liveElement.name ?? translate("widgets.defaults.frame.name"),
        }),
    getLiteralValue: ({ liveElement }) => getFrameProps(liveElement).params,
});

/** The page this Page widget shows, read off the project's document (see {@link pageOptions}). */
function frameTargetSurface(data: UIInspectorData) {
    const targetSurfaceId = getFrameProps(data.element).targetSurfaceId;
    return targetSurfaceId
        ? data.documentService.getPageDocument().surfaces.find(surface => surface.id === targetSurfaceId) ?? null
        : null;
}

/** Whether the widget's params come from a value blueprint rather than from what is written here. */
function frameParamsBound(data: UIInspectorData): boolean {
    const live = data.documentService.getDocument().elements[data.element.id] ?? data.element;
    return live.valueBindings?.params?.kind === "blueprintValue";
}

/** True when the page shown declares parameters and the widget gives them from this inspector. */
function framePageParamsShown(data: UIInspectorData): boolean {
    return !frameParamsBound(data) && getUIPageParams(frameTargetSurface(data)).length > 0;
}

/**
 * The values this widget gives the page it shows: one field per parameter the page declares, each
 * showing the page's default until the widget gives its own.
 *
 * Stored where they always were, in the widget's `params`, under each parameter's name - the props
 * the page is drawn with - so a value the widget gives is exactly what `Get Page Param` reads there.
 */
function FramePageParamsField({ data }: CustomFieldProps<UIInspectorData>) {
    const live = data.documentService.getDocument().elements[data.element.id] ?? data.element;
    const given = getFrameProps(live).params;
    const params = getUIPageParams(frameTargetSurface(data));
    return (
        <div className="space-y-2">
            {params.map(param => (
                <div key={param.id}>
                    <FieldLabel as="div">{param.name}</FieldLabel>
                    <PageParamValueInput
                        type={param.type}
                        value={Object.prototype.hasOwnProperty.call(given, param.name) ? given[param.name] : undefined}
                        placeholder={uiPageParamDefaultValue(param)}
                        ariaLabel={param.name}
                        onCommit={next => {
                            const nextParams = { ...given };
                            if (next === null) {
                                delete nextParams[param.name];
                            } else {
                                nextParams[param.name] = next;
                            }
                            patchFrameProps(data, { params: nextParams });
                        }}
                    />
                </div>
            ))}
        </div>
    );
}

function FrameAnimationField({ data }: CustomFieldProps<UIInspectorData>) {
    const { t } = useTranslation();
    const frame = getFrameProps(data.element);
    const target = frame.targetSurfaceId
        ? data.documentService.getDocument().surfaces.find(surface => surface.id === frame.targetSurfaceId)
        : null;
    const inheritedSettings = normalizeUIPageAnimationSettings(target?.settings?.pageAnimation);
    const ownSettings = frame.animation;
    const inherited = ownSettings === undefined;

    const update = (next: UIPageAnimationSettings) => {
        patchFrameProps(data, { animation: next });
    };
    const updateInherited = (nextInherited: boolean, seed: UIPageAnimationSettings) => {
        patchFrameProps(data, { animation: nextInherited ? undefined : seed });
    };

    return (
        <PageAnimationEditor
            settings={ownSettings ?? inheritedSettings}
            inherited={inherited}
            inheritedSettings={inheritedSettings}
            inheritLabel={t("widgets.frame.usePageAnimation")}
            onChange={update}
            onInheritedChange={updateInherited}
        />
    );
}

/**
 * The pages this Page widget may draw.
 *
 * Read off the project's document rather than the one this inspector edits: in a component editor
 * that one is a view of the definition, holding its elements and none of the pages', and where a
 * page leads - what it places, what its own Page widgets draw - is read off the pages.
 *
 * A page that leads back to the widget stays in the list, marked and not selectable, rather than
 * leaving it: a page missing from a list reads as a page that does not exist, where a marked one
 * says why it cannot be picked. That covers a page whose Page widget shows this one, and - for a
 * widget inside a component - a page the component is placed on, directly or through pages and
 * placements of its own. The page the widget is on is left out, as it always was. A target that
 * already leads back (written before the check could see it, or by a tool) stays selectable, so the
 * field still shows what is stored and says what is wrong with it.
 */
function pageOptions(data: UIInspectorData, labels: { none: string; leadsBack: string }): SelectOption[] {
    const document = data.documentService.getPageDocument();
    const host = findUIFrameHost(document, data.element.id);
    const current = getFrameProps(data.element).targetSurfaceId;
    const graph = buildUIFrameGraph(document);
    const pages: SelectOption[] = [];
    for (const surface of document.surfaces) {
        if (surface.kind !== "appSurface") {
            continue;
        }
        const reason = host
            ? graph.targetInvalidReason({ host, frameElementId: data.element.id, targetSurfaceId: surface.id })
            : null;
        if (reason === "self") {
            continue;
        }
        pages.push(
            reason === "cycle"
                ? { value: surface.id, label: surface.name, secondaryLabel: labels.leadsBack, disabled: surface.id !== current }
                : { value: surface.id, label: surface.name },
        );
    }
    return [{ value: NO_PAGE_VALUE, label: labels.none }, ...pages];
}

export function createFrameInspector(ctx: InspectorContext) {
    type D = UIInspectorData;
    const { t } = i18nStore.getTranslator();
    const { element } = ctx;

    return createPropertyEditorSchema<D>({
        id: `ui-inspector:nl.frame:${element.id}`,
        title: element.name ?? t("widgets.frame.title"),
        fields: [],
        tabs: [
            {
                id: "properties",
                title: t("widgets.tabs.properties"),
                fields: [
                    defineField<D, SelectFieldDefinition<D>>({
                        id: "frame.targetSurfaceId",
                        type: "select",
                        label: t("widgets.frame.page"),
                        options: data => pageOptions(data, {
                            none: t("common.none"),
                            leadsBack: t("widgets.frame.leadsBackHere"),
                        }),
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
                        id: "frame.pageParams",
                        type: "custom",
                        label: t("widgets.frame.params"),
                        component: FramePageParamsField,
                        hidden: (data: D) => !framePageParamsShown(data),
                    }),
                    // The whole props object, as JSON or from a value blueprint: what a page that
                    // declares nothing is given, and the way to compute every value at once. Not
                    // offered beside the fields above, which edit the same object one value at a time.
                    defineField<D, any>({
                        id: "frame.params",
                        type: "custom",
                        label: t("widgets.frame.props"),
                        component: FrameParamsBlueprintValueField,
                        hidden: (data: D) => framePageParamsShown(data),
                    }),
                    defineField<D, any>({
                        id: "section.frameAnimation",
                        type: "section",
                        title: t("widgets.frame.animation"),
                        fields: [
                            defineField<D, any>({
                                id: "frame.animation",
                                type: "custom",
                                component: FrameAnimationField,
                            }),
                        ],
                    }),
                    defineField<D, any>({
                        id: "interaction.blueprint.readonly",
                        type: "custom",
                        label: t("widgets.frame.pageLogic"),
                        component: ReadonlyBlueprintSection,
                    }),
                ],
            },
        ],
    });
}
