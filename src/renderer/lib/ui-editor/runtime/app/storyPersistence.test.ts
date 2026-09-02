/**
 * Everything a story boot reads persistent values through.
 *
 * The defect this covers had no symptom either half could show on its own: the bridge fills its
 * cache correctly and the readers read whatever they are handed. What was wrong was the timing
 * between them - the boot asked before the store had answered - so the fixture is built entirely
 * around that ordering. The adapter answers on a timer, which is what an IPC round trip to the
 * profile is, and the readers are opened in the turn the adapter is installed, which is when a boot
 * asks.
 *
 * The last test reads `GameApp` as text, the way `savePlaytimeForwarding` does, because the thing
 * that has to hold is an ORDER inside one function and no type can insist on it: a boot that built
 * its persistence port straight from the bridge would compile, pass every test above, and be back
 * to racing the reload on every launch.
 *
 * Comments in English per project convention.
 */

import fs from "fs/promises";
import path from "path";
import { describe, expect, it } from "vitest";
import { ScopeStoreBridge } from "../../blueprint-runtime/ScopeStoreBridge";
import { openStoryPersistence } from "./storyPersistence";

/** A store that answers after a macrotask: no amount of microtask draining stands in for waiting. */
function bridgeAnsweringLate(values: Record<string, unknown>): ScopeStoreBridge {
    const bridge = new ScopeStoreBridge();
    bridge.setPersistenceAdapter({
        getAll: async () => {
            await new Promise<void>(resolve => setTimeout(resolve, 0));
            return values;
        },
        getValue: async () => undefined,
        setValue: async () => undefined,
    });
    return bridge;
}

describe("openStoryPersistence", () => {
    it("poses the stage from a stored value the session cache has not been filled with yet", async () => {
        const bridge = bridgeAnsweringLate({ stockings: 1 });

        // The state a boot actually starts from: the bridge has begun its own reload, nothing has
        // waited for it, and the only synchronous reader there is answers nothing.
        expect(bridge.persistenceGet("stockings")).toBeUndefined();

        const persistence = await openStoryPersistence(bridge);

        // Without the store read inside, this is undefined - and a walk that reads undefined settles
        // the stage on the variable's declared default while the story goes on to read 1.
        expect(persistence.readPersistent("stockings")).toBe(1);
    });

    it("runs the story from that same value, through the port the compiler is handed", async () => {
        // The other half of the same race, and the one that used to win it by luck: a persistent
        // condition inside the running story reads through this port, synchronously, and a boot that
        // handed over an unprimed one would evaluate it against nothing.
        const bridge = bridgeAnsweringLate({ stockings: 1 });

        const persistence = await openStoryPersistence(bridge);

        expect(persistence.port.get("stockings")).toBe(1);
    });

    it("leaves both readers on their defaults when the store cannot be read", async () => {
        const bridge = new ScopeStoreBridge();
        bridge.setPersistenceAdapter({
            getAll: async () => {
                throw new Error("profile unavailable");
            },
            getValue: async () => undefined,
            setValue: async () => undefined,
        });

        const persistence = await openStoryPersistence(bridge);

        expect(persistence.readPersistent("stockings")).toBeUndefined();
        expect(persistence.port.get("stockings")).toBeUndefined();
    });

    it("keeps both readers on the one cache a write lands in", async () => {
        const bridge = bridgeAnsweringLate({ stockings: 0 });

        const persistence = await openStoryPersistence(bridge);
        expect(persistence.readPersistent("stockings")).toBe(0);

        // A Scene Snapshot override is written after this is opened and has to be visible through
        // both, which is only true while there is one value rather than a copy of one.
        persistence.port.set("stockings", 2);
        expect(persistence.readPersistent("stockings")).toBe(2);
        expect(persistence.port.get("stockings")).toBe(2);
    });
});

describe("the boot path", () => {
    it("waits for the store before it compiles, and reads nothing past what it waited for", async () => {
        const source = await fs.readFile(path.join(path.resolve(__dirname), "GameApp.tsx"), "utf-8");
        const start = source.indexOf("const compileStoryRequest = useCallback(");
        expect(start, "GameApp no longer has a compileStoryRequest").toBeGreaterThan(-1);
        const body = source.slice(start, source.indexOf("\n    }, [bundle,", start));
        expect(body.length, "compileStoryRequest body not found").toBeGreaterThan(0);

        const primed = body.indexOf("await openStoryPersistence(");
        expect(primed, "the boot must read the persistent store before it compiles").toBeGreaterThan(-1);

        // Ahead of the cache lookup too: a reused story is handed the same port a fresh compile is.
        const cacheHit = body.indexOf("reuseCompiledStory(");
        expect(cacheHit).toBeGreaterThan(-1);
        expect(primed, "the store read must come before the compiled-story cache is consulted")
            .toBeLessThan(cacheHit);

        // And nothing in the boot may go round it: an unprimed read is exactly the defect.
        expect(
            body.includes("scopeBridge.persistenceGet("),
            "the boot must read persistent values through the primed reader, not the bridge",
        ).toBe(false);
        expect(
            body.includes("scopeBridge.persistenceSet("),
            "the boot must write persistent values through the primed port, not the bridge",
        ).toBe(false);
    });
});
