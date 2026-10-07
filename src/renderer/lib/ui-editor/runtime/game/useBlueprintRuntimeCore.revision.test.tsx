// @vitest-environment jsdom
/**
 * A runtime core says which bundle it was built for, and a host can tell the previous revision's.
 *
 * Every new revision gets a new core, published only once the bundle's scripts have mounted, while
 * the previous core is torn down in the commit the revision arrives in. In between, the core a host
 * holds is the old one with its persistent store detached: every read answers a declared default.
 * Dev Mode used to restart a story in exactly that moment - a row's play control pressed with the
 * window open, a hot reload of a running game - and the restarted story read the player's dub
 * language, preferences and persistent values from it: all defaults. `runtimeCoreIsFor` is what the
 * game app now waits on before such a start.
 */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DevModeBundle } from "@shared/types/devMode";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import type { BlueprintPersistentStoreAdapter } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import { blueprintDocumentOf } from "@/lib/ui-editor/runtime/testing/rowRuntimeTestKit";
import { runtimeCoreIsFor, useBlueprintRuntimeCore } from "./useBlueprintRuntimeCore";

const VOICE_LOCALE_KEY = "nls.voiceLocale";

const uidoc = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    name: "Doc",
    surfaces: [],
    elements: {},
} as unknown as UIDocument;

function bundleAt(revision: number): DevModeBundle {
    return {
        bundleId: "bundle",
        revision,
        timestamp: "2026-10-06T00:00:00.000Z",
        ui: {
            uidoc,
            uigraphs: { blueprintDocument: blueprintDocumentOf([]) },
            localBlueprints: blueprintDocumentOf([]),
            persistentVariables: {},
            savedVariables: {},
            saveSchema: [],
        },
    } as unknown as DevModeBundle;
}

/** A player's store holding a dub language they picked. */
function playerStore(): BlueprintPersistentStoreAdapter {
    const values: Record<string, unknown> = { [VOICE_LOCALE_KEY]: "ja" };
    return {
        getAll: async () => ({ ...values }),
        getValue: async key => values[key],
        setValue: async (key, value) => {
            values[key] = value;
        },
    };
}

afterEach(() => {
    cleanup();
});

describe("a runtime core and the bundle it was built for", () => {
    it("names its bundle, and the previous revision's core is told apart while the next one mounts", async () => {
        const adapter = playerStore();
        const first = bundleAt(1);
        const view = renderHook(({ bundle }) => useBlueprintRuntimeCore(bundle, { persistenceAdapter: adapter }), {
            initialProps: { bundle: first },
        });
        await waitFor(() => expect(runtimeCoreIsFor(view.result.current, first)).toBe(true));
        const firstCore = view.result.current!;
        await act(async () => {
            await firstCore.scopeBridge.reloadPersistenceSnapshot();
        });
        expect(firstCore.scopeBridge.persistenceGet(VOICE_LOCALE_KEY)).toBe("ja");

        const second = bundleAt(2);
        view.rerender({ bundle: second });
        // The moment a start must not use: the core in hand is the torn-down first one.
        expect(view.result.current).toBe(firstCore);
        expect(runtimeCoreIsFor(view.result.current, second)).toBe(false);
        expect(firstCore.scopeBridge.persistenceGet(VOICE_LOCALE_KEY)).toBeUndefined();

        await waitFor(() => expect(runtimeCoreIsFor(view.result.current, second)).toBe(true));
        const secondCore = view.result.current!;
        expect(secondCore.bundleRevision).toBe(2);
        await act(async () => {
            await secondCore.scopeBridge.reloadPersistenceSnapshot();
        });
        expect(secondCore.scopeBridge.persistenceGet(VOICE_LOCALE_KEY)).toBe("ja");
    });

    it("answers no for no core at all", () => {
        expect(runtimeCoreIsFor(null, bundleAt(1))).toBe(false);
    });
});
