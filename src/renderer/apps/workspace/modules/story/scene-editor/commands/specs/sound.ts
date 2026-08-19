import { AudioLines, CirclePlay, CircleStop, FastForward, Gauge, Music, Pause, Volume1, Volume2, VolumeX } from "lucide-react";
import type { StoryActionPayload, StoryBlock } from "@shared/types/story";
import { createBlockForCommand, type ActionCommandId } from "../../storyActionCommands";
import { BGM_OBJECT_NAME, type StoryCommandValue } from "../../storyCommandValues";
import { asAudioTrackId, asBoolean, asDurationMs, asNumber, asTarget, asText, audioTrackParam, defineStoryCommand, SECONDS_TYPE, targetParam } from "../spec";
import { actionableTargetRef, audioTargetRef, deriveObjectName, vfxOperationBlock } from "../payloadHelpers";

/**
 * Sound: `/bgm`, `/sound`, and the control family `/vol` `/rate` `/stop` `/pause` `/resume`
 * `/mute` `/unmute`.
 *
 * The control family: the target is an omissible leading positional that defaults
 * to the reserved name `bgm` - `/vol 0.5` turns the music down, `/vol piano 0.5` a named sound. The
 * compiler reserves `bgm` for the background-music channel, so the default needs no special payload
 * shape: it is just the name.
 */

function audioControlBlock(
    commandId: ActionCommandId,
    args: { readonly target?: StoryCommandValue; readonly fade?: StoryCommandValue },
    generateId: () => string,
    write?: (payload: Extract<Extract<StoryBlock, { kind: "action" }>["payload"], { action: "audio" }>) => void,
): StoryBlock {
    const block = createBlockForCommand(commandId, generateId);
    if (block.kind !== "action" || block.payload.action !== "audio") {
        return block;
    }
    const target = asTarget(args.target);
    // The name stays authoritative; the reference beside it is what follows a rename of the
    // `playSound` row that created the handle - or names the music channel, which has no such row.
    const payload = { ...block.payload, objectName: target?.name ?? BGM_OBJECT_NAME, target: audioTargetRef(target) };
    const fadeMs = asDurationMs(args.fade);
    if (fadeMs !== undefined) {
        payload.fadeMs = fadeMs;
    }
    write?.(payload);
    return { ...block, payload };
}

/**
 * The transport verbs that reach past sound: `/stop` `/pause` `/resume` `/rate` also address a video
 * or an ambience overlay.
 *
 * Same dispatch shape as `/show`'s: the token names the verb, the resolved target decides
 * which payload the line writes. Omitting the target still means BGM (B4) - it is only a NAMED target
 * resolving elsewhere that lands in another payload, so `/pause` with nothing after it can never
 * silently pause a clip the author was not thinking about.
 *
 * A verb that a given kind does not have simply does not list that kind in `accepts` - `/stop` reaches
 * video but not vfx (a `Vfx` has no stop), `/rate` reaches vfx but not video.
 */
function mediaControlBlock(
    commandId: ActionCommandId,
    ops: {
        video?: Extract<Extract<StoryBlock, { kind: "action" }>["payload"], { action: "video" }>["operation"];
        vfx?: Exclude<Extract<Extract<StoryBlock, { kind: "action" }>["payload"], { action: "vfx" }>["operation"], "create">;
    },
    args: { readonly target?: StoryCommandValue; readonly fade?: StoryCommandValue },
    ctx: { generateId: () => string },
    write?: (payload: Extract<Extract<StoryBlock, { kind: "action" }>["payload"], { action: "audio" }>) => void,
    writeVfx?: (payload: Extract<StoryActionPayload, { action: "vfx" }>) => void,
): StoryBlock {
    const target = asTarget(args.target);
    if (target?.type === "stageObject" && target.objectKind === "video" && ops.video) {
        return {
            id: ctx.generateId(),
            parentId: null,
            childrenIds: [],
            kind: "action",
            payload: { action: "video", operation: ops.video, objectName: target.name, target: actionableTargetRef(target) },
        };
    }
    if (target?.type === "stageObject" && target.objectKind === "vfx" && ops.vfx) {
        const block = vfxOperationBlock(ops.vfx, target.name, ctx.generateId, { target: actionableTargetRef(target) });
        if (block.kind === "action" && block.payload.action === "vfx") {
            const payload = { ...block.payload };
            writeVfx?.(payload);
            return { ...block, payload };
        }
        return block;
    }
    return audioControlBlock(commandId, args, ctx.generateId, write);
}

export const bgm = defineStoryCommand({
    id: "bgm",
    token: "bgm",
    category: "sound",
    icon: Music,
    examples: ["/bgm theme", "/bgm theme vol=0.6 fade=1 loop", "/bgm theme track=Music"],
    quickParams: ["vol", "loop"],
    params: {
        audio: { aliases: ["src"], hint: "audioAsset", type: { kind: "asset", assetType: "audio" }, positional: true, core: true },
        // The track IS the bus the clip is routed to, and supplies the loop default; `vol` and
        // `loop` below are the row's own. Omitted, the music built-in answers - which is the
        // behaviour every `/bgm` line written before tracks existed already had.
        track: audioTrackParam(),
        vol: { aliases: ["volume"], hint: "vol", type: { kind: "number", min: 0, max: 1 } },
        fade: { hint: "fade", type: SECONDS_TYPE },
        loop: { hint: "loop", type: { kind: "boolean" } },
    },
    build(args, ctx) {
        const block = createBlockForCommand("bgm", ctx.generateId);
        if (block.kind !== "action" || block.payload.action !== "audio") {
            return block;
        }
        const payload = { ...block.payload };
        if (args.audio?.kind === "asset") {
            payload.assetId = args.audio.assetId;
        }
        const audioTrackId = asAudioTrackId(args.track);
        if (audioTrackId !== undefined) {
            payload.audioTrackId = audioTrackId;
        }
        const volume = asNumber(args.vol);
        if (volume !== undefined) {
            payload.volume = volume;
        }
        const fadeMs = asDurationMs(args.fade);
        if (fadeMs !== undefined) {
            payload.fadeMs = fadeMs;
        }
        const loop = asBoolean(args.loop);
        if (loop !== undefined) {
            payload.loop = loop;
        }
        return { ...block, payload };
    },
});

export const sound = defineStoryCommand({
    id: "sound",
    token: "sound",
    aliases: ["se"],
    category: "sound",
    icon: AudioLines,
    examples: ["/sound hit", "/sound hit name=impact vol=0.8", "/sound hit track=SFX fade=0.2"],
    quickParams: ["vol", "loop"],
    params: {
        audio: { aliases: ["src"], hint: "audioAsset", type: { kind: "asset", assetType: "audio" }, positional: true, core: true },
        name: { hint: "objectName", type: { kind: "text" } },
        track: audioTrackParam(),
        vol: { aliases: ["volume"], hint: "vol", type: { kind: "number", min: 0, max: 1 } },
        // The compiler has always fed `fade` into `Sound.play()` on this row; only the spec omitted
        // the key, so a fade-in was reachable from the inspector and not from the line.
        fade: { hint: "fade", type: SECONDS_TYPE },
        loop: { hint: "loop", type: { kind: "boolean" } },
    },
    // A named sound is addressable later (`/stop hit`); the name derives from the file like `/image`.
    deriveArgs: deriveObjectName("audio", "audio", "sound"),
    build(args, ctx) {
        const block = createBlockForCommand("sound", ctx.generateId);
        if (block.kind !== "action" || block.payload.action !== "audio") {
            return block;
        }
        const payload = { ...block.payload };
        const name = asText(args.name);
        if (name !== undefined) {
            payload.objectName = name;
        }
        if (args.audio?.kind === "asset") {
            payload.assetId = args.audio.assetId;
        }
        const audioTrackId = asAudioTrackId(args.track);
        if (audioTrackId !== undefined) {
            payload.audioTrackId = audioTrackId;
        }
        const volume = asNumber(args.vol);
        if (volume !== undefined) {
            payload.volume = volume;
        }
        const fadeMs = asDurationMs(args.fade);
        if (fadeMs !== undefined) {
            payload.fadeMs = fadeMs;
        }
        const loop = asBoolean(args.loop);
        if (loop !== undefined) {
            payload.loop = loop;
        }
        return { ...block, payload };
    },
});

export const vol = defineStoryCommand({
    id: "volume",
    token: "vol",
    aliases: ["volume"],
    category: "sound",
    icon: Volume2,
    examples: ["/vol 0.5", "/vol music 0.5 fade=1"],
    params: {
        target: targetParam(["audio"], { skippable: true }),
        volume: { aliases: ["vol"], hint: "volume", type: { kind: "number", min: 0, max: 1 }, positional: true, core: true },
        fade: { hint: "fade", type: SECONDS_TYPE },
    },
    build: (args, ctx) => audioControlBlock("soundVolume", args, ctx.generateId, payload => {
        const volume = asNumber(args.volume);
        payload.volume = volume ?? payload.volume;
    }),
});

export const rate = defineStoryCommand({
    id: "rate",
    token: "rate",
    category: "sound",
    icon: Gauge,
    examples: ["/rate music 1.25"],
    params: {
        // An overlay's rate is how fast the petals fall, which is the same knob under a different
        // subject - so it is the same verb (§7.3). Video has no rate, so it is not listed.
        target: targetParam(["audio", "vfx"], { skippable: true, fallbackKind: "audio" }),
        rate: { hint: "rate", type: { kind: "number", min: 0 }, positional: true, core: true },
    },
    build: (args, ctx) => mediaControlBlock("soundRate", { vfx: "setRate" }, args, ctx, payload => {
        const value = asNumber(args.rate);
        payload.rate = value ?? payload.rate;
    }, payload => {
        payload.rate = asNumber(args.rate) ?? 1;
    }),
});

export const stop = defineStoryCommand({
    id: "stop",
    token: "stop",
    category: "sound",
    icon: CircleStop,
    examples: ["/stop music", "/stop music fade=1"],
    params: {
        // `video` widens both the legal lines and the sidebar: the verb now files under 视频 as well
        // as 声音 (§4.2), which is the whole reason four video capabilities cost one new token.
        target: targetParam(["audio", "video"], { fallbackKind: "audio" }),
        fade: { hint: "fade", type: SECONDS_TYPE },
    },
    build: (args, ctx) => mediaControlBlock("stopSound", { video: "stop" }, args, ctx),
});

export const pause = defineStoryCommand({
    id: "pause",
    token: "pause",
    aliases: ["pausesound"],
    category: "sound",
    icon: Pause,
    examples: ["/pause clip", "/pause music fade=0.5"],
    params: {
        target: targetParam(["audio", "video", "vfx"], { fallbackKind: "audio" }),
        // `Sound.pause` has always taken a fade and the compiler has always passed it; the spec was
        // the only thing that did not, which made ducking music out reachable only from the
        // inspector. A video or overlay target ignores it, exactly as it ignores `/stop`'s.
        fade: { hint: "fade", type: SECONDS_TYPE },
    },
    build: (args, ctx) => mediaControlBlock("pauseSound", { video: "pause", vfx: "pause" }, args, ctx),
});

export const resume = defineStoryCommand({
    id: "resume",
    token: "resume",
    category: "sound",
    icon: CirclePlay,
    examples: ["/resume clip", "/resume music fade=0.5"],
    params: {
        target: targetParam(["audio", "video", "vfx"], { fallbackKind: "audio" }),
        /** The other half of `/pause`'s fade - a duck out and back in are one gesture, two lines. */
        fade: { hint: "fade", type: SECONDS_TYPE },
    },
    build: (args, ctx) => mediaControlBlock("resumeSound", { video: "resume", vfx: "resume" }, args, ctx),
});

/**
 * `/seek` - the one operation with no generic verb to absorb it.
 *
 * It reaches audio as well as video (the engine grew `Sound.seek`), which makes it the same
 * dispatch-on-target shape as `/stop` and `/pause`: the token names the verb, the resolved target
 * decides which payload the line writes. Seconds on the line, milliseconds in the payload, like
 * every other time in this vocabulary.
 *
 * The target stays non-omissible even now that BGM could answer it. `/seek 3` reads as "three
 * seconds into… what?", and unlike `/vol 0.5` — where the music channel is the overwhelmingly common
 * subject — jumping the play head is something an author does to a clip they are thinking about by
 * name. `/seek bgm 30` is one word longer and unambiguous.
 */
export const seek = defineStoryCommand({
    id: "seek",
    token: "seek",
    // `accepts` files it under both 视频 and 声音 in the sidebar; this only picks the single section
    // the flat `/` menu prints it under, and the omitted target falls back to audio.
    category: "sound",
    icon: FastForward,
    examples: ["/seek clip 12", "/seek bgm 30"],
    params: {
        target: targetParam(["video", "audio"], { core: true, fallbackKind: "audio" }),
        time: { hint: "seekTime", type: SECONDS_TYPE, positional: true, core: true },
    },
    build(args, ctx): StoryBlock {
        const target = asTarget(args.target);
        const timeMs = asDurationMs(args.time) ?? 0;
        if (target?.type === "stageObject" && target.objectKind === "video") {
            return {
                id: ctx.generateId(),
                parentId: null,
                childrenIds: [],
                kind: "action",
                payload: {
                    action: "video",
                    operation: "seek",
                    objectName: target.name,
                    target: actionableTargetRef(target),
                    timeMs,
                },
            };
        }
        return audioControlBlock("seekSound", args, ctx.generateId, payload => {
            payload.timeMs = timeMs;
        });
    },
});

export const mute = defineStoryCommand({
    id: "mute",
    token: "mute",
    category: "sound",
    icon: VolumeX,
    examples: ["/mute music"],
    params: {
        target: targetParam(["audio"]),
    },
    build: (args, ctx) => audioControlBlock("muteSound", args, ctx.generateId, payload => {
        payload.muted = true;
    }),
});

export const unmute = defineStoryCommand({
    id: "unmute",
    token: "unmute",
    category: "sound",
    icon: Volume1,
    examples: ["/unmute music"],
    params: {
        target: targetParam(["audio"]),
    },
    build: (args, ctx) => audioControlBlock("muteSound", args, ctx.generateId, payload => {
        payload.muted = false;
    }),
});

export const SOUND_COMMANDS = [bgm, sound, vol, rate, stop, pause, resume, mute, unmute, seek];
