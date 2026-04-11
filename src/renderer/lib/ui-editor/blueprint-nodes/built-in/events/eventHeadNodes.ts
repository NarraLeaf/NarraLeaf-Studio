/**
 * UI dispatch event entry heads (wired from widget behavior.events slot ids).
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
} from "@shared/types/blueprint/graph";
import type { BlueprintNodeDef } from "../../types";

const eventHeadExecute: BlueprintNodeDef["execute"] = () => ({ nextPort: "then" });

export const eventHeadBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
        displayName: "On widget initialize",
        category: "Events",
        keywords: ["init", "initialize", "mount", "start", "begin"],
        graphKinds: ["event"],
        isPure: false,
        role: "eventHead",
        pins: [{ id: "then", kind: "output", semantic: "exec", label: "Then" }],
        execute: eventHeadExecute,
    },
    {
        type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_CLICK,
        displayName: "On button click",
        category: "Events",
        keywords: ["click", "button", "tap", "press"],
        graphKinds: ["event"],
        isPure: false,
        role: "eventHead",
        scope: { widgetElementTypes: ["nl.button"] },
        pins: [{ id: "then", kind: "output", semantic: "exec", label: "Then" }],
        execute: eventHeadExecute,
    },
];
