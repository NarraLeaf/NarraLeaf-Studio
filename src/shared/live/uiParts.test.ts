import { describe, expect, it } from "vitest";
import type { UIDocument, UIElement, UISurface } from "@shared/types/ui-editor/document";
import {
    applyUIParts,
    diffUIParts,
    uiComponentDigest,
    uiPartsBefore,
    uiPartsElements,
    uiPartsRestored,
    uiPartsTouched,
    uiPartsUpdates,
    uiOwningSurfaceIds,
    uiShellDigest,
    uiSurfaceDigest,
} from "./uiParts";

/**
 * The interface document as a set of records.
 *
 * What these hold to is the one property the whole design rests on: **the delta and the applier are
 * inverses of each other**, so a machine that receives what another machine's diff produced ends up
 * holding the same document. Everything else here is a consequence of that.
 */

function element(id: string, parentId: string | null, childrenIds: string[] = []): UIElement {
    return {
        id,
        type: parentId === null ? "nl.root" : "nl.button",
        name: id,
        parentId,
        childrenIds,
        layout: { x: 0, y: 0, width: 10, height: 10 },
        props: {},
    } as unknown as UIElement;
}

function surface(id: string, rootElementId: string, name = id): UISurface {
    return {
        id,
        name,
        host: "app",
        kind: "appSurface",
        designSize: { width: 1920, height: 1080 },
        rootElementId,
    } as unknown as UISurface;
}

function document(): UIDocument {
    return {
        schemaVersion: 11,
        id: "uidoc",
        name: "Interface",
        surfaces: [surface("s1", "root-1"), surface("s2", "root-2")],
        components: [{
            id: "c1",
            name: "Save slot",
            rootElementId: "cr-1",
            elements: { "cr-1": element("cr-1", null), "cb-1": element("cb-1", "cr-1") },
        }],
        elements: {
            "root-1": element("root-1", null, ["btn-1"]),
            "btn-1": element("btn-1", "root-1"),
            "root-2": element("root-2", null),
        },
        actions: { advance: { id: "advance", name: "Advance" } as never },
    } as unknown as UIDocument;
}

function clone(value: UIDocument): UIDocument {
    return JSON.parse(JSON.stringify(value)) as UIDocument;
}

describe("the interface document as a delta of records", () => {
    it("says nothing changed when nothing did", () => {
        // A mutation that changed nothing must not become a message: several of the service's
        // methods are no-ops against the wrong element, and a room full of empty operations would
        // cost a broadcast, a sequence number and an undo step each.
        expect(diffUIParts(document(), document())).toBeNull();
    });

    it("does not call an absent key different from an undefined one", () => {
        // `{ ...element, name: undefined }` and a record parsed off disk with no `name` are the same
        // document - `JSON.stringify` writes neither - so calling them different would put an
        // operation on the wire for an edit nobody made.
        const after = clone(document());
        (after.elements["btn-1"] as unknown as Record<string, unknown>).extra = undefined;
        expect(diffUIParts(document(), after)).toBeNull();
    });

    it("names only the element a drag moved, and applying it reproduces the document", () => {
        const before = document();
        const after = clone(before);
        after.elements["btn-1"].layout = { ...after.elements["btn-1"].layout, x: 400 };

        const parts = diffUIParts(before, after);
        expect(Object.keys(parts?.elements ?? {})).toEqual(["btn-1"]);
        expect(parts?.surfaces).toBeUndefined();

        const applied = clone(before);
        applyUIParts(applied, parts!);
        expect(applied).toEqual(after);
    });

    it("carries a re-parenting as three records, because that is what changed", () => {
        // The old parent's children, the new parent's children, and the element's own `parentId`.
        // Nothing in the document says "moved": the arrangement IS those three records.
        const before = document();
        const after = clone(before);
        after.elements["btn-1"].parentId = "root-2";
        after.elements["root-1"].childrenIds = [];
        after.elements["root-2"].childrenIds = ["btn-1"];

        const parts = diffUIParts(before, after);
        expect(Object.keys(parts?.elements ?? {}).sort()).toEqual(["btn-1", "root-1", "root-2"]);

        const applied = clone(before);
        applyUIParts(applied, parts!);
        expect(applied).toEqual(after);
    });

    it("spells a deletion as null, and putting the record back undoes it", () => {
        const before = document();
        const after = clone(before);
        delete after.elements["btn-1"];
        after.elements["root-1"].childrenIds = [];

        const parts = diffUIParts(before, after)!;
        expect(parts.elements?.["btn-1"]).toBeNull();

        const kept = uiPartsBefore(before, parts);
        const applied = clone(before);
        applyUIParts(applied, parts);
        expect(applied.elements["btn-1"]).toBeUndefined();

        applyUIParts(applied, kept);
        expect(applied).toEqual(before);
    });

    it("carries a component's shell without its elements, and its elements beside it", () => {
        // ⚠ The largest component in the shipped skeleton is 24 KB whole and 400 bytes without its
        // tree, against a 16 KB message cap - so a shell that carried its elements would be a
        // component nobody could rename inside a session.
        const before = document();
        const after = clone(before);
        after.components![0].name = "Slot";
        after.components![0].elements["cb-1"].name = "Renamed";

        const parts = diffUIParts(before, after)!;
        expect(parts.components?.["c1"]).toBeDefined();
        expect(parts.components?.["c1"]).not.toHaveProperty("elements");
        expect(Object.keys(parts.componentElements?.["c1"] ?? {})).toEqual(["cb-1"]);

        const applied = clone(before);
        applyUIParts(applied, parts);
        expect(applied).toEqual(after);
    });

    it("creates a component and fills it in the same message", () => {
        // ⚠ The record has to be written before its tree: a component that has just appeared has
        // nowhere to put its elements until it is there, and the shell travels without them.
        const before = document();
        const after = clone(before);
        after.components!.push({
            id: "c2",
            name: "New",
            rootElementId: "nr-1",
            elements: { "nr-1": element("nr-1", null, ["nb-1"]), "nb-1": element("nb-1", "nr-1") },
        });

        const parts = diffUIParts(before, after)!;
        const applied = clone(before);
        applyUIParts(applied, parts);
        expect(applied).toEqual(after);
    });

    it("carries the whole order of a list whenever the list changed at all", () => {
        // A delta that named only the changed entry would leave "where does a new Surface go" to
        // each machine's own guess.
        const before = document();
        const after = clone(before);
        after.surfaces = [after.surfaces[1], after.surfaces[0]];

        const parts = diffUIParts(before, after)!;
        expect(parts.surfaceOrder).toEqual(["s2", "s1"]);

        const applied = clone(before);
        applyUIParts(applied, parts);
        expect(applied.surfaces.map(entry => entry.id)).toEqual(["s2", "s1"]);
    });

    it("adds a Surface with its whole record and puts it where the order says", () => {
        const before = document();
        const after = clone(before);
        after.elements["root-3"] = element("root-3", null);
        after.surfaces = [after.surfaces[0], surface("s3", "root-3"), after.surfaces[1]];

        const parts = diffUIParts(before, after)!;
        const applied = clone(before);
        applyUIParts(applied, parts);
        expect(applied.surfaces.map(entry => entry.id)).toEqual(["s1", "s3", "s2"]);
        expect(applied).toEqual(after);
    });
});

describe("what a delta claims and what it asserts about the document", () => {
    it("names every element it writes or removes, in both maps", () => {
        const before = document();
        const after = clone(before);
        after.elements["btn-1"].name = "Start";
        after.components![0].elements["cb-1"].name = "Slot label";

        const parts = diffUIParts(before, after)!;
        expect(uiPartsElements(parts)).toEqual([
            { componentId: null, elementId: "btn-1" },
            { componentId: "c1", elementId: "cb-1" },
        ]);
    });

    it("tells an element it is changing from one it is creating", () => {
        // ⚠ The whole of `ui-element-gone`. Nothing in a delta's shape distinguishes a new button
        // from one somebody deleted mid-drag, so the sender says which of its records were already
        // there - and a creation names an id nobody else has, which is not a race.
        const before = document();
        const after = clone(before);
        after.elements["btn-1"].name = "Start";
        after.elements["btn-2"] = element("btn-2", "root-1");

        const parts = diffUIParts(before, after)!;
        expect(uiPartsUpdates(before, parts)).toEqual([{ componentId: null, elementId: "btn-1" }]);
    });

    it("asserts nothing about a record it is removing", () => {
        const before = document();
        const after = clone(before);
        delete after.elements["btn-1"];

        const parts = diffUIParts(before, after)!;
        expect(uiPartsUpdates(before, parts)).toEqual([]);
    });

    it("puts back only what was there, so undoing a creation refuses nothing", () => {
        const before = document();
        const after = clone(before);
        after.elements["btn-2"] = element("btn-2", "root-1");

        const parts = diffUIParts(before, after)!;
        const kept = uiPartsBefore(before, parts);
        // The inverse removes the element it created, and a removal has no precondition to state.
        expect(kept.elements?.["btn-2"]).toBeNull();
        expect(uiPartsRestored(kept)).toEqual([]);
    });
});

describe("which units a delta changed", () => {
    it("names the Surface an element is under rather than the document", () => {
        const before = document();
        const after = clone(before);
        after.elements["btn-1"].layout = { ...after.elements["btn-1"].layout, x: 1 };

        const parts = diffUIParts(before, after)!;
        const owners = uiOwningSurfaceIds(before);
        applyUIParts(before, parts);
        expect(uiPartsTouched(owners, before, parts)).toEqual({ surfaces: ["s1"], components: [], shell: false });
    });

    it("names both Surfaces when an element crossed between them", () => {
        // ⚠ Which Surface an element is under is a question about the tree, and the answer moved.
        // A scope taken only after the fact would fingerprint the destination and leave the Surface
        // the element came out of unchecked.
        const before = document();
        const after = clone(before);
        after.elements["btn-1"].parentId = "root-2";

        const parts = diffUIParts(before, after)!;
        const owners = uiOwningSurfaceIds(before);
        applyUIParts(before, parts);
        expect([...uiPartsTouched(owners, before, parts).surfaces].sort()).toEqual(["s1", "s2"]);
    });

    it("names the shell for an element that belongs to no Surface", () => {
        const before = document();
        const after = clone(before);
        after.elements["loose"] = element("loose", null);

        const parts = diffUIParts(before, after)!;
        const owners = uiOwningSurfaceIds(before);
        applyUIParts(before, parts);
        expect(uiPartsTouched(owners, before, parts).shell).toBe(true);
    });
});

describe("the fingerprints", () => {
    it("covers a Surface's whole tree and nothing outside it", () => {
        const moved = clone(document());
        moved.elements["btn-1"].layout = { ...moved.elements["btn-1"].layout, x: 9 };
        expect(uiSurfaceDigest(moved, "s1")).not.toBe(uiSurfaceDigest(document(), "s1"));
        expect(uiSurfaceDigest(moved, "s2")).toBe(uiSurfaceDigest(document(), "s2"));
    });

    it("gives an absent Surface a value rather than no digest", () => {
        // With the cast's record and against the scene's: deleting a Surface is an operation like
        // any other, and answering null would rule `unproven` on exactly the effect that proves two
        // copies have parted company.
        const without = clone(document());
        without.surfaces = without.surfaces.filter(entry => entry.id !== "s2");
        expect(uiSurfaceDigest(without, "s2")).toBe(uiSurfaceDigest(null, "s2"));
        expect(uiSurfaceDigest(without, "s2")).not.toBe(uiSurfaceDigest(document(), "s2"));
    });

    it("keeps a component's own elements inside the component's digest", () => {
        const renamed = clone(document());
        renamed.components![0].elements["cb-1"].name = "x";
        expect(uiComponentDigest(renamed, "c1")).not.toBe(uiComponentDigest(document(), "c1"));
        expect(uiSurfaceDigest(renamed, "s1")).toBe(uiSurfaceDigest(document(), "s1"));
    });

    it("puts the document's own fields and its orphans in the shell", () => {
        const renamed = clone(document());
        renamed.name = "Another";
        expect(uiShellDigest(renamed)).not.toBe(uiShellDigest(document()));

        const orphaned = clone(document());
        orphaned.elements["loose"] = element("loose", null);
        expect(uiShellDigest(orphaned)).not.toBe(uiShellDigest(document()));
        // And the orphan is in nobody's Surface, which is why the shell has to carry it.
        expect(uiSurfaceDigest(orphaned, "s1")).toBe(uiSurfaceDigest(document(), "s1"));
    });

    it("ignores a difference no file can hold", () => {
        // The canonical encoder rejects an `undefined` property by name, and the interface services
        // produce them freely. Hashing those differently would eject a machine over nothing.
        const spread = clone(document());
        (spread.elements["btn-1"] as unknown as Record<string, unknown>).extra = undefined;
        expect(uiSurfaceDigest(spread, "s1")).toBe(uiSurfaceDigest(document(), "s1"));
    });
});
