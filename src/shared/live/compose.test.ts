import { describe, expect, it } from "vitest";
import { assertionAddress, composeAssertedRecord } from "./compose";
import { composeUIParts } from "./uiParts";

/**
 * Folding what a guest has already said into what it is about to say.
 *
 * ⚠ **The defect being measured.** A guest changes nothing on its own initiative, so the service
 * that owns a record reads it as the gesture would have written it, hands that over, and puts the
 * record back. A second gesture inside the same round trip therefore measures against a record with
 * the first one missing - and states it whole. The host applies both and the first is gone, in the
 * middle of somebody typing.
 *
 * Three sides, and the base is what makes it sound: a field that differs from what the document
 * holds is a field this gesture touched, and everything else is one it merely restated.
 */

describe("which unit an operation asserts a value for", () => {
    it("prefixes, so one document's id cannot answer for another's", () => {
        expect(assertionAddress({ op: "update-character", characterId: "x", character: {} as never }))
            .toBe("character:x");
        expect(assertionAddress({ op: "set-translation", locale: "fr", unitId: "x", unit: null }))
            .toBe("translation:fr/x");
        expect(assertionAddress({ op: "update-asset", assetType: "image", assetId: "x", record: {} }))
            .toBe("asset:image/x");
    });

    it("has no address for a verb that names its own change", () => {
        // An insert, a rename, a deletion: two of those in flight together do not describe each
        // other, so there is nothing to compose and nothing to hold.
        expect(assertionAddress({ op: "rename-story", name: "Tale" })).toBeNull();
        expect(assertionAddress({ op: "delete-character", characterId: "x" })).toBeNull();
    });

    it("gives the interface one address for the whole document", () => {
        // Not a shortcut: `write-ui` already carries a delta of exactly the records that changed,
        // so two of them compose record by record without anything naming an element here.
        expect(assertionAddress({ op: "write-ui", parts: {} })).toBe("ui");
    });
});

describe("composing one record", () => {
    const base = { name: "Ada", note: "", colour: "red" };

    it("keeps a field the first gesture changed and the second did not restate differently", () => {
        const pending = { ...base, name: "Ada Lovelace" };
        const next = { ...base, colour: "blue" };

        expect(composeAssertedRecord(pending, base, next))
            .toEqual({ name: "Ada Lovelace", note: "", colour: "blue" });
    });

    it("lets the second gesture win where both touched one field", () => {
        const pending = { ...base, name: "Ada Lovelace" };
        const next = { ...base, name: "A. Lovelace" };

        expect(composeAssertedRecord(pending, base, next).name).toBe("A. Lovelace");
    });

    it("reaches into a nested record, because two gestures are usually in different halves of one", () => {
        const nested = { profile: { name: "Ada", tags: ["a"] }, appearance: { poses: [] } };
        const pending = { ...nested, profile: { ...nested.profile, name: "Ada Lovelace" } };
        const next = { ...nested, appearance: { poses: ["stand"] } };

        expect(composeAssertedRecord(pending, nested, next)).toEqual({
            profile: { name: "Ada Lovelace", tags: ["a"] },
            appearance: { poses: ["stand"] },
        });
    });

    it("takes an array whole rather than merging two orderings", () => {
        // Nothing in an array is addressed, so a merge of two of them would be an order neither
        // author chose.
        const nested = { tags: ["a", "b"] };
        expect(composeAssertedRecord({ tags: ["a", "b", "c"] }, nested, { tags: ["b", "a"] }))
            .toEqual({ tags: ["b", "a"] });
    });

    it("carries a removal, which is a change like any other", () => {
        const pending = { ...base, name: "Ada Lovelace" };
        const { colour: _dropped, ...withoutColour } = base;

        expect(composeAssertedRecord(pending, base, withoutColour))
            .toEqual({ name: "Ada Lovelace", note: "" });
    });

    it("keeps a removal the first gesture made when the second did not touch that field", () => {
        const { note: _dropped, ...pending } = base;

        expect(composeAssertedRecord(pending, base, { ...base, colour: "blue" }))
            .toEqual({ name: "Ada", colour: "blue" });
    });

    it("states a value whole where it is not a record on every side", () => {
        // A translation unit that was cleared is null, and null is a value here rather than an
        // absence - there is nothing to read field by field.
        expect(composeAssertedRecord({ target: "salut" }, { target: "bonjour" }, null)).toBeNull();
    });
});

describe("composing two interface deltas", () => {
    it("keeps a record only the earlier delta names", () => {
        const composed = composeUIParts(
            { elements: { a: { id: "a" } as never } },
            { elements: { b: { id: "b" } as never } },
        );
        expect(Object.keys(composed.elements ?? {}).sort()).toEqual(["a", "b"]);
    });

    it("lets the later delta win a record both name", () => {
        // Both are this window's own, taken a few hundred milliseconds apart, and the later one
        // was read from a document holding neither - so its version is what the author asked for.
        const composed = composeUIParts(
            { elements: { a: { id: "a", name: "first" } as never } },
            { elements: { a: { id: "a", name: "second" } as never } },
        );
        expect((composed.elements?.a as { name: string }).name).toBe("second");
    });

    it("composes one component's own elements without disturbing another's", () => {
        const composed = composeUIParts(
            { componentElements: { c1: { a: { id: "a" } as never } } },
            { componentElements: { c1: { b: { id: "b" } as never }, c2: { z: null } } },
        );
        expect(Object.keys(composed.componentElements?.c1 ?? {}).sort()).toEqual(["a", "b"]);
        expect(composed.componentElements?.c2).toEqual({ z: null });
    });

    it("carries a deletion, which a delta states as null", () => {
        const composed = composeUIParts(
            { elements: { a: { id: "a" } as never } },
            { elements: { a: null } },
        );
        expect(composed.elements).toEqual({ a: null });
    });

    it("takes the later order, because a list already contains what the earlier one did to it", () => {
        const composed = composeUIParts(
            { surfaces: { s1: { id: "s1" } as never }, surfaceOrder: ["s1"] },
            { surfaces: { s2: { id: "s2" } as never }, surfaceOrder: ["s2", "s1"] },
        );
        expect(composed.surfaceOrder).toEqual(["s2", "s1"]);
    });

    it("says nothing about a collection neither delta touched", () => {
        // An empty map on the wire would be a statement that the document holds no structs.
        const composed = composeUIParts({ elements: { a: null } }, { elements: { b: null } });
        expect(composed.structs).toBeUndefined();
        expect(composed.components).toBeUndefined();
        expect(composed.name).toBeUndefined();
    });
});
