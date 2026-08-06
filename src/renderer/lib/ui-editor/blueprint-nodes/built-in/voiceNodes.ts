/**
 * Voice-over nodes: which dub the player hears, and replaying a line on demand.
 *
 * A family of its own rather than more Localization nodes, because dub language and subtitle
 * language are separate player choices - a game may be read in English and heard in Japanese. The
 * choice is persisted app-level like the text language, and takes effect from the next spoken line:
 * every scene shares one take table and the host re-points it in place, so there is no restart.
 *
 * `Play Voice` takes a voice unit id - the same id a backlog entry reports as `voiceId`. That is
 * what makes a backlog replay button buildable: the entry's `voice` field is a resolved URL the
 * player already heard, and nothing in the runtime accepts a URL.
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_TYPE_VOICE_GET_AVAILABLE_LANGUAGES,
    BLUEPRINT_NODE_TYPE_VOICE_GET_LANGUAGE,
    BLUEPRINT_NODE_TYPE_VOICE_PLAY,
    BLUEPRINT_NODE_TYPE_VOICE_SET_LANGUAGE,
} from "@shared/types/blueprint/graph";
import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BlueprintNodeDef } from "../types";
import { resolveDataPinValue } from "./graphParamResolvers";
import { requireHostApi } from "./hostApi";

type NodeExecuteContext = Parameters<NonNullable<BlueprintNodeDef["execute"]>>[0];

function resolvePinString(ctx: NodeExecuteContext, pinId: string): string {
    const raw = resolveDataPinValue(ctx.graph, ctx.node.id, pinId, ctx.params, ctx.blueprintLocals, 0, {
        hostAdapter: ctx.hostAdapter,
        eventPayload: ctx.eventPayload,
        listItemScope: ctx.listItemScope,
        instanceKey: ctx.instanceKey,
        executionOwner: ctx.executionOwner,
    });
    return raw === null || raw === undefined ? "" : String(raw);
}

export const voiceBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: BLUEPRINT_NODE_TYPE_VOICE_GET_LANGUAGE,
        displayName: "Get Voice Language",
        category: "Voice",
        keywords: ["voice", "dub", "language", "locale", "audio", "get"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "next", kind: "output", semantic: "exec", label: "Next" },
            { id: "value", kind: "output", semantic: "data", valueType: "string", label: "Language" },
        ],
        async execute(ctx) {
            const api = requireHostApi(ctx);
            return { nextPort: "next", outputValues: { value: await api.voice.getLocale() } };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_VOICE_SET_LANGUAGE,
        displayName: "Set Voice Language",
        category: "Voice",
        keywords: ["voice", "dub", "language", "locale", "audio", "set", "switch"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "next", kind: "output", semantic: "exec", label: "Next" },
            { id: "language", kind: "input", semantic: "data", valueType: "string", label: "Language" },
        ],
        async execute(ctx) {
            const api = requireHostApi(ctx);
            const locales = api.voice.listLocales();
            if (locales.length === 0) {
                throw new BlueprintGraphExecutionError("This project has no voice languages configured", ctx.node.id);
            }
            const code = resolvePinString(ctx, "language").trim();
            if (!code || !locales.some(entry => entry.code === code)) {
                throw new BlueprintGraphExecutionError(`Unknown voice language: ${code || "(empty)"}`, ctx.node.id);
            }
            await api.voice.setLocale(code);
            return { nextPort: "next" };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_VOICE_GET_AVAILABLE_LANGUAGES,
        displayName: "Get Available Voice Languages",
        category: "Voice",
        keywords: ["voice", "dub", "language", "locale", "audio", "list", "selector"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "next", kind: "output", semantic: "exec", label: "Next" },
            { id: "value", kind: "output", semantic: "data", valueType: "any", label: "Languages" },
        ],
        async execute(ctx) {
            const api = requireHostApi(ctx);
            return {
                nextPort: "next",
                outputValues: {
                    value: api.voice.listLocales().map(entry => ({
                        code: entry.code,
                        displayName: entry.displayName,
                    })),
                },
            };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_VOICE_PLAY,
        displayName: "Play Voice",
        category: "Voice",
        keywords: ["voice", "replay", "backlog", "history", "audio", "play", "line"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "next", kind: "output", semantic: "exec", label: "Next" },
            { id: "voiceId", kind: "input", semantic: "data", valueType: "string", label: "Voice Id" },
            { id: "value", kind: "output", semantic: "data", valueType: "boolean", label: "Played" },
        ],
        async execute(ctx) {
            const api = requireHostApi(ctx);
            const unitId = resolvePinString(ctx, "voiceId").trim();
            // A line with no take in the current dub language is a normal state, not a failure: a
            // backlog row for an unvoiced line just gets a replay button that reports false.
            const played = unitId ? await api.voice.play(unitId) : false;
            return { nextPort: "next", outputValues: { value: played } };
        },
    },
];
