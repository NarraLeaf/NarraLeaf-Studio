import { describe, expect, it } from "vitest";
import { encodeBlueprintOwnerKey } from "@shared/blueprint/ownerKey";
import { MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import type { BlueprintDocument, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_ELEMENT_REF,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_APPEND_TEXT,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
} from "@shared/types/blueprint/graph";
import type { UIElement } from "@shared/types/ui-editor/document";
import { requireUITextSite, uiTextSourceOf, type UITextSite } from "@shared/types/ui-editor/textSource";
import { indexUITextWriters } from "@shared/types/ui-editor/textWriters";
import { labelWordsBoxOf } from "./labelWordsBox";

/**
 * Which box a text's or a button's inspector edits the element's own words in.
 *
 * Words a blueprint writes over while the game runs are the element's default value - the ordinary
 * box, labelled as the default - and words a binding answers are sample text. The writers come from a
 * real blueprint document through the same index the inspector reads, so a renamed node or a missed
 * wiring shape shows up here as the wrong box.
 */

const TEXT = requireUITextSite("nl.text");
const BUTTON = requireUITextSite("nl.button");

function element(id: string, type: string, props: Record<string, unknown>, valueBindings?: UIElement["valueBindings"]): UIElement {
    return {
        id,
        type,
        parentId: "root",
        childrenIds: [],
        layout: { x: 0, y: 0, width: 10, height: 10 } as UIElement["layout"],
        props,
        ...(valueBindings ? { valueBindings } : {}),
    };
}

const PAGE_OWNER: BlueprintOwnerRef = { kind: "surfaceMain", surfaceId: MAIN_APP_SURFACE_ID };
const AUTO_OWNER: BlueprintOwnerRef = { kind: "widgetMain", surfaceId: MAIN_APP_SURFACE_ID, elementId: "auto" };

/** One click event per blueprint: `nodes` are written after the head, chained in order. */
function clickBlueprint(id: string, owner: BlueprintOwnerRef, nodes: Record<string, { type: string; params?: Record<string, unknown> }>, edges: [string, string, string, string][]) {
    return {
        id,
        name: id,
        owner,
        graphs: {
            events: {
                click: {
                    id: "click",
                    graph: {
                        nodes: {
                            head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK },
                            ...Object.fromEntries(Object.entries(nodes).map(([nodeId, node]) => [nodeId, { id: nodeId, ...node }])),
                        },
                        edges: edges.map(([fromNode, fromPort, toNode, toPort]) => ({
                            from: { nodeId: fromNode, port: fromPort },
                            to: { nodeId: toNode, port: toPort },
                        })),
                    },
                },
            },
            functions: {},
        },
    };
}

/**
 * The page's graph sets the score with Set Text and appends to the log; the auto-play button's own
 * graph sets its label.
 */
const blueprints = {
    ownerRecords: {
        [encodeBlueprintOwnerKey(PAGE_OWNER)]: { blueprintId: "bp-page" },
        [encodeBlueprintOwnerKey(AUTO_OWNER)]: { blueprintId: "bp-auto" },
    },
    blueprints: {
        "bp-page": clickBlueprint("bp-page", PAGE_OWNER, {
            score: { type: BLUEPRINT_NODE_TYPE_ELEMENT_REF, params: { surfaceId: MAIN_APP_SURFACE_ID, elementId: "score", elementType: "nl.text" } },
            setScore: { type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT, params: { text: "分数：1" } },
            log: { type: BLUEPRINT_NODE_TYPE_ELEMENT_REF, params: { surfaceId: MAIN_APP_SURFACE_ID, elementId: "log", elementType: "nl.text" } },
            appendLog: { type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_APPEND_TEXT, params: { text: "+1" } },
            nametag: { type: BLUEPRINT_NODE_TYPE_ELEMENT_REF, params: { surfaceId: MAIN_APP_SURFACE_ID, elementId: "nametag", elementType: "nl.text" } },
            setNametag: { type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT, params: { text: "Aoi" } },
        }, [
            ["head", "next", "setScore", "in"],
            ["score", "element", "setScore", "element"],
            ["setScore", "next", "appendLog", "in"],
            ["log", "element", "appendLog", "element"],
            ["appendLog", "next", "setNametag", "in"],
            ["nametag", "element", "setNametag", "element"],
        ]),
        "bp-auto": clickBlueprint("bp-auto", AUTO_OWNER, {
            setLabel: { type: "blueprint.button.setLabel", params: { label: "自动播放：开" } },
        }, [["head", "next", "setLabel", "in"]]),
    },
} as unknown as BlueprintDocument;

const writers = indexUITextWriters(blueprints);

const BOUND = { text: { kind: "blueprintValue" as const, blueprintId: "bp-name", valueType: "string" as const } };

/** The box for an element, with the source the inspector shows as chosen read the way it reads it. */
function boxOf(target: UIElement, site: UITextSite, pickingKey = false) {
    const source = uiTextSourceOf(target, site);
    const shown = source === "key" ? "key" : pickingKey && source !== null ? "key" : source;
    return labelWordsBoxOf(target, site, writers.get(target.id), shown);
}

describe("labelWordsBoxOf", () => {
    it("edits the words a blueprint writes over as the default value, beside a bound element's sample text", () => {
        expect(boxOf(element("score", "nl.text", { text: "分数：0" }), TEXT)).toEqual({ kind: "default" });
        expect(boxOf(element("auto", "nl.button", { label: "自动播放：关" }), BUTTON)).toEqual({ kind: "default" });
        // Written over too, but a value blueprint answers it: the binding decides, as in the game.
        expect(boxOf(element("nametag", "nl.text", { text: "Narra" }, BOUND), TEXT)).toEqual({ kind: "sample", cause: "blueprintValue" });
    });

    it("edits words nothing writes over, or only appends to, as the words a player reads", () => {
        expect(boxOf(element("title", "nl.text", { text: "你的游戏" }), TEXT)).toEqual({ kind: "words" });
        expect(boxOf(element("log", "nl.text", { text: "记录" }), TEXT)).toEqual({ kind: "words" });
    });

    it("offers no box for the element's own words under a key, a key being picked, or a row field", () => {
        expect(boxOf(element("score", "nl.text", { text: "分数：0", localizationKey: "hud.score" }), TEXT)).toEqual({ kind: "none" });
        expect(boxOf(element("score", "nl.text", { text: "分数：0" }), TEXT, true)).toEqual({ kind: "none" });
        expect(boxOf(element("speaker", "nl.text", { text: "Aoi" }, { text: { kind: "listItemField", fieldId: "speaker" } }), TEXT))
            .toEqual({ kind: "none" });
    });

    it("edits the words under a component's text parameter as sample text", () => {
        expect(boxOf(element("label", "nl.button", { label: "Item" }, { label: { kind: "componentParam", paramId: "label" } }), BUTTON))
            .toEqual({ kind: "sample", cause: "componentParam" });
    });
});
