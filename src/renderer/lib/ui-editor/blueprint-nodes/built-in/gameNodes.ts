import {
    BLUEPRINT_NODE_TYPE_GAME_AUTO_SAVE_LATEST,
    BLUEPRINT_NODE_TYPE_GAME_AUTO_SAVE_LIST,
    BLUEPRINT_NODE_TYPE_GAME_AUTO_SAVE_WRITE,
    BLUEPRINT_NODE_TYPE_GAME_CHOOSE,
    BLUEPRINT_NODE_TYPE_GAME_GET_AUTO_FORWARD,
    BLUEPRINT_NODE_TYPE_GAME_GET_BGM_VOLUME,
    BLUEPRINT_NODE_TYPE_GAME_GET_CHARACTER,
    BLUEPRINT_NODE_TYPE_GAME_GET_CHOICE_COUNT,
    BLUEPRINT_NODE_TYPE_GAME_GET_GAME_SPEED,
    BLUEPRINT_NODE_TYPE_GAME_GET_GLOBAL_VOLUME,
    BLUEPRINT_NODE_TYPE_GAME_GET_NAMETAG,
    BLUEPRINT_NODE_TYPE_GAME_GET_NOTIFICATIONS,
    BLUEPRINT_NODE_TYPE_GAME_CLEAR_TEXT_READ,
    BLUEPRINT_NODE_TYPE_GAME_IS_NVL_MODE,
    BLUEPRINT_NODE_TYPE_GAME_IS_TEXT_READ,
    BLUEPRINT_NODE_TYPE_GAME_IS_TEXT_READ_BY_ID,
    BLUEPRINT_NODE_TYPE_GAME_GET_SENTENCE_SPEED,
    BLUEPRINT_NODE_TYPE_GAME_GET_SKIP_DELAY,
    BLUEPRINT_NODE_TYPE_GAME_GET_SKIP_ENABLED,
    BLUEPRINT_NODE_TYPE_GAME_GET_SKIP_INTERVAL,
    BLUEPRINT_NODE_TYPE_GAME_GET_SKIP_READ_TEXT,
    BLUEPRINT_NODE_TYPE_GAME_GET_SOUND_VOLUME,
    BLUEPRINT_NODE_TYPE_GAME_GET_SPEAKER_AVATAR,
    BLUEPRINT_NODE_TYPE_GAME_GET_SPEAKER_COLOR,
    BLUEPRINT_NODE_TYPE_GAME_GET_VOICE_END_MODE,
    BLUEPRINT_NODE_TYPE_GAME_GET_VOICE_FADE_DURATION,
    BLUEPRINT_NODE_TYPE_GAME_GET_VOICE_VOLUME,
    BLUEPRINT_NODE_TYPE_GAME_HIDE_DIALOG,
    BLUEPRINT_NODE_TYPE_GAME_IS_GAME_OVERLAY,
    BLUEPRINT_NODE_TYPE_GAME_IS_IN_GAME,
    BLUEPRINT_NODE_TYPE_GAME_NEXT,
    BLUEPRINT_NODE_TYPE_GAME_QUIT,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_DELETE,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_METADATA,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_TIME,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_LINE,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_PLAYTIME,
    BLUEPRINT_NODE_TYPE_GAME_GET_PLAYTIME,
    BLUEPRINT_NODE_TYPE_GAME_GET_TOTAL_PLAYTIME,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_PREVIEW,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_LIST_IDS,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_LOAD,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_WRITE,
    BLUEPRINT_NODE_TYPE_GAME_SET_AUTO_FORWARD,
    BLUEPRINT_NODE_TYPE_GAME_SET_BGM_VOLUME,
    BLUEPRINT_NODE_TYPE_GAME_SET_GAME_SPEED,
    BLUEPRINT_NODE_TYPE_GAME_SET_GLOBAL_VOLUME,
    BLUEPRINT_NODE_TYPE_GAME_SET_SENTENCE_SPEED,
    BLUEPRINT_NODE_TYPE_GAME_SET_SKIP_DELAY,
    BLUEPRINT_NODE_TYPE_GAME_SET_SKIP_ENABLED,
    BLUEPRINT_NODE_TYPE_GAME_SET_SKIP_INTERVAL,
    BLUEPRINT_NODE_TYPE_GAME_SET_SKIP_READ_TEXT,
    BLUEPRINT_NODE_TYPE_GAME_SET_SOUND_VOLUME,
    BLUEPRINT_NODE_TYPE_GAME_SET_VOICE_END_MODE,
    BLUEPRINT_NODE_TYPE_GAME_SET_VOICE_FADE_DURATION,
    BLUEPRINT_NODE_TYPE_GAME_SET_VOICE_VOLUME,
    BLUEPRINT_NODE_TYPE_GAME_SHOW_DIALOG,
    BLUEPRINT_NODE_TYPE_GAME_SKIP,
    BLUEPRINT_NODE_TYPE_GAME_START_STORY,
    BLUEPRINT_NODE_TYPE_GAME_TOGGLE_DIALOG_DISPLAY,
    BLUEPRINT_NODE_TYPE_GAME_GET_TRACK_VOLUME,
    BLUEPRINT_NODE_TYPE_GAME_SET_TRACK_VOLUME,
} from "@shared/types/blueprint/graph";
import {
    BLUEPRINT_VALUE_TYPE_ARRAY,
    BLUEPRINT_VALUE_TYPE_IMAGE_ASSET_NULLABLE,
    BLUEPRINT_VALUE_TYPE_RGBA_COLOR,
} from "@shared/types/blueprint/valueTypes";
import { blueprintCharacterColorOrDefault } from "@shared/types/blueprint/characterInfo";
import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BlueprintNodeDef, BlueprintNodePinDef } from "../types";
import type {
    BlueprintGamePreferenceKey,
    BlueprintGamePreferenceValue,
} from "../../blueprint-runtime/BlueprintHostApiBridge";
import { getActiveSaveSchemaFields } from "@shared/saves/saveSchemaRegistry";
import { buildSaveMetadataFromFields, readSaveMetadataFields } from "@shared/saves/saveSchemaModel";
import type { SaveSchemaField } from "@shared/types/saveSchema";
import { saveSchemaPinId } from "../effectivePins";
import { resolveDataPinValue } from "./graphParamResolvers";
import { requireHostApi } from "./hostApi";
import {
    BLUEPRINT_AUDIO_TRACK_OPTIONS_SOURCE,
    BLUEPRINT_SOUND_PARAM_TRACK,
    readBlueprintAudioTrackParam,
} from "./audioTrackParams";

const execIn: BlueprintNodePinDef = { id: "in", kind: "input", semantic: "exec", label: "In" };
const execNext: BlueprintNodePinDef = { id: "next", kind: "output", semantic: "exec", label: "Next" };
const execFailed: BlueprintNodePinDef = { id: "failed", kind: "output", semantic: "exec", label: "Failed" };
const saveIdIn: BlueprintNodePinDef = {
    id: "id",
    kind: "input",
    semantic: "data",
    valueType: "string",
    label: "Id",
    allowInlineLiteral: true,
};
const saveMetadataIn: BlueprintNodePinDef = {
    id: "metadata",
    kind: "input",
    semantic: "data",
    valueType: "json",
    label: "Metadata",
    optional: true,
};
const saveScreenshotIn: BlueprintNodePinDef = {
    id: "screenshot",
    kind: "input",
    semantic: "data",
    valueType: "boolean",
    label: "Capture",
    optional: true,
    allowInlineLiteral: true,
};
/**
 * Optional runtime overrides for Start Game's target.
 *
 * Without these the scene can only be chosen from a dropdown at author time,
 * which makes a data-driven launcher impossible: a recollection list knows which
 * scene to replay only when the player clicks a row. The picker stays for the
 * hand-authored case ("New Game" starts chapter one), and a wired pin wins over
 * it - the same precedence the gallery's own artwork pins use.
 *
 * `startBlockId` narrows the launch to one row; the host's start-story request
 * already carries it (row-precise "play from here").
 */
const startStoryTargetPins: BlueprintNodePinDef[] = [
    { id: "storyId", kind: "input", semantic: "data", valueType: "string", label: "Story Id", optional: true },
    { id: "sceneId", kind: "input", semantic: "data", valueType: "string", label: "Scene Id", optional: true },
    { id: "startBlockId", kind: "input", semantic: "data", valueType: "string", label: "From Row", optional: true },
];

const sentenceCpsIn: BlueprintNodePinDef = {
    id: "cps",
    kind: "input",
    semantic: "data",
    valueType: "float",
    label: "CPS",
    allowInlineLiteral: true,
};
const GRAPH_KINDS = ["event", "macro"] as const;
const PURE_GRAPH_KINDS = ["event", "function", "macro"] as const;

type GamePreferenceNodeKey = Exclude<BlueprintGamePreferenceKey, "showDialog">;

type GamePreferenceNodeMeta = {
    key: GamePreferenceNodeKey;
    getterType: string;
    setterType?: string;
    getterDisplayName: string;
    setterDisplayName?: string;
    pinId: string;
    pinLabel: string;
    valueType: "boolean" | "float" | "string";
    defaultValue: BlueprintGamePreferenceValue;
    min?: number;
    minExclusive?: boolean;
    keywords: string[];
};

const GAME_PREFERENCE_NODE_META: readonly GamePreferenceNodeMeta[] = [
    {
        key: "autoForward",
        getterType: BLUEPRINT_NODE_TYPE_GAME_GET_AUTO_FORWARD,
        setterType: BLUEPRINT_NODE_TYPE_GAME_SET_AUTO_FORWARD,
        getterDisplayName: "Get Auto Forward",
        setterDisplayName: "Set Auto Forward",
        pinId: "autoForward",
        pinLabel: "Auto Forward",
        valueType: "boolean",
        defaultValue: false,
        keywords: ["game", "preference", "auto", "forward", "dialog", "nlr"],
    },
    {
        key: "skip",
        getterType: BLUEPRINT_NODE_TYPE_GAME_GET_SKIP_ENABLED,
        setterType: BLUEPRINT_NODE_TYPE_GAME_SET_SKIP_ENABLED,
        getterDisplayName: "Get Skip",
        setterDisplayName: "Set Skip",
        pinId: "skip",
        pinLabel: "Skip",
        valueType: "boolean",
        defaultValue: true,
        keywords: ["game", "preference", "skip", "dialog", "nlr"],
    },
    {
        // Studio's own preference, in the same family as the engine's twelve because that is what
        // it is to an author: one more row on the settings screen. What acts on it is the host's
        // skip loop (`skipRunController`), which stops the run at a line the player has not read.
        key: "skipReadText",
        getterType: BLUEPRINT_NODE_TYPE_GAME_GET_SKIP_READ_TEXT,
        setterType: BLUEPRINT_NODE_TYPE_GAME_SET_SKIP_READ_TEXT,
        getterDisplayName: "Get Skip Read Text",
        setterDisplayName: "Set Skip Read Text",
        pinId: "skipReadText",
        pinLabel: "Skip Read Text",
        valueType: "boolean",
        defaultValue: false,
        keywords: ["game", "preference", "skip", "read", "text", "unread", "dialog"],
    },
    {
        key: "gameSpeed",
        getterType: BLUEPRINT_NODE_TYPE_GAME_GET_GAME_SPEED,
        setterType: BLUEPRINT_NODE_TYPE_GAME_SET_GAME_SPEED,
        getterDisplayName: "Get Game Speed",
        setterDisplayName: "Set Game Speed",
        pinId: "gameSpeed",
        pinLabel: "Game Speed",
        valueType: "float",
        defaultValue: 1,
        min: 0,
        minExclusive: true,
        keywords: ["game", "preference", "speed", "multiplier", "dialog", "nlr"],
    },
    {
        key: "cps",
        getterType: BLUEPRINT_NODE_TYPE_GAME_GET_SENTENCE_SPEED,
        getterDisplayName: "Get Sentence Speed",
        pinId: "cps",
        pinLabel: "CPS",
        valueType: "float",
        defaultValue: 10,
        min: 0,
        minExclusive: true,
        keywords: ["game", "preference", "sentence", "speed", "cps", "dialog", "nlr"],
    },
    {
        key: "voiceVolume",
        getterType: BLUEPRINT_NODE_TYPE_GAME_GET_VOICE_VOLUME,
        setterType: BLUEPRINT_NODE_TYPE_GAME_SET_VOICE_VOLUME,
        getterDisplayName: "Get Voice Volume",
        setterDisplayName: "Set Voice Volume",
        pinId: "voiceVolume",
        pinLabel: "Voice Volume",
        valueType: "float",
        defaultValue: 1,
        min: 0,
        keywords: ["game", "preference", "voice", "volume", "audio", "nlr"],
    },
    {
        key: "voiceFadeDuration",
        getterType: BLUEPRINT_NODE_TYPE_GAME_GET_VOICE_FADE_DURATION,
        setterType: BLUEPRINT_NODE_TYPE_GAME_SET_VOICE_FADE_DURATION,
        getterDisplayName: "Get Voice Fade Duration",
        setterDisplayName: "Set Voice Fade Duration",
        pinId: "voiceFadeDuration",
        pinLabel: "Voice Fade",
        valueType: "float",
        defaultValue: 0,
        min: 0,
        keywords: ["game", "preference", "voice", "fade", "duration", "audio", "nlr"],
    },
    {
        key: "voiceEndMode",
        getterType: BLUEPRINT_NODE_TYPE_GAME_GET_VOICE_END_MODE,
        setterType: BLUEPRINT_NODE_TYPE_GAME_SET_VOICE_END_MODE,
        getterDisplayName: "Get Voice End Mode",
        setterDisplayName: "Set Voice End Mode",
        pinId: "voiceEndMode",
        pinLabel: "Voice End Mode",
        valueType: "string",
        defaultValue: "stop",
        keywords: ["game", "preference", "voice", "end", "mode", "fade", "stop", "none", "audio", "nlr"],
    },
    {
        key: "bgmVolume",
        getterType: BLUEPRINT_NODE_TYPE_GAME_GET_BGM_VOLUME,
        setterType: BLUEPRINT_NODE_TYPE_GAME_SET_BGM_VOLUME,
        getterDisplayName: "Get BGM Volume",
        setterDisplayName: "Set BGM Volume",
        pinId: "bgmVolume",
        pinLabel: "BGM Volume",
        valueType: "float",
        defaultValue: 1,
        min: 0,
        keywords: ["game", "preference", "bgm", "music", "volume", "audio", "nlr"],
    },
    {
        key: "soundVolume",
        getterType: BLUEPRINT_NODE_TYPE_GAME_GET_SOUND_VOLUME,
        setterType: BLUEPRINT_NODE_TYPE_GAME_SET_SOUND_VOLUME,
        // "SFX", not "Sound". `Set Sound Volume` was two different nodes: this one, which moves the
        // player's SFX slider, and the sound-transport node, which changes one playing clip by
        // handle. An author building a settings page met both in the palette under one name with
        // nothing to tell them apart. The *type ids* are untouched (`blueprint.game.getSoundVolume`
        // / `setSoundVolume`), so every graph that already uses them still loads; only the label
        // moved, and "SFX" is what the seeded bus is called on the project Audio surface anyway.
        getterDisplayName: "Get SFX Volume",
        setterDisplayName: "Set SFX Volume",
        pinId: "soundVolume",
        pinLabel: "SFX Volume",
        valueType: "float",
        defaultValue: 1,
        min: 0,
        keywords: ["game", "preference", "sound", "sfx", "effects", "volume", "audio", "nlr"],
    },
    {
        key: "globalVolume",
        getterType: BLUEPRINT_NODE_TYPE_GAME_GET_GLOBAL_VOLUME,
        setterType: BLUEPRINT_NODE_TYPE_GAME_SET_GLOBAL_VOLUME,
        getterDisplayName: "Get Global Volume",
        setterDisplayName: "Set Global Volume",
        pinId: "globalVolume",
        pinLabel: "Global Volume",
        valueType: "float",
        defaultValue: 1,
        min: 0,
        keywords: ["game", "preference", "global", "master", "volume", "audio", "nlr"],
    },
    {
        key: "skipDelay",
        getterType: BLUEPRINT_NODE_TYPE_GAME_GET_SKIP_DELAY,
        setterType: BLUEPRINT_NODE_TYPE_GAME_SET_SKIP_DELAY,
        getterDisplayName: "Get Skip Delay",
        setterDisplayName: "Set Skip Delay",
        pinId: "skipDelay",
        pinLabel: "Skip Delay",
        valueType: "float",
        defaultValue: 500,
        min: 0,
        keywords: ["game", "preference", "skip", "delay", "dialog", "nlr"],
    },
    {
        key: "skipInterval",
        getterType: BLUEPRINT_NODE_TYPE_GAME_GET_SKIP_INTERVAL,
        setterType: BLUEPRINT_NODE_TYPE_GAME_SET_SKIP_INTERVAL,
        getterDisplayName: "Get Skip Interval",
        setterDisplayName: "Set Skip Interval",
        pinId: "skipInterval",
        pinLabel: "Skip Interval",
        valueType: "float",
        defaultValue: 100,
        min: 0,
        minExclusive: true,
        keywords: ["game", "preference", "skip", "interval", "dialog", "nlr"],
    },
];

function createPreferenceDataPin(meta: GamePreferenceNodeMeta, kind: "input" | "output"): BlueprintNodePinDef {
    const pin: BlueprintNodePinDef = {
        id: meta.pinId,
        kind,
        semantic: "data",
        valueType: meta.valueType,
        label: meta.pinLabel,
    };
    if (kind === "input" && (meta.valueType === "float" || meta.valueType === "string")) {
        pin.allowInlineLiteral = true;
    }
    return pin;
}

/** Wired pin wins over the inspector picker; see startStoryTargetPins. */
function resolveStartStoryTarget(
    ctx: Parameters<NonNullable<BlueprintNodeDef["execute"]>>[0],
    key: "storyId" | "sceneId" | "startBlockId",
): string {
    const wired = resolveDataPinValue(ctx.graph, ctx.node.id, key, ctx.params, ctx.blueprintLocals, 0, {
        hostAdapter: ctx.hostAdapter,
        eventPayload: ctx.eventPayload,
        listItemScope: ctx.listItemScope,
        instanceKey: ctx.instanceKey,
        executionOwner: ctx.executionOwner,
    });
    const fromPin = typeof wired === "string" ? wired.trim() : "";
    // `startBlockId` has no picker, so params never supplies it.
    return fromPin || (key === "startBlockId" ? "" : String(ctx.params[key] ?? "").trim());
}

function resolveSaveId(ctx: Parameters<NonNullable<BlueprintNodeDef["execute"]>>[0]): string {
    const value = resolveDataPinValue(ctx.graph, ctx.node.id, "id", ctx.params, ctx.blueprintLocals, 0, {
        hostAdapter: ctx.hostAdapter,
        eventPayload: ctx.eventPayload,
        listItemScope: ctx.listItemScope,
        instanceKey: ctx.instanceKey,
        executionOwner: ctx.executionOwner,
    });
    const id = String(value ?? "").trim();
    if (!id) {
        throw new BlueprintGraphExecutionError("Save id is required", ctx.node.id);
    }
    return id;
}

function cloneJsonValue(value: unknown): unknown {
    if (value === undefined) {
        return null;
    }
    try {
        const serialized = JSON.stringify(value);
        return serialized === undefined ? null : JSON.parse(serialized);
    } catch {
        return null;
    }
}

function resolveSaveMetadata(ctx: Parameters<NonNullable<BlueprintNodeDef["execute"]>>[0]): unknown {
    const value = resolveDataPinValue(ctx.graph, ctx.node.id, "metadata", ctx.params, ctx.blueprintLocals, 0, {
        hostAdapter: ctx.hostAdapter,
        eventPayload: ctx.eventPayload,
        listItemScope: ctx.listItemScope,
        instanceKey: ctx.instanceKey,
        executionOwner: ctx.executionOwner,
    });
    return cloneJsonValue(value);
}

/** One save-schema pin's value, resolved like any other data input. */
function resolveSaveSchemaPin(
    ctx: Parameters<NonNullable<BlueprintNodeDef["execute"]>>[0],
    field: SaveSchemaField,
): unknown {
    return resolveDataPinValue(
        ctx.graph,
        ctx.node.id,
        saveSchemaPinId(field.id),
        ctx.params,
        ctx.blueprintLocals,
        undefined,
        {
            hostAdapter: ctx.hostAdapter,
            eventPayload: ctx.eventPayload,
            listItemScope: ctx.listItemScope,
            instanceKey: ctx.instanceKey,
            executionOwner: ctx.executionOwner,
        },
    );
}

/**
 * What `Save Game` actually stores at `metadata.user`.
 *
 * The raw `metadata` pin comes first and the declared fields are written over it. Both survive on
 * purpose: the raw pin is the escape hatch that keeps every graph written before the schema existed
 * working unchanged, and a key nobody declared - a plugin's, a legacy one - still has somewhere to
 * ride. Where the two overlap the declaration wins, because it is the one the read side is going to
 * ask for by name.
 *
 * With no fields declared this is exactly what it always was: whatever the graph handed the pin.
 */
function resolveSaveMetadataToWrite(ctx: Parameters<NonNullable<BlueprintNodeDef["execute"]>>[0]): unknown {
    const fields = getActiveSaveSchemaFields();
    const raw = resolveSaveMetadata(ctx);
    if (fields.length === 0) {
        return raw;
    }
    const values: Record<string, unknown> = {};
    for (const field of fields) {
        const value = resolveSaveSchemaPin(ctx, field);
        if (value !== undefined) {
            values[field.id] = value;
        }
    }
    const base = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    return cloneJsonValue({ ...base, ...buildSaveMetadataFromFields(fields, values) });
}

function resolveSaveScreenshot(ctx: Parameters<NonNullable<BlueprintNodeDef["execute"]>>[0]): boolean {
    const value = resolveDataPinValue(ctx.graph, ctx.node.id, "screenshot", ctx.params, ctx.blueprintLocals, 0, {
        hostAdapter: ctx.hostAdapter,
        eventPayload: ctx.eventPayload,
        listItemScope: ctx.listItemScope,
        instanceKey: ctx.instanceKey,
        executionOwner: ctx.executionOwner,
    });
    return value === true;
}

function hasDataInputValue(ctx: Parameters<NonNullable<BlueprintNodeDef["execute"]>>[0], portId: string): boolean {
    return (
        Object.prototype.hasOwnProperty.call(ctx.params, portId) ||
        ctx.graph.edges?.some(edge => edge.to.nodeId === ctx.node.id && edge.to.port === portId) === true
    );
}

function resolveSentenceCps(ctx: Parameters<NonNullable<BlueprintNodeDef["execute"]>>[0]): number {
    const portId = hasDataInputValue(ctx, "cps") || !hasDataInputValue(ctx, "speed") ? "cps" : "speed";
    const value = resolveDataPinValue(ctx.graph, ctx.node.id, portId, ctx.params, ctx.blueprintLocals, 10, {
        hostAdapter: ctx.hostAdapter,
        eventPayload: ctx.eventPayload,
        listItemScope: ctx.listItemScope,
        instanceKey: ctx.instanceKey,
        executionOwner: ctx.executionOwner,
    });
    const cps = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(cps) || cps <= 0) {
        throw new BlueprintGraphExecutionError("CPS must be a positive number", ctx.node.id);
    }
    return cps;
}

function resolvePreferenceValue(
    ctx: Parameters<NonNullable<BlueprintNodeDef["execute"]>>[0],
    meta: GamePreferenceNodeMeta,
): BlueprintGamePreferenceValue {
    const resolvedValue = resolveDataPinValue(ctx.graph, ctx.node.id, meta.pinId, ctx.params, ctx.blueprintLocals, 0, {
        hostAdapter: ctx.hostAdapter,
        eventPayload: ctx.eventPayload,
        listItemScope: ctx.listItemScope,
        instanceKey: ctx.instanceKey,
        executionOwner: ctx.executionOwner,
    });
    const value = resolvedValue === undefined ? meta.defaultValue : resolvedValue;
    if (meta.valueType === "boolean") {
        if (typeof value !== "boolean") {
            throw new BlueprintGraphExecutionError(`${meta.pinLabel} must be a boolean`, ctx.node.id);
        }
        return value;
    }
    if (meta.valueType === "string") {
        const text = String(value ?? "").trim();
        if (meta.key === "voiceEndMode" && text !== "fade" && text !== "stop" && text !== "none") {
            throw new BlueprintGraphExecutionError('Voice End Mode must be "fade", "stop", or "none"', ctx.node.id);
        }
        return text as BlueprintGamePreferenceValue;
    }
    const numberValue = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numberValue)) {
        throw new BlueprintGraphExecutionError(`${meta.pinLabel} must be a finite number`, ctx.node.id);
    }
    if (typeof meta.min === "number") {
        const invalid = meta.minExclusive ? numberValue <= meta.min : numberValue < meta.min;
        if (invalid) {
            const suffix = meta.minExclusive ? `greater than ${meta.min}` : `${meta.min} or greater`;
            throw new BlueprintGraphExecutionError(`${meta.pinLabel} must be ${suffix}`, ctx.node.id);
        }
    }
    return numberValue;
}

function createPreferenceGetterNode(meta: GamePreferenceNodeMeta): BlueprintNodeDef {
    return {
        type: meta.getterType,
        displayName: meta.getterDisplayName,
        category: "Game",
        keywords: meta.keywords,
        graphKinds: [...PURE_GRAPH_KINDS],
        isPure: true,
        isLatent: false,
        pins: [createPreferenceDataPin(meta, "output")],
        execute(ctx) {
            return {
                outputValues: {
                    [meta.pinId]: requireHostApi(ctx).game.getPreference(meta.key),
                },
            };
        },
    };
}

function createPreferenceSetterNode(meta: GamePreferenceNodeMeta): BlueprintNodeDef | null {
    if (!meta.setterType || !meta.setterDisplayName) {
        return null;
    }
    return {
        type: meta.setterType,
        displayName: meta.setterDisplayName,
        category: "Game",
        keywords: meta.keywords,
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn, execNext, createPreferenceDataPin(meta, "input")],
        async execute(ctx) {
            await requireHostApi(ctx).game.setPreference(meta.key, resolvePreferenceValue(ctx, meta));
            return { nextPort: "next" };
        },
    };
}

const gamePreferenceBlueprintNodes: BlueprintNodeDef[] = GAME_PREFERENCE_NODE_META.flatMap(meta => {
    const setterNode = createPreferenceSetterNode(meta);
    return setterNode ? [createPreferenceGetterNode(meta), setterNode] : [createPreferenceGetterNode(meta)];
});

/**
 * Per-track volume - the general form of the four fixed volume nodes above.
 *
 * Those four address the engine's three seeded buses (plus master) and nothing else, so the moment
 * an author creates a track the mixer has a strip no settings page can bind to. The motivating case
 * is per-character voice: `voice/alice` is a real bus with a real gain, and "turn Alice down" is a
 * slider the player expects to find. These two nodes are that slider's two halves.
 *
 * Deliberately **not** a replacement: the four keep their node types, their pins and their
 * behaviour, because every existing settings page is built on them and because the engine still
 * carries them as preferences aliased onto the seeded buses. An author who picks `bgm` here and an
 * author who uses `Set BGM Volume` are moving the same fader.
 *
 * The picker is dynamic (the same `AudioTrackService`-backed source the sound nodes' Track select
 * uses), so a track the author adds appears without a node-catalog change. It shares the param key
 * `audioTrackId` with those nodes on purpose - that is the key the project's "what references this
 * track" sweep looks for, so a graph binding a slider counts as a reference.
 */
const trackVolumeParam = {
    key: BLUEPRINT_SOUND_PARAM_TRACK,
    label: "Track",
    kind: "select" as const,
    dynamicOptionsSource: BLUEPRINT_AUDIO_TRACK_OPTIONS_SOURCE,
};

const trackVolumeKeywords = [
    "game", "preference", "track", "bus", "volume", "audio", "mixer", "channel", "character", "voice", "nlr",
];

const trackVolumeBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: BLUEPRINT_NODE_TYPE_GAME_GET_TRACK_VOLUME,
        displayName: "Get Track Volume",
        category: "Game",
        keywords: trackVolumeKeywords,
        graphKinds: [...PURE_GRAPH_KINDS],
        // Pure, like the four fixed getters, so it can drive a slider's value in a Blueprint Value
        // graph. That also means `execute` is never called on the data path - the pin is served by
        // `graphParamResolvers`, and the node type has to be registered there or it reads undefined.
        isPure: true,
        isLatent: false,
        pins: [{ id: "volume", kind: "output", semantic: "data", valueType: "float", label: "Volume" }],
        inspectorParams: [trackVolumeParam],
        execute(ctx) {
            const trackId = readBlueprintAudioTrackParam(ctx.params);
            return {
                outputValues: {
                    volume: trackId ? requireHostApi(ctx).sound.getTrackVolume(trackId) : 1,
                },
            };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_SET_TRACK_VOLUME,
        displayName: "Set Track Volume",
        category: "Game",
        keywords: trackVolumeKeywords,
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [
            execIn,
            execNext,
            {
                id: "volume",
                kind: "input",
                semantic: "data",
                valueType: "float",
                label: "Volume",
                allowInlineLiteral: true,
            },
        ],
        inspectorParams: [trackVolumeParam],
        async execute(ctx) {
            const trackId = readBlueprintAudioTrackParam(ctx.params);
            if (!trackId) {
                throw new BlueprintGraphExecutionError("Set Track Volume: pick a track", ctx.node.id);
            }
            const raw = resolveDataPinValue(ctx.graph, ctx.node.id, "volume", ctx.params, ctx.blueprintLocals, 1, {
                hostAdapter: ctx.hostAdapter,
                eventPayload: ctx.eventPayload,
                listItemScope: ctx.listItemScope,
                instanceKey: ctx.instanceKey,
                executionOwner: ctx.executionOwner,
            });
            const volume = typeof raw === "number" ? raw : Number(raw);
            if (!Number.isFinite(volume)) {
                throw new BlueprintGraphExecutionError("Volume must be a finite number", ctx.node.id);
            }
            // Clamping rather than rejecting is the host's job (and the engine's) - a slider bound
            // to 0..100 asking for 100 means "as loud as it goes", not "fail the graph".
            await requireHostApi(ctx).sound.setTrackVolume(trackId, volume);
            return { nextPort: "next" };
        },
    },
];

/**
 * Automatic saving. Studio writes these on a timer (project → Game), into a
 * reserved ring of ids the player-facing save nodes never see - so an author's
 * Save/Load screen and an Auto Save screen each list only their own.
 *
 * Entries carry the save *id*, not the serialized game: a `SavedGameData` blob
 * is inert inside a graph, whereas an id feeds straight into Load Save / Get
 * Save Preview / Get Save Metadata / Delete Save. One node composing with the
 * six that already exist, rather than a parallel family.
 */
const autoSaveBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: BLUEPRINT_NODE_TYPE_GAME_AUTO_SAVE_WRITE,
        displayName: "Auto Save",
        category: "Game",
        keywords: ["game", "auto", "autosave", "save", "write", "checkpoint", "slot", "rotate"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn, execNext],
        async execute(ctx) {
            await requireHostApi(ctx).game.writeAutoSave();
            return { nextPort: "next" };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_AUTO_SAVE_LIST,
        displayName: "List Auto Saves",
        category: "Game",
        keywords: ["game", "auto", "autosave", "save", "list", "entries", "slots", "recent", "continue"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [
            execIn,
            execNext,
            {
                id: "entries",
                kind: "output",
                semantic: "data",
                valueType: BLUEPRINT_VALUE_TYPE_ARRAY,
                label: "Entries",
            },
            {
                id: "count",
                kind: "output",
                semantic: "data",
                valueType: "integer",
                label: "Count",
            },
        ],
        async execute(ctx) {
            const entries = await requireHostApi(ctx).game.listAutoSaves();
            return {
                nextPort: "next",
                outputValues: {
                    entries,
                    count: entries.length,
                },
            };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_AUTO_SAVE_LATEST,
        displayName: "Get Latest Auto Save",
        category: "Game",
        keywords: ["game", "auto", "autosave", "save", "latest", "newest", "continue", "resume", "id"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [
            execIn,
            execNext,
            {
                id: "id",
                kind: "output",
                semantic: "data",
                valueType: "string",
                label: "Id",
            },
            {
                id: "hasAutoSave",
                kind: "output",
                semantic: "data",
                valueType: "boolean",
                label: "Has Auto Save",
            },
            {
                id: "timestamp",
                kind: "output",
                semantic: "data",
                valueType: "float",
                label: "Timestamp",
            },
        ],
        // The whole point of this node is the Continue button: pick the newest
        // autosave and feed its id to Load Save. Deriving it from List Auto
        // Saves would take three more nodes for the single most common use.
        async execute(ctx) {
            const latest = (await requireHostApi(ctx).game.listAutoSaves())[0];
            return {
                nextPort: "next",
                outputValues: {
                    id: latest?.id ?? "",
                    hasAutoSave: Boolean(latest),
                    timestamp: latest?.timestamp ?? 0,
                },
            };
        },
    },
];

export const gameBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: BLUEPRINT_NODE_TYPE_GAME_GET_NAMETAG,
        displayName: "Get Nametag",
        category: "Game",
        keywords: ["game", "dialog", "nametag", "speaker", "character", "nlr"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        isLatent: false,
        pins: [
            {
                id: "nametag",
                kind: "output",
                semantic: "data",
                valueType: "string",
                label: "Nametag",
            },
        ],
        execute(ctx) {
            return {
                outputValues: {
                    nametag: requireHostApi(ctx).game.getNametag(),
                },
            };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_GET_SPEAKER_AVATAR,
        displayName: "Get Speaker Avatar",
        category: "Game",
        keywords: ["game", "dialog", "avatar", "portrait", "speaker", "character", "face", "expression", "nlr"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        isLatent: false,
        pins: [
            {
                id: "avatar",
                kind: "output",
                semantic: "data",
                valueType: BLUEPRINT_VALUE_TYPE_IMAGE_ASSET_NULLABLE,
                label: "Avatar",
            },
        ],
        execute(ctx) {
            return {
                outputValues: {
                    avatar: requireHostApi(ctx).game.getSpeakerAvatar(),
                },
            };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_GET_SPEAKER_COLOR,
        displayName: "Get Speaker Color",
        category: "Game",
        keywords: ["game", "dialog", "color", "colour", "accent", "speaker", "character", "nametag", "tint", "nlr"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        isLatent: false,
        pins: [
            {
                id: "color",
                kind: "output",
                semantic: "data",
                valueType: BLUEPRINT_VALUE_TYPE_RGBA_COLOR,
                label: "Color",
            },
        ],
        execute(ctx) {
            return {
                outputValues: {
                    color: requireHostApi(ctx).game.getSpeakerColor(),
                },
            };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_GET_CHARACTER,
        displayName: "Get Character",
        category: "Game",
        keywords: ["game", "character", "cast", "name", "color", "colour", "avatar", "portrait", "profile", "nlr"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        isLatent: false,
        pins: [
            {
                id: "name",
                kind: "output",
                semantic: "data",
                valueType: "string",
                label: "Name",
            },
            {
                id: "characterColor",
                kind: "output",
                semantic: "data",
                valueType: BLUEPRINT_VALUE_TYPE_RGBA_COLOR,
                label: "Color",
            },
            {
                id: "characterAvatar",
                kind: "output",
                semantic: "data",
                valueType: BLUEPRINT_VALUE_TYPE_IMAGE_ASSET_NULLABLE,
                label: "Avatar",
            },
            // The visible half of "this character was deleted". Without it a dangling reference is
            // indistinguishable from a character whose name is blank and whose colour is unset -
            // both would read as empty string / default white with nothing to branch on.
            {
                id: "found",
                kind: "output",
                semantic: "data",
                valueType: "boolean",
                label: "Found",
            },
        ],
        inspectorParams: [
            {
                key: "characterId",
                label: "Character",
                kind: "select",
                dynamicOptionsSource: "characters",
            },
        ],
        execute(ctx) {
            const characterId = String(ctx.params.characterId ?? "").trim();
            const character = characterId ? requireHostApi(ctx).game.getCharacter(characterId) : null;
            return {
                outputValues: {
                    name: character?.name ?? "",
                    characterColor: blueprintCharacterColorOrDefault(character?.color),
                    characterAvatar: character?.avatar ?? null,
                    found: Boolean(character),
                },
            };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_IS_IN_GAME,
        displayName: "Is In Game",
        category: "Game",
        keywords: ["game", "state", "active", "running", "nlr"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        isLatent: false,
        pins: [
            {
                id: "isInGame",
                kind: "output",
                semantic: "data",
                valueType: "boolean",
                label: "In Game",
            },
        ],
        execute(ctx) {
            return {
                outputValues: {
                    isInGame: requireHostApi(ctx).game.isInGame(),
                },
            };
        },
    },
    {
        /**
         * How long the running playthrough has been played - the reading a save written now would
         * record.
         *
         * Pure and binding-callable, because it reads a counter this process already holds. Note
         * what that does and does not buy: a binding re-evaluates when something re-renders, never
         * on a clock, so a save screen reading this as it opens is right, while a clock on screen
         * that has to tick needs something driving the re-render - a `Delay` loop on the surface
         * does it, and costs only the surfaces that asked for one.
         *
         * The stopwatch runs only while a playthrough is going and the window is on screen; it is
         * carried across a load, so this is the time behind the player's progress rather than the
         * time since they pressed Continue.
         */
        type: BLUEPRINT_NODE_TYPE_GAME_GET_PLAYTIME,
        displayName: "Get Playtime",
        category: "Game",
        keywords: [
            "game", "playtime", "play", "time", "duration", "elapsed", "played", "session",
            "hours", "clock", "timer",
        ],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        isLatent: false,
        pins: [
            {
                id: "playtimeSeconds",
                kind: "output",
                semantic: "data",
                valueType: "float",
                label: "Seconds",
            },
            {
                id: "playtimeMilliseconds",
                kind: "output",
                semantic: "data",
                valueType: "float",
                label: "Milliseconds",
            },
        ],
        execute(ctx) {
            const seconds = requireHostApi(ctx).game.getPlaytime();
            return {
                outputValues: {
                    playtimeSeconds: seconds,
                    playtimeMilliseconds: seconds * 1000,
                },
            };
        },
    },
    {
        /**
         * Seconds ever spent in this project, across every playthrough.
         *
         * Deliberately not in any save file: it lives in project persistence, so loading an old
         * save does not un-play the hours that led to it, and starting a new game does not reset
         * it. It is the number a title screen shows; `Get Playtime` is the one a save slot shows.
         */
        type: BLUEPRINT_NODE_TYPE_GAME_GET_TOTAL_PLAYTIME,
        displayName: "Get Total Playtime",
        category: "Game",
        keywords: [
            "game", "playtime", "total", "all", "lifetime", "cumulative", "play", "time",
            "duration", "played", "hours",
        ],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        isLatent: false,
        pins: [
            {
                id: "totalPlaytimeSeconds",
                kind: "output",
                semantic: "data",
                valueType: "float",
                label: "Seconds",
            },
            {
                id: "totalPlaytimeMilliseconds",
                kind: "output",
                semantic: "data",
                valueType: "float",
                label: "Milliseconds",
            },
        ],
        execute(ctx) {
            const seconds = requireHostApi(ctx).game.getTotalPlaytime();
            return {
                outputValues: {
                    totalPlaytimeSeconds: seconds,
                    totalPlaytimeMilliseconds: seconds * 1000,
                },
            };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_IS_GAME_OVERLAY,
        displayName: "Is Game Overlay",
        category: "Game",
        keywords: ["game", "overlay", "layer", "page", "surface", "pause", "menu"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        isLatent: false,
        pins: [
            {
                id: "isGameOverlay",
                kind: "output",
                semantic: "data",
                valueType: "boolean",
                label: "Game Overlay",
            },
        ],
        execute(ctx) {
            return {
                outputValues: {
                    isGameOverlay: requireHostApi(ctx).game.isGameOverlay(),
                },
            };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_GET_NOTIFICATIONS,
        displayName: "Get Notifications",
        category: "Game",
        keywords: ["game", "notification", "toast", "message", "nlr"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        isLatent: false,
        pins: [
            {
                id: "notifications",
                kind: "output",
                semantic: "data",
                valueType: BLUEPRINT_VALUE_TYPE_ARRAY,
                label: "Notifications",
            },
        ],
        execute(ctx) {
            return {
                outputValues: {
                    notifications: requireHostApi(ctx).game.getNotifications(),
                },
            };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_GET_CHOICE_COUNT,
        displayName: "Get Choice Count",
        category: "Game",
        keywords: ["game", "choice", "menu", "count", "options", "nlr"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        isLatent: false,
        pins: [
            {
                id: "count",
                kind: "output",
                semantic: "data",
                valueType: "integer",
                label: "Count",
            },
        ],
        execute(ctx) {
            return {
                outputValues: {
                    count: requireHostApi(ctx).game.getChoiceCount(),
                },
            };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_IS_NVL_MODE,
        displayName: "Is NVL Mode",
        category: "Game",
        keywords: ["game", "nvl", "novel", "mode", "dialog", "nlr"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        isLatent: false,
        pins: [
            {
                id: "isNvlMode",
                kind: "output",
                semantic: "data",
                valueType: "boolean",
                label: "NVL Mode",
            },
        ],
        execute(ctx) {
            return {
                outputValues: {
                    isNvlMode: requireHostApi(ctx).game.isNvlMode(),
                },
            };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_IS_TEXT_READ,
        displayName: "Is Text Read",
        category: "Game",
        keywords: ["game", "text", "read", "seen", "unread", "dialog", "dialogue", "skip", "history", "nlr"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        isLatent: false,
        pins: [
            {
                id: "isRead",
                kind: "output",
                semantic: "data",
                valueType: "boolean",
                label: "Is Read",
            },
        ],
        execute(ctx) {
            return {
                outputValues: {
                    isRead: requireHostApi(ctx).game.isCurrentTextRead(),
                },
            };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_IS_TEXT_READ_BY_ID,
        displayName: "Has Read Text",
        category: "Game",
        keywords: ["game", "text", "read", "heard", "seen", "voice", "line", "extra", "unlock", "id", "nlr"],
        graphKinds: ["event", "function", "macro"],
        // Pure, so a voice EXTRA list item can bind its locked look directly
        // instead of running a graph per row.
        isPure: true,
        isLatent: false,
        pins: [
            {
                id: "textId",
                kind: "input",
                semantic: "data",
                valueType: "string",
                label: "Text Id",
                allowInlineLiteral: true,
            },
            {
                id: "isRead",
                kind: "output",
                semantic: "data",
                valueType: "boolean",
                label: "Has Read",
            },
        ],
        execute(ctx) {
            const wired = resolveDataPinValue(ctx.graph, ctx.node.id, "textId", ctx.params, ctx.blueprintLocals, 0, {
                hostAdapter: ctx.hostAdapter,
                eventPayload: ctx.eventPayload,
                listItemScope: ctx.listItemScope,
                instanceKey: ctx.instanceKey,
                executionOwner: ctx.executionOwner,
            });
            const textId = String(wired ?? "").trim();
            return {
                outputValues: {
                    // An empty id is "not read" rather than an error: a row whose
                    // voice unit was never picked simply stays locked.
                    isRead: textId ? requireHostApi(ctx).game.isTextRead(textId) : false,
                },
            };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_CLEAR_TEXT_READ,
        displayName: "Clear Text Read",
        category: "Game",
        keywords: ["game", "text", "read", "seen", "clear", "reset", "wipe", "history", "dialog", "nlr"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn, execNext],
        async execute(ctx) {
            await requireHostApi(ctx).game.clearTextRead();
            return { nextPort: "next" };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_CHOOSE,
        displayName: "Select Choice",
        category: "Game",
        keywords: ["game", "choice", "menu", "select", "choose", "nlr"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [
            execIn,
            execNext,
            {
                id: "index",
                kind: "input",
                semantic: "data",
                valueType: "integer",
                label: "Index",
                allowInlineLiteral: true,
            },
        ],
        async execute(ctx) {
            // With the runtime, because the index that picks a choice almost always comes from the
            // `Item Click` head that heard the click, and an event head's outputs live in the event
            // payload. Without it the pin resolved to null and every wired Select Choice threw.
            const wired = resolveDataPinValue(ctx.graph, ctx.node.id, "index", ctx.params, ctx.blueprintLocals, 0, {
                hostAdapter: ctx.hostAdapter,
                eventPayload: ctx.eventPayload,
                listItemScope: ctx.listItemScope,
                instanceKey: ctx.instanceKey,
                executionOwner: ctx.executionOwner,
            });
            const index = Number(wired ?? ctx.params.index);
            if (!Number.isInteger(index) || index < 0) {
                throw new BlueprintGraphExecutionError(
                    "Select Choice: index must be a non-negative integer",
                    ctx.node.id,
                );
            }
            await requireHostApi(ctx).game.choose(index);
            return { nextPort: "next" };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_START_STORY,
        displayName: "Start Game",
        category: "Game",
        // See startStoryTargetPins: the optional pins are what let a data-driven
        // screen (a recollection list) choose the scene at runtime.
        keywords: ["game", "start", "story", "scene", "nlr", "preview"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn, ...startStoryTargetPins],
        inspectorParams: [
            {
                key: "storyId",
                label: "Story",
                kind: "select",
                dynamicOptionsSource: "stories",
            },
            {
                key: "sceneId",
                label: "Scene",
                kind: "select",
                dynamicOptionsSource: "storyScenes",
                dynamicOptionsFilter: {
                    paramKey: "storyId",
                    optionMetaKey: "storyId",
                },
            },
        ],
        async execute(ctx) {
            const storyId = resolveStartStoryTarget(ctx, "storyId");
            const sceneId = resolveStartStoryTarget(ctx, "sceneId");
            const startBlockId = resolveStartStoryTarget(ctx, "startBlockId");
            if (!storyId) {
                throw new BlueprintGraphExecutionError("Pick a Story, or wire a Story Id", ctx.node.id);
            }
            if (!sceneId) {
                throw new BlueprintGraphExecutionError("Pick a Scene, or wire a Scene Id", ctx.node.id);
            }
            await requireHostApi(ctx).game.startStory({
                storyId,
                sceneId,
                ...(startBlockId ? { startBlockId } : {}),
            });
            return { nextPort: undefined };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_QUIT,
        displayName: "Quit Game",
        category: "Game",
        keywords: ["game", "quit", "exit", "return", "page", "nlr"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn],
        inspectorParams: [
            {
                key: "surfaceId",
                label: "Page",
                kind: "select",
                dynamicOptionsSource: "surfaces",
            },
        ],
        async execute(ctx) {
            const surfaceId = String(ctx.params.surfaceId ?? "").trim();
            if (!surfaceId) {
                throw new BlueprintGraphExecutionError("Pick a Page", ctx.node.id);
            }
            await requireHostApi(ctx).game.quit(surfaceId);
            return { nextPort: undefined };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_NEXT,
        displayName: "Next",
        category: "Game",
        keywords: ["game", "dialog", "next", "advance", "continue", "nlr"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn, execNext],
        async execute(ctx) {
            await requireHostApi(ctx).game.next();
            return { nextPort: "next" };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_SKIP,
        displayName: "Skip",
        category: "Game",
        keywords: ["game", "dialog", "skip", "fast", "nlr"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn, execNext],
        async execute(ctx) {
            await requireHostApi(ctx).game.skip();
            return { nextPort: "next" };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_SHOW_DIALOG,
        displayName: "Show Dialog",
        category: "Game",
        keywords: ["game", "dialog", "show", "display", "visible", "preference", "nlr"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn, execNext],
        async execute(ctx) {
            await requireHostApi(ctx).game.showDialog();
            return { nextPort: "next" };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_HIDE_DIALOG,
        displayName: "Hide Dialog",
        category: "Game",
        keywords: ["game", "dialog", "hide", "display", "invisible", "preference", "nlr"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn, execNext],
        async execute(ctx) {
            await requireHostApi(ctx).game.hideDialog();
            return { nextPort: "next" };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_TOGGLE_DIALOG_DISPLAY,
        displayName: "Toggle Dialog Display",
        category: "Game",
        keywords: ["game", "dialog", "toggle", "display", "visible", "preference", "nlr"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn, execNext],
        async execute(ctx) {
            await requireHostApi(ctx).game.toggleDialogDisplay();
            return { nextPort: "next" };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_SET_SENTENCE_SPEED,
        displayName: "Set Sentence Speed",
        category: "Game",
        keywords: ["game", "dialog", "sentence", "speed", "cps", "preference", "nlr"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn, execNext, sentenceCpsIn],
        async execute(ctx) {
            await requireHostApi(ctx).game.setSentenceSpeed(resolveSentenceCps(ctx));
            return { nextPort: "next" };
        },
    },
    ...gamePreferenceBlueprintNodes,
    ...trackVolumeBlueprintNodes,
    {
        type: BLUEPRINT_NODE_TYPE_GAME_SAVE_WRITE,
        displayName: "Save Game",
        category: "Game",
        keywords: ["game", "save", "write", "slot", "storage", "screenshot", "preview"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn, execNext, saveIdIn, saveMetadataIn, saveScreenshotIn],
        // One input pin per field the project declares, so what a slot carries is wired by name
        // instead of assembled with Make JSON Object and a string key.
        saveSchemaPins: { kind: "input" },
        async execute(ctx) {
            await requireHostApi(ctx).game.writeSave(
                resolveSaveId(ctx),
                resolveSaveMetadataToWrite(ctx),
                resolveSaveScreenshot(ctx),
            );
            return { nextPort: "next" };
        },
    },
    {
        /**
         * Put a save back on the stage, or say that it did not happen.
         *
         * `Failed` and no `Next`, which is not an oversight in either direction. There is nothing
         * for a `Next` to run: a load that lands replaces the whole running game, and a row wired
         * after it would execute against a game that is no longer the one the author wired it into.
         * A refusal is the opposite - nothing moved, the graph is still standing in the save screen
         * it was called from, and that is exactly where a title screen wants to put its "this save
         * could not be opened" line.
         *
         * The reasons that end here are all of them: a slot that is gone, a record that will not
         * read, a story that no longer has what the save names, and the author's own Older saves
         * policy declining a save from an earlier build. The player has already been shown a line
         * and the author already has one in the log, so this branch is for what the *title screen*
         * does next, not for reporting.
         */
        type: BLUEPRINT_NODE_TYPE_GAME_SAVE_LOAD,
        displayName: "Load Save",
        category: "Game",
        keywords: ["game", "save", "load", "read", "slot", "storage", "failed"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn, saveIdIn, execFailed],
        async execute(ctx) {
            const loaded = await requireHostApi(ctx).game.loadSave(resolveSaveId(ctx));
            return { nextPort: loaded ? undefined : "failed" };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_SAVE_DELETE,
        displayName: "Delete Save",
        category: "Game",
        keywords: ["game", "save", "delete", "remove", "slot", "storage"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn, execNext, saveIdIn],
        async execute(ctx) {
            await requireHostApi(ctx).game.deleteSave(resolveSaveId(ctx));
            return { nextPort: "next" };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_SAVE_LIST_IDS,
        displayName: "List Saves",
        category: "Game",
        keywords: ["game", "save", "list", "ids", "slots", "storage"],
        // Slots the project's Older saves policy would refuse are not in here. The listing and the
        // load read the same header and reach the same decision, so every id this hands out is an
        // id `Load Save` will accept - a save screen never draws a button that cannot work.
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [
            execIn,
            execNext,
            {
                id: "ids",
                kind: "output",
                semantic: "data",
                valueType: BLUEPRINT_VALUE_TYPE_ARRAY,
                label: "Ids",
            },
        ],
        async execute(ctx) {
            const ids = await requireHostApi(ctx).game.listSaveIds();
            return {
                nextPort: "next",
                outputValues: { ids },
            };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_METADATA,
        displayName: "Get Save Metadata",
        category: "Game",
        keywords: ["game", "save", "metadata", "json", "slot"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [
            execIn,
            execNext,
            saveIdIn,
            {
                id: "metadata",
                kind: "output",
                semantic: "data",
                valueType: "json",
                label: "Metadata",
            },
        ],
        // One output pin per field the project declares. The raw `metadata` output stays beside them
        // and always carries the whole stored object, so declaring a field never silently unwires a
        // graph that was reading the blob.
        saveSchemaPins: { kind: "output" },
        async execute(ctx) {
            const metadata = await requireHostApi(ctx).game.getSaveMetadata(resolveSaveId(ctx));
            const fields = getActiveSaveSchemaFields();
            const byFieldId = readSaveMetadataFields(fields, metadata);
            const outputValues: Record<string, unknown> = { metadata };
            for (const field of fields) {
                // Never `undefined`: a slot written before this field was declared answers with the
                // field's configured default, which is what lets an author add a field to a shipped
                // game without blanking every save already on a player's disk.
                outputValues[saveSchemaPinId(field.id)] = byFieldId[field.id];
            }
            return {
                nextPort: "next",
                outputValues,
            };
        },
    },
    {
        /**
         * When a slot was written, for the label on it.
         *
         * The store has stamped every record all along; nothing in a graph could read it. An author
         * building a save screen could show a slot's own metadata and its screenshot but not its
         * date - the one thing every save screen shows - unless they wrote the time into the
         * metadata themselves at `Save Game`, which is a second, drifting copy of a fact the store
         * already holds.
         *
         * Keyed by id like `Get Save Metadata` and `Get Save Preview`, so it composes with both
         * `List Saves` and `List Auto Saves` rather than being a second listing node. The pins carry
         * epoch milliseconds - what `Get Latest Auto Save` publishes and what every Time node takes.
         */
        type: BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_TIME,
        displayName: "Get Save Time",
        category: "Game",
        keywords: ["game", "save", "time", "date", "timestamp", "when", "written", "slot", "created"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [
            execIn,
            execNext,
            saveIdIn,
            {
                id: "savedAt",
                kind: "output",
                semantic: "data",
                valueType: "float",
                label: "Saved At",
            },
            {
                id: "createdAt",
                kind: "output",
                semantic: "data",
                valueType: "float",
                label: "Created At",
            },
            {
                id: "exists",
                kind: "output",
                semantic: "data",
                valueType: "boolean",
                label: "Exists",
            },
        ],
        async execute(ctx) {
            const times = await requireHostApi(ctx).game.getSaveTimes(resolveSaveId(ctx));
            return {
                nextPort: "next",
                outputValues: {
                    // A slot that is not there reads as the epoch, and `exists` is what tells the
                    // two apart - the same shape `Get Latest Auto Save` uses for `Has Auto Save`.
                    savedAt: times?.savedAt ?? 0,
                    createdAt: times?.createdAt ?? 0,
                    exists: Boolean(times),
                },
            };
        },
    },
    {
        /**
         * How long the playthrough behind one slot was played.
         *
         * Its own node rather than two more pins on `Get Save Time`: that node answers *when*, and
         * a save screen searching for a playtime - in either language the editor speaks - would not
         * find it under a title that says time. It reads the same store the same way, exactly as
         * `Get Save Line` does.
         *
         * Both units are published because both are wanted and neither is free to derive in a
         * graph: seconds is what the record stores and what arithmetic wants, milliseconds is what
         * every Time node takes, so `Format Duration` can be wired straight in with no Multiply
         * node between.
         */
        type: BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_PLAYTIME,
        displayName: "Get Save Playtime",
        category: "Game",
        keywords: [
            "game", "save", "playtime", "play", "time", "duration", "elapsed", "played",
            "hours", "slot", "length",
        ],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [
            execIn,
            execNext,
            saveIdIn,
            {
                id: "playtimeSeconds",
                kind: "output",
                semantic: "data",
                valueType: "float",
                label: "Seconds",
            },
            {
                id: "playtimeMilliseconds",
                kind: "output",
                semantic: "data",
                valueType: "float",
                label: "Milliseconds",
            },
            {
                id: "recorded",
                kind: "output",
                semantic: "data",
                valueType: "boolean",
                label: "Recorded",
            },
            {
                id: "exists",
                kind: "output",
                semantic: "data",
                valueType: "boolean",
                label: "Exists",
            },
        ],
        async execute(ctx) {
            const playtime = await requireHostApi(ctx).game.getSavePlaytime(resolveSaveId(ctx));
            return {
                nextPort: "next",
                outputValues: {
                    playtimeSeconds: playtime?.seconds ?? 0,
                    playtimeMilliseconds: (playtime?.seconds ?? 0) * 1000,
                    // Two different absences, and a save screen wants to draw them differently:
                    // `Exists` false is no such slot, `Recorded` false is a real slot from before
                    // playtime was tracked. Reporting either as zero seconds would be a claim
                    // about the player rather than about the record.
                    recorded: playtime?.recorded === true,
                    exists: Boolean(playtime),
                },
            };
        },
    },
    {
        /**
         * Where a slot stopped, in the words the save itself carries.
         *
         * The engine stamps `lastSentence` / `lastSpeaker` into the save on every serialize and no
         * graph could read either, so the one line a save screen exists to show had to be rebuilt by
         * hand: read the live backlog at `Save Game` time, take the newest entry, pull its text and
         * character out, and write them into the save's own metadata. That is eight nodes per slot
         * to restate a fact already on disk, and it is not even the same fact - the newest backlog
         * entry is the last line *shown*, while these are the line the save *resumes from*. Saving
         * from an overlay, a say followed by non-say actions, or a backlog past its cap all pull the
         * two apart, and the hand-built copy is the one that is wrong.
         *
         * Keyed by id like the rest of the family, so it composes with `List Saves` and
         * `List Auto Saves` alike. `storyHash` is deliberately not published here: the only use for
         * it in a graph would be refusing to load a save, and refusing on a hash is exactly what
         * this project decided against - it changes when a single line of text is edited, so it
         * would reject a great many saves that load perfectly.
         */
        type: BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_LINE,
        displayName: "Get Save Line",
        category: "Game",
        keywords: ["game", "save", "line", "sentence", "text", "speaker", "character", "slot", "summary"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [
            execIn,
            execNext,
            saveIdIn,
            {
                id: "line",
                kind: "output",
                semantic: "data",
                valueType: "string",
                label: "Line",
            },
            {
                id: "speaker",
                kind: "output",
                semantic: "data",
                valueType: "string",
                label: "Speaker",
            },
            {
                id: "exists",
                kind: "output",
                semantic: "data",
                valueType: "boolean",
                label: "Exists",
            },
        ],
        async execute(ctx) {
            const saved = await requireHostApi(ctx).game.getSaveLine(resolveSaveId(ctx));
            return {
                nextPort: "next",
                outputValues: {
                    // Empty strings for a slot that is not there, and `exists` to tell that apart
                    // from a real slot saved before any line played - both answer "" here.
                    line: saved?.line ?? "",
                    speaker: saved?.speaker ?? "",
                    exists: Boolean(saved),
                },
            };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_PREVIEW,
        displayName: "Get Save Preview",
        category: "Game",
        keywords: ["game", "save", "preview", "image", "screenshot", "slot"],
        graphKinds: [...GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [
            execIn,
            execNext,
            saveIdIn,
            {
                id: "preview",
                kind: "output",
                semantic: "data",
                valueType: BLUEPRINT_VALUE_TYPE_IMAGE_ASSET_NULLABLE,
                label: "Preview",
                /**
                 * A save slot's own screenshot, addressed as `dev-mode-save-preview:{saveId}` -
                 * a shape `isLibraryAssetId` rejects outright, because no library row answers to
                 * it. Wiring this into an image pin therefore hides no reference at all, and the
                 * reverse-lookup index must not report the pin as an asset it could not identify.
                 */
                assetRef: { kind: "image", origin: "published" },
            },
        ],
        async execute(ctx) {
            const preview = await requireHostApi(ctx).game.getSavePreview(resolveSaveId(ctx));
            return {
                nextPort: "next",
                outputValues: { preview },
            };
        },
    },
    ...autoSaveBlueprintNodes,
];
