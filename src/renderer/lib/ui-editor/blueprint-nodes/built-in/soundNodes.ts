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
    type BlueprintSoundHandle,
} from "@shared/types/blueprint/valueTypes";
import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BlueprintNodeDef, BlueprintNodePinDef } from "../types";
import type { BlueprintSoundChannel } from "../../blueprint-runtime/BlueprintHostApiBridge";
import { resolveDataPinValue } from "./graphParamResolvers";
import { requireHostApi } from "./hostApi";

/**
 * Sound playback for author-built screens.
 *
 * Until this family existed, a Surface could not make a noise: a title screen had no button click, a
 * music-appreciation page had nothing to play with, and the only audio in a game came from story rows.
 *
 * Every node plays *through the engine*, naming a mix channel rather than a device. That is the whole
 * design: the player's BGM / SFX / voice sliders and mute are applied per channel by the engine, so a
 * clip on the right channel obeys settings the author never reads. (A plugin reaching for
 * `new Audio()` would be louder and unmutable, which is exactly why this is a host capability.)
 *
 * `Play Sound` hands back a `SoundHandle` addressing that one *playback*, not the clip - playing the
 * same track twice yields two handles, which is what lets a music screen cross-fade between them.
 * Everything else takes a handle; `Stop Sound` with none stops everything this family started, which
 * is the escape hatch for a Page-exit handler.
 *
 * The in/out points marked on the asset apply here exactly as they do in a story row: the host folds
 * them in when it builds the clip, so a track with a marked loop region loops its body on a music
 * page too.
 */

const execIn: BlueprintNodePinDef = { id: "in", kind: "input", semantic: "exec", label: "In" };
const execNext: BlueprintNodePinDef = { id: "next", kind: "output", semantic: "exec", label: "Next" };

/**
 * The clip to play, as an asset id.
 *
 * A string pin rather than a structured asset value, because the two ways an author names a clip
 * pull in opposite directions: a fixed button sound is picked in the inspector, while a music
 * player's row is whatever `Get List Item Props` → `Get JSON Field` produced - a plain id. Wiring
 * wins over the picker, the same rule the gallery nodes follow.
 */
const assetIdIn: BlueprintNodePinDef = {
    id: "assetId",
    kind: "input",
    semantic: "data",
    valueType: "string",
    label: "Asset",
    optional: true,
    allowInlineLiteral: true,
};

const handleIn: BlueprintNodePinDef = {
    id: "handle",
    kind: "input",
    semantic: "data",
    valueType: BLUEPRINT_VALUE_TYPE_SOUND_HANDLE,
    label: "Sound",
};

const fadeIn: BlueprintNodePinDef = {
    id: "fadeMs",
    kind: "input",
    semantic: "data",
    valueType: "float",
    label: "Fade (ms)",
    optional: true,
    allowInlineLiteral: true,
};

const GRAPH_KINDS = ["event", "macro"] as const;

type ExecuteCtx = Parameters<NonNullable<BlueprintNodeDef["execute"]>>[0];

/** The resolver's 6th argument is recursion depth, not a default - unwired pins come back undefined. */
function readPin(ctx: ExecuteCtx, portId: string): unknown {
    return resolveDataPinValue(ctx.graph, ctx.node.id, portId, ctx.params, ctx.blueprintLocals, 0, {
        hostAdapter: ctx.hostAdapter,
        eventPayload: ctx.eventPayload,
        listItemScope: ctx.listItemScope,
        instanceKey: ctx.instanceKey,
        executionOwner: ctx.executionOwner,
    });
}

function resolveAssetId(ctx: ExecuteCtx): string {
    const wired = String(readPin(ctx, "assetId") ?? "").trim();
    if (wired) {
        return wired;
    }
    const picked = ctx.params?.asset;
    const fromParam = typeof picked === "string"
        ? picked
        : typeof (picked as { assetId?: unknown } | undefined)?.assetId === "string"
            ? String((picked as { assetId: string }).assetId)
            : "";
    const assetId = fromParam.trim();
    if (!assetId) {
        throw new BlueprintGraphExecutionError("Play Sound needs an audio asset", ctx.node.id);
    }
    return assetId;
}

function resolveHandle(ctx: ExecuteCtx): BlueprintSoundHandle | null {
    return normalizeBlueprintSoundHandle(readPin(ctx, "handle"));
}

function resolveFadeMs(ctx: ExecuteCtx): number | undefined {
    const value = readPin(ctx, "fadeMs");
    if (value === undefined || value === null || value === "") {
        return undefined;
    }
    const ms = typeof value === "number" ? value : Number(value);
    return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

function resolveNumberPin(ctx: ExecuteCtx, portId: string, label: string, fallback: number): number {
    const raw = readPin(ctx, portId);
    if (raw === undefined || raw === null || raw === "") {
        return fallback;
    }
    const value = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(value)) {
        throw new BlueprintGraphExecutionError(`${label} must be a finite number`, ctx.node.id);
    }
    return value;
}

export const soundBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: BLUEPRINT_NODE_TYPE_SOUND_PLAY,
        displayName: "Play Sound",
        category: "Game",
        keywords: ["sound", "audio", "play", "music", "bgm", "sfx", "voice", "clip", "start"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [
            execIn,
            execNext,
            assetIdIn,
            {
                id: "loop",
                kind: "input",
                semantic: "data",
                valueType: "boolean",
                label: "Loop",
                optional: true,
                allowInlineLiteral: true,
            },
            {
                id: "volume",
                kind: "input",
                semantic: "data",
                valueType: "float",
                label: "Volume",
                optional: true,
                allowInlineLiteral: true,
            },
            fadeIn,
            {
                id: "handle",
                kind: "output",
                semantic: "data",
                valueType: BLUEPRINT_VALUE_TYPE_SOUND_HANDLE,
                label: "Sound",
            },
        ],
        inspectorParams: [
            { key: "asset", label: "Audio", kind: "audioAsset" },
            {
                key: "channel",
                label: "Channel",
                kind: "select",
                options: [
                    { value: "sound", label: "Sound effect" },
                    { value: "bgm", label: "Music" },
                    { value: "voice", label: "Voice" },
                ],
            },
        ],
        async execute(ctx) {
            const channel = (String(ctx.params?.channel ?? "").trim() || "sound") as BlueprintSoundChannel;
            const handle = await requireHostApi(ctx).sound.play({
                assetId: resolveAssetId(ctx),
                channel,
                loop: readPin(ctx, "loop") === true,
                volume: resolveNumberPin(ctx, "volume", "Volume", 1),
                fadeMs: resolveFadeMs(ctx),
            });
            // Null in a host with no audio (the editor's surface preview). Downstream transport nodes
            // no-op on a null handle, so a graph built against a preview still runs end to end.
            return { nextPort: "next", outputValues: { handle } };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_SOUND_STOP,
        displayName: "Stop Sound",
        category: "Game",
        keywords: ["sound", "audio", "stop", "music", "bgm", "silence", "all"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        // The handle is optional here and only here: leaving it unwired means "everything this family
        // started", which is what a Page-exit handler wants and what a Stop All node would duplicate.
        pins: [execIn, execNext, { ...handleIn, optional: true }, fadeIn],
        async execute(ctx) {
            await requireHostApi(ctx).sound.stop(resolveHandle(ctx), resolveFadeMs(ctx));
            return { nextPort: "next" };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_SOUND_PAUSE,
        displayName: "Pause Sound",
        category: "Game",
        keywords: ["sound", "audio", "pause", "music", "bgm", "hold"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn, execNext, handleIn, fadeIn],
        async execute(ctx) {
            await requireHostApi(ctx).sound.pause(resolveHandle(ctx), resolveFadeMs(ctx));
            return { nextPort: "next" };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_SOUND_RESUME,
        displayName: "Resume Sound",
        category: "Game",
        keywords: ["sound", "audio", "resume", "unpause", "continue", "music", "bgm"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn, execNext, handleIn, fadeIn],
        async execute(ctx) {
            await requireHostApi(ctx).sound.resume(resolveHandle(ctx), resolveFadeMs(ctx));
            return { nextPort: "next" };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_SOUND_SET_VOLUME,
        displayName: "Set Sound Volume",
        category: "Game",
        keywords: ["sound", "audio", "volume", "fade", "music", "bgm", "duck", "level"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        // Volume + fade together, so this is also the fade node: there is no separate Fade Sound,
        // because "fade to zero" and "set the volume over a second" are one operation.
        pins: [
            execIn,
            execNext,
            handleIn,
            {
                id: "volume",
                kind: "input",
                semantic: "data",
                valueType: "float",
                label: "Volume",
                allowInlineLiteral: true,
            },
            fadeIn,
        ],
        async execute(ctx) {
            await requireHostApi(ctx).sound.setVolume(
                resolveHandle(ctx),
                resolveNumberPin(ctx, "volume", "Volume", 1),
                resolveFadeMs(ctx),
            );
            return { nextPort: "next" };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_SOUND_SEEK,
        displayName: "Seek Sound",
        category: "Game",
        keywords: ["sound", "audio", "seek", "position", "jump", "skip", "music", "bgm", "scrub"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [
            execIn,
            execNext,
            handleIn,
            {
                id: "timeMs",
                kind: "input",
                semantic: "data",
                valueType: "float",
                label: "Time (ms)",
                allowInlineLiteral: true,
            },
        ],
        async execute(ctx) {
            await requireHostApi(ctx).sound.seek(
                resolveHandle(ctx),
                resolveNumberPin(ctx, "timeMs", "Time", 0),
            );
            return { nextPort: "next" };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_SOUND_IS_PLAYING,
        displayName: "Is Sound Playing",
        category: "Game",
        keywords: ["sound", "audio", "playing", "paused", "state", "music", "bgm", "is"],
        // Pure, so a play/pause button can bind its icon to it directly rather than mirroring the
        // state into a variable that drifts the moment a track ends on its own.
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        isLatent: false,
        pins: [
            handleIn,
            {
                id: "playing",
                kind: "output",
                semantic: "data",
                valueType: "boolean",
                label: "Playing",
            },
        ],
        execute(ctx) {
            return { outputValues: { playing: requireHostApi(ctx).sound.isPlaying(resolveHandle(ctx)) } };
        },
    },
];
