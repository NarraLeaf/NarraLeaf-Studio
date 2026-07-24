import type { StoryBlock } from "@shared/types/story";
import { createBlockForCommand, type ActionCommandId } from "../../storyActionCommands";
import { BGM_OBJECT_NAME, type StoryCommandValue } from "../../storyCommandValues";
import { asBoolean, asDurationMs, asNumber, asTarget, asText, defineStoryCommand, targetParam } from "../spec";
import { deriveObjectName } from "../payloadHelpers";

/**
 * Sound: `/bgm`, `/sound`, and the control family `/vol` `/rate` `/stop` `/pause` `/resume`
 * `/mute` `/unmute`.
 *
 * The control family is the bible's B4: the target is an omissible leading positional that defaults
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
    const payload = { ...block.payload, objectName: asTarget(args.target)?.name ?? BGM_OBJECT_NAME };
    const fadeMs = asDurationMs(args.fade);
    if (fadeMs !== undefined) {
        payload.fadeMs = fadeMs;
    }
    write?.(payload);
    return { ...block, payload };
}

/**
 * The transport verbs that reach past sound: `/stop` `/pause` `/resume` accept a video target too.
 *
 * Same dispatch shape as `/show`'s (bible B3): the token names the verb, the resolved target decides
 * which payload the line writes. Omitting the target still means BGM (B4) - it is only a NAMED target
 * resolving to a video that lands here, so `/pause` with nothing after it can never silently pause a
 * clip the author was not thinking about.
 */
function mediaControlBlock(
    commandId: ActionCommandId,
    videoOperation: Extract<Extract<StoryBlock, { kind: "action" }>["payload"], { action: "video" }>["operation"],
    args: { readonly target?: StoryCommandValue; readonly fade?: StoryCommandValue },
    ctx: { generateId: () => string },
    write?: (payload: Extract<Extract<StoryBlock, { kind: "action" }>["payload"], { action: "audio" }>) => void,
): StoryBlock {
    const target = asTarget(args.target);
    if (target?.type === "stageObject" && target.objectKind === "video") {
        return {
            id: ctx.generateId(),
            parentId: null,
            childrenIds: [],
            kind: "action",
            payload: { action: "video", operation: videoOperation, objectName: target.name },
        };
    }
    return audioControlBlock(commandId, args, ctx.generateId, write);
}

export const bgm = defineStoryCommand({
    id: "bgm",
    token: "bgm",
    category: "sound",
    quickParams: ["vol", "loop"],
    params: {
        audio: { aliases: ["src"], hint: "audioAsset", type: { kind: "asset", assetType: "audio" }, positional: true, core: true },
        vol: { aliases: ["volume"], hint: "vol", type: { kind: "number", min: 0, max: 1 } },
        fade: { hint: "fade", type: { kind: "number", min: 0 } },
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
    quickParams: ["vol", "loop"],
    params: {
        audio: { aliases: ["src"], hint: "audioAsset", type: { kind: "asset", assetType: "audio" }, positional: true, core: true },
        name: { hint: "objectName", type: { kind: "text" } },
        vol: { aliases: ["volume"], hint: "vol", type: { kind: "number", min: 0, max: 1 } },
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
        const volume = asNumber(args.vol);
        if (volume !== undefined) {
            payload.volume = volume;
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
    params: {
        target: targetParam(["audio"], { skippable: true }),
        volume: { aliases: ["vol"], hint: "volume", type: { kind: "number", min: 0, max: 1 }, positional: true, core: true },
        fade: { hint: "fade", type: { kind: "number", min: 0 } },
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
    params: {
        target: targetParam(["audio"], { skippable: true }),
        rate: { hint: "rate", type: { kind: "number", min: 0 }, positional: true, core: true },
    },
    build: (args, ctx) => audioControlBlock("soundRate", args, ctx.generateId, payload => {
        const value = asNumber(args.rate);
        payload.rate = value ?? payload.rate;
    }),
});

export const stop = defineStoryCommand({
    id: "stop",
    token: "stop",
    category: "sound",
    params: {
        // `video` widens both the legal lines and the sidebar: the verb now files under 视频 as well
        // as 声音 (§4.2), which is the whole reason four video capabilities cost one new token.
        target: targetParam(["audio", "video"], { fallbackKind: "audio" }),
        fade: { hint: "fade", type: { kind: "number", min: 0 } },
    },
    build: (args, ctx) => mediaControlBlock("stopSound", "stop", args, ctx),
});

export const pause = defineStoryCommand({
    id: "pause",
    token: "pause",
    aliases: ["pausesound"],
    category: "sound",
    params: {
        target: targetParam(["audio", "video"], { fallbackKind: "audio" }),
    },
    build: (args, ctx) => mediaControlBlock("pauseSound", "pause", args, ctx),
});

export const resume = defineStoryCommand({
    id: "resume",
    token: "resume",
    category: "sound",
    params: {
        target: targetParam(["audio", "video"], { fallbackKind: "audio" }),
    },
    build: (args, ctx) => mediaControlBlock("resumeSound", "resume", args, ctx),
});

/**
 * `/seek` - the one operation with no generic verb to absorb it.
 *
 * Its target is not omissible: `/seek 3` with an implied BGM would be a sound operation NLR's `Sound`
 * does not have, so the clip has to be named. Seconds on the line, milliseconds in the payload, like
 * every other time in this vocabulary.
 */
export const seek = defineStoryCommand({
    id: "seek",
    token: "seek",
    category: "video",
    params: {
        target: targetParam(["video"], { core: true }),
        time: { hint: "seekTime", type: { kind: "number", min: 0 }, positional: true, core: true },
    },
    build(args, ctx): StoryBlock {
        return {
            id: ctx.generateId(),
            parentId: null,
            childrenIds: [],
            kind: "action",
            payload: {
                action: "video",
                operation: "seek",
                objectName: asTarget(args.target)?.name ?? "video",
                timeMs: asDurationMs(args.time) ?? 0,
            },
        };
    },
});

export const mute = defineStoryCommand({
    id: "mute",
    token: "mute",
    category: "sound",
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
    params: {
        target: targetParam(["audio"]),
    },
    build: (args, ctx) => audioControlBlock("muteSound", args, ctx.generateId, payload => {
        payload.muted = false;
    }),
});

export const SOUND_COMMANDS = [bgm, sound, vol, rate, stop, pause, resume, mute, unmute, seek];
