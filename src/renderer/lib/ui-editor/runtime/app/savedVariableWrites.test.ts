/**
 * The engine's saved-variable changes, announced under the key `Get Saved Var` records its reads by.
 *
 * Driven by the engine's own store rather than a stand-in, because what is pinned is exactly the
 * agreement between the two: the engine reports a storage key, the reader records an id, and the
 * compile's table is what joins them.
 */

import { afterEach, describe, expect, it } from "vitest";
import { Namespace, Storable } from "narraleaf-react";
import {
    EVERY_SAVED_STATE_KEY,
    savedVariableStateKey,
    subscribeBlueprintStateWrites,
} from "@/lib/ui-editor/blueprint-runtime/blueprintStateWrites";
import { announceSavedVariableWrites } from "./savedVariableWrites";

const NAMESPACE = "saved-ns";

let dispose: Array<() => void> = [];
afterEach(() => {
    dispose.forEach(stop => stop());
    dispose = [];
});

function watchedStore() {
    const storable = new Storable();
    storable.addNamespace(new Namespace(NAMESPACE, { "affection-key": 1, "route-key": "none" }));
    const watch = announceSavedVariableWrites(storable, {
        savedNamespaceName: NAMESPACE,
        savedVariables: {
            affection: { id: "affection", storageKey: "affection-key" },
            route: { id: "route", storageKey: "route-key" },
        },
    });
    const heard: string[] = [];
    const unsubscribe = subscribeBlueprintStateWrites(key => heard.push(key));
    dispose.push(() => watch.cancel(), unsubscribe);
    return { storable, watch, heard };
}

describe("saved-variable writes", () => {
    it("are announced by the id the variable is read by", () => {
        const { storable, heard } = watchedStore();

        storable.getNamespace(NAMESPACE).set("affection-key", 2);

        expect(heard).toEqual([savedVariableStateKey("affection")]);
    });

    it("say nothing for a write that changes nothing", () => {
        const { storable, heard } = watchedStore();

        storable.getNamespace(NAMESPACE).set("route-key", "none");

        expect(heard).toEqual([]);
    });

    it("stop being announced once cancelled", () => {
        const { storable, watch, heard } = watchedStore();

        watch.cancel();
        storable.getNamespace(NAMESPACE).set("affection-key", 5);

        expect(heard).toEqual([]);
    });

    it("announce every saved variable when a key the compile does not name moves", () => {
        const { storable, heard } = watchedStore();

        storable.getNamespace(NAMESPACE).set("legacy-key" as never, 1 as never);

        expect(heard).toEqual([EVERY_SAVED_STATE_KEY]);
    });
});
