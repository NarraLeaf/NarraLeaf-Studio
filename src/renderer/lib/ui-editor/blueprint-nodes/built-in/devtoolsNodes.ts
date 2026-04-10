/**
 * Debug / devtools: host log API and browser console print.
 * Comments in English per project convention.
 */

import type { BlueprintNodeDef } from "../types";
import { BLUEPRINT_NODE_TYPE_LOG } from "@shared/types/blueprint/graph";
import { requireHostApi } from "./hostApi";
import { resolveConsolePrintValue, resolveDataPinValue } from "./graphParamResolvers";

export const devtoolsBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: "blueprint.devtools.log",
        displayName: "Host log",
        category: "Debug",
        keywords: ["log", "print", "debug"],
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
                label: "Message",
                allowInlineLiteral: true,
            },
        ],
        inspectorParams: [{ key: "level", label: "Level", kind: "string" }],
        execute: ctx => {
            const api = requireHostApi(ctx);
            const payload = resolveDataPinValue(
                ctx.graph,
                ctx.node.id,
                "value",
                ctx.params,
                ctx.blueprintLocals,
            );
            if (payload === undefined) {
                return { nextPort: "next" };
            }
            const message = stringifyForLog(payload);
            const level = String(ctx.params.level ?? "info");
            api.devtools.log(level, message);
            return { nextPort: "next" };
        },
    },
    {
        type: "blueprint.console.print",
        displayName: "Print to browser console",
        category: "Debug",
        keywords: ["console", "browser", "log", "print", "debug", "devtools"],
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
        execute: ({ params, graph, node, blueprintLocals }) => {
            const value = resolveConsolePrintValue(graph, node, params, blueprintLocals);
            if (value === undefined) {
                return { nextPort: "next" };
            }
            // Browser DevTools output; payload comes only from the Value input pin.
            // eslint-disable-next-line no-console -- blueprint.console.print
            console.log("[Blueprint]", value);
            return { nextPort: "next" };
        },
    },
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
