/**
 * UI dispatch event entry heads wired from widget behavior.events slot ids.
 * The minimal built-in catalog currently registers only the click entry head.
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_CLICK,
} from "@shared/types/blueprint/graph";
import { BUILTIN_WIDGET_LOGIC_APIS } from "@shared/types/ui-editor/widgetLogic";
import type { BlueprintNodeDef } from "../../types";

const eventHeadExecute: BlueprintNodeDef["execute"] = () => ({ nextPort: "then" });

function widgetTypesForHead(headType: string): string[] {
    return Object.entries(BUILTIN_WIDGET_LOGIC_APIS)
        .filter(([, api]) => api.events.some(eventDef => eventDef.headNodeTypes?.includes(headType)))
        .map(([widgetType]) => widgetType)
        .filter(widgetType => widgetType !== "nl.root");
}

export const eventHeadBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_CLICK,
        displayName: "On click",
        category: "Events",
        keywords: ["click", "button", "image", "container", "text", "tap", "press"],
        graphKinds: ["event"],
        isPure: false,
        role: "eventHead",
        scope: { widgetElementTypes: widgetTypesForHead(BLUEPRINT_NODE_TYPE_EVENT_HEAD_CLICK) },
        pins: [{ id: "then", kind: "output", semantic: "exec", label: "Then" }],
        execute: eventHeadExecute,
    },
];
