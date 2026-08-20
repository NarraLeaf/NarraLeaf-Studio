/**
 * `Get Save Metadata` reading a declared string field that holds a scene reference.
 *
 * This is where a scene name reaches a player: a save slot's "place" line. The pin is asserted
 * through a downstream Set Var for the reason the localization node tests are - a latent node
 * publishes through `outputValues`, and reading the execute() return would not exercise the path
 * that actually feeds a widget.
 *
 * Comments in English per project convention.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_METADATA,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
} from "@shared/types/blueprint/graph";
import type { UIGraph } from "@shared/types/ui-editor/graph";
import type { SaveSchemaRuntimeTable } from "@shared/types/saveSchema";
import { setActiveSaveSchemaFields } from "@shared/saves/saveSchemaRegistry";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import type { GameLocalizationConfigSnapshot } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { executeGraph } from "../../behavior-graph/GraphExecutor";
import { saveSchemaPinId } from "../effectivePins";

const PLACE_FIELD_ID = "field-place";
const SCENE_ID = "s-corridor";

const FIELDS: SaveSchemaRuntimeTable = [
    { id: PLACE_FIELD_ID, name: "Place", valueType: "string", storageKey: "place", order: 0, defaultValue: "" },
];

const LOCALIZATION: GameLocalizationConfigSnapshot = {
    sourceLocale: "en",
    locales: [
        { code: "en", displayName: "English" },
        { code: "zh-CN", displayName: "简体中文" },
    ],
    tables: { "zh-CN": { [`scene:${SCENE_ID}`]: "走廊" } },
    scenes: { [SCENE_ID]: "The corridor" },
};

function createHostAdapter(input: {
    metadata: unknown;
    locale: string;
    localization?: GameLocalizationConfigSnapshot | null;
}): UIHostAdapter {
    return {
        host: "player",
        blueprintRuntime: {
            surfaceId: "surface",
            setSurfaceState: () => undefined,
            getSurfaceState: () => undefined,
            emitDebug: () => undefined,
            dispatchElementBlueprintEvent: async () => undefined,
            hostApi: {
                game: {
                    getSaveMetadata: async () => input.metadata,
                },
                localization: {
                    getConfig: () => (input.localization === undefined ? LOCALIZATION : input.localization),
                    getLocale: async () => input.locale,
                    setLocale: async () => undefined,
                },
            },
        },
    } as unknown as UIHostAdapter;
}

/** Get Save Metadata → the Place pin → Set Var `out`, which is how a save slot reads it. */
const GRAPH: UIGraph = {
    id: "readPlace",
    entries: { main: { start: { nodeId: "get", port: "in" } } },
    nodes: {
        get: {
            id: "get",
            type: BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_METADATA,
            params: { id: "slot-1" },
        },
        store: { id: "store", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "out" } },
    },
    edges: [
        { from: { nodeId: "get", port: "next" }, to: { nodeId: "store", port: "in" } },
        { from: { nodeId: "get", port: saveSchemaPinId(PLACE_FIELD_ID) }, to: { nodeId: "store", port: "value" } },
    ],
} as UIGraph;

async function readPlace(input: Parameters<typeof createHostAdapter>[0]): Promise<unknown> {
    const locals: Record<string, unknown> = {};
    await executeGraph({
        graph: GRAPH,
        entry: GRAPH.entries.main,
        hostAdapter: createHostAdapter(input),
        blueprintLocals: locals,
    });
    return locals.out;
}

afterEach(() => {
    setActiveSaveSchemaFields([]);
});

describe("Get Save Metadata with a scene reference", () => {
    it("renders the scene's name in the player's language", async () => {
        setActiveSaveSchemaFields(FIELDS);
        expect(await readPlace({ metadata: { place: `scene:${SCENE_ID}` }, locale: "zh-CN" })).toBe("走廊");
    });

    it("renders the scene's own name in the source language", async () => {
        setActiveSaveSchemaFields(FIELDS);
        expect(await readPlace({ metadata: { place: `scene:${SCENE_ID}` }, locale: "en" })).toBe("The corridor");
    });

    /**
     * The old-save guarantee. Slots written before scene references existed hold the place as a
     * literal string; a player's save file is not something a Studio release gets to invalidate, so
     * the value comes back exactly as it went in - not blank, not the unit id, not an error.
     */
    it("returns a literal written by an older build untouched", async () => {
        setActiveSaveSchemaFields(FIELDS);
        expect(await readPlace({ metadata: { place: "The corridor" }, locale: "zh-CN" })).toBe("The corridor");
    });

    it("still answers with the field's default when the slot never carried it", async () => {
        setActiveSaveSchemaFields(FIELDS);
        expect(await readPlace({ metadata: {}, locale: "zh-CN" })).toBe("");
    });

    it("reads a reference to a scene this build dropped as the stored string", async () => {
        setActiveSaveSchemaFields(FIELDS);
        expect(await readPlace({ metadata: { place: "scene:s-gone" }, locale: "zh-CN" })).toBe("scene:s-gone");
    });

    it("leaves the value alone in a project that has no languages at all", async () => {
        setActiveSaveSchemaFields(FIELDS);
        expect(
            await readPlace({ metadata: { place: `scene:${SCENE_ID}` }, locale: "", localization: null }),
        ).toBe(`scene:${SCENE_ID}`);
    });
});
