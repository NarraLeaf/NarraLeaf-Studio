import { describe, expect, it, vi } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
    BLUEPRINT_NODE_TYPE_SOUND_IS_PLAYING,
    BLUEPRINT_NODE_TYPE_SOUND_PAUSE,
    BLUEPRINT_NODE_TYPE_SOUND_PLAY,
    BLUEPRINT_NODE_TYPE_SOUND_RESUME,
    BLUEPRINT_NODE_TYPE_SOUND_SEEK,
    BLUEPRINT_NODE_TYPE_SOUND_SET_VOLUME,
    BLUEPRINT_NODE_TYPE_SOUND_STOP,
} from "@shared/types/blueprint/graph";
import type { UIGraph } from "@shared/types/ui-editor/graph";
import type { UIHostAdapter } from "../../runtime/types";
import { executeGraph } from "../../behavior-graph/GraphExecutor";

function soundHost() {
    const sound = {
        play: vi.fn(async () => null),
        stop: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        seek: vi.fn(),
        setVolume: vi.fn(),
        isPlaying: vi.fn(() => true),
    };
    return { sound, hostAdapter: { host: "player", blueprintRuntime: { hostApi: { sound } } } as unknown as UIHostAdapter };
}

function graphFor(type: string, wired: boolean): UIGraph {
    return {
        id: "sound-missing-handle",
        entries: { main: { start: { nodeId: wired ? "play" : "action", port: "in" } } },
        nodes: {
            play: { id: "play", type: BLUEPRINT_NODE_TYPE_SOUND_PLAY, params: { soundAssetId: "clip" } },
            action: { id: "action", type, params: { time: 3 } },
            store: { id: "store", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "continued", value: true } },
        },
        edges: [
            ...(wired ? [
                { from: { nodeId: "play", port: "next" }, to: { nodeId: "action", port: "in" } },
                { from: { nodeId: "play", port: "handle" }, to: { nodeId: "action", port: "handle" } },
            ] : []),
            { from: { nodeId: "action", port: "next" }, to: { nodeId: "store", port: "in" } },
            ...(type === BLUEPRINT_NODE_TYPE_SOUND_IS_PLAYING
                ? [{ from: { nodeId: "action", port: "isPlaying" }, to: { nodeId: "store", port: "value" } }]
                : []),
        ],
    };
}

describe("sound transport without a playing clip", () => {
    it.each([
        BLUEPRINT_NODE_TYPE_SOUND_STOP,
        BLUEPRINT_NODE_TYPE_SOUND_PAUSE,
        BLUEPRINT_NODE_TYPE_SOUND_RESUME,
        BLUEPRINT_NODE_TYPE_SOUND_SET_VOLUME,
        BLUEPRINT_NODE_TYPE_SOUND_SEEK,
        BLUEPRINT_NODE_TYPE_SOUND_IS_PLAYING,
    ])("continues %s when Play Sound returns no handle", async type => {
        const { sound, hostAdapter } = soundHost();
        const graph = graphFor(type, true);
        const locals: Record<string, unknown> = {};
        await executeGraph({ graph, entry: graph.entries.main, hostAdapter, blueprintLocals: locals });

        expect(locals.continued).toBe(type === BLUEPRINT_NODE_TYPE_SOUND_IS_PLAYING ? false : true);
        for (const operation of [sound.stop, sound.pause, sound.resume, sound.setVolume, sound.seek, sound.isPlaying]) {
            expect(operation).not.toHaveBeenCalled();
        }
    });

    it("still stops all clips when Stop Sound has no handle wire", async () => {
        const { sound, hostAdapter } = soundHost();
        const graph = graphFor(BLUEPRINT_NODE_TYPE_SOUND_STOP, false);
        await executeGraph({ graph, entry: graph.entries.main, hostAdapter });
        expect(sound.stop).toHaveBeenCalledWith(null, 0);
    });

    it("still rejects a missing required handle", async () => {
        const { hostAdapter } = soundHost();
        const graph = graphFor(BLUEPRINT_NODE_TYPE_SOUND_PAUSE, false);
        await expect(executeGraph({ graph, entry: graph.entries.main, hostAdapter })).rejects.toThrow();
    });
});
