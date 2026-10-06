/**
 * The add-node menu's Fields group, as dragging off a struct pin opens it.
 *
 * Each entry has to make the node an author would otherwise have made by hand and then configured:
 * the same type, the field already picked, and a wire the drag can land on.
 */

import { beforeAll, describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_PARAM_FIELD,
    BLUEPRINT_NODE_PARAM_FIELD_STRUCT,
    BLUEPRINT_NODE_PARAM_INFERRED_PIN_TYPES,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_FILTER,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_FIRST,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_SORT,
    BLUEPRINT_NODE_TYPE_GAME_GET_ENDINGS,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD,
} from "@shared/types/blueprint/graph";
import { resolveUIStruct } from "@shared/types/ui-editor/builtinStructs";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { blueprintNodeRegistry } from "@/lib/ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import {
    pickBlueprintDragConnectTargetPin,
    type BlueprintDragConnectSource,
} from "@/lib/workspace/services/ui-editor/blueprint/blueprintDragConnect";
import { buildStructFieldPaletteEntries } from "./structFieldPaletteEntries";
import { BLUEPRINT_ADD_NODE_FIELDS_CATEGORY_ID } from "./BlueprintAddNodeMenuModel";

beforeAll(() => {
    registerCoreBlueprintNodes();
});

const t = (key: string, params?: Record<string, string | number>) =>
    params ? `${key}(${Object.values(params).join(",")})` : key;

/**
 * A drag off a real pin carrying `valueType`: the endings list itself, or one item taken out of it -
 * typed the way the canvas types it, with the item type stamped on the node that passes it along.
 */
function dragFrom(valueType: string, handleType: "source" | "target" = "source"): BlueprintDragConnectSource {
    const item = !valueType.startsWith("array<");
    return {
        nodeId: "src",
        handleId: item ? "item" : "endings",
        handleType,
        nodeType: item ? BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_FIRST : BLUEPRINT_NODE_TYPE_GAME_GET_ENDINGS,
        params: item ? { [BLUEPRINT_NODE_PARAM_INFERRED_PIN_TYPES]: { item: valueType } } : {},
        isExec: false,
        valueType,
        kind: handleType === "source" ? "dataOutput" : "input",
    };
}

function entries(source: BlueprintDragConnectSource) {
    return buildStructFieldPaletteEntries({
        source,
        resolveStruct: id => resolveUIStruct(null, id),
        resolveEntry: (type, params) => blueprintNodeRegistry.resolveCatalogEntryForNode(type, params),
        t: t as never,
    });
}

describe("the Fields group of the add-node menu", () => {
    it("offers one reader per field of a dragged struct, with the field already picked", () => {
        const offered = entries(dragFrom("struct:nl.ending"));
        expect(offered.map(entry => entry.preset?.params[BLUEPRINT_NODE_PARAM_FIELD])).toEqual([
            "endingId",
            "name",
            "sceneId",
            "sceneName",
            "isReached",
        ]);
        for (const entry of offered) {
            expect(entry.type).toBe(BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD);
            expect(entry.category).toBe(BLUEPRINT_ADD_NODE_FIELDS_CATEGORY_ID);
            expect(entry.preset?.params[BLUEPRINT_NODE_PARAM_FIELD_STRUCT]).toBe("nl.ending");
        }
    });

    it("offers filter, sort and find by each field of a dragged list of structs", () => {
        const offered = entries(dragFrom("array<struct:nl.ending>"));
        expect(offered).toHaveLength(15);
        const filterReached = offered.find(
            entry => entry.type === BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_FILTER && entry.preset?.params.key === "isReached",
        );
        // A boolean field is filtered for `true` from the start: the endings that are reached.
        expect(filterReached?.preset?.params.value).toBe(true);
        const sortByName = offered.find(
            entry => entry.type === BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_SORT && entry.preset?.params.key === "name",
        );
        expect(sortByName?.preset?.params).not.toHaveProperty("value");
    });

    it("lands every entry's wire on a pin it fits", () => {
        for (const valueType of ["struct:nl.ending", "array<struct:nl.ending>"]) {
            const source = dragFrom(valueType);
            for (const entry of entries(source)) {
                expect(pickBlueprintDragConnectTargetPin(source, entry)).not.toBeNull();
            }
        }
    });

    it("offers nothing for an untyped value, an input or a shape it cannot name", () => {
        expect(entries(dragFrom("json"))).toEqual([]);
        expect(entries(dragFrom("struct:nl.ending", "target"))).toEqual([]);
        expect(entries(dragFrom("struct:somebody.else"))).toEqual([]);
    });
});
