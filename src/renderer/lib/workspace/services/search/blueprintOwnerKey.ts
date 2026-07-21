/**
 * Parse a blueprint owner slot key (`globalMain`, `surfaceMain:<id>`,
 * `widgetMain:<surfaceId>:<elementId>`, …) into the pieces a blueprint editor open target needs.
 *
 * Lives beside the search index (its only current consumer) but is deliberately free of editor
 * imports so it stays cheap to test. Returns null for malformed or unknown keys - a search hit
 * with an unparseable owner simply has nowhere to jump.
 */
export type ParsedBlueprintOwnerKey = {
    ownerKind: "globalMain" | "surfaceMain" | "widgetMain" | "widgetValue" | "componentWidgetMain" | "storyAction";
    surfaceId?: string;
    componentId?: string;
    elementId?: string;
    propPath?: string;
};

export function parseBlueprintOwnerKey(ownerKey: string): ParsedBlueprintOwnerKey | null {
    const [kind, ...rest] = ownerKey.split(":");
    switch (kind) {
        case "globalMain":
            return { ownerKind: "globalMain" };
        case "surfaceMain":
            return rest[0] ? { ownerKind: "surfaceMain", surfaceId: rest[0] } : null;
        case "widgetMain":
            return rest[0] && rest[1]
                ? { ownerKind: "widgetMain", surfaceId: rest[0], elementId: rest[1] }
                : null;
        case "widgetValue":
            // The prop path is the tail and may itself contain separators.
            return rest[0] && rest[1] && rest.length > 2
                ? { ownerKind: "widgetValue", surfaceId: rest[0], elementId: rest[1], propPath: rest.slice(2).join(":") }
                : null;
        case "componentWidgetMain":
            return rest[0] && rest[1]
                ? { ownerKind: "componentWidgetMain", componentId: rest[0], elementId: rest[1] }
                : null;
        case "storyAction":
            return { ownerKind: "storyAction" };
        default:
            return null;
    }
}
