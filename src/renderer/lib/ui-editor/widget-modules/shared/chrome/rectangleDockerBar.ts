import type { UIElement } from "@shared/types/ui-editor/document";
import { isAppearanceModel, type AppearanceModel, type ContainerAppearancePropertyKey } from "@shared/types/ui-editor/appearance";
import type { RectangleLikeProps } from "@shared/types/ui-editor/rectangleLike";
import { translate } from "@/lib/i18n";
import { resolveImageRectangleLike } from "@/lib/ui-editor/runtime/appearance/AppearanceResolver";
import { DEFAULT_SYSTEM_INTERACTION_SIGNALS } from "@/lib/ui-editor/runtime/appearance/SystemInteractionState";
import type { DockerBarContext, DockerBarItem } from "@/lib/ui-editor/widget-modules/types";
import { ensureVariantExists, replaceVariant, updateRowInGroup } from "../appearance/appearancePatch";
import { enteredVariantIdFor, findStateHost } from "../appearance/stateHost";
import { getRectangleLikeProps } from "./rectangleHelpers";

export type RectangleDockerBarOptions = {
    resolveProps?: (element: UIElement) => RectangleLikeProps;
};

function imageAppearance(element: UIElement): AppearanceModel | null {
    const model = element.props?.appearance;
    return element.type === "nl.image" && isAppearanceModel(model) && model.variants.length > 0 ? model : null;
}

function enteredVariant(ctx: DockerBarContext, element: UIElement): string | null {
    const entered = ctx.stateService?.getEnteredState?.() ?? null;
    if (!entered || (ctx.surfaceId && entered.surfaceId !== ctx.surfaceId)) {
        return null;
    }
    return enteredVariantIdFor(ctx.documentService.getDocument(), entered, element.id) ?? null;
}

export function createRectangleDockerBarItems(
    ctx: DockerBarContext,
    options?: RectangleDockerBarOptions,
): DockerBarItem[] {
    const { element, documentService } = ctx;
    const resolve = options?.resolveProps ?? getRectangleLikeProps;
    const readProps = (current: UIElement) => {
        const appearance = imageAppearance(current);
        return appearance
            ? resolveImageRectangleLike(current, appearance, {
                variantOverrideId: enteredVariant(ctx, current),
                signals: DEFAULT_SYSTEM_INTERACTION_SIGNALS,
            })
            : resolve(current);
    };
    const props = readProps(element);

    const write = (updates: Partial<Record<ContainerAppearancePropertyKey, number>>) => {
        const current = documentService.getDocument().elements[element.id];
        if (!current) {
            return;
        }
        const appearance = imageAppearance(current);
        if (!appearance) {
            documentService.updateElementProps(element.id, updates);
            return;
        }
        const variantId = enteredVariant(ctx, current) ?? appearance.defaultVariantId;
        const host = findStateHost(documentService.getDocument(), current.id);
        const name = host?.states.find(state => state.id === variantId)?.name ?? variantId;
        const model = ensureVariantExists(appearance, variantId, name);
        let variant = model.variants.find(item => item.id === variantId);
        if (!variant) {
            return;
        }
        for (const [key, value] of Object.entries(updates)) {
            const group = variant.propertyGroups.find(item => item.key === key);
            if (group?.rows[0]) {
                variant = updateRowInGroup(variant, key, 0, { ...group.rows[0], value });
            } else {
                variant = {
                    ...variant,
                    propertyGroups: [
                        ...variant.propertyGroups.filter(item => item.key !== key),
                        { key: key as ContainerAppearancePropertyKey, rows: [{ conditions: null, value }] },
                    ],
                };
            }
        }
        documentService.updateElementProps(element.id, { appearance: replaceVariant(model, variantId, variant) });
    };

    return [
        {
            kind: "number",
            id: "docker-border-radius",
            label: translate("widgetChrome.dockerItems.radius"),
            tooltip: translate("widgetChrome.dockerItems.radiusHint"),
            value: props.borderRadius,
            min: 0,
            step: 1,
            onChange: (value: number) => {
                const current = documentService.getDocument().elements[element.id];
                if (!current) {
                    return;
                }
                const patch: Partial<Record<ContainerAppearancePropertyKey, number>> = { borderRadius: value };
                if (readProps(current).borderRadiusLinked) {
                    patch.borderRadiusTL = value;
                    patch.borderRadiusTR = value;
                    patch.borderRadiusBL = value;
                    patch.borderRadiusBR = value;
                }
                write(patch);
            },
        },
        {
            kind: "separator",
            id: "docker-sep-1",
        },
        {
            kind: "number",
            id: "docker-border-width",
            label: translate("widgetChrome.dockerItems.border"),
            tooltip: translate("widgetChrome.dockerItems.borderHint"),
            value: props.borderWidth,
            min: 0,
            step: 1,
            onChange: (value: number) => {
                write({ borderWidth: value });
            },
        },
    ];
}
