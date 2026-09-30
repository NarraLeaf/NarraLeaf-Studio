import { describe, expect, it } from "vitest";
import { SurfaceStateStore } from "./SurfaceStateStore";

/**
 * What a listener is told, and what it is spared.
 *
 * A listener's answer to "state changed" is to rebuild a surface's whole element tree, so a write
 * that leaves the store saying what it already said is a page's worth of work for no visible
 * difference - and blueprints write those constantly, seeding defaults on entry and committing
 * values a control is already at.
 */
describe("SurfaceStateStore", () => {
    function record(store: SurfaceStateStore): { count: number } {
        const seen = { count: 0 };
        store.subscribe(() => {
            seen.count += 1;
        });
        return seen;
    }

    it("says nothing when a primitive is written over itself", () => {
        const store = new SurfaceStateStore("surface");
        store.set("tab", "text");
        const seen = record(store);

        store.set("tab", "text");
        store.set("tab", "text");

        expect(seen.count).toBe(0);
        expect(store.get("tab")).toBe("text");
    });

    it("announces a value that really moved", () => {
        const store = new SurfaceStateStore("surface");
        store.set("tab", "text");
        const seen = record(store);

        store.set("tab", "sound");

        expect(seen.count).toBe(1);
        expect(store.get("tab")).toBe("sound");
    });

    it("announces the first write of a key, even one that writes undefined", () => {
        // `get` cannot tell an absent key from one holding `undefined`, but `getSnapshot` can, and
        // that is what the Dev Mode state debugger lists.
        const store = new SurfaceStateStore("surface");
        const seen = record(store);

        store.set("chosen", undefined);

        expect(seen.count).toBe(1);
        expect(store.getSnapshot().has("chosen")).toBe(true);
    });

    it("keeps announcing an object written under the same key", () => {
        // The same reference may hold different contents, and nothing here can tell that apart from
        // a write that changed nothing - so the quiet path is for primitives only.
        const store = new SurfaceStateStore("surface");
        const value = { rows: [1] };
        store.set("table", value);
        const seen = record(store);

        value.rows.push(2);
        store.set("table", value);

        expect(seen.count).toBe(1);
    });

    it("treats the two zeroes as the different values they are", () => {
        const store = new SurfaceStateStore("surface");
        store.set("offset", 0);
        const seen = record(store);

        store.set("offset", -0);

        expect(seen.count).toBe(1);
    });

    it("does not announce NaN over NaN, which is one value however it compares", () => {
        const store = new SurfaceStateStore("surface");
        store.set("ratio", Number.NaN);
        const seen = record(store);

        store.set("ratio", Number.NaN);

        expect(seen.count).toBe(0);
    });
});
