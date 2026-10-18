/**
 * Every row of a list gets a key no other row of it has.
 *
 * A row's key is its React key, so two rows sharing one are reconciled as one, and the rows React
 * loses that way are never removed - they stay on screen as blank rows holding their height.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import { resolveUIStruct } from "@shared/types/ui-editor/builtinStructs";
import { makeDefaultStructItem } from "@shared/types/ui-editor/struct";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { UIStructDef } from "@shared/types/ui-editor/struct";
import { resolveListRowKeys } from "./helpers";

const choiceStruct = resolveUIStruct({ elements: {}, surfaces: [] } as unknown as UIDocument, "nl.choiceItem");
const recordStruct = { id: "record", fields: [{ id: "f-id", key: "id", type: "string" }] } as unknown as UIStructDef;

describe("resolveListRowKeys", () => {
    it("keys a row by its declared key field", () => {
        const items = [{ text: "A", index: 0 }, { text: "B", index: 1 }, { text: "C", index: 7 }];
        expect(resolveListRowKeys(items, choiceStruct, "index")).toEqual(["0", "1", "7"]);
    });

    it("falls back to the position when the key field holds nothing usable", () => {
        expect(resolveListRowKeys([{ name: "A" }, { name: "B" }], recordStruct, "f-id")).toEqual(["0", "1"]);
        expect(resolveListRowKeys(["x", "y"], null, null)).toEqual(["0", "1"]);
    });

    it("tells apart placeholder rows that all hold the empty value of the key field", () => {
        const placeholders = Array.from({ length: 4 }, () => makeDefaultStructItem(choiceStruct));
        const keys = resolveListRowKeys(placeholders, choiceStruct, "index");

        expect(keys[0]).toBe("0");
        expect(new Set(keys).size).toBe(4);
    });

    it("lets the first row keep a repeated key and moves the later ones off it", () => {
        const items = [{ index: 3 }, { index: 3 }, { index: 5 }, { index: 3 }];
        expect(resolveListRowKeys(items, choiceStruct, "index")).toEqual(["3", "3#1", "5", "3#3"]);
    });

    it("never lands a moved key on a key another row declares", () => {
        const items = [{ id: "a" }, { id: "a" }, { id: "a#1" }];
        const keys = resolveListRowKeys(items, recordStruct, "f-id");

        // The row that declares `a#1` keeps it; the repeat of `a` is moved past it.
        expect(keys).toEqual(["a", "a#1.1", "a#1"]);
    });
});
