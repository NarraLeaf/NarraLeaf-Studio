/**
 * Registers all built-in blueprint nodes (single source for editor + runtime).
 * Comments in English per project convention.
 */

import { BlueprintGraphExecutionError } from "../behavior-graph/GraphExecutionError";
import type { BehaviorNodeDefinition } from "../behavior-graph/BehaviorNodeRegistry";
import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD,
    BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY,
    BLUEPRINT_NODE_TYPE_LITERAL,
    BLUEPRINT_NODE_TYPE_REROUTE,
} from "@shared/types/blueprint/graph";
import { defineBlueprintNodes } from "./defineBlueprintNode";

function requireHostApi(ctx: Parameters<BehaviorNodeDefinition["execute"]>[0]) {
    const api = ctx.hostAdapter.blueprintRuntime?.hostApi;
    if (!api) {
        throw new BlueprintGraphExecutionError("Blueprint host API is not available (open Dev Mode)", ctx.node.id);
    }
    return api;
}

let installed = false;

export function registerCoreBlueprintNodes(): void {
    if (installed) {
        return;
    }
    installed = true;

    defineBlueprintNodes([
        {
            type: BLUEPRINT_NODE_TYPE_EVENT_HEAD,
            displayName: "Event",
            category: "Events",
            keywords: ["event", "start", "begin"],
            graphKinds: ["event"],
            isPure: false,
            role: "eventHead",
            pins: [{ id: "then", kind: "output", semantic: "exec", label: "Then" }],
            execute: () => ({ nextPort: "then" }),
        },
        {
            type: BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY,
            displayName: "Function entry",
            category: "Flow",
            keywords: ["function", "entry", "start"],
            graphKinds: ["function"],
            isPure: true,
            role: "functionEntry",
            pins: [
                { id: "in", kind: "input", semantic: "exec", label: "In" },
                { id: "then", kind: "output", semantic: "exec", label: "Then" },
            ],
            execute: () => ({ nextPort: "then" }),
        },
        {
            type: BLUEPRINT_NODE_TYPE_REROUTE,
            displayName: "Reroute",
            category: "Layout",
            keywords: ["reroute", "wire", "organize"],
            graphKinds: ["event", "function", "macro"],
            isPure: false,
            role: "reroute",
            pins: [
                { id: "in", kind: "input", semantic: "exec", label: "" },
                { id: "out", kind: "output", semantic: "exec", label: "" },
            ],
            execute: () => ({ nextPort: "out" }),
        },
        {
            type: BLUEPRINT_NODE_TYPE_LITERAL,
            displayName: "Literal",
            category: "Data",
            keywords: ["literal", "value", "const"],
            graphKinds: ["event", "function", "macro"],
            isPure: true,
            role: "dataLiteral",
            pins: [{ id: "value", kind: "output", semantic: "data", valueType: "json", label: "Value" }],
            inspectorParams: [{ key: "value", label: "Value", kind: "json" }],
            execute: ctx => {
                throw new BlueprintGraphExecutionError(
                    "Literal nodes are data-only and must not sit on the execution path",
                    ctx.node.id,
                );
            },
        },
        {
            type: "sequence",
            displayName: "Sequence",
            category: "Flow",
            keywords: ["sequence", "flow"],
            graphKinds: ["event", "macro"],
            isPure: false,
            pins: [
                { id: "in", kind: "input", semantic: "exec", label: "In" },
                { id: "next", kind: "output", semantic: "exec", label: "Next" },
            ],
            execute: () => ({ nextPort: "next" }),
        },
        {
            type: "if",
            displayName: "Branch",
            category: "Flow",
            keywords: ["if", "branch", "condition"],
            graphKinds: ["event", "macro"],
            isPure: false,
            pins: [
                { id: "in", kind: "input", semantic: "exec", label: "In" },
                { id: "true", kind: "output", semantic: "exec", label: "True" },
                { id: "false", kind: "output", semantic: "exec", label: "False" },
                { id: "condition", kind: "input", semantic: "data", valueType: "boolean", label: "Condition" },
            ],
            inspectorParams: [{ key: "condition", label: "Condition", kind: "json" }],
            execute: ({ params, graph, node }) => {
                const conditionValue = resolveIfCondition(graph, node, params);
                const truthy = Boolean(conditionValue);
                return { nextPort: truthy ? "true" : "false" };
            },
        },
        {
            type: "delay",
            displayName: "Delay",
            category: "Flow",
            keywords: ["delay", "wait"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [
                { id: "in", kind: "input", semantic: "exec", label: "In" },
                { id: "next", kind: "output", semantic: "exec", label: "Next" },
            ],
            inspectorParams: [{ key: "duration", label: "Duration (ms)", kind: "number" }],
            async execute({ params }) {
                const duration = Math.max(0, Number(params.duration ?? 0));
                if (duration > 0) {
                    await new Promise(resolve => setTimeout(resolve, duration));
                }
                return { nextPort: "next" };
            },
        },
        {
            type: "effect.run",
            displayName: "Run Effect",
            category: "Effects",
            keywords: ["effect", "host"],
            graphKinds: ["event", "macro"],
            isPure: false,
            pins: [
                { id: "in", kind: "input", semantic: "exec", label: "In" },
                { id: "next", kind: "output", semantic: "exec", label: "Next" },
            ],
            inspectorParams: [
                { key: "effectId", label: "Effect id", kind: "string" },
                { key: "payload", label: "Payload (JSON)", kind: "json" },
            ],
            async execute({ params, hostAdapter, node }) {
                const effectId = String(params.effectId ?? params.effect ?? "").trim();
                if (!effectId) {
                    throw new BlueprintGraphExecutionError("Behavior node 'effect.run' requires an effectId parameter", node.id);
                }
                await hostAdapter.effects.runEffect(effectId, params.payload ?? params.data ?? {});
                return { nextPort: "next" };
            },
        },
        {
            type: "blueprint.state.set",
            displayName: "Set surface state",
            category: "Blueprint",
            keywords: ["state", "set", "surface"],
            graphKinds: ["event", "macro"],
            isPure: false,
            pins: [
                { id: "in", kind: "input", semantic: "exec", label: "In" },
                { id: "next", kind: "output", semantic: "exec", label: "Next" },
            ],
            inspectorParams: [
                { key: "key", label: "State key", kind: "string" },
                { key: "value", label: "Value (JSON)", kind: "json" },
            ],
            execute: ({ params, hostAdapter, node }) => {
                const rt = hostAdapter.blueprintRuntime;
                if (!rt) {
                    throw new BlueprintGraphExecutionError("blueprint.state.set requires blueprintRuntime on UIHostAdapter", node.id);
                }
                const key = String(params.key ?? "").trim();
                if (!key) {
                    throw new BlueprintGraphExecutionError("blueprint.state.set requires params.key", node.id);
                }
                const value = params.value;
                if (rt.hostApi) {
                    rt.hostApi.state.set("surface", key, value);
                } else {
                    rt.setSurfaceState(key, value);
                }
                return { nextPort: "next" };
            },
        },
        {
            type: "blueprint.state.get",
            displayName: "Get state",
            category: "Blueprint",
            keywords: ["state", "get", "read"],
            graphKinds: ["event", "macro"],
            isPure: false,
            pins: [
                { id: "in", kind: "input", semantic: "exec", label: "In" },
                { id: "next", kind: "output", semantic: "exec", label: "Next" },
            ],
            inspectorParams: [
                { key: "scope", label: "Scope (surface|global|persistence)", kind: "string" },
                { key: "key", label: "Key", kind: "string" },
            ],
            execute: ctx => {
                const api = requireHostApi(ctx);
                const scope = String(ctx.params.scope ?? "surface").trim();
                const key = String(ctx.params.key ?? "").trim();
                if (!key) {
                    throw new BlueprintGraphExecutionError("blueprint.state.get requires params.key", ctx.node.id);
                }
                void api.state.get(scope, key);
                return { nextPort: "next" };
            },
        },
        {
            type: "blueprint.state.setScoped",
            displayName: "Set state (scoped)",
            category: "Blueprint",
            keywords: ["state", "set", "global", "persistence"],
            graphKinds: ["event", "macro"],
            isPure: false,
            pins: [
                { id: "in", kind: "input", semantic: "exec", label: "In" },
                { id: "next", kind: "output", semantic: "exec", label: "Next" },
            ],
            inspectorParams: [
                { key: "scope", label: "Scope (surface|global|persistence)", kind: "string" },
                { key: "key", label: "Key", kind: "string" },
                { key: "value", label: "Value (JSON)", kind: "json" },
            ],
            execute: ctx => {
                const api = requireHostApi(ctx);
                const scope = String(ctx.params.scope ?? "surface").trim();
                const key = String(ctx.params.key ?? "").trim();
                if (!key) {
                    throw new BlueprintGraphExecutionError("blueprint.state.setScoped requires params.key", ctx.node.id);
                }
                api.state.set(scope, key, ctx.params.value);
                return { nextPort: "next" };
            },
        },
        {
            type: "blueprint.navigation.openSurface",
            displayName: "Open surface",
            category: "Navigation",
            keywords: ["nav", "surface", "open"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [
                { id: "in", kind: "input", semantic: "exec", label: "In" },
                { id: "next", kind: "output", semantic: "exec", label: "Next" },
            ],
            inspectorParams: [{ key: "surfaceId", label: "Surface id", kind: "string" }],
            async execute(ctx) {
                const api = requireHostApi(ctx);
                const surfaceId = String(ctx.params.surfaceId ?? "").trim();
                if (!surfaceId) {
                    throw new BlueprintGraphExecutionError("blueprint.navigation.openSurface requires params.surfaceId", ctx.node.id);
                }
                await api.navigation.openSurface(surfaceId);
                return { nextPort: "next" };
            },
        },
        {
            type: "blueprint.navigation.closeLayer",
            displayName: "Close layer",
            category: "Navigation",
            keywords: ["nav", "close", "layer", "back"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [
                { id: "in", kind: "input", semantic: "exec", label: "In" },
                { id: "next", kind: "output", semantic: "exec", label: "Next" },
            ],
            async execute(ctx) {
                const api = requireHostApi(ctx);
                await api.navigation.closeLayer();
                return { nextPort: "next" };
            },
        },
        {
            type: "blueprint.widget.setVisible",
            displayName: "Set visible",
            category: "Widget",
            keywords: ["visible", "show", "hide"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [
                { id: "in", kind: "input", semantic: "exec", label: "In" },
                { id: "next", kind: "output", semantic: "exec", label: "Next" },
            ],
            inspectorParams: [
                { key: "elementId", label: "Element id", kind: "string" },
                { key: "visible", label: "Visible (JSON)", kind: "json" },
            ],
            scope: { ownerKinds: ["widgetMain"] },
            async execute(ctx) {
                const api = requireHostApi(ctx);
                const elementId = String(ctx.params.elementId ?? "").trim();
                const visible = Boolean(ctx.params.visible ?? true);
                if (!elementId) {
                    throw new BlueprintGraphExecutionError("blueprint.widget.setVisible requires params.elementId", ctx.node.id);
                }
                await api.widget.setVisible(elementId, visible);
                return { nextPort: "next" };
            },
        },
        {
            type: "blueprint.widget.setEnabled",
            displayName: "Set enabled",
            category: "Widget",
            keywords: ["enabled", "disabled", "interaction"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [
                { id: "in", kind: "input", semantic: "exec", label: "In" },
                { id: "next", kind: "output", semantic: "exec", label: "Next" },
            ],
            inspectorParams: [
                { key: "elementId", label: "Element id", kind: "string" },
                { key: "enabled", label: "Enabled (JSON)", kind: "json" },
            ],
            scope: { ownerKinds: ["widgetMain"] },
            async execute(ctx) {
                const api = requireHostApi(ctx);
                const elementId = String(ctx.params.elementId ?? "").trim();
                const enabled = Boolean(ctx.params.enabled ?? true);
                if (!elementId) {
                    throw new BlueprintGraphExecutionError("blueprint.widget.setEnabled requires params.elementId", ctx.node.id);
                }
                await api.widget.setEnabled(elementId, enabled);
                return { nextPort: "next" };
            },
        },
        {
            type: "blueprint.widget.setVariant",
            displayName: "Set widget variant",
            category: "Widget",
            keywords: ["variant", "appearance", "container", "button"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [
                { id: "in", kind: "input", semantic: "exec", label: "In" },
                { id: "next", kind: "output", semantic: "exec", label: "Next" },
            ],
            inspectorParams: [
                { key: "elementId", label: "Element id", kind: "string" },
                { key: "variantId", label: "Variant id (JSON null clears)", kind: "json" },
            ],
            scope: { ownerKinds: ["widgetMain"] },
            async execute(ctx) {
                const api = requireHostApi(ctx);
                const elementId = String(ctx.params.elementId ?? "").trim();
                if (!elementId) {
                    throw new BlueprintGraphExecutionError("blueprint.widget.setVariant requires params.elementId", ctx.node.id);
                }
                const raw = ctx.params.variantId;
                if (raw === undefined) {
                    throw new BlueprintGraphExecutionError(
                        "blueprint.widget.setVariant requires params.variantId (string, or JSON null to clear override)",
                        ctx.node.id,
                    );
                }
                const variantId = raw === null ? null : String(raw).trim() || null;
                await api.widget.setVariant(elementId, variantId);
                return { nextPort: "next" };
            },
        },
        {
            type: "blueprint.persistence.get",
            displayName: "Persistence get",
            category: "Persistence",
            keywords: ["save", "load", "storage"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [
                { id: "in", kind: "input", semantic: "exec", label: "In" },
                { id: "next", kind: "output", semantic: "exec", label: "Next" },
            ],
            inspectorParams: [{ key: "key", label: "Key", kind: "string" }],
            async execute(ctx) {
                const api = requireHostApi(ctx);
                const key = String(ctx.params.key ?? "").trim();
                if (!key) {
                    throw new BlueprintGraphExecutionError("blueprint.persistence.get requires params.key", ctx.node.id);
                }
                await api.persistence.get(key);
                return { nextPort: "next" };
            },
        },
        {
            type: "blueprint.persistence.set",
            displayName: "Persistence set",
            category: "Persistence",
            keywords: ["save", "storage"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [
                { id: "in", kind: "input", semantic: "exec", label: "In" },
                { id: "next", kind: "output", semantic: "exec", label: "Next" },
            ],
            inspectorParams: [
                { key: "key", label: "Key", kind: "string" },
                { key: "value", label: "Value (JSON)", kind: "json" },
            ],
            async execute(ctx) {
                const api = requireHostApi(ctx);
                const key = String(ctx.params.key ?? "").trim();
                if (!key) {
                    throw new BlueprintGraphExecutionError("blueprint.persistence.set requires params.key", ctx.node.id);
                }
                await api.persistence.set(key, ctx.params.value);
                return { nextPort: "next" };
            },
        },
        {
            type: "blueprint.media.playAudio",
            displayName: "Play audio",
            category: "Media",
            keywords: ["audio", "sound"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [
                { id: "in", kind: "input", semantic: "exec", label: "In" },
                { id: "next", kind: "output", semantic: "exec", label: "Next" },
            ],
            inspectorParams: [{ key: "assetIdOrUrl", label: "Asset id or URL", kind: "string" }],
            async execute(ctx) {
                const api = requireHostApi(ctx);
                const assetIdOrUrl = String(ctx.params.assetIdOrUrl ?? ctx.params.url ?? "").trim();
                if (!assetIdOrUrl) {
                    throw new BlueprintGraphExecutionError("blueprint.media.playAudio requires params.assetIdOrUrl", ctx.node.id);
                }
                await api.media.playAudio(assetIdOrUrl);
                return { nextPort: "next" };
            },
        },
        {
            type: "blueprint.media.playAnimation",
            displayName: "Play animation",
            category: "Media",
            keywords: ["animation", "anim"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [
                { id: "in", kind: "input", semantic: "exec", label: "In" },
                { id: "next", kind: "output", semantic: "exec", label: "Next" },
            ],
            inspectorParams: [
                { key: "elementId", label: "Element id", kind: "string" },
                { key: "animationId", label: "Animation id", kind: "string" },
            ],
            async execute(ctx) {
                const api = requireHostApi(ctx);
                const elementId = String(ctx.params.elementId ?? "").trim();
                const animationId = String(ctx.params.animationId ?? "").trim();
                if (!elementId || !animationId) {
                    throw new BlueprintGraphExecutionError(
                        "blueprint.media.playAnimation requires params.elementId and params.animationId",
                        ctx.node.id,
                    );
                }
                await api.media.playAnimation(elementId, animationId);
                return { nextPort: "next" };
            },
        },
        {
            type: "blueprint.devtools.log",
            displayName: "Log",
            category: "Debug",
            keywords: ["log", "print", "debug"],
            graphKinds: ["event", "macro"],
            isPure: false,
            pins: [
                { id: "in", kind: "input", semantic: "exec", label: "In" },
                { id: "next", kind: "output", semantic: "exec", label: "Next" },
            ],
            inspectorParams: [
                { key: "level", label: "Level", kind: "string" },
                { key: "message", label: "Message", kind: "string" },
            ],
            execute: ctx => {
                const api = requireHostApi(ctx);
                const message = String(ctx.params.message ?? "");
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
                    valueType: "json",
                    label: "Value",
                },
            ],
            inspectorParams: [
                { key: "level", label: "Level (log|info|warn|error|debug)", kind: "string" },
                { key: "label", label: "Prefix label", kind: "string" },
                { key: "message", label: "Message / value (JSON)", kind: "json" },
            ],
            execute: ({ params, graph, node }) => {
                const levelRaw = String(params.level ?? "log").toLowerCase();
                const allowed = new Set(["log", "info", "warn", "error", "debug"]);
                const method = (allowed.has(levelRaw) ? levelRaw : "log") as
                    | "log"
                    | "info"
                    | "warn"
                    | "error"
                    | "debug";
                const label = String(params.label ?? "Blueprint").trim() || "Blueprint";
                const value = resolveConsolePrintValue(graph, node, params);
                const prefix = `[${label}]`;
                // Browser DevTools output; node exists for renderer-side debugging without Host API.
                // eslint-disable-next-line no-console -- blueprint.console.print
                console[method](prefix, value);
                return { nextPort: "next" };
            },
        },
    ]);
}

function resolveConsolePrintValue(
    graph: { edges?: Array<{ from: { nodeId: string; port: string }; to: { nodeId: string; port: string } }>; nodes?: Record<string, { type: string; params?: Record<string, unknown> }> },
    node: { id: string },
    params: Record<string, unknown>,
): unknown {
    const wired = graph.edges?.find(e => e.to.nodeId === node.id && e.to.port === "value");
    if (!wired) {
        return params.message ?? params.value ?? "";
    }
    const src = graph.nodes?.[wired.from.nodeId];
    if (!src) {
        return params.message ?? "";
    }
    if (src.type === BLUEPRINT_NODE_TYPE_LITERAL && wired.from.port === "value") {
        return src.params?.value ?? params.message ?? "";
    }
    return params.message ?? "";
}

function resolveIfCondition(
    graph: { edges: Array<{ from: { nodeId: string; port: string }; to: { nodeId: string; port: string } }>; nodes: Record<string, { type: string; params?: Record<string, unknown> }> },
    node: { id: string },
    params: Record<string, unknown>,
): unknown {
    const wired = graph.edges.find(e => e.to.nodeId === node.id && e.to.port === "condition");
    if (!wired) {
        return params.condition ?? params.value ?? false;
    }
    const src = graph.nodes[wired.from.nodeId];
    if (!src) {
        return params.condition ?? false;
    }
    if (src.type === BLUEPRINT_NODE_TYPE_LITERAL && wired.from.port === "value") {
        return src.params?.value ?? params.condition ?? false;
    }
    return params.condition ?? false;
}
