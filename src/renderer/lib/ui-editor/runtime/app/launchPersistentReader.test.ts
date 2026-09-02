/**
 * The reader a row-precise launch poses the stage with.
 *
 * The defect this covers had no symptom either half could show on its own: the bridge fills its
 * cache correctly and the stage walk reads whatever it is handed. What was wrong was the timing
 * between them - the walk asked before the store had answered - so the fixture is built entirely
 * around that ordering. The adapter answers on a timer, which is what an IPC round trip to the
 * profile is, and the reader is opened in the turn the adapter is installed, which is when a launch
 * asks.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import { ScopeStoreBridge } from "../../blueprint-runtime/ScopeStoreBridge";
import { openLaunchPersistentReader } from "./launchPersistentReader";

describe("openLaunchPersistentReader", () => {
    it("reads a stored value the session cache has not been filled with yet", async () => {
        const bridge = new ScopeStoreBridge();
        bridge.setPersistenceAdapter({
            // A macrotask, so no amount of microtask draining can stand in for waiting on it.
            getAll: async () => {
                await new Promise<void>(resolve => setTimeout(resolve, 0));
                return { stockings: 1 };
            },
            getValue: async () => undefined,
            setValue: async () => undefined,
        });

        // The state a launch actually starts from: the bridge has begun its own reload, nothing has
        // waited for it, and the only synchronous reader there is answers nothing.
        expect(bridge.persistenceGet("stockings")).toBeUndefined();

        const read = await openLaunchPersistentReader(bridge);

        // Without the store read inside, this is undefined - and a walk that reads undefined settles
        // the stage on the variable's declared default while the story goes on to read 1.
        expect(read("stockings")).toBe(1);
    });

    it("leaves the walk on its defaults when the store cannot be read", async () => {
        const bridge = new ScopeStoreBridge();
        bridge.setPersistenceAdapter({
            getAll: async () => {
                throw new Error("profile unavailable");
            },
            getValue: async () => undefined,
            setValue: async () => undefined,
        });

        const read = await openLaunchPersistentReader(bridge);

        expect(read("stockings")).toBeUndefined();
    });

    it("keeps reading the one cache the compiled story reads", async () => {
        const bridge = new ScopeStoreBridge();
        bridge.setPersistenceAdapter({
            getAll: async () => ({ stockings: 0 }),
            getValue: async () => undefined,
            setValue: async () => undefined,
        });

        const read = await openLaunchPersistentReader(bridge);
        expect(read("stockings")).toBe(0);

        // A Scene Snapshot override is written after the reader is opened and has to be visible
        // through it, which is only true while there is one value rather than a copy of one.
        void bridge.persistenceSet("stockings", 2);
        expect(read("stockings")).toBe(2);
    });
});
