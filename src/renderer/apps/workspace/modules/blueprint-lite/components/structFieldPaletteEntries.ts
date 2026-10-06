/**
 * The add-node menu's "Fields" group: one entry per field of the struct a wire was dragged from.
 *
 * Dragging off a pin that carries an ending offers "Get isReached" at the top of the menu; dragging
 * off a list of endings offers "Filter by isReached", "Sort by name" and "Find by endingId". Each one
 * creates the ordinary node with its field already set, so the field is picked from the shape rather
 * than typed from memory - and the node it makes is one an author could have made by hand.
 *
 * Comments in English per project convention.
 */

import type { TranslationKey } from "@shared/i18n";
import {
    BLUEPRINT_NODE_PARAM_FIELD,
    BLUEPRINT_NODE_PARAM_FIELD_STRUCT,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_FILTER,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_FIND,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_SORT,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD,
} from "@shared/types/blueprint/graph";
import { blueprintArrayElementType } from "@shared/types/blueprint/valueTypes";
import {
    uiStructFieldLabel,
    uiStructFieldValueType,
    uiStructIdFromValueType,
    type UIStructDef,
    type UIStructField,
} from "@shared/types/ui-editor/struct";
import {
    BLUEPRINT_NODE_PARAMS_INLINE_LITERAL_PINS_KEY,
    type BlueprintNodeEditorCatalogEntry,
} from "@/lib/ui-editor/blueprint-nodes/types";
import { blueprintStructName, formatBlueprintValueTypeLabel } from "@/lib/ui-editor/blueprint-nodes/structTypeLabels";
import type { BlueprintDragConnectSource } from "@/lib/workspace/services/ui-editor/blueprint/blueprintDragConnect";
import { BLUEPRINT_ADD_NODE_FIELDS_CATEGORY_ID } from "./BlueprintAddNodeMenuModel";

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

type ArrayAction = {
    nodeType: string;
    title: TranslationKey;
    /** Whether the node compares against a value; such a node gets a value of the field's type. */
    compares: boolean;
};

const ARRAY_ACTIONS: readonly ArrayAction[] = [
    { nodeType: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_FILTER, title: "blueprint.addNode.filterByField", compares: true },
    { nodeType: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_SORT, title: "blueprint.addNode.sortByField", compares: false },
    { nodeType: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_FIND, title: "blueprint.addNode.findByField", compares: true },
];

/**
 * What a comparing node starts out comparing against.
 *
 * Only a boolean has an answer an author nearly always wants - "the endings that are reached" - so
 * only a boolean is filled in. Any other value is the author's to type, and a guess would be a value
 * nobody chose that quietly matches nothing.
 */
function initialCompareValue(field: UIStructField): Record<string, unknown> {
    return field.type === "boolean" ? { value: true } : {};
}

export function buildStructFieldPaletteEntries(input: {
    source: BlueprintDragConnectSource;
    resolveStruct: (structId: string) => UIStructDef | null;
    resolveEntry: (type: string, params: Record<string, unknown>) => BlueprintNodeEditorCatalogEntry;
    t: Translate;
}): BlueprintNodeEditorCatalogEntry[] {
    const { source, t } = input;
    if (source.handleType !== "source" || source.isExec) {
        return [];
    }
    const element = blueprintArrayElementType(source.valueType);
    const structId = uiStructIdFromValueType(element ?? source.valueType);
    const struct = structId ? input.resolveStruct(structId) : null;
    if (!struct || struct.fields.length === 0) {
        return [];
    }
    const structName = blueprintStructName(structId, t);
    const subtitle = (field: UIStructField) =>
        `${structName} · ${formatBlueprintValueTypeLabel(uiStructFieldValueType(field.type), t)}`;
    const entry = (
        type: string,
        params: Record<string, unknown>,
        key: string,
        title: string,
        field: UIStructField,
    ): BlueprintNodeEditorCatalogEntry => ({
        ...input.resolveEntry(type, params),
        category: BLUEPRINT_ADD_NODE_FIELDS_CATEGORY_ID,
        displayName: title,
        preset: { key, params, title, subtitle: subtitle(field) },
    });

    if (element === undefined) {
        return struct.fields.map(field =>
            entry(
                BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD,
                { [BLUEPRINT_NODE_PARAM_FIELD_STRUCT]: struct.id, [BLUEPRINT_NODE_PARAM_FIELD]: field.id },
                `read:${field.id}`,
                t("blueprint.addNode.readField", { field: uiStructFieldLabel(field) }),
                field,
            ),
        );
    }
    const out: BlueprintNodeEditorCatalogEntry[] = [];
    for (const action of ARRAY_ACTIONS) {
        for (const field of struct.fields) {
            out.push(
                entry(
                    action.nodeType,
                    {
                        key: field.key,
                        ...(action.compares ? initialCompareValue(field) : {}),
                        // Drawn open on the card, so the field the node was made for is the first
                        // thing on it rather than a value hidden behind a pin.
                        [BLUEPRINT_NODE_PARAMS_INLINE_LITERAL_PINS_KEY]: action.compares ? ["key", "value"] : ["key"],
                    },
                    `${action.nodeType}:${field.id}`,
                    t(action.title, { field: uiStructFieldLabel(field) }),
                    field,
                ),
            );
        }
    }
    return out;
}
