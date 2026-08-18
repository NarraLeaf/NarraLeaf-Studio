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
  BLUEPRINT_NODE_TYPE_SOUND_STOP
} from "@shared/types/blueprint/graph";
import {
  BLUEPRINT_VALUE_TYPE_SOUND_HANDLE,
  normalizeBlueprintSoundHandle
} from "@shared/types/blueprint/valueTypes";
import { normalizeBlueprintSoundChannel } from "../../blueprint-runtime/BlueprintHostApiBridge";
import { DEFAULT_AUDIO_TRACK_ID } from "@shared/types/audioTrack";
import {
  BLUEPRINT_AUDIO_TRACK_OPTIONS_SOURCE as AUDIO_TRACK_OPTIONS_SOURCE,
  BLUEPRINT_SOUND_PARAM_TRACK as SOUND_PARAM_TRACK
} from "./audioTrackParams";
import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BlueprintNodeDef, BlueprintNodePinDef } from "../types";
import { resolveDataPinValue } from "./graphParamResolvers";
import { requireHostApi } from "./hostApi";

const execIn: BlueprintNodePinDef = { id: "in", kind: "input", semantic: "exec", label: "In" };
const execNext: BlueprintNodePinDef = {
  id: "next",
  kind: "output",
  semantic: "exec",
  label: "Next"
};

/** Sound needs a running game to route through, i.e. event / macro graphs. */
const SOUND_GRAPH_KINDS = ["event", "macro"] as const;

export const BLUEPRINT_SOUND_PARAM_ASSET = "soundAssetId";

/**
 * The project audio track this play lands on, and the picker that offers it.
 *
 * Re-exported rather than declared here: `Get/Set Track Volume` in the game family reads the same
 * key, and `graphParamResolvers` reads it on the data path, so the constant has to live somewhere
 * neither node module owns.
 */
export {
  BLUEPRINT_AUDIO_TRACK_OPTIONS_SOURCE,
  BLUEPRINT_SOUND_PARAM_TRACK
} from "./audioTrackParams";

/**
 * The pre-track channel select. Kept as a constant, not as a control: a graph written before tracks
 * existed still carries it, and both the document migration and {@link resolveTrackId} need the
 * spelling to read it back. Nothing writes it any more.
 */
export const BLUEPRINT_SOUND_PARAM_CHANNEL = "soundChannel";

const handleIn: BlueprintNodePinDef = {
  id: "handle",
  kind: "input",
  semantic: "data",
  valueType: BLUEPRINT_VALUE_TYPE_SOUND_HANDLE,
  label: "Handle"
};

const handleOut: BlueprintNodePinDef = {
  id: "handle",
  kind: "output",
  semantic: "data",
  valueType: BLUEPRINT_VALUE_TYPE_SOUND_HANDLE,
  label: "Handle"
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
  optional: true
};

const loopIn: BlueprintNodePinDef = {
  id: "loop",
  kind: "input",
  semantic: "data",
  valueType: "boolean",
  label: "Loop",
  optional: true,
  allowInlineLiteral: true
};

const volumeIn: BlueprintNodePinDef = {
  id: "volume",
  kind: "input",
  semantic: "data",
  valueType: "float",
  label: "Volume",
  optional: true,
  allowInlineLiteral: true
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
  allowInlineLiteral: true
};

/**
 * Fade-in for a play, in seconds like every other authored duration.
 *
 * Its own pin rather than the shared `Fade (s)` above, because a play has only one direction to
 * fade and reusing the neutral label on a node that cannot fade out reads as the wrong control.
 * Unset means a hard start: a fade belongs to the moment, not to the track, so there is no
 * category-level default for it to inherit.
 */
const fadeInIn: BlueprintNodePinDef = {
  id: "fadeIn",
  kind: "input",
  semantic: "data",
  valueType: "float",
  label: "Fade In (s)",
  optional: true,
  allowInlineLiteral: true
};

/** Where to move the play head, measured from the start of the file rather than from the in point. */
const timeIn: BlueprintNodePinDef = {
  id: "time",
  kind: "input",
  semantic: "data",
  valueType: "float",
  label: "Time (s)",
  allowInlineLiteral: true
};

const isPlayingOut: BlueprintNodePinDef = {
  id: "isPlaying",
  kind: "output",
  semantic: "data",
  valueType: "boolean",
  label: "Is Playing"
};

type SoundExecuteCtx = Parameters<NonNullable<BlueprintNodeDef["execute"]>>[0];

function readPin(ctx: SoundExecuteCtx, pinId: string): unknown {
  return resolveDataPinValue(ctx.graph, ctx.node.id, pinId, ctx.params, ctx.blueprintLocals, 0, {
    hostAdapter: ctx.hostAdapter,
    eventPayload: ctx.eventPayload,
    listItemScope: ctx.listItemScope,
    instanceKey: ctx.instanceKey,
    executionOwner: ctx.executionOwner
  });
}

/** A seconds pin as the milliseconds the host capability takes. Negative and unset both read as 0. */
function readSecondsAsMs(ctx: SoundExecuteCtx, portId: string): number {
  const seconds = readOptionalNumber(readPin(ctx, portId)) ?? 0;
  return seconds > 0 ? Math.round(seconds * 1000) : 0;
}

/**
 * The same conversion, but keeping "unset" distinguishable from "zero".
 *
 * Both currently mean a hard start, so the distinction buys nothing at the host today. It is kept
 * because it costs one branch and because collapsing it here is what would make a future
 * "fade-in defaults to X" impossible to add without touching every call site.
 */
function readOptionalSecondsAsMs(ctx: SoundExecuteCtx, portId: string): number | undefined {
  const seconds = readOptionalNumber(readPin(ctx, portId));
  if (seconds === undefined) {
    return undefined;
  }
  return seconds > 0 ? Math.round(seconds * 1000) : 0;
}

/** Only a real boolean is an override; anything else leaves the track's own loop policy in force. */
function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
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

/**
 * The track id this node plays on.
 *
 * A graph saved before tracks existed carries `soundChannel` instead; `migrateBlueprintDocument`
 * rewrites it on read, but a graph can still reach execution unmigrated (a plugin building nodes at
 * runtime, a host call), so the same mapping is applied here. Both arms land on the built-in track
 * for that channel, which reproduces the old behaviour exactly.
 */
function resolveTrackId(ctx: SoundExecuteCtx): string | null {
  const stored = ctx.params[SOUND_PARAM_TRACK];
  const trackId = typeof stored === "string" ? stored.trim() : "";
  if (trackId) {
    return trackId;
  }
  const legacy = ctx.params[BLUEPRINT_SOUND_PARAM_CHANNEL];
  return legacy === undefined || legacy === null
    ? null
    : DEFAULT_AUDIO_TRACK_ID[normalizeBlueprintSoundChannel(legacy)];
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

/**
 * The track picker that replaced the old three-value `Channel` select.
 *
 * Dynamic rather than static because the whole point of a track is that a project can add one:
 * "Ambience" has to appear here the moment the author creates it on the project Audio surface,
 * without a node-catalog change. An empty selection resolves to the built-in SFX track.
 */
const audioTrackParam = {
  key: SOUND_PARAM_TRACK,
  label: "Track",
  kind: "select" as const,
  dynamicOptionsSource: AUDIO_TRACK_OPTIONS_SOURCE
};

export const soundBlueprintNodes: BlueprintNodeDef[] = [
  {
    type: BLUEPRINT_NODE_TYPE_SOUND_PLAY,
    displayName: "Play Sound",
    category: "Sound",
    keywords: ["sound", "audio", "play", "music", "bgm", "sfx", "voice", "clip", "track", "fade"],
    graphKinds: [...SOUND_GRAPH_KINDS],
    isPure: false,
    isLatent: true,
    pins: [execIn, assetIdIn, loopIn, volumeIn, fadeInIn, execNext, handleOut],
    inspectorParams: [
      { key: BLUEPRINT_SOUND_PARAM_ASSET, label: "Clip", kind: "audioAsset" },
      audioTrackParam
    ],
    async execute(ctx) {
      const assetId = resolveAssetId(ctx);
      if (!assetId) {
        throw new BlueprintGraphExecutionError(
          "Play Sound: pick a clip or wire an Asset Id",
          ctx.node.id
        );
      }
      // Every override is passed as "unset" when its pin is unwired, so the host resolves the
      // track's own default rather than this node inventing one. A hard-coded `loop: false`
      // here is what would keep a Music track from looping.
      const handle = await requireHostApi(ctx).sound.play({
        assetId,
        audioTrackId: resolveTrackId(ctx),
        loop: readOptionalBoolean(readPin(ctx, "loop")),
        volume: readOptionalNumber(readPin(ctx, "volume")),
        fadeInMs: readOptionalSecondsAsMs(ctx, "fadeIn")
      });
      // A null handle means this environment backs no audio (editor
      // preview). The graph continues; downstream transport is a no-op.
      return { nextPort: "next", outputValues: { handle } };
    }
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
        readSecondsAsMs(ctx, "fade")
      );
      return { nextPort: "next" };
    }
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
    }
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
    }
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
    //
    // This addresses one **playing clip** by handle, and dies with it. Its counterpart for the
    // player's mixer is `Set Track Volume` in the Game category, which moves a whole bus. The
    // game family's SFX-slider node used to share this display name and no longer does.
    pins: [execIn, handleIn, volumeIn, fadeIn, execNext],
    async execute(ctx) {
      await requireHostApi(ctx).sound.setVolume(
        requireHandle(ctx, "Set Sound Volume"),
        readOptionalNumber(readPin(ctx, "volume")) ?? 1,
        readSecondsAsMs(ctx, "fade")
      );
      return { nextPort: "next" };
    }
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
        readSecondsAsMs(ctx, "time")
      );
      return { nextPort: "next" };
    }
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
          isPlaying: requireHostApi(ctx).sound.isPlaying(requireHandle(ctx, "Is Sound Playing"))
        }
      };
    }
  }
];
