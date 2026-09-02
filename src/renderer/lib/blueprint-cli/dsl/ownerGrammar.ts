import type { BlueprintOwnerRef } from "@shared/types/blueprint/document";

/**
 * The `owner=` line of a `.bp` file: which fields each owner kind carries, and what they are called.
 *
 * One table because five places used to state it separately - the reader's field aliases, the
 * reader's "one of" hint, the compiler's required-field check, the compiler's construction switch,
 * and the printer. Removing an owner kind reached four of them: `sharedAsset` went away in schema
 * 12, its `asset=` field with it, and the reader went on advertising `asset` as a known field while
 * refusing it, so an author who followed the hint got "Unknown blueprint field" for the word the
 * error had just recommended.
 *
 * Keyed by the union rather than by `string`, so an owner kind added to `BlueprintOwnerRef` is a
 * compile error here. That matters more for the printer than it looks: its old fallback arm labelled
 * anything it did not recognise `owner=globalMain`, which reads back as a project-wide blueprint -
 * `show` then `apply` would have moved it there rather than failing.
 *
 * Comments in English per project convention.
 */

/** One field of an `owner=` line. */
export type BlueprintOwnerField = {
    /** What a `.bp` file calls it. */
    text: string;
    /** The property it becomes on {@link BlueprintOwnerRef}. */
    prop: string;
    /** Absent from a file is legal, and it is printed only when the owner carries it. */
    optional?: boolean;
};

/** Every owner kind, with its fields in the order they are written. */
export const BLUEPRINT_OWNER_GRAMMAR: Record<BlueprintOwnerRef["kind"], readonly BlueprintOwnerField[]> = {
    globalMain: [],
    surfaceMain: [{ text: "surface", prop: "surfaceId" }],
    widgetMain: [
        { text: "surface", prop: "surfaceId" },
        { text: "element", prop: "elementId" },
    ],
    widgetValue: [
        { text: "surface", prop: "surfaceId" },
        { text: "element", prop: "elementId" },
        { text: "prop", prop: "propPath" },
    ],
    componentWidgetMain: [
        { text: "component", prop: "componentId" },
        { text: "element", prop: "elementId" },
    ],
    storyAction: [
        { text: "blueprint", prop: "blueprintId" },
        // How the row consumes the graph, not which slot this is - so a file that omits it means
        // the default, `action`, exactly as a stored owner with no `mode` does.
        { text: "mode", prop: "mode", optional: true },
    ],
};

/** The owner kinds, for a diagnostic that has to list them. */
export const BLUEPRINT_OWNER_KINDS = Object.keys(BLUEPRINT_OWNER_GRAMMAR) as BlueprintOwnerRef["kind"][];

/** Whether a word written in a file is an owner kind at all. */
export function isBlueprintOwnerKind(kind: string): kind is BlueprintOwnerRef["kind"] {
    return Object.hasOwn(BLUEPRINT_OWNER_GRAMMAR, kind);
}

/**
 * Field name as written, lower-cased, to the property it sets.
 *
 * Both spellings are accepted - `surface=` and `surfaceId=` - because the printer emits the short
 * one and `ui surfaces` prints the short one, while a person writing a file by hand from the type
 * reaches for the long one.
 */
export function blueprintOwnerFieldAliases(): Record<string, string> {
    const aliases: Record<string, string> = {};
    for (const fields of Object.values(BLUEPRINT_OWNER_GRAMMAR)) {
        for (const field of fields) {
            aliases[field.text.toLowerCase()] = field.prop;
            aliases[field.prop.toLowerCase()] = field.prop;
        }
    }
    return aliases;
}

/** The properties an owner of this kind cannot be built without. */
export function requiredBlueprintOwnerProps(kind: BlueprintOwnerRef["kind"]): string[] {
    return BLUEPRINT_OWNER_GRAMMAR[kind].filter(field => !field.optional).map(field => field.prop);
}

/** Every field name a reader accepts, for the hint on an unknown one. */
export function knownBlueprintOwnerFieldNames(): string[] {
    const names = new Set<string>();
    for (const fields of Object.values(BLUEPRINT_OWNER_GRAMMAR)) {
        for (const field of fields) {
            names.add(field.text);
        }
    }
    return [...names];
}
