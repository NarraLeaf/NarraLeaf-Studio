import { describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { removePrivateBlueprint } from "./ownerRecords";
import { widgetMainOwnerKey } from "./ownerKeys";

/**
 * Removing one of a slot's revisions.
 *
 * A revision could be made and never unmade: creating one wrote a file, and the only way back was to
 * leave the unwanted revision sitting in the list forever. What the removal must not do is take the
 * file with it - Studio writes a script once and the disk owns it after that - and it must not empty
 * the slot, because a value binding is addressed through the slot's record.
 */

const KEY = widgetMainOwnerKey("surface-1", "el-button");

function documentWith(ids: string[], activeId: string): BlueprintDocument {
    return {
        blueprints: Object.fromEntries(ids.map(id => [id, { id, name: id }])),
        ownerRecords: { [KEY]: { privateBlueprintIds: [...ids], activeBlueprintId: activeId } },
    } as unknown as BlueprintDocument;
}

describe("removePrivateBlueprint", () => {
    it("drops the revision and its blueprint record", () => {
        const doc = documentWith(["bp-1", "bp-2"], "bp-1");
        removePrivateBlueprint(doc, KEY, "bp-2");
        expect(doc.ownerRecords[KEY]!.privateBlueprintIds).toEqual(["bp-1"]);
        expect(doc.blueprints["bp-2"]).toBeUndefined();
    });

    it("promotes the revision before it when the active one is removed", () => {
        const doc = documentWith(["bp-1", "bp-2", "bp-3"], "bp-2");
        removePrivateBlueprint(doc, KEY, "bp-2");
        // The one the author was on before they made this: the list is in creation order.
        expect(doc.ownerRecords[KEY]!.activeBlueprintId).toBe("bp-1");
    });

    it("promotes the first survivor when the removed one was at the head", () => {
        const doc = documentWith(["bp-1", "bp-2"], "bp-1");
        removePrivateBlueprint(doc, KEY, "bp-1");
        expect(doc.ownerRecords[KEY]!.activeBlueprintId).toBe("bp-2");
    });

    it("refuses the last revision, so the slot always has a record", () => {
        const doc = documentWith(["bp-1"], "bp-1");
        expect(() => removePrivateBlueprint(doc, KEY, "bp-1")).toThrow();
        expect(doc.blueprints["bp-1"]).toBeDefined();
    });

    it("ignores an id this slot does not hold", () => {
        const doc = documentWith(["bp-1", "bp-2"], "bp-1");
        removePrivateBlueprint(doc, KEY, "bp-elsewhere");
        expect(doc.ownerRecords[KEY]!.privateBlueprintIds).toEqual(["bp-1", "bp-2"]);
    });
});
