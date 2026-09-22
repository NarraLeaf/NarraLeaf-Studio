// @vitest-environment jsdom
/**
 * A persistent variable nothing has written reads as the default its author gave it - for every
 * reader, in the scope a game actually builds.
 *
 * It did not. On a fresh profile a title screen showing a persistent variable through `Get
 * Persistent`, through a value binding and through a script all showed it empty, while the story,
 * started from the same screen, went on to test it against its default. The graph node did carry a
 * fallback to the default, but it tested for `undefined`, and the host API it reads through hands a
 * graph `null` for "nothing stored" - so the fallback never ran. Its own test ran it against a mock
 * host that answered `undefined`, which is why nothing caught it. Nothing pre-wrote the defaults at
 * boot to hide it, and nothing should: a default written into the player's store outlives the author
 * changing it, and "reset player data" would restore the stored copy rather than the default.
 *
 * The rule now lives in one place, the persistence scope (`ScopeStoreBridge.persistenceGet`), and
 * these run each reader through the real one: the scope `useBlueprintRuntimeCore` builds from a
 * bundle, the real host API over it, and the story's real port.
 *
 * Comments in English per project convention.
 */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Blueprint, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
    BLUEPRINT_NODE_TYPE_PERSISTENT_GET,
} from "@shared/types/blueprint/graph";
import type { DevModeBundle } from "@shared/types/devMode";
import type { StoryDeclarationBlock, StoryDocument } from "@shared/types/story";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import type { PersistentVariableRuntimeTable } from "@shared/types/variables/registry";
import { executeGraph } from "@/lib/ui-editor/behavior-graph/GraphExecutor";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { createDevModeBlueprintHostApi } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import type { BlueprintPersistentStoreAdapter, ScopeStoreBridge } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import {
    acquireBlueprintExecutionLocals,
    releaseBlueprintWidgetLocals,
} from "@/lib/ui-editor/blueprint-runtime/blueprintWidgetLocals";
import {
    persistentStateKey,
    subscribeBlueprintStateWrites,
} from "@/lib/ui-editor/blueprint-runtime/blueprintStateWrites";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import { openStoryPersistence } from "@/lib/ui-editor/runtime/app/storyPersistence";
import { blueprintDocumentOf } from "@/lib/ui-editor/runtime/testing/rowRuntimeTestKit";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { createExplicitBlueprintVariableRef } from "@/lib/workspace/services/ui-editor/blueprint/blueprintVariableRefs";
import { buildStoryActionHostApi, type CompileStoryActionScriptInput } from "./storyActionBlueprint";
import { useBlueprintRuntimeCore, type BlueprintRuntimeCore } from "./useBlueprintRuntimeCore";

const COINS = "coins";
const COINS_KEY = "coins-key";
const INVENTORY = "inventory";
const INVENTORY_KEY = "inventory-key";
const NO_DEFAULT = "no-default";
/** Declared only by a story's legacy `/persis` row, as a project the migration could not write keeps it. */
const LEGACY_KEY = "legacy-key";

const persistentVariables: PersistentVariableRuntimeTable = {
    [COINS]: { id: COINS, name: "Coins", scope: "persistent", valueType: "number", defaultValue: 7, storageKey: COINS_KEY },
    [INVENTORY]: {
        id: INVENTORY,
        name: "Inventory",
        scope: "persistent",
        valueType: "json",
        defaultValue: ["map"],
        storageKey: INVENTORY_KEY,
    },
    [NO_DEFAULT]: { id: NO_DEFAULT, name: "Unset", scope: "persistent", valueType: "string", storageKey: NO_DEFAULT },
};

const legacyRow: StoryDeclarationBlock = {
    id: LEGACY_KEY,
    kind: "declaration",
    parentId: null,
    childrenIds: [],
    payload: { scope: "persistent", name: "Legacy", valueType: "string", defaultValue: "from a row", storageKey: LEGACY_KEY },
};

const storyDocument = {
    scenes: {
        "scene-1": {
            id: "scene-1",
            name: "Scene 1",
            runtimeName: "scene-1",
            rootBlockIds: [LEGACY_KEY],
            blocks: { [LEGACY_KEY]: legacyRow },
        },
    },
} as unknown as StoryDocument;

const uidoc = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    name: "Doc",
    surfaces: [],
    elements: {},
} as unknown as UIDocument;

function bundleWith(revision = 1): DevModeBundle {
    return {
        bundleId: "bundle",
        revision,
        timestamp: "2026-09-21T00:00:00.000Z",
        ui: {
            uidoc,
            uigraphs: { blueprintDocument: blueprintDocumentOf([]) },
            localBlueprints: blueprintDocumentOf([]),
            persistentVariables,
            savedVariables: {},
            saveSchema: [],
        },
        storyLibrary: { index: {}, documents: { story: storyDocument }, characters: [], animations: {}, assetNames: {} },
    } as unknown as DevModeBundle;
}

/** A player's store, answering the way the Dev Mode and shipped stores do: `undefined` for a key never written. */
function playerStore(initial: Record<string, unknown> = {}) {
    const values: Record<string, unknown> = { ...initial };
    const writes: Array<[string, unknown]> = [];
    const adapter: BlueprintPersistentStoreAdapter = {
        getAll: async () => ({ ...values }),
        getValue: async key => values[key],
        setValue: async (key, value) => {
            writes.push([key, value]);
            values[key] = value;
        },
        removeValue: async key => {
            delete values[key];
        },
    };
    return { adapter, values, writes };
}

/** The scope a game builds for `bundle` over `adapter`, once its session is published. */
async function gameScope(adapter: BlueprintPersistentStoreAdapter, bundle = bundleWith()): Promise<ScopeStoreBridge> {
    const view = renderHook(() => useBlueprintRuntimeCore(bundle, { persistenceAdapter: adapter }));
    let core: BlueprintRuntimeCore | null = null;
    await waitFor(() => {
        core = view.result.current;
        expect(core).not.toBeNull();
    });
    const scope = (core as unknown as BlueprintRuntimeCore).scopeBridge;
    // The adapter's first snapshot read, which the scope starts on its own when it is installed.
    await act(async () => {
        await scope.reloadPersistenceSnapshot();
    });
    return scope;
}

function hostApiOver(scope: ScopeStoreBridge) {
    return createDevModeBlueprintHostApi({
        document: uidoc,
        scope,
        activeSurfaceId: "title",
        emit: () => undefined,
        onOpenSurface: () => undefined,
        onPageBack: () => undefined,
        onWidgetPatch: () => undefined,
        widgetRuntimeStore: new WidgetRuntimeStateStore(),
    } as unknown as Parameters<typeof createDevModeBlueprintHostApi>[0]);
}

/** `Get Persistent <variable> -> Set Var captured`, run on a page's host, and what it captured. */
async function getPersistentOnPage(scope: ScopeStoreBridge, variableId: string): Promise<unknown> {
    const hostAdapter = {
        host: "player",
        blueprintRuntime: {
            surfaceId: "title",
            setSurfaceState: () => undefined,
            getSurfaceState: () => undefined,
            emitDebug: () => undefined,
            dispatchElementBlueprintEvent: async () => undefined,
            hostApi: hostApiOver(scope),
        },
    } as unknown as UIHostAdapter;
    const locals: Record<string, unknown> = {};
    await executeGraph({
        graph: {
            id: "title-init",
            entries: { main: { start: { nodeId: "get", port: "in" } } },
            nodes: {
                get: { id: "get", type: BLUEPRINT_NODE_TYPE_PERSISTENT_GET, params: { persistentVariableId: variableId } },
                capture: { id: "capture", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "captured" } },
            },
            edges: [
                { from: { nodeId: "get", port: "next" }, to: { nodeId: "capture", port: "in" } },
                { from: { nodeId: "get", port: "value" }, to: { nodeId: "capture", port: "value" } },
            ],
        },
        entry: { start: { nodeId: "get", port: "in" } },
        hostAdapter,
        blueprintLocals: locals,
        persistentVariables,
    });
    return locals.captured;
}

beforeAll(() => {
    registerCoreBlueprintNodes();
});

afterEach(() => {
    cleanup();
});

describe("a persistent variable nothing has written", () => {
    it("reads as its default in the scope a game builds from its bundle", async () => {
        const scope = await gameScope(playerStore().adapter);

        expect(scope.persistenceGet(COINS_KEY)).toBe(7);
        expect(await scope.persistenceGetAsync(COINS_KEY)).toBe(7);
        // A variable a story's own `/persis` row declares, as well as the registry's.
        expect(scope.persistenceGet(LEGACY_KEY)).toBe("from a row");
        // Declared with no default, and undeclared: nothing to read.
        expect(scope.persistenceGet(NO_DEFAULT)).toBeUndefined();
        expect(scope.persistenceGet("nobody-declared-this")).toBeUndefined();
    });

    it("reads as its default through Get Persistent on a page", async () => {
        const scope = await gameScope(playerStore().adapter);

        expect(await getPersistentOnPage(scope, COINS)).toBe(7);
    });

    it("reads as its default through the host API a script and a value binding's Fn are handed", async () => {
        const hostApi = hostApiOver(await gameScope(playerStore().adapter));

        expect(await hostApi.persistence.get(COINS_KEY)).toBe(7);
        expect(hostApi.state.get("persistence", COINS_KEY)).toBe(7);
        // A declared variable with no default still reads as the host's "nothing" for a graph.
        expect(await hostApi.persistence.get(NO_DEFAULT)).toBeNull();
    });

    it("reads as its default through the story's port, a story row's host and a story script's ctx", async () => {
        const persistence = await openStoryPersistence(await gameScope(playerStore().adapter));

        expect(persistence.port.get(COINS_KEY)).toBe(7);
        expect(persistence.readPersistent(COINS_KEY)).toBe(7);
        // `buildStoryActionHostApi` is what both a row's `Get Persistent` and its script's
        // `ctx.persistent` read through.
        const rowHost = buildStoryActionHostApi({ persistence: persistence.port } as unknown as CompileStoryActionScriptInput);
        expect(await rowHost.persistence!.get(COINS_KEY)).toBe(7);
    });

    it("gives way to what is written, and comes back when that is removed - without the store ever holding it", async () => {
        const store = playerStore();
        const scope = await gameScope(store.adapter);
        // What exported progress reads: what the player's game wrote, and a default is not that.
        expect(await scope.persistenceStoredAsync(COINS_KEY)).toBeUndefined();

        await scope.persistenceSet(COINS_KEY, 42);
        expect(await getPersistentOnPage(scope, COINS)).toBe(42);

        await scope.persistenceSet(COINS_KEY, undefined);
        expect(await getPersistentOnPage(scope, COINS)).toBe(7);

        expect(store.writes).toEqual([[COINS_KEY, 42]]);
        expect(store.values).toEqual({});
        expect(scope.getPersistenceSnapshot().size).toBe(0);
        expect(scope.persistenceIsStored(COINS_KEY)).toBe(false);
    });

    it("reads as its default again after the player's data is reset", async () => {
        // Dev Mode's reset empties the store through the main process; the next session reads it.
        const store = playerStore({ [COINS_KEY]: 42 });
        const before = await gameScope(store.adapter);
        expect(before.persistenceGet(COINS_KEY)).toBe(42);
        cleanup();

        delete store.values[COINS_KEY];
        const after = await gameScope(store.adapter, bundleWith(2));
        expect(after.persistenceGet(COINS_KEY)).toBe(7);

        // And a scope cleared in place - a Dev Mode bundle reload - reads it too.
        await after.persistenceSet(COINS_KEY, 5);
        after.clearAll();
        expect(after.persistenceGet(COINS_KEY)).toBe(7);
    });

    it("hands every reader one copy of an object default, which cannot change the declared one", async () => {
        const scope = await gameScope(playerStore().adapter);

        const first = scope.persistenceGet(INVENTORY_KEY) as string[];
        expect(first).toEqual(["map"]);
        // The same object until written, as a stored value would be: a reader comparing snapshots by
        // identity sees nothing change that did not.
        expect(scope.persistenceGet(INVENTORY_KEY)).toBe(first);

        // Get, change in place, write back - the way a script adds to a list.
        first.push("key");
        await scope.persistenceSet(INVENTORY_KEY, first);
        expect(scope.persistenceGet(INVENTORY_KEY)).toEqual(["map", "key"]);

        await scope.persistenceSet(INVENTORY_KEY, undefined);
        expect(scope.persistenceGet(INVENTORY_KEY)).toEqual(["map"]);
    });

    it("tells a value binding it changed only when what a reader sees moves", async () => {
        const scope = await gameScope(playerStore().adapter);
        const heard: string[] = [];
        const stop = subscribeBlueprintStateWrites(key => {
            heard.push(key);
        });
        try {
            // Its own default written over nothing: every reader already saw 7.
            await scope.persistenceSet(COINS_KEY, 7);
            expect(heard).toEqual([]);

            await scope.persistenceSet(COINS_KEY, 42);
            // Removed: readers go back to the default, which is a change.
            await scope.persistenceSet(COINS_KEY, undefined);
            expect(heard).toEqual([persistentStateKey(COINS_KEY), persistentStateKey(COINS_KEY)]);
        } finally {
            stop();
        }
    });
});

/**
 * The other variables an author gives defaults to were checked for the same fault and do not have
 * it: a blueprint's variable record is created holding its defaults (`acquireVariableStore`), so
 * the first read of a global, page or element variable is the default. Pinned here beside the
 * persistent case so the two answers cannot drift apart unnoticed.
 */
describe("the blueprint variables an author gives defaults to", () => {
    function withVariable(id: string, owner: BlueprintOwnerRef, variableId: string, defaultValue: number): Blueprint {
        return {
            id,
            name: id,
            owner,
            members: {
                variables: { [variableId]: { id: variableId, name: variableId, valueType: "float", defaultValue } },
                fields: {},
                functions: {},
            },
            bindings: {},
            graphs: { events: {}, functions: {} },
        } as unknown as Blueprint;
    }

    it("read as their defaults the first time a graph on the page reads them", () => {
        const blueprintDocument = blueprintDocumentOf([
            withVariable("bp-global", { kind: "globalMain" }, "gvar", 11),
            withVariable("bp-page", { kind: "surfaceMain", surfaceId: "title" }, "pvar", 22),
            withVariable("bp-element", { kind: "widgetMain", surfaceId: "title", elementId: "label" }, "evar", 33),
        ]);
        const runtimeScopeId = "title#first-read";
        try {
            const elementLocals = acquireBlueprintExecutionLocals({
                blueprintDocument,
                currentBlueprintId: "bp-element",
                surfaceId: "title",
                runtimeScopeId,
                elementId: "label",
            });
            expect(elementLocals.evar).toBe(33);
            expect(elementLocals[createExplicitBlueprintVariableRef("bp-global", "gvar")]).toBe(11);
            expect(elementLocals[createExplicitBlueprintVariableRef("bp-page", "pvar")]).toBe(22);
        } finally {
            releaseBlueprintWidgetLocals("title", "label", "bp-element", runtimeScopeId);
        }
    });
});
