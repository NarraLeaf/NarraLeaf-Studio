/**
 * The persistence half of the scope bridge, which is where three shipped defects came from.
 *
 * All three were the same mistake — a value written to the in-memory map and never to the store —
 * and all three were reachable because there were two setters and the memory-only one was the
 * easier to call. There is one setter now. What follows is the contract that made merging them
 * possible: the map is updated synchronously, so a caller whose next line reads the value still
 * sees it, and the store write is what the returned promise is for.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it, vi } from "vitest";
import { ScopeStoreBridge, type BlueprintPersistentStoreAdapter } from "./ScopeStoreBridge";

function adapterSpy(overrides?: Partial<BlueprintPersistentStoreAdapter>) {
    const writes: Array<[string, unknown]> = [];
    const removes: string[] = [];
    let release: (() => void) | null = null;
    const adapter: BlueprintPersistentStoreAdapter = {
        getAll: async () => ({}),
        getValue: async () => undefined,
        setValue: async (key, value) => {
            writes.push([key, value]);
            if (release) {
                await new Promise<void>(resolve => {
                    release = resolve as unknown as () => void;
                    resolve();
                });
            }
        },
        removeValue: async key => {
            removes.push(key);
        },
        ...overrides,
    };
    return { adapter, writes, removes };
}

/** A bridge with its adapter installed and the initial snapshot read settled. */
async function bridgeWith(adapter: BlueprintPersistentStoreAdapter): Promise<ScopeStoreBridge> {
    const bridge = new ScopeStoreBridge();
    bridge.setPersistenceAdapter(adapter);
    await bridge.reloadPersistenceSnapshot();
    return bridge;
}

describe("ScopeStoreBridge persistence", () => {
    it("makes the value readable before the store write has resolved", async () => {
        const { adapter } = adapterSpy({
            // Never settles for the duration of this test: if the map update waited on the store,
            // the read below would miss, which is exactly the bug the old ordering created.
            setValue: () => new Promise<void>(() => undefined),
        });
        const bridge = await bridgeWith(adapter);

        const pending = bridge.persistenceSet("k", 1);
        expect(bridge.persistenceGet("k")).toBe(1);
        expect(pending).toBeInstanceOf(Promise);
    });

    it("hands the value to the store", async () => {
        const { adapter, writes } = adapterSpy();
        const bridge = await bridgeWith(adapter);

        await bridge.persistenceSet("k", "v");
        expect(writes).toEqual([["k", "v"]]);
    });

    it("removes rather than stores undefined, on both halves", async () => {
        const { adapter, removes } = adapterSpy();
        const bridge = await bridgeWith(adapter);
        await bridge.persistenceSet("k", "v");

        await bridge.persistenceSet("k", undefined);
        expect(removes).toEqual(["k"]);
        expect(bridge.persistenceGet("k")).toBeUndefined();
        expect(bridge.getPersistenceSnapshot().has("k")).toBe(false);
    });

    it("notifies subscribers once the value is readable, not once it is stored", async () => {
        const { adapter } = adapterSpy({ setValue: () => new Promise<void>(() => undefined) });
        const bridge = await bridgeWith(adapter);
        const seen: unknown[] = [];
        bridge.subscribePersistence(() => seen.push(bridge.persistenceGet("k")));

        void bridge.persistenceSet("k", 7);
        // A panel redrawing on this notification has to find the new value, not the old one.
        expect(seen).toEqual([7]);
    });

    it("resolves without a store behind it rather than throwing", async () => {
        const bridge = new ScopeStoreBridge();
        await expect(bridge.persistenceSet("k", 1)).resolves.toBeUndefined();
        expect(bridge.persistenceGet("k")).toBe(1);
    });

    it("keeps a session-only write out of the store while still making it readable", async () => {
        const { adapter, writes } = adapterSpy();
        const bridge = await bridgeWith(adapter);

        bridge.persistenceSetSessionOnly("k", "derived");
        expect(bridge.persistenceGet("k")).toBe("derived");
        await vi.waitFor(() => expect(writes).toEqual([]));
    });
});
