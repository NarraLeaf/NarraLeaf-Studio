/**
 * Debug / devtools: unified log (host + browser when available).
 * Comments in English per project convention.
 */

import type { BlueprintNodeDef } from "../types";
import { BLUEPRINT_NODE_TYPE_LOG } from "@shared/types/blueprint/graph";
import { resolveDataPinValue } from "./graphParamResolvers";

export const devtoolsBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: BLUEPRINT_NODE_TYPE_LOG,
        displayName: "Log",
        category: "Debug",
        keywords: ["log", "print", "console", "debug"],
        graphKinds: ["event", "macro"],
        isPure: false,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "next", kind: "output", semantic: "exec", label: "Next" },
            {
                id: "value",
                kind: "input",
                semantic: "data",
                valueType: "string",
                label: "Value",
                allowInlineLiteral: true,
            },
        ],
        execute: ctx => {
            const wired = resolveDataPinValue(
                ctx.graph,
                ctx.node.id,
                "value",
                ctx.params,
                ctx.blueprintLocals,
            );
            if (wired === undefined) {
                return { nextPort: "next" };
            }
            const line = stringifyForLog(wired);
            const api = ctx.hostAdapter.blueprintRuntime?.hostApi;
            if (api) {
                api.devtools.log("info", line);
            }
            // eslint-disable-next-line no-console -- blueprint.log
            console.log("[Blueprint]", line);
            return { nextPort: "next" };
        },
    },
];

function stringifyForLog(v: unknown): string {
    if (typeof v === "string") {
        return v;
    }
    try {
        return JSON.stringify(v);
    } catch {
        return String(v);
    }
}
