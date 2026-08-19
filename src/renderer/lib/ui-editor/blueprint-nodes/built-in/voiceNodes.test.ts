/**
 * Voice nodes. Every one of them is latent and publishes through `execute()`'s `outputValues`, so
 * the assertions read the output pin from a *downstream* node - that is the read path that silently
 * yields `undefined` when a node type is missing on the resolver side (`graphParamResolvers.ts`).
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_LITERAL,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
    BLUEPRINT_NODE_TYPE_VOICE_GET_AVAILABLE_LANGUAGES,
    BLUEPRINT_NODE_TYPE_VOICE_GET_LANGUAGE,
    BLUEPRINT_NODE_TYPE_VOICE_PLAY,
    BLUEPRINT_NODE_TYPE_VOICE_PLAY_CHOICE,
    BLUEPRINT_NODE_TYPE_VOICE_SET_LANGUAGE,
} from "@shared/types/blueprint/graph";
import type { UIGraph } from "@shared/types/ui-editor/graph";
import type { UIListItemScope } from "@shared/types/ui-editor/list";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import type { VoiceLocaleEntry } from "@shared/types/voice";
import { executeGraph } from "../../behavior-graph/GraphExecutor";

const LOCALES: VoiceLocaleEntry[] = [
    { code: "ja", displayName: "日本語" },
    { code: "en", displayName: "English" },
];

type VoiceHost = {
    locale: string;
    locales?: VoiceLocaleEntry[];
    setCalls: string[];
    playCalls: string[];
    /** Unit ids that have a take in the current dub language. */
    playable?: string[];
    /** `[unitId, interruptOthers]` per Play Choice Voice call, in order. */
    choiceCalls?: [string, boolean][];
};

function createVoiceHostAdapter(host: VoiceHost): UIHostAdapter {
    return {
        host: "player",
        blueprintRuntime: {
            surfaceId: "surface",
            setSurfaceState: () => undefined,
            getSurfaceState: () => undefined,
            emitDebug: () => undefined,
            dispatchElementBlueprintEvent: async () => undefined,
            hostApi: {
                voice: {
                    listLocales: () => host.locales ?? LOCALES,
                    getLocale: async () => host.locale,
                    setLocale: async (code: string) => {
                        host.setCalls.push(code);
                        host.locale = code;
                    },
                    play: async (unitId: string) => {
                        host.playCalls.push(unitId);
                        return (host.playable ?? ["t-1"]).includes(unitId);
                    },
                    playChoice: async (unitId: string, options?: { interruptOthers?: boolean }) => {
                        host.choiceCalls?.push([unitId, options?.interruptOthers === true]);
                        return (host.playable ?? ["t-1"]).includes(unitId);
                    },
                },
            },
        },
    } as unknown as UIHostAdapter;
}

async function runGraph(
    graph: UIGraph,
    host: VoiceHost,
    listItemScope?: UIListItemScope,
): Promise<Record<string, unknown>> {
    const locals: Record<string, unknown> = {};
    await executeGraph({
        graph,
        entry: graph.entries.main,
        hostAdapter: createVoiceHostAdapter(host),
        blueprintLocals: locals,
        ...(listItemScope ? { listItemScope } : {}),
    });
    return locals;
}

/** The scope a choice row runs its blueprint in: one option of the injected list. */
function choiceRow(voiceId: string, index = 0): UIListItemScope {
    return { item: { text: "Go left", index, disabled: false, voiceId }, index, count: 2, key: String(index) };
}

/** Play Choice Voice on its own, optionally with `Interrupt Others` wired from a literal. */
function playChoiceGraph(interruptOthers?: boolean): UIGraph {
    const graph = {
        id: "play-choice",
        entries: { main: { start: { nodeId: "act", port: "in" } } },
        nodes: {
            act: { id: "act", type: BLUEPRINT_NODE_TYPE_VOICE_PLAY_CHOICE, params: {} },
            store: { id: "store", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "out" } },
        },
        edges: [
            { from: { nodeId: "act", port: "next" }, to: { nodeId: "store", port: "in" } },
            { from: { nodeId: "act", port: "value" }, to: { nodeId: "store", port: "value" } },
        ],
    } as UIGraph;
    if (interruptOthers !== undefined) {
        graph.nodes.flag = { id: "flag", type: BLUEPRINT_NODE_TYPE_LITERAL, params: { value: interruptOthers } };
        graph.edges.push({ from: { nodeId: "flag", port: "value" }, to: { nodeId: "act", port: "interruptOthers" } });
    }
    return graph;
}

/** Single node whose data output pin feeds a Set Var named `out`. */
function captureOutputGraph(nodeType: string, outputPortId: string, params: Record<string, unknown> = {}): UIGraph {
    return {
        id: "capture",
        entries: { main: { start: { nodeId: "get", port: "in" } } },
        nodes: {
            get: { id: "get", type: nodeType, params },
            store: { id: "store", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "out" } },
        },
        edges: [
            { from: { nodeId: "get", port: "next" }, to: { nodeId: "store", port: "in" } },
            { from: { nodeId: "get", port: outputPortId }, to: { nodeId: "store", port: "value" } },
        ],
    } as UIGraph;
}

/** A node with one string input wired from a literal. */
function stringInputGraph(nodeType: string, inputPortId: string, value: string, outputPortId?: string): UIGraph {
    const graph = {
        id: "input",
        entries: { main: { start: { nodeId: "act", port: "in" } } },
        nodes: {
            act: { id: "act", type: nodeType, params: {} },
            literal: { id: "literal", type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value } },
            store: { id: "store", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "out" } },
        },
        edges: [
            { from: { nodeId: "literal", port: "value" }, to: { nodeId: "act", port: inputPortId } },
            { from: { nodeId: "act", port: "next" }, to: { nodeId: "store", port: "in" } },
        ],
    } as UIGraph;
    if (outputPortId) {
        graph.edges.push({ from: { nodeId: "act", port: outputPortId }, to: { nodeId: "store", port: "value" } });
    }
    return graph;
}

describe("Voice blueprint nodes", () => {
    it("publishes Get Voice Language to a downstream data pin", async () => {
        const locals = await runGraph(
            captureOutputGraph(BLUEPRINT_NODE_TYPE_VOICE_GET_LANGUAGE, "value"),
            { locale: "ja", setCalls: [], playCalls: [] },
        );
        expect(locals).toMatchObject({ out: "ja" });
    });

    it("publishes the dub languages this build ships", async () => {
        const locals = await runGraph(
            captureOutputGraph(BLUEPRINT_NODE_TYPE_VOICE_GET_AVAILABLE_LANGUAGES, "value"),
            { locale: "ja", setCalls: [], playCalls: [] },
        );
        expect(locals.out).toEqual([
            { code: "ja", displayName: "日本語" },
            { code: "en", displayName: "English" },
        ]);
    });

    it("persists a dub choice the build ships", async () => {
        const host: VoiceHost = { locale: "ja", setCalls: [], playCalls: [] };
        await runGraph(stringInputGraph(BLUEPRINT_NODE_TYPE_VOICE_SET_LANGUAGE, "language", "en"), host);
        expect(host.setCalls).toEqual(["en"]);
        expect(host.locale).toBe("en");
    });

    it("refuses a dub language the build does not ship", async () => {
        const host: VoiceHost = { locale: "ja", setCalls: [], playCalls: [] };
        await expect(
            runGraph(stringInputGraph(BLUEPRINT_NODE_TYPE_VOICE_SET_LANGUAGE, "language", "fr"), host),
        ).rejects.toThrow(/fr/);
        expect(host.setCalls).toEqual([]);
    });

    it("refuses to set a language on a project with no voice at all", async () => {
        const host: VoiceHost = { locale: "", locales: [], setCalls: [], playCalls: [] };
        await expect(
            runGraph(stringInputGraph(BLUEPRINT_NODE_TYPE_VOICE_SET_LANGUAGE, "language", "ja"), host),
        ).rejects.toThrow(/no voice languages/i);
    });

    it("plays a take by voice unit id and reports whether it played", async () => {
        const host: VoiceHost = { locale: "ja", setCalls: [], playCalls: [] };
        expect(await runGraph(stringInputGraph(BLUEPRINT_NODE_TYPE_VOICE_PLAY, "voiceId", "t-1", "value"), host))
            .toMatchObject({ out: true });
        expect(host.playCalls).toEqual(["t-1"]);
    });

    /**
     * A backlog row for an unvoiced line is normal, not an error: the graph keeps running and the
     * `Played` pin is what a UI hides its replay button on.
     */
    it("reports false rather than throwing for a line with no take", async () => {
        const host: VoiceHost = { locale: "ja", setCalls: [], playCalls: [] };
        expect(await runGraph(stringInputGraph(BLUEPRINT_NODE_TYPE_VOICE_PLAY, "voiceId", "t-9", "value"), host))
            .toMatchObject({ out: false });
    });

    it("treats an empty voice id as nothing to play, without calling the host", async () => {
        const host: VoiceHost = { locale: "ja", setCalls: [], playCalls: [] };
        expect(await runGraph(stringInputGraph(BLUEPRINT_NODE_TYPE_VOICE_PLAY, "voiceId", "   ", "value"), host))
            .toMatchObject({ out: false });
        expect(host.playCalls).toEqual([]);
    });

    /**
     * Play Choice Voice takes no id: the row it runs in is the option, so the id comes off the item
     * the choice slot injected. That is the whole reason the node exists as its own type.
     */
    it("speaks the option of the row it runs in", async () => {
        const host: VoiceHost = { locale: "ja", setCalls: [], playCalls: [], choiceCalls: [] };
        expect(await runGraph(playChoiceGraph(), host, choiceRow("t-1"))).toMatchObject({ out: true });
        expect(host.choiceCalls).toEqual([["t-1", false]]);
    });

    it("leaves the other options alone unless the author asks", async () => {
        const host: VoiceHost = { locale: "ja", setCalls: [], playCalls: [], choiceCalls: [] };
        await runGraph(playChoiceGraph(true), host, choiceRow("t-1"));
        await runGraph(playChoiceGraph(false), host, choiceRow("t-1"));
        expect(host.choiceCalls).toEqual([["t-1", true], ["t-1", false]]);
    });

    it("reports false for an option with no take, without calling the host", async () => {
        const host: VoiceHost = { locale: "ja", setCalls: [], playCalls: [], choiceCalls: [] };
        expect(await runGraph(playChoiceGraph(), host, choiceRow(""))).toMatchObject({ out: false });
        expect(host.choiceCalls).toEqual([]);
    });

    /**
     * Outside a choice row there is no option to speak at all - an authoring mistake, unlike an
     * option that simply has no take, so it is said out loud rather than reported on a pin.
     */
    it("refuses to run outside a choice row", async () => {
        const host: VoiceHost = { locale: "ja", setCalls: [], playCalls: [], choiceCalls: [] };
        await expect(runGraph(playChoiceGraph(), host)).rejects.toThrow(/choice list row/i);
        expect(host.choiceCalls).toEqual([]);
    });
});
