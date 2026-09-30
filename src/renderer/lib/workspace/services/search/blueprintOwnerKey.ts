import { decodeBlueprintOwnerKey } from "@shared/blueprint/ownerKey";

/**
 * A blueprint owner slot key, in the shape a search hit needs to open an editor on it.
 *
 * A flattened view of `BlueprintOwnerRef`: the jump target wants "which surface, which element,
 * which prop" without switching on a union, and a hit whose owner cannot be read simply has nowhere
 * to go.
 *
 * The reading itself is `@shared/blueprint/ownerKey`'s. This file used to split the key on every
 * separator, which meant that for a widget on the built-in surface - whose id is
 * `narraleaf-studio:main-surface` - it took `narraleaf-studio` for the surface, `main-surface` for
 * the element, and silently dropped the element id the author was searching for.
 */
export type ParsedBlueprintOwnerKey = {
    ownerKind: "globalMain" | "surfaceMain" | "widgetMain" | "widgetValue" | "componentWidgetMain" | "storyAction";
    surfaceId?: string;
    componentId?: string;
    elementId?: string;
    propPath?: string;
};

export function parseBlueprintOwnerKey(ownerKey: string): ParsedBlueprintOwnerKey | null {
    const owner = decodeBlueprintOwnerKey(ownerKey);
    if (!owner) {
        return null;
    }
    switch (owner.kind) {
        case "globalMain":
            return { ownerKind: "globalMain" };
        case "surfaceMain":
            return { ownerKind: "surfaceMain", surfaceId: owner.surfaceId };
        case "widgetMain":
            return { ownerKind: "widgetMain", surfaceId: owner.surfaceId, elementId: owner.elementId };
        case "widgetValue":
            return {
                ownerKind: "widgetValue",
                surfaceId: owner.surfaceId,
                elementId: owner.elementId,
                propPath: owner.propPath,
            };
        case "componentWidgetMain":
            return { ownerKind: "componentWidgetMain", componentId: owner.componentId, elementId: owner.elementId };
        case "storyAction":
            // The story blueprint is its own key, so there is no surface or element to carry; the
            // jump target resolves the row from the blueprint itself.
            return { ownerKind: "storyAction" };
        default: {
            // An owner kind added without an arm here would otherwise return null, and a null owner
            // is "this hit has nowhere to go" - so every blueprint of the new kind would be found by
            // search and refuse to open.
            const unreachable: never = owner;
            return unreachable;
        }
    }
}
