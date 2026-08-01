/**
 * `Play Sound`'s `soundChannel` select became an audio track reference.
 *
 * The whole promise of that change is that an existing graph keeps making the same sound: a node
 * that named the `bgm` channel has to end up on the Music track, whose seeded defaults are the
 * behaviour it had. These guard that promise, plus the two ways it could quietly break - a
 * re-migration clobbering a track the author has since chosen, and the shared migration drifting
 * from the param keys the renderer's node definition actually reads.
 */
import { describe, expect, it } from "vitest";
import { migrateBlueprintDocumentToLatest } from "@shared/blueprint/migrateBlueprintDocument";
import {
    BLUEPRINT_SOUND_PARAM_CHANNEL,
    BLUEPRINT_SOUND_PARAM_TRACK,
} from "./soundNodes";
import { BLUEPRINT_NODE_TYPE_SOUND_PLAY } from "@shared/types/blueprint/graph";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import type { BlueprintDocument } from "@shared/types/blueprint/document";

function documentWithPlayParams(
    params: Record<string, unknown>,
    schemaVersion: number = BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
): unknown {
    return {
        schemaVersion,
        ownerRecords: {},
        blueprints: {
            bp: {
                id: "bp",
                name: "Main",
                owner: { kind: "globalMain" },
                frontend: "visual",
                programKind: "graph",
                program: {
                    kind: "graph",
                    graphs: {
                        events: {
                            onClick: {
                                id: "onClick",
                                graph: {
                                    nodes: { play: { id: "play", type: BLUEPRINT_NODE_TYPE_SOUND_PLAY, params } },
                                    edges: [],
                                },
                            },
                        },
                        functions: {},
                    },
                },
            },
        },
    };
}

function playParamsOf(document: BlueprintDocument): Record<string, unknown> {
    const program = document.blueprints.bp?.program;
    const graph = program?.kind === "graph" ? program.graphs.events.onClick?.graph : undefined;
    return graph?.nodes?.play.params ?? {};
}

describe("Play Sound soundChannel -> audioTrackId", () => {
    it.each([
        ["bgm", "music"],
        ["sound", "sfx"],
        ["voice", "voice"],
    ])("maps the %s channel to the %s built-in track", (channel, trackId) => {
        const migrated = migrateBlueprintDocumentToLatest(
            documentWithPlayParams({ soundAssetId: "a1", [BLUEPRINT_SOUND_PARAM_CHANNEL]: channel }),
        );

        const params = playParamsOf(migrated);
        expect(params[BLUEPRINT_SOUND_PARAM_TRACK]).toBe(trackId);
        // Left behind, the old key would keep answering `resolveTrackId`'s legacy arm forever and
        // an author's later track choice could not be told apart from a never-migrated node.
        expect(BLUEPRINT_SOUND_PARAM_CHANNEL in params).toBe(false);
        expect(params.soundAssetId).toBe("a1");
    });

    it("migrates a legacy schema version too, not only the current one", () => {
        const migrated = migrateBlueprintDocumentToLatest(
            documentWithPlayParams({ [BLUEPRINT_SOUND_PARAM_CHANNEL]: "bgm" }, 8),
        );

        expect(migrated.schemaVersion).toBe(BLUEPRINT_DOCUMENT_SCHEMA_VERSION);
        expect(playParamsOf(migrated)[BLUEPRINT_SOUND_PARAM_TRACK]).toBe("music");
    });

    it("keeps a track the author already picked", () => {
        // Both keys present means a node migrated once and then re-pointed. Re-running the
        // migration must not drag it back to the built-in the old channel named.
        const migrated = migrateBlueprintDocumentToLatest(
            documentWithPlayParams({
                [BLUEPRINT_SOUND_PARAM_CHANNEL]: "bgm",
                [BLUEPRINT_SOUND_PARAM_TRACK]: "ambience",
            }),
        );

        expect(playParamsOf(migrated)[BLUEPRINT_SOUND_PARAM_TRACK]).toBe("ambience");
        expect(BLUEPRINT_SOUND_PARAM_CHANNEL in playParamsOf(migrated)).toBe(false);
    });

    it("lands an unreadable channel on SFX rather than dropping the reference", () => {
        const migrated = migrateBlueprintDocumentToLatest(
            documentWithPlayParams({ [BLUEPRINT_SOUND_PARAM_CHANNEL]: "whatever" }),
        );

        expect(playParamsOf(migrated)[BLUEPRINT_SOUND_PARAM_TRACK]).toBe("sfx");
    });

    it("leaves a node that never had a channel alone", () => {
        const migrated = migrateBlueprintDocumentToLatest(documentWithPlayParams({ soundAssetId: "a1" }));

        // No key at all, so the node resolves to the SFX default at play time rather than carrying
        // an id the author never chose - which would show a track in the picker they did not pick.
        expect(BLUEPRINT_SOUND_PARAM_TRACK in playParamsOf(migrated)).toBe(false);
    });

    it("is idempotent", () => {
        const once = migrateBlueprintDocumentToLatest(
            documentWithPlayParams({ [BLUEPRINT_SOUND_PARAM_CHANNEL]: "voice" }),
        );
        const twice = migrateBlueprintDocumentToLatest(JSON.parse(JSON.stringify(once)));

        expect(playParamsOf(twice)).toEqual(playParamsOf(once));
    });
});
