/**
 * Sound transport for authored UI, grouped under the "Sound" category.
 *
 * These are for what a *screen* plays — a music-appreciation page, a voice EXTRA
 * list, a button click — not for story audio, which stays a story action
 * (`/bgm`, `/sound`). Before this family existed an authored title screen could
 * not make a sound at all.
 *
 * Playback goes through the engine (`LiveGame.playSound`), never a host-side
 * audio element. That is what makes the player's mixer settings apply: a clip on
 * the `bgm` channel follows their BGM volume, the master volume and mute for
 * free, because the engine routes by `SoundType`. A host that owned its own
 * audio graph would produce sound the player's settings could not touch.
 *
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_TYPE_SOUND_IS_PLAYING,
    BLUEPRINT_NODE_TYPE_SOUND_PAUSE,
    BLUEPRINT_NODE_TYPE_SOUND_PLAY,
    BLUEPRINT_NODE_TYPE_SOUND_RESUME,
    BLUEPRINT_NODE_TYPE_SOUND_SEEK,
    BLUEPRINT_NODE_TYPE_SOUND_SET_VOLUME,
    BLUEPRINT_NODE_TYPE_SOUND_STOP,
} from "@shared/types/blueprint/graph";
import {
    BLUEPRINT_VALUE_TYPE_SOUND_HANDLE,
    normalizeBlueprintSoundHandle,
} from "@shared/types/blueprint/valueTypes";
import {
    normalizeBlueprintSoundChannel,
    type BlueprintSoundChannel,
} from "../../blueprint-runtime/BlueprintHostApiBridge";
import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BlueprintNodeDef, BlueprintNodePinDef } from "../types";
import { resolveDataPinValue } from "./graphParamResolvers";
import { requireHostApi } from "./hostApi";

const execIn: BlueprintNodePinDef = { id: "in", kind: "input", semantic: "exec", label: "In" };
const execNext: BlueprintNodePinDef = { id: "next", kind: "output", semantic: "exec", label: "Next" };

/** Sound needs a running game to route through, i.e. event / macro graphs. */
const SOUND_GRAPH_KINDS = ["event", "macro"] as const;

export const BLUEPRINT_SOUND_PARAM_ASSET = "soundAssetId";
export const BLUEPRINT_SOUND_PARAM_CHANNEL = "soundChannel";

const handleIn: BlueprintNodePinDef = {
    id: "handle",
    kind: "input",
    semantic: "data",
    valueType: BLUEPRINT_VALUE_TYPE_SOUND_HANDLE,
    label: "Handle",
};

const handleOut: BlueprintNodePinDef = {
    id: "handle",
    kind: "output",
    semantic: "data",
    valueType: BLUEPRINT_VALUE_TYPE_SOUND_HANDLE,
    label: "Handle",
};

/**
 * The clip, as a bare asset id string.
 *
 * Wired is the primary path: a music page reads `audioAssetId` off a gallery row
 * and feeds it here, which is the whole point of the array node signature. The
 * inspector's picker below covers the fixed-clip case (a button click), and the
 * wired pin wins when both are present.
 */
const assetIdIn: BlueprintNodePinDef = {
    id: "assetId",
    kind: "input",
    semantic: "data",
    valueType: "string",
    label: "Asset Id",
    optional: true,
};

const loopIn: BlueprintNodePinDef = {
    id: "loop",
    kind: "input",
    semantic: "data",
    valueType: "boolean",
    label: "Loop",
    optional: true,
    allowInlineLiteral: true,
};

const volumeIn: BlueprintNodePinDef = {
    id: "volume",
    kind: "input",
    semantic: "data",
    valueType: "float",
    label: "Volume",
    optional: true,
    allowInlineLiteral: true,
};

/**
 * Seconds, like every other time an author types into a blueprint (`Delay`'s `Duration (s)`, the
 * animation nodes) and like every time on a story line. Milliseconds are an internal unit: the host
 * capability speaks them, and the conversion happens at this boundary and nowhere else.
 */
const fadeIn: BlueprintNodePinDef = {
    id: "fade",
    kind: "input",
    semantic: "data",
    valueType: "float",
    label: "Fade (s)",
    optional: true,
    allowInlineLiteral: true,
};

/** Where to move the play head, measured from the start of the file rather than from the in point. */
const timeIn: BlueprintNodePinDef = {
    id: "time",
    kind: "input",
    semantic: "data",
    valueType: "float",
    label: "Time (s)",
    allowInlineLiteral: true,
};

const isPlayingOut: BlueprintNodePinDef = {
    id: "isPlaying",
    kind: "output",
    semantic: "data",
    valueType: "boolean",
    label: "Is Playing",
};

type SoundExecuteCtx = Parameters<NonNullable<BlueprintNodeDef["execute"]>>[0];

function readPin(ctx: SoundExecuteCtx, pinId: string): unknown {
    return resolveDataPinValue(ctx.graph, ctx.node.id, pinId, ctx.params, ctx.blueprintLocals, 0, {
        hostAdapter: ctx.hostAdapter,
        eventPayload: ctx.eventPayload,
        listItemScope: ctx.listItemScope,
        instanceKey: ctx.instanceKey,
        executionOwner: ctx.executionOwner,
    });
}

/** A seconds pin as the milliseconds the host capability takes. Negative and unset both read as 0. */
function readSecondsAsMs(ctx: SoundExecuteCtx, portId: string): number {
    const seconds = readOptionalNumber(readPin(ctx, portId)) ?? 0;
    return seconds > 0 ? Math.round(seconds * 1000) : 0;
}

function readOptionalNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    const parsed = Number(value);
    return typeof value === "string" && value.trim() && Number.isFinite(parsed) ? parsed : undefined;
}

/** The wired pin wins over the inspector picker; see assetIdIn. */
function resolveAssetId(ctx: SoundExecuteCtx): string {
    const wired = readPin(ctx, "assetId");
    const fromPin = typeof wired === "string" ? wired.trim() : "";
    if (fromPin) {
        return fromPin;
    }
    const param = ctx.params[BLUEPRINT_SOUND_PARAM_ASSET];
    return typeof param === "string" ? param.trim() : "";
}

function resolveChannel(ctx: SoundExecuteCtx): BlueprintSoundChannel {
    return normalizeBlueprintSoundChannel(ctx.params[BLUEPRINT_SOUND_PARAM_CHANNEL]);
}

/**
 * A transport node's target handle. Required: pausing "whatever is playing" is
 * not expressible, because the host may hold several clips at once.
 */
function requireHandle(ctx: SoundExecuteCtx, nodeLabel: string) {
    const handle = normalizeBlueprintSoundHandle(readPin(ctx, "handle"));
    if (!handle) {
        throw new BlueprintGraphExecutionError(`${nodeLabel}: wire a sound Handle`, ctx.node.id);
    }
    return handle;
}

const channelParam = {
    key: BLUEPRINT_SOUND_PARAM_CHANNEL,
    label: "Channel",
    kind: "select" as const,
    options: [
        { value: "sound", label: "Sound (SFX)" },
        { value: "bgm", label: "Music (BGM)" },
        { value: "voice", label: "Voice" },
    ],
};

export const soundBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: BLUEPRINT_NODE_TYPE_SOUND_PLAY,
        displayName: "Play Sound",
        category: "Sound",
        keywords: ["sound", "audio", "play", "music", "bgm", "sfx", "voice", "clip", "track"],
        graphKinds: [...SOUND_GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn, assetIdIn, loopIn, volumeIn, execNext, handleOut],
        inspectorParams: [
            { key: BLUEPRINT_SOUND_PARAM_ASSET, label: "Clip", kind: "audioAsset" },
            channelParam,
        ],
        async execute(ctx) {
            const assetId = resolveAssetId(ctx);
            if (!assetId) {
                throw new BlueprintGraphExecutionError("Play Sound: pick a clip or wire an Asset Id", ctx.node.id);
            }
            const handle = await requireHostApi(ctx).sound.play({
                assetId,
                channel: resolveChannel(ctx),
                loop: readPin(ctx, "loop") === true,
                volume: readOptionalNumber(readPin(ctx, "volume")) ?? 1,
            });
            // A null handle means this environment backs no audio (editor
            // preview). The graph continues; downstream transport is a no-op.
            return { nextPort: "next", outputValues: { handle } };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_SOUND_STOP,
        displayName: "Stop Sound",
        category: "Sound",
        keywords: ["sound", "audio", "stop", "silence", "music", "bgm", "halt"],
        graphKinds: [...SOUND_GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        // Handle is optional here alone: leaving it unwired stops everything this
        // family started, which is what a Page's exit handler wants.
        pins: [execIn, { ...handleIn, optional: true }, fadeIn, execNext],
        async execute(ctx) {
            await requireHostApi(ctx).sound.stop(
                normalizeBlueprintSoundHandle(readPin(ctx, "handle")),
                readSecondsAsMs(ctx, "fade"),
            );
            return { nextPort: "next" };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_SOUND_PAUSE,
        displayName: "Pause Sound",
        category: "Sound",
        keywords: ["sound", "audio", "pause", "music", "bgm", "hold"],
        graphKinds: [...SOUND_GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn, handleIn, execNext],
        async execute(ctx) {
            await requireHostApi(ctx).sound.pause(requireHandle(ctx, "Pause Sound"));
            return { nextPort: "next" };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_SOUND_RESUME,
        displayName: "Resume Sound",
        category: "Sound",
        keywords: ["sound", "audio", "resume", "continue", "music", "bgm", "unpause"],
        graphKinds: [...SOUND_GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn, handleIn, execNext],
        async execute(ctx) {
            await requireHostApi(ctx).sound.resume(requireHandle(ctx, "Resume Sound"));
            return { nextPort: "next" };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_SOUND_SET_VOLUME,
        displayName: "Set Sound Volume",
        category: "Sound",
        keywords: ["sound", "audio", "volume", "fade", "duck", "music", "bgm", "level", "quieter"],
        graphKinds: [...SOUND_GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        // Volume and fade in one node, so this is also the fade: "duck the music over a second" and
        // "set it to 0.3" are the same request with a different duration, and a separate Fade Sound
        // would just be this node with one pin pre-filled.
        pins: [execIn, handleIn, volumeIn, fadeIn, execNext],
        async execute(ctx) {
            await requireHostApi(ctx).sound.setVolume(
                requireHandle(ctx, "Set Sound Volume"),
                readOptionalNumber(readPin(ctx, "volume")) ?? 1,
                readSecondsAsMs(ctx, "fade"),
            );
            return { nextPort: "next" };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_SOUND_SEEK,
        displayName: "Seek Sound",
        category: "Sound",
        keywords: ["sound", "audio", "seek", "position", "jump", "skip", "scrub", "music", "bgm"],
        graphKinds: [...SOUND_GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn, handleIn, timeIn, execNext],
        async execute(ctx) {
            await requireHostApi(ctx).sound.seek(
                requireHandle(ctx, "Seek Sound"),
                readSecondsAsMs(ctx, "time"),
            );
            return { nextPort: "next" };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_SOUND_IS_PLAYING,
        displayName: "Is Sound Playing",
        category: "Sound",
        keywords: ["sound", "audio", "playing", "state", "music", "bgm", "check"],
        graphKinds: [...SOUND_GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn, handleIn, execNext, isPlayingOut],
        execute(ctx) {
            return {
                nextPort: "next",
                outputValues: {
                    isPlaying: requireHostApi(ctx).sound.isPlaying(requireHandle(ctx, "Is Sound Playing")),
                },
            };
        },
    },
];
