import { defineField } from "@/apps/workspace/modules/properties/framework";
import type {
    FieldDefinition,
    SelectFieldDefinition,
    SelectOption,
    ToggleFieldDefinition,
} from "@/apps/workspace/modules/properties/framework/types";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import type { Translator } from "@shared/i18n";
import { isOperableWidgetType } from "@shared/types/ui-editor/inputAction";
import { uiElementTypeAcceptsChildren, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import {
    normalizeUIElementNavigation,
    readUIElementNavigation,
    UI_NAVIGATION_DIRECTIONS,
    type UIElementNavigation,
    type UIFocusability,
    type UINavigationDirection,
} from "@shared/types/ui-editor/navigation";
import { navigationTargetOptions } from "./navigationTargetOptions";

type TranslateFn = Translator["t"];

/** The value a direction's select shows for "wherever the layout says". */
const BY_LAYOUT = "";

/**
 * The elements an override may name: what the focus can rest on in the same surface, but the element
 * itself and the groups that hold it - moving into those is not moving to a neighbour.
 */
function neighborOptions(data: UIInspectorData, direction: UINavigationDirection, t: TranslateFn): SelectOption[] {
    const document: UIDocument = data.documentService.getDocument();
    const exclude = new Set<string>([data.element.id]);
    let root: UIElement = data.element;
    while (root.parentId && document.elements[root.parentId] && !exclude.has(root.parentId)) {
        root = document.elements[root.parentId];
        exclude.add(root.id);
    }
    return [
        { value: BY_LAYOUT, label: t("properties.navigation.byLayout") },
        ...navigationTargetOptions({
            document,
            rootId: root.id,
            t,
            exclude,
            current: readUIElementNavigation(data.element).neighbors?.[direction],
        }),
    ];
}

/** Write one change to the element's record, as one undo entry per field visited. */
function write(data: UIInspectorData, field: string, change: (current: UIElementNavigation) => UIElementNavigation): void {
    const next = change(readUIElementNavigation(data.element));
    data.documentService.updateElementNavigation(data.element.id, next, {
        mergeKey: `element:${data.element.id}:navigation:${field}`,
    });
}

function directionLabel(direction: UINavigationDirection, t: TranslateFn): string {
    switch (direction) {
        case "up":
            return t("properties.navigation.up");
        case "down":
            return t("properties.navigation.down");
        case "left":
            return t("properties.navigation.left");
        case "right":
            return t("properties.navigation.right");
    }
}

/**
 * How the player reaches an element without a pointer, the section every element gets beside its
 * sound and animation - for the reason those are built here: being reachable by a pad is not a
 * property of being a button, and no widget module has to remember to offer it.
 *
 * Open when the element already says something, so selecting it shows what it says. Keyed by element
 * for the reason the sound section is.
 */
export function createElementNavigationField(element: UIElement, t: TranslateFn): FieldDefinition<UIInspectorData> | null {
    // A surface's root is the surface: where the focus starts on it is the surface's own setting.
    if (element.parentId === null) {
        return null;
    }
    // A group is a container of controls; a button that holds its own label is one control.
    const isGroupable = uiElementTypeAcceptsChildren(element.type) && !isOperableWidgetType(element.type);
    const isGroup = (data: UIInspectorData) => Boolean(readUIElementNavigation(data.element).region);
    const fields: FieldDefinition<UIInspectorData>[] = [
        defineField<UIInspectorData, SelectFieldDefinition<UIInspectorData>>({
            id: `element.navigation.focusable:${element.id}`,
            type: "select",
            label: t("properties.navigation.focusable"),
            tip: t("properties.navigation.focusableTip"),
            options: [
                { value: "auto", label: t("properties.navigation.focusableAuto") },
                { value: "always", label: t("properties.navigation.focusableAlways") },
                { value: "never", label: t("properties.navigation.focusableNever") },
            ],
            getValue: data => readUIElementNavigation(data.element).focusable ?? "auto",
            setValue: (data, value) => write(data, "focusable", current => ({
                ...current,
                focusable: value === "auto" ? undefined : (value as UIFocusability),
            })),
        }),
        defineField<UIInspectorData, ToggleFieldDefinition<UIInspectorData>>({
            id: `element.navigation.preferred:${element.id}`,
            type: "toggle",
            label: t("properties.navigation.preferredOnEntry"),
            tip: t("properties.navigation.preferredOnEntryTip"),
            getValue: data => readUIElementNavigation(data.element).preferredOnEntry === true,
            setValue: (data, value) => write(data, "preferredOnEntry", current => ({
                ...current,
                preferredOnEntry: value || undefined,
            })),
        }),
    ];
    if (isGroupable) {
        fields.push(
            defineField<UIInspectorData, ToggleFieldDefinition<UIInspectorData>>({
                id: `element.navigation.region:${element.id}`,
                type: "toggle",
                label: t("properties.navigation.region"),
                tip: t("properties.navigation.regionTip"),
                getValue: isGroup,
                setValue: (data, value) => write(data, "region", current => ({
                    ...current,
                    region: value ? (current.region ?? {}) : undefined,
                })),
            }),
            defineField<UIInspectorData, ToggleFieldDefinition<UIInspectorData>>({
                id: `element.navigation.wrap:${element.id}`,
                type: "toggle",
                label: t("properties.navigation.wrap"),
                hidden: data => !isGroup(data),
                getValue: data => readUIElementNavigation(data.element).region?.wrap === true,
                setValue: (data, value) => write(data, "wrap", current => ({
                    ...current,
                    region: { ...(current.region ?? {}), wrap: value || undefined },
                })),
            }),
            defineField<UIInspectorData, ToggleFieldDefinition<UIInspectorData>>({
                id: `element.navigation.remember:${element.id}`,
                type: "toggle",
                label: t("properties.navigation.rememberLast"),
                hidden: data => !isGroup(data),
                getValue: data => readUIElementNavigation(data.element).region?.rememberLast === true,
                setValue: (data, value) => write(data, "rememberLast", current => ({
                    ...current,
                    region: { ...(current.region ?? {}), rememberLast: value || undefined },
                })),
            }),
        );
    }
    for (const direction of UI_NAVIGATION_DIRECTIONS) {
        fields.push(defineField<UIInspectorData, SelectFieldDefinition<UIInspectorData>>({
            id: `element.navigation.${direction}:${element.id}`,
            type: "select",
            label: directionLabel(direction, t),
            ...(direction === "up" ? { tip: t("properties.navigation.neighborsTip") } : {}),
            options: data => neighborOptions(data, direction, t),
            getValue: data => readUIElementNavigation(data.element).neighbors?.[direction] ?? BY_LAYOUT,
            setValue: (data, value) => write(data, `neighbor.${direction}`, current => ({
                ...current,
                neighbors: { ...(current.neighbors ?? {}), [direction]: value === BY_LAYOUT ? undefined : String(value) },
            })),
        }));
    }
    return defineField<UIInspectorData, any>({
        id: `element.navigation:${element.id}`,
        type: "section",
        title: t("properties.navigation.title"),
        collapsible: true,
        defaultCollapsed: normalizeUIElementNavigation(element.navigation) === null,
        fields,
    });
}
